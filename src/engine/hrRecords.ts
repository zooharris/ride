import type { Ride } from './types';

/**
 * Records for a rider with no power meter (12 Nov 2026, follow-up 9): what such a rider has. Longest ride by time
 * and by distance, most climbing in a ride, biggest week by hours and by training load, and the highest 20-minute
 * average heart rate on a ride. Each for the range shown, this year and all time, with what set it.
 */

export interface HrRecordRow {
  key: 'time' | 'distance' | 'climb' | 'weekHours' | 'weekLoad' | 'hr20';
  label: string;
  /** Value and where it was set (a ride's id, or the week's first day), for the range, the year and all time. */
  range?: { v: number; id: string; date: string };
  year?: { v: number; id: string; date: string };
  all?: { v: number; id: string; date: string };
  /** The range's best is the all-time best. */
  isNew: boolean;
  /** Set by a week, not a ride. */
  week: boolean;
}

/** The best 20-minute average of a heart-rate stream (one reading a second or so), or undefined when it is shorter. */
export function best20MinHr(time: number[], hr: Array<number | null | undefined>): number | undefined {
  const W = 1200;
  let best: number | undefined, lo = 0, sum = 0, n = 0;
  for (let i = 0; i < time.length; i++) {
    const h = hr[i];
    if (h != null && h > 30) { sum += h; n++; }
    while (lo < i && time[i] - time[lo] >= W) { const x = hr[lo]; if (x != null && x > 30) { sum -= x; n--; } lo++; }
    if (time[i] - time[lo] >= W - 1 && n >= W * 0.8) { const a = sum / n; if (best == null || a > best) best = a; }
  }
  return best != null ? Math.round(best) : undefined;
}

export function hrRecords(rides: Ride[], hr20: Record<string, number>, from: string, to: string, weekStartOf: (d: string) => string): HrRecordRow[] {
  const year = `${to.slice(0, 4)}-01-01`;
  const onBike = rides.filter((r) => r.sport === 'ride');
  const pick = (list: Ride[], get: (r: Ride) => number | undefined) => {
    let best: { v: number; id: string; date: string } | undefined;
    for (const r of list) { const v = get(r); if (v != null && v > 0 && (!best || v > best.v)) best = { v, id: r.id, date: r.date }; }
    return best;
  };
  const row = (key: HrRecordRow['key'], label: string, get: (r: Ride) => number | undefined): HrRecordRow => {
    const all = pick(onBike, get), range = pick(onBike.filter((r) => r.date >= from && r.date <= to), get), yr = pick(onBike.filter((r) => r.date >= year && r.date <= to), get);
    return { key, label, range, year: yr, all, isNew: !!range && !!all && range.v >= all.v, week: false };
  };
  // Weeks: every kind of session together, as the weekly load card counts them.
  const weeks = new Map<string, { h: number; tss: number }>();
  for (const r of rides) { const w = weekStartOf(r.date); const e = weeks.get(w) ?? { h: 0, tss: 0 }; e.h += r.seconds / 3600; e.tss += r.tss ?? 0; weeks.set(w, e); }
  const weekRow = (key: HrRecordRow['key'], label: string, get: (e: { h: number; tss: number }) => number): HrRecordRow => {
    const best = (lo: string, hi: string) => { let b: { v: number; id: string; date: string } | undefined; for (const [w, e] of weeks) { if (w < lo || w > hi) continue; const v = get(e); if (v > 0 && (!b || v > b.v)) b = { v, id: w, date: w }; } return b; };
    const all = best('', to), range = best(weekStartOf(from), to), yr = best(weekStartOf(year), to);
    return { key, label, range, year: yr, all, isNew: !!range && !!all && range.v >= all.v, week: true };
  };
  return [
    row('time', 'Longest ride, by time', (r) => r.seconds),
    row('distance', 'Longest ride, by distance', (r) => r.distanceM),
    row('climb', 'Most climbing in a ride', (r) => r.elevationM),
    weekRow('weekHours', 'Biggest week, by hours', (e) => e.h),
    weekRow('weekLoad', 'Biggest week, by training load', (e) => e.tss),
    row('hr20', 'Highest 20-minute heart rate', (r) => hr20[r.id]),
  ];
}

/** Whether the rider has ever ridden with power: until then, Progress shows heart-rate records in place of the power cards. */
export const hasPowerHistory = (rides: Ride[]): boolean => rides.some((r) => r.sport === 'ride' && !!(r.normalizedPower || r.averagePower));
