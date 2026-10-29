import type { DoneExercise, DoneRecord, PlannedWorkout, Workout } from './types';
import { loggedTss } from './sessions';
import { EXERCISES } from '../library/strength';
import { MOBILITY } from '../library/mobility';

/**
 * The record of what was done in a strength, mobility or walk session. It is a
 * snapshot taken when the session becomes done (matched to a recording, or
 * logged by hand), copied from the plan and assumed done as planned until the
 * rider corrects it. A snapshot, not a pointer: ready-made sessions are rebuilt
 * from the rider's current equipment, so history must not follow them.
 */

/** The library id for an exercise or stretch name, when there is one. */
export function exerciseIdFor(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  return EXERCISES.find((e) => e.name.toLowerCase() === n)?.id ?? MOBILITY.find((m) => m.name.toLowerCase() === n)?.id;
}

export function buildDoneRecord(w: Pick<Workout, 'kind' | 'exercises' | 'walk' | 'minutes'>, loggedMinutes?: number): DoneRecord | undefined {
  if (w.kind === 'walk') {
    const minutes = loggedMinutes ?? w.walk?.minutes ?? w.minutes ?? 30;
    return { walk: { minutes, packKg: w.walk?.packKg } };
  }
  if (w.kind === 'strength' || w.kind === 'mobility') {
    return {
      exercises: (w.exercises ?? []).map((e): DoneExercise => ({
        name: e.name,
        exerciseId: exerciseIdFor(e.name),
        sets: e.sets,
        reps: e.reps,
        holdSeconds: e.holdSeconds,
        cue: e.cue,
        why: e.why,
        equipment: e.equipment,
      })),
    };
  }
  return undefined;
}

export const unitOf = (units: 'imperial' | 'metric' | undefined): 'lb' | 'kg' => (units === 'metric' ? 'kg' : 'lb');

/** "35 lb", with the unit the weight was entered in. */
export function weightText(e: Pick<DoneExercise, 'weight' | 'unit'>, fallback: 'lb' | 'kg' = 'lb'): string {
  if (e.weight == null) return '';
  const w = Math.round(e.weight * 10) / 10;
  return `${w} ${e.unit ?? fallback}`;
}

/** "3 × 10–12", "2 × 30 s", "30 s" */
export function setsText(e: Pick<DoneExercise, 'sets' | 'reps' | 'holdSeconds'>): string {
  // A hold reads in seconds; a stretch's "each side" goes after it ("60 s each side").
  const what = isHold(e) ? `${e.holdSeconds} s${e.reps ? ` ${e.reps}` : ''}` : e.reps ?? '';
  return e.sets && what ? `${e.sets} × ${what}` : e.sets ? `${e.sets} sets` : what;
}

/** A timed hold rather than counted reps: hold seconds set, and reps (if any) carry no number. */
export function isHold(e: Pick<DoneExercise, 'reps' | 'holdSeconds'>): boolean {
  return e.holdSeconds != null && (!e.reps || !/\d/.test(e.reps));
}

/** One line per exercise, the way the record reads on the page, in the coach's note and in Intervals.icu. */
export function exerciseLine(e: DoneExercise, unit: 'lb' | 'kg' = 'lb'): string {
  if (e.skipped) return `${e.name} · skipped`;
  return [e.name, setsText(e), weightText(e, unit)].filter(Boolean).join(' · ');
}

/** The text written to the activity's description in Intervals.icu. Ends with the app's mark so it can be updated later. */
export const RECORD_MARK = '— AntoVelo';
/** The mark written before the rename (Oct 2026): descriptions ending in it are still the app's own. */
const OLD_RECORD_MARKS = ['— VeloIQ'];
export function recordText(workoutName: string, rec: DoneRecord, rpe: number | undefined, units: 'imperial' | 'metric' | undefined): string {
  const unit = unitOf(units);
  const lines = [`${workoutName} — what was done`];
  if (rec.walk) {
    const pack = rec.walk.packKg ? (unit === 'kg' ? ` with a ${Math.round(rec.walk.packKg)} kg pack` : ` with a ${Math.round(rec.walk.packKg * 2.2046)} lb pack`) : '';
    lines.push(`${rec.walk.minutes} min walk${pack}`);
  }
  for (const e of rec.exercises ?? []) lines.push(exerciseLine(e, unit));
  if (rpe) lines.push(`Effort ${rpe}/10`);
  lines.push(RECORD_MARK);
  return lines.join('\n');
}

/** Whether the app may write its record into an activity's description: only an empty one, or its own earlier text. */
export function mayWriteDescription(existing: string | undefined): boolean {
  const t = existing?.trim();
  return !t || [RECORD_MARK, ...OLD_RECORD_MARKS].some((m) => t.endsWith(m));
}

export interface LastTime { weight: number; unit: 'lb' | 'kg'; sets?: number; reps?: string; date: string }

/**
 * The most recent done record of an exercise (by library id, else by name)
 * with a weight, before a date. Skipped entries do not count.
 */
export function lastDone(name: string, planned: PlannedWorkout[], before?: string): LastTime | undefined {
  const id = exerciseIdFor(name);
  const n = name.trim().toLowerCase();
  let best: LastTime | undefined;
  for (const p of planned) {
    if (p.status !== 'completed' || !p.done?.exercises || (before && p.date >= before)) continue;
    if (best && p.date <= best.date) continue;
    const e = p.done.exercises.find((x) => !x.skipped && x.weight != null && ((id && x.exerciseId === id) || x.name.trim().toLowerCase() === n));
    if (e) best = { weight: e.weight!, unit: e.unit ?? 'lb', sets: e.sets, reps: e.reps, date: p.date };
  }
  return best;
}

/** Training load from the rider's effort rating, for strength: heart rate under-reads lifting. Undefined when it does not apply. */
export function recordTss(w: Pick<Workout, 'kind' | 'walk'>, seconds: number, rpe: number | undefined): number | undefined {
  if (!rpe || w.kind !== 'strength' || !seconds) return undefined;
  return loggedTss(w as Workout, seconds, rpe);
}
