import type { Wellness } from '../engine/types';

/**
 * Wellness from a whole-account export (Stage 1, 22 Nov 2026). Garmin does not publish its export's layout, so this
 * reads it by the names its daily records are known to use (as others who read these exports have published them),
 * not by fixed paths: any record with a calendar date and a known measure gives that day that measure. A file that
 * gives nothing is named in the summary, never guessed at.
 */

/** A day's date as YYYY-MM-DD, from the shapes the export uses (a string, a { date } object, or milliseconds). */
export function dayOf(x: unknown): string | undefined {
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  if (typeof x === 'number' && x > 1e11) return new Date(x).toISOString().slice(0, 10);
  if (x && typeof x === 'object' && 'date' in (x as object)) return dayOf((x as { date: unknown }).date);
  return undefined;
}

const num = (x: unknown): number | undefined => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && x.trim() && isFinite(Number(x)) ? Number(x) : undefined);
const pick = (o: Record<string, unknown>, ...keys: string[]) => { for (const k of keys) { const v = num(o[k]); if (v != null) return v; } return undefined; };

/** One record's measures, by the names the export is known to use. */
export function measuresOf(o: Record<string, unknown>): Partial<Wellness> {
  const w: Partial<Wellness> = {};
  // Sleep: the stages added up, else a total.
  const stages = ['deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds'].map((k) => num(o[k]));
  if (stages.some((x) => x != null)) w.sleepSeconds = stages.reduce<number>((a, b) => a + (b ?? 0), 0);
  else { const t = pick(o, 'sleepTimeSeconds', 'totalSleepSeconds'); if (t) w.sleepSeconds = t; }
  const scores = o.sleepScores as Record<string, unknown> | undefined;
  const score = pick(o, 'overallSleepScore', 'sleepScore') ?? (scores ? pick(scores, 'overallScore') ?? num((scores.overall as Record<string, unknown> | undefined)?.value) : undefined);
  if (score != null) w.sleepScore = score;
  const resp = pick(o, 'averageRespiration', 'avgSleepRespirationValue', 'respirationAverage');
  if (resp != null) w.respiration = resp;
  const sleepHr = pick(o, 'avgSleepHeartRate', 'averageSleepHeartRate');
  if (sleepHr != null) w.avgSleepingHr = sleepHr;
  const rhr = pick(o, 'restingHeartRate', 'restingHeartRateValue', 'currentDayRestingHeartRate');
  if (rhr != null && rhr > 20 && rhr < 150) w.restingHr = rhr;
  const steps = pick(o, 'totalSteps', 'steps');
  if (steps != null && steps >= 0) w.steps = steps;
  const spo2 = pick(o, 'averageSpo2', 'avgSpo2', 'averageSpO2Value');
  if (spo2 != null && spo2 > 50 && spo2 <= 100) w.spO2 = spo2;
  const vo2 = pick(o, 'vo2MaxValue', 'vo2Max', 'generic');
  if (vo2 != null && vo2 > 10 && vo2 < 100 && ('vo2MaxValue' in o || 'vo2Max' in o)) w.vo2max = vo2;
  // HRV: the night's average, directly or in a summary.
  const hrvSum = o.hrvSummary as Record<string, unknown> | undefined;
  const hrv = pick(o, 'lastNightAvg', 'hrvLastNightAvg') ?? (hrvSum ? pick(hrvSum, 'lastNightAvg') : undefined);
  if (hrv != null && hrv > 0 && hrv < 300) w.hrv = hrv;
  // Health-status style: a list of metrics, each with a type and a value.
  if (Array.isArray(o.metrics)) for (const m of o.metrics as Array<Record<string, unknown>>) {
    const type = String(m.type ?? m.metricType ?? '').toUpperCase(), v = num(m.value);
    if (v == null) continue;
    if (type === 'HRV' && w.hrv == null) w.hrv = v;
    else if ((type === 'HR' || type === 'RESTING_HR') && w.restingHr == null) w.restingHr = v;
    else if (type === 'RESPIRATION' && w.respiration == null) w.respiration = v;
    else if (type === 'SPO2' && w.spO2 == null) w.spO2 = v;
  }
  // Weight: grams in the export.
  const wt = pick(o, 'weight');
  if (wt != null) w.weightKg = wt > 1000 ? Math.round(wt / 100) / 10 : wt;
  return w;
}

/** Every day's measures found anywhere in one parsed JSON file. */
export function wellnessFromJson(json: unknown): Map<string, Partial<Wellness>> {
  const out = new Map<string, Partial<Wellness>>();
  const visit = (x: unknown, depth: number) => {
    if (depth > 6 || x == null) return;
    if (Array.isArray(x)) { for (const y of x) visit(y, depth + 1); return; }
    if (typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    const day = dayOf(o.calendarDate) ?? dayOf(o.summaryDate) ?? dayOf(o.date);
    if (day) {
      const m = measuresOf(o);
      if (Object.keys(m).length) out.set(day, { ...(out.get(day) ?? {}), ...Object.fromEntries(Object.entries(m).filter(([k]) => out.get(day)?.[k as keyof Wellness] == null)) });
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v, depth + 1);
  };
  visit(json, 0);
  return out;
}

/** Whether a file in an export holds wellness worth reading (its folder or name says so). */
export const wellnessFile = (path: string) => /\.json$/i.test(path) && /(Wellness|Aggregator|UDSFile|sleep|hrv|healthStatus|Metrics|BioMetrics)/i.test(path) && !/Fitness\/|summarizedActivities/i.test(path);

/**
 * Days added to what the device holds: a day not here is added; a day here gains only the measures it lacks. What is
 * here is never replaced (the rider's decision, 22 Nov 2026).
 */
export function fillDays(have: Map<string, Wellness>, found: Map<string, Partial<Wellness>>): Wellness[] {
  const out: Wellness[] = [];
  for (const [date, m] of found) {
    const cur = have.get(date);
    if (!cur) { out.push({ date, ...m }); continue; }
    const add = Object.fromEntries(Object.entries(m).filter(([k, v]) => v != null && cur[k as keyof Wellness] == null));
    if (Object.keys(add).length) out.push({ ...cur, ...add });
  }
  return out;
}
