/**
 * Recorded rides on this computer: saved as they are ridden, uploaded to
 * Intervals.icu when the rider saves, and kept waiting (the outbox) until an
 * upload succeeds. After an upload the ride is pulled back like any recording,
 * matched to its planned session, and given the rider's effort.
 */
import { db } from '../data/db';
import { credentials, plannedSeconds, syncAll, TRIVIAL_SECONDS } from '../sync/syncService';
import { uploadActivityFile, updateActivityEffort } from '../sync/intervals';
import { matchByHand, saveActivityEffort } from '../sync/records';
import { findWorkout } from '../ui/store';
import { encodeFit } from './fit';
import { totals } from './summary';
import type { Recording } from './types';
import type { PlannedWorkout } from '../engine/types';
import { newId } from '../engine/workout';
import { today } from '../engine/load';
import { garminFirst, markPlayerMade } from './garmin';

export async function putRecording(r: Recording): Promise<void> { await db.recordings.put({ ...r, savedMs: Date.now() }); }
export async function getRecording(id: string): Promise<Recording | undefined> { return db.recordings.get(id); }
export async function patchRecording(id: string, patch: Partial<Recording>): Promise<void> { await db.recordings.update(id, patch); }
export async function deleteRecording(id: string): Promise<void> { await db.recordings.delete(id); }

/** Rides the browser closed in the middle of (not the one being ridden now). */
export async function unfinishedRides(exceptId?: string): Promise<Recording[]> {
  return (await db.recordings.where('status').equals('recording').toArray()).filter((r) => r.id !== exceptId && r.samples.length > 0);
}

/** Finished rides not yet in Intervals.icu. */
export async function waitingRides(): Promise<Recording[]> {
  return (await db.recordings.where('status').equals('finished').toArray()).filter((r) => !r.activityId);
}

/** Uploaded rides are kept 30 days (for downloads and the Garmin rule's Undo), then removed. */
export async function tidyRecordings(now = Date.now()): Promise<void> {
  const old = await db.recordings.where('startMs').below(now - 30 * 86_400_000).toArray();
  await db.recordings.bulkDelete(old.filter((r) => r.status === 'uploaded' || r.status === 'superseded').map((r) => r.id));
}

export function rideFile(r: Recording): Uint8Array {
  return encodeFit(r, totals(r.samples, r.ftp, r.lthr, undefined, r.basis));
}

export function fileName(r: Recording): string {
  return `AntoVelo ${r.date} ${r.name}`.replace(/[^\w .-]+/g, '').replace(/\s+/g, '-') + '.fit';
}

/** Offer the ride file to the browser to save. */
export function downloadRide(r: Recording): void {
  const bytes = rideFile(r);
  const url = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(r);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface UploadResult { ok: boolean; text: string; activityId?: string; matched?: string; tooShort?: boolean;
  /** The Garmin's recording of the same ride was kept; AntoVelo's was not uploaded. */
  superseded?: boolean }

/** How long the ride lasted, start to finish: the larger of the timer and the recording's last second. */
export function rideSeconds(r: Pick<Recording, 'samples' | 'timerSeconds'>): number {
  const last = r.samples.length ? r.samples[r.samples.length - 1].t + 1 : 0;
  return Math.max(r.timerSeconds ?? 0, last);
}

/**
 * Whether a ride is long enough to count as the workout it was started from:
 * the rule the pairing uses for every recording (at least five minutes, and at
 * least a fifth of the workout). A ride stopped after a minute or two is saved
 * as a ride on its own, and the session stays to do.
 */
export async function longEnough(r: Recording): Promise<boolean> {
  if (!r.workoutId) return true;
  const secs = rideSeconds(r);
  const want = plannedSeconds(findWorkout(await db.workouts.toArray(), r.workoutId));
  return secs >= TRIVIAL_SECONDS && (!want || secs >= want * 0.2);
}

/**
 * Upload one ride and settle it: the activity is made in Intervals.icu (named
 * after the workout, so the usual pairing finds its session), pulled back,
 * matched to its planned session by hand if the day or name would not pair
 * it, and given the effort. A failure leaves the ride waiting, with the reason.
 */
export async function uploadRide(id: string): Promise<UploadResult> {
  const r = await getRecording(id);
  if (!r) return { ok: false, text: 'That ride is no longer on this computer.' };
  if (r.activityId) return { ok: true, text: 'Already saved to Intervals.icu.', activityId: r.activityId };
  if (r.status === 'superseded' && r.supersededBy) return { ok: true, text: 'Kept your Garmin\'s recording of this ride.', activityId: r.supersededBy, superseded: true };
  const c = await credentials();
  if (!c) {
    await patchRecording(id, { status: 'finished', error: 'Intervals.icu is not connected on this device.' });
    return { ok: false, text: 'Connect Intervals.icu in Settings, then save again. The ride is kept on this computer.' };
  }
  // The Garmin recorded it too and its recording is already in: keep the Garmin's.
  if (!r.keepVeloiq) { const g = await garminFirst(r); if (g) return g; }
  let activityId: string;
  try {
    activityId = await uploadActivityFile(c, rideFile(r), { name: r.name, externalId: `veloiq-${r.id}${r.keepVeloiq ? '-kept' : ''}`, fileName: fileName(r), description: 'Ridden with the AntoVelo ride player.' });
  } catch (e) {
    const why = (e as Error).message;
    await patchRecording(id, { status: 'finished', error: why });
    return { ok: false, text: `Not saved yet: ${why} The ride is kept on this computer and will be tried again.` };
  }
  await patchRecording(id, { status: 'uploaded', activityId, uploadedAt: new Date().toISOString(), error: undefined });
  await markPlayerMade(activityId, r.date, r.keepVeloiq);

  // The ride goes on the calendar of the day it was ridden, as a done workout, before the pull, so the
  // automatic pairing cannot hand it to another session planned that day. Nothing on other days is touched.
  const tooShort = !(await longEnough(r));
  const entry = tooShort ? undefined : await calendarEntryFor(r, activityId);
  let added = false;
  try {
    await syncAll();
    const ride = await db.rides.get(activityId);
    if (ride && entry) {
      const w = findWorkout(await db.workouts.toArray(), entry.p.workoutId);
      if (w) await matchByHand((await db.planned.get(entry.p.id)) ?? entry.p, w, ride);
      if (r.rpe) await db.planned.update(entry.p.id, { rpe: r.rpe });
      added = entry.added;
    } else if (ride && r.rpe) {
      await saveActivityEffort(ride, r.rpe);
    }
    if (r.rpe) { try { await updateActivityEffort(c, activityId, r.rpe); } catch { /* the app keeps it either way */ } }
  } catch { /* the next sync pairs it: the calendar entry already holds the recording's id */ }
  const day = r.date === today() ? "today's" : `${new Date(r.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' })}'s`;
  const text = tooShort ? `Saved to Intervals.icu. Too short to count as ${r.name}, so it's saved as a ride on its own. The session is still on your calendar.`
    : !entry ? 'Saved to Intervals.icu.' : added ? `Saved to Intervals.icu and added to ${day} calendar as done.` : `Saved to Intervals.icu and matched to ${r.name} on ${day} calendar.`;
  return { ok: true, text, activityId, matched: entry ? r.name : undefined, tooShort };
}

/**
 * The calendar entry a ride completes, on the day it was ridden: the session
 * it was started from if that is the same day; else the same workout already on
 * that day and not yet done; else a new entry, added by hand (so the plan
 * counts its load as extra). A session planned for another day stays where it
 * is, still to do. A free ride has no workout and no entry: it shows as an
 * unscheduled activity.
 */
export async function calendarEntryFor(r: Recording, activityId: string): Promise<{ p: PlannedWorkout; added: boolean } | undefined> {
  if (!r.workoutId) return undefined;
  const from = r.plannedId ? await db.planned.get(r.plannedId) : undefined;
  const sameDay = from && from.date === r.date && from.status !== 'completed' ? from
    : (await db.planned.where('date').equals(r.date).toArray()).find((p) => p.workoutId === (from?.workoutId ?? r.workoutId) && p.status !== 'completed');
  const hold = { activityId, matchedByHand: true as const };
  if (sameDay) {
    await db.planned.update(sameDay.id, hold);
    return { p: { ...sameDay, ...hold }, added: false };
  }
  const p: PlannedWorkout = { id: newId(), date: r.date, workoutId: from?.workoutId ?? r.workoutId, basis: r.basis, status: 'planned', ...hold };
  await db.planned.add(p);
  return { p, added: true };
}

/** Try every waiting ride once (at launch, on return to the app, and from Today's "Try now"). */
export async function sendWaitingRides(): Promise<{ sent: number; left: number }> {
  let sent = 0;
  const list = await waitingRides();
  for (const r of list) { if ((await uploadRide(r.id)).ok) sent++; }
  return { sent, left: list.length - sent };
}

