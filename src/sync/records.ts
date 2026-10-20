import { db } from '../data/db';
import { today } from '../engine/load';
import { recordTss } from '../engine/record';
import type { DoneRecord, PlannedWorkout, Workout } from '../engine/types';
import { deleteActivity } from './intervals';
import { credentials, writeRecord } from './syncService';

/**
 * What the screens do with the record of a done session. Each saves locally
 * first (it syncs to the rider's other devices with the calendar) and then, as
 * a best effort, updates the activity in Intervals.icu.
 */

/** Save the rider's corrected record. */
export async function saveRecord(p: PlannedWorkout, w: Workout, rec: DoneRecord): Promise<void> {
  const done: DoneRecord = { ...rec, editedAt: new Date().toISOString() };
  await db.planned.update(p.id, { done });
  await pushToActivity({ ...p, done }, w);
}

/** Save the effort rating (1–10). For strength it sets the session's training load. */
export async function saveEffort(p: PlannedWorkout, w: Workout, rpe: number, fallback: DoneRecord | undefined): Promise<void> {
  // Keep the record with it: a session done before records existed gets its snapshot now.
  const done = p.done ?? fallback;
  await db.planned.update(p.id, { rpe, done });
  const ride = p.activityId ? await db.rides.get(p.activityId) : undefined;
  if (ride) {
    const tss = recordTss(w, ride.seconds, rpe);
    if (tss != null && tss !== ride.tss) await db.rides.update(ride.id, { tss });
  }
  await pushToActivity({ ...p, rpe, done }, w);
}

async function pushToActivity(p: PlannedWorkout, w: Workout): Promise<void> {
  if (!p.activityId || !p.done) return;
  const ride = await db.rides.get(p.activityId);
  const c = await credentials();
  if (!ride || !c) return;
  const profile = await db.profile.get('me');
  await writeRecord(c, ride, w.name, p.done, p.rpe, profile?.units);
  await db.rides.update(ride.id, { description: ride.description });
}

/**
 * A session logged by hand turns out not to have been done: back to to-do
 * (missed if its day has passed), the record and effort cleared, and the
 * activity the app created in Intervals.icu for it deleted. The caller confirms.
 */
export async function undoHandLog(p: PlannedWorkout): Promise<{ deletedRemote: boolean }> {
  let deletedRemote = false;
  // Only the activity the app itself created is deleted; a real recording matched since stays.
  const own = p.manualActivityId;
  if (own) {
    const c = await credentials();
    if (c) { try { await deleteActivity(c, own); deletedRemote = true; } catch { /* it may already be gone */ } }
    await db.rides.delete(own);
  }
  await db.planned.update(p.id, {
    status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned',
    activityId: undefined,
    loggedSeconds: undefined,
    manualActivityId: undefined,
    rpe: undefined,
    done: undefined,
  });
  return { deletedRemote };
}

/**
 * Delete a recorded activity (an accidental recording, a duplicate): from
 * Intervals.icu first, then from this device with its cached recording. A
 * planned session it had completed goes back to to-do (missed if its day has
 * passed); one logged by hand is undone the same way. If Intervals.icu cannot
 * be reached nothing is deleted, since the activity would come back on the
 * next Sync. The caller confirms.
 */
export async function deleteRecording(rideId: string): Promise<void> {
  const c = await credentials();
  if (c) await deleteActivity(c, rideId);   // throws, with the reason, if Intervals.icu refuses
  const planned = (await db.planned.toArray()).filter((p) => p.activityId === rideId || p.manualActivityId === rideId);
  for (const p of planned) {
    if (p.manualActivityId === rideId) { await undoHandLog({ ...p, manualActivityId: undefined }); continue; }
    await db.planned.update(p.id, {
      status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned',
      activityId: undefined, relabelled: undefined, done: undefined, rpe: undefined,
    });
  }
  await db.rides.delete(rideId);
  await db.streams.delete(rideId);
  await db.powerCurves.delete(rideId);
}
