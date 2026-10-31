import type { Profile, Workout, WorkoutStep } from './types';
import { flattenStepsWithSets } from './workout';
import { powerToHrFraction, rideLadders } from './zones';

/**
 * Planned-versus-actual analysis of a ride from its streams. Each step of the
 * plan gets a window of the ride: the lap the computer recorded for it when the
 * laps line up with the steps (31 Oct), otherwise the plan laid along elapsed
 * time from the start. Each step is compared with what was ridden in its window.
 */
export interface StepResult {
  index: number;
  label: string;
  startSec: number;
  endSec: number;
  targetLow: number;      // watts or bpm
  targetHigh: number;
  actual?: number;        // average over the window
  actualHr?: number;
  hit: boolean;           // within the target band, with a 3% allowance
  work: boolean;          // a work step (not warm-up, recovery or cool-down)
  /** Which round of a repeat the step is in ("Hard effort 2 of 3"); none outside a repeat. */
  set?: { rep: number; times: number };
}

/** A lap of the recording, in the stream's seconds; `step` when the player recorded which step it was. */
export interface RideLap { start: number; end: number; step?: number }
/** How the steps were placed on the ride: by its laps, or along the clock from the start. */
export type Alignment = 'laps' | 'clock';

/**
 * The window of the ride each planned step occupies. Laps are used when they
 * line up with the steps one for one: a lap per step, or one more lap at the
 * end (riding on after the workout finished) that is short or leaves the
 * rest of the laps within 15% of the plan's length. Laps that overlap (efforts
 * Intervals.icu found, not laps pressed) or don't match fall back to the clock.
 * Player laps carry their step, which is used directly.
 */
export function stepWindows(seconds: number[], laps?: RideLap[]): { windows: Array<{ start: number; end: number }>; by: Alignment } {
  const clock = () => { let t = 0; return seconds.map((s) => ({ start: t, end: (t += s) })); };
  const clean = (laps ?? []).filter((l) => l.end > l.start).sort((a, b) => a.start - b.start);
  const n = seconds.length;
  if (!n || !clean.length) return { windows: clock(), by: 'clock' };
  if (clean.some((l) => l.step != null)) {
    let prev = clean[0].start;
    const covered = seconds.map((_, i) => {
      const mine = clean.filter((l) => l.step === i);
      if (!mine.length) return { start: prev, end: prev };   // a step skipped in the player: no time of its own
      const w = { start: Math.min(...mine.map((l) => l.start)), end: Math.max(...mine.map((l) => l.end)) };
      prev = w.end;
      return w;
    });
    if (covered.filter((w) => w.end > w.start).length >= n / 2) return { windows: covered, by: 'laps' };
    return { windows: clock(), by: 'clock' };
  }
  for (let i = 1; i < clean.length; i++) if (clean[i].start < clean[i - 1].end - 2) return { windows: clock(), by: 'clock' };
  const planned = seconds.reduce((a, b) => a + b, 0);
  const span = clean[clean.length - 1].end - clean[0].start;
  let use: RideLap[] | undefined;
  if (clean.length === n) use = clean;
  else if (clean.length === n + 1) {
    const last = clean[n];
    const first = clean.slice(0, n);
    const firstSpan = first[n - 1].end - first[0].start;
    if (last.end - last.start < span * 0.1 || Math.abs(firstSpan - planned) <= planned * 0.15) use = first;
  }
  if (!use) return { windows: clock(), by: 'clock' };
  return { windows: use.map((l) => ({ start: l.start, end: l.end })), by: 'laps' };
}

export interface Analysis {
  basis: 'power' | 'hr';
  steps: StepResult[];
  workSteps: number;
  workHit: number;
  summary: string;
  aligned: Alignment;
}

export function analyseRide(workout: Workout, profile: Profile, basis: 'power' | 'hr', time: number[], watts?: number[], hr?: number[], laps?: RideLap[]): Analysis {
  const withSets = flattenStepsWithSets(workout.blocks);
  const steps = withSets.map((x) => x.step);
  const { windows, by } = stepWindows(steps.map((s) => s.seconds), laps);
  const series = basis === 'power' ? watts : hr;
  const n = Math.min(time.length, series?.length ?? 0);
  const results: StepResult[] = [];
  let idx = 0;
  const isWork = (s: WorkoutStep) => s.intensity >= 0.75 && !/warm|cool|easy|recovery|between/i.test(s.label ?? '');
  for (const [k, s] of steps.entries()) {
    const { start: startSec, end: endSec } = windows[k];
    const ladder = rideLadders(profile);
    const lo = basis === 'power' ? s.intensity * profile.ftp : powerToHrFraction(s.intensity, ladder.hr, ladder.power) * profile.lthr;
    const hi = basis === 'power' ? (s.intensityHigh ?? s.intensity) * profile.ftp : powerToHrFraction(s.intensityHigh ?? s.intensity, ladder.hr, ladder.power) * profile.lthr;
    // average over the window
    let sum = 0, count = 0, hsum = 0, hcount = 0;
    if (series && n) {
      if (idx >= n) idx = n - 1;
      while (idx > 0 && time[idx] > startSec) idx--;
      for (let i = idx; i < n && time[i] < endSec; i++) {
        if (time[i] < startSec) continue;
        const v = series[i];
        if (typeof v === 'number' && v > 0) { sum += v; count++; }
        const h = hr?.[i];
        if (typeof h === 'number' && h > 0) { hsum += h; hcount++; }
      }
    }
    const actual = count ? sum / count : undefined;
    const actualHr = hcount ? hsum / hcount : undefined;
    const band = Math.max(hi - lo, (hi + lo) / 2 * 0.06);
    const centre = (hi + lo) / 2;
    const hit = actual != null && Math.abs(actual - centre) <= band / 2 + centre * 0.03;
    results.push({ index: results.length, label: s.label ?? stepName(s), startSec, endSec, targetLow: Math.round(lo), targetHigh: Math.round(hi), actual: actual != null ? Math.round(actual) : undefined, actualHr: actualHr != null ? Math.round(actualHr) : undefined, hit, work: isWork(s), ...(withSets[k].set ? { set: { rep: withSets[k].set!.rep, times: withSets[k].set!.times } } : {}) });
  }
  const work = results.filter((r) => r.work && r.actual != null);
  const hitCount = work.filter((r) => r.hit).length;
  const under = work.filter((r) => !r.hit && (r.actual ?? 0) < r.targetLow).length;
  const over = work.filter((r) => !r.hit && (r.actual ?? 0) > r.targetHigh).length;
  const unit = basis === 'power' ? 'W' : 'bpm';
  const summary = !work.length ? 'No work intervals to compare, or the recording has no data for them.'
    : hitCount === work.length ? `All ${work.length} work intervals on target.`
    : `${hitCount} of ${work.length} work intervals on target${under ? `, ${under} under` : ''}${over ? `, ${over} over` : ''}. Targets in ${unit}; an interval counts as on target within about 3% of its band.`;
  return { basis, steps: results, workSteps: work.length, workHit: hitCount, summary, aligned: by };
}

/** The step of a planned ride that a moment of it (seconds) falls in, if any. */
export function stepAt(a: Analysis | undefined, sec: number): StepResult | undefined {
  return a?.steps.find((s) => sec >= s.startSec && sec < s.endSec);
}

/** "in target", "under" or "over", the words of the Intervals-against-plan table. */
export function verdictWord(s: StepResult): string | undefined {
  if (s.actual == null) return undefined;
  return s.hit ? 'in target' : s.actual < s.targetLow ? 'under' : 'over';
}

/** The readout line for a planned step under the cursor (31 Oct): "Hard effort 2 of 3 · target 300 to 320 W · you rode 318 W, in target". */
export function stepReadout(s: StepResult, unit: 'W' | 'bpm'): string {
  const name = `${s.label}${s.set && s.work ? ` ${s.set.rep} of ${s.set.times}` : ''}`;
  const target = s.targetLow === s.targetHigh ? `target ${s.targetLow} ${unit}` : `target ${s.targetLow} to ${s.targetHigh} ${unit}`;
  const v = verdictWord(s);
  return [name, target, v ? `${unit === 'W' ? 'you rode' : 'you averaged'} ${s.actual} ${unit}, ${v}` : ''].filter(Boolean).join(' · ');
}

function stepName(s: WorkoutStep): string {
  const i = s.intensityHigh ? (s.intensity + s.intensityHigh) / 2 : s.intensity;
  return i < 0.55 ? 'Easy' : i < 0.75 ? 'Zone 2' : i < 0.9 ? 'Tempo / sweet spot' : i < 1.05 ? 'Threshold' : 'Hard';
}

/** Downsample a stream to about `points` values by averaging, for drawing. */
export function downsample(time: number[], values: number[], points = 360): Array<{ t: number; v: number }> {
  const n = Math.min(time.length, values.length);
  if (n === 0) return [];
  const span = time[n - 1] || 1;
  const bucket = span / points;
  const out: Array<{ t: number; v: number }> = [];
  let b = 0, sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(time[i] / bucket);
    if (k !== b) { if (count) out.push({ t: (b + 0.5) * bucket, v: sum / count }); b = k; sum = 0; count = 0; }
    const v = values[i];
    if (typeof v === 'number' && v >= 0) { sum += v; count++; }
  }
  if (count) out.push({ t: (b + 0.5) * bucket, v: sum / count });
  return out;
}
