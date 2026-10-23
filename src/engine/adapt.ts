import type { Fitness, PlannedWorkout, Ride, Workout } from './types';
import type { Plan, PlannedSession } from './planner';
import { scoreRide } from './compliance';
import { addDays, today } from './load';
import { hm } from './assessment';
import { sameWithin } from './snap';

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
  /** Training load of activities last week that were not on the calendar (Batch 6, C2: a big one is a cause to show later changes). */
  unplannedTss?: number;
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
  /** What a named Library workout is ("Long Endurance 3:00" for "Purcellville"), shown beside the name. */
  beforeSub?: string;
  afterSub?: string;
  /** A move (note 'moved', Batch 6 C1): the date the session leaves. `date` is where it goes. */
  movedFrom?: string;
  /** The other date-and-kind slots a move touches (the date it leaves, and mobility attached to it), accepted with it. */
  alsoKeys?: string[];
}
export const changeKey = (c: { date: string; kind: string }) => `${c.date}|${c.kind}`;
/** Every date-and-kind slot a change touches, for accepting it: one for most, several for a move. */
export const changeKeys = (c: Change) => [changeKey(c), ...(c.alsoKeys ?? [])];

export interface Replan {
  review: WeekReview;
  plan: Plan;
  changes: Change[];
  summary: string[];      // why the new plan differs
  /** Changes more than two weeks out, held back from Today because nothing has happened to justify them yet (Batch 6, C2). */
  later?: Change[];
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
  const unplannedTss = unplanned.reduce((s, r) => s + (r.tss ?? 0), 0);
  if (unplanned.length) lines.push(`${unplanned.length} unplanned ${unplanned.length === 1 ? 'activity' : 'activities'} added ${unplannedTss} TSS.`);
  if (!lines.length && past.length) lines.push('Everything planned was done, close to plan.');
  return { from, to: addDays(date, -1), planned: past.length, completed: completed.length, missed: missed.length, lines, unplannedTss };
}

/**
 * Whether a regenerated session is, for the rider, the same session: the same
 * workout, the same name, or the same kind of session (a ride of the same
 * family; a walk in the same band with the same pack; the same run or routine)
 * within 12% (rides) or 15% (others) in length and load, with floors of 10
 * minutes and 8 TSS (Batch 6, B4; was 10 min/10% and 5 TSS, which let a
 * 47 → 54 minute endurance ride through as a change). With library-first plans
 * this is also what lets the calendar's older generated rides ("Long Endurance
 * 3:00") match the named Library ride the plan now picks ("Purcellville").
 */
export function sameSession(before: Workout, after: Workout, wide = false): boolean {
  return sameWithin(before, after, wide);
}

/** Beyond this many days the re-check allows 15 minutes / 15% before calling a session changed (Batch 6, C4). */
export const NEAR_DAYS = 14;

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
  const removedW = new Map<string, Workout[]>(), addedW = new Map<string, Workout[]>();
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of [...keys].sort()) {
    if (doneKeys.has(k)) continue;
    const [date, kind] = k.split('|');
    const b = before.get(k) ?? [];
    const a = after.get(k) ?? [];
    const bNames = b.map((w) => w.name);
    const aNames = a.map((s) => s.workout.name);
    if (bNames.join(',') === aNames.join(',')) continue;
    const wide = date >= addDays(from, NEAR_DAYS);
    if (b.length === a.length && b.every((w, i) => sameSession(w, a[i].workout, wide))) continue;   // a few minutes either way is not a change
    const userEdited = edited.has(k) || undefined;
    const userAdded = added.has(k) || undefined;
    if (userEdited && !opts.includeEdited) continue;
    const beforeSub = b.map((w) => w.subtitle).filter(Boolean).join(', ') || undefined;
    const afterSub = a.map((x) => x.workout.subtitle).filter(Boolean).join(', ') || undefined;
    if (!b.length) changes.push({ date, kind, after: aNames.join(', '), afterSub, note: 'added', userEdited, userAdded });
    else if (!a.length) changes.push({ date, kind, before: bNames.join(', '), beforeSub, note: 'removed', userEdited, userAdded });
    else changes.push({ date, kind, before: bNames.join(', '), beforeSub, after: aNames.join(', '), afterSub, note: 'changed', userEdited, userAdded });
    removedW.set(k, b); addedW.set(k, a.map((x) => x.workout));
  }
  return pairMoves(changes, removedW, addedW, plan);
}

/**
 * Batch 6, C1: a session the regenerated plan puts on another day of the same
 * plan week is one change, a move, not a removal here and an addition there
 * (the long ride from Saturday to Sunday was three rows on 22 Oct, mobility
 * included). The same session is the same workout or the same session by the
 * re-check's rule. Mobility removed on the day the session leaves and added on
 * the day it arrives goes with it, folded into the move. Accepting the move
 * accepts every slot it touches.
 */
function pairMoves(changes: Change[], removedW: Map<string, Workout[]>, addedW: Map<string, Workout[]>, plan: Plan): Change[] {
  const weekOf = (date: string) => plan.weeks.find((w) => date >= w.start && date < addDays(w.start, 7))?.start;
  const out = [...changes];
  const gone = new Set<Change>();
  for (const r of changes) {
    if (r.note !== 'removed' || r.userEdited || gone.has(r) || r.kind === 'mobility') continue;
    const rw = removedW.get(changeKey(r));
    if (!rw || rw.length !== 1) continue;
    const wk = weekOf(r.date);
    const a = changes.find((c) => c.note === 'added' && !c.userEdited && !gone.has(c) && c.kind === r.kind && c.date !== r.date && wk && weekOf(c.date) === wk
      && (addedW.get(changeKey(c)) ?? []).length === 1 && sameSession(rw[0], addedW.get(changeKey(c))![0]));
    if (!a) continue;
    gone.add(r); gone.add(a);
    const also = [changeKey(r)];
    // Mobility that goes with it: removed on the day it leaves, added on the day it arrives.
    const mobOut = changes.find((c) => c.kind === 'mobility' && c.note === 'removed' && c.date === r.date && !c.userEdited && !gone.has(c));
    const mobIn = changes.find((c) => c.kind === 'mobility' && c.note === 'added' && c.date === a.date && !c.userEdited && !gone.has(c));
    if (mobOut && mobIn) { gone.add(mobOut); gone.add(mobIn); also.push(changeKey(mobOut), changeKey(mobIn)); }
    out.push({ date: a.date, kind: a.kind, before: r.before, beforeSub: r.beforeSub, after: a.after, afterSub: a.afterSub, note: 'moved', movedFrom: r.date, alsoKeys: also });
  }
  return out.filter((c) => !gone.has(c)).sort((x, y) => x.date.localeCompare(y.date) || x.kind.localeCompare(y.kind));
}

const DAY_NAME = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
/** A change's names and what they are: the long-ride and quality checks read "Purcellville · Long Endurance 3:00", not the place alone. */
const said = (c: Change) => `${c.before ?? ''} ${c.beforeSub ?? ''} > ${c.after ?? ''} ${c.afterSub ?? ''}`;
const QUALITY = /Sweet Spot|Threshold|VO2max|Tempo|Anaerobic|Test/;

/**
 * Why the re-check suggests what it does, in sentences. `calendarLongest` is the
 * longest ride on the calendar from today, in seconds, so the long-ride line
 * says "now 3h" only when the longest ride actually changes (22 Oct: it said so
 * when the long ride had only moved a day).
 */
export function summarize(review: WeekReview, changes: Change[], plan: Plan, fitnessNow: number, fitnessPlanned: number | undefined, projection: Fitness[] | undefined, calendarLongest?: number): string[] {
  const out: string[] = [];
  if (fitnessPlanned != null) {
    const gap = Math.round(fitnessNow - fitnessPlanned);
    out.push(gap <= -3 ? `Fitness is ${-gap} points under the line the plan expected today, so the new plan restarts the ramp from where you actually are rather than piling on to catch up.`
      : gap >= 3 ? `Fitness is ${gap} points ahead of the plan's line, so the targets edge up and the long ride grows a little sooner.`
      : 'Fitness is on the plan’s line.');
  }
  if (review.missed) out.push(`${review.missed} missed session${review.missed > 1 ? 's' : ''} last week ${review.missed > 1 ? 'are' : 'is'} not stacked onto this week; the load target reflects what was actually done.`);
  const rideChanges = changes.filter((c) => c.kind === 'ride');
  for (const m of rideChanges.filter((c) => c.note === 'moved')) {
    const long = /Long/.test(said(m));
    out.push(`${long ? 'The long ride' : m.after} moves from ${DAY_NAME(m.movedFrom!)} to ${DAY_NAME(m.date)}.`);
  }
  const resized = rideChanges.filter((c) => c.note !== 'moved' && /Long/.test(said(c)));
  const longestChanged = calendarLongest == null || Math.abs(calendarLongest - plan.longestPlanned) >= 5 * 60;
  if (resized.length && longestChanged) out.push(`${resized.length} long ride${resized.length > 1 ? 's' : ''} re-sized; the longest planned is now ${hm(plan.longestPlanned)}.`);
  else if (resized.length) out.push(`${resized.length} long ride${resized.length > 1 ? 's' : ''} changed; the longest planned stays ${hm(plan.longestPlanned)}.`);
  const qualityChanged = rideChanges.filter((c) => c.note !== 'moved' && QUALITY.test(said(c)));
  if (qualityChanged.length) out.push(`${qualityChanged.length} quality session${qualityChanged.length > 1 ? 's' : ''} changed to match where the block now stands.`);
  if (!changes.length) out.push('No changes: the plan on the calendar still fits.');
  if (projection) out.push(plan.verdict === 'on-track' ? 'Still on track for the goal.' : plan.verdict === 'close' ? 'Close to the goal; worth protecting the key sessions.' : plan.verdict === 'short' ? 'Projected short of the goal; see the plan page for the smallest fix.' : '');
  return out.filter(Boolean);
}

/**
 * Batch 6, C2: what Today shows. Changes in the next two weeks always; later
 * ones only when something has happened that justifies them now (fitness three
 * or more points off the plan's line, a missed session, or a big unplanned one
 * last week). Otherwise they wait: the plan re-checks itself every day, and a
 * change two months out is reviewed again many times before it matters.
 */
export function splitByHorizon(changes: Change[], review: WeekReview, fitnessNow: number, fitnessPlanned: number | undefined, from = today()): { now: Change[]; later: Change[] } {
  const cause = (fitnessPlanned != null && Math.abs(fitnessNow - fitnessPlanned) >= 3) || review.missed > 0 || (review.unplannedTss ?? 0) >= 120;
  if (cause) return { now: changes, later: [] };
  const edge = addDays(from, NEAR_DAYS);
  return { now: changes.filter((c) => c.date < edge), later: changes.filter((c) => c.date >= edge) };
}
