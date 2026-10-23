import type { Profile, Workout, WorkoutStep } from './types';
import { flattenSteps } from './workout';
import { powerToHrFraction, rideLadders } from './zones';

/**
 * Planned-versus-actual analysis of a ride from its streams. The planned
 * workout is laid along elapsed time; each work step is compared with what
 * was ridden in its window.
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
}

export interface Analysis {
  basis: 'power' | 'hr';
  steps: StepResult[];
  workSteps: number;
  workHit: number;
  summary: string;
}

export function analyseRide(workout: Workout, profile: Profile, basis: 'power' | 'hr', time: number[], watts?: number[], hr?: number[]): Analysis {
  const steps = flattenSteps(workout.blocks);
  const series = basis === 'power' ? watts : hr;
  const n = Math.min(time.length, series?.length ?? 0);
  const results: StepResult[] = [];
  let t = 0;
  let idx = 0;
  const isWork = (s: WorkoutStep) => s.intensity >= 0.75 && !/warm|cool|easy|recovery|between/i.test(s.label ?? '');
  for (const s of steps) {
    const startSec = t;
    const endSec = t + s.seconds;
    t = endSec;
    const ladder = rideLadders(profile);
    const lo = basis === 'power' ? s.intensity * profile.ftp : powerToHrFraction(s.intensity, ladder.hr, ladder.power) * profile.lthr;
    const hi = basis === 'power' ? (s.intensityHigh ?? s.intensity) * profile.ftp : powerToHrFraction(s.intensityHigh ?? s.intensity, ladder.hr, ladder.power) * profile.lthr;
    // average over the window
    let sum = 0, count = 0, hsum = 0, hcount = 0;
    if (series && n) {
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
    results.push({ index: results.length, label: s.label ?? stepName(s), startSec, endSec, targetLow: Math.round(lo), targetHigh: Math.round(hi), actual: actual != null ? Math.round(actual) : undefined, actualHr: actualHr != null ? Math.round(actualHr) : undefined, hit, work: isWork(s) });
  }
  const work = results.filter((r) => r.work && r.actual != null);
  const hitCount = work.filter((r) => r.hit).length;
  const under = work.filter((r) => !r.hit && (r.actual ?? 0) < r.targetLow).length;
  const over = work.filter((r) => !r.hit && (r.actual ?? 0) > r.targetHigh).length;
  const unit = basis === 'power' ? 'W' : 'bpm';
  const summary = !work.length ? 'No work intervals to compare, or the recording has no data for them.'
    : hitCount === work.length ? `All ${work.length} work intervals on target.`
    : `${hitCount} of ${work.length} work intervals on target${under ? `, ${under} under` : ''}${over ? `, ${over} over` : ''}. Targets in ${unit}; an interval counts as on target within about 3% of its band.`;
  return { basis, steps: results, workSteps: work.length, workHit: hitCount, summary };
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
