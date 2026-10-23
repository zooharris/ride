import type { IntervalsCredentials } from './intervals';
import { BACKUP_DATE, createEvent, createManualActivity, deleteActivity, deleteEvent, fetchPowerCurve, fetchRides, fetchStreams, fetchWellness, pushAthleteNumbers, readBackupNote, testConnection } from './intervals';
import { addDays, today } from '../engine/load';
import { autoBackup } from '../data/backup';

export interface CheckResult { name: string; ok: boolean; detail: string; }

/**
 * Tries every kind of call the app makes to Intervals.icu and says in plain
 * words what worked. Reads are harmless; the writes are confined to things
 * that cannot touch training data: the backup note, a throwaway note and a
 * one-minute activity on a far-future date, both deleted again at once.
 */
export async function runSelfTest(c: IntervalsCredentials, onStep: (r: CheckResult) => void): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const step = async (name: string, fn: () => Promise<string>) => {
    let r: CheckResult;
    try { r = { name, ok: true, detail: await fn() }; }
    catch (e) { r = { name, ok: false, detail: (e as Error).message || String(e) }; }
    out.push(r); onStep(r);
    return r.ok;
  };
  const t = today();
  let numbers: Awaited<ReturnType<typeof testConnection>> | null = null;
  let rideId: string | null = null;

  await step('Credentials and your numbers', async () => {
    numbers = await testConnection(c);
    return `Connected as ${numbers.name}. FTP ${numbers.ftp ?? '–'} W, threshold HR ${numbers.lthr ?? '–'} on the bike and ${numbers.footLthr ?? '–'} on foot, max HR ${numbers.maxHr ?? '–'}, resting HR ${numbers.restingHr ?? '–'}, weight ${numbers.weight ?? '–'} kg; cycling zone tops ${numbers.hrZoneTops ? numbers.hrZoneTops.join('/') : 'not set'}.`;
  });
  await step('Activities (last 90 days)', async () => {
    const rides = await fetchRides(c, addDays(t, -90), t);
    const withGps = rides.filter((r) => r.distanceM && r.sport === 'ride');
    rideId = (withGps[0] ?? rides.find((r) => r.sport === 'ride') ?? rides[0])?.id ?? null;
    const kinds = Object.entries(rides.reduce<Record<string, number>>((m, r) => ({ ...m, [r.sport]: (m[r.sport] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ');
    return rides.length ? `${rides.length} activities: ${kinds}.` : 'No activities in the last 90 days; the recording checks below are skipped.';
  });
  await step('Recording streams for the latest ride', async () => {
    if (!rideId) return 'Skipped: no ride to read.';
    const s = await fetchStreams(c, rideId);
    const have = [['time', s.time], ['power', s.watts], ['heart rate', s.heartrate], ['cadence', s.cadence], ['distance', s.distance], ['elevation', s.altitude], ['speed', s.velocity], ['temperature', s.temp], ['GPS', s.lat]].filter(([, v]) => Array.isArray(v) && (v as number[]).length > 0).map(([k]) => k);
    const missing = ['power', 'heart rate', 'GPS'].filter((k) => !have.includes(k));
    return `${s.time.length} samples with ${have.join(', ')}${missing.length ? `; no ${missing.join(' or ')} in this one` : ''}; ${s.intervals.length} interval markers.`;
  });
  await step('Power curve', async () => {
    const pc = await fetchPowerCurve(c, addDays(t, -90), t);
    if (!pc.length) return 'Reached, but empty: Intervals.icu has no power data in the last 90 days.';
    const at = (sec: number) => pc.find((p) => p.seconds === sec)?.watts;
    return `${pc.length} points. Best 5 s ${at(5) ?? '–'} W, 1 min ${at(60) ?? '–'} W, 5 min ${at(300) ?? '–'} W, 20 min ${at(1200) ?? '–'} W.`;
  });
  await step('Wellness (last 30 days)', async () => {
    const w = await fetchWellness(c, addDays(t, -30), t);
    const n = (k: 'hrv' | 'restingHr' | 'sleepSeconds') => w.filter((d) => d[k] != null).length;
    return w.length ? `${w.length} days; HRV on ${n('hrv')}, resting HR on ${n('restingHr')}, sleep on ${n('sleepSeconds')}.` : 'Reached, but empty: nothing is writing wellness to Intervals.icu, so readiness falls back to form alone.';
  });
  await step('Pushing your numbers to Intervals.icu', async () => {
    if (!numbers) return 'Skipped: could not read them first.';
    await pushAthleteNumbers(c, { ftp: numbers.ftp, lthr: numbers.lthr, maxHr: numbers.maxHr, powerZonePcts: numbers.powerZonePcts, hrZoneTops: numbers.hrZoneTops, footLthr: numbers.footLthr, footHrZoneTops: numbers.footHrZoneTops });
    return `Wrote FTP, threshold HR, max HR and the zone tables back unchanged; Intervals.icu accepted them.${numbers.hrZoneTops ? '' : ' (It holds no full cycling zone table yet; Save in Settings will give it one.)'}`;
  });
  await step('Calendar event: create and delete', async () => {
    const date = addDays(BACKUP_DATE, -1);
    const id = await createNote(c, date);
    await deleteEvent(c, id);
    return 'Created a test note on 30 Dec 2099 and deleted it again.';
  });
  await step('Manual activity: create and delete', async () => {
    // Try the far-future date first; if Intervals.icu refuses future activities, try today and delete at once.
    const tryOn = async (date: string) => createManualActivity(c, { date, name: 'App connection test (deleted)', type: 'Yoga', seconds: 60, tss: 1, rpe: 1, description: 'Created by the app’s connection test; it deletes itself.' });
    let id = '', where = '30 Dec 2099';
    try { id = await tryOn(addDays(BACKUP_DATE, -1)); }
    catch (e) { where = 'today'; try { id = await tryOn(t); } catch (e2) { throw new Error(`On 30 Dec 2099: ${(e as Error).message} On today: ${(e2 as Error).message}`); } }
    if (!id) throw new Error(`Intervals.icu created the activity (${where}) but returned no id, so it could not be deleted; look for "App connection test" and delete it by hand.`);
    await deleteActivity(c, id);
    return `Logged a one-minute test session (${where}) and deleted it again.`;
  });
  await step('Automatic backup', async () => {
    const r = await autoBackup(c, true);
    if (!r.ok) throw new Error(r.error ?? 'Backup failed.');
    const back = await readBackupNote(c);
    if (!back) throw new Error('Wrote the backup note but could not read it back.');
    return `Backup written to your Intervals.icu calendar and read back (${Math.round(back.payload.length / 1024)} KB).`;
  });
  return out;
}

async function createNote(c: IntervalsCredentials, date: string): Promise<number> {
  return createEvent(c, { category: 'NOTE', start_date_local: `${date}T00:00:00`, name: 'App connection test (deleted)', description: 'Created by the app’s connection test; it deletes itself.' });
}
