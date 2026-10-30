import { describe, expect, it } from 'vitest';
import { assess } from './assessment';
import { generatePlan, type PlanRequest } from './planner';
import { generateSession } from './generate';
import { poorFit, sameWithin, sizeOf, snap } from './snap';
import { LIBRARY } from '../library/workouts';
import { addDays } from './load';
import type { Profile, Ride, Wellness, Workout } from './types';

const profile: Profile = { name: 'T', ftp: 210, lthr: 154, maxHr: 180, restingHr: 50, weightKg: 90, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const today = '2026-10-19';
const gen = (type: Parameters<typeof generateSession>[0]['type'], minutes: number, outdoor = true, progression = 0.5) => generateSession({ type, minutes, progression, outdoor, reason: 'r' });

describe('Batch 6 B1: snapping to the Library', () => {
  it('a long ride takes the nearest named Library ride of its family, within the tolerance', () => {
    const w = gen('long', 180);
    const lib = snap(w, { basis: 'power' })!;
    expect(lib).toBeTruthy();
    expect(lib.family).toBe('endurance');
    expect(lib.subtitle).toBeTruthy();                 // a place name, with what it is beneath
    const a = sizeOf(w), b = sizeOf(lib);
    expect(Math.abs(a.minutes - b.minutes)).toBeLessThanOrEqual(Math.max(10, a.minutes * 0.12));
    expect(Math.abs(a.tss - b.tss)).toBeLessThanOrEqual(Math.max(8, a.tss * 0.12));
  });

  it('is the nearest of those within tolerance', () => {
    const w = gen('long', 180);
    const me = sizeOf(w);
    const lib = snap(w, { basis: 'power' })!;
    const d = (x: Workout) => { const s = sizeOf(x); return Math.abs(s.minutes - me.minutes) / Math.max(10, me.minutes * 0.12) + Math.abs(s.tss - me.tss) / Math.max(8, me.tss * 0.12); };
    for (const x of LIBRARY.filter((x) => x.family === 'endurance' && x.setting !== 'indoor')) expect(d(lib)).toBeLessThanOrEqual(d(x) + 1e-9);
  });

  it('always the nearest, however far: a 4-hour threshold intent still gets a Library threshold ride, and it is a poor fit', () => {
    const w = gen('threshold', 240);
    const lib = snap(w, { basis: 'power' })!;
    expect(lib.family).toBe('threshold');
    expect(poorFit(w, lib)).toBe(true);
    expect(poorFit(gen('long', 180), snap(gen('long', 180), { basis: 'power' })!)).toBe(false);
  });

  it('an outdoor ride never gets a trainer-only one; heart-rate riders never get power-only ones', () => {
    for (const type of ['endurance', 'sweetspot', 'threshold', 'tempo'] as const) for (const m of [60, 90, 120]) {
      expect(snap(gen(type, m, true), { basis: 'power' })!.setting).not.toBe('indoor');
    }
    for (const type of ['vo2max', 'anaerobic', 'endurance', 'tempo'] as const) for (const m of [40, 46, 55, 65, 75, 90]) {
      const lib = snap(gen(type, m, false), { basis: 'hr' });
      expect(lib, `${type} ${m}`).toBeTruthy();
      expect(lib!.bases).toContain('hr');
    }
  });

  it('openers are the Library’s openers ride (Lake Anne)', () => {
    const lib = snap(gen('openers', 45), { basis: 'power' })!;
    expect(lib.id).toBe('lib-opener');
    expect(lib.name).toBe('Lake Anne');
  });

  it('a 30-minute walk with a 24 lb pack is a Library walk with a pack, not nothing', async () => {
    const { generateWalk } = await import('./sessions');
    const lib = snap(generateWalk({ minutes: 30, packKg: 10.9, where: 'outdoor', reason: 'r' }), { basis: 'power', equipment: ['bodyweight'] })!;
    expect(lib.source).toBe('library');
    expect(lib.walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(lib.walk!.packKg).toBeGreaterThan(0);
  });

  it('the old 47 → 54 minute row is the same session now', () => {
    expect(sameWithin(gen('endurance', 47, false), gen('endurance', 54, false))).toBe(true);
    expect(sameWithin(gen('endurance', 60, false), gen('sweetspot', 60, false))).toBe(false);
  });
});

// A steady rider, as in the planner tests.
function history(): { rides: Ride[]; wellness: Wellness[] } {
  const rides: Ride[] = [], wellness: Wellness[] = [];
  for (let i = 84; i >= 1; i--) {
    const d = addDays(today, -i);
    const dw = new Date(d + 'T00:00:00').getDay();
    const r = (h: number, IF: number): Ride => ({ id: d + h, date: d, startTime: d, name: 'r', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 3600 * IF * IF / 36), normalizedPower: IF * 210, averageHr: 130, intensityFactor: IF });
    if (dw === 6) rides.push(r(1.75, 0.82));
    if (dw === 0) rides.push(r(2.75, 0.68));
    if (dw === 3) rides.push(r(1.25, 0.72));
    wellness.push({ date: d, hrv: 50, restingHr: 50, sleepSeconds: 7 * 3600 });
  }
  return { rides, wellness };
}
const h = history();
const assessment = assess({ today, profile, rides: h.rides, wellness: h.wellness, planned: [] });
const req = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  start: today,
  goal: { kind: 'weight', weeks: 12, targetKg: 85 } as PlanRequest['goal'],
  availability: { hours: [3, 0.5, 1.5, 0.5, 1.5, 0, 3.5], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['dumbbells', 'bench', 'bodyweight', 'treadmill'], pins: [] },
  basis: 'power', masters: true, profile, assessment, ...over,
});

describe('Batch 6 B: plans built from the Library', () => {
  it('the Library has 95 rides (three short hard ones added 30 Oct 2026), ids and names unique, and every family has a ride that works by heart rate', () => {
    expect(LIBRARY.filter((w) => w.kind === 'ride')).toHaveLength(95);
    expect(new Set(LIBRARY.map((w) => w.id)).size).toBe(LIBRARY.length);
    expect(new Set(LIBRARY.map((w) => w.name)).size).toBe(LIBRARY.length);
    for (const f of ['endurance', 'recovery', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test']) expect(LIBRARY.some((w) => w.family === f && w.bases.includes('hr')), f).toBe(true);
  });

  it('the rider’s own rides are offered alongside the Library', () => {
    const mine: Workout = { ...gen('threshold', 240), id: 'mine-1', source: 'mine', name: 'My long threshold' };
    expect(snap(gen('threshold', 240), { basis: 'power', extra: [mine] })?.id).toBe('mine-1');
  });

  it('every session of 18 plans (three goals, three weeks, both bases) is a Library workout, strength included (30 Oct 2026), and nothing says the Library lacks one', () => {
    const goals = [undefined, { kind: 'event', date: '2027-02-06', name: 'C', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' }, { kind: 'general', weeks: 12 }] as Array<PlanRequest['goal'] | undefined>;
    const weeks = [[3, 0.5, 1.5, 0.5, 1.5, 0, 3.5], [4, 0, 1, 1, 1, 0, 4], [2, 1, 1.25, 1, 1.25, 1, 2.5]];
    const generated: string[] = [];
    for (const goal of goals) for (const hours of weeks) for (const basis of ['power', 'hr'] as const) {
      const r = req({ basis, profile: { ...profile, basis }, availability: { ...req().availability, hours }, ...(goal ? { goal } : {}) });
      const plan = generatePlan(r);
      for (const w of plan.weeks) for (const s of w.sessions) if (s.workout.source !== 'library') generated.push(`${basis} ${s.workout.name}`);
      expect(plan.decisions.filter((d) => /Library has no|nearest|would fit|poor fit|lacks/.test(d))).toEqual([]);
    }
    expect(generated).toEqual([]);
  });
});
