import type { Wellness } from './types';

export type ReadinessInput = 'HRV' | 'Sleep' | 'Resting HR' | 'Sleeping HR' | 'Breathing rate';

export interface Readiness {
  score: number;            // 0..100
  band: 'go' | 'ease' | 'easy' | 'rest';
  drivers: ReadinessDriver[];
  /**
   * The overnight inputs the rider normally has (a four-week normal exists) that have no value
   * this morning: not yet arrived, or set aside by the rider. An input the rider's devices never
   * send has no normal and is not listed, so a rider without HRV is never told HRV is missing.
   */
  missing: ReadinessInput[];
  /** True when none of the rider's overnight inputs is in today's score: it rests on form alone. */
  formOnly: boolean;
}

/**
 * One input to the score. `value` is the panel's "today vs normal" text; `today`, `normal`,
 * `unit` and `days` (how many baseline mornings the normal rests on) let the coach be told
 * the same thing in words it cannot misread. Form has no normal and no unit. `note` carries
 * anything extra the coach should hear (two low mornings running, a fast climb in load).
 */
export interface ReadinessDriver {
  name: string;
  value: string;
  effect: 'up' | 'down' | 'flat';
  today?: string;
  normal?: string;
  unit?: string;
  days?: number;
  /** The driver's own 0–100 score (absent for the load line, which subtracts from the total instead). */
  score?: number;
  note?: string;
}

/** Days of normal the score compares against, and the fewest that make a normal. */
export const BASELINE_DAYS = 28;
export const MIN_BASELINE = 7;

/** The bands: a morning at the rider's normal scores about 70, which is Ready. */
export function bandOf(score: number): Readiness['band'] {
  return score >= 65 ? 'go' : score >= 50 ? 'ease' : score >= 35 ? 'easy' : 'rest';
}
const BANDS: Readiness['band'][] = ['go', 'ease', 'easy', 'rest'];
const stepDown = (b: Readiness['band']): Readiness['band'] => BANDS[Math.min(3, BANDS.indexOf(b) + 1)];

/** What else the score can use: yesterday's morning (for two low days running) and how fast training load is climbing. */
export interface ReadinessExtra {
  yesterday?: Wellness;
  /** The normal yesterday's morning is judged against (the 28 days before it). */
  yesterdayBaseline?: Wellness[];
  /** Average daily load over the last 7 days divided by the average over the last 28. */
  loadRatio?: number;
}

type Key = 'hrv' | 'sleepSeconds' | 'sleepScore' | 'restingHr' | 'avgSleepingHr' | 'respiration';

interface Spec {
  key: Key;
  better: 'higher' | 'lower';
  /** The smallest spread the normal is given, so a very steady rider is not flagged by tiny moves: a share of the mean, or an absolute value. */
  floor: (mean: number) => number;
}
const SPEC: Record<Key, Spec> = {
  hrv: { key: 'hrv', better: 'higher', floor: (m) => m * 0.04 },
  sleepSeconds: { key: 'sleepSeconds', better: 'higher', floor: (m) => m * 0.06 },
  sleepScore: { key: 'sleepScore', better: 'higher', floor: (m) => m * 0.06 },
  restingHr: { key: 'restingHr', better: 'lower', floor: () => 1.5 },
  avgSleepingHr: { key: 'avgSleepingHr', better: 'lower', floor: (m) => m * 0.04 },
  respiration: { key: 'respiration', better: 'lower', floor: () => 0.8 },
};

interface Normal { mean: number; sd: number; days: number }

function normalOf(baseline: Wellness[], key: Key): Normal | undefined {
  const v = baseline.map((w) => w[key]).filter((x): x is number => typeof x === 'number' && x > 0);
  if (v.length < MIN_BASELINE) return undefined;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  return { mean, sd: Math.max(sd, SPEC[key].floor(mean)), days: v.length };
}

/** How far today sits from normal, in spreads, signed so that positive is better. */
function zOf(today: number, n: Normal, key: Key): number {
  const z = (today - n.mean) / n.sd;
  return SPEC[key].better === 'higher' ? z : -z;
}

const scoreOfZ = (z: number) => clamp(70 + 12 * z, 0, 100);
const effectOf = (z: number): ReadinessDriver['effect'] => (z >= 0.75 ? 'up' : z <= -0.75 ? 'down' : 'flat');

/** Form scores 70 across an ordinary training state (TSB −10 to +5), rising when fresh, falling as fatigue deepens. */
export function formScore(tsb: number): number {
  if (tsb > 5) return clamp(70 + (tsb - 5) * 3, 0, 100);
  if (tsb < -10) return clamp(70 + (tsb + 10) * 2, 0, 100);
  return 70;
}

/** One input's score for a morning, or undefined when it has no value or no normal. */
function inputScore(w: Wellness | undefined, baseline: Wellness[], key: Key): number | undefined {
  const v = w?.[key];
  const n = normalOf(baseline, key);
  if (typeof v !== 'number' || v <= 0 || !n) return undefined;
  return scoreOfZ(zOf(v, n, key));
}

/**
 * Daily readiness: each overnight number against the rider's own four-week
 * normal range (its average and its usual spread), plus form. A number at its
 * normal scores 70; one spread worse about 58; two about 46. HRV 35%, sleep 25%
 * (length, blended with the sleep score when there is one), resting heart rate
 * 10% (20% without sleeping heart rate), sleeping heart rate 10%, breathing rate
 * 5%, form 15%, renormalised over whichever are present. Two low mornings in a
 * row on HRV or breathing rate count extra; a breathing rate two spreads high
 * moves the band down a step; a fast climb in training load takes 5 off.
 */
export function readiness(todayW: Wellness | undefined, baseline: Wellness[], tsb: number, extra: ReadinessExtra = {}): Readiness {
  const drivers: ReadinessDriver[] = [];
  const missing: ReadinessInput[] = [];
  const parts: Array<{ score: number; weight: number }> = [];
  const yScore = (key: Key) => (extra.yesterday && extra.yesterdayBaseline ? inputScore(extra.yesterday, extra.yesterdayBaseline, key) : undefined);
  let forceDown = false;

  const one = (name: ReadinessInput, key: Key, show: (v: number) => string, unit: string, twoDay: boolean): { score: number; z: number } | undefined => {
    const n = normalOf(baseline, key);
    const v = todayW?.[key];
    if (n && !(typeof v === 'number' && v > 0)) missing.push(name);
    if (!n || typeof v !== 'number' || v <= 0) return undefined;
    const z = zOf(v, n, key);
    let score = scoreOfZ(z);
    let note: string | undefined;
    if (twoDay && score < 60) {
      const y = yScore(key);
      if (y != null && y < 60) { score = clamp(score - 6, 0, 100); note = 'below normal two mornings running'; }
    }
    drivers.push({ name, value: `${show(v)}${unit} vs ${show(n.mean)}`, effect: effectOf(z), today: show(v), normal: show(n.mean), unit, days: n.days, score: Math.round(score), note });
    return { score, z };
  };

  const hrv = one('HRV', 'hrv', (v) => `${Math.round(v)}`, ' ms', true);
  if (hrv) parts.push({ score: hrv.score, weight: 0.35 });

  const sleep = one('Sleep', 'sleepSeconds', hm, '', false);
  if (sleep) {
    // The sleep score, when the watch gives one, is blended in: a long night that was broken is not a good night.
    const q = inputScore(todayW, baseline, 'sleepScore');
    const d = drivers[drivers.length - 1];
    if (q != null) {
      d.score = Math.round(sleep.score * 0.6 + q * 0.4);
      d.value += ` · sleep score ${Math.round(todayW!.sleepScore!)}`;
      d.note = `sleep score ${Math.round(todayW!.sleepScore!)} against a normal of ${Math.round(normalOf(baseline, 'sleepScore')!.mean)}`;
    }
    parts.push({ score: d.score!, weight: 0.25 });
  }

  const sleepingHr = (() => {
    // Measured only on the rider's normal: present today or with a normal to be missing from.
    const r = one('Sleeping HR', 'avgSleepingHr', (v) => `${Math.round(v)}`, ' bpm', false);
    return r;
  })();
  const rhr = one('Resting HR', 'restingHr', (v) => `${Math.round(v)}`, ' bpm', false);
  if (rhr) parts.push({ score: rhr.score, weight: sleepingHr ? 0.1 : 0.2 });
  if (sleepingHr) parts.push({ score: sleepingHr.score, weight: 0.1 });

  const rr = one('Breathing rate', 'respiration', (v) => v.toFixed(1), ' breaths/min', true);
  if (rr) {
    parts.push({ score: rr.score, weight: 0.05 });
    if (rr.z <= -2) { forceDown = true; drivers[drivers.length - 1].note = 'well above normal: often the first sign of illness'; }
  }

  // Keep the panel's order: HRV, sleep, resting HR, sleeping HR, breathing rate.
  const ORDER: string[] = ['HRV', 'Sleep', 'Resting HR', 'Sleeping HR', 'Breathing rate'];
  drivers.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  missing.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  const fs = formScore(tsb);
  parts.push({ score: fs, weight: 0.15 });
  drivers.push({ name: 'Form', value: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}`, effect: tsb > 5 ? 'up' : tsb < -20 ? 'down' : 'flat', today: `${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}`, score: Math.round(fs) });

  const weight = parts.reduce((a, p) => a + p.weight, 0);
  let final = parts.reduce((a, p) => a + p.score * p.weight, 0) / weight;
  const formOnly = parts.length === 1 && missing.length > 0;
  const overnight = parts.length > 1;
  if (overnight && extra.loadRatio != null && extra.loadRatio > 1.3) {
    final -= 5;
    drivers.push({ name: 'Load climbing fast', value: `last 7 days ${extra.loadRatio.toFixed(1)}× your 4-week average`, effect: 'down', note: 'training load over the last week is well above the last four weeks' });
  }
  final = Math.round(clamp(final, 0, 100));
  let band = bandOf(final);
  if (forceDown) band = stepDown(band);
  return { score: final, band, drivers, missing, formOnly };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 60 ? `${h + 1}h00` : `${h}h${String(m).padStart(2, '0')}`;
}
