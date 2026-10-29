import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { db, saveProfile } from '../data/db';
import { buildTimeline } from './timeline';
import { RideEngine } from './engine';
import { bestAverage, rampResult, resultFromStreams, testLines, twentyMinResult, vo2maxFromPeak } from './tests';
import { sentRidesAhead, zonesFollowFtp } from '../ui/testService';
import type { Recording, Sample } from './types';

const profile: Profile = { name: 'T', ftp: 225, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const ramp = LIBRARY.find((w) => w.id === 'lib-ramp')!;
const t20 = LIBRARY.find((w) => w.id === 'lib-20min')!;

/** Ride the ramp in the engine with a rider who holds every target, then press Stop at `stopAt` seconds into the workout. */
function rideRamp(stopAt: number, hr?: (target: number) => number) {
  const tl = buildTimeline(ramp, profile, { rampStep: 20 });
  const e = new RideEngine({ timeline: tl, ftp: profile.ftp, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
  for (let t = 1; t <= 3; t++) e.tick(t * 1000, { watts: 0, cadence: 90 });
  let t = 4;
  while (e.position < stopAt) { const w = e.ergTarget()!; e.tick(t++ * 1000, { watts: w, cadence: 90, bpm: hr?.(w) }); }
  e.endTest(t * 1000, 'rider');
  for (let i = 0; i < 5; i++) { const w = e.ergTarget()!; e.tick(t++ * 1000, { watts: w, cadence: 90, bpm: hr?.(w) }); }
  const rec = { samples: e.samples, rampStep: 20, rampEndAt: e.rampEndAt, events: e.events } as Pick<Recording, 'samples' | 'rampStep' | 'rampEndAt' | 'events'>;
  return { rec, tl };
}

describe('best average', () => {
  it('finds the highest sixty seconds anywhere', () => {
    const xs = [...Array(100).fill(200), ...Array(60).fill(300), ...Array(30).fill(100)];
    expect(bestAverage(xs, 60)).toBe(300);
    expect(bestAverage(xs.slice(0, 50), 60)).toBeUndefined();
  });
  it('counts missing readings as zero', () => {
    expect(bestAverage([100, undefined, 100, 100], 2)).toBe(100);
    expect(bestAverage([100, undefined], 2)).toBe(50);
  });
});

describe('the Ramp Test’s results (C1)', () => {
  // Steps: 124, 144, 164, … ; step 10 is 304 W, step 11 is 324 W. Stop 20 s into step 11.
  const stopAt = 300 + 10 * 60 + 20;
  const { rec, tl } = rideRamp(stopAt, (w) => Math.round(100 + w / 4));
  const r = rampResult(rec, tl, profile.weightKg);
  it('best minute is the hardest sixty seconds (here 40 s at 304 W and the last 20 s at 324 W), FTP is 75% of it', () => {
    expect(r.bestMinuteWatts).toBe(311);
    expect(r.ftpEstimate).toBe(233);
  });
  it('peak power is the last full step plus the share of the unfinished one', () => {
    expect(r.peakWatts).toBeCloseTo(304 + (20 / 60) * 20, 1);
  });
  it('VO2max comes from peak power, and per kilo from the weight', () => {
    const v = vo2maxFromPeak(304 + 20 / 3, 80);
    expect(r.vo2maxLmin).toBe(v.lmin);
    expect(r.vo2maxMlKgMin).toBe(v.mlKgMin);
    expect(vo2maxFromPeak(300).lmin).toBeCloseTo(0.01141 * 300 + 0.435, 2);
    expect(vo2maxFromPeak(300).mlKgMin).toBeUndefined();
    expect(vo2maxFromPeak(300, 75).mlKgMin).toBe(Math.round(((0.01141 * 300 + 0.435) * 1000 / 75) * 10) / 10);
  });
  it('heart rate at the new FTP is the minute the ramp first passed it (the 244 W step)', () => {
    expect(r.hrAtFtp).toBe(Math.round(100 + 244 / 4));
  });
  it('remembers who ended it and the step size', () => {
    expect(r.endedBy).toBe('rider');
    expect(r.stepWatts).toBe(20);
  });
  it('no heart-rate strap, no heart rate at FTP', () => {
    const plain = rideRamp(stopAt);
    expect(rampResult(plain.rec, plain.tl).hrAtFtp).toBeUndefined();
  });
  it('a stop exactly on a step boundary: peak is that last full step', () => {
    const b = rideRamp(300 + 10 * 60);
    expect(rampResult(b.rec, b.tl).peakWatts).toBe(304);
  });
  it('reads as plain lines for the activity’s description', () => {
    const lines = testLines(r);
    expect(lines[0]).toBe('Best minute: 311 W');
    expect(lines[1]).toMatch(/^FTP estimate: 233 W/);
    expect(lines.some((l) => l.startsWith('VO2max estimate:'))).toBe(true);
  });
});

describe('the 20-minute test (C4)', () => {
  const tl = buildTimeline(t20, profile);
  const test = tl.find((s) => s.name === 'Test')!;
  const samples = (minutes: number, w: number, hrFirst: number, hrLast: number): Sample[] =>
    Array.from({ length: minutes * 60 }, (_, i) => ({ t: test.start + i, s: test.index, w, hr: i < 300 ? hrFirst : hrLast }));
  it('FTP is 95% of the twenty minutes; threshold heart rate is the last fifteen minutes', () => {
    const r = twentyMinResult({ samples: samples(20, 250, 140, 162) }, tl);
    expect(r.testWatts).toBe(250);
    expect(r.ftpEstimate).toBe(238);
    expect(r.lthrEstimate).toBe(162);
  });
  it('nothing when the twenty minutes weren’t ridden', () => {
    expect(twentyMinResult({ samples: samples(12, 250, 140, 162) }, tl).ftpEstimate).toBeUndefined();
  });
  it('from Intervals.icu’s streams: the best twenty minutes and the heart rate over their last fifteen', () => {
    const watts = [...Array(1500).fill(150), ...Array(1200).fill(260), ...Array(600).fill(120)];
    const hr = [...Array(1500).fill(120), ...Array(300).fill(150), ...Array(900).fill(165), ...Array(600).fill(130)];
    const r = resultFromStreams('20min', watts, hr);
    expect(r.testWatts).toBe(260);
    expect(r.ftpEstimate).toBe(247);
    expect(r.lthrEstimate).toBe(165);
    expect(r.fromStreams).toBe(true);
  });
  it('a Garmin file that skipped quiet seconds is laid out by its own timestamps first', () => {
    // Every other second recorded: 20 minutes at 260 W span 1200 s of time but only 600 readings.
    const time = Array.from({ length: 600 }, (_, i) => i * 2);
    const r = resultFromStreams('20min', Array(600).fill(260), Array(600).fill(160), undefined, time);
    expect(r.testWatts).toBe(260);
    expect(r.lthrEstimate).toBe(160);
    expect(resultFromStreams('20min', Array(600).fill(260), undefined).ftpEstimate).toBeUndefined();
  });
  it('the ramp from streams: the best minute, and VO2max from it', () => {
    const r = resultFromStreams('ramp', [...Array(600).fill(150), ...Array(60).fill(320), ...Array(60).fill(100)], undefined, 80);
    expect(r.bestMinuteWatts).toBe(320);
    expect(r.ftpEstimate).toBe(240);
    expect(r.vo2maxMlKgMin).toBe(vo2maxFromPeak(320, 80).mlKgMin);
  });
});

describe('what Update changes (C2)', () => {
  it('zones set as shares of FTP (or the standard ones) follow it; zones in watts do not', () => {
    expect(zonesFollowFtp({})).toBe(true);
    expect(zonesFollowFtp({ powerZoneMode: 'pct', powerZonePcts: [55, 75, 90, 105, 120, 150] })).toBe(true);
    expect(zonesFollowFtp({ powerZoneMode: 'abs', powerZoneWatts: [120, 165, 200, 235, 270, 340] })).toBe(false);
  });
  it('the re-send offer counts rides already sent this week or next, from today, not the Ramp Test or other kinds', () => {
    const w = (id: string, extra: Partial<Workout> = {}) => ({ ...LIBRARY.find((x) => x.kind === 'ride' && !x.test)!, id, ...extra }) as Workout;
    const mine = [w('a'), w('b'), w('c', { kind: 'walk' })];
    const p = (id: string, workoutId: string, date: string, status: PlannedWorkout['status'] = 'sent'): PlannedWorkout => ({ id, workoutId, date, status, basis: 'power', icuEventId: 1 });
    const on = '2026-10-29'; // a Thursday
    const planned = [p('1', 'a', '2026-10-30'), p('2', 'b', '2026-11-04'), p('3', 'a', '2026-11-20'), p('4', 'a', '2026-10-28'), p('5', 'c', '2026-10-31'), p('6', 'a', '2026-10-31', 'planned')];
    expect(sentRidesAhead(planned, mine, on).map((x) => x.p.id)).toEqual(['1', '2']);
  });
});

describe('the day FTP changed', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  it('is stamped when FTP changes, and left alone otherwise', async () => {
    await saveProfile({ ...profile, ftpSetOn: '2026-09-12' });
    await saveProfile({ ...profile, ftpSetOn: '2026-09-12', lthr: 161 });
    expect((await db.profile.get('me'))!.ftpSetOn).toBe('2026-09-12');
    await saveProfile({ ...profile, ftpSetOn: '2026-09-12', ftp: 234 });
    expect((await db.profile.get('me'))!.ftpSetOn).not.toBe('2026-09-12');
  });
  it('the threshold heart rate gets its own date the same way', async () => {
    await saveProfile({ ...profile, lthrSetOn: '2026-09-01' });
    await saveProfile({ ...profile, lthrSetOn: '2026-09-01', ftp: 240 });
    expect((await db.profile.get('me'))!.lthrSetOn).toBe('2026-09-01');
    await saveProfile({ ...profile, lthrSetOn: '2026-09-01', lthr: 163 });
    expect((await db.profile.get('me'))!.lthrSetOn).not.toBe('2026-09-01');
  });
});
