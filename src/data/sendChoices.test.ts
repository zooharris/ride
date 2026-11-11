import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { libraryById } from '../library/workouts';
import { defaultWhere, hasTwoVersions, sendWords, type PlanDays } from '../library/sendWhere';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';
import playerSrc from '../ui/screens/Player.tsx?raw';
import workoutSrc from '../ui/screens/Workout.tsx?raw';
import todaySrc from '../ui/screens/Today.tsx?raw';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

/** How a ride goes to the Garmin is chosen when it is sent, and in the player (10 Nov 2026 evening brief). */

const powerOnly = libraryById('lib-over-under')!;   // power only, with an outdoor version
/** The same ride as if it worked both ways: two kinds of target and two versions. */
const overUnder: Workout = { ...powerOnly, id: 'ou-both', bases: ['power', 'hr'] };
// A plan whose Saturdays are outdoor days. 2026-11-14 is a Saturday.
const plan: PlanDays = { id: 'p1', start: '2026-11-09', goalDate: '2027-01-31', availability: { outdoor: [true, false, false, false, false, false, true] } };
/** A ride the rider built, with quick alternating targets, so it has an outdoor version. */
const mine: Workout = { ...powerOnly, id: 'mine-ou', name: 'My over-unders', source: 'mine', tags: undefined };
const me = (basis: 'power' | 'hr') => ({ id: 'me', name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 75, basis, masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 }) as unknown as Profile & { id: 'me' };
const putPlan = () => db.plans.put({ id: 'p1', start: plan.start, goalDate: plan.goalDate, availability: { outdoor: plan.availability.outdoor, hours: [1, 1, 1, 1, 1, 1, 1], equipment: ['bodyweight'] }, goal: { kind: 'general', weeks: 12 } } as never);

/** What a send carries to Intervals.icu, captured. */
function captureSends() {
  const bodies: Array<{ description: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && init.body) bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return bodies;
}

beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => vi.unstubAllGlobals());

describe('nothing is set on a ride’s page or the calendar', () => {
  it('the ride page has no switches: no Ride by, Show as or Riding it', () => {
    expect(workoutSrc).not.toMatch(/'Ride by'|'Show as'|Riding it|setEntryBasis|setWhere/);
    expect(workoutSrc).toMatch(/<SendButton /);
  });
  it('Today has the same Send button, and no separate outdoor line', () => {
    expect(todaySrc).toMatch(/<SendButton /);
    expect(todaySrc).not.toMatch(/Goes to your Garmin/);
  });
  it('the player opens on the rider’s default, whatever the page or the send', () => {
    const line = playerSrc.split('\n').find((l) => l.includes('useState<Basis>('))!;
    expect(line).toMatch(/profile\.basis/);
    expect(line).not.toMatch(/planned|asked/);
    expect(workoutSrc).not.toMatch(/\?basis=/);
  });
});

describe('the main Send sends what its words say', () => {
  it('an unsent two-way ride goes with the rider’s default targets, and its plan’s version for that day', async () => {
    await db.profile.put(me('hr')); await putPlan();
    const bodies = captureSends();
    const { sendPlanned } = await import('../ui/planService');
    const e1: PlannedWorkout = { id: 'e1', date: '2026-11-14', workoutId: overUnder.id, basis: 'power', status: 'planned', planId: 'p1' };
    await db.planned.put(e1);
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, e1, overUnder);
    expect(r.sent).toEqual({ basis: 'hr', where: 'outdoor' });
    expect(sendWords(r.sent)).toBe('by heart rate, outdoor version');
    expect(bodies).toHaveLength(1);
    const after = await db.planned.get('e1');
    expect(after).toMatchObject({ status: 'sent', basis: 'hr', sentBasis: 'hr', sentWhere: 'outdoor' });
  });

  it('the arrow’s choice wins: by power, as written', async () => {
    await db.profile.put(me('hr')); await putPlan();
    const bodies = captureSends();
    const { sendPlanned } = await import('../ui/planService');
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, { id: 'e2', date: '2026-11-14', workoutId: overUnder.id, basis: 'hr', status: 'planned', planId: 'p1' }, overUnder, undefined, { basis: 'power', where: 'trainer' });
    expect(r.sent).toEqual({ basis: 'power', where: 'trainer' });
    expect(bodies[0].description).toMatch(/105%/);   // as written keeps the over at 105%
  });

  it('a one-way ride goes its one way whatever is asked', async () => {
    await db.profile.put(me('hr'));
    captureSends();
    const { sendPlanned } = await import('../ui/planService');
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, { id: 'e3', date: '2026-11-17', workoutId: powerOnly.id, basis: 'power', status: 'planned' }, powerOnly, undefined, { basis: 'hr' });
    expect(powerOnly.bases).toEqual(['power']);
    expect(r.sent.basis).toBe('power');
  });

  it('a sent ride with no choice goes again as the Garmin has it (a re-send after new numbers)', async () => {
    await db.profile.put(me('power')); await putPlan();
    captureSends();
    const { sendPlanned } = await import('../ui/planService');
    const sent: PlannedWorkout = { id: 'e4', date: '2026-11-14', workoutId: overUnder.id, basis: 'hr', status: 'sent', icuEventId: 7, planId: 'p1', sentBasis: 'hr', sentWhere: 'trainer' };
    await db.planned.put(sent);
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, sent, overUnder);
    expect(r.sent).toEqual({ basis: 'hr', where: 'trainer' });
  });
});

describe('a workout the rider built goes as written unless they choose Outdoor', () => {
  it("as written on a plan's outdoor weekday", () => {
    expect(hasTwoVersions(mine)).toBe(true);
    expect(defaultWhere({ date: '2026-11-14', planId: 'p1' }, mine, [plan])).toBe('trainer');
    expect(defaultWhere({ date: '2026-11-14', planId: 'p1' }, overUnder, [plan])).toBe('outdoor');
  });
  it('sent as written by default, and softened when Outdoor is chosen', async () => {
    await db.profile.put(me('power')); await putPlan();
    const bodies = captureSends();
    const { sendPlanned } = await import('../ui/planService');
    const entry: PlannedWorkout = { id: 'e5', date: '2026-11-14', workoutId: mine.id, basis: 'power', status: 'planned', planId: 'p1' };
    expect((await sendPlanned({ athleteId: 'x', apiKey: 'y' }, entry, mine)).version).toBe('as written');
    expect(bodies[0].description).toMatch(/105%/);
    expect((await sendPlanned({ athleteId: 'x', apiKey: 'y' }, entry, mine, undefined, { basis: 'power', where: 'outdoor' })).version).toBe('outdoor');
    expect(bodies[1].description).not.toMatch(/105%/);
  });
});

describe('the calendar row says how a ride went', () => {
  it('"On Garmin, by power, outdoor"; a session that is not a ride keeps "On Garmin"', async () => {
    const { sentRowWord } = await import('../ui/SendButton');
    const e: PlannedWorkout = { id: 'e6', date: '2026-11-14', workoutId: overUnder.id, basis: 'power', status: 'sent', sentBasis: 'power', sentWhere: 'outdoor' };
    expect(sentRowWord(e, overUnder, [plan])).toBe('On Garmin, by power, outdoor');
    expect(sentRowWord({ ...e, sentBasis: 'hr', sentWhere: 'trainer' }, overUnder, [plan])).toBe('On Garmin, by heart rate');
    expect(sentRowWord({ ...e, status: 'planned' }, overUnder, [plan])).toBeUndefined();
    expect(sentRowWord(e, { ...overUnder, kind: 'strength' }, [plan])).toBeUndefined();
  });
});
