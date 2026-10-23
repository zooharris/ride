// The numbers behind the Progress charts and the ride page's power charts.
// Pure functions over rides, wellness and streams; nothing here touches storage.

import { HR_ZONES, type Zone } from './zones';
import type { Ride, SessionKind, Wellness } from './types';
import { addDays } from './load';

/** The durations the power curve is read at, in seconds. */
export const CURVE_SECONDS = [1, 5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200];
export const CURVE_LABELS = ['1s', '5s', '15s', '30s', '1m', '2m', '5m', '10m', '20m', '30m', '60m', '90m', '2h'];

/**
 * Mean-maximal power: for each duration, the best average power held for that
 * long anywhere in the recording. The stream is laid on a one-second grid first
 * (a gap in the recording counts as zero watts, as it would on the road), so a
 * recording at any sample rate reads the same. 0 where the ride was shorter.
 */
export function meanMaxPower(time: number[], watts: number[], durations: number[] = CURVE_SECONDS): number[] {
  const n = Math.min(time.length, watts.length);
  if (n < 2) return durations.map(() => 0);
  const t0 = time[0];
  const len = Math.max(1, Math.round(time[n - 1] - t0) + 1);
  const grid = new Float64Array(len);
  for (let i = 0; i < n; i++) {
    const a = Math.round(time[i] - t0);
    const b = i + 1 < n ? Math.min(len, Math.round(time[i + 1] - t0)) : a + 1;
    const w = watts[i] > 0 && isFinite(watts[i]) ? watts[i] : 0;
    // hold the sample until the next one, but never across a gap longer than 5 s
    const end = Math.min(b, a + 5);
    for (let k = a; k < end && k < len; k++) grid[k] = w;
  }
  const prefix = new Float64Array(len + 1);
  for (let k = 0; k < len; k++) prefix[k + 1] = prefix[k] + grid[k];
  return durations.map((d) => {
    if (d > len) return 0;
    let best = 0;
    for (let k = d; k <= len; k++) { const avg = (prefix[k] - prefix[k - d]) / d; if (avg > best) best = avg; }
    return Math.round(best);
  });
}

/** The best of several curves, duration by duration. */
export function bestCurve(curves: number[][]): number[] {
  if (!curves.length) return CURVE_SECONDS.map(() => 0);
  return curves[0].map((_, i) => Math.max(...curves.map((c) => c[i] ?? 0)));
}

/** Seconds spent in each power band of `bin` watts (time-weighted by the gap to the next sample, capped at 5 s). */
export function powerHistogram(time: number[], watts: number[], bin = 25): Array<{ from: number; seconds: number }> {
  const n = Math.min(time.length, watts.length);
  const acc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const w = watts[i];
    if (!(w > 0)) continue;
    const dt = i + 1 < n ? Math.min(5, Math.max(0, time[i + 1] - time[i])) : 1;
    const b = Math.floor(w / bin) * bin;
    acc.set(b, (acc.get(b) ?? 0) + dt);
  }
  if (!acc.size) return [];
  const max = Math.max(...acc.keys());
  const out: Array<{ from: number; seconds: number }> = [];
  for (let b = 0; b <= max; b += bin) out.push({ from: b, seconds: Math.round(acc.get(b) ?? 0) });
  return out;
}

/** Each week's done load by kind. Weeks run from `weekStartOf(date)`; every week in [from, to] appears, empty or not. */
export function weeklyLoad(rides: Ride[], from: string, to: string, weekStartOf: (d: string) => string): Array<{ start: string; byKind: Record<SessionKind, number>; total: number }> {
  const weeks = weekStarts(from, to, weekStartOf);
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const out = weeks.map((start) => ({ start, byKind: { ride: 0, strength: 0, walk: 0, mobility: 0, other: 0 } as Record<SessionKind, number>, total: 0 }));
  for (const r of rides) {
    const i = idx.get(weekStartOf(r.date));
    if (i == null || r.date < from || r.date > to) continue;
    const t = r.tss ?? 0;
    out[i].byKind[r.sport ?? 'ride'] += t;
    out[i].total += t;
  }
  return out;
}

/** Ride time per zone (Z1..Z7) by week, from each ride's power zones, else its heart-rate zones. */
export function weeklyZones(rides: Ride[], from: string, to: string, weekStartOf: (d: string) => string): Array<{ start: string; seconds: number[] }> {
  const weeks = weekStarts(from, to, weekStartOf);
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const out = weeks.map((start) => ({ start, seconds: [0, 0, 0, 0, 0, 0, 0] }));
  for (const r of rides) {
    if (r.sport !== 'ride' || r.date < from || r.date > to) continue;
    const i = idx.get(weekStartOf(r.date));
    const z = r.powerZoneSeconds?.length ? r.powerZoneSeconds : r.hrZoneSeconds;
    if (i == null || !z) continue;
    for (let k = 0; k < z.length; k++) out[i].seconds[Math.min(6, k)] += z[k] ?? 0;
  }
  return out;
}

export function weekStarts(from: string, to: string, weekStartOf: (d: string) => string): string[] {
  const out: string[] = [];
  for (let w = weekStartOf(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** The most heart-rate drift a steady ride shows; beyond it the ride was not steady (stops, a tailwind home, a sprint at the end). */
export const MAX_STEADY_DRIFT = 15;

/**
 * Is this a steady aerobic ride, the kind efficiency factor and heart-rate
 * drift mean something on? An hour or more; endurance by the caller's word
 * (planned as such) or, failing that, by intensity factor at most 0.78 when
 * one is known, or by average heart rate under 89% of threshold (the top of
 * heart-rate zone 2) when it is not; with a drift reading that is plausible.
 * One rule, so the Plan page and the Progress page cannot disagree.
 */
export function isSteadyAerobicRide(r: Ride, lthr?: number, isEndurance?: (r: Ride) => boolean | undefined, zones: Zone[] = HR_ZONES): boolean {
  if (r.sport !== 'ride' || r.seconds < 3600) return false;
  if (!(r.efficiencyFactor || r.decoupling != null)) return false;
  if (r.decoupling != null && Math.abs(r.decoupling) > MAX_STEADY_DRIFT) return false;
  const planned = isEndurance?.(r);
  if (planned != null) return planned;
  if (r.intensityFactor != null) return r.intensityFactor <= 0.78;
  if (r.averageHr && lthr) return r.averageHr / lthr < zones[1].high;
  return false;
}

/**
 * Efficiency factor and heart-rate drift on steady rides of an hour or more:
 * the honest signal of a growing aerobic base.
 */
export function aerobicPoints(rides: Ride[], isEndurance: (r: Ride) => boolean | undefined, lthr?: number, zones?: Zone[]): Array<{ date: string; ef?: number; drift?: number; name: string }> {
  return rides
    .filter((r) => isSteadyAerobicRide(r, lthr, isEndurance, zones))
    .map((r) => ({ date: r.date, ef: r.efficiencyFactor, drift: r.decoupling, name: r.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A trailing mean over the last `n` defined values (points without a value pass through as null). */
export function rollingMean(values: Array<number | null | undefined>, n: number): Array<number | null> {
  const out: Array<number | null> = [];
  const win: number[] = [];
  for (const v of values) {
    if (v != null && isFinite(v)) { win.push(v); if (win.length > n) win.shift(); }
    out.push(v != null && win.length ? win.reduce((a, b) => a + b, 0) / win.length : null);
  }
  return out;
}

/** A trailing mean over calendar days: for each day, the mean of the defined values in the `days` up to and including it. */
export function rollingDays(dates: string[], values: Array<number | null | undefined>, days: number): Array<number | null> {
  return dates.map((d, i) => {
    const lo = addDays(d, -(days - 1));
    const xs: number[] = [];
    for (let k = i; k >= 0 && dates[k] >= lo; k--) { const v = values[k]; if (v != null && isFinite(v)) xs.push(v); }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
}

/** Wellness laid on every day of a range; days with nothing synced are null. */
export function wellnessDays(wellness: Wellness[], from: string, to: string): Array<{ date: string; w?: Wellness }> {
  const by = new Map(wellness.map((w) => [w.date, w]));
  const out: Array<{ date: string; w?: Wellness }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, w: by.get(d) });
  return out;
}

/** Load per day, every activity summed. */
export function dailyLoad(rides: Ride[]): Map<string, { tss: number; names: string[] }> {
  const m = new Map<string, { tss: number; names: string[] }>();
  for (const r of rides) { const e = m.get(r.date) ?? { tss: 0, names: [] }; e.tss += r.tss ?? 0; e.names.push(r.name); m.set(r.date, e); }
  return m;
}

/** Consecutive weeks, ending this week, with at least one activity. */
export function weekStreak(rides: Ride[], today: string, weekStartOf: (d: string) => string): number {
  const active = new Set(rides.map((r) => weekStartOf(r.date)));
  let w = weekStartOf(today), n = 0;
  if (!active.has(w)) w = addDays(w, -7);   // this week not started yet still keeps last week's streak
  while (active.has(w)) { n++; w = addDays(w, -7); }
  return n;
}

/** Hours, distance (m), climbing (m) and sessions per calendar month, for the `months` ending with `today`'s month. */
export function monthlyTotals(rides: Ride[], today: string, months = 12): Array<{ month: string; hours: number; distanceM: number; climbingM: number; sessions: number }> {
  const out: Array<{ month: string; hours: number; distanceM: number; climbingM: number; sessions: number }> = [];
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(y, m - k, 1);
    out.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, hours: 0, distanceM: 0, climbingM: 0, sessions: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.month, i]));
  for (const r of rides) {
    const i = idx.get(r.date.slice(0, 7));
    if (i == null) continue;
    out[i].hours += r.seconds / 3600; out[i].distanceM += r.distanceM ?? 0; out[i].climbingM += r.elevationM ?? 0; out[i].sessions++;
  }
  return out;
}

/**
 * FTP on each day of a range, from the FTP recorded with each ride (the value
 * in force the day it was ridden), carried forward; `current` fills the days
 * after the last ride and any gap before the first.
 */
export function ftpByDay(rides: Ride[], from: string, to: string, current: number): Array<{ date: string; ftp: number }> {
  const known = rides.filter((r) => r.ftpAtRide).sort((a, b) => a.date.localeCompare(b.date));
  const out: Array<{ date: string; ftp: number }> = [];
  let k = 0, ftp = known.find((r) => r.date >= from)?.ftpAtRide ?? current;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    while (k < known.length && known[k].date <= d) { ftp = known[k].ftpAtRide!; k++; }
    out.push({ date: d, ftp });
  }
  if (out.length) out[out.length - 1].ftp = current;
  return out;
}
