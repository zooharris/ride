import { describe, expect, it } from 'vitest';
import { hrAtPower, steadyAtHr } from './hrPower';
import { judgeSession, offVerdict } from './sessionVerdict';
import { aerobicTrend } from './aerobicTrend';
import { gatherEvidence, type CurveInput } from './thresholdEvidence';
import { ftpCheck } from './ftpCheck';
import { addDays } from './load';
import { curveRecord } from '../ui/powerCurves';
import type { Profile, Workout, WorkoutBlock } from './types';

const profile: Profile = { name: 'T', ftp: 200, lthr: 160, maxHr: 185, restingHr: 50, weightKg: 80, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const TODAY = '2026-10-30';

/** A recording at 1 Hz from pieces of [seconds, watts, heart rate]. */
function rec(...pieces: Array<[number, number, number]>) {
  const time: number[] = [], watts: number[] = [], hr: number[] = [];
  let t = 0;
  for (const [sec, w, h] of pieces) for (let k = 0; k < sec; k++) { time.push(t++); watts.push(w); hr.push(h); }
  return { time, watts, hr };
}

describe('B1: heart rate kept alongside power', () => {
  it('bands of FTP, counted only after minute 10, a band under 3 minutes dropped', () => {
    const r = rec([600, 130, 140], [600, 130, 130], [240, 170, 150], [120, 190, 160]);   // the first 10 minutes are not counted
    const b = hrAtPower(r.time, r.watts, r.hr, 200);
    expect(b.map((x) => [x.lo, x.seconds, x.hr])).toEqual([[0.6, 600, 130], [0.8, 240, 150]]);   // 0.95 band only 2 min: dropped
  });
  it('power at a steady heart rate: 70-80% of threshold heart rate, after minute 10, 15 minutes or more', () => {
    const r = rec([600, 100, 100], [900, 150, 120], [600, 220, 170]);
    expect(steadyAtHr(r.time, r.watts, r.hr, 160)).toEqual({ watts: 150, seconds: 900 });
    const short = rec([600, 100, 100], [840, 150, 120]);
    expect(steadyAtHr(short.time, short.watts, short.hr, 160)).toBeUndefined();
  });
  it('a record keeps the thresholds it was read with; a ride with no planned session is not judged', () => {
    const r = rec([1800, 150, 120]);
    const c = curveRecord({ id: 'a', date: TODAY }, { time: r.time, watts: r.watts, heartrate: r.hr }, { profile, sessionOf: () => undefined });
    expect(c).toMatchObject({ v: 2, ftpAtBuild: 200, lthrAtBuild: 160 });
    expect(c.judged).toBeUndefined();
    expect(c.verdict).toBeUndefined();
  });
});

const step = (min: number, intensity: number, high?: number, label?: string) => ({ kind: 'step' as const, seconds: min * 60, intensity, ...(high ? { intensityHigh: high } : {}), ...(label ? { label } : {}) });
const thr3x10: Workout = { id: 'w', name: 'Threshold 3 x 10', kind: 'ride', family: 'threshold', purpose: '', phases: ['build'], bases: ['power', 'hr'], setting: 'any', source: 'library',
  blocks: [step(10, 0.5, 0.65, 'Warm up'), { kind: 'repeat', times: 3, label: 'Threshold', steps: [step(10, 0.95, 1.0), step(5, 0.5, undefined, 'Easy')] } as WorkoutBlock, step(10, 0.5, undefined, 'Cool down')] };
/** Ride the 3 x 10 with these watts and heart rate on each work interval. */
function ride3x10(w: [number, number, number], hr: [number, number, number] = [150, 155, 160]) {
  return rec([600, 110, 110], [600, w[0], hr[0]], [300, 100, 120], [600, w[1], hr[1]], [300, 100, 120], [600, w[2], hr[2]], [300, 100, 120], [600, 100, 110]);
}

describe('B2: sessions judged', () => {
  it('held: every interval in its band (190-200 W), heart rate settled', () => {
    const r = ride3x10([195, 194, 192]);
    expect(judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.hr)).toEqual({ kind: 'held', hr: 'settled', work: 30, intervals: 3 });
  });
  it('fell short: one interval more than 5% under the bottom of its band', () => {
    const r = ride3x10([195, 178, 192]);   // 178 is 6.3% under 190
    expect(judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.hr)!.kind).toBe('short');
  });
  it('fell short: the last of the set more than 8% below the first', () => {
    const r = ride3x10([200, 192, 183]);   // 183 is 3.7% under the band but 8.5% below the first
    expect(judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.hr)!.kind).toBe('short');
  });
  it('a little under: between 3% and 5% under, which counts for nothing', () => {
    const r = ride3x10([186, 186, 186]);   // 2.1% under 190: within the 3% slack, so held
    const r2 = ride3x10([182, 182, 182]);  // 4.2% under: a little under
    expect(judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.hr)!.kind).toBe('held');
    const v = judgeSession(thr3x10, profile, 'power', r2.time, r2.watts, r2.hr)!;
    expect(v.kind).toBe('under');
    expect(offVerdict(v)).toBe(false);
  });
  it('heart rate on the last interval: high at 105% of threshold, low at 95% or less', () => {
    const hi = ride3x10([195, 195, 195], [160, 165, 170]);
    const v = judgeSession(thr3x10, profile, 'power', hi.time, hi.watts, hi.hr)!;
    expect(v).toMatchObject({ kind: 'held', hr: 'high' });
    expect(offVerdict(v)).toBe(true);
    const lo = ride3x10([195, 195, 195], [140, 145, 150]);
    expect(judgeSession(thr3x10, profile, 'power', lo.time, lo.watts, lo.hr)!.hr).toBe('low');
  });
  it('half the work not done: no verdict; an easy ride: no verdict', () => {
    const r = rec([600, 110, 110], [600, 195, 150], [300, 100, 120], [200, 195, 150]);
    expect(judgeSession(thr3x10, profile, 'power', r.time, r.watts, r.hr)).toBeUndefined();
    const easy: Workout = { ...thr3x10, blocks: [step(60, 0.65, 0.75)] };
    const e = rec([3600, 140, 120]);
    expect(judgeSession(easy, profile, 'power', e.time, e.watts, e.hr)).toBeUndefined();
  });
  it('a heart-rate ride is judged by heart rate', () => {
    const hrRide = ride3x10([150, 150, 150], [150, 152, 154]);   // targets are a heart-rate band near threshold
    const v = judgeSession(thr3x10, profile, 'hr', hrRide.time, hrRide.watts, hrRide.hr);
    expect(v).toBeDefined();
    expect(v!.intervals).toBe(3);
  });
});

describe('B3: power at a steady heart rate, week by week', () => {
  const week = (weeksAgo: number, watts: number, rides = 2) => Array.from({ length: rides }, (_, k) => ({ date: addDays(TODAY, -weeksAgo * 7 - k), steadyAtHr: { watts, seconds: 1200 }, lthrAtBuild: 160 }));
  it('a week counts only with two rides or more', () => {
    const t = aerobicTrend([...week(1, 150, 1), ...week(2, 150)], 160, TODAY);
    expect(t.weeks).toHaveLength(1);
  });
  it('dropped: the last three weeks 5% or more under the three ending six weeks before', () => {
    const recs = [...week(10, 160), ...week(9, 160), ...week(8, 160), ...week(2, 150), ...week(1, 151), ...week(0, 150)];
    expect(aerobicTrend(recs, 160, TODAY).dropped).toBe(true);
    const steady = [...week(10, 160), ...week(9, 160), ...week(8, 160), ...week(2, 156), ...week(1, 157), ...week(0, 155)];
    expect(aerobicTrend(steady, 160, TODAY).dropped).toBe(false);
  });
  it('both groups are needed', () => {
    expect(aerobicTrend([...week(2, 100), ...week(1, 100), ...week(0, 100)], 160, TODAY).dropped).toBe(false);
  });
  it('re-scaled by threshold heart rate when it has changed since', () => {
    const recs = [...week(10, 160), ...week(9, 160), ...week(8, 160), ...week(2, 150), ...week(1, 150), ...week(0, 150)].map((r) => ({ ...r, lthrAtBuild: r.steadyAtHr.watts === 150 ? 150 : 160 }));
    expect(aerobicTrend(recs, 160, TODAY).dropped).toBe(false);   // 150 W read against 150 bpm is 160 W against 160 bpm
  });
});

describe('B4 and C: the evidence sets the signs, and the messages follow them', () => {
  const curve = (daysAgo: number, extra: Partial<CurveInput> = {}): CurveInput => ({ id: `c${daysAgo}`, date: addDays(TODAY, -daysAgo), w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ...extra });
  const held = { kind: 'held' as const, hr: 'settled' as const, work: 30, intervals: 3 };
  const short = { kind: 'short' as const, hr: 'settled' as const, work: 30, intervals: 3 };
  const ev = (curves: CurveInput[]) => gatherEvidence({ profile, rides: [], curves, tests: [], notes: [], today: TODAY });
  it('two of the last four judged sessions off: sessionsOff; any off in the last four weeks: not ok', () => {
    const e = ev([curve(3, { verdict: short }), curve(10, { verdict: held }), curve(17, { verdict: short })]);
    expect(e.signs).toMatchObject({ sessionsOff: true, sessionsOk: false });
    expect(e.lines.some((l) => /Planned hard sessions, judged/.test(l))).toBe(true);
  });
  it('no sessions judged: ok, nothing off', () => {
    expect(ev([]).signs).toMatchObject({ sessionsOff: false, sessionsOk: true, steadyDropped: false });
  });
  it('heart rate in each power band reaches the coach', () => {
    const e = ev([curve(3, { hrAtPower: [{ lo: 0.6, hi: 0.7, seconds: 1800, hr: 128 }], ftpAtBuild: 200 })]);
    expect(e.lines.some((l) => /60-70% of FTP \(120-140 W\): 128 bpm over 30 min/.test(l))).toBe(true);
  });
  it('message one waits while a hard session fell short in the last four weeks', () => {
    const e = ev([curve(5, { verdict: short })]);
    expect(ftpCheck({ ftp: 200, ftpSetOn: '2026-10-01', estimate: 210, everTested: true, lastTestDate: '2026-10-01', signs: e.signs, state: {}, today: TODAY })).toBeUndefined();
    expect(ftpCheck({ ftp: 200, ftpSetOn: '2026-10-01', estimate: 210, everTested: true, lastTestDate: '2026-10-01', signs: ev([]).signs, state: {}, today: TODAY })).toEqual({ kind: 'up', estimate: 210 });
  });
  it('signs recur after Not now: two weeks, then again', () => {
    const signs = { sessionsOff: true, steadyDropped: true, sessionsOk: false };
    const base = { ftp: 200, ftpSetOn: TODAY, everTested: true, lastTestDate: '2026-09-01', signs };
    expect(ftpCheck({ ...base, state: { notNowAt: addDays(TODAY, -13) }, today: TODAY })).toBeUndefined();
    expect(ftpCheck({ ...base, state: { notNowAt: addDays(TODAY, -14) }, today: TODAY })).toMatchObject({ kind: 'test', reason: 'signs' });
  });
  it('a test anywhere in the record counts as tested, not only in the last 12 weeks', () => {
    const e = gatherEvidence({ profile, rides: [], curves: [], tests: [{ date: '2026-03-01', kind: 'ramp' }], notes: [], today: TODAY });
    expect(e.everTested).toBe(true);
    expect(e.lastTestDate).toBe('2026-03-01');
  });
});
