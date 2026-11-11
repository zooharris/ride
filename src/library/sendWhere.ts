import type { Basis, PlannedWorkout, Workout } from '../engine/types';
import { outdoorVersion, tagsOf } from './tags';

/**
 * Outdoors or on a trainer, chosen when a ride goes to the Garmin (10 Nov 2026 brief, Part B). A ride the Library
 * rates "adjusted for outdoors" has two versions for the Garmin: the outdoor one (quick back-and-forth targets become
 * steady efforts, single-number targets get a range) and the ride as written. Which one goes is the rider's choice,
 * per calendar entry; until they choose, the plan's setting for that weekday decides, and with no plan the ride's own
 * setting. Rides rated "rides well outdoors" have one version, and "indoors only" rides keep their own rule.
 */

export type Where = 'outdoor' | 'trainer';

/** The little a plan has to say here: its dates, and which weekdays it marks as outdoor days (0 = Sunday). */
export interface PlanDays { id: string; start: string; goalDate: string; availability: { outdoor: boolean[] } }

/** Whether this ride has two versions for the Garmin, so the choice means anything. */
export const hasTwoVersions = (w: Workout | undefined): boolean => !!w && w.kind === 'ride' && !w.trainerOnly && tagsOf(w).outdoor === 'adjustable';

const weekday = (date: string) => new Date(date + 'T00:00:00').getDay();

/**
 * The choice when the rider hasn't made one: a workout the rider built goes as written (10 Nov 2026 review, B3: the app
 * doesn't rewrite someone's own workout unless they ask); otherwise the plan's weekday, else the ride's own setting.
 */
export function defaultWhere(entry: Pick<PlannedWorkout, 'date' | 'planId'> | undefined, w: Pick<Workout, 'setting' | 'source'>, plans: PlanDays[]): Where {
  if (w.source === 'mine') return 'trainer';
  if (entry) {
    const plan = (entry.planId && plans.find((p) => p.id === entry.planId)) || plans.find((p) => p.start <= entry.date && entry.date <= p.goalDate);
    const out = plan?.availability?.outdoor?.[weekday(entry.date)];
    if (plan && out != null) return out ? 'outdoor' : 'trainer';
  }
  return w.setting === 'indoor' ? 'trainer' : 'outdoor';
}

/** Where this entry will be ridden: the rider's choice, else the default. */
export function whereFor(entry: Pick<PlannedWorkout, 'date' | 'planId' | 'where'> | undefined, w: Workout, plans: PlanDays[]): Where {
  return entry?.where ?? defaultWhere(entry, w, plans);
}

/** The version of the ride that goes to the Garmin for this choice: softened outdoors, as written on a trainer. */
export function versionFor(w: Workout, where: Where): { workout: Workout; note?: string } {
  return where === 'outdoor' ? outdoorVersion(w) : { workout: w };
}

/**
 * How a ride goes to the Garmin is chosen when it is sent (10 Nov 2026 evening brief): targets (power or heart rate)
 * and, for a ride with two versions, the outdoor version or as written. Nothing about it is set on the calendar.
 */
export interface SendChoice { basis: Basis; where?: Where }

/** The targets a ride can take, given the rider's preference: theirs when the ride works that way, else the one it has. */
export const basisFor = (w: Pick<Workout, 'bases'>, preferred: Basis): Basis => (w.bases.includes(preferred) ? preferred : w.bases[0]);

/** What the main Send button sends: the rider's default targets, and the plan's version for that day. */
export function sendDefault(entry: Pick<PlannedWorkout, 'date' | 'planId'>, w: Workout, preferred: Basis, plans: PlanDays[]): SendChoice {
  return { basis: basisFor(w, preferred), where: hasTwoVersions(w) ? defaultWhere(entry, w, plans) : undefined };
}

/**
 * What the Garmin has for a sent entry. An entry sent before these records were kept falls back to its own setting and
 * to what its page would then have shown.
 */
export function onGarmin(entry: PlannedWorkout, w: Workout, plans: PlanDays[]): SendChoice {
  return { basis: entry.sentBasis ?? entry.basis, where: hasTwoVersions(w) ? (entry.sentWhere ?? whereFor(entry, w, plans)) : undefined };
}

/** "by power", "by heart rate, outdoor version", "by power, as written": the words every send uses. */
export function sendWords(c: SendChoice): string {
  const by = c.basis === 'hr' ? 'by heart rate' : 'by power';
  return c.where ? `${by}, ${c.where === 'outdoor' ? 'outdoor version' : 'as written'}` : by;
}
