import { db } from '../data/db';
import { today } from '../engine/load';
import { buildDoneRecord, recordTss } from '../engine/record';
import type { ActivityEdit, DoneRecord, PlannedWorkout, Ride, SessionKind, Workout } from '../engine/types';
import { deleteActivity, deleteEvent, durationFor, sportOf, updateActivityName, updateActivityType } from './intervals';
import { applyLoadEdits, credentials, recheckMatches, rescorer, scoreActivity, startChangeOver, writeRecord } from './syncService';
import { refreshThresholds, readHistory, writeHistory } from '../data/thresholds';
import { changeOne } from './ownService';
import type { Fix } from '../engine/corrections';
import { FOOT_LTHR_HISTORY, FTP_HISTORY, FTP_SCORING, LTHR_HISTORY, type HistoryKey } from '../engine/thresholdCtx';
import { EMPTY_HISTORY, entryOn, usePeriod, withEntry, withoutEntry, type EntrySource, type FtpScoring, type Period, type ThresholdHistory } from '../engine/thresholdHistory';
import { saveProfile } from '../data/db';
import { numbersToPush, pushAthleteNumbers } from './intervals';
import { weightSystem } from '../engine/units';
import { toDoneDay } from './doneDay';

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
  await writeRecord(c, ride, w.name, p.done, p.rpe, weightSystem(profile));
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
    undoneAt: new Date().toISOString(),
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
  // An activity brought in as a file is this device's own: nothing to delete at the data service (Stage 1).
  const own = await db.rides.get(rideId);
  if (c && own?.source !== 'file') await deleteActivity(c, rideId);   // throws, with the reason, if Intervals.icu refuses
  const planned = (await db.planned.toArray()).filter((p) => p.activityId === rideId || p.manualActivityId === rideId);
  for (const p of planned) {
    if (p.manualActivityId === rideId) { await undoHandLog({ ...p, manualActivityId: undefined }); continue; }
    await db.planned.update(p.id, {
      status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned',
      activityId: undefined, relabelled: undefined, done: undefined, rpe: undefined,
    });
  }
  await db.rides.delete(rideId);
  await db.files.delete(rideId);
  await db.own.delete(rideId);
  await db.activityEdits.delete(rideId);
  await db.streams.delete(rideId);
  await db.powerCurves.delete(rideId);
  await db.reads.delete(rideId);
  await db.thumbs.delete(rideId);
}

/* ---------- the rider's edits to a recorded activity ---------- */

const ICU_TYPE: Record<string, string> = { ride: 'Ride', strength: 'WeightTraining', mobility: 'Yoga', walk: 'Walk', run: 'Run' };

export async function upsertEdit(id: string, date: string, patch: Partial<ActivityEdit>): Promise<ActivityEdit> {
  const cur = (await db.activityEdits.get(id)) ?? { id, date };
  const next = { ...cur, ...patch, id, date };
  await db.activityEdits.put(next);
  // Scoring reads the rider's corrections from one place; it is read again whenever they change.
  await refreshThresholds();
  return next;
}

/**
 * Re-derive an activity from what Intervals.icu said plus the rider's edits:
 * its kind, duration rule and load (effort for unplanned strength, 0 if left
 * out), then let the matching rules run again over the last two weeks.
 */
async function reapply(rideId: string): Promise<void> {
  const r = await db.rides.get(rideId);
  if (!r) return;
  const [profile, edits, planned] = await Promise.all([db.profile.get('me'), db.activityEdits.toArray(), db.planned.toArray()]);
  const e = edits.find((x) => x.id === rideId);
  const matched = planned.some((p) => p.activityId === rideId && p.status === 'completed');
  if (!matched) {
    r.sport = e?.kind ?? sportOf(r.type, r.averageSpeedMs);
    r.seconds = durationFor(r.sport, r.movingSeconds, r.elapsedSeconds) || r.seconds;
  }
  // A recording the rider matched to a session by hand is that session, however short.
  scoreActivity(r, profile, { handMatched: planned.some((p) => p.activityId === rideId && p.matchedByHand) });
  applyLoadEdits([r], edits, planned);
  await db.rides.put(r);
  await recheckMatches();
}

/** Rename an activity, here and in Intervals.icu. */
export async function renameActivity(r: Ride, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean || clean === r.name) return;
  const c = await credentials();
  if (c) await updateActivityName(c, r.id, clean);   // throws with the reason if Intervals.icu refuses
  await db.rides.update(r.id, { name: clean });
}

/** Say what an activity really was (undefined: as the device recorded it). The type in Intervals.icu is corrected too. */
export async function setActivityKind(r: Ride, kind: SessionKind | undefined): Promise<void> {
  await upsertEdit(r.id, r.date, { kind });
  const c = await credentials();
  if (c && kind && ICU_TYPE[kind] && r.type !== ICU_TYPE[kind]) {
    try { await updateActivityType(c, r.id, ICU_TYPE[kind]); await db.rides.update(r.id, { type: ICU_TYPE[kind] }); } catch { /* the app's own edit still applies */ }
  }
  await reapply(r.id);
}

/** Leave an activity out of training load, or count it again. */
export async function setExcluded(r: Ride, excluded: boolean): Promise<void> {
  await upsertEdit(r.id, r.date, { excluded: excluded || undefined });
  await reapply(r.id);
}

/** What was done in an activity no planned session covers. */
export async function saveActivityRecord(r: Ride, rec: DoneRecord): Promise<void> {
  const e = await upsertEdit(r.id, r.date, { done: { ...rec, editedAt: new Date().toISOString() } });
  const c = await credentials();
  const profile = await db.profile.get('me');
  if (c && e.done) { await writeRecord(c, r, r.name, e.done, e.rpe, weightSystem(profile)); await db.rides.update(r.id, { description: r.description }); }
}

/** Effort for an activity no planned session covers; for strength it sets the load. */
export async function saveActivityEffort(r: Ride, rpe: number): Promise<void> {
  const e = await upsertEdit(r.id, r.date, { rpe });
  await reapply(r.id);
  const c = await credentials();
  const profile = await db.profile.get('me');
  if (c && e.done) { const fresh = (await db.rides.get(r.id)) ?? r; await writeRecord(c, fresh, r.name, e.done, rpe, weightSystem(profile)); await db.rides.update(r.id, { description: fresh.description }); }
}

/**
 * Match a recording to a planned session by hand (done a day early, or under
 * a name the rules do not recognise). The session is done with a record copied
 * from the plan; the automatic rules never undo a hand match. A record and
 * effort the rider gave the activity while it was unplanned carry over.
 */
export async function matchByHand(p: PlannedWorkout, w: Workout, r: Ride): Promise<void> {
  const e = await db.activityEdits.get(r.id);
  // Done on another day: the session moves to the day it was done (13 Nov 2026).
  const move = toDoneDay(p, r.date);
  if (move.dropEvent) { const c = await credentials(); if (c) { try { await deleteEvent(c, move.dropEvent); } catch { /* harmless: the session is done either way */ } } }
  await db.planned.update(p.id, {
    ...move.patch,
    status: 'completed',
    activityId: r.id,
    matchedByHand: true,
    done: e?.done?.exercises?.length || e?.done?.walk ? e.done : buildDoneRecord(w),
    rpe: e?.rpe ?? p.rpe,
    notActivityIds: p.notActivityIds?.filter((x) => x !== r.id),
  });
  if (e) await upsertEdit(r.id, r.date, { kind: undefined, done: undefined, rpe: undefined });
  await reapply(r.id);
}


/* ---------- corrections to one activity (22 Nov 2026, Part C) ---------- */

/**
 * Make, change or take away corrections to one activity: the FTP or threshold heart rate it alone is scored with, its
 * power or heart rate left out, when it started, the part of it kept. Saved with the rider's other edits (so it
 * travels and survives a sync), then the activity is worked out again at once, and the matching rules run in case it
 * changed day. Nothing is sent to Intervals.icu.
 */
export async function setFix(r: Pick<Ride, 'id' | 'date'>, patch: Partial<Fix>): Promise<void> {
  await upsertEdit(r.id, r.date, patch);
  await changeOne(r.id, rescorer(), () => {});
  if ('start' in patch) await recheckMatches();
}

/* ---------- Antogo's threshold histories (Parts A, B and D) ---------- */

const todayLocal = () => today();

/**
 * After a history changed: scoring reads it again, the setting in Settings follows the entry in force today (the
 * history is the authority; Intervals.icu is told, as when Settings is saved), and only the activities it affects are
 * worked out again. Returns how many were.
 */
async function historyChanged(key: HistoryKey, h: ThresholdHistory): Promise<{ rides: number; now?: number }> {
  await writeHistory(key, h);
  await refreshThresholds();
  const p = await db.profile.get('me');
  const now = entryOn(h, todayLocal())?.value;
  const field = key === FTP_HISTORY ? 'ftp' : key === LTHR_HISTORY ? 'lthr' : 'footLthr';
  let told: number | undefined;
  if (p && now && p[field] !== now) {
    const { id: _id, ...rest } = p;
    const next = { ...rest, [field]: now };
    if (field !== 'footLthr' && next.unsure?.[field]) { const { [field]: _u, ...others } = next.unsure; next.unsure = Object.keys(others).length ? others : undefined; }
    await saveProfile(next);
    told = now;
    const c = await credentials();
    if (c) { try { await pushAthleteNumbers(c, numbersToPush(next)); } catch { /* Settings, Save sends it again */ } }
  }
  return { rides: await startChangeOver(), now: told };
}

/** Add an entry by hand, or change the one on that day. */
export async function setHistoryEntry(key: HistoryKey, from: string, value: number, source: EntrySource = 'typed', note?: string): Promise<{ rides: number; now?: number }> {
  return historyChanged(key, withEntry((await readHistory(key)) ?? EMPTY_HISTORY, { from, value, source, ...(note ? { note } : {}) }));
}
/** Move an entry to another day, or change its figure: the old day's entry goes and the new one is the rider's own. */
export async function changeHistoryEntry(key: HistoryKey, was: string, from: string, value: number): Promise<{ rides: number; now?: number }> {
  let h = (await readHistory(key)) ?? EMPTY_HISTORY;
  const before = h.entries.find((e) => e.from === was);
  if (was !== from) h = withoutEntry(h, was);
  // Only the day moved: it keeps saying how it first got there.
  return historyChanged(key, withEntry(h, before && before.value === Math.round(value) ? { ...before, from, at: undefined } : { from, value, source: 'typed' }));
}
export async function removeHistoryEntry(key: HistoryKey, from: string): Promise<{ rides: number; now?: number }> {
  return historyChanged(key, withoutEntry((await readHistory(key)) ?? EMPTY_HISTORY, from));
}
/** "Use the device's for this period" (A5). */
export async function useDevicePeriod(p: Period): Promise<{ rides: number; now?: number }> {
  return historyChanged(FTP_HISTORY, usePeriod((await readHistory(FTP_HISTORY)) ?? EMPTY_HISTORY, p));
}
/** "From this ride onward" (C1, C2): an entry from the activity's day. */
export async function setFromRideOnward(r: Pick<Ride, 'date' | 'sport'>, what: 'ftp' | 'lthr', value: number): Promise<{ rides: number; now?: number }> {
  const key = what === 'ftp' ? FTP_HISTORY : r.sport === 'walk' || r.sport === 'run' ? FOOT_LTHR_HISTORY : LTHR_HISTORY;
  return setHistoryEntry(key, r.date, value, 'typed');
}
/** The setting (Part B): score rides with Antogo's FTP history, or with the FTP the device had set that day. */
export async function setFtpScoring(v: FtpScoring): Promise<number> {
  await db.settings.put({ key: FTP_SCORING, value: v });
  await refreshThresholds();
  return startChangeOver();
}
