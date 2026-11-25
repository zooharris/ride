/**
 * Recorded rides on this computer. Since 23 Nov 2026 a ride the rider saves goes straight into Antogo's own record:
 * kept with its file, worked out by Antogo, shown at once, matched to its planned session and given the rider's
 * effort, with no data service needed. When the rider is connected to Intervals.icu the ride is also sent there,
 * after it is safely saved; a send that fails is tried again quietly, and when the service's copy comes back the
 * rule for second copies makes the two one activity.
 */
import { thisDevice } from '../shell';
import { testLines, testResultKey } from './tests';
import { db, setSetting } from '../data/db';
import { credentials, plannedSeconds, syncAll, TRIVIAL_SECONDS } from '../sync/syncService';
import { uploadActivityFile, updateActivityEffort } from '../sync/intervals';
import { matchByHand, saveActivityEffort } from '../sync/records';
import { findWorkout } from '../ui/store';
import { encodeFit } from './fit';
import { totals } from './summary';
import type { Recording } from './types';
import type { PlannedWorkout, Ride } from '../engine/types';
import { addActivity } from '../import/importer';
import { NOT_ACTIVITY, readActivityFile } from '../import/readers';
import { newId } from '../engine/workout';
import { today } from '../engine/load';
import { garminFirst, markPlayerMade } from './garmin';
import { noteBreathingDate } from './breathRead';

export async function putRecording(r: Recording): Promise<void> { await db.recordings.put({ ...r, savedMs: Date.now() }); }
export async function getRecording(id: string): Promise<Recording | undefined> { return db.recordings.get(id); }
export async function patchRecording(id: string, patch: Partial<Recording>): Promise<void> { await db.recordings.update(id, patch); }
export async function deleteRecording(id: string): Promise<void> { await db.recordings.delete(id); }

/** Rides the browser closed in the middle of (not the one being ridden now). */
export async function unfinishedRides(exceptId?: string): Promise<Recording[]> {
  return (await db.recordings.where('status').equals('recording').toArray()).filter((r) => r.id !== exceptId && r.samples.length > 0);
}

/** Finished rides that are not saved anywhere yet (a ride saved in Antogo's record is not waiting, whatever is still to send). */
export async function waitingRides(): Promise<Recording[]> {
  return (await db.recordings.where('status').equals('finished').toArray()).filter((r) => !r.activityId && !r.localId);
}

/** Finished rides still to be saved or to be sent on to the data service. */
async function unsentRides(): Promise<Recording[]> {
  return (await db.recordings.where('status').equals('finished').toArray()).filter((r) => !r.activityId);
}

/** Uploaded rides are kept 30 days (for downloads and the Garmin rule's Undo), then removed. */
export async function tidyRecordings(now = Date.now()): Promise<void> {
  const old = await db.recordings.where('startMs').below(now - 30 * 86_400_000).toArray();
  await db.recordings.bulkDelete(old.filter((r) => r.status === 'uploaded' || r.status === 'superseded' || r.status === 'saved').map((r) => r.id));
}

export function rideFile(r: Recording): Uint8Array {
  return encodeFit(r, totals(r.samples, r.ftp, r.lthr, undefined, r.basis));
}

export function fileName(r: Recording): string {
  return `Antogo ${r.date} ${r.name}`.replace(/[^\w .-]+/g, '').replace(/\s+/g, '-') + '.fit';
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
  /** The Garmin's recording of the same ride was kept; Antogo's was not uploaded. */
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

/** Where a ride under five minutes is found: it is kept, counts 0, and is not listed. */
export const UNDER_FIVE = 'It ran under five minutes, so it counts 0 and is not listed: in Activities, tick "Show the recordings that are not training" to see it.';

/**
 * The ride put into Antogo's own record: its file is read back like any activity file, kept with the activity, and
 * the numbers are worked out by Antogo. Returns the activity.
 */
async function addToRecord(r: Recording): Promise<Ride> {
  const bytes = rideFile(r);
  const parsed = await readActivityFile(fileName(r), bytes);
  if (!parsed || parsed === NOT_ACTIVITY) throw new Error("The ride's recording could not be read back.");
  const profile = (await db.profile.get('me')) ?? undefined;
  // Its own activity under its own id, whatever else was recorded at that time: a device's recording of the same
  // ride is dealt with by the player's rule for that, before the save and whenever one arrives later.
  const added = await addActivity(parsed, bytes, profile, { own: `file-${r.id}` });
  if (added === 'already') throw new Error('The ride could not be added to your record.');
  const named: Ride = { ...added, name: r.name };
  await db.rides.put(named);
  return named;
}

/**
 * Save one ride and settle it. First into Antogo's own record (shown at once, matched to its planned session by
 * hand so the automatic pairing cannot hand it to another session that day, and given the effort). Then, when the
 * rider is connected to Intervals.icu, sent there as well; a send that fails leaves the ride saved and is tried
 * again later. (The name is from when saving meant uploading.)
 */
export async function uploadRide(id: string): Promise<UploadResult> {
  const r = await getRecording(id);
  if (!r) return { ok: false, text: `That ride is no longer on ${thisDevice()}.` };
  if (r.activityId) return { ok: true, text: 'Already saved.', activityId: r.activityId };
  if (r.status === 'superseded' && r.supersededBy) return { ok: true, text: 'Kept your device\'s recording of this ride.', activityId: r.supersededBy, superseded: true };
  if (r.status === 'saved' && r.localId && (await db.rides.get(r.localId))) return { ok: true, text: 'Already saved.', activityId: r.localId };
  // The rider's own device recorded it too and its recording is already here: keep the device's.
  if (!r.keepVeloiq && !r.localId) { const g = await garminFirst(r); if (g) return g; }

  // 1. Into Antogo's own record.
  const tooShort = !(await longEnough(r));
  const tiny = rideSeconds(r) < TRIVIAL_SECONDS;
  let local = r.localId ? await db.rides.get(r.localId) : undefined;
  let entry: { p: PlannedWorkout; added: boolean } | undefined;
  if (!local) {
    try { local = await addToRecord(r); }
    catch (e) {
      const why = (e as Error).message;
      await patchRecording(id, { status: 'finished', error: why });
      return { ok: false, text: `Not saved: ${why} The ride is kept on ${thisDevice()}.` };
    }
    await patchRecording(id, { localId: local.id, error: undefined });
    await markPlayerMade(local.id, r.date, r.keepVeloiq, r.breathing ? (r.breathSensor ?? 'Breathing strap') : undefined);
    if (r.test) await setSetting(testResultKey(local.id), r.test);
    if (r.breathing) await noteBreathingDate(r.date);
    entry = tooShort ? undefined : await calendarEntryFor(r, local.id);
    if (entry) {
      const w = findWorkout(await db.workouts.toArray(), entry.p.workoutId);
      if (w) await matchByHand((await db.planned.get(entry.p.id)) ?? entry.p, w, local);
      if (r.rpe) await db.planned.update(entry.p.id, { rpe: r.rpe });
    } else if (r.rpe) await saveActivityEffort(local, r.rpe);
  }
  const day = r.date === today() ? "today's" : `${new Date(r.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' })}'s`;
  const text = tiny ? `Saved. ${UNDER_FIVE}${r.workoutId ? ' The session is still on your calendar.' : ''}`
    : tooShort ? `Saved. Too short to count as ${r.name}, so it's saved as a ride on its own. The session is still on your calendar.`
    : !entry ? 'Saved.' : entry.added ? `Saved, and added to ${day} calendar as done.` : `Saved, and matched to ${r.name} on ${day} calendar.`;
  const done = (activityId: string): UploadResult => ({ ok: true, text, activityId, matched: entry ? r.name : undefined, tooShort });

  // 2. On to Intervals.icu, for a rider who is connected. The ride is saved either way.
  const c = await credentials();
  if (!c) { await patchRecording(id, { status: 'saved', error: undefined }); return done(local.id); }
  let activityId: string;
  try {
    activityId = await uploadActivityFile(c, rideFile(r), { name: r.name, externalId: `veloiq-${r.id}${r.keepVeloiq ? '-kept' : ''}`, fileName: fileName(r), description: ['Ridden with the Antogo ride player.', ...(r.test ? ['', ...testLines(r.test)] : [])].join('\n') });
  } catch (e) {
    // Saved here; the send is tried again at the next launch or return to the app.
    await patchRecording(id, { status: 'finished', error: (e as Error).message });
    return done(local.id);
  }
  await patchRecording(id, { status: 'uploaded', activityId, uploadedAt: new Date().toISOString(), error: undefined });
  const test = (await getRecording(id))?.test ?? r.test;
  if (test) await setSetting(testResultKey(activityId), test);
  // The service's copy is pulled back; the rule for second copies makes it and the one saved here one activity,
  // which carries the session, the effort, the file and the note that the player made it. (That note is written for
  // the service's copy only afterwards: written first, it would stand in the way of the saved one's being carried over.)
  try {
    await syncAll();
    if (r.rpe) { try { await updateActivityEffort(c, activityId, r.rpe); } catch { /* the app keeps it either way */ } }
  } catch { /* the next sync brings it back and makes them one */ }
  if (await db.rides.get(activityId)) await markPlayerMade(activityId, r.date, r.keepVeloiq, r.breathing ? (r.breathSensor ?? 'Breathing strap') : undefined);
  return done((await db.rides.get(activityId)) ? activityId : local.id);
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

/** Try every ride still to be saved or sent once (at launch, on return to the app, and from Today's "Try now"). */
export async function sendWaitingRides(): Promise<{ sent: number; left: number }> {
  let sent = 0;
  const list = await unsentRides();
  for (const r of list) { const res = await uploadRide(r.id); if (res.ok && (await getRecording(r.id))?.status !== 'finished') sent++; }
  return { sent, left: list.length - sent };
}

