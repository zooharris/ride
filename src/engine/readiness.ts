import type { Wellness } from './types';

export interface Readiness {
  score: number;            // 0..100
  band: 'go' | 'ease' | 'easy' | 'rest';
  drivers: Array<{ name: string; value: string; effect: 'up' | 'down' | 'flat' }>;
}

/**
 * Daily readiness from HRV, sleep, resting HR and form. Each driver is compared
 * with its own recent baseline, so the score is about you versus your normal, not
 * versus a textbook. HRV 40%, sleep 30%, resting HR 15%, form 15%.
 */
export function readiness(todayW: Wellness | undefined, baseline: Wellness[], tsb: number): Readiness {
  const drivers: Readiness['drivers'] = [];
  let score = 0;
  let weight = 0;

  const hrvBase = mean(baseline.map((w) => w.hrv));
  if (todayW?.hrv && hrvBase) {
    const ratio = todayW.hrv / hrvBase;
    const s = clamp(50 + (ratio - 1) * 250, 0, 100);
    score += s * 0.4; weight += 0.4;
    drivers.push({ name: 'HRV', value: `${Math.round(todayW.hrv)} ms vs ${Math.round(hrvBase)}`, effect: ratio > 1.03 ? 'up' : ratio < 0.93 ? 'down' : 'flat' });
  }

  const sleepBase = mean(baseline.map((w) => w.sleepSeconds));
  if (todayW?.sleepSeconds && sleepBase) {
    const ratio = todayW.sleepSeconds / sleepBase;
    const s = clamp(50 + (ratio - 1) * 200, 0, 100);
    score += s * 0.3; weight += 0.3;
    drivers.push({ name: 'Sleep', value: `${hm(todayW.sleepSeconds)} vs ${hm(sleepBase)}`, effect: ratio > 1.05 ? 'up' : ratio < 0.9 ? 'down' : 'flat' });
  }

  const rhrBase = mean(baseline.map((w) => w.restingHr));
  if (todayW?.restingHr && rhrBase) {
    const delta = todayW.restingHr - rhrBase;
    const s = clamp(50 - delta * 8, 0, 100);
    score += s * 0.15; weight += 0.15;
    drivers.push({ name: 'Resting HR', value: `${todayW.restingHr} vs ${Math.round(rhrBase)}`, effect: delta < -1.5 ? 'up' : delta > 2.5 ? 'down' : 'flat' });
  }

  // Form: TSB around -10 to +5 is a normal training state; below -25 drags readiness down.
  const formScore = clamp(50 + (tsb + 10) * 2, 0, 100);
  score += formScore * 0.15; weight += 0.15;
  drivers.push({ name: 'Form', value: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}`, effect: tsb > 5 ? 'up' : tsb < -20 ? 'down' : 'flat' });

  const final = weight ? Math.round(score / weight) : 50;
  const band = final >= 75 ? 'go' : final >= 55 ? 'ease' : final >= 35 ? 'easy' : 'rest';
  return { score: final, band, drivers };
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
