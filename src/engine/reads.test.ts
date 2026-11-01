import { describe, expect, it } from 'vitest';
import { breathVsNormal, hrDrift, hrVsNormal, powerFade, readActivity, readWords, zoneTime, type ActivityRead } from './reads';
import { judgeSession } from './sessionVerdict';
import { powerZone, ridePowerZones } from './zones';
import type { Profile, Ride, Workout, WorkoutBlock } from './types';

const profile: Profile = { name: 'Rider', ftp: 200, lthr: 160, maxHr: 185, restingHr: 50, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };

function rec(...pieces: Array<[number, number, number]>) {
  const time: number[] = [], watts: number[] = [], hr: number[] = [];
  let t = 0;
  for (const [sec, w, h] of pieces) for (let k = 0; k < sec; k++) { time.push(t++); watts.push(w); hr.push(h); }
  return { time, watts, heartrate: hr };
}
const ride = (over: Partial<Ride> = {}): Ride => ({ id: 'a', date: '2026-10-31', startTime: '2026-10-31T09:00', name: 'Ride', type: 'Ride', sport: 'ride', seconds: 3600, tss: 60, ...over });

describe('A: Layer 1, what a recording shows', () => {
  it('time in each power zone from the stream against the rider\'s own table', () => {
    const r = rec([1200, 100, 120], [600, 160, 140]);   // 0.50 of FTP (zone 1), 0.80 (zone 3 on the default table)
    const ladder = ridePowerZones(profile);
    const z = zoneTime(r.time, r.watts, 200, (f) => powerZone(f, ladder), ladder.length)!;
    expect(z[powerZone(0.5, ladder) - 1]).toBe(1200);
    expect(z[powerZone(0.8, ladder) - 1]).toBe(600);
  });
  it('fade: steady, fading', () => {
    const steady = rec([3600, 150, 130]);
    expect(powerFade(steady.time, steady.watts)).toBe(1);
    const fading = rec([600, 150, 130], [1500, 160, 130], [1500, 120, 130]);
    expect(powerFade(fading.time, fading.watts)!).toBeLessThan(0.8);
    expect(powerFade(rec([1200, 150, 130]).time, rec([1200, 150, 130]).watts)).toBeUndefined();   // too little steady riding
  });
  it('drift: heart rate rising at the same power, and none when it holds', () => {
    const flat = rec([3600, 150, 130]);
    expect(hrDrift(flat.time, flat.watts, flat.heartrate)).toBe(0);
    const drifting = rec([600, 150, 120], [1500, 150, 125], [1500, 150, 140]);
    expect(hrDrift(drifting.time, drifting.watts, drifting.heartrate)!).toBeGreaterThan(5);
  });
  it('heart rate at power compared with the rider\'s own previous 8 weeks', () => {
    const past = (id: string, date: string, hr: number): ActivityRead => readActivity(ride({ id, date }), rec([600, 140, 110], [2400, 140, hr]), { profile });
    const reads = [past('p1', '2026-10-10', 130), past('p2', '2026-10-17', 130), past('p3', '2026-08-01', 100)];   // p3 is outside the 8 weeks
    const today = readActivity(ride({ id: 't', date: '2026-10-31' }), rec([600, 140, 110], [2400, 140, 136]), { profile });
    const vs = hrVsNormal(today, reads)!;
    expect(vs.beats).toBe(6);
    expect([vs.from, vs.to]).toEqual([140, 160]);
    const words = readWords(today, { reads })[0];
    expect(words).toContain('6 bpm above the rider\'s usual');
  });
  it('a different FTP or one ride of history is not a normal to compare with', () => {
    const one = [readActivity(ride({ id: 'p1', date: '2026-10-10' }), rec([3000, 140, 130]), { profile })];
    const today = readActivity(ride({ id: 't' }), rec([3000, 140, 136]), { profile });
    expect(hrVsNormal(today, one)).toBeUndefined();
  });
  it('a heart-rate-only walk: zone time on the foot table, no power', () => {
    const w = rec([1800, 0, 100]);
    const r = readActivity(ride({ sport: 'walk', type: 'Walk', name: 'Walk', seconds: 1800 }), { time: w.time, heartrate: w.heartrate }, { profile });
    expect(r.hrTable).toBe('foot');
    expect(r.hrZones!.reduce((a, b) => a + b, 0)).toBe(1800);
    expect(r.powerZones).toBeUndefined();
    expect(r.normalizedPower).toBeUndefined();
    expect(readWords(r, { reads: [] })[0]).toMatch(/^30 min walk/);
  });
  it('a strength session with no recording: load and effort only', () => {
    const r = readActivity(ride({ sport: 'strength', type: 'WeightTraining', seconds: 2700, tss: 35 }), undefined, { profile, effort: 7 });
    expect(r.has.streams).toBe(false);
    expect(readWords(r, { reads: [] })[0]).toBe('45 min strength session, training load 35 TSS: effort 7/10; no recording beyond its duration and load.');
  });
  it('breathing cut at a freeze, and compared with the rider\'s normal', () => {
    const r = rec([3600, 150, 130]);
    const ve = r.time.map((t) => (t < 1800 ? 40 + (t % 7) : 55));   // frozen from 30:00 to the end
    const br = r.time.map((t) => (t < 1800 ? 20 + (t % 3) : 25));
    const read = readActivity(ride(), { ...r, ve, br }, { profile });
    expect(read.breathFrozenAt).toBe(1800);
    expect(read.veAtPower![0].ve).toBeLessThan(50);   // the frozen 55s are not in it
    const normal = { ftp: 200, bands: [{ lo: 0.7, hi: 0.8, ve: 40, seconds: 5000 }], rides: 4, updated: '2026-10-30' };
    expect(breathVsNormal(read, normal)!).toBeGreaterThan(0);
    expect(readWords(read, { reads: [], breathNormal: normal })[0]).toContain('stopped reading at 0:30');
  });
});

const step = (min: number, intensity: number, high?: number, label?: string) => ({ kind: 'step' as const, seconds: min * 60, intensity, ...(high ? { intensityHigh: high } : {}), ...(label ? { label } : {}) });
const thr3x10: Workout = { id: 'w', name: 'Threshold 3 x 10', kind: 'ride', family: 'threshold', purpose: '', phases: ['build'], bases: ['power', 'hr'], setting: 'any', source: 'library',
  blocks: [step(10, 0.5, 0.65, 'Warm up'), { kind: 'repeat', times: 3, label: 'Threshold', steps: [step(10, 0.95, 1.0), step(5, 0.5, undefined, 'Easy')] } as WorkoutBlock, step(10, 0.5, undefined, 'Cool down')] };

describe('A: Layer 2, against the plan, never about duration', () => {
  it('a matched ride: one line per work step ridden', () => {
    const r = rec([600, 110, 110], [600, 195, 150], [300, 100, 120], [600, 194, 155], [300, 100, 120], [600, 192, 160], [300, 100, 120], [600, 100, 110]);
    const read = readActivity(ride(), r, { profile, session: { workout: thr3x10, basis: 'power' } });
    expect(read.planned!.steps).toHaveLength(3);
    expect(read.planned!.steps[0]).toContain('you rode 195 W, in target');
    expect(read.planned!.reached).toBeUndefined();
    expect(read.planned!.verdict!.kind).toBe('held');
  });
  it('a ride that ends early, everything ridden on target: step lines, reached as a fact, never "fell short"', () => {
    // Two of the three intervals ridden on target, then the recording ends (a phone call, the weather).
    const r = rec([600, 110, 110], [600, 195, 150], [300, 100, 120], [600, 194, 155], [120, 100, 120]);
    const v = judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.heartrate);
    expect(v?.kind).not.toBe('short');
    const read = readActivity(ride({ seconds: 2220 }), r, { profile, session: { workout: thr3x10, basis: 'power' } });
    expect(read.planned!.steps).toHaveLength(2);
    expect(read.planned!.reached).toEqual({ steps: 5, of: 8 });
    const words = readWords(read, { reads: [] }).join(' ');
    expect(words).not.toContain('fell short');
    expect(words).toContain('a fact only');
  });
  it('a ride that ends before half the hard work: no verdict at all', () => {
    const r = rec([600, 110, 110], [600, 195, 150], [100, 100, 120]);
    const read = readActivity(ride({ seconds: 1300 }), r, { profile, session: { workout: thr3x10, basis: 'power' } });
    expect(read.planned!.verdict).toBeUndefined();
  });
});
