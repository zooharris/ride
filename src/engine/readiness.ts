import type { Wellness } from './types';

export interface Readiness {
  score: number;            // 0..100
  band: 'go' | 'ease' | 'easy' | 'rest';
  drivers: ReadinessDriver[];
  /**
   * The overnight inputs the rider normally has (a two-week normal exists) that have no value
   * this morning: not yet arrived, or set aside by the rider. An input the rider's devices never
   * send has no normal and is not listed, so a rider without HRV is never told HRV is missing.
   */
  missing: Array<'HRV' | 'Sleep' | 'Resting HR'>;
  /** True when none of the rider's overnight inputs is in today's score: it rests on form alone. */
  formOnly: boolean;
}

/**
 * One input to the score. `value` is the panel's "today vs normal" text; `today`, `normal`,
 * `unit` and `days` (how many baseline mornings the normal rests on) let the coach be told
 * the same thing in words it cannot misread. Form has no normal and no unit.
 */
export interface ReadinessDriver {
  name: string;
  value: string;
  effect: 'up' | 'down' | 'flat';
  today?: string;
  normal?: string;
  unit?: string;
  days?: number;
}

/**
 * Daily readiness from HRV, sleep, resting HR and form. Each driver is compared
 * with its own recent baseline, so the score is about you versus your normal, not
 * versus a textbook. HRV 40%, sleep 30%, resting HR 15%, form 15%.
 */
export function readiness(todayW: Wellness | undefined, baseline: Wellness[], tsb: number): Readiness {
  const drivers: ReadinessDriver[] = [];
  const missing: Readiness['missing'] = [];
  const count = (k: 'hrv' | 'sleepSeconds' | 'restingHr') => baseline.filter((w) => typeof w[k] === 'number' && (w[k] as number) > 0).length;
  let score = 0;
  let weight = 0;

  const hrvBase = mean(baseline.map((w) => w.hrv));
  if (hrvBase && !todayW?.hrv) missing.push('HRV');
  if (todayW?.hrv && hrvBase) {
    const ratio = todayW.hrv / hrvBase;
    const s = clamp(50 + (ratio - 1) * 250, 0, 100);
    score += s * 0.4; weight += 0.4;
    drivers.push({ name: 'HRV', value: `${Math.round(todayW.hrv)} ms vs ${Math.round(hrvBase)}`, effect: ratio > 1.03 ? 'up' : ratio < 0.93 ? 'down' : 'flat', today: `${Math.round(todayW.hrv)}`, normal: `${Math.round(hrvBase)}`, unit: ' ms', days: count('hrv') });
  }

  const sleepBase = mean(baseline.map((w) => w.sleepSeconds));
  if (sleepBase && !todayW?.sleepSeconds) missing.push('Sleep');
  if (todayW?.sleepSeconds && sleepBase) {
    const ratio = todayW.sleepSeconds / sleepBase;
    const s = clamp(50 + (ratio - 1) * 200, 0, 100);
    score += s * 0.3; weight += 0.3;
    drivers.push({ name: 'Sleep', value: `${hm(todayW.sleepSeconds)} vs ${hm(sleepBase)}`, effect: ratio > 1.05 ? 'up' : ratio < 0.9 ? 'down' : 'flat', today: hm(todayW.sleepSeconds), normal: hm(sleepBase), unit: '', days: count('sleepSeconds') });
  }

  const rhrBase = mean(baseline.map((w) => w.restingHr));
  if (rhrBase && !todayW?.restingHr) missing.push('Resting HR');
  if (todayW?.restingHr && rhrBase) {
    const delta = todayW.restingHr - rhrBase;
    const s = clamp(50 - delta * 8, 0, 100);
    score += s * 0.15; weight += 0.15;
    drivers.push({ name: 'Resting HR', value: `${todayW.restingHr} vs ${Math.round(rhrBase)}`, effect: delta < -1.5 ? 'up' : delta > 2.5 ? 'down' : 'flat', today: `${todayW.restingHr}`, normal: `${Math.round(rhrBase)}`, unit: ' bpm', days: count('restingHr') });
  }

  // Form: TSB around -10 to +5 is a normal training state; below -25 drags readiness down.
  const formScore = clamp(50 + (tsb + 10) * 2, 0, 100);
  score += formScore * 0.15; weight += 0.15;
  drivers.push({ name: 'Form', value: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}`, effect: tsb > 5 ? 'up' : tsb < -20 ? 'down' : 'flat', today: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}` });

  const final = weight ? Math.round(score / weight) : 50;
  const band = final >= 75 ? 'go' : final >= 55 ? 'ease' : final >= 35 ? 'easy' : 'rest';
  // Form alone, but only worth saying when overnight numbers were expected: a rider with no
  // overnight data at all keeps the plain form-based score, as before.
  const formOnly = drivers.length === 1 && missing.length > 0;
  return { score: final, band, drivers, missing, formOnly };
}

function mean(xs: Array<number | undefined>): number | undefined {
  const v = xs.filter((x): x is number => typeof x === 'number' && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}
