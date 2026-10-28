/**
 * The numbers on the riding screen's totals strip and the Ride complete
 * screen, worked out from the recording itself (no waiting for Intervals.icu).
 * Pure, so they are tested.
 */
import { hrTss, powerTss } from '../engine/load';
import type { Ladders } from '../engine/zones';
import type { Sample } from './types';
import type { TimelineStep } from './timeline';

export interface Totals {
  /** Seconds of riding: one sample per second ridden. */
  seconds: number;
  avgPower?: number;
  maxPower?: number;
  np?: number;
  /** Training load, from power when there is power, else from heart rate. */
  tss: number;
  intensity?: number;
  kj?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  distanceM: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Normalized power: the fourth-power mean of 30-second rolling averages. Short rides fall back to the average. */
export function normalizedPower(watts: number[]): number | undefined {
  if (!watts.length) return undefined;
  if (watts.length < 30) return mean(watts);
  let sum = 0;
  for (let i = 0; i < 30; i++) sum += watts[i];
  let acc = 0, n = 0;
  for (let i = 29; i < watts.length; i++) {
    if (i > 29) sum += watts[i] - watts[i - 30];
    acc += Math.pow(sum / 30, 4);
    n++;
  }
  return Math.pow(acc / n, 0.25);
}

/**
 * The ride's totals. Training load comes from power when there is power,
 * else from heart rate; a ride by heart rate (`basis` 'hr') takes it from
 * heart rate whenever there is heart rate, since that is what it was ridden to.
 */
export function totals(samples: Sample[], ftp: number, lthr: number, ladders?: Ladders, basis: 'power' | 'hr' = 'power'): Totals {
  const watts = samples.map((s) => s.w ?? 0);
  const hasPower = samples.some((s) => s.w != null);
  const hrs = samples.map((s) => s.hr).filter((x): x is number => x != null && x > 0);
  const cads = samples.map((s) => s.cad).filter((x): x is number => x != null && x > 0);
  const seconds = samples.length;
  const np = hasPower ? normalizedPower(watts) : undefined;
  const avgHr = mean(hrs);
  const tss = basis === 'hr' && avgHr ? hrTss(seconds, avgHr, lthr, ladders) : np ? powerTss(seconds, np, ftp) : avgHr ? hrTss(seconds, avgHr, lthr, ladders) : 0;
  const last = [...samples].reverse().find((s) => s.d != null);
  return {
    seconds,
    avgPower: hasPower ? Math.round(mean(watts)!) : undefined,
    maxPower: hasPower ? Math.max(...watts) : undefined,
    np: np != null ? Math.round(np) : undefined,
    tss,
    intensity: np && ftp ? np / ftp : undefined,
    kj: hasPower ? Math.round(watts.reduce((a, b) => a + b, 0) / 1000) : undefined,
    avgHr: avgHr != null ? Math.round(avgHr) : undefined,
    maxHr: hrs.length ? Math.max(...hrs) : undefined,
    avgCadence: cads.length ? Math.round(mean(cads)!) : undefined,
    distanceM: last?.d ?? 0,
  };
}

export interface StepStats {
  step: TimelineStep;
  seconds: number;
  avgPower?: number;
  avgHr?: number;
  maxHr?: number;
  /** Share of the step's seconds inside its band (0..1): power on a power ride, heart rate on a heart-rate ride. */
  onTarget?: number;
}

/** Each step ridden: its averages and how much of it was on target. `band(step)` gives the step's band, in watts (by 'power') or bpm (by 'hr'). */
export function stepStats(samples: Sample[], tl: TimelineStep[], band: (s: TimelineStep) => { low: number; high: number }, by: 'power' | 'hr' = 'power'): StepStats[] {
  return tl.map((step) => {
    const xs = samples.filter((s) => s.s === step.index);
    if (!xs.length) return { step, seconds: 0 };
    const w = xs.map((s) => s.w).filter((x): x is number => x != null);
    const h = xs.map((s) => s.hr).filter((x): x is number => x != null && x > 0);
    const b = band(step);
    return {
      step,
      seconds: xs.length,
      avgPower: w.length ? Math.round(mean(w)!) : undefined,
      avgHr: h.length ? Math.round(mean(h)!) : undefined,
      maxHr: h.length ? Math.max(...h) : undefined,
      onTarget: by === 'hr'
        ? (h.length ? h.filter((x) => x >= b.low && x <= b.high).length / h.length : undefined)
        : (w.length ? w.filter((x) => x >= b.low && x <= b.high).length / w.length : undefined),
    };
  });
}

/**
 * One plain sentence about the ride, from its own numbers, or nothing: how
 * heart rate moved across equal work steps at the same power (cardiac drift).
 * Needs at least two finished work steps of the same target and length.
 */
export function observation(stats: StepStats[]): string | undefined {
  const done = stats.filter((s) => s.step.work && s.avgHr && s.seconds >= s.step.seconds * 0.9);
  if (done.length < 2) return undefined;
  const key = (s: StepStats) => `${s.step.low}-${s.step.high}-${Math.round(s.step.seconds / 30)}`;
  const groups = new Map<string, StepStats[]>();
  for (const s of done) groups.set(key(s), [...(groups.get(key(s)) ?? []), s]);
  const best = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!best) return undefined;
  const first = best[0].avgHr!, last = best[best.length - 1].avgHr!;
  const diff = last - first;
  const pct = (diff / first) * 100;
  const n = best.length === 2 ? 'two' : best.length === 3 ? 'three' : String(best.length);
  if (Math.abs(diff) <= 2) return `Heart rate held steady across the ${n} efforts at the same power: a well-paced, comfortable session for you today.`;
  if (diff < 0) return `Heart rate fell ${-diff} bpm from the first effort to the last at the same power: you warmed into it.`;
  const verdict = pct < 5 ? 'A small drift, normal for efforts like these.' : pct < 10 ? 'Normal for efforts this long, and worth watching on the next one.' : 'More than usual: heat, fatigue or too little fuel are the common causes.';
  return `Heart rate rose ${diff} bpm from the first effort to the last at the same power (about ${Math.round(pct)}%). ${verdict}`;
}

/**
 * The steps the summary tables as efforts. By power, the hard ones. By heart
 * rate, also the long steady blocks (five minutes or more, zone 2 and up),
 * since a ride by heart rate is mostly those; never the warm-up, cool-down or
 * recoveries.
 */
export function isEffort(step: TimelineStep, by: 'power' | 'hr'): boolean {
  if (step.work) return true;
  return by === 'hr' && step.seconds >= 300 && !step.noFloor && step.intensity >= 0.6 && !/warm|cool|recover|easy|spin/i.test(step.name);
}

/**
 * Time in the target zone on a ride by heart rate: seconds whose heart rate
 * sat inside its step's band, and their share of the seconds ridden in steps.
 */
export function timeInZone(samples: Sample[], tl: TimelineStep[], band: (s: TimelineStep) => { low: number; high: number }): { seconds: number; share?: number } {
  const bands = new Map(tl.map((s) => [s.index, band(s)]));
  let inside = 0, counted = 0;
  for (const x of samples) {
    if (x.s == null || x.hr == null || x.hr <= 0) continue;
    const b = bands.get(x.s);
    if (!b) continue;
    counted++;
    if (x.hr >= b.low && x.hr <= b.high) inside++;
  }
  return { seconds: inside, share: counted ? inside / counted : undefined };
}

/**
 * On a ride by heart rate: how power moved across equal work steps held at
 * the same heart rate. Less power for the same heart rate later on is the
 * same drift as on a power ride, seen from the other side.
 */
export function observationHr(stats: StepStats[]): string | undefined {
  const done = stats.filter((s) => isEffort(s.step, 'hr') && s.avgPower && s.seconds >= s.step.seconds * 0.9);
  if (done.length < 2) return undefined;
  const key = (s: StepStats) => `${s.step.low}-${s.step.high}-${Math.round(s.step.seconds / 30)}`;
  const groups = new Map<string, StepStats[]>();
  for (const s of done) groups.set(key(s), [...(groups.get(key(s)) ?? []), s]);
  const best = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!best) return undefined;
  const first = best[0].avgPower!, last = best[best.length - 1].avgPower!;
  const diff = last - first;
  const pct = Math.abs(diff / first) * 100;
  const n = best.length === 2 ? 'two' : best.length === 3 ? 'three' : String(best.length);
  if (Math.abs(diff) <= 3) return `Power held steady across the ${n} efforts in the same heart-rate zone: a well-paced, comfortable session for you today.`;
  if (diff > 0) return `Power rose ${diff} W from the first effort to the last in the same heart-rate zone: you warmed into it.`;
  const verdict = pct < 5 ? 'A small drift, normal for efforts like these.' : pct < 10 ? 'Normal for efforts this long, and worth watching on the next one.' : 'More than usual: heat, fatigue or too little fuel are the common causes.';
  return `Power fell ${-diff} W from the first effort to the last in the same heart-rate zone (about ${Math.round(pct)}%). ${verdict}`;
}
