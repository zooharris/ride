// The new numbers on the Progress page (11 Nov 2026): records, durability, the ticker and Key numbers,
// plan done, ramp, the zone mix, whole body, the goal's rates, and breathing over time.
// Pure functions over rides, wellness, curves and the calendar; nothing here touches storage.
// Every threshold is either relative to the rider or a general rule stated where it is used.

import { addDays } from './load';
import { CURVE_SECONDS } from './progress';
import type { Fitness, Ride, SessionKind, Wellness } from './types';

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && isFinite(v);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 864e5);

// ---------- durability ----------

/**
 * Late in a ride begins once the ride has done work equal to one hour at the rider's FTP that day
 * (FTP in watts × 3.6 is that work in kilojoules). Before and after that point: the best 5-minute and
 * 20-minute power, each window wholly on its own side. 0 where that side is too short for the effort.
 */
export interface LateEfforts { v: number; at: number; b5?: number; a5?: number; b20?: number; a20?: number }
export const LATE_VERSION = 1;
export function lateKj(ftp: number): number { return Math.round(ftp * 3.6); }

export function lateEfforts(time: number[], watts: number[], ftp: number): LateEfforts {
  const at = lateKj(ftp);
  const n = Math.min(time.length, watts.length);
  const out: LateEfforts = { v: LATE_VERSION, at };
  if (n < 2 || !(ftp > 0)) return out;
  const t0 = time[0];
  const len = Math.max(1, Math.round(time[n - 1] - t0) + 1);
  const grid = new Float64Array(len);
  for (let i = 0; i < n; i++) {
    const a = Math.round(time[i] - t0);
    const b = i + 1 < n ? Math.min(len, Math.round(time[i + 1] - t0)) : a + 1;
    const w = watts[i] > 0 && isFinite(watts[i]) ? watts[i] : 0;
    const end = Math.min(b, a + 5);
    for (let k = a; k < end && k < len; k++) grid[k] = w;
  }
  const prefix = new Float64Array(len + 1);
  for (let k = 0; k < len; k++) prefix[k + 1] = prefix[k] + grid[k];
  // the first second by which the work done reaches the point
  let split = -1;
  for (let k = 1; k <= len; k++) if (prefix[k] / 1000 >= at) { split = k; break; }
  if (split < 0) return out;
  const best = (lo: number, hi: number, d: number) => {
    if (hi - lo < d) return 0;
    let m = 0;
    for (let k = lo + d; k <= hi; k++) { const avg = (prefix[k] - prefix[k - d]) / d; if (avg > m) m = avg; }
    return Math.round(m);
  };
  const b5 = best(0, split, 300), a5 = best(split, len, 300), b20 = best(0, split, 1200), a20 = best(split, len, 1200);
  if (b5) out.b5 = b5;
  if (a5) out.a5 = a5;
  if (b20) out.b20 = b20;
  if (a20) out.a20 = a20;
  return out;
}

export interface DurabilityRide { id: string; date: string; before: number; after: number }
export interface Durability {
  /** The effort compared, seconds. */
  effort: 300 | 1200;
  /** Rides in the range that went past the late point with the effort to spare on both sides. */
  rides: DurabilityRide[];
  /** Best before and after across the range, and the fade between them as a percentage of before. */
  before?: number; after?: number; fade?: number;
  /** The same fade over the range before this one, when it has enough rides. */
  fadeBefore?: number;
  /** Enough rides to show the headline. */
  enough: boolean;
}
export const DURABILITY_MIN_RIDES = 3;

export function durability(curves: Array<{ id: string; date: string; late?: LateEfforts }>, from: string, to: string, effort: 300 | 1200, prevFrom?: string): Durability {
  const pick = (c: { late?: LateEfforts }) => (effort === 300 ? [c.late?.b5, c.late?.a5] : [c.late?.b20, c.late?.a20]);
  const within = (a: string, b: string) => curves.filter((c) => c.date >= a && c.date <= b).map((c) => { const [x, y] = pick(c); return x && y ? { id: c.id, date: c.date, before: x, after: y } : null; }).filter((x): x is DurabilityRide => !!x).sort((a, b) => a.date.localeCompare(b.date));
  const summary = (rs: DurabilityRide[]) => {
    if (rs.length < DURABILITY_MIN_RIDES) return undefined;
    const before = Math.max(...rs.map((r) => r.before)), after = Math.max(...rs.map((r) => r.after));
    return { before, after, fade: Math.round(((before - after) / before) * 1000) / 10 };
  };
  const rides = within(from, to);
  const s = summary(rides);
  const p = prevFrom ? summary(within(prevFrom, addDays(from, -1))) : undefined;
  return { effort, rides, ...(s ?? {}), ...(p ? { fadeBefore: p.fade } : {}), enough: !!s };
}

// ---------- records ----------

/** The efforts the Records card lists, with their place in the curve. */
export const RECORD_EFFORTS: Array<{ label: string; seconds: number; idx: number }> = [5, 15, 60, 300, 1200, 3600].map((s) => ({
  label: s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : '60 min', seconds: s, idx: CURVE_SECONDS.indexOf(s),
}));

export interface RecordRow { label: string; seconds: number; range: number; rangeRide?: string; rangeDate?: string; year: number; all: number; isNew: boolean }

/**
 * Best power at each effort: in the range (with the ride and date that set it), this calendar year, and
 * all-time. "New" only when the range's best equals the all-time best, was set inside the range, and the
 * synced history begins before the range (so a first sync does not call everything new).
 */
export function records(curves: Array<{ id: string; date: string; w: number[] }>, from: string, to: string, historyStart: string): RecordRow[] {
  const year = `${to.slice(0, 4)}-01-01`;
  return RECORD_EFFORTS.map(({ label, seconds, idx }) => {
    let range = 0, rangeRide: string | undefined, rangeDate: string | undefined, yr = 0, all = 0;
    for (const c of curves) {
      const v = c.w[idx] ?? 0;
      if (!(v > 0)) continue;
      if (v > all) all = v;
      if (c.date >= year && c.date <= to && v > yr) yr = v;
      if (c.date >= from && c.date <= to && v > range) { range = v; rangeRide = c.id; rangeDate = c.date; }
    }
    return { label, seconds, range, rangeRide, rangeDate, year: yr, all, isNew: range > 0 && range >= all && historyStart < from };
  });
}

// ---------- the calendar: plan done and ramp ----------

/**
 * Load done as a share of load planned, over planned sessions dated from `from` to `to` (not after today):
 * a done session counts at its recorded load (its planned load when logged by hand), a missed or still-planned
 * one counts nothing. Undefined with nothing planned.
 */
export function planDone(entries: Array<{ date: string; status: string; plannedTss: number; doneTss?: number }>, from: string, to: string): { done: number; planned: number; share?: number } {
  let done = 0, planned = 0;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    planned += e.plannedTss;
    if (e.status === 'completed') done += e.doneTss ?? e.plannedTss;
  }
  return { done: Math.round(done), planned: Math.round(planned), share: planned > 0 ? Math.round((done / planned) * 100) : undefined };
}

/** The average weekly change in load across the last `n` whole weeks (least-squares slope, TSS a week per week). */
export function ramp(weeklyTotals: number[], n = 6): number | undefined {
  const xs = weeklyTotals.slice(-n);
  if (xs.length < 3) return undefined;
  const m = xs.length, mx = (m - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / m;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den ? Math.round(num / den) : undefined;
}

// ---------- the zone mix ----------

/**
 * Shares of riding time in zones 1–2, zone 3, and zones 4 and up, from the weekly zone seconds. Polarised
 * (a general rule, stated in the card's explanation): at least 75% in zones 1–2, at least 5% at zone 4 and up,
 * and less time in zone 3 than at zone 4 and up.
 */
export function zoneMix(weeks: Array<{ seconds: number[] }>): { easy: number; mid: number; hard: number; hoursPerWeek: number; polarised: boolean } | undefined {
  const tot = [0, 0, 0, 0, 0, 0, 0];
  for (const w of weeks) w.seconds.forEach((s, z) => { tot[z] += s; });
  const all = tot.reduce((a, b) => a + b, 0);
  if (!all) return undefined;
  const easy = (tot[0] + tot[1]) / all, mid = tot[2] / all, hard = (tot[3] + tot[4] + tot[5] + tot[6]) / all;
  return {
    easy: Math.round(easy * 100), mid: Math.round(mid * 100), hard: Math.round(hard * 100),
    hoursPerWeek: Math.round((all / 3600 / Math.max(1, weeks.length)) * 10) / 10,
    polarised: easy >= 0.75 && hard >= 0.05 && mid < hard,
  };
}

// ---------- key numbers ----------

/** A value on a day: the last one on or before it. */
export function valueOn<T extends { date: string }>(xs: T[], date: string, get: (x: T) => number | undefined): number | undefined {
  let v: number | undefined;
  for (const x of xs) { if (x.date > date) break; const g = get(x); if (ok(g)) v = g; }
  return v;
}

/** The mean of the readings in the 7 days ending on `date` (undefined with none). */
export function weekMean(wellness: Wellness[], date: string, get: (w: Wellness) => number | undefined): number | undefined {
  const from = addDays(date, -6);
  const vs = wellness.filter((w) => w.date >= from && w.date <= date).map(get).filter(ok).filter((v) => v > 0);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : undefined;
}

/** Load in the 7 days ending on `date`. */
export function sevenDayLoad(rides: Ride[], date: string): number {
  const from = addDays(date, -6);
  return Math.round(rides.filter((r) => r.date >= from && r.date <= date).reduce((a, r) => a + (r.tss ?? 0), 0));
}

/** Which way each number is meant to move with training; undefined for numbers never coloured. */
export const HELPFUL: Record<string, 'up' | 'down' | undefined> = {
  fitness: 'up', fatigue: undefined, form: undefined, ftp: 'up', wkg: 'up', load: undefined,
  hrv: 'up', rhr: 'down', sleep: 'up', weight: undefined, ef: 'up', drift: 'down',
};
/** Whether a change moved the helpful way (false when it did not, undefined when the number is never coloured or did not move). */
export function helpful(key: string, change: number): boolean | undefined {
  const h = HELPFUL[key];
  if (!h || !change) return undefined;
  return h === 'up' ? change > 0 : change < 0;
}

/** Sample a daily value at `n` evenly spaced days from `from` to `to`, for a small trend line. */
export function sampleDays(from: string, to: string, n: number, at: (d: string) => number | undefined): Array<number | null> {
  const span = Math.max(1, daysBetween(from, to));
  return Array.from({ length: n }, (_, i) => { const v = at(addDays(from, Math.round((span * i) / (n - 1)))); return ok(v) ? v : null; });
}

/** Fitness, fatigue or form on a day (the last value on or before it). */
export function fitnessOnDay(series: Fitness[], date: string): Fitness | undefined {
  let f: Fitness | undefined;
  for (const x of series) { if (x.date > date) break; f = x; }
  return f;
}

// ---------- whole body ----------

export const BODY_KINDS: SessionKind[] = ['strength', 'mobility', 'walk', 'run'];

/** Sessions of each kind beyond the bike, per week (weeks starting at `weekStarts`), from recorded activities and sessions logged by hand. */
export function sessionsPerWeek(
  items: Array<{ date: string; kind: SessionKind }>, weekStarts: string[],
): { weeks: Array<Record<SessionKind, number>>; average: Record<SessionKind, number>; kinds: SessionKind[] } {
  const zero = () => ({ ride: 0, strength: 0, mobility: 0, walk: 0, run: 0, other: 0 }) as Record<SessionKind, number>;
  const weeks = weekStarts.map(() => zero());
  for (const it of items) {
    if (!BODY_KINDS.includes(it.kind)) continue;
    for (let i = weekStarts.length - 1; i >= 0; i--) {
      if (it.date >= weekStarts[i] && it.date <= addDays(weekStarts[i], 6)) { weeks[i][it.kind]++; break; }
    }
  }
  const kinds = BODY_KINDS.filter((k) => items.some((it) => it.kind === k));
  const average = zero();
  for (const k of kinds) average[k] = Math.round((weeks.reduce((a, w) => a + w[k], 0) / Math.max(1, weeks.length)) * 10) / 10;
  return { weeks, average, kinds };
}

export type BodyGroup = 'push' | 'pull' | 'posterior' | 'trunk';
export const BODY_GROUPS: BodyGroup[] = ['push', 'pull', 'posterior', 'trunk'];
export const BODY_GROUP_LABEL: Record<BodyGroup, string> = { push: 'push', pull: 'pull', posterior: 'posterior chain', trunk: 'trunk' };
const GROUP_PATTERN: Record<string, BodyGroup> = { push: 'push', pull: 'pull', hinge: 'posterior', trunk: 'trunk' };
export const BALANCE_MIN_SESSIONS = 4;
export const BALANCE_FLOOR = 20;

/**
 * How matched strength sessions' exercises divide between push, pull, posterior chain (hinges) and trunk, using
 * the Library's "Includes" meanings. Shown with at least four matched sessions; balanced when no group is under 20%.
 */
export function strengthBalance(sessions: Array<{ patterns: string[] }>, unmatched: number): {
  sessions: number; unmatched: number; shares?: Record<BodyGroup, number>; balanced?: boolean; smallest?: BodyGroup; enough: boolean;
} {
  const counts: Record<BodyGroup, number> = { push: 0, pull: 0, posterior: 0, trunk: 0 };
  for (const s of sessions) for (const p of s.patterns) { const g = GROUP_PATTERN[p]; if (g) counts[g]++; }
  const total = BODY_GROUPS.reduce((a, g) => a + counts[g], 0);
  if (sessions.length < BALANCE_MIN_SESSIONS || !total) return { sessions: sessions.length, unmatched, enough: false };
  const shares = Object.fromEntries(BODY_GROUPS.map((g) => [g, Math.round((counts[g] / total) * 100)])) as Record<BodyGroup, number>;
  const smallest = BODY_GROUPS.reduce((m, g) => (shares[g] < shares[m] ? g : m), 'push' as BodyGroup);
  return { sessions: sessions.length, unmatched, shares, balanced: shares[smallest] >= BALANCE_FLOOR, smallest, enough: true };
}

// ---------- the goal ----------

/**
 * An FTP goal: what is still needed and the rate it needs, against the rider's own rate over the last twelve
 * weeks. The verdict only with at least two FTP values in the last sixteen weeks. No forecast is drawn.
 */
export function ftpGoal(history: Array<{ date: string; ftp: number }>, today: string, current: number, target: number, goalDate: string): {
  needed: number; daysLeft: number; neededPerWeek?: number; ownPerWeek?: number; verdict?: 'ahead' | 'on track' | 'behind';
} {
  const daysLeft = Math.max(0, daysBetween(today, goalDate));
  const needed = Math.max(0, target - current);
  const neededPerWeek = daysLeft > 0 ? Math.round((needed / (daysLeft / 7)) * 10) / 10 : undefined;
  const from12 = addDays(today, -84), from16 = addDays(today, -112);
  // FTP values on record over the last sixteen weeks: the one in force when they began, and every change since.
  const values = new Set(history.filter((h) => h.date >= from16).map((h) => h.ftp));
  const startValue = valueOn(history, from16, (h) => h.ftp);
  if (startValue != null) values.add(startValue);
  const at12 = valueOn(history, from12, (h) => h.ftp);
  const ownPerWeek = at12 != null ? Math.round(((current - at12) / 12) * 10) / 10 : undefined;
  let verdict: 'ahead' | 'on track' | 'behind' | undefined;
  if (values.size >= 2 && ownPerWeek != null && neededPerWeek != null) {
    if (needed === 0) verdict = 'ahead';
    else if (ownPerWeek >= neededPerWeek * 1.15) verdict = 'ahead';
    else if (ownPerWeek >= neededPerWeek * 0.85) verdict = 'on track';
    else verdict = 'behind';
  } else if (needed === 0 && values.size >= 2) verdict = 'ahead';
  return { needed, daysLeft, neededPerWeek, ownPerWeek, verdict };
}

// ---------- breathing ----------

/** Breathing rate at endurance power on one ride: the seconds-weighted mean across the bands from 55% to 75% of FTP. */
export function enduranceBreathRate(bands: Array<{ lo: number; hi: number; seconds: number; br?: number }> | undefined): number | undefined {
  if (!bands?.length) return undefined;
  let s = 0, w = 0;
  for (const b of bands) if (b.lo >= 0.55 && b.hi <= 0.75 && ok(b.br) && b.seconds > 0) { s += b.br * b.seconds; w += b.seconds; }
  return w >= 300 ? Math.round((s / w) * 10) / 10 : undefined;
}
