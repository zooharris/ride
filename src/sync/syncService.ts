import { db, getSetting } from '../data/db';
import { addDays, hrTss, rideTss, today } from '../engine/load';
import type { Ride } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import type { IntervalsCredentials } from './intervals';
import { fetchPowerCurve, fetchRides, fetchWellness, testConnection } from './intervals';
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
  const score = (r: Ride) => {
    const hrOnly = r.averageHr ? hrTss(r.seconds, r.averageHr, profile?.lthr ?? 0) : 0;
    r.tss = r.sport === 'ride' ? (rideTss(r, profile?.ftp ?? 0, profile?.lthr ?? 0) || r.icuLoad || 0)
      : r.sport === 'walk' ? (hrOnly || r.icuLoad || Math.round(r.seconds / 3600 * 38))
      : r.sport === 'strength' ? (r.icuLoad || Math.round(hrOnly * 0.7) || Math.round(r.seconds / 3600 * 32))
      : (r.icuLoad || Math.round(r.seconds / 3600 * 8));
  };
  rides.forEach(score);

  // Pair activities to planned sessions. In order: Intervals.icu's own pairing
  // (the event the Garmin was following), then the same day and kind, then the
  // same day and name (the watch names its recording after the workout, even
  // when it files a treadmill walk as a run). A recording paired to a planned
  // walk or strength session is treated as that kind, whatever type the device
  // gave it, and scored accordingly.
  const planned = await db.planned.where('date').between(oldest, newest, true, true).toArray();
  const workouts = await db.workouts.toArray();
  const workoutOf = (id: string) => workouts.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id);
  const taken = new Set<string>();
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const p of planned) {
    const w = workoutOf(p.workoutId);
    const kind = w?.kind ?? 'ride';
    const free = (r: Ride) => !taken.has(r.id);
    const match = rides.find((r) => p.icuEventId && r.pairedEventId === p.icuEventId)
      ?? rides.find((r) => r.date === p.date && r.sport === kind && free(r))
      ?? (w ? rides.find((r) => r.date === p.date && free(r) && r.sport !== 'ride' && kind !== 'ride' && (sameName(r.name, w.name) || (w.subtitle ? sameName(r.name, `${w.name} · ${w.subtitle}`) : false))) : undefined);
    if (match) {
      taken.add(match.id);
      if (kind !== 'ride' && match.sport !== kind) { match.sport = kind; score(match); }
    }
    if (match && (p.status !== 'completed' || p.activityId !== match.id)) {
      await db.planned.update(p.id, { status: 'completed', activityId: match.id });
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
