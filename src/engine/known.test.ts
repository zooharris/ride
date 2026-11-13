import { describe, expect, it } from 'vitest';
import { assess } from './assessment';
import { generatePlan, type PlanRequest } from './planner';
import { addDays } from './load';
import { isUnknown, knownFtp, markMine, maxHrFromAge, numbersToFind, settleUnsure, settledText, standIns, targetsAvailable } from './known';
import { numbersToPush, applyAthleteNumbers } from '../sync/intervals';
import { historyHints, setupProfile } from '../ui/screens/Onboarding';
import { DEFAULT_PROFILE } from '../data/db';
import type { Profile, Ride, UnsureNumber } from './types';

const today = '2026-11-16';
const box = (source: 'typed' | 'service' | 'unknown' | 'estimate', value?: number, from?: string) => ({ source, value, estimate: from && value ? { value, from } : undefined });
const allUnknown = { ftp: box('unknown'), lthr: box('unknown'), maxHr: box('unknown'), weightKg: box('unknown') } as Record<UnsureNumber, ReturnType<typeof box>>;

describe('first-run setup without made-up numbers (13 Nov 2026)', () => {
  it('a rider who knows nothing gets marks, stand-ins and heart-rate targets', () => {
    const p = setupProfile({ ...DEFAULT_PROFILE, name: 'New' }, allUnknown, 5, undefined, undefined, false);
    expect(p.unsure).toEqual({ ftp: {}, lthr: {}, maxHr: {}, weightKg: {} });
    expect(p.basis).toBe('hr');
    expect(p.hoursPerWeek).toBe(5);
    expect(knownFtp(p)).toBeUndefined();
    expect(targetsAvailable(p)).toEqual({ watts: false, bpm: false });
    // The stand-ins are not the old made-up defaults (FTP 200, threshold 155, max 175).
    expect([p.ftp, p.lthr, p.maxHr]).not.toEqual([200, 155, 175]);
    expect(p.ftp).toBeGreaterThan(0);
  });
  it('numbers the rider types or Intervals.icu holds are theirs; estimates are marked', () => {
    const p = setupProfile(DEFAULT_PROFILE, { ftp: box('typed', 240), lthr: box('service', 158), maxHr: box('estimate', 183, 'your age'), weightKg: box('typed', 70) }, 6, true, true, false);
    expect(p.ftp).toBe(240); expect(p.lthr).toBe(158); expect(p.maxHr).toBe(183); expect(p.weightKg).toBe(70);
    expect(p.unsure).toEqual({ maxHr: { estimate: 'your age' } });
    expect(p.basis).toBe('power');
  });
  it('targets start on heart rate unless history or the rider says power, and never on an unknown FTP', () => {
    const known = { ...allUnknown, ftp: box('typed', 250) };
    expect(setupProfile(DEFAULT_PROFILE, known, 5, undefined, true, false).basis).toBe('hr');
    expect(setupProfile(DEFAULT_PROFILE, known, 5, true, true, false).basis).toBe('power');
    expect(setupProfile(DEFAULT_PROFILE, known, 5, undefined, undefined, true).basis).toBe('power');
    expect(setupProfile(DEFAULT_PROFILE, allUnknown, 5, true, true, true).basis).toBe('hr');
  });
  it('max heart rate from age', () => {
    expect(maxHrFromAge(1975, '2026-11-13')).toBe(172);
  });
  it('stand-ins come from what is known', () => {
    expect(standIns({ ftp: 0, lthr: 160, maxHr: 0, weightKg: 80, unsure: { ftp: {}, maxHr: {} } })).toEqual({ ftp: 200, lthr: 160, maxHr: 178, weightKg: 80 });
  });
});

describe('a number becomes the rider\'s own', () => {
  const p0 = setupProfile(DEFAULT_PROFILE, allUnknown, 5, true, true, false);
  it('when it changes (typed, or a test), and is announced once', () => {
    const r = settleUnsure(p0, { ...p0, ftp: 231 });
    expect(r.profile.unsure?.ftp).toBeUndefined();
    expect(r.profile.unsure?.lthr).toEqual({});
    expect(r.settled).toEqual(['ftp']);
    expect(settledText(r.profile, r.settled)).toBe('Your FTP is now 231 W. Sessions from now on use it.');
  });
  it('not when a new estimate replaces it', () => {
    const r = settleUnsure(p0, { ...p0, maxHr: 183, unsure: { ...p0.unsure, maxHr: { estimate: 'your age' } } });
    expect(r.profile.unsure?.maxHr).toEqual({ estimate: 'your age' });
    expect(r.settled).toEqual([]);
  });
  it('when Intervals.icu supplies it', () => {
    const p = applyAthleteNumbers(p0, { name: 'x', ftp: 255 });
    expect(isUnknown(p, 'ftp')).toBe(false);
    expect(isUnknown(p, 'lthr')).toBe(true);
    expect(markMine(p, ['lthr', 'maxHr', 'weightKg']).unsure).toBeUndefined();
  });
  it('an unknown or estimated number is never written to Intervals.icu', () => {
    const n = numbersToPush({ ...p0, unsure: { ftp: {}, lthr: { estimate: 'rides' } } });
    expect(n.ftp).toBeUndefined();
    expect(n.lthr).toBeUndefined();
    expect(n.hrZoneTops).toBeUndefined();
    expect(n.maxHr).toBe(p0.maxHr);
  });
});

describe('what the history suggests', () => {
  const r = (date: string, o: Partial<Ride>): Ride => ({ id: date + Math.random(), date, startTime: date, name: 'r', type: 'Ride', sport: 'ride', seconds: 3600, ...o });
  it('hours a week over eight weeks, an FTP estimate with where it came from, heart rates', () => {
    const rides = Array.from({ length: 16 }, (_, i) => r(addDays(today, -3 - i * 3), { seconds: 5400, averagePower: 180, eftp: 240 + i, maxHr: 170 + (i % 5), averageHr: 140 }));
    const h = historyHints(rides, today);
    expect(h.weeklyHours).toBe(3);
    expect(h.ridesWithPower).toBe(16);
    expect(h.ftp?.value).toBe(253);
    expect(h.ftp?.from).toMatch(/Intervals\.icu's estimate from your ride of/);
    expect(h.maxHr?.value).toBe(174);
    expect(h.lthr?.value).toBe(157);
  });
  it('nothing to suggest from a thin history', () => {
    const h = historyHints([r(addDays(today, -2), {})], today);
    expect(h).toEqual({ weeklyHours: undefined, ridesWithPower: 0, ftp: undefined, maxHr: undefined, lthr: undefined });
  });
});

describe('the first plan of a rider who doesn\'t know their numbers', () => {
  const plan = (p: Profile) => {
    const a = assess({ today, profile: p, rides: [], wellness: [], planned: [] });
    const req: PlanRequest = {
      start: today, goal: { kind: 'general', weeks: 8 } as PlanRequest['goal'],
      availability: { hours: [2, 0, 1, 0, 1, 0, 2], outdoor: [false, false, false, false, false, false, false], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] },
      basis: p.basis, masters: false, profile: p, assessment: a,
    };
    return generatePlan(req);
  };
  const week1 = (pl: ReturnType<typeof plan>) => pl.weeks[0].sessions.filter((s) => s.workout.family === 'test').map((s) => s.workout.id);
  it('with power: a power test in week 1, and rides by heart rate meanwhile', () => {
    const p = setupProfile(DEFAULT_PROFILE, allUnknown, 6, true, true, false);
    expect(numbersToFind(p)).toMatchObject({ basis: 'power' });
    const pl = plan(p);
    expect(['lib-ramp', 'lib-20min']).toContain(week1(pl)[0]);
    expect(week1(pl)).toHaveLength(1);
    expect(pl.decisions.join(' ')).toMatch(/your FTP is not known yet .*this test finds it/);
  });
  it('heart rate only: the threshold heart-rate test in week 1', () => {
    const p = setupProfile(DEFAULT_PROFILE, allUnknown, 6, false, true, false);
    expect(week1(plan(p))).toEqual(['lib-lthr-30']);
  });
  it('no sensors at all: no test, and the plan says why', () => {
    const p = setupProfile(DEFAULT_PROFILE, allUnknown, 6, false, false, false);
    const pl = plan(p);
    expect(week1(pl)).toEqual([]);
    expect(pl.decisions.join(' ')).toMatch(/nothing to measure it with/);
    expect(pl.weeks[0].sessions.length).toBeGreaterThan(0);
  });
});
