import type { RunSpec, RunStep, Workout } from './types';

/**
 * Runs: steps on time with a heart-rate band as a share of max heart rate, the
 * way walks are. Pace is only ever a hint, and only when the rider has set a
 * threshold pace. Everything that counts a run's minutes or describes its steps
 * goes through here, so the builder, the calendar, the coach and the Garmin
 * text agree.
 */

/** The bands a run step can use, as the builder offers them. */
export const RUN_BANDS = [
  { key: 'easy', label: 'Easy', low: 0.65, high: 0.75, paceFrom: 60, paceTo: 90 },
  { key: 'steady', label: 'Steady', low: 0.75, high: 0.85, paceFrom: 30, paceTo: 60 },
  { key: 'tempo', label: 'Tempo', low: 0.85, high: 0.9, paceFrom: 10, paceTo: 25 },
  { key: 'hard', label: 'Hard', low: 0.88, high: 0.95, paceFrom: -15, paceTo: -5 },
  { key: 'walk', label: 'Walk', low: 0, high: 0.7, paceFrom: undefined, paceTo: undefined },
] as const;
export type RunBandKey = typeof RUN_BANDS[number]['key'];

/** The band a step's heart-rate range is closest to (for the builder's select). */
export function bandOf(low: number, high: number): RunBandKey {
  let best: RunBandKey = 'easy', d = Infinity;
  for (const b of RUN_BANDS) { const e = Math.abs(b.low - low) + Math.abs(b.high - high); if (e < d) { d = e; best = b.key; } }
  return best;
}
export function band(key: RunBandKey) { return RUN_BANDS.find((b) => b.key === key)!; }

/** A step's total seconds: its work times its repeats, plus a recovery between repeats. */
export function stepSeconds(s: RunStep): number {
  const n = Math.max(1, s.repeat ?? 1);
  return s.seconds * n + (n > 1 ? (s.recoverSeconds ?? 0) * (n - 1) : 0);
}
export function runSeconds(spec: RunSpec | undefined): number {
  return (spec?.steps ?? []).reduce((t, s) => t + stepSeconds(s), 0);
}
/** Whole minutes of a run, as stored on the workout. */
export function runMinutes(spec: RunSpec | undefined): number {
  return Math.round(runSeconds(spec) / 60);
}

const pct = (f: number) => Math.round(f * 100);
/** "65–75% of max HR", or "up to 70% of max HR" for a walk band. */
export function hrBandWords(low: number, high: number): string {
  return low > 0 ? `${pct(low)}–${pct(high)}% of max HR` : `up to ${pct(high)}% of max HR`;
}
/** Time in words: "8 min", "20 s", "1 min 30 s". */
export function timeWords(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
}
/** One step in words: "3 × 8 min at 85–90% of max HR, 3 min easy between". */
export function stepWords(s: RunStep): string {
  const n = Math.max(1, s.repeat ?? 1);
  const main = `${n > 1 ? `${n} × ` : ''}${timeWords(s.seconds)} at ${hrBandWords(s.hrLow, s.hrHigh)}${s.label ? ` (${s.label})` : ''}`;
  const rec = n > 1 && s.recoverSeconds ? `, ${timeWords(s.recoverSeconds)} ${s.recoverLow === 0 ? 'walking' : 'easy'} between` : '';
  return main + rec;
}
/** The whole run in one line, for the coach and lists. */
export function runStepsLine(w: Pick<Workout, 'run'>): string {
  return (w.run?.steps ?? []).map(stepWords).join('; ');
}
/**
 * The run's working band, for a list row: "65–75% of max HR" for an easy run,
 * "85–90% of max HR" for a tempo run (its hardest step, not the warm-up).
 */
export function runBandText(w: Pick<Workout, 'run'>): string {
  const steps = (w.run?.steps ?? []).filter((x) => x.hrLow > 0);
  const s = steps.length ? steps.reduce((a, b) => (b.hrHigh > a.hrHigh ? b : a)) : w.run?.steps?.[0];
  return s ? hrBandWords(s.hrLow, s.hrHigh) : 'by heart rate';
}

/** "9:40–10:10 per mile": the pace a band implies from a threshold pace (sec/km), as a hint only. */
export function paceHint(bandKey: RunBandKey, thresholdPaceSec: number | undefined, imperial: boolean): string | undefined {
  const b = band(bandKey);
  if (!thresholdPaceSec || b.paceFrom == null || b.paceTo == null) return undefined;
  const per = imperial ? 1.609344 : 1;
  const a = (thresholdPaceSec + b.paceFrom) * per, z = (thresholdPaceSec + b.paceTo) * per;
  return `${mmss(Math.min(a, z))}–${mmss(Math.max(a, z))} per ${imperial ? 'mile' : 'km'}`;
}
/** Seconds per km from "m:ss" (per mile when imperial); undefined when blank or unreadable. */
export function parsePace(text: string, imperial: boolean): number | undefined {
  const m = text.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return undefined;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return Math.round(imperial ? sec / 1.609344 : sec);
}
export function formatPace(secPerKm: number | undefined, imperial: boolean): string {
  if (!secPerKm) return '';
  return mmss(imperial ? secPerKm * 1.609344 : secPerKm);
}
/** m:ss, rounded to the whole second first so it never reads 7:60. */
function mmss(sec: number): string { const t = Math.round(sec); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
