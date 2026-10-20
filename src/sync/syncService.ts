import { db, getSetting } from '../data/db';
import { addDays, hrTss, rideTss, today } from '../engine/load';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { workoutStats } from '../engine/workout';
import type { IntervalsCredentials } from './intervals';
import { durationFor, fetchPowerCurve, fetchRides, fetchWellness, ICU_TYPE_FOR_KIND, sportOf, testConnection, updateActivityType } from './intervals';
import { syncDevices } from '../data/devicesync';

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
  const planned = await db.planned.where('date').between(oldest, newest, true, true).toArray();
  const workouts = await db.workouts.toArray();
  const workoutOf = (id: string) => workouts.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id);
  const matches = pairRecordings(planned, rides, workoutOf);
  for (const p of planned) {
    const match = matches.get(p.id);
    const kind = workoutOf(p.workoutId)?.kind ?? 'ride';
    if (match && kind !== 'ride' && match.sport !== kind) {
      match.sport = kind;
      match.seconds = durationFor(kind, match.movingSeconds, match.elapsedSeconds) || match.seconds;   // a ride-typed strength session counts its whole time
      match.icuLoad = undefined;             // Intervals.icu scored it as the type the device gave; the app scores it as what it was
      score(match);
    }
    if (match && kind !== 'ride' && ICU_TYPE_FOR_KIND[kind] && match.type !== ICU_TYPE_FOR_KIND[kind]) {
      try {
        const from = match.type;
        await updateActivityType(c, match.id, ICU_TYPE_FOR_KIND[kind]);
        match.type = ICU_TYPE_FOR_KIND[kind];
        if (p.relabelled?.activityId !== match.id) { p.relabelled = { activityId: match.id, from }; await db.planned.update(p.id, { relabelled: p.relabelled }); }
      } catch { /* next sync tries again */ }
    }
    if (match && (p.status !== 'completed' || p.activityId !== match.id)) {
      await db.planned.update(p.id, { status: 'completed', activityId: match.id });
    } else if (!match && p.status === 'completed' && p.activityId && !p.loggedSeconds) {
      // It was marked done from a recording that no longer counts: too short, or
      // deleted. Undo that. Sessions the rider logged by hand stay done.
      await undoRelabel(c, p);
      await db.planned.update(p.id, { status: p.date < today() ? 'missed' : p.icuEventId ? 'sent' : 'planned', activityId: undefined, relabelled: undefined });
    } else if (!match && p.date < today() && p.status !== 'completed') {
      await db.planned.update(p.id, { status: 'missed' });
    }
  }
  await db.rides.bulkPut(rides);

  // Power curve over the last 90 days feeds the limiter assessment; a failure here is not a failed sync.
  try {
    const curve = await fetchPowerCurve(c, addDays(today(), -90), newest);
    if (curve.length) await db.settings.put({ key: 'powerCurve', value: { asOf: today(), curve } });
  } catch { /* optional signal */ }

  const wellness = await fetchWellness(c, oldest, newest);
  await db.wellness.bulkPut(wellness);

  await db.sync.put({ key: 'intervals', athleteId: c.athleteId, lastActivitySync: new Date().toISOString(), lastWellnessSync: new Date().toISOString(), lastError: undefined });
  // Plans, calendar and workouts: merge with the rider's other devices through the note in Intervals.icu.
  await syncDevices(c);
  return { rides: rides.length, wellness: wellness.length, newIds };
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
export async function historyCoverage(): Promise<{ from?: string; activities: number }> {
  const first = await db.rides.orderBy('date').first();
  const firstW = await db.wellness.orderBy('date').first();
  const dates = [first?.date, firstW?.date].filter((d): d is string => !!d).sort();
  return { from: dates[0], activities: await db.rides.count() };
}

/**
 * Pull older activities and wellness, back to `back`, in 60-day pieces so a
 * long history arrives steadily and a failure part-way keeps what came. Only
 * days before what this device already has are fetched, and an activity
 * already here is never overwritten (it may carry corrections made since).
 * The fitness history and the long Progress ranges use it at once; the power
 * curve reads the new rides the next time Progress opens.
 */
export async function loadHistory(back: string, onProgress: (done: number, total: number) => void): Promise<{ activities: number; wellness: number }> {
  const c = await credentials();
  if (!c) throw new Error('Connect Intervals.icu in Settings first.');
  const profile = await db.profile.get('me');
  const have = await historyCoverage();
  const until = addDays(have.from ?? today(), -1);
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
    await db.rides.bulkPut(fresh);
    const wellness = await fetchWellness(c, from, to);
    const haveW = new Set((await db.wellness.where('date').between(from, to, true, true).primaryKeys()) as string[]);
    const newW = wellness.filter((w) => !haveW.has(w.date));
    await db.wellness.bulkPut(newW);
    acts += fresh.length; well += newW.length;
    onProgress(i + 1, pieces.length);
  }
  return { activities: acts, wellness: well };
}

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
    notActivityIds: [...(p.notActivityIds ?? []), p.activityId],
  });
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
  for (const p of planned) {
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
