import { describe, expect, it } from 'vitest';
import type { Profile, Ride } from './types';
import { CURVE_SECONDS } from './progress';
import { gatherEvidence, weightedMedian, type CurveInput, type TestInput } from './thresholdEvidence';

const profile: Profile = { name: 'T', ftp: 225, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const TODAY = '2026-10-29';
const ride = (id: string, date: string, extra: Partial<Ride> = {}): Ride => ({ id, date, startTime: `${date}T07:00:00`, name: `Ride ${id}`, type: 'Ride', sport: 'ride', seconds: 3600, averagePower: 170, averageHr: 135, ...extra });
/** A curve whose 5, 20 and 60 minute bests are given. */
const curve = (id: string, date: string, w5: number, w20: number, w60: number): CurveInput => ({ id, date, w: CURVE_SECONDS.map((s) => (s === 300 ? w5 : s === 1200 ? w20 : s === 3600 ? w60 : s === 60 ? w5 * 1.3 : 0)) });
const rides8 = Array.from({ length: 8 }, (_, i) => ride(`r${i}`, `2026-10-${String(10 + i * 2).padStart(2, '0')}`));
const base = { profile, rides: rides8, curves: [] as CurveInput[], tests: [] as TestInput[], notes: [], today: TODAY };

describe('the evidence (Step 2, A1)', () => {
  it('turns the best 5, 20 and 60 minutes into implied FTPs, from the best ride for each', () => {
    const e = gatherEvidence({ ...base, curves: [curve('r1', '2026-10-12', 290, 240, 220), curve('r2', '2026-10-14', 300, 245, 228)] });
    expect(e.bests.find((b) => b.label === '20 minutes')).toMatchObject({ watts: 245, date: '2026-10-14', rideName: 'Ride r2' });
    expect(e.implied).toEqual([{ label: '5 minutes', ftp: 234 }, { label: '20 minutes', ftp: 233 }, { label: '60 minutes', ftp: 228 }]);
  });
  it('ignores curves and rides outside the eight weeks', () => {
    const e = gatherEvidence({ ...base, curves: [curve('old', '2026-08-01', 400, 350, 320)] });
    expect(e.implied).toEqual([]);
  });
  it('is thin with fewer than six rides with power', () => {
    expect(gatherEvidence({ ...base, rides: rides8.slice(0, 5) }).thin).toBe(true);
    expect(gatherEvidence(base).thin).toBe(false);
  });
  it('takes Intervals.icu’s per-ride estimates, newest first, with their median and trend', () => {
    const rs = rides8.map((r, i) => ({ ...r, eftp: 220 + i * 3 }));
    const e = gatherEvidence({ ...base, rides: rs });
    expect(e.icu[0]).toEqual({ date: rs[7].date, ftp: 241 });
    expect(e.icuMedian).toBe(Math.round((229 + 232) / 2));
    expect(e.icuTrend).toBe('rising');
  });
  it('builds the typical heart rate per power zone from rides of 20 minutes or more', () => {
    const rs = [ride('a', '2026-10-20', { averagePower: 140, averageHr: 125 }), ride('b', '2026-10-21', { averagePower: 145, averageHr: 129 }), ride('c', '2026-10-22', { averagePower: 200, averageHr: 150 }), ride('d', '2026-10-23', { averagePower: 200, averageHr: 170, seconds: 600 })];
    const e = gatherEvidence({ ...base, rides: rs });
    expect(e.hrByPowerZone).toEqual([{ zone: 2, rides: 2, hr: 127 }, { zone: 3, rides: 1, hr: 150 }]);
  });
  it('keeps notes that mention illness or tiredness', () => {
    const e = gatherEvidence({ ...base, notes: [{ date: '2026-10-20', text: 'Head cold, stayed in' }, { date: '2026-10-21', text: 'Great ride' }] });
    expect(e.notes).toEqual(['2026-10-20: Head cold, stayed in']);
  });
  it('writes every section as labelled lines for the coach', () => {
    const e = gatherEvidence({ ...base, curves: [curve('r1', '2026-10-12', 290, 240, 220)], tests: [{ date: '2026-10-26', kind: 'ramp', ftpEstimate: 233, vo2maxMlKgMin: 49.7, ftpAction: 'kept' }], readinessBand: 'Ready' });
    const all = e.lines.join('\n');
    for (const bit of ['FTP setting now: 225 W', 'Power zone tops now', 'Heart-rate zone tops now', 'Best power in the window', '20 minutes rule 228 W', 'ramp test 2026-10-26', 'Readiness today: Ready', "The app's own FTP estimate"]) expect(all).toContain(bit);
  });
});

describe('the app’s own FTP estimate (A2)', () => {
  it('a weighted median counts each value its weight', () => {
    expect(weightedMedian([{ value: 200, weight: 1 }, { value: 240, weight: 2 }])).toBe(240);
    expect(weightedMedian([])).toBeUndefined();
  });
  it('without a test: the median of the curve rules and Intervals.icu', () => {
    const rs = rides8.map((r) => ({ ...r, eftp: 230 }));
    const e = gatherEvidence({ ...base, rides: rs, curves: [curve('r1', '2026-10-12', 300, 245, 228)] });
    // 234, 233, 228, 230 -> median 231.5
    expect(e.estimate).toBe(232);
    expect(e.confidence).toBe('settled');
  });
  it('a recent test counts twice and pulls the estimate toward it', () => {
    const e = gatherEvidence({ ...base, curves: [curve('r1', '2026-10-12', 300, 245, 228)], tests: [{ date: '2026-10-26', kind: 'ramp', ftpEstimate: 250 }] });
    // 234, 233, 228, 250, 250 -> 234
    expect(e.estimate).toBe(234);
    expect(e.confidence).toBe('mixed');
    expect(e.sources.join(' ')).toContain('ramp test of 2026-10-26');
  });
  it('a test older than eight weeks is evidence but not part of the estimate', () => {
    const e = gatherEvidence({ ...base, curves: [curve('r1', '2026-10-12', 300, 245, 228)], tests: [{ date: '2026-08-20', kind: 'ramp', ftpEstimate: 300 }] });
    expect(e.estimate).toBe(233);
    expect(e.tests).toHaveLength(1);
  });
  it('thin evidence with no test says so', () => {
    const e = gatherEvidence({ ...base, rides: rides8.slice(0, 3), curves: [curve('r1', '2026-10-12', 300, 245, 228)] });
    expect(e.confidence).toBe('thin');
  });
});
