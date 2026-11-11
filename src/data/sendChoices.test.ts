import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { libraryById } from '../library/workouts';
import { defaultWhere, hasTwoVersions, type PlanDays } from '../library/sendWhere';
import type { PlannedWorkout, Workout } from '../engine/types';
import playerSrc from '../ui/screens/Player.tsx?raw';
import workoutSrc from '../ui/screens/Workout.tsx?raw';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

/** Fixes from the review of the 9–10 Nov builds, Part B (10 Nov 2026). */

const overUnder = libraryById('lib-over-under')!;
const oldRag = libraryById('b1-vo2-hr-5x4')!;
// A plan whose Saturdays are outdoor days. 2026-11-14 is a Saturday.
const plan: PlanDays = { id: 'p1', start: '2026-11-09', goalDate: '2027-01-31', availability: { outdoor: [true, false, false, false, false, false, true] } };
/** A ride the rider built, with quick alternating targets, so it has an outdoor version. */
const mine: Workout = { ...overUnder, id: 'mine-ou', name: 'My over-unders', source: 'mine', tags: undefined };

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

describe('One control for power or heart rate (10 Nov 2026)', () => {
  it('on an entry page the switch is the setting, "Ride by"; elsewhere a view, "Show as"; no second control', () => {
    expect(workoutSrc).toMatch(/entryPage \? 'Ride by' : 'Show as'/);
    expect(workoutSrc).not.toMatch(/Change it to/);
    expect(workoutSrc).not.toMatch(/This entry is set to/);
    expect(workoutSrc).toMatch(/if \(entryPage\) \{ if \(b !== plannedEntry!\.basis\) void setEntryBasis/);
  });

  it('an entry page needs a date in its link, so a Library page never changes a calendar entry', () => {
    expect(workoutSrc).toMatch(/const entryPage = !!plannedEntry && !!params\.get\('date'\)/);
  });

  it('the player opened from the page uses the page’s choice, ahead of the entry’s setting', () => {
    const line = playerSrc.split('\n').find((l) => l.includes('useState<Basis>('))!;
    expect(line.indexOf('asked')).toBeLessThan(line.indexOf('planned.basis'));
    expect(workoutSrc).toMatch(/#\/play\/planned\/\$\{plannedEntry\.id\}\?basis=\$\{basis\}/);
  });

  it('Ride by changes the entry; on an entry sent before 10 Nov it records what the Garmin holds, so Send again is offered', async () => {
    const { setEntryBasis } = await import('../ui/planService');
    const old: PlannedWorkout = { id: 'e1', date: '2026-11-18', workoutId: oldRag.id, basis: 'power', status: 'sent', icuEventId: 9 };
    await db.planned.put(old);
    await setEntryBasis('e1', 'hr');
    const after = await db.planned.get('e1');
    expect(after!.basis).toBe('hr');
    expect(after!.sentBasis).toBe('power');
  });

  it('the outdoors/trainer switch on an entry sent before 10 Nov records what the page showed', async () => {
    const { setWhere } = await import('../ui/planService');
    await db.planned.put({ id: 'e2', date: '2026-11-14', workoutId: overUnder.id, basis: 'power', status: 'sent', icuEventId: 9 });
    await setWhere('e2', 'trainer', 'outdoor');
    const after = await db.planned.get('e2');
    expect(after!.where).toBe('trainer');
    expect(after!.sentWhere).toBe('outdoor');
  });
});

describe('B2 and B3: what goes to the Garmin, and what the rider is told', () => {
  it("a ride the rider built goes as written on a plan's outdoor weekday", () => {
    expect(hasTwoVersions(mine)).toBe(true);
    expect(defaultWhere({ date: '2026-11-14', planId: 'p1' }, mine, [plan])).toBe('trainer');
    expect(defaultWhere({ date: '2026-11-14', planId: 'p1' }, overUnder, [plan])).toBe('outdoor');
  });

  it('the rider’s own ride is sent as written by default, and softened once they choose Outdoors', async () => {
    const { sendPlanned } = await import('../ui/planService');
    await db.plans.put({ id: 'p1', start: plan.start, goalDate: plan.goalDate, availability: { outdoor: plan.availability.outdoor, hours: [1, 1, 1, 1, 1, 1, 1], equipment: ['bodyweight'] }, goal: { kind: 'general', weeks: 12 } } as never);
    const bodies = captureSends();
    const entry: PlannedWorkout = { id: 'e3', date: '2026-11-14', workoutId: mine.id, basis: 'power', status: 'planned', planId: 'p1' };
    const asWritten = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, entry, mine);
    expect(asWritten.version).toBe('as written');
    expect(bodies[0].description).toMatch(/105%/);
    const softened = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, { ...entry, where: 'outdoor' }, mine);
    expect(softened.version).toBe('outdoor');
    expect(bodies[1].description).not.toMatch(/105%/);
  });

  it('a one-version ride reports no version, so no extra words are shown', async () => {
    const { sendPlanned } = await import('../ui/planService');
    captureSends();
    const r = await sendPlanned({ athleteId: 'x', apiKey: 'y' }, { id: 'e4', date: '2026-11-14', workoutId: oldRag.id, basis: 'power', status: 'planned' }, oldRag);
    expect(r.version).toBeUndefined();
  });
});
