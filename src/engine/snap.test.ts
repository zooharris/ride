import { describe, expect, it } from 'vitest';
import { assess } from './assessment';
import { generatePlan, type PlanRequest } from './planner';
import { generateSession } from './generate';
import { diffPlan } from './adapt';
import { planMadeEntry, sameWithin, sizeOf, snap } from './snap';
import { LIBRARY } from '../library/workouts';
import { addDays } from './load';
import type { PlannedWorkout, Profile, Ride, Wellness, Workout } from './types';

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

  it('nothing close enough → null; an outdoor ride never gets a trainer-only one; heart-rate riders never get power-only ones', () => {
    expect(snap(gen('threshold', 240), { basis: 'power' })).toBeNull();
    for (const type of ['endurance', 'sweetspot', 'threshold', 'tempo'] as const) for (const m of [60, 90, 120]) {
      const lib = snap(gen(type, m, true), { basis: 'power' });
      if (lib) expect(lib.setting).not.toBe('indoor');
    }
    for (const m of [40, 46, 55, 65]) { const lib = snap(gen('vo2max', m, false), { basis: 'hr' }); if (lib) expect(lib.bases).toContain('hr'); }
  });

  it('openers and strength are never snapped', () => {
    expect(snap(gen('openers', 45), { basis: 'power' })).toBeNull();
  });

  it('a session the Library cannot carry becomes a named, reusable plan-made entry with a unique id', () => {
    const own: Workout[] = [];
    const w = gen('threshold', 240);
    const { entry, isNew } = planMadeEntry(w, own);
    expect(isNew).toBe(true);
    expect(entry).toMatchObject({ source: 'mine', planMade: true, subtitle: w.name, family: 'threshold' });
    expect(entry.id).toMatch(/^lib-gen-threshold-\d+$/);
    expect(LIBRARY.some((x) => x.name === entry.name)).toBe(false);
    own.push(entry);
    expect(planMadeEntry(gen('threshold', 240), own)).toMatchObject({ isNew: false, entry: { id: entry.id } });   // the same intent again: reused
    const other = planMadeEntry(gen('threshold', 300), own);
    expect(other.isNew).toBe(true);
    expect(other.entry.id).not.toBe(entry.id);
    expect(other.entry.name).not.toBe(entry.name);
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
  for (const goal of [undefined, { kind: 'event', date: '2027-02-06', name: 'Century', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' } as PlanRequest['goal']]) {
    it(`rides are named Library rides, and no week's load moves more than 10% from the plan as generated (${goal ? 'event' : 'weight'} goal)`, () => {
      // A week can miss its target for reasons the Library has nothing to do with (the hours cap it);
      // what snapping may change is the load of the sessions the planner chose, and only a little.
      const plan = generatePlan(req(goal ? { goal } : {}));
      const asGenerated = generatePlan(req(goal ? { goal, noSnap: true } : { noSnap: true }));
      let rides = 0, named = 0;
      plan.weeks.forEach((w, i) => {
        for (const s of w.sessions.filter((x) => x.kind === 'ride')) { rides++; if (s.workout.source === 'library') named++; }
        expect(Math.abs(w.tss - asGenerated.weeks[i].tss) / asGenerated.weeks[i].tss, `week ${w.index}`).toBeLessThanOrEqual(0.1);
      });
      expect(named / rides).toBeGreaterThan(0.6);
    });
  }

  it('the first re-check after the move proposes nothing: a plan made the old way, against the same plan built from the Library', () => {
    const old = generatePlan(req({ noSnap: true }));
    const now = generatePlan(req());
    const workouts = new Map<string, Workout>();
    const calendar: PlannedWorkout[] = [];
    let i = 0;
    for (const w of old.weeks) for (const s of w.sessions) {
      workouts.set(s.workout.id, s.workout);
      calendar.push({ id: `p${i++}`, date: s.date, workoutId: s.workout.id, basis: 'power', status: 'planned', planId: 'plan' });
    }
    expect(diffPlan(calendar, workouts, now, today)).toEqual([]);
  });

  it('the rider’s own and plan-made rides are offered alongside the Library', () => {
    const mine: Workout = { ...gen('threshold', 240), id: 'lib-gen-threshold-240', source: 'mine', planMade: true, name: 'Ashburn' };
    expect(snap(gen('threshold', 240), { basis: 'power', extra: [mine] })?.id).toBe('lib-gen-threshold-240');
  });
});
