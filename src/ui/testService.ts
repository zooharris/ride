/**
 * What the fitness tests change: the rider takes a suggested FTP or threshold
 * heart rate from a test, and it is saved and sent to Intervals.icu exactly as
 * Save in Settings does it. Also the "re-send this week's rides" offer.
 */
import { db, saveProfile, setSetting } from '../data/db';
import { addDays, today } from '../engine/load';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';
import { garminSendable } from '../engine/workout';
import { validTops } from '../engine/zones';
import { numbersToPush, pushAthleteNumbers } from '../sync/intervals';
import { credentials } from '../sync/syncService';
import { sendPlanned } from './planService';
import { findWorkout, notify } from './store';
import { weekStart } from './derived';

/** Whether the power zones move with FTP (set as shares of it, or the standard ones) rather than being fixed in watts. Mirrors how the zone table is read. */
export function zonesFollowFtp(p: Pick<Profile, 'powerZoneMode' | 'powerZonePcts' | 'powerZoneWatts'>): boolean {
  if (p.powerZoneMode === 'pct' && validTops(p.powerZonePcts)) return true;
  if (p.powerZoneMode !== 'pct' && validTops(p.powerZoneWatts)) return false;
  return true;
}

/**
 * Take a test's FTP or threshold heart rate: saved here (the day FTP changed
 * is stamped with it), the coach's note made fresh, and the numbers sent to
 * Intervals.icu. The words say what happened, as Settings does.
 */
export async function takeThreshold(change: { ftp?: number; lthr?: number }): Promise<{ ok: boolean; text: string }> {
  const what = [change.ftp != null ? `FTP ${change.ftp} W` : '', change.lthr != null ? `threshold heart rate ${change.lthr} bpm` : ''].filter(Boolean).join(' and ');
  return applyNumbers(change, what);
}

/** The coach's zone tables (tops of zones 1-6), applied as watts and bpm: saved and sent to Intervals.icu. */
export async function applyZones(powerTops?: number[], hrTops?: number[]): Promise<{ ok: boolean; text: string }> {
  const patch: Partial<Profile> = {
    ...(powerTops ? { powerZoneMode: 'abs' as const, powerZoneWatts: powerTops } : {}),
    ...(hrTops ? { hrZoneMode: 'abs' as const, hrZoneTops: hrTops } : {}),
  };
  const what = [powerTops ? 'the power zones' : '', hrTops ? 'the heart-rate zones' : ''].filter(Boolean).join(' and ');
  return applyNumbers(patch, what);
}

/** Save numbers on the profile, freshen the coach's note, and send them to Intervals.icu, saying what happened as Settings does. */
async function applyNumbers(change: Partial<Profile>, what: string): Promise<{ ok: boolean; text: string }> {
  const before = await db.profile.get('me');
  if (!before) return { ok: false, text: 'No profile on this device yet.' };
  const next: Profile = { ...before, ...change };
  await saveProfile(next);
  await setSetting('coachNote', null);
  notify();
  const c = await credentials();
  if (!c?.apiKey) return { ok: true, text: `Saved: ${what}. Connect Intervals.icu in Settings to send it there too.` };
  try {
    await pushAthleteNumbers(c, numbersToPush(next));
    return { ok: true, text: `Saved, and sent to Intervals.icu: ${what}. Garmin workouts and Intervals.icu now use it.` };
  } catch (e) {
    return { ok: false, text: `Saved here, but Intervals.icu was not updated: ${(e as Error).message} Until it is, workouts sent to Garmin use the numbers Intervals.icu has.` };
  }
}

/** Rides already on the Garmin this week or next (from today), which still carry the old watts. */
export function sentRidesAhead(planned: PlannedWorkout[], mine: Workout[], on = today()): Array<{ p: PlannedWorkout; w: Workout }> {
  const end = addDays(weekStart(on), 13);
  return planned
    .filter((p) => p.status === 'sent' && p.icuEventId && p.date >= on && p.date <= end)
    .map((p) => ({ p, w: findWorkout(mine, p.workoutId)! }))
    .filter((x) => x.w && x.w.kind === 'ride' && garminSendable(x.w));
}

/** Send those rides again, each replacing its copy on the Garmin with the new numbers. */
export async function resendRides(items: Array<{ p: PlannedWorkout; w: Workout }>): Promise<{ ok: boolean; text: string }> {
  const c = await credentials();
  if (!c) return { ok: false, text: 'Connect Intervals.icu in Settings to send rides to your Garmin.' };
  const profile = await db.profile.get('me');
  let sent = 0;
  try {
    for (const { p, w } of items) { await sendPlanned(c, p, w, profile ?? undefined); sent++; }
    notify();
    return { ok: true, text: `Sent ${sent} ride${sent === 1 ? '' : 's'} again with the new numbers. They replace the copies on your Garmin after its next phone sync.` };
  } catch (e) {
    notify();
    return { ok: false, text: `Sent ${sent}, then: ${(e as Error).message}` };
  }
}
