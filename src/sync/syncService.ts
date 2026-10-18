import { db, getSetting } from '../data/db';
import { addDays, rideTss, today } from '../engine/load';
import type { IntervalsCredentials } from './intervals';
import { fetchRides, fetchWellness, testConnection } from './intervals';

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
export async function syncAll(): Promise<{ rides: number; wellness: number }> {
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
  for (const r of rides) {
    r.tss = rideTss(r, profile?.ftp ?? 0, profile?.lthr ?? 0) || r.icuLoad || 0;
  }
  await db.rides.bulkPut(rides);

  // Pair completed rides to planned workouts by Intervals event id, else by date.
  const planned = await db.planned.where('date').between(oldest, newest, true, true).toArray();
  for (const p of planned) {
    const match = rides.find((r) => (p.icuEventId && r.pairedEventId === p.icuEventId)) ?? rides.find((r) => r.date === p.date);
    if (match && p.status !== 'completed') {
      await db.planned.update(p.id, { status: 'completed', activityId: match.id });
    } else if (!match && p.date < today() && p.status !== 'completed') {
      await db.planned.update(p.id, { status: 'missed' });
    }
  }

  const wellness = await fetchWellness(c, oldest, newest);
  await db.wellness.bulkPut(wellness);

  await db.sync.put({ key: 'intervals', athleteId: c.athleteId, lastActivitySync: new Date().toISOString(), lastWellnessSync: new Date().toISOString(), lastError: undefined });
  return { rides: rides.length, wellness: wellness.length };
}
