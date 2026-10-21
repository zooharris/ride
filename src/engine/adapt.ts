import type { Fitness, PlannedWorkout, Ride, Workout } from './types';
import type { Plan, PlannedSession } from './planner';
import { scoreRide } from './compliance';
import { addDays, today } from './load';
import { hm } from './assessment';
import { workoutStats } from './workout';

/**
 * Adaptation is the planner run again from today, plus an honest account of
 * what changed and why. There is no separate rulebook: the evidence that moved
 * the new plan is the evidence the assessment already carries.
 */
export interface WeekReview {
  from: string;
  to: string;
  planned: number;
  completed: number;
  missed: number;
  lines: string[];        // what happened, in sentences
}

export interface Change {
  date: string;
  kind: string;
  before?: string;        // session name before
  after?: string;         // session name after
  note: string;
  /** The rider edited what is on this date and kind (or moved something away from it), or put it there by hand; offered, not pre-selected. */
  userEdited?: boolean;
  /** The session on this date and kind was added by hand, not by the plan. */
  userAdded?: boolean;
}
export const changeKey = (c: { date: string; kind: string }) => `${c.date}|${c.kind}`;

export interface Replan {
  review: WeekReview;
  plan: Plan;
  changes: Change[];
  summary: string[];      // why the new plan differs
  fitnessNow: number;
  fitnessPlanned?: number;   // what the applied plan expected today
}

export function reviewLastWeek(planned: PlannedWorkout[], workouts: Map<string, Workout>, rides: Ride[], date = today()): WeekReview {
  const from = addDays(date, -7);
  const past = planned.filter((p) => p.date >= from && p.date < date);
  const completed = past.filter((p) => p.status === 'completed');
  const missed = past.filter((p) => p.status === 'missed' || (p.status !== 'completed' && p.date < date));
  const lines: string[] = [];
  for (const p of completed) {
    const w = workouts.get(p.workoutId);
    if (!w || w.kind !== 'ride') continue;
    const r = rides.find((x) => x.id === p.activityId);
    if (!r) continue;
    const c = scoreRide(w, r);
    if (c.verdict === 'overcooked') lines.push(`${w.name} came in much harder than planned (${Math.round(c.loadRatio * 100)}% of the intended load).`);
    else if (c.verdict === 'partial') lines.push(`${w.name} was cut short (${Math.round(c.durationRatio * 100)}% of the planned time).`);
  }
  for (const p of missed) {
    const w = workouts.get(p.workoutId);
    if (w) lines.push(`${w.name} on ${new Date(p.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })} was missed.`);
  }
  const unplanned = rides.filter((r) => r.date >= from && r.date < date && !planned.some((p) => p.activityId === r.id));
  if (unplanned.length) lines.push(`${unplanned.length} unplanned ${unplanned.length === 1 ? 'activity' : 'activities'} added ${unplanned.reduce((s, r) => s + (r.tss ?? 0), 0)} TSS.`);
  if (!lines.length && past.length) lines.push('Everything planned was done, close to plan.');
  return { from, to: addDays(date, -1), planned: past.length, completed: completed.length, missed: missed.length, lines };
}

/** A ride's name without its length ("Long Endurance 2:23" -> "Long Endurance"). */
const baseName = (n: string) => n.replace(/\s+\d+(:\d\d)?\s*(min)?$/i, '').trim();

function size(w: Workout): { minutes: number; tss: number } {
  if (w.kind === 'ride' && w.blocks?.length) { const s = workoutStats(w.blocks); return { minutes: s.seconds / 60, tss: s.tss }; }
  return { minutes: w.walk?.minutes ?? w.minutes ?? 0, tss: w.estimatedTss ?? 0 };
}

/**
 * Whether a regenerated session is, for the rider, the same session: the same
 * ride (same name apart from its length, same family) changed by less than
 * 10 minutes and 10% in length and by less than 5 TSS and 10% in load. The
 * re-check rebuilds the plan from each morning's data, which moves rides by a
 * few minutes; offering those as changes is noise. Strength, mobility and walks
 * count as changed whenever the session itself differs (their names say which).
 */
export function sameSession(before: Workout, after: Workout): boolean {
  if (before.name === after.name) return true;
  if (before.kind !== 'ride' || after.kind !== 'ride') return false;
  if (before.family !== after.family || baseName(before.name) !== baseName(after.name)) return false;
  const b = size(before), a = size(after);
  const dMin = Math.abs(a.minutes - b.minutes), dTss = Math.abs(a.tss - b.tss);
  return dMin < Math.max(10, b.minutes * 0.1) && dTss < Math.max(5, b.tss * 0.1);
}

/** Compare the current calendar (from today) with a freshly generated plan. Only changes that matter are listed. */
/**
 * What the plan would change on the calendar. A session the rider moved, replaced
 * or added by hand is their decision for that date and kind: the daily re-check
 * never suggests undoing it (a rider who moved two sessions to today was offered
 * "remove" for both, one tap below the move, and lost them, 21 Oct 2026). Only
 * Edit plan › Preview lists those changes, unticked, with `includeEdited`.
 */
export function diffPlan(current: PlannedWorkout[], workouts: Map<string, Workout>, plan: Plan, from = today(), opts: { includeEdited?: boolean } = {}): Change[] {
  const future = current.filter((p) => p.date >= from && p.status !== 'completed');
  const key = (date: string, kind: string) => `${date}|${kind}`;
  const before = new Map<string, Workout[]>();
  for (const p of future) {
    const w = workouts.get(p.workoutId);
    if (!w) continue;
    const k = key(p.date, w.kind);
    before.set(k, [...(before.get(k) ?? []), w]);
  }
  const after = new Map<string, PlannedSession[]>();
  for (const w of plan.weeks) for (const s of w.sessions) {
    if (s.date < from) continue;
    const k = key(s.date, s.kind);
    after.set(k, [...(after.get(k) ?? []), s]);
  }
  // The calendar is the plan: a session the rider placed by hand counts as their
  // decision for that date and kind, the same as one they edited.
  const edited = new Set<string>();
  const added = new Set<string>();
  for (const p of future) {
    const w = workouts.get(p.workoutId);
    if (!w) continue;
    if (p.userEdited) edited.add(key(p.date, w.kind));
    if (p.movedFrom) edited.add(key(p.movedFrom, w.kind));
    if (!p.planId) { edited.add(key(p.date, w.kind)); added.add(key(p.date, w.kind)); }
  }
  // A date and kind already done is history: never suggested again.
  const doneKeys = new Set(current.filter((p) => p.date >= from && p.status === 'completed').map((p) => { const w = workouts.get(p.workoutId); return w ? key(p.date, w.kind) : ''; }));
  const changes: Change[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of [...keys].sort()) {
    if (doneKeys.has(k)) continue;
    const [date, kind] = k.split('|');
    const b = before.get(k) ?? [];
    const a = after.get(k) ?? [];
    const bNames = b.map((w) => w.name);
    const aNames = a.map((s) => s.workout.name);
    if (bNames.join(',') === aNames.join(',')) continue;
    if (b.length === a.length && b.every((w, i) => sameSession(w, a[i].workout))) continue;   // a few minutes either way is not a change
    const userEdited = edited.has(k) || undefined;
    const userAdded = added.has(k) || undefined;
    if (userEdited && !opts.includeEdited) continue;
    if (!b.length) changes.push({ date, kind, after: aNames.join(', '), note: 'added', userEdited, userAdded });
    else if (!a.length) changes.push({ date, kind, before: bNames.join(', '), note: 'removed', userEdited, userAdded });
    else changes.push({ date, kind, before: bNames.join(', '), after: aNames.join(', '), note: 'changed', userEdited, userAdded });
  }
  return changes;
}

export function summarize(review: WeekReview, changes: Change[], plan: Plan, fitnessNow: number, fitnessPlanned: number | undefined, projection: Fitness[] | undefined): string[] {
  const out: string[] = [];
  if (fitnessPlanned != null) {
    const gap = Math.round(fitnessNow - fitnessPlanned);
    out.push(gap <= -3 ? `Fitness is ${-gap} points under the line the plan expected today, so the new plan restarts the ramp from where you actually are rather than piling on to catch up.`
      : gap >= 3 ? `Fitness is ${gap} points ahead of the plan's line, so the targets edge up and the long ride grows a little sooner.`
      : 'Fitness is on the plan’s line.');
  }
  if (review.missed) out.push(`${review.missed} missed session${review.missed > 1 ? 's' : ''} last week ${review.missed > 1 ? 'are' : 'is'} not stacked onto this week; the load target reflects what was actually done.`);
  const rideChanges = changes.filter((c) => c.kind === 'ride');
  const longs = rideChanges.filter((c) => (c.before ?? '').startsWith('Long') || (c.after ?? '').startsWith('Long'));
  if (longs.length) out.push(`${longs.length} long ride${longs.length > 1 ? 's' : ''} re-sized; the longest planned is now ${hm(plan.longestPlanned)}.`);
  const qualityChanged = rideChanges.filter((c) => /Sweet Spot|Threshold|VO2max|Tempo|Anaerobic|Test/.test(c.before ?? '') || /Sweet Spot|Threshold|VO2max|Tempo|Anaerobic|Test/.test(c.after ?? ''));
  if (qualityChanged.length) out.push(`${qualityChanged.length} quality session${qualityChanged.length > 1 ? 's' : ''} changed to match where the block now stands.`);
  if (!changes.length) out.push('No changes: the plan on the calendar still fits.');
  if (projection) out.push(plan.verdict === 'on-track' ? 'Still on track for the goal.' : plan.verdict === 'close' ? 'Close to the goal; worth protecting the key sessions.' : plan.verdict === 'short' ? 'Projected short of the goal; see the plan page for the smallest fix.' : '');
  return out.filter(Boolean);
}
