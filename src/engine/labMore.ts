import type { Fitness, Ride } from './types';
import { addDays } from './load';

/**
 * What the Lab's approved chart designs need beyond the measures (28 Nov 2026): the kind of each session, the best
 * of each month at each length of effort, and fitness gained week by week.
 */

/** A general coaching rule, stated on the chart: fitness rising more than this in a week is more than is wise for long. */
export const RAMP_WISE = 5;

export type SessionKindName = 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'vo2' | 'sprint' | 'run' | 'strength' | 'walk' | 'mobility' | 'other';
/** Minutes of a kind of work that make a ride that kind of ride. Stated on the chart. */
export const KIND_MINUTES = { sprint: 2, vo2: 8, threshold: 15, tempo: 30 };

/**
 * The kind of a session. A ride is named for the hardest kind of work it held a real amount of: two minutes above
 * VO2max (zones 6 and 7), eight at VO2max, fifteen at threshold, thirty at tempo. Otherwise it is endurance, or
 * recovery when it was under an hour and mostly in the lowest zone. Sorted by power where the ride has it, by heart
 * rate where it has not; a ride with neither is "other".
 */
export function sessionKind(r: Ride): SessionKindName {
  if (r.sport !== 'ride') return r.sport === 'run' || r.sport === 'strength' || r.sport === 'walk' || r.sport === 'mobility' ? r.sport : 'other';
  const pz = r.powerZoneSeconds, hz = r.hrZoneSeconds;
  const m = (l: number[] | undefined, from: number, to = from) => { let s = 0; for (let z = from; z <= to; z++) s += l?.[z] ?? 0; return s / 60; };
  if (pz?.some((s) => s > 0)) {
    if (m(pz, 5, 6) >= KIND_MINUTES.sprint) return 'sprint';
    if (m(pz, 4) >= KIND_MINUTES.vo2) return 'vo2';
    if (m(pz, 3) >= KIND_MINUTES.threshold) return 'threshold';
    if (m(pz, 2) >= KIND_MINUTES.tempo) return 'tempo';
    const all = m(pz, 0, 6);
    return r.seconds < 3600 && all > 0 && m(pz, 0) / all >= 0.5 ? 'recovery' : 'endurance';
  }
  if (hz?.some((s) => s > 0)) {
    if (m(hz, 4, 6) >= KIND_MINUTES.vo2) return 'vo2';
    if (m(hz, 3) >= KIND_MINUTES.threshold) return 'threshold';
    if (m(hz, 2) >= KIND_MINUTES.tempo) return 'tempo';
    const all = m(hz, 0, 6);
    return r.seconds < 3600 && all > 0 && m(hz, 0) / all >= 0.5 ? 'recovery' : 'endurance';
  }
  return 'other';
}

/** The kind of a day: that of its session with the most training load (the longest, when none has load). */
export function dayKindName(onDay: Ride[]): SessionKindName | undefined {
  if (!onDay.length) return undefined;
  const top = [...onDay].sort((a, b) => (b.tss ?? 0) - (a.tss ?? 0) || b.seconds - a.seconds)[0];
  return sessionKind(top);
}

export interface MonthBest { month: string; best: number; date: string; id: string; record: boolean }
/** The best of each month at one length of effort, marking the months in which a best on record was set. */
export function monthlyBests(curves: Array<{ id: string; date: string; w: number[] }>, idx: number): MonthBest[] {
  const by = new Map<string, MonthBest>();
  for (const c of curves) {
    const v = c.w[idx] ?? 0;
    if (!(v > 0)) continue;
    const month = c.date.slice(0, 7), e = by.get(month);
    if (!e || v > e.best) by.set(month, { month, best: v, date: c.date, id: c.id, record: false });
  }
  const out = [...by.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  let top = 0;
  out.forEach((m, k) => { if (m.best > top) { m.record = k > 0; top = m.best; } });
  return out;
}

/** Fitness gained or lost in each week (Monday's figure against the Monday before), for the weeks ending in the span. */
export function weeklyGain(series: Fitness[], from: string, to: string, weekStartOf: (d: string) => string): Array<{ start: string; gain: number }> {
  const by = new Map(series.map((f) => [f.date, f.ctl]));
  const out: Array<{ start: string; gain: number }> = [];
  for (let w = weekStartOf(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6) > to ? to : addDays(w, 6);
    const a = by.get(addDays(w, -1)), b = by.get(end);
    if (a != null && b != null) out.push({ start: w, gain: b - a });
  }
  return out;
}
