import type { Profile, RunSpec, RunStep, Workout } from './types';
import { FOOT_BANDS, bandWords, footBand, hasNoFloor, recoveryBand, stepBand, type FootBandKey } from './foot';

type FootProfile = Pick<Profile, 'lthr' | 'maxHr'> & Partial<Profile>;

/**
 * Runs: steps on time with a heart-rate band named by zone on the rider's foot
 * table, the way walks are. Pace is only ever a hint, and only when the rider has set a
 * threshold pace. Everything that counts a run's minutes or describes its steps
 * goes through here, so the builder, the calendar, the coach and the Garmin
 * text agree.
 */

/** The bands a run step can use, as the builder offers them: zones on the foot table (see foot.ts). */
export const RUN_BANDS = FOOT_BANDS;
export type RunBandKey = FootBandKey;
export const band = footBand;

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

/** Time in words: "8 min", "20 s", "1 min 30 s". */
export function timeWords(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
}
/** One step in words: "3 × 8 min at upper zone 3 to threshold (142–158 bpm) (tempo), 3 min easy between". */
export function stepWords(s: RunStep, profile?: FootProfile): string {
  const n = Math.max(1, s.repeat ?? 1);
  const main = `${n > 1 ? `${n} × ` : ''}${timeWords(s.seconds)} at ${bandWords(stepBand(s, profile), profile)}${s.label ? ` (${s.label})` : ''}`;
  const rec = n > 1 && s.recoverSeconds ? `, ${timeWords(s.recoverSeconds)} ${hasNoFloor(recoveryBand(s, profile)) ? 'walking' : 'easy'} between` : '';
  return main + rec;
}
/** The whole run in one line, for the coach and lists. */
export function runStepsLine(w: Pick<Workout, 'run'>, profile?: FootProfile): string {
  return (w.run?.steps ?? []).map((s) => stepWords(s, profile)).join('; ');
}
/**
 * The run's working band, for a list row: "zone 2" for an easy run, "upper
 * zone 3 to threshold" for a tempo run (its hardest step, not the warm-up).
 */
export function runBandText(w: Pick<Workout, 'run'>, profile?: FootProfile): string {
  const steps = (w.run?.steps ?? []).map((s) => stepBand(s, profile)).filter((b) => !hasNoFloor(b));
  const b = steps.length ? steps.reduce((a, x) => (x.zoneHigh > a.zoneHigh ? x : a)) : (w.run?.steps?.[0] && stepBand(w.run.steps[0], profile));
  return b ? bandWords(b, profile) : 'by heart rate';
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
