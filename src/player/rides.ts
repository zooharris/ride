/**
 * Recorded rides on this computer: saved as they are ridden, uploaded to
 * Intervals.icu when the rider saves, and kept waiting (the outbox) until an
 * upload succeeds. After an upload the ride is pulled back like any recording,
 * matched to its planned session, and given the rider's effort.
 */
import { db } from '../data/db';
import { credentials, syncAll } from '../sync/syncService';
import { uploadActivityFile, updateActivityEffort } from '../sync/intervals';
import { matchByHand, saveActivityEffort } from '../sync/records';
import { findWorkout } from '../ui/store';
import { encodeFit } from './fit';
import { totals } from './summary';
import type { Recording } from './types';

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
  await db.recordings.bulkDelete(old.filter((r) => r.status === 'uploaded').map((r) => r.id));
}

export function rideFile(r: Recording): Uint8Array {
  return encodeFit(r, totals(r.samples, r.ftp, r.lthr));
}

export function fileName(r: Recording): string {
  return `VeloIQ ${r.date} ${r.name}`.replace(/[^\w .-]+/g, '').replace(/\s+/g, '-') + '.fit';
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

export interface UploadResult { ok: boolean; text: string; activityId?: string; matched?: string }

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
  const c = await credentials();
  if (!c) {
    await patchRecording(id, { status: 'finished', error: 'Intervals.icu is not connected on this device.' });
    return { ok: false, text: 'Connect Intervals.icu in Settings, then save again. The ride is kept on this computer.' };
  }
  let activityId: string;
  try {
    activityId = await uploadActivityFile(c, rideFile(r), { name: r.name, externalId: `veloiq-${r.id}`, fileName: fileName(r), description: 'Ridden with the VeloIQ ride player.' });
  } catch (e) {
    const why = (e as Error).message;
    await patchRecording(id, { status: 'finished', error: why });
    return { ok: false, text: `Not saved yet: ${why} The ride is kept on this computer and will be tried again.` };
  }
  await patchRecording(id, { status: 'uploaded', activityId, uploadedAt: new Date().toISOString(), error: undefined });

  // Bring it back and settle the match and the effort. The upload itself has succeeded; a failure here only delays the match.
  let matched: string | undefined;
  try {
    await syncAll();
    const ride = await db.rides.get(activityId);
    const planned = r.plannedId ? await db.planned.get(r.plannedId) : undefined;
    if (ride && planned) {
      const w = findWorkout(await db.workouts.toArray(), planned.workoutId);
      if (w && planned.activityId !== ride.id) await matchByHand(planned, w, ride);
      if (r.rpe) await db.planned.update(planned.id, { rpe: r.rpe });
      matched = w?.name;
    } else if (ride && r.rpe) {
      await saveActivityEffort(ride, r.rpe);
    }
    if (r.rpe) { try { await updateActivityEffort(c, activityId, r.rpe); } catch { /* the app keeps it either way */ } }
  } catch { /* the next sync pairs it */ }
  return { ok: true, text: matched ? `Saved to Intervals.icu and matched to ${matched}.` : 'Saved to Intervals.icu.', activityId, matched };
}

/** Try every waiting ride once (at launch, on return to the app, and from Today's "Try now"). */
export async function sendWaitingRides(): Promise<{ sent: number; left: number }> {
  let sent = 0;
  const list = await waitingRides();
  for (const r of list) { if ((await uploadRide(r.id)).ok) sent++; }
  return { sent, left: list.length - sent };
}

