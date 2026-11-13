/**
 * Words for exported workouts (12 Nov 2026, export at any time): a step's notes, the steps a test leaves free, and
 * strength and mobility sessions as a readable document, since no workout format carries exercises.
 */
import type { Exercise, Workout, WorkoutStep } from '../engine/types';

/**
 * A fitness test's effort is ridden as hard as the rider can hold, not to a target: the 20-minute FTP test's "Test"
 * and the threshold heart-rate test's. A file leaves it free ("open"), because a trainer holding a set wattage
 * would spoil the test.
 */
export function isOpenEffort(w: Pick<Workout, 'family'>, s: Pick<WorkoutStep, 'label'>): boolean {
  return w.family === 'test' && /^test\b/i.test(s.label ?? '');
}

/** Whether a ride has a step a file must leave free. */
export const hasOpenEffort = (w: Workout): boolean => w.blocks.some((b) => (b.kind === 'step' ? isOpenEffort(w, b) : b.steps.some((s) => isOpenEffort(w, s))));

/** A step's in-ride cues as one line of notes, in order. */
export function stepNoteText(s: WorkoutStep): string | undefined {
  const lines = (s.cues ?? []).filter((c) => c.rep == null || c.rep === 1).map((c) => c.text.trim()).filter(Boolean);
  return lines.length ? [...new Set(lines)].join(' ') : undefined;
}

/** One exercise's prescription: "3 sets of 8–10, leave 2 reps in reserve", "hold 45 s, 2 rounds". */
export function exerciseLine(e: Exercise): string {
  const parts: string[] = [];
  if (e.holdSeconds) parts.push(`hold ${e.holdSeconds} s${e.reps ? ` (${e.reps})` : ''}${e.sets && e.sets > 1 ? `, ${e.sets} rounds` : ''}`);
  else if (e.sets || e.reps) parts.push(`${e.sets ? `${e.sets} ${e.sets === 1 ? 'set' : 'sets'}` : ''}${e.sets && e.reps ? ' of ' : ''}${e.reps ?? ''}`.trim());
  if (e.load) parts.push(e.load);
  return parts.join(', ');
}

/**
 * A strength or mobility session as plain text that reads well when opened on a phone: its name, what it is for,
 * then each exercise in order with sets, reps, load or hold, and how to do it.
 */
export function sessionDocument(w: Workout, opts: { date?: string } = {}): string {
  const kind = w.kind === 'mobility' ? 'Mobility session' : w.kind === 'strength' ? 'Strength session' : 'Session';
  const head = [w.name, `${kind}${w.minutes ? `, about ${w.minutes} minutes` : ''}${opts.date ? `, planned for ${opts.date}` : ''}`, ''];
  if (w.purpose) head.push(w.purpose, '');
  const body = (w.exercises ?? []).flatMap((e, i) => {
    const how = exerciseLine(e);
    return [`${i + 1}. ${e.name}${how ? `: ${how}` : ''}`, ...(e.cue ? [`   How: ${e.cue}`] : []), ...(e.why ? [`   Why: ${e.why}`] : []), ''];
  });
  return [...head, ...body, 'From Antogo.', ''].join('\n');
}
