import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Encoder, Profile as FitProfile } from '@garmin/fitsdk';
import { db } from '../data/db';
import { readFitActivity } from '../player/fitRecording';
import { NOT_ACTIVITY, readActivityFile, type ParsedActivity } from './readers';
import { addActivity, importBatches, importFiles, sameActivity, undoImport } from './importer';
import { ownNumbers, perSecond } from '../engine/ownNumbers';
import { POWER_ZONES, HR_ZONES } from '../engine/zones';
import { scoreActivity } from '../sync/syncService';
import { workOut } from '../sync/ownService';
import { crc32, zipEntries, zipRead, zipStore } from './zip';
import { backupSummaryOf, makeBackupArchive, restoreBackupFile, BACKUP_DOC } from '../data/backup';
import { toRide } from '../sync/intervals';
import type { Profile, Ride } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const profile: Profile = { name: 'Sam Example', ftp: 250, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };
const ctx = { sport: 'ride' as const, ftp: 250, lthr: 160, powerZones: POWER_ZONES, hrZones: HR_ZONES, has: {} };
const FIT0 = 631065600;

/** A FIT activity from Garmin's own kit: records as given (seconds from the start), timer events, and a session. */
function fit(o: { start: number; records: Array<{ t: number; w?: number; hr?: number; cad?: number; spd?: number }>; events?: Array<{ t: number; type: 'start' | 'stopAll' }>; ftp?: number; kcal?: number; fileType?: string; sessions?: boolean }): Uint8Array {
  const e = new Encoder();
  const N = FitProfile.MesgNum;
  const at = (t: number) => o.start - FIT0 + t;
  e.onMesg(N.FILE_ID, <never>{ type: o.fileType ?? 'activity', manufacturer: 'garmin', product: 1, timeCreated: at(0) });
  const all: Array<{ t: number; kind: 'r' | 'e'; x: unknown }> = [...o.records.map((r) => ({ t: r.t, kind: 'r' as const, x: r })), ...(o.events ?? []).map((ev) => ({ t: ev.t, kind: 'e' as const, x: ev }))].sort((a, b) => a.t - b.t || (a.kind === 'e' ? -1 : 1));
  for (const m of all) {
    if (m.kind === 'e') e.onMesg(N.EVENT, <never>{ timestamp: at(m.t), event: 'timer', eventType: (m.x as { type: string }).type });
    else { const r = m.x as { t: number; w?: number; hr?: number; cad?: number; spd?: number }; e.onMesg(N.RECORD, <never>{ timestamp: at(r.t), ...(r.w != null ? { power: r.w } : {}), ...(r.hr != null ? { heartRate: r.hr } : {}), ...(r.cad != null ? { cadence: r.cad } : {}), ...(r.spd != null ? { enhancedSpeed: r.spd } : {}) }); }
  }
  const last = o.records.length ? o.records[o.records.length - 1].t : 0;
  if (o.sessions !== false) {
    e.onMesg(N.SESSION, <never>{ timestamp: at(last), startTime: at(0), sport: 'cycling', subSport: 'road', totalElapsedTime: last, totalTimerTime: last, ...(o.ftp ? { thresholdPower: o.ftp } : {}), ...(o.kcal ? { totalCalories: o.kcal } : {}) });
    e.onMesg(N.ACTIVITY, <never>{ timestamp: at(last), localTimestamp: at(last) - 4 * 3600, numSessions: 1 });
  }
  return e.close();
}
const fileOf = (name: string, bytes: Uint8Array) => new File([bytes as unknown as BlobPart], name);
const START = Date.UTC(2026, 6, 24, 13, 0, 0) / 1000;
const every = (n: number, f: (i: number) => { w?: number; hr?: number; cad?: number; spd?: number }) => Array.from({ length: n }, (_, i) => ({ t: i, ...f(i) }));

beforeEach(async () => { await db.delete(); await db.open(); await db.profile.put({ id: 'me', ...profile }); });

describe('pauses are the device\'s own', () => {
  it('reads the timer\'s stops and starts, the FTP of the day and the file\'s kind', () => {
    const recs = [...every(100, () => ({ w: 200, hr: 140 })), ...Array.from({ length: 100 }, (_, i) => ({ t: 400 + i, w: 200, hr: 140 }))];
    const { streams, summary } = readFitActivity(fit({ start: START, records: recs, events: [{ t: 0, type: 'start' }, { t: 100, type: 'stopAll' }, { t: 400, type: 'start' }], ftp: 244, kcal: 300 }));
    expect(streams!.pauses).toEqual([[100, 400]]);
    expect(summary).toMatchObject({ thresholdPower: 244, calories: 300, fileType: 4 });
  });
  it('a long gap while the timer ran is riding (a device that records only on change); the same gap in a pause is not', () => {
    const time = [0, 1, 2, 22, 23], v = [100, 100, 100, 100, 100];
    expect(perSecond(time, v, []).filter((x) => x != null)).toHaveLength(24);
    expect(perSecond(time, v, [[3, 21]]).filter((x) => x != null)).toHaveLength(5);
    // With no word from the device, the old rule: a gap of more than five seconds is a pause.
    expect(perSecond(time, v).filter((x) => x != null)).toHaveLength(5);
  });
});

describe('a power meter that dropped out', () => {
  const T = Array.from({ length: 3000 }, (_, i) => i);
  const s = { time: T, watts: T.map((i) => (i < 1200 ? 200 : null)), heartrate: T.map(() => 120) };
  it('keeps how much of the ride has power, averages only what was recorded, and gives no drift', () => {
    const n = ownNumbers(s, ctx);
    expect(n.powerCoverage).toBe(0.4);
    expect(n.averagePower).toBe(200);
    expect(n.decoupling).toBeUndefined();
  });
  it('is scored by heart rate, and a whole recording by power', () => {
    const base: Ride = { id: 'a', date: '2026-07-24', startTime: '2026-07-24T09:00:00', name: 'x', type: 'Ride', sport: 'ride', seconds: 3000, normalizedPower: 200, averageHr: 120 };
    const part = { ...base, powerCoverage: 0.4 }; scoreActivity(part, profile);
    const whole = { ...base, powerCoverage: 1 }; scoreActivity(whole, profile);
    expect(part.tssBasis).toBe('heart-rate');
    expect(whole.tssBasis).toBe('power');
    // No heart rate to fall back on: power is still the best there is.
    const noHr = { ...base, averageHr: undefined, powerCoverage: 0.4 }; scoreActivity(noHr, profile);
    expect(noHr.tssBasis).toBe('power');
  });
});

describe('the other numbers put right', () => {
  const T = Array.from({ length: 600 }, (_, i) => i);
  it('energy burned is the device\'s when it gave one, from work otherwise', () => {
    const s = { time: T, watts: T.map(() => 200) };
    expect(ownNumbers(s, { ...ctx, has: { calories: 274 } }).calories).toBeUndefined();
    expect(ownNumbers(s, ctx).calories).toBe(120);
  });
  it('the device\'s energy figure survives being worked out twice', async () => {
    const r: Ride = { id: 'i1', date: '2026-07-24', startTime: '2026-07-24T09:00:00', name: 'x', type: 'Ride', sport: 'ride', seconds: 600, calories: 274 };
    const s = { id: 'i1', time: T, watts: T.map(() => 200) };
    const one = await workOut(r, profile, s);
    expect(one!.nums.calories).toBe(274);
    // As the first build left it: Antogo's work figure laid over the device's, the device's remembered.
    await db.own.update('i1', { nums: { ...one!.nums, calories: 120 } });
    const two = await workOut({ ...r, calories: 120, ownNumbers: true }, profile, s);
    expect(two!.nums.calories).toBe(274);
  });
  it('max heart rate must be held for three seconds', () => {
    const hr = T.map((i) => (i === 300 ? 199 : i >= 400 && i < 404 ? 171 : 150));
    expect(ownNumbers({ time: T, heartrate: hr }, ctx).maxHr).toBe(171);
  });
  it('coasting is moving without driving the bike: cranks still, or no power', () => {
    const cad = T.map((i) => (i < 100 ? 0 : 90)), w = T.map((i) => (i < 150 ? 0 : 200)), spd = T.map((i) => (i < 20 ? 0 : 8));
    expect(ownNumbers({ time: T, cadence: cad, watts: w, velocity: spd }, ctx).coastingSeconds).toBe(130);
  });
  it('drift from Intervals.icu is turned the app\'s way up: positive when heart rate rose for the same power', () => {
    const r = toRide({ id: 'i9', start_date_local: '2026-07-22T08:00:00', start_date: '2026-07-22T12:00:00Z', type: 'Ride', moving_time: 3600, decoupling: -20.2 } as never);
    expect(r.decoupling).toBe(20.2);
    expect(r.startUtc).toBe('2026-07-22T12:00:00.000Z');
  });
});

describe('one activity across time zones', () => {
  const a = { sport: 'ride' as const, startTime: '2026-05-01T09:00:00', seconds: 3600, distanceM: 30000 };
  it('the same moment in time, whatever the clocks say', () => {
    expect(sameActivity({ ...a, startUtc: '2026-05-01T07:00:00.000Z' }, { ...a, startTime: '2026-05-01T03:00:00', startUtc: '2026-05-01T07:01:00.000Z' })).toBe(true);
    expect(sameActivity({ ...a, startUtc: '2026-05-01T07:00:00.000Z' }, { ...a, startUtc: '2026-05-01T13:00:00.000Z' })).toBe(false);
  });
  it('only clock times, a whole zone step apart: the same when they last the same and went as far', () => {
    const abroad = { ...a, startTime: '2026-05-01T15:00:20' };
    expect(sameActivity(a, abroad)).toBe(true);
    expect(sameActivity(a, { ...abroad, seconds: 3700 })).toBe(false);
    expect(sameActivity(a, { ...abroad, distanceM: 31000 })).toBe(false);
    // Not a zone step apart: two different rides.
    expect(sameActivity(a, { ...a, startTime: '2026-05-01T15:07:00' })).toBe(false);
  });
});

describe('bringing files in, hardened', () => {
  const ride = (start = START, extra: Partial<Parameters<typeof fit>[0]> = {}) => fit({ start, records: every(1800, () => ({ w: 180, hr: 130, cad: 85, spd: 8 })), events: [{ t: 0, type: 'start' }], ...extra });
  it('a device file that is not an activity is passed over and counted, not listed as a failure', async () => {
    const monitoring = fit({ start: START, records: [], fileType: 'monitoringB', sessions: false });
    expect(await readActivityFile('m.fit', monitoring)).toBe(NOT_ACTIVITY);
    const r = await importFiles([fileOf('m.fit', monitoring), fileOf('a.fit', ride())], () => {});
    expect(r).toMatchObject({ added: 1, notActivities: 1, unreadable: [] });
  });
  it('the FTP of the day stays with the activity: the file\'s own, else the nearest known, and a later change of FTP does not rescore it', async () => {
    const own = await addActivity((await readActivityFile('a.fit', ride(START, { ftp: 244 }))) as ParsedActivity, ride(), profile) as Ride;
    expect(own.ftpAtRide).toBe(244);
    await db.rides.put({ id: 'i1', date: '2026-07-01', startTime: '2026-07-01T09:00:00', name: 'x', type: 'Ride', sport: 'ride', seconds: 3600, ftpAtRide: 230 });
    const later = START + 86400 * 3;
    const near = await addActivity((await readActivityFile('b.fit', ride(later))) as ParsedActivity, ride(later), profile) as Ride;
    expect(near.ftpAtRide).toBe(244);
    expect(near.intensityFactor).toBe(Math.round((180 / 244) * 100) / 100);
  });
  it('a run of bringing files in can be undone: its activities and the wellness it added go, what was here stays', async () => {
    await db.wellness.put({ date: '2026-07-01', restingHr: 50 });
    const well = new TextEncoder().encode(JSON.stringify([{ calendarDate: '2026-07-01', restingHeartRate: 61, totalSteps: 9000 }, { calendarDate: '2026-07-02', restingHeartRate: 49 }]));
    const r = await importFiles([fileOf('a.fit', ride()), fileOf('DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026.json', well)], () => {});
    expect(r).toMatchObject({ added: 1, wellnessDays: 2 });
    expect(await db.wellness.get('2026-07-01')).toMatchObject({ restingHr: 50, steps: 9000 });
    const [b] = await importBatches();
    expect(b.id).toBe(r.batchId);
    expect(await undoImport(b.id)).toEqual({ rides: 1, days: 2 });
    expect(await db.rides.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
    expect(await db.wellness.get('2026-07-01')).toEqual({ date: '2026-07-01', restingHr: 50 });
    expect(await db.wellness.get('2026-07-02')).toBeUndefined();
    expect(await importBatches()).toEqual([]);
  });
});

describe('the backup as an archive', () => {
  it('a ZIP written here reads back, entry for entry', async () => {
    const a = new TextEncoder().encode('hello'), b = new Uint8Array(70000).map((_, i) => i % 251);
    expect(crc32(a)).toBe(0x3610a686);
    const z = zipStore([{ name: 'a.txt', data: a }, { name: 'dir/b.bin', data: b }]);
    const es = await zipEntries(z);
    expect(es.map((e) => e.name)).toEqual(['a.txt', 'dir/b.bin']);
    expect(new TextDecoder().decode(await zipRead(z, es[0]))).toBe('hello');
    expect(await zipRead(z, es[1])).toEqual(b);
  });
  it('holds the document and each original file beside it, and restores both on a fresh device', async () => {
    const bytes = fit({ start: START, records: every(60, () => ({ w: 150 })) });
    await db.rides.put({ id: 'i1', date: '2026-07-24', startTime: '2026-07-24T09:00:00', name: 'x', type: 'Ride', sport: 'ride', seconds: 60 });
    await db.files.put({ id: 'i1', date: '2026-07-24', status: 'kept', bytes, size: bytes.byteLength, at: '2026-11-22T00:00:00Z' });
    await db.files.put({ id: 'i2', date: '2026-07-25', status: 'none', at: '2026-11-22T00:00:00Z' });
    const z = await makeBackupArchive();
    const names = (await zipEntries(z)).map((e) => e.name);
    expect(names).toEqual([BACKUP_DOC, 'activity-files/2026-07-24_i1.fit']);
    // The document itself carries no file as text.
    expect(new TextDecoder().decode(await zipRead(z, (await zipEntries(z))[0]))).not.toContain('b64');
    expect((await backupSummaryOf(z)).words).toContain('1 activity, 1 original activity file');
    await db.delete(); await db.open();
    await restoreBackupFile(z);
    expect((await db.rides.get('i1'))?.name).toBe('x');
    expect((await db.files.get('i1'))?.bytes).toEqual(bytes);
    expect((await db.files.get('i2'))?.status).toBe('none');
  });
});
