import { describe, expect, it } from 'vitest';
import type { Profile, Ride } from './types';
import { CURVE_SECONDS } from './progress';
import { fitCp } from './cpFit';
import { gatherEvidence, weightedMedian, type CurveInput, type TestInput } from './thresholdEvidence';

const profile: Profile = { name: 'T', ftp: 225, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const TODAY = '2026-10-29';
const ride = (id: string, date: string, extra: Partial<Ride> = {}): Ride => ({ id, date, startTime: `${date}T07:00:00`, name: `Ride ${id}`, type: 'Ride', sport: 'ride', seconds: 3600, averagePower: 170, averageHr: 135, ...extra });
/** A rider with critical power `cp` and reserve `wp`: their best power at each curve length. */
const curveFor = (id: string, date: string, cp: number, wp: number, scale: Record<number, number> = {}): CurveInput =>
  ({ id, date, w: CURVE_SECONDS.map((s) => (s >= 120 && s <= 1800 ? Math.round((cp + wp / s) * (scale[s] ?? 1)) : s === 3600 ? Math.round(cp * 0.96) : s === 60 ? cp * 1.8 : 0)) });
const rides8 = Array.from({ length: 8 }, (_, i) => ride(`r${i}`, `2026-10-${String(10 + i * 2).padStart(2, '0')}`, { eftp: 300 }));
const base = { profile, rides: rides8, curves: [] as CurveInput[], tests: [] as TestInput[], notes: [], today: TODAY };

describe('the critical power fit', () => {
  it('finds the worked example: 345, 305, 275, 260 and 255 W are a 245 W level with an 18 kJ reserve', () => {
    const f = fitCp([{ seconds: 180, watts: 345 }, { seconds: 300, watts: 305 }, { seconds: 600, watts: 275 }, { seconds: 1200, watts: 260 }, { seconds: 1800, watts: 255 }].filter((x) => x.seconds !== 180))!;
    expect(f.cp).toBe(245);
    expect(f.wPrime).toBe(18000);
    expect(f.ftp).toBe(233);
    expect(f.ok).toBe(true);
  });
  it('a tempo ride posing as a best 20 minutes does not line up, and says so', () => {
    const f = fitCp([{ seconds: 120, watts: 395 }, { seconds: 300, watts: 305 }, { seconds: 600, watts: 275 }, { seconds: 1200, watts: 200 }, { seconds: 1800, watts: 255 }])!;
    expect(f.ok).toBe(false);
    expect(f.problem).toMatch(/line up|all-out/);
  });
  it('short efforts barely above long ones (an easy block) give an unbelievable reserve and are refused', () => {
    const f = fitCp([{ seconds: 120, watts: 200 }, { seconds: 300, watts: 196 }, { seconds: 600, watts: 194 }, { seconds: 1200, watts: 192 }, { seconds: 1800, watts: 191 }])!;
    expect(f.ok).toBe(false);
    expect(f.problem).toMatch(/short efforts/);
  });
  it('needs three efforts spanning a five-fold range', () => {
    expect(fitCp([{ seconds: 300, watts: 305 }, { seconds: 600, watts: 275 }])).toBeUndefined();
    expect(fitCp([{ seconds: 300, watts: 305 }, { seconds: 600, watts: 275 }, { seconds: 1200, watts: 260 }])).toBeUndefined();
  });
});

describe('the evidence', () => {
  it('never reads Intervals.icu’s FTP estimates, even when every ride carries one', () => {
    const e = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 245, 18000)] });
    expect(e.lines.join('\n')).not.toMatch(/Intervals\.icu/);
    expect(e.estimate).toBe(233);
  });
  it('takes the best of each length across rides, and fits through them', () => {
    const e = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 240, 18000), curveFor('r2', '2026-10-14', 245, 18000)] });
    expect(e.bests.find((b) => b.label === '20 minutes')).toMatchObject({ watts: 260, rideName: 'Ride r2' });
    expect(e.fit?.cp).toBe(245);
    expect(e.basis).toBe('fit');
    expect(e.confidence).toBe('settled');
    expect(e.proven).toBe(233);
  });
  it('ignores curves outside the eight weeks', () => {
    expect(gatherEvidence({ ...base, curves: [curveFor('old', '2026-08-01', 300, 18000)] }).fit).toBeUndefined();
  });
  it('a recent test is the anchor unless the efforts since prove 3% more', () => {
    const test: TestInput = { date: '2026-10-26', kind: 'ramp', ftpEstimate: 230 };
    const near = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 245, 18000)], tests: [test] });
    expect(near).toMatchObject({ estimate: 230, basis: 'test' });
    const more = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 255, 18000)], tests: [test] });
    expect(more).toMatchObject({ estimate: 242, basis: 'fit' });
  });
  it('a fit that can’t be trusted falls back to the best single hour or 20 minutes, marked mixed, and proves nothing', () => {
    const e = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 245, 18000, { 1200: 0.78 })] });
    expect(e.fit?.ok).toBe(false);
    expect(e).toMatchObject({ basis: 'effort', confidence: 'mixed' });
    expect(e.proven).toBeUndefined();
    expect(e.lines.join('\n')).toContain('not trustworthy');
  });
  it('is thin with fewer than six rides with power and no recent test', () => {
    const e = gatherEvidence({ ...base, rides: rides8.slice(0, 5), curves: [curveFor('r1', '2026-10-12', 245, 18000)] });
    expect(e.confidence).toBe('thin');
    expect(e.estimate).toBeUndefined();
  });
  it('builds the typical heart rate per power zone from rides of 20 minutes or more', () => {
    const rs = [ride('a', '2026-10-20', { averagePower: 140, averageHr: 125 }), ride('b', '2026-10-21', { averagePower: 145, averageHr: 129 }), ride('c', '2026-10-22', { averagePower: 200, averageHr: 150 }), ride('d', '2026-10-23', { averagePower: 200, averageHr: 170, seconds: 600 })];
    expect(gatherEvidence({ ...base, rides: rs }).hrByPowerZone).toEqual([{ zone: 2, rides: 2, hr: 127 }, { zone: 3, rides: 1, hr: 150 }]);
  });
  it('keeps notes that mention illness or tiredness', () => {
    const e = gatherEvidence({ ...base, notes: [{ date: '2026-10-20', text: 'Head cold, stayed in' }, { date: '2026-10-21', text: 'Great ride' }] });
    expect(e.notes).toEqual(['2026-10-20: Head cold, stayed in']);
  });
  it('writes every section as labelled lines for the coach', () => {
    const e = gatherEvidence({ ...base, curves: [curveFor('r1', '2026-10-12', 245, 18000)], tests: [{ date: '2026-10-26', kind: 'ramp', ftpEstimate: 233, vo2maxMlKgMin: 49.7, ftpAction: 'kept' }], readinessBand: 'Ready' });
    const all = e.lines.join('\n');
    for (const bit of ['FTP setting now: 225 W', 'Power zone tops now', 'Heart-rate zone tops now', 'Best power in the window', 'critical power fit', 'reserve 18 kJ', 'ramp test 2026-10-26', 'Readiness today: Ready', "The app's own FTP estimate"]) expect(all).toContain(bit);
  });
  it('a weighted median still counts each value its weight', () => {
    expect(weightedMedian([{ value: 200, weight: 1 }, { value: 240, weight: 2 }])).toBe(240);
  });
});
