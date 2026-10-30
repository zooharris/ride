/**
 * Recording on the Garmin as well (brief D). The Garmin's recording of a ride
 * is the one kept: it is the one in Garmin Connect, and two copies would count
 * the ride's load twice.
 *
 * - At Save: if the Garmin's recording is already in, Antogo's is not
 *   uploaded; the Garmin's completes the session.
 * - At every sync and at launch: a ride the player uploaded is swapped for the
 *   Garmin's recording of the same ride whenever that arrives, however late.
 *   Until then Antogo's stays as the done session. Undo (for 30 days, while the
 *   ride's file is on this computer) brings Antogo's back.
 *
 * Only activities the player made (marked `source: 'veloiq'`) are ever deleted.
 */
import { db } from '../data/db';
import { addDays, today } from '../engine/load';
import type { ActivityEdit, PlannedWorkout, Ride } from '../engine/types';
import { credentials, plannedSeconds, syncAll, TRIVIAL_SECONDS } from '../sync/syncService';
import { deleteRecording as deleteActivityHere, matchByHand, saveActivityEffort, setExcluded, upsertEdit } from '../sync/records';
import { findWorkout } from '../ui/store';
import { calendarEntryFor, getRecording, patchRecording, rideSeconds, uploadRide, type UploadResult } from './rides';
import { garminTwin, playerMade, spanOf } from './twin';
import type { Recording } from './types';

export const KEPT_GARMIN = "Your Garmin recorded this ride too, so Antogo kept the Garmin's: it's the one in Garmin Connect.";

/** Mark an activity as the player's own (synced, so every device knows). */
export async function markPlayerMade(activityId: string, date: string, keep?: boolean, breathSensor?: string): Promise<void> {
  await upsertEdit(activityId, date, { source: 'veloiq', keepVeloiq: keep || undefined, ...(breathSensor ? { breathSensor } : {}) });
}

async function mineNow(): Promise<Set<string>> {
  const [edits, recs] = await Promise.all([db.activityEdits.toArray(), db.recordings.toArray()]);
  return playerMade(edits, recs.map((r) => r.activityId).filter((x): x is string => !!x));
}

const near = (date: string) => db.rides.where('date').between(addDays(date, -1), addDays(date, 1), true, true).toArray();

/**
 * At Save, before uploading: is the Garmin's recording of this ride already
 * in? If so, it completes the session and Antogo's is not uploaded.
 */
export async function garminFirst(r: Recording): Promise<UploadResult | undefined> {
  try { await syncAll(); } catch { /* offline: upload as usual, and the rule catches a twin later */ }
  const g = garminTwin({ startMs: r.startMs, seconds: rideSeconds(r) }, await near(r.date), await mineNow());
  if (!g) return undefined;
  // A twin covers at least half of Antogo's ride; should it still be too short to count as the workout, keep Antogo's.
  const workouts = await db.workouts.toArray();
  const want = r.workoutId ? plannedSeconds(findWorkout(workouts, r.workoutId)) : 0;
  const enough = g.seconds >= TRIVIAL_SECONDS && (!want || g.seconds >= want * 0.2);
  if (r.workoutId && !enough) return undefined;
  await patchRecording(r.id, { status: 'superseded', supersededBy: g.id, error: undefined });
  // The Garmin's ride completes the session. The pairing may already have given it the session.
  const already = (await db.planned.toArray()).find((p) => p.activityId === g.id);
  const entry = already ? { p: already, added: false } : r.workoutId ? await calendarEntryFor(r, g.id) : undefined;
  if (entry) {
    const w = findWorkout(workouts, entry.p.workoutId);
    if (w && !already) await matchByHand((await db.planned.get(entry.p.id)) ?? entry.p, w, g);
    if (r.rpe) await db.planned.update(entry.p.id, { rpe: r.rpe });
  } else if (r.rpe) await saveActivityEffort(g, r.rpe);
  return { ok: true, text: KEPT_GARMIN, activityId: g.id, matched: entry ? r.name : undefined, superseded: true };
}

/** A session gives up the Garmin's recording and goes back to to-do (missed if its day has passed); the pairing won't hand it back. */
async function release(p: PlannedWorkout, gid: string): Promise<void> {
  await db.planned.update(p.id, { status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned', activityId: undefined, matchedByHand: undefined, done: undefined, notActivityIds: [...(p.notActivityIds ?? []).filter((x) => x !== gid), gid] });
}

/**
 * Keep Antogo's recording instead of the Garmin's (Ride complete's "Save
 * Antogo's instead", and Undo): Antogo's is uploaded and completes the
 * session; the Garmin's stays in Garmin Connect and Intervals.icu, left out of
 * training load so the ride counts once. The rule never swaps this pair again.
 */
export async function keepVeloiqInstead(recordingId: string, garminId?: string): Promise<UploadResult> {
  const r = await getRecording(recordingId);
  if (!r) return { ok: false, text: "Antogo's recording of that ride is no longer on this computer." };
  const gid = r.supersededBy ?? garminId;
  if (gid) for (const p of (await db.planned.toArray()).filter((x) => x.activityId === gid)) await release(p, gid);
  await patchRecording(recordingId, { status: 'finished', supersededBy: undefined, activityId: undefined, keepVeloiq: true });
  const res = await uploadRide(recordingId);
  const g = gid ? await db.rides.get(gid) : undefined;
  if (res.ok && g) { await upsertEdit(g.id, g.date, { replaced: undefined }); await setExcluded(g, true); }
  return res;
}

export interface Swap { name: string; garminId: string; recordingId?: string; noPower: boolean; undo: boolean }

/** The one way the rule deletes anything: an activity the player made, and nothing else. */
export async function deletePlayerRide(id: string): Promise<void> {
  const e = await db.activityEdits.get(id);
  if (e?.source !== 'veloiq') throw new Error('Only a ride the Antogo player made can be removed by the Garmin rule.');
  await deleteActivityHere(id);
}

/**
 * At every sync and at launch: each ride the player uploaded whose Garmin
 * twin has arrived gives the Garmin's ride its session, done record and effort,
 * and is deleted from Intervals.icu and here. Returns what was swapped, for the
 * toast. Needs Intervals.icu (a delete there must succeed first).
 */
export async function applyGarminRule(): Promise<Swap[]> {
  const c = await credentials();
  if (!c) return [];
  const [edits, recs, rides, workouts] = await Promise.all([db.activityEdits.toArray(), db.recordings.toArray(), db.rides.toArray(), db.workouts.toArray()]);
  const mine = playerMade(edits, recs.map((r) => r.activityId).filter((x): x is string => !!x));
  const swaps: Swap[] = [];
  for (const e of edits) {
    if (e.source !== 'veloiq' || e.keepVeloiq) continue;
    const p = rides.find((r) => r.id === e.id);
    if (!p) continue;
    const rec = recs.find((r) => r.activityId === p.id);
    if (rec?.keepVeloiq) continue;
    const g = garminTwin(spanOf(p), rides, mine);
    if (!g) continue;
    try {
      // The session, its record and effort move to the Garmin's ride; then Antogo's goes.
      for (const pl of (await db.planned.toArray()).filter((x) => x.activityId === p.id)) {
        const w = findWorkout(workouts, pl.workoutId);
        if (w) await matchByHand(pl, w, (await db.rides.get(g.id)) ?? g);
      }
      if (e.rpe != null && !(await db.planned.toArray()).some((x) => x.activityId === g.id)) await saveActivityEffort(g, e.rpe);
      await deletePlayerRide(p.id);
    } catch { continue; /* Intervals.icu unreachable: the next sync tries again */ }
    const undo = !!rec && rec.samples.length > 0;
    if (rec) await patchRecording(rec.id, { status: 'superseded', supersededBy: g.id, activityId: undefined });
    await upsertEdit(g.id, g.date, { replaced: { name: p.name, at: today(), playerActivityId: p.id, recordingId: undo ? rec!.id : undefined } });
    swaps.push({ name: p.name, garminId: g.id, recordingId: undo ? rec!.id : undefined, noPower: g.averagePower == null && p.averagePower != null, undo });
  }
  return swaps;
}

/**
 * Once: rides the player uploaded before this rule existed are marked as the
 * player's, so the rule can look after them too. Every such upload carries a
 * recording on this computer with its activity id.
 */
export async function markEarlierPlayerRides(): Promise<void> {
  const recs = (await db.recordings.toArray()).filter((r) => r.activityId);
  for (const r of recs) {
    // An activity already gone (swapped by another device, or deleted) is not marked again: that would undo its removal.
    if (!(await db.rides.get(r.activityId!))) continue;
    const e = await db.activityEdits.get(r.activityId!);
    if (e?.source !== 'veloiq') await markPlayerMade(r.activityId!, r.date, r.keepVeloiq);
  }
}

/**
 * Another device may have done the swap (whichever pulls first does). This
 * computer then still holds Antogo's recording marked as uploaded, pointing at
 * an activity that is gone: mark it superseded by the Garmin's, so Undo is
 * offered here, where the file is.
 */
export async function adoptSwaps(): Promise<number> {
  const edits = (await db.activityEdits.toArray()).filter((e) => e.replaced?.playerActivityId);
  if (!edits.length) return 0;
  let n = 0;
  for (const r of await db.recordings.toArray()) {
    if (!r.activityId || r.status === 'superseded') continue;
    const e = edits.find((x) => x.replaced!.playerActivityId === r.activityId);
    if (!e) continue;
    await patchRecording(r.id, { status: 'superseded', supersededBy: e.id, activityId: undefined });
    n++;
  }
  return n;
}

const UNDO_DAYS_MS = 30 * 86_400_000;

/**
 * The recording on this computer that can be kept instead of the Garmin's, if
 * any: Antogo's file of the same ride, within 30 days. Whichever device did the
 * swap, the computer that has the file offers it.
 */
export async function keepableRecording(g: Pick<Ride, 'id'>, replaced?: ActivityEdit['replaced']): Promise<Recording | undefined> {
  if (!replaced) return undefined;
  const recs = await db.recordings.toArray();
  const r = recs.find((x) => x.supersededBy === g.id) ?? (replaced.playerActivityId ? recs.find((x) => x.activityId === replaced.playerActivityId) : undefined);
  return r && r.samples.length > 0 && Date.now() - r.startMs < UNDO_DAYS_MS ? r : undefined;
}

/** Whether the swap is recent enough that Antogo's file may still be on the computer the ride was ridden on. */
export function undoWindowOpen(replaced: NonNullable<ActivityEdit['replaced']>, todayIso = today()): boolean {
  return (Date.parse(todayIso) - Date.parse(replaced.at)) < UNDO_DAYS_MS;
}
