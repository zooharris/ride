import type { PlannedWorkout, Workout } from '../engine/types';
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

/** The choice when the rider hasn't made one: the plan's weekday, else the ride's own setting. */
export function defaultWhere(entry: Pick<PlannedWorkout, 'date' | 'planId'> | undefined, w: Pick<Workout, 'setting'>, plans: PlanDays[]): Where {
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
