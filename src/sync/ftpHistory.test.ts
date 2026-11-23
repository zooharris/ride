import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Encoder, Profile as FitProfile } from '@garmin/fitsdk';
import { db, saveProfile } from '../data/db';
import { ensureHistories, readHistory, refreshThresholds } from '../data/thresholds';
import { makeBackup, restoreBackup } from '../data/backup';
import { localDoc, mergeRemote } from '../data/devicesync';
import { FOOT_LTHR_HISTORY, FTP_HISTORY, FTP_SCORING, LTHR_HISTORY, setThresholdCtx } from '../engine/thresholdCtx';
import { periodsOf, sorted } from '../engine/thresholdHistory';
import { importFiles, finishImport } from '../import/importer';
import type { Profile, Ride } from '../engine/types';
import { applyOwnTo, recordingOf, watchChangeOver } from './ownService';
import { changeHistoryEntry, removeHistoryEntry, setFix, setFromRideOnward, setFtpScoring, setHistoryEntry, useDevicePeriod } from './records';
import { rescorer, scoreActivity, startChangeOver } from './syncService';
import { takeThreshold } from '../ui/testService';
import { devicePeriods } from '../data/thresholds';

/**
 * Antogo's own FTP history, the setting, and activities you can correct (22 Nov 2026), end to end on a made-up
 * rider: every file here is written by Garmin's own FIT kit, and no number is any real rider's.
 */
(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
(globalThis as { window?: unknown }).window ??= undefined;
const profile: Profile = { name: 'Sam Example', ftp: 250, lthr: 160, maxHr: 185, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6, ftpSetOn: '2026-10-10', lthrSetOn: '2026-01-05' };
const FIT0 = 631065600;
const unix = (day: string, hour = 9) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) / 1000;

/** A FIT ride: one record a second, each `w` watts and `hr` beats as the functions say; the device's FTP when given. */
function fit(day: string, o: { secs?: number; w?: (i: number) => number; hr?: (i: number) => number; ftp?: number; hour?: number } = {}): Uint8Array {
  const e = new Encoder();
  const N = FitProfile.MesgNum;
  const start = unix(day, o.hour) - FIT0, secs = o.secs ?? 3600;
  e.onMesg(N.FILE_ID, <never>{ type: 'activity', manufacturer: 'garmin', product: 1, timeCreated: start });
  e.onMesg(N.EVENT, <never>{ timestamp: start, event: 'timer', eventType: 'start' });
  for (let i = 0; i < secs; i++) e.onMesg(N.RECORD, <never>{ timestamp: start + i, power: (o.w ?? (() => 200))(i), heartRate: (o.hr ?? (() => 140))(i), cadence: 88, speed: 8, distance: i * 8, altitude: 100 });
  e.onMesg(N.SESSION, <never>{ timestamp: start + secs - 1, startTime: start, sport: 'cycling', subSport: 'road', totalElapsedTime: secs - 1, totalTimerTime: secs - 1, totalDistance: (secs - 1) * 8, ...(o.ftp ? { thresholdPower: o.ftp } : {}) });
  e.onMesg(N.ACTIVITY, <never>{ timestamp: start + secs - 1, localTimestamp: start + secs - 1, numSessions: 1 });
  return e.close();
}
/** An activity as the data service sends it, with the FTP it had on record that day, and its original file kept here. */
async function fromService(id: string, day: string, icuFtp: number | undefined, file?: Uint8Array, more: Partial<Ride> = {}): Promise<void> {
  await db.rides.put({ id, date: day, startTime: `${day}T09:00:00`, name: id, type: 'Ride', sport: 'ride', seconds: 3599, elapsedSeconds: 3599, normalizedPower: 200, averagePower: 200, averageHr: 140, ...(icuFtp ? { ftpAtRide: icuFtp, ftpService: icuFtp } : {}), ...more });
  if (file) await db.files.put({ id, date: day, status: 'kept', bytes: file, size: file.byteLength, at: 'x' });
}
const ride = async (id: string) => (await db.rides.get(id))!;
const ftpHistory = async () => sorted(await readHistory(FTP_HISTORY)).map((e) => [e.from, e.value, e.source] as const);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

beforeEach(async () => { setThresholdCtx(undefined); await db.delete(); await db.open(); await db.profile.put({ id: 'me', ...profile }); });

/** A rider with a year of rides: 222 W through the summer, a Ramp Test taken on 7 Nov, the device on other figures. */
async function summerRider(): Promise<void> {
  await fromService('mar', '2026-03-10', 222, fit('2026-03-10'));                       // the file carries no FTP
  await fromService('jun', '2026-06-20', 222, fit('2026-06-20', { ftp: 244 }));
  await fromService('aug', '2026-08-15', 222, fit('2026-08-15', { ftp: 244 }));
  await fromService('ramp', '2026-11-07', 222, fit('2026-11-07', { ftp: 244 }));
  await fromService('nov', '2026-11-12', 250, fit('2026-11-12', { ftp: 210 }));
  await db.settings.put({ key: 'testResult:ramp', value: { kind: 'ramp', ftpAction: 'updated', ftpEstimate: 250 } });
}

describe('the history is filled in once, from the activities already here (A3)', () => {
  it('each change in the FTP kept with the activities is an entry; the test taken is dated on its day', async () => {
    await summerRider();
    await startChangeOver();
    expect(await ftpHistory()).toEqual([['2026-03-10', 222, 'activities'], ['2026-11-07', 250, 'test']]);
    expect(sorted(await readHistory(FTP_HISTORY))[1].note).toBe('Ramp Test');
    // Threshold heart rate has no past record anywhere: one entry, today's figure, for everything earlier (D2).
    expect(sorted(await readHistory(LTHR_HISTORY))).toMatchObject([{ from: '2026-01-05', value: 160, source: 'start' }]);
    expect(sorted(await readHistory(FOOT_LTHR_HISTORY))).toEqual([]);
  });
  it('every ride is then scored by the entry in force on its day, and says so', async () => {
    await summerRider();
    await startChangeOver();
    expect((await ride('aug')).ftpAtRide).toBe(222);
    expect((await ride('aug')).intensityFactor).toBe(0.9);        // 200 / 222
    expect((await ride('ramp')).ftpAtRide).toBe(250);             // the day of the test
    expect((await ride('nov')).ftpAtRide).toBe(250);              // not the 210 its device had
    expect((await ride('nov')).ftpDevice).toBe(210);
    expect((await ride('nov')).lthrAtRide).toBe(160);
  });
  it('a device connected to the rider\'s others waits for its first merge with them before filling anything in', async () => {
    await summerRider();
    await db.settings.put({ key: 'intervals', value: { athleteId: 'i1', apiKey: 'k' } });
    expect(await ensureHistories()).toBe(false);
    expect(await readHistory(FTP_HISTORY)).toBeUndefined();
    await db.settings.put({ key: 'deviceSync', value: { last: new Date().toISOString() } });
    expect(await ensureHistories()).toBe(true);
    expect(await ftpHistory()).toHaveLength(2);
  });
  it("a rider whose FTP isn't known has a history with no entries; an estimate is not history", async () => {
    await db.profile.put({ id: 'me', ...profile, unsure: { ftp: {} } });
    await ensureHistories();
    expect(await ftpHistory()).toEqual([]);
  });
});

describe('each way an entry arrives (A2)', () => {
  beforeEach(async () => { await summerRider(); await startChangeOver(); });
  it('changing FTP in Settings adds an entry from that day', async () => {
    await saveProfile({ ...profile, ftp: 255 });
    expect((await ftpHistory()).pop()).toEqual([today(), 255, 'settings']);
  });
  it('an FTP that arrives from Intervals.icu adds an entry from the day it arrives', async () => {
    await saveProfile({ ...profile, ftp: 248 }, { from: 'service' });
    expect((await ftpHistory()).pop()).toEqual([today(), 248, 'service']);
  });
  it('a test done in Antogo adds an entry when the rider accepts its result', async () => {
    const res = await takeThreshold({ ftp: 262 }, { name: 'Ramp Test', day: today() });
    expect(res.ok).toBe(true);
    const last = sorted(await readHistory(FTP_HISTORY)).pop()!;
    expect([last.from, last.value, last.source, last.note]).toEqual([today(), 262, 'test', 'Ramp Test']);
  });
  it('a test accepted days later is dated on the day of the test, unless the history has changed since', async () => {
    await db.settings.put({ key: FTP_HISTORY, value: { entries: [{ from: '2026-03-10', value: 222, source: 'activities', at: 'x' }] } });
    await saveProfile({ ...profile, ftp: 262 }, { from: 'test', note: '20-minute test', on: '2026-10-01' });
    expect((await ftpHistory()).pop()).toEqual(['2026-10-01', 262, 'test']);
    // A later entry already stands: the result goes in from today, saying which test it was.
    await saveProfile({ ...profile, ftp: 270 }, { from: 'test', note: 'Ramp Test', on: '2026-09-01' });
    const last = sorted(await readHistory(FTP_HISTORY)).pop()!;
    expect([last.from, last.value]).toEqual([today(), 270]);
    expect(last.note).toMatch(/^Ramp Test of 1 Sep/);
  });
  it('the rider adds an entry in the past by hand; only the rides it affects are worked out again', async () => {
    const before = { mar: (await ride('mar')).tss, jun: (await ride('jun')).tss, aug: (await ride('aug')).tss, nov: (await ride('nov')).tss };
    const stamps = new Map((await db.own.toArray()).map((x) => [x.id, x.at]));
    await new Promise((r) => setTimeout(r, 5));
    const res = await setHistoryEntry(FTP_HISTORY, '2026-06-01', 244);
    expect(res.rides).toBe(2);                                         // June and August; March, the test and November are untouched
    expect((await ride('jun')).ftpAtRide).toBe(244);
    expect((await ride('jun')).intensityFactor).toBe(0.82);
    expect((await ride('jun')).tss!).toBeLessThan(before.jun!);
    expect((await ride('aug')).tss!).toBeLessThan(before.aug!);
    expect((await ride('mar')).tss).toBe(before.mar);
    expect((await ride('nov')).tss).toBe(before.nov);
    const after = new Map((await db.own.toArray()).map((x) => [x.id, x.at]));
    expect(['mar', 'ramp', 'nov'].every((id) => after.get(id) === stamps.get(id))).toBe(true);
    expect(['jun', 'aug'].every((id) => after.get(id) !== stamps.get(id))).toBe(true);
    // Removing it puts them back, and again only those two are worked out.
    expect((await removeHistoryEntry(FTP_HISTORY, '2026-06-01')).rides).toBe(2);
    expect((await ride('jun')).tss).toBe(before.jun);
  });
  it('a run that changed something says how many activities it worked out again', async () => {
    let seen: { changed: number } | undefined;
    const off = watchChangeOver((s) => { if (s.last) seen = s.last; });
    await setHistoryEntry(FTP_HISTORY, '2026-06-01', 244);
    off();
    expect(seen?.changed).toBe(2);
  });
  it("the entry in force today is the rider's FTP: changing the latest entry changes the setting", async () => {
    const res = await setHistoryEntry(FTP_HISTORY, '2026-11-07', 256);
    expect(res.now).toBe(256);
    expect((await db.profile.get('me'))!.ftp).toBe(256);
    expect(await ftpHistory()).toEqual([['2026-03-10', 222, 'activities'], ['2026-11-07', 256, 'typed']]);   // and no second entry for it
  });
});

describe("the device's figures, offered for a period and used (A5)", () => {
  it('"Use the device\'s for this period" puts a whole summer right in one press', async () => {
    await summerRider();
    await startChangeOver();
    const periods = await devicePeriods();
    expect(periods).toEqual([{ value: 244, from: '2026-06-20', to: '2026-11-07', rides: 3 }, { value: 210, from: '2026-11-12', rides: 1 }]);
    // The device was right from June until the test: use it up to the day before the test.
    const res = await useDevicePeriod({ value: 244, from: '2026-06-20', to: '2026-11-06', rides: 2 });
    expect(res.rides).toBe(2);
    expect(await ftpHistory()).toEqual([['2026-03-10', 222, 'activities'], ['2026-06-20', 244, 'device'], ['2026-11-07', 250, 'test']]);
    expect([(await ride('mar')).ftpAtRide, (await ride('jun')).ftpAtRide, (await ride('aug')).ftpAtRide, (await ride('ramp')).ftpAtRide, (await ride('nov')).ftpAtRide]).toEqual([222, 244, 244, 250, 250]);
  });
});

describe('the setting, both ways (Part B)', () => {
  beforeEach(async () => {
    await summerRider();
    // Two rides older than anything the data service had: one whose file carries an FTP, one whose file has none.
    await fromService('old-with', '2025-07-01', undefined, fit('2025-07-01', { ftp: 230 }), { source: 'file' });
    await fromService('old-none', '2025-07-08', undefined, fit('2025-07-08'), { source: 'file' });
    await startChangeOver();
  });
  const all = async () => Object.fromEntries(await Promise.all(['old-with', 'old-none', 'mar', 'jun', 'nov'].map(async (id) => [id, (await ride(id)).ftpAtRide])));
  it("Antogo's (the default): the history; before its first entry the device's from the file, or the first entry", async () => {
    expect(await all()).toEqual({ 'old-with': 230, 'old-none': 222, mar: 222, jun: 222, nov: 250 });
  });
  it("the device's: the file's FTP where it carries one, Antogo's history where it doesn't; and back", async () => {
    const before = (await ride('jun')).tss;
    expect(await setFtpScoring('device')).toBe(4);                     // the four whose files carry an FTP other than the history's; the rest already had what the rule gives
    expect(await all()).toEqual({ 'old-with': 230, 'old-none': 222, mar: 222, jun: 244, nov: 210 });
    expect(await setFtpScoring('antogo')).toBe(4);
    expect(await all()).toEqual({ 'old-with': 230, 'old-none': 222, mar: 222, jun: 222, nov: 250 });
    expect((await ride('jun')).tss).toBe(before);
  });
  it('a choice made under the old two-button question is not carried over: everyone starts on Antogo\'s', async () => {
    await db.settings.put({ key: 'ftpSource', value: 'device' });
    await startChangeOver();
    expect((await ride('jun')).ftpAtRide).toBe(222);
    expect(await db.settings.get(FTP_SCORING)).toBeUndefined();
  });
});

describe('an activity you can correct (Part C)', () => {
  // An hour: ten minutes at 100 W and 110 bpm (the car park), then fifty at 200 W and 140 bpm.
  const file = () => fit('2026-08-15', { w: (i) => (i < 600 ? 100 : 200), hr: (i) => (i < 600 ? 110 : 140), ftp: 244 });
  beforeEach(async () => {
    await fromService('a', '2026-08-15', 250, file());
    await fromService('other', '2026-08-20', 250, fit('2026-08-20'));
    await startChangeOver();
  });
  /** The activity as it stands, whatever order its fields are in. */
  const snapshot = async () => { const r = await ride('a'); return Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))); };

  it('C1: FTP for this ride only, labelled, and undone', async () => {
    const before = await snapshot(), other = (await ride('other')).tss;
    await setFix({ id: 'a', date: '2026-08-15' }, { ftp: 240 });
    const r = await ride('a');
    expect(r.ftpAtRide).toBe(240);
    expect(r.intensityFactor).toBe(Math.round((r.normalizedPower! / 240) * 100) / 100);
    expect((await ride('other')).tss).toBe(other);
    expect((await ride('other')).ftpAtRide).toBe(250);
    await setFix({ id: 'a', date: '2026-08-15' }, { ftp: undefined });
    expect(await snapshot()).toEqual(before);
  });
  it('C1: "from this ride onward" adds an entry to the history from that day', async () => {
    const res = await setFromRideOnward({ date: '2026-08-15', sport: 'ride' }, 'ftp', 240);
    expect(res.rides).toBe(2);                                         // this ride and the one after it; the setting follows too
    expect(await ftpHistory()).toContainEqual(['2026-08-15', 240, 'typed']);
    expect((await ride('other')).ftpAtRide).toBe(240);
  });
  it('C2: threshold heart rate for this activity only: its zones and heart-rate load follow, and undone', async () => {
    const before = await snapshot();
    await setFix({ id: 'a', date: '2026-08-15' }, { lthr: 150 });
    const r = await ride('a');
    expect(r.lthrAtRide).toBe(150);
    expect(r.hrZoneSeconds).not.toEqual(before.hrZoneSeconds);
    await setFix({ id: 'a', date: '2026-08-15' }, { lthr: undefined });
    expect(await snapshot()).toEqual(before);
  });
  it('C3: power left out: scored by heart rate, its power numbers gone, out of the power curve; and undone', async () => {
    const before = await snapshot();
    expect((await ride('a')).tssBasis).toBe('power');
    await db.powerCurves.put({ id: 'a', date: '2026-08-15', w: [300, 250, 200] });
    await setFix({ id: 'a', date: '2026-08-15' }, { noPower: true });
    const r = await ride('a');
    expect(r.tssBasis).toBe('heart-rate');
    expect(r.tss!).toBeGreaterThan(0);
    expect([r.normalizedPower, r.averagePower, r.intensityFactor, r.powerZoneSeconds, r.workKj]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(r.averageHr).toBeGreaterThan(0);
    // Out of the power curve and records: the curve kept for it is dropped, a ride with no power is never read for one,
    // and whatever reads its recording finds no power in it.
    expect(await db.powerCurves.get('a')).toBeUndefined();
    expect((await recordingOf('a'))!.watts).toBeUndefined();
    await setFix({ id: 'a', date: '2026-08-15' }, { noPower: undefined });
    expect(await snapshot()).toEqual(before);
    expect((await recordingOf('a'))!.watts).toBeDefined();
  });
  it('C3: heart rate left out: scored by its power, heart-rate numbers gone; and undone', async () => {
    const before = await snapshot();
    await setFix({ id: 'a', date: '2026-08-15' }, { noHr: true });
    const r = await ride('a');
    expect([r.averageHr, r.maxHr, r.hrZoneSeconds, r.efficiencyFactor]).toEqual([undefined, undefined, undefined, undefined]);
    expect(r.tssBasis).toBe('power');
    await setFix({ id: 'a', date: '2026-08-15' }, { noHr: undefined });
    expect(await snapshot()).toEqual(before);
  });
  it('C4: when it started: the activity moves day, and back', async () => {
    const before = await snapshot();
    await setFix({ id: 'a', date: '2026-08-15' }, { start: '2026-08-14T19:30:00' });
    const r = await ride('a');
    expect([r.date, r.startTime]).toEqual(['2026-08-14', '2026-08-14T19:30:00']);
    expect((await db.activityEdits.get('a'))!.date).toBe('2026-08-14');
    expect((await db.files.get('a'))!.date).toBe('2026-08-14');
    await setFix({ id: 'a', date: '2026-08-14' }, { start: undefined });
    expect(await snapshot()).toEqual(before);
  });
  it('C5: a trimmed ride against hand-worked figures; the recording kept whole, and restored', async () => {
    const before = await snapshot();
    const whole = await ride('a');
    // The whole hour: 600 s at 100 W and 3,000 s at 200 W. Normalized power is the fourth-power mean, 192 W; average 183 W.
    expect(whole.normalizedPower).toBe(192);
    expect(whole.averagePower).toBe(183);
    await db.powerCurves.put({ id: 'a', date: '2026-08-15', w: [300, 250, 200] });
    // Leave out the car park: keep 10:00 to the end (3,599 s into the recording).
    await setFix({ id: 'a', date: '2026-08-15' }, { trim: { from: 600, to: 3599 } });
    const r = await ride('a');
    // By hand: 3,000 readings one second apart, so 2,999 s start to finish; every one at 200 W and 140 bpm; 8 m/s.
    expect(r.elapsedSeconds).toBe(2999);
    expect(r.seconds).toBe(2999);
    expect(r.distanceM).toBe(2999 * 8);
    expect(r.normalizedPower).toBe(200);
    expect(r.averagePower).toBe(200);
    expect(r.averageHr).toBe(140);
    expect(r.intensityFactor).toBe(0.8);                               // 200 / 250
    expect(r.workKj).toBe(600);                                        // 200 W x 3,000 s
    expect(r.tss).toBe(Math.round((2999 * 0.8 * 0.8) / 36));           // 53
    expect(r.powerZoneSeconds!.reduce((a, b) => a + b, 0)).toBe(3000);
    // The power curve kept for the whole ride is dropped; whatever reads the recording gets the part kept; the file is whole.
    expect(await db.powerCurves.get('a')).toBeUndefined();
    const part = (await recordingOf('a'))!;
    expect([part.time[0], part.time[part.time.length - 1], Math.min(...part.watts!)]).toEqual([0, 2999, 200]);
    const { wholeRecordingOf } = await import('./ownService');
    expect((await wholeRecordingOf('a'))!.time).toHaveLength(3600);
    // Restore the whole recording.
    await setFix({ id: 'a', date: '2026-08-15' }, { trim: undefined });
    expect(await snapshot()).toEqual(before);
  });

  it('corrections survive a sync: the data service sends the activity as recorded, and they are laid over it again', async () => {
    await setFix({ id: 'a', date: '2026-08-15' }, { ftp: 240, noHr: true, start: '2026-08-14T19:30:00', trim: { from: 600, to: 3599 } });
    const mine = await ride('a');
    // What the next sync brings: the activity untouched, on its recorded day, with the service's own numbers.
    const fresh: Ride = { id: 'a', date: '2026-08-15', startTime: '2026-08-15T09:00:00', name: 'a', type: 'Ride', sport: 'ride', seconds: 3599, elapsedSeconds: 3599, distanceM: 28792, normalizedPower: 193, averagePower: 183, averageHr: 135, maxHr: 141, ftpAtRide: 250, ftpService: 250, hrZoneSeconds: [1, 2, 3] };
    const [laid] = await applyOwnTo([fresh]);
    await rescorer()(laid, (await db.profile.get('me'))!);
    expect(laid).toMatchObject({ date: '2026-08-14', startTime: '2026-08-14T19:30:00', ftpAtRide: 240, seconds: 2999, normalizedPower: 200, tss: mine.tss });
    expect(laid.averageHr).toBeUndefined();
    expect(laid.hrZoneSeconds).toBeUndefined();
  });
  it('corrections on an activity with no recording here survive a sync too', async () => {
    await fromService('bare', '2026-08-22', 250);
    await startChangeOver();
    await setFix({ id: 'bare', date: '2026-08-22' }, { ftp: 235, noHr: true });
    expect(await ride('bare')).toMatchObject({ ftpAtRide: 235, intensityFactor: 0.85 });
    expect((await ride('bare')).averageHr).toBeUndefined();
    const fresh: Ride = { id: 'bare', date: '2026-08-22', startTime: '2026-08-22T09:00:00', name: 'bare', type: 'Ride', sport: 'ride', seconds: 3599, normalizedPower: 200, averagePower: 200, averageHr: 140, ftpAtRide: 250, ftpService: 250 };
    const [laid] = await applyOwnTo([fresh]);
    scoreActivity(laid, (await db.profile.get('me'))!);
    expect(laid).toMatchObject({ ftpAtRide: 235, intensityFactor: 0.85 });
    expect(laid.averageHr).toBeUndefined();
    // Undone: the heart rate set aside comes back.
    await setFix({ id: 'bare', date: '2026-08-22' }, { ftp: undefined, noHr: undefined });
    expect(await ride('bare')).toMatchObject({ ftpAtRide: 250, averageHr: 140 });
  });
  it('corrections, the history and the setting survive a backup and restore', async () => {
    await setHistoryEntry(FTP_HISTORY, '2026-08-18', 246);
    await setFtpScoring('antogo');
    await setFix({ id: 'a', date: '2026-08-15' }, { ftp: 240, trim: { from: 600, to: 3599 } });
    const mine = await ride('a'), other = await ride('other');
    const backup = JSON.stringify(await makeBackup());
    setThresholdCtx(undefined); await db.delete(); await db.open();
    await restoreBackup(backup);
    await startChangeOver();
    expect(await ftpHistory()).toContainEqual(['2026-08-18', 246, 'typed']);
    expect(await ride('a')).toMatchObject({ ftpAtRide: 240, seconds: 2999, normalizedPower: 200, tss: mine.tss });
    expect(await ride('other')).toMatchObject({ ftpAtRide: 246, tss: other.tss });
    expect((await db.activityEdits.get('a'))!.trim).toEqual({ from: 600, to: 3599 });
  });
  it("and a move to another device: the note brings them, and that device's copy of the activity is worked out with them", async () => {
    await setHistoryEntry(FTP_HISTORY, '2026-08-18', 246);
    await setFix({ id: 'a', date: '2026-08-15' }, { ftp: 240, noPower: true });
    const note = await localDoc();
    // The other device: the same activities and files, its own history filled in, none of the corrections yet.
    setThresholdCtx(undefined); await db.delete(); await db.open(); await db.profile.put({ id: 'me', ...profile });
    await fromService('a', '2026-08-15', 250, file());
    await fromService('other', '2026-08-20', 250, fit('2026-08-20'));
    await startChangeOver();
    expect((await ride('a')).normalizedPower).toBe(192);
    await mergeRemote(note);
    await startChangeOver();
    expect(await ftpHistory()).toContainEqual(['2026-08-18', 246, 'typed']);
    expect((await ride('a')).normalizedPower).toBeUndefined();
    expect((await ride('a')).tssBasis).toBe('heart-rate');
    expect((await ride('other')).ftpAtRide).toBe(246);
  });
});

describe('threshold heart rate has a history too (Part D)', () => {
  it('heart-rate zones and heart-rate load use the entry in force on the activity\'s day', async () => {
    await db.rides.put({ id: 'w1', date: '2026-02-01', startTime: '2026-02-01T09:00:00', name: 'Old', type: 'Ride', sport: 'ride', seconds: 3600, averageHr: 140 });
    await db.rides.put({ id: 'w2', date: '2026-09-01', startTime: '2026-09-01T09:00:00', name: 'New', type: 'Ride', sport: 'ride', seconds: 3600, averageHr: 140 });
    await startChangeOver();
    expect([(await ride('w1')).lthrAtRide, (await ride('w2')).lthrAtRide]).toEqual([160, 160]);
    const before = [(await ride('w1')).tss, (await ride('w2')).tss];
    // The rider corrects the list: 160 only since June; before that their threshold was 150.
    await changeHistoryEntry(LTHR_HISTORY, '2026-01-05', '2026-06-01', 160);
    await setHistoryEntry(LTHR_HISTORY, '2025-01-01', 150);
    expect([(await ride('w1')).lthrAtRide, (await ride('w2')).lthrAtRide]).toEqual([150, 160]);
    expect((await ride('w1')).tss!).toBeGreaterThan(before[0]!);       // the same heart rate against a lower threshold costs more
    expect((await ride('w2')).tss).toBe(before[1]);
  });
  it('on foot: the foot history when there is one, else the bike\'s', async () => {
    await db.rides.put({ id: 'run', date: '2026-09-01', startTime: '2026-09-01T09:00:00', name: 'Run', type: 'Run', sport: 'run', seconds: 2400, averageHr: 150 });
    await startChangeOver();
    expect((await ride('run')).lthrAtRide).toBe(160);
    await saveProfile({ ...profile, footLthr: 168 });
    await startChangeOver();
    expect(sorted(await readHistory(FOOT_LTHR_HISTORY)).map((e) => e.value)).toEqual([168]);
    expect((await ride('run')).lthrAtRide).toBe(168);
  });
});

describe('bringing in files that carry FTP settings (Part E)', () => {
  const fileOf = (name: string, bytes: Uint8Array) => new File([bytes as unknown as BlobPart], name);
  it('the summary says what the files say, in periods, and how they will be used, before anything is scored', async () => {
    await fromService('jun', '2026-06-20', 222, fit('2026-06-20'));
    await startChangeOver();                                            // the history begins 20 June 2026
    const files = [fileOf('a.fit', fit('2024-06-01', { ftp: 230 })), fileOf('b.fit', fit('2025-06-01', { ftp: 230 })), fileOf('c.fit', fit('2025-09-01')), fileOf('d.fit', fit('2026-07-01', { ftp: 244 }))];
    const res = await importFiles(files, () => {});
    expect(res.added).toBe(4);
    expect(res.waiting).toBe(true);
    expect(res.ftpFound).toEqual({ periods: periodsOf([{ date: '2024-06-01', value: 230 }, { date: '2025-06-01', value: 230 }, { date: '2026-07-01', value: 244 }]), byDevice: 2, byHistory: 1, byFirst: 1 });
    // Nothing brought in has been scored yet.
    const fresh = (await db.rides.toArray()).filter((r) => r.source === 'file');
    expect(fresh.every((r) => r.tss == null && !r.ownNumbers)).toBe(true);
    // The rider carries on: each is scored as the summary said it would be.
    await finishImport(() => {});
    const by = Object.fromEntries((await db.rides.toArray()).filter((r) => r.source === 'file').map((r) => [r.date, r.ftpAtRide]));
    expect(by).toEqual({ '2024-06-01': 230, '2025-06-01': 230, '2025-09-01': 222, '2026-07-01': 222 });
    expect((await db.rides.toArray()).every((r) => r.tss != null)).toBe(true);
  });
  it('files with no FTP settings are scored at once, as before', async () => {
    const res = await importFiles([fileOf('a.fit', fit('2026-07-01'))], () => {});
    expect(res.waiting).toBeUndefined();
    expect(res.ftpFound).toBeUndefined();
    expect((await db.rides.toArray())[0]).toMatchObject({ ownNumbers: true, ftpAtRide: 250 });
  });
  it('activities left unscored (the app closed at the summary) are scored the next time it opens', async () => {
    await importFiles([fileOf('a.fit', fit('2025-06-01', { ftp: 230 }))], () => {});
    expect((await db.rides.toArray())[0].tss).toBeUndefined();
    setThresholdCtx(undefined);
    await startChangeOver();
    expect((await db.rides.toArray())[0]).toMatchObject({ ownNumbers: true, ftpAtRide: 230 });
  });
});
void refreshThresholds;
