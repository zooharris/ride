import type { Analysis } from './analysis';
import type { BreathZone, Zone } from './zones';

/**
 * What an activity's chart opened large adds (22 Nov 2026, brief Part C): laps and steps, the planned target, zone
 * bands, smoothing for power and more numbers for the part selected. Everything here is worked out from the
 * recording and the plan; nothing is assumed about the rider.
 */

/** A lap or interval of the recording, in its seconds, with the name it is shown by. */
export interface LapMark { start: number; end: number; name: string }

/**
 * The laps to mark on the chart. When the laps line up with the workout's steps (the rule the Intervals against plan
 * table and the Laps table already use), each is named after its planned step; a strength or mobility session uses
 * the names its Laps table gives; otherwise the laps are numbered. Intervals that overlap (efforts Intervals.icu found,
 * not laps pressed) are left out, keeping the first of any that overlap, so the marks never cross.
 */
export function lapMarks(opts: { laps?: Array<{ start: number; end: number }>; analysis?: Analysis; names?: string[] }): LapMark[] {
  const a = opts.analysis;
  if (a && a.aligned === 'laps') {
    return a.steps.filter((s) => s.endSec > s.startSec).map((s) => ({ start: s.startSec, end: s.endSec, name: `${s.label}${s.set && s.set.times > 1 ? ` ${s.set.rep} of ${s.set.times}` : ''}` }));
  }
  const raw = (opts.laps ?? []).filter((l) => l.end > l.start);
  if (opts.names && opts.names.length === raw.length) return raw.map((l, i) => ({ start: l.start, end: l.end, name: opts.names![i] }));
  const sorted = [...raw].sort((x, y) => x.start - y.start);
  const kept: Array<{ start: number; end: number }> = [];
  for (const l of sorted) if (!kept.length || l.start >= kept[kept.length - 1].end - 2) kept.push(l);
  return kept.map((l, i) => ({ start: l.start, end: l.end, name: String(i + 1) }));
}

/**
 * A ride from the app's player knows when each step began, from its own laps: each step takes the time of its laps,
 * and a step not ridden (the ride ended early, or the step was skipped) takes none. Used for the target and the laps
 * even when too little of the workout was ridden for the Intervals against plan table to line the laps up.
 */
export function playerAligned(a: Analysis | undefined, laps: Array<{ start: number; end: number; step?: number }> | undefined): Analysis | undefined {
  if (!a || !laps?.some((l) => l.step != null)) return a;
  const steps = a.steps.map((s, i) => {
    const mine = laps.filter((l) => l.step === i && l.end > l.start);
    return mine.length ? { ...s, startSec: Math.min(...mine.map((l) => l.start)), endSec: Math.max(...mine.map((l) => l.end)) } : { ...s, startSec: 0, endSec: 0 };
  });
  return steps.some((s) => s.endSec > s.startSec) ? { ...a, steps, aligned: 'laps' } : a;
}

/** The measure a planned target was set in, as the large chart names it. */
export type TargetMeasure = 'watts' | 'hr' | 've';

/** The planned target as bands behind its measure, or the one plain reason it cannot be drawn. */
export type TargetBands = { measure: TargetMeasure; bands: Array<{ start: number; end: number; low: number; high: number; zone?: number }> } | { unavailable: string };

/**
 * The planned target's bands. A ride done in the app's player knows when each step began; a recording from a device
 * has the target drawn only when its laps line up with the steps. All-out steps and free steps (no target) have no band.
 * `analysis` is the ride read against the plan in the measure the target was set in, with the FTP and thresholds of
 * the day of the ride.
 */
export function targetBands(opts: { measure: TargetMeasure; analysis?: Analysis; free: boolean[]; breath?: Array<{ low: number; high: number; zone?: number } | undefined> }): TargetBands | undefined {
  const a = opts.analysis;
  if (!a || !a.steps.length) return undefined;
  if (!opts.free.some((f) => !f)) return undefined;
  if (a.aligned !== 'laps') return { unavailable: 'The laps your device recorded don’t line up with the workout’s steps, so the target can’t be placed on the ride.' };
  const bands = a.steps.flatMap((s, i) => {
    if (opts.free[i] || s.endSec <= s.startSec) return [];
    if (opts.measure === 've') { const b = opts.breath?.[i]; return b ? [{ start: s.startSec, end: s.endSec, low: b.low, high: b.high, zone: b.zone }] : []; }
    return [{ start: s.startSec, end: s.endSec, low: s.targetLow, high: s.targetHigh }];
  });
  return bands.length ? { measure: opts.measure, bands } : undefined;
}

/** A zone's boundaries in the measure's own unit. */
export interface ZoneBand { n: number; name: string; low: number; high: number }

/** Absolute zone bands from a ladder of fractions of a threshold (power zones on the day's FTP, heart-rate zones). */
export function zoneBands(zones: Zone[], threshold: number): ZoneBand[] {
  if (!threshold) return [];
  return zones.map((z) => ({ n: z.n, name: z.name, low: z.low * threshold, high: isFinite(z.high) ? z.high * threshold : Infinity }));
}
/** Breathing zones, already in litres a minute. */
export function breathBands(zones: BreathZone[] | undefined): ZoneBand[] {
  return (zones ?? []).map((z) => ({ n: z.n, name: z.name, low: z.low, high: z.high }));
}

/**
 * Time in each zone over part of the recording: each sample counts for the time to the next one (the last for the
 * same as the one before it), a gap in the measure counts for none, and nothing longer than `maxGap` seconds is counted (a pause).
 */
export function partZoneTime(t: number[], v: Array<number | undefined>, lo: number, hi: number, bands: ZoneBand[], maxGap = 30): number[] {
  const out = bands.map(() => 0);
  if (!bands.length || hi <= lo) return out;
  for (let i = lo; i <= hi; i++) {
    const x = v[i];
    if (x == null || !isFinite(x)) continue;
    // The last sample of the part counts for the same time as the one before it.
    const dt = i < hi ? t[i + 1] - t[i] : t[i] - t[i - 1];
    if (!(dt > 0) || dt > maxGap) continue;
    let k = bands.findIndex((b) => x >= b.low && x < b.high);
    if (k < 0) k = x < bands[0].low ? 0 : bands.length - 1;
    out[k] += dt;
  }
  return out;
}

/** The smoothing choices for power, in seconds; 0 is the recording as recorded. */
export const SMOOTHING = [0, 5, 30] as const;
export type Smoothing = typeof SMOOTHING[number];

/** The first index whose time is at or after `sec` (binary search over a rising time stream). */
export function indexAt(time: number[], sec: number): number {
  let a = 0, b = time.length - 1;
  if (b < 0) return 0;
  if (sec <= time[0]) return 0;
  if (sec > time[b]) return b;
  while (a < b) { const m = (a + b) >> 1; if (time[m] < sec) a = m + 1; else b = m; }
  return a;
}

/** A trailing average over `seconds` of the recording, second by second; gaps are skipped, never counted as zero. */
export function trailing(time: number[], v: Array<number | null | undefined>, seconds: number): number[] {
  const out: number[] = new Array(v.length);
  let sum = 0, n = 0, lo = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x != null && isFinite(x)) { sum += x; n++; }
    while (time[lo] <= time[i] - seconds) { const y = v[lo]; if (y != null && isFinite(y)) { sum -= y; n--; } lo++; }
    out[i] = n ? sum / n : NaN;
  }
  return out;
}

/** Power at each chart sample, smoothed: the trailing average ending at the sample's moment in the recording. */
export function smoothedAt(sampleTimes: number[], time: number[], watts: Array<number | null | undefined>, seconds: Smoothing): Array<number | undefined> {
  if (!seconds) return sampleTimes.map(() => undefined);
  const sm = trailing(time, watts, seconds);
  return sampleTimes.map((t) => { const i = indexAt(time, t); const x = sm[Math.min(i, sm.length - 1)]; return isFinite(x) ? x : undefined; });
}

/**
 * The shortest part each number is honest for, in seconds. Normalized power and heart-rate drift need twenty minutes
 * (both read the way effort builds over time; over less they say little); watts per heartbeat ten (heart rate takes
 * a minute or two to answer a change); work done one minute; distance 30 seconds; climb two minutes (shorter, the
 * altitude's own noise is a large share of it).
 */
export const MIN_PART = { np: 1200, drift: 1200, wpb: 600, work: 60, distance: 30, climb: 120 } as const;

export interface PartNumbers { np?: number; workKj?: number; wattsPerBeat?: number; driftPct?: number; distanceM?: number; climbM?: number }

/**
 * More numbers for the part of the recording from `t0` to `t1` seconds, each only where the recording has what it
 * needs and the part is at least that number's minimum. A number that cannot be worked out is left out.
 */
export function partNumbers(s: { time: number[]; watts?: Array<number | null>; heartrate?: Array<number | null>; distance?: Array<number | null>; altitude?: Array<number | null> }, t0: number, t1: number, opts: { test?: boolean } = {}): PartNumbers {
  const out: PartNumbers = {};
  const len = t1 - t0;
  if (!(len > 0) || s.time.length < 2) return out;
  const a = indexAt(s.time, t0), b = Math.max(a, Math.min(s.time.length - 1, indexAt(s.time, t1)));
  const ok = (x: number | null | undefined): x is number => x != null && isFinite(x);
  const has = (xs?: Array<number | null>) => !!xs && xs.slice(a, b + 1).filter(ok).length >= (b - a + 1) * 0.5;
  const dt = (i: number) => { const d = i < b ? s.time[i + 1] - s.time[i] : 1; return d > 0 && d <= 5 ? d : 0; };
  if (has(s.watts) && len >= MIN_PART.work) {
    let j = 0; for (let i = a; i <= b; i++) { const w = s.watts![i]; if (ok(w)) j += w * dt(i); }
    out.workKj = j / 1000;
  }
  if (has(s.watts) && len >= MIN_PART.np) {
    const t = s.time.slice(a, b + 1), w = s.watts!.slice(a, b + 1);
    const r = trailing(t, w, 30);
    let sum = 0, n = 0;
    for (let i = 0; i < r.length; i++) { if (t[i] - t[0] < 30 || !isFinite(r[i])) continue; sum += r[i] ** 4; n++; }
    if (n) out.np = (sum / n) ** 0.25;
  }
  const mean = (xs: Array<number | null>, i0: number, i1: number) => { let sm = 0, n = 0; for (let i = i0; i <= i1; i++) { const x = xs[i]; if (ok(x) && x > 0) { sm += x; n++; } } return n ? sm / n : undefined; };
  if (has(s.watts) && has(s.heartrate) && len >= MIN_PART.wpb) {
    const p = mean(s.watts!, a, b), h = mean(s.heartrate!, a, b);
    if (p && h) out.wattsPerBeat = p / h;
  }
  if (!opts.test && has(s.watts) && has(s.heartrate) && len >= MIN_PART.drift) {
    const m = indexAt(s.time, t0 + len / 2);
    const p1 = mean(s.watts!, a, m - 1), h1 = mean(s.heartrate!, a, m - 1), p2 = mean(s.watts!, m, b), h2 = mean(s.heartrate!, m, b);
    if (p1 && h1 && p2 && h2) out.driftPct = ((p1 / h1 - p2 / h2) / (p1 / h1)) * 100;
  }
  if (s.distance && len >= MIN_PART.distance) {
    const d0 = firstOk(s.distance, a, b, 1), d1 = firstOk(s.distance, b, a, -1);
    if (d0 != null && d1 != null && d1 > d0) out.distanceM = d1 - d0;
  }
  if (has(s.altitude) && len >= MIN_PART.climb) out.climbM = climb(s.altitude!.slice(a, b + 1));
  return out;
}

function firstOk(xs: Array<number | null>, from: number, to: number, dir: 1 | -1): number | undefined {
  for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) { const x = xs[i]; if (x != null && isFinite(x)) return x; }
  return undefined;
}

/** Height gained: rises counted once they pass a metre above the last low, so the altitude's noise is not counted as climbing. */
export function climb(alt: Array<number | null>): number {
  let total = 0, base: number | undefined, top: number | undefined;
  for (const x of alt) {
    if (x == null || !isFinite(x)) continue;
    if (base == null) { base = x; top = x; continue; }
    if (x > top!) top = x;
    if (top! - x >= 1 || x < base) {   // turned down: bank the rise if it was real
      if (top! - base >= 1) total += top! - base;
      base = x; top = x;
    }
  }
  if (base != null && top != null && top - base >= 1) total += top - base;
  return total;
}

/** Laps that fit on the chart's width, by their pixel span: a name is shown only where it fits, never overlapping. */
export function namesThatFit(spans: Array<{ x0: number; x1: number; name: string }>, charW = 6.6, pad = 8): boolean[] {
  return spans.map((s) => s.x1 - s.x0 >= s.name.length * charW + pad);
}

/** The ready questions for the coach in the large view, fitted to what is on the chart. */
export function readyQuestions(opts: { view: string; over: string[]; lap?: string; target: boolean; whole: boolean }): string[] {
  const out: string[] = [];
  const part = opts.lap ? `${opts.lap}` : opts.whole ? 'this activity' : 'this part';
  if (opts.target) out.push(opts.lap ? `Did I hold the target in ${opts.lap}?` : 'How well did I hold the targets?');
  if (opts.over.length) out.push(`What do ${opts.view.toLowerCase()} and ${opts.over[0].toLowerCase()} say together in ${part}?`);
  out.push(`What stands out in my ${opts.view.toLowerCase()} in ${part}?`);
  if (out.length < 3) out.push('Is anything here worth acting on?');
  return out.slice(0, 3);
}
