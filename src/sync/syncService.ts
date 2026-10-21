import { db, getSetting, setSetting } from '../data/db';
import { addDays, hrTss, rideTss, today } from '../engine/load';
import type { ActivityEdit, DoneRecord, PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import { buildDoneRecord, mayWriteDescription, recordText, recordTss } from '../engine/record';
import { LIBRARY } from '../library/workouts';
import { workoutStats } from '../engine/workout';
import type { IntervalsCredentials } from './intervals';
import { durationFor, fetchPowerCurve, fetchRides, fetchWellness, ICU_TYPE_FOR_KIND, sportOf, testConnection, updateActivityDescription, updateActivityType } from './intervals';
import { schedulePush, syncDevices } from '../data/devicesync';

export async function credentials(): Promise<IntervalsCredentials | null> {
  const c = await getSetting<IntervalsCredentials | null>('intervals', null);
  return c && c.athleteId && c.apiKey ? c : null;
}

/**
 * Pull rides and wellness. First sync goes back 120 days (enough to seed the
 * fitness model); later syncs go back 14 days to catch late uploads and edits.
 * Rides are re-scored with the engine's TSS every time, so a changed FTP
 * updates history consistently.
 */
export async function syncAll(): Promise<{ rides: number; wellness: number; newIds: string[] }> {
  const c = await credentials();
  if (!c) throw new Error('Connect Intervals.icu in Settings first.');
  const state = await db.sync.get('intervals');
  const first = !state?.lastActivitySync;
  const oldest = addDays(today(), first ? -120 : -14);
  const newest = addDays(today(), 1);
  // Intervals.icu is where FTP and thresholds live (Garmin feeds it); keep the profile in step.
  let profile = await db.profile.get('me');
  const numbers = await testConnection(c);
  if (profile) {
    const next = { ...profile, ftp: numbers.ftp ?? profile.ftp, lthr: numbers.lthr ?? profile.lthr, maxHr: numbers.maxHr ?? profile.maxHr, restingHr: numbers.restingHr ?? profile.restingHr, weightKg: numbers.weight ?? profile.weightKg };
    if (JSON.stringify(next) !== JSON.stringify(profile)) { await db.profile.put(next); profile = next; }
  }

  const rides = await fetchRides(c, oldest, newest);
  const known = new Set((await db.rides.where('date').between(oldest, newest, true, true).toArray()).map((r) => r.id));
  // An activity deleted in Intervals.icu (or on another device) goes from this one too.
  const gone = [...known].filter((id) => !rides.some((r) => r.id === id));
  if (gone.length) { await db.rides.bulkDelete(gone); await db.streams.bulkDelete(gone); await db.powerCurves.bulkDelete(gone); }
  const newIds = first ? [] : rides.filter((r) => !known.has(r.id)).map((r) => r.id);
  // Rides score from power or heart rate; walks from heart rate; strength from
  // heart rate if there was a strap, else a modest hourly rate. Intervals.icu's
  // own load is the fallback whenever the app has nothing better.
  const score = (r: Ride) => scoreActivity(r, profile);
  rides.forEach(score);

  // Pair activities to planned sessions. Two passes. First the certain matches:
  // Intervals.icu's own pairing (the event the Garmin was following), then the
  // same day and name (the watch names its recording after the workout, whatever
  // type it files it under: a treadmill walk as a run, a strength session sent
  // as a ride). Then the same day and kind for whatever is left. A recording
  // paired to a planned walk, strength or mobility session is treated as that
  // kind whatever the device said, scored for it, and relabelled in Intervals.icu
  // so its record there is right too (again on any later sync if it drifts).
  const edits = await db.activityEdits.toArray();
  applyKindEdits(rides, edits, profile);
  const planned = await db.planned.where('date').between(oldest, newest, true, true).toArray();
  await applyPairing(rides, planned, await workoutLookup(), c, profile, { markMissed: true });
  applyLoadEdits(rides, edits, planned);
  await db.rides.bulkPut(rides);

  // Power curve over the last 90 days feeds the limiter assessment; a failure here is not a failed sync.
  try {
    const curve = await fetchPowerCurve(c, addDays(today(), -90), newest);
    if (curve.length) await db.settings.put({ key: 'powerCurve', value: { asOf: today(), curve } });
  } catch { /* optional signal */ }

  const wellness = await fetchWellness(c, oldest, newest);
  await db.wellness.bulkPut(wellness);
  if (first) await noteLoadedFrom(oldest);

  await db.sync.put({ key: 'intervals', athleteId: c.athleteId, lastActivitySync: new Date().toISOString(), lastWellnessSync: new Date().toISOString(), lastError: undefined });
  // Plans, calendar and workouts: merge with the rider's other devices through the note in Intervals.icu.
  await syncDevices(c);
  // A new device catches up to the history the rider's other devices hold, in the background.
  void matchHistory();
  return { rides: rides.length, wellness: wellness.length, newIds };
}

/** The workout behind a calendar entry: the rider's and generated copies first, then the ride library. */
async function workoutLookup(): Promise<(id: string) => Workout | undefined> {
  const workouts = await db.workouts.toArray();
  return (id: string) => workouts.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id);
}

/**
 * Apply the matching rules to recordings and calendar entries, and carry out
 * what follows from each match: the recording takes the planned kind (scored
 * for it, relabelled in Intervals.icu when credentials are given), the session
 * is marked done with a record of what was done (copied from the plan), a
 * strength session the rider rated takes its load from that effort, and the
 * record goes into the activity's description in Intervals.icu when that is
 * empty or the app's own. A session marked done from a recording that no
 * longer counts (too short, deleted, or one the rider said was a different
 * workout) goes back to to-do. Sync runs it on fresh recordings; the app also
 * runs it at launch on stored ones, so a rule change applies without a Sync.
 * The caller saves `rides` afterwards.
 */
export async function applyPairing(rides: Ride[], planned: PlannedWorkout[], workoutOf: (id: string) => Workout | undefined, c: IntervalsCredentials | null, profile: Profile | undefined | null, opts: { markMissed?: boolean } = {}): Promise<number> {
  const matches = pairRecordings(planned, rides, workoutOf);
  let changed = 0;
  for (const p of planned) {
    const match = matches.get(p.id);
    const w = workoutOf(p.workoutId);
    const kind = w?.kind ?? 'ride';
    if (match && kind !== 'ride' && match.sport !== kind) {
      match.sport = kind;
      match.seconds = durationFor(kind, match.movingSeconds, match.elapsedSeconds) || match.seconds;   // a ride-typed strength session counts its whole time
      match.icuLoad = undefined;             // Intervals.icu scored it as the type the device gave; the app scores it as what it was
      scoreActivity(match, profile);
    }
    if (c && match && kind !== 'ride' && ICU_TYPE_FOR_KIND[kind] && match.type !== ICU_TYPE_FOR_KIND[kind]) {
      try {
        const from = match.type;
        await updateActivityType(c, match.id, ICU_TYPE_FOR_KIND[kind]);
        match.type = ICU_TYPE_FOR_KIND[kind];
        if (p.relabelled?.activityId !== match.id) { p.relabelled = { activityId: match.id, from }; await db.planned.update(p.id, { relabelled: p.relabelled }); }
      } catch { /* next sync tries again */ }
    }
    if (match) {
      const fresh = p.status !== 'completed' || p.activityId !== match.id;
      const done = !fresh && p.done ? p.done : (w ? buildDoneRecord(w, p.loggedSeconds ? Math.round(p.loggedSeconds / 60) : undefined) : undefined);
      if (fresh) { await db.planned.update(p.id, { status: 'completed', activityId: match.id, done }); p.status = 'completed'; p.activityId = match.id; p.done = done; changed++; }
      else if (!p.done && done) { await db.planned.update(p.id, { done }); p.done = done; }   // done before records existed
      // Heart rate under-reads lifting: once the rider has rated the effort, that sets the load.
      const fromEffort = w ? recordTss(w, match.seconds, p.rpe) : undefined;
      if (fromEffort != null) match.tss = fromEffort;
      if (c && w && done) await writeRecord(c, match, w.name, done, p.rpe, profile?.units);
    } else if (p.status === 'completed' && p.activityId && !p.loggedSeconds) {
      // It was marked done from a recording that no longer counts. Undo that. Sessions the rider logged by hand stay done.
      if (c) await undoRelabel(c, p);
      await db.planned.update(p.id, { status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned', activityId: undefined, relabelled: c ? undefined : p.relabelled, done: undefined, rpe: undefined, matchedByHand: undefined });
      changed++;
    } else if (opts.markMissed && p.date < today() && p.status !== 'completed' && p.status !== 'missed') {
      await db.planned.update(p.id, { status: 'missed' });
    }
  }
  return changed;
}

/** Write the record into the activity's description in Intervals.icu, only when that is empty or the app's own earlier text. */
export async function writeRecord(c: IntervalsCredentials, ride: Ride, workoutName: string, rec: DoneRecord, rpe: number | undefined, units: 'imperial' | 'metric' | undefined): Promise<void> {
  const text = recordText(workoutName, rec, rpe, units);
  if (ride.description === text || !mayWriteDescription(ride.description)) return;
  try { await updateActivityDescription(c, ride.id, text); ride.description = text; } catch { /* best effort: the record lives in the app */ }
}

/**
 * Re-apply the matching rules at launch to what this device already has (the
 * last two weeks), so a rule change or a deleted recording takes effect
 * without waiting for a Sync. Returns how many sessions changed.
 */
export async function recheckMatches(): Promise<number> {
  const oldest = addDays(today(), -14), newest = addDays(today(), 1);
  const [rides, planned, profile] = await Promise.all([
    db.rides.where('date').between(oldest, newest, true, true).toArray(),
    db.planned.where('date').between(oldest, newest, true, true).toArray(),
    db.profile.get('me'),
  ]);
  const edits = await db.activityEdits.toArray();
  applyKindEdits(rides, edits, profile);
  const changed = await applyPairing(rides, planned, await workoutLookup(), await credentials(), profile);
  applyLoadEdits(rides, edits, planned);
  await db.rides.bulkPut(rides);
  return changed;
}

/** The rider's correction of what an activity was: it takes that kind, its duration rule and its scoring. */
export function applyKindEdits(rides: Ride[], edits: ActivityEdit[], profile: Profile | undefined | null): void {
  for (const r of rides) {
    const e = edits.find((x) => x.id === r.id);
    if (!e?.kind || e.kind === r.sport) continue;
    r.sport = e.kind;
    r.seconds = durationFor(e.kind, r.movingSeconds, r.elapsedSeconds) || r.seconds;
    r.icuLoad = undefined;
    scoreActivity(r, profile);
  }
}

/**
 * Load the rider decided: an unplanned strength session they rated takes its
 * load from that effort; an activity left out of training load counts 0, with
 * what it would have been kept to show.
 */
export function applyLoadEdits(rides: Ride[], edits: ActivityEdit[], planned: PlannedWorkout[]): void {
  for (const r of rides) {
    const e = edits.find((x) => x.id === r.id);
    const matched = planned.some((p) => p.activityId === r.id && p.status === 'completed');
    if (e?.rpe && !matched && r.sport === 'strength') {
      const t = recordTss({ kind: 'strength' }, r.seconds, e.rpe);
      if (t != null) r.tss = t;
    }
    if (e?.excluded) { r.uncountedTss = r.tss ?? 0; r.tss = 0; }
    else r.uncountedTss = undefined;
  }
}

/** The app's own training load for an activity (see the comment in syncAll). */
export function scoreActivity(r: Ride, profile: { ftp: number; lthr: number } | undefined | null): void {
  const hrOnly = r.averageHr ? hrTss(r.seconds, r.averageHr, profile?.lthr ?? 0) : 0;
  r.tss = r.sport === 'ride' ? (rideTss(r, profile?.ftp ?? 0, profile?.lthr ?? 0) || r.icuLoad || 0)
    : r.sport === 'walk' ? (hrOnly || r.icuLoad || Math.round(r.seconds / 3600 * 38))
    : r.sport === 'strength' ? (r.icuLoad || Math.round(hrOnly * 0.7) || Math.round(r.seconds / 3600 * 32))
    : (r.icuLoad || Math.round(r.seconds / 3600 * 8));
}

/** The earliest day this device has activities or wellness for, or undefined before the first sync. */
export async function historyCoverage(): Promise<{ from?: string; wellnessFrom?: string; activities: number }> {
  const first = await db.rides.orderBy('date').first();
  const firstW = await db.wellness.orderBy('date').first();
  // Activities and wellness are reported apart: wellness often reaches further back (a ring or watch
  // worn before rides were recorded), and must not make the activity history look complete.
  return { from: first?.date, wellnessFrom: firstW?.date, activities: await db.rides.count() };
}

/**
 * Pull activities and wellness from `back` to today, in 60-day pieces so a
 * long history arrives steadily and a failure part-way keeps what came. The
 * whole span is asked for every time, not only days before the earliest here:
 * Intervals.icu may have gained older records since (a Garmin history import
 * finishes in the background), filling gaps inside the span. An activity or
 * wellness day already here is never overwritten (it may carry corrections).
 * The fitness history and the long Progress ranges use it at once; the power
 * curve reads the new rides the next time Progress opens.
 */
export async function loadHistory(back: string, onProgress: (done: number, total: number) => void): Promise<{ activities: number; wellness: number }> {
  const c = await credentials();
  if (!c) throw new Error('Connect Intervals.icu in Settings first.');
  const profile = await db.profile.get('me');
  const until = today();
  if (back > until) return { activities: 0, wellness: 0 };
  const pieces: Array<[string, string]> = [];
  for (let from = back; from <= until; from = addDays(from, 60)) {
    const to = addDays(from, 59) < until ? addDays(from, 59) : until;
    pieces.push([from, to]);
  }
  let acts = 0, well = 0;
  onProgress(0, pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const [from, to] = pieces[i];
    const rides = await fetchRides(c, from, to);
    const existing = new Set((await db.rides.where('date').between(from, to, true, true).primaryKeys()) as string[]);
    const fresh = rides.filter((r) => !existing.has(r.id));
    fresh.forEach((r) => scoreActivity(r, profile));
    const edits = await db.activityEdits.toArray();
    applyKindEdits(fresh, edits, profile);
    applyLoadEdits(fresh, edits, await db.planned.toArray());
    await db.rides.bulkPut(fresh);
    const wellness = await fetchWellness(c, from, to);
    const haveW = new Set((await db.wellness.where('date').between(from, to, true, true).primaryKeys()) as string[]);
    const newW = wellness.filter((w) => !haveW.has(w.date));
    await db.wellness.bulkPut(newW);
    acts += fresh.length; well += newW.length;
    onProgress(i + 1, pieces.length);
  }
  // Only a load that reached today counts: one stopped part-way is carried on by the next.
  await noteLoadedFrom(back);
  await shareHistoryFrom(back);
  return { activities: acts, wellness: well };
}

/**
 * Every device holds the same history, so fitness, readiness and the plan's
 * re-check give the same answers everywhere (20 Oct 2026: a laptop with two
 * years and a phone with 120 days showed readiness 61 and 60, and 6 and 12
 * suggested changes). `historyFrom` travels in the sync note: the earliest date
 * any of the rider's devices has loaded from. `historyLoadedFrom` stays on each
 * device: how far back this one has loaded. A device that has loaded further
 * back than the note says moves the note back; one that has less loads the
 * difference by itself.
 */
async function noteLoadedFrom(from: string): Promise<void> {
  const have = await getSetting<string | null>('historyLoadedFrom', null);
  if (!have || from < have) await setSetting('historyLoadedFrom', from);
}

async function shareHistoryFrom(from: string): Promise<void> {
  const shared = await getSetting<string | null>('historyFrom', null);
  if (shared && shared <= from) return;
  await setSetting('historyFrom', from);
  schedulePush(credentials);
}

/** How far back this device has loaded. Devices from before this was kept are judged by what they hold. */
export async function loadedFrom(): Promise<string | undefined> {
  const kept = await getSetting<string | null>('historyLoadedFrom', null);
  if (kept) return kept;
  const cov = await historyCoverage();
  const held = [cov.from, cov.wellnessFrom].filter((d): d is string => !!d).sort()[0];
  if (held) await setSetting('historyLoadedFrom', held);
  return held;
}

let matching: Promise<{ activities: number; wellness: number; from: string } | null> | null = null;

/**
 * Bring this device level with the rider's others. Run after every merge with
 * the note. Returns what was loaded, or null when nothing was needed (or the
 * device has not synced yet, or a load failed; the next run carries on).
 */
export function matchHistory(): Promise<{ activities: number; wellness: number; from: string } | null> {
  if (matching) return matching;
  matching = (async () => {
    try {
      if (!(await credentials())) return null;
      const mine = await loadedFrom();
      if (!mine) return null;                       // never synced: the first Sync comes first
      const shared = await getSetting<string | null>('historyFrom', null);
      if (!shared || mine < shared) { await shareHistoryFrom(mine); return null; }
      if (shared >= mine) return null;
      const r = await loadHistory(shared, () => {});
      for (const l of historyListeners) l(r);
      return { ...r, from: shared };
    } catch { return null; }
    finally { matching = null; }
  })();
  return matching;
}

/** Screens told when history arrived to match the rider's other devices. */
const historyListeners = new Set<(r: { activities: number; wellness: number }) => void>();
export function onHistoryMatched(fn: (r: { activities: number; wellness: number }) => void): () => void {
  historyListeners.add(fn);
  return () => { historyListeners.delete(fn); };
}

/** True while this device is loading history to match the others. */
export const matchingHistory = (): boolean => matching != null;

/**
 * Which recording belongs to which planned session. Certain matches first:
 * Intervals.icu's own pairing, then the same day and name (the watch names its
 * recording after the workout, whatever type it files it under). Then the same
 * day and kind for whatever is left. Each recording pairs once.
 */
/** If the app relabelled a recording's type when it matched it, put the original type back. */
async function undoRelabel(c: IntervalsCredentials, p: PlannedWorkout): Promise<void> {
  const r = p.relabelled;
  if (!r || r.activityId !== p.activityId) return;
  try {
    await updateActivityType(c, r.activityId, r.from);
    const local = await db.rides.get(r.activityId);
    if (local) await db.rides.update(r.activityId, { type: r.from, sport: sportOf(r.from, local.averageSpeedMs) });
  } catch { /* the recording keeps the planned kind's label in Intervals.icu; harmless */ }
}

/**
 * The rider says a matched recording was not this session (an extra workout the
 * same day, with the planned one still to come). The session goes back to to-do
 * (missed if its day has passed), the recording stays as an extra activity with
 * its load, its original type is restored if the app had relabelled it, and it
 * is never matched to this session again.
 */
export async function unmatchRecording(plannedId: string): Promise<void> {
  const p = await db.planned.get(plannedId);
  if (!p?.activityId) return;
  const c = await credentials();
  if (c) await undoRelabel(c, p);
  await db.planned.update(p.id, {
    status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned',
    activityId: undefined,
    relabelled: undefined,
    done: undefined,
    rpe: undefined,
    matchedByHand: undefined,
    notActivityIds: [...(p.notActivityIds ?? []), p.activityId],
  });
  // The recording keeps its own load again, not the one the rider's effort for this session gave it.
  const r = await db.rides.get(p.activityId);
  if (r) { const prof = await db.profile.get('me'); scoreActivity(r, prof); await db.rides.put(r); }
}

/** The planned length of a session in seconds, when the workout says. */
export function plannedSeconds(w: Partial<Pick<Workout, 'minutes' | 'walk' | 'blocks'>> | undefined): number | undefined {
  if (!w) return undefined;
  const min = w.walk?.minutes ?? w.minutes;
  if (min) return min * 60;
  const s = w.blocks?.length ? workoutStats(w.blocks).seconds : 0;
  return s || undefined;
}

/**
 * Whether a recording is believable as a planned session: at least five minutes,
 * and at least a fifth of the planned time. A watch button pressed by accident
 * (a 25-second "Cardio" on the same day as a 40-minute strength session) is not
 * the session; a ride cut short at half an hour of two hours still is, as a
 * partial one.
 */
export function plausibleFor(r: Ride, planned: number | undefined): boolean {
  const secs = Math.max(r.seconds ?? 0, r.elapsedSeconds ?? 0);
  return secs >= 300 && (!planned || secs >= planned * 0.2);
}

export function pairRecordings(planned: PlannedWorkout[], rides: Ride[], workoutOf: (id: string) => (Pick<Workout, 'name' | 'subtitle' | 'kind'> & Partial<Pick<Workout, 'minutes' | 'walk' | 'blocks'>>) | undefined): Map<string, Ride> {
  const taken = new Set<string>();
  const free = (r: Ride) => !taken.has(r.id);
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const named = (r: Ride, w: { name: string; subtitle?: string }) => sameName(r.name, w.name) || (!!w.subtitle && sameName(r.name, `${w.name} · ${w.subtitle}`));
  const matches = new Map<string, Ride>();
  // Every pass, Intervals.icu's own pairing included, needs a believable recording.
  const fits = (p: PlannedWorkout, r: Ride) => free(r) && !p.notActivityIds?.includes(r.id) && plausibleFor(r, plannedSeconds(workoutOf(p.workoutId)));
  // Matches the rider made by hand stand first, whatever the day, name or length.
  for (const p of planned) {
    if (!p.matchedByHand || !p.activityId) continue;
    const m = rides.find((r) => r.id === p.activityId && free(r));
    if (m) { taken.add(m.id); matches.set(p.id, m); }
  }
  for (const p of planned) {
    if (matches.has(p.id)) continue;
    const w = workoutOf(p.workoutId);
    const m = rides.find((r) => p.icuEventId && r.pairedEventId === p.icuEventId && fits(p, r))
      ?? (w ? rides.find((r) => r.date === p.date && fits(p, r) && named(r, w)) : undefined);
    if (m) { taken.add(m.id); matches.set(p.id, m); }
  }
  for (const p of planned) {
    if (matches.has(p.id)) continue;
    const kind = workoutOf(p.workoutId)?.kind ?? 'ride';
    const m = rides.find((r) => r.date === p.date && r.sport === kind && fits(p, r));
    if (m) { taken.add(m.id); matches.set(p.id, m); }
  }
  return matches;
}
