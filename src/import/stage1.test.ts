import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Encoder, Profile as FitProfile } from '@garmin/fitsdk';
import { db } from '../data/db';
import { encodeFitActivity } from '../export/activityFiles';
import { fitType, readActivityFile, fromGpx, fromTcx } from './readers';
import { addActivity, importFiles, mergeFileCopies, rideFromParsed, sameActivity } from './importer';
import { ownNumbers, normalizedPower, perSecond } from '../engine/ownNumbers';
import { POWER_ZONES, HR_ZONES } from '../engine/zones';
import { changeOver, thresholdsFor } from '../sync/ownService';
import { scoreActivity } from '../sync/syncService';
import { checkNumbers } from '../sync/checkNumbers';
import { fillDays, wellnessFromJson } from './wellnessExport';
import type { Profile, Ride, Wellness } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const profile: Profile = { name: 'Sam Example', ftp: 250, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };

/** A ZIP holding several entries, stored, for the export tests. */
function zip(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [], cds: Uint8Array[] = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = new TextEncoder().encode(name);
    const l = new Uint8Array(30 + n.length + data.length), lv = new DataView(l.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, n.length, true);
    l.set(n, 30); l.set(data, 30 + n.length);
    const c = new Uint8Array(46 + n.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, off, true);
    c.set(n, 46);
    parts.push(l); cds.push(c); off += l.length;
  }
  const cdLen = cds.reduce((a, c) => a + c.length, 0);
  const e = new Uint8Array(22), ev = new DataView(e.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, off, true);
  const out = new Uint8Array(off + cdLen + 22);
  let p = 0; for (const x of [...parts, ...cds, e]) { out.set(x, p); p += x.length; }
  return out;
}

const T = Array.from({ length: 3600 }, (_, i) => i);
const rideStreams = { time: T, watts: T.map(() => 200), heartrate: T.map(() => 140), cadence: T.map(() => 90), distance: T.map((i) => i * 8), altitude: T.map((i) => 100 + (i % 600 < 300 ? i % 300 : 300 - (i % 300)) / 10), velocity: T.map(() => 8) };
const appFit = (start = '2026-11-20T08:00:00', streams = rideStreams) => encodeFitActivity({ id: 'x', date: start.slice(0, 10), startTime: start, name: 'R', type: 'Ride', sport: 'ride', seconds: streams.time.length } as Ride, streams);

/** A FIT file written by Garmin's own SDK: a second maker's layout (compressed timestamps aside). */
function garminFit(): Uint8Array {
  const enc = new Encoder();
  const start = new Date('2026-11-18T07:30:00Z');
  enc.onMesg(FitProfile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'garmin', product: 0, timeCreated: start, serialNumber: 1234 } as never);
  for (let i = 0; i < 1800; i++) enc.onMesg(FitProfile.MesgNum.RECORD, { timestamp: new Date(start.getTime() + i * 1000), heartRate: 120, cadence: 85, power: 180, distance: i * 7, enhancedSpeed: 7, enhancedAltitude: 50 } as never);
  enc.onMesg(FitProfile.MesgNum.LAP, { timestamp: new Date(start.getTime() + 1799000), startTime: start, totalElapsedTime: 1800, totalTimerTime: 1800 } as never);
  enc.onMesg(FitProfile.MesgNum.SESSION, { timestamp: new Date(start.getTime() + 1799000), startTime: start, sport: 'cycling', subSport: 'road', totalElapsedTime: 1800, totalTimerTime: 1780, totalDistance: 12600, totalAscent: 40, totalDescent: 38, totalCalories: 400 } as never);
  enc.onMesg(FitProfile.MesgNum.ACTIVITY, { timestamp: new Date(start.getTime() + 1799000), localTimestamp: Math.round((start.getTime() + 1799000) / 1000 - 631065600 - 5 * 3600), numSessions: 1, type: 'manual' } as never);
  return enc.close();
}

beforeEach(async () => { await db.delete(); await db.open(); await db.profile.put({ id: 'me', ...profile }); });

describe('reading activity files of any maker', () => {
  it('a FIT file from Garmin\'s own SDK: summary, local time from the file, and the recording', async () => {
    const p = (await readActivityFile('a.fit', garminFit()))!;
    expect(p.type).toBe('Ride');
    expect(p.startLocal).toBe('2026-11-18T02:30:00');   // the file's own local time (five hours behind)
    expect(p.elapsedS).toBe(1800);
    expect(p.movingS).toBe(1780);
    expect(p.distanceM).toBe(12600);
    expect(p.ascentM).toBe(40);
    expect(p.device).toBe('Garmin');
    expect(p.streams!.watts![100]).toBe(180);
  });
  it('the app\'s own FIT layout, compressed and zipped too', async () => {
    const f = appFit();
    const gz = new Uint8Array(await new Response(new Blob([f as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    for (const b of [f, gz, zip([['ride.fit', f]])]) {
      const p = (await readActivityFile('x', b))!;
      expect(p.streams!.heartrate![10]).toBe(140);
      expect(p.elapsedS).toBeGreaterThanOrEqual(3599);
    }
  });
  it('TCX and GPX', () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Biking"><Lap StartTime="2026-11-10T12:00:00Z"><TotalTimeSeconds>120</TotalTimeSeconds><DistanceMeters>900</DistanceMeters><Calories>30</Calories><Track>${Array.from({ length: 121 }, (_, i) => `<Trackpoint><Time>${new Date(Date.parse('2026-11-10T12:00:00Z') + i * 1000).toISOString()}</Time><HeartRateBpm><Value>130</Value></HeartRateBpm><Cadence>88</Cadence><Extensions><ns3:TPX><ns3:Watts>210</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`).join('')}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const t = fromTcx(tcx)!;
    expect(t.type).toBe('Ride'); expect(t.movingS).toBe(120); expect(t.distanceM).toBe(900); expect(t.streams!.watts![5]).toBe(210); expect(t.streams!.heartrate![5]).toBe(130);
    const gpx = `<gpx creator="Some app"><trk><type>running</type><trkseg>${Array.from({ length: 61 }, (_, i) => `<trkpt lat="${38.9 + i * 0.0001}" lon="-77.3"><ele>100</ele><time>${new Date(Date.parse('2026-11-10T12:00:00Z') + i * 1000).toISOString()}</time><extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt>`).join('')}</trkseg></trk></gpx>`;
    const g = fromGpx(gpx)!;
    expect(g.type).toBe('Run'); expect(g.elapsedS).toBe(60); expect(g.distanceM).toBeGreaterThan(600); expect(g.distanceM).toBeLessThan(700); expect(g.streams!.heartrate![3]).toBe(150);
  });
  it('FIT sports to activity kinds', () => {
    expect(fitType(2, 58)).toBe('VirtualRide'); expect(fitType(10, 20)).toBe('WeightTraining'); expect(fitType(10, 43)).toBe('Yoga'); expect(fitType(11)).toBe('Walk'); expect(fitType(99)).toBe('Other');
  });
});

describe('the duplicate rule, at its edges', () => {
  const r = (start: string, s: number, sport: Ride['sport'] = 'ride') => ({ sport, startTime: start, seconds: s, elapsedSeconds: s });
  it('starts within two minutes, lasting within a tenth, the same kind', () => {
    expect(sameActivity(r('2026-11-20T08:00:00', 3600), r('2026-11-20T08:02:00', 3600))).toBe(true);
    expect(sameActivity(r('2026-11-20T08:00:00', 3600), r('2026-11-20T08:02:01', 3600))).toBe(false);
    expect(sameActivity(r('2026-11-20T08:00:00', 3600), r('2026-11-20T08:00:00', 4000))).toBe(true);    // 10% of 4000
    expect(sameActivity(r('2026-11-20T08:00:00', 3600), r('2026-11-20T08:00:00', 4001))).toBe(false);
    expect(sameActivity(r('2026-11-20T08:00:00', 3600), r('2026-11-20T08:00:00', 3600, 'walk'))).toBe(false);
  });
});

describe('Antogo\'s own numbers, against hand-worked figures', () => {
  const ctx = { sport: 'ride' as const, ftp: 250, lthr: 160, powerZones: POWER_ZONES, hrZones: HR_ZONES, has: {} };
  it('an hour at a steady 200 W', () => {
    const n = ownNumbers(rideStreams, ctx);
    expect(n.normalizedPower).toBe(200); expect(n.averagePower).toBe(200); expect(n.intensityFactor).toBe(0.8); expect(n.variabilityIndex).toBe(1);
    expect(n.workKj).toBe(720); expect(n.workAboveFtpKj).toBe(0);
    expect(n.powerZoneSeconds![2]).toBe(3600);                 // 80% of FTP: zone 3
    expect(n.averageHr).toBe(140); expect(n.maxHr).toBe(140); expect(n.efficiencyFactor).toBe(1.43); expect(n.decoupling).toBe(0);
    expect(n.averageCadence).toBe(90); expect(n.coastingSeconds).toBe(0); expect(n.maxSpeedMs).toBe(8);
    expect(n.calories).toBe(720);
    expect(n.carbsUsedG).toBe(Math.round((720 * (0.2 + 1.5 * 0.3)) / 4)); expect(n.carbsEstimated).toBe(true);
  });
  it('half an hour at 100 W then half at 300 W: normalized power above the average', () => {
    const w = T.map((i) => (i < 1800 ? 100 : 300));
    const n = ownNumbers({ ...rideStreams, watts: w }, ctx);
    expect(n.averagePower).toBe(200);
    const hand = ((100 ** 4 + 300 ** 4) / 2) ** 0.25;            // ignoring the half minute of change
    expect(Math.abs(n.normalizedPower! - hand)).toBeLessThanOrEqual(3);
    expect(n.workAboveFtpKj).toBe(90);                          // 50 W over FTP for 1800 s
  });
  it('a pause is not counted, a short gap is filled', () => {
    const time = [0, 1, 2, 5, 6, 60, 61];
    expect(perSecond(time, [100, 100, 100, 100, 100, 100, 100]).filter((x) => x != null)).toHaveLength(9);   // 0-6 (3 and 4 filled, a gap of 3 s), then 60-61; 7-59 a pause
    expect(normalizedPower(new Array(60).fill(250))).toBe(250);
  });
  it('drift: the second half\'s power per heartbeat falling behind the first', () => {
    const n = ownNumbers({ ...rideStreams, heartrate: T.map((i) => (i < 1800 ? 140 : 154)) }, ctx);
    expect(n.decoupling).toBeCloseTo(9.1, 1);
  });
  it('scored with the FTP of the day where the activity carries it', () => {
    expect(thresholdsFor({ sport: 'ride', ftpAtRide: 230 }, profile).ftp).toBe(230);
    expect(thresholdsFor({ sport: 'ride' }, profile).ftp).toBe(250);
    expect(thresholdsFor({ sport: 'walk' }, profile).lthr).toBe(160);
  });
});

const fileOf = (name: string, bytes: Uint8Array) => new File([bytes as unknown as BlobPart], name);

describe('bringing files in', () => {
  it('adds a new activity with Antogo\'s numbers; the same file again is already here', async () => {
    let r = await importFiles([fileOf('a.fit', appFit())], () => {});
    expect(r).toMatchObject({ added: 1, already: 0 });
    const [ride] = await db.rides.toArray();
    expect(ride.source).toBe('file');
    expect(ride.ownNumbers).toBe(true);
    expect(ride.normalizedPower).toBe(200);
    expect(ride.tss).toBe(64);                                  // an hour at 0.8: 64
    expect(ride.name).toBe('Morning ride');
    expect((await db.files.get(ride.id))?.status).toBe('kept');
    r = await importFiles([fileOf('a again.fit', appFit())], () => {});
    expect(r).toMatchObject({ added: 0, already: 1 });
    expect(await db.rides.count()).toBe(1);
  });
  it('a file for an activity already here from the data service is kept with it, not added', async () => {
    const icu: Ride = { id: 'i555', date: '2026-11-20', startTime: '2026-11-20T08:01:00', name: 'Herndon', type: 'Ride', sport: 'ride', seconds: 3590, elapsedSeconds: 3600 };
    await db.rides.put(icu);
    const r = await importFiles([fileOf('a.fit', appFit())], () => {});
    expect(r).toMatchObject({ added: 0, already: 1 });
    expect((await db.files.get('i555'))?.status).toBe('kept');
  });
  it('a file brought in first, and the same activity later from the data service, become one', async () => {
    const added = await addActivity((await readActivityFile('a.fit', appFit()))!, appFit(), profile);
    expect(added).not.toBe('already');
    const fileId = (added as Ride).id;
    await db.planned.put({ id: 'p1', date: '2026-11-20', workoutId: 'w', basis: 'power', status: 'completed', activityId: fileId });
    await db.rides.put({ id: 'i777', date: '2026-11-20', startTime: '2026-11-20T08:00:30', name: 'From the service', type: 'Ride', sport: 'ride', seconds: 3600 });
    expect(await mergeFileCopies()).toBe(1);
    expect(await db.rides.get(fileId)).toBeUndefined();
    expect((await db.files.get('i777'))?.status).toBe('kept');
    expect((await db.planned.get('p1'))?.activityId).toBe('i777');
  });
  it('an unreadable file is named, with why', async () => {
    const r = await importFiles([fileOf('notes.fit', new Uint8Array([1, 2, 3]))], () => {});
    expect(r.unreadable[0]).toMatchObject({ name: 'notes.fit' });
    expect(r.added).toBe(0);
  });
});

describe('a whole-account export, wellness included', () => {
  it('reads the activities inside its own archives and the days of wellness, filling only what is missing', async () => {
    await db.wellness.put({ date: '2026-11-15', hrv: 70 } as Wellness);
    const inner = zip([['8_ACTIVITY.fit', garminFit()]]);
    const sleep = new TextEncoder().encode(JSON.stringify([{ calendarDate: '2026-11-15', deepSleepSeconds: 5000, lightSleepSeconds: 15000, remSleepSeconds: 6000, sleepScores: { overallScore: 81 }, averageRespiration: 14 }]));
    const uds = new TextEncoder().encode(JSON.stringify([{ calendarDate: { date: '2026-11-15' }, restingHeartRate: 48, totalSteps: 9000 }, { calendarDate: '2026-11-16', restingHeartRate: 49 }]));
    const hrv = new TextEncoder().encode(JSON.stringify([{ calendarDate: '2026-11-15', hrvSummary: { lastNightAvg: 55 } }]));
    const other = new TextEncoder().encode(JSON.stringify({ nothing: 'here' }));
    const exportZip = zip([
      ['DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip', inner],
      ['DI_CONNECT/DI-Connect-Wellness/123_sleepData.json', sleep],
      ['DI_CONNECT/DI-Connect-Aggregator/UDSFile_2026-11-01_2026-11-30.json', uds],
      ['DI_CONNECT/DI-Connect-Wellness/123_hrvData.json', hrv],
      ['DI_CONNECT/DI-Connect-Wellness/123_unknownMetrics.json', other],
    ]);
    const r = await importFiles([fileOf('export.zip', exportZip)], () => {});
    expect(r.added).toBe(1);
    expect(r.wellnessDays).toBe(2);
    const d15 = (await db.wellness.get('2026-11-15'))!;
    expect(d15.hrv).toBe(70);                                   // what was here stays
    expect(d15.sleepSeconds).toBe(26000); expect(d15.sleepScore).toBe(81); expect(d15.restingHr).toBe(48); expect(d15.steps).toBe(9000); expect(d15.respiration).toBe(14);
    expect((await db.wellness.get('2026-11-16'))?.restingHr).toBe(49);
    expect(r.notRead.some((n) => n.includes('unknownMetrics'))).toBe(true);
  });
  it('fills days without replacing', () => {
    const have = new Map<string, Wellness>([['2026-01-01', { date: '2026-01-01', restingHr: 50 }]]);
    const add = fillDays(have, new Map([['2026-01-01', { restingHr: 60, hrv: 40 }], ['2026-01-02', { hrv: 41 }]]));
    expect(add).toEqual([{ date: '2026-01-01', restingHr: 50, hrv: 40 }, { date: '2026-01-02', hrv: 41 }]);
    expect(wellnessFromJson([{ calendarDate: '2026-01-03', metrics: [{ type: 'HRV', value: 62 }] }]).get('2026-01-03')).toEqual({ hrv: 62 });
  });
});

describe('the change-over of activities already here', () => {
  it('an activity from the data service with a kept file gets Antogo\'s numbers; what it came with is kept for the check', async () => {
    const icu: Ride = { id: 'i900', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'Herndon', type: 'Ride', sport: 'ride', seconds: 3600, normalizedPower: 205, averagePower: 198, icuLoad: 67, ftpAtRide: 250 };
    await db.rides.put(icu);
    await db.files.put({ id: 'i900', date: icu.date, status: 'kept', bytes: appFit(), size: 1, at: 'x' });
    expect(await changeOver(scoreActivity, () => {})).toBe(1);
    const r = (await db.rides.get('i900'))!;
    expect(r.ownNumbers).toBe(true);
    expect(r.normalizedPower).toBe(200);
    expect(r.tss).toBe(64);
    const rec = (await db.own.get('i900'))!;
    expect(rec.came?.normalizedPower).toBe(205);
    // Nothing to do the second time; a changed FTP (none carried by the activity) would be worked out again.
    expect(await changeOver(scoreActivity, () => {})).toBe(0);
    const checks = checkNumbers(await db.rides.toArray(), await db.own.toArray());
    const np = checks.find((c) => c.key === 'normalizedPower')!;
    expect(np).toMatchObject({ n: 1, within: 0 });              // 200 against 205: 2.4% apart
    expect(checks.find((c) => c.key === 'averagePower')).toMatchObject({ n: 1, within: 1 });   // 200 against 198
  });
  it('a ride with no FTP of its own is worked out again when the FTP changes', async () => {
    const icu: Ride = { id: 'i901', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'Herndon', type: 'Ride', sport: 'ride', seconds: 3600 };
    await db.rides.put(icu);
    await db.files.put({ id: 'i901', date: icu.date, status: 'kept', bytes: appFit(), size: 1, at: 'x' });
    await changeOver(scoreActivity, () => {});
    expect((await db.rides.get('i901'))!.intensityFactor).toBe(0.8);
    await db.profile.put({ id: 'me', ...profile, ftp: 200 });
    expect(await changeOver(scoreActivity, () => {})).toBe(1);
    expect((await db.rides.get('i901'))!.intensityFactor).toBe(1);
  });
});

void rideFromParsed;
