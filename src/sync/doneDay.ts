import { today } from '../engine/load';
import type { PlannedWorkout } from '../engine/types';

/**
 * A done session sits on the day its recording was made (13 Nov 2026): whatever
 * is done today is recorded as done today. When a recording is matched to a
 * session planned for another day, the session takes the recording's date and
 * keeps the date it was planned for in `plannedFor` (never `movedFrom`, which
 * holds the rider's own move and must survive).
 *
 * Returns the fields to change, empty when the dates already agree. `dropEvent`
 * says the copy on the rider's device should come off Intervals.icu: the session
 * was sent and its planned day is today or later, so the watch must not offer a
 * session already done. A planned day in the past needs no call.
 */
export function toDoneDay(p: Pick<PlannedWorkout, 'date' | 'plannedFor' | 'icuEventId'>, recordedOn: string): { patch: Partial<PlannedWorkout>; dropEvent?: number } {
  if (!recordedOn || recordedOn === p.date) return { patch: {} };
  const plannedFor = p.plannedFor ?? p.date;
  // Back on its planned day after all (an earlier move, then a match there): nothing left to remember.
  const patch: Partial<PlannedWorkout> = { date: recordedOn, plannedFor: recordedOn === plannedFor ? undefined : plannedFor };
  if (p.icuEventId && plannedFor >= today()) return { patch: { ...patch, icuEventId: undefined, sentWhere: undefined, sentBasis: undefined, sentBreath: undefined }, dropEvent: p.icuEventId };
  return { patch };
}

/**
 * The one way a session gives up its recording (13 Nov 2026), shared by "This
 * was a different workout", the automatic undo and the Garmin-twin release:
 * back to the day it was planned for, then missed if that day has passed,
 * otherwise to do (sent only if its copy is still on the device).
 */
export function backToPlannedDay(p: Pick<PlannedWorkout, 'date' | 'plannedFor' | 'icuEventId'>): Partial<PlannedWorkout> {
  const date = p.plannedFor ?? p.date;
  return {
    date,
    plannedFor: undefined,
    status: date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned',
    activityId: undefined,
    done: undefined,
    rpe: undefined,
    matchedByHand: undefined,
  };
}
