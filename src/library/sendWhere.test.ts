import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultWhere, hasTwoVersions, versionFor, whereFor, type PlanDays } from './sendWhere';
import { libraryById } from './workouts';
import { sendWorkout } from '../sync/intervals';
import { flattenStepsWithSets } from '../engine/workout';
import type { PlannedWorkout, Workout } from '../engine/types';

/** Outdoors or on a trainer, chosen when a ride goes to the Garmin (10 Nov 2026 brief, Part B). */

const overUnder = libraryById('lib-over-under')!;      // adjusted for outdoors
const sweetSpot = libraryById('lib-ss-3x15')!;         // rides well outdoors
// A plan whose Saturdays and Sundays are outdoor days. 2026-11-14 is a Saturday, 2026-11-17 a Tuesday.
const plan: PlanDays = { id: 'p1', start: '2026-11-09', goalDate: '2027-01-31', availability: { outdoor: [true, false, false, false, false, false, true] } };
const entry = (date: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({ id: date, date, workoutId: overUnder.id, basis: 'power', status: 'planned', planId: 'p1', ...extra });

/** The steps a send actually carries, captured from the request to Intervals.icu. */
async function sent(w: Workout, where: 'outdoor' | 'trainer'): Promise<string> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  await sendWorkout({ athleteId: 'x', apiKey: 'y' }, w, '2026-11-14', 'power', undefined, where);
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  return body.description as string;
}
afterEach(() => vi.unstubAllGlobals());

describe('which version goes to the Garmin', () => {
  it('an adjusted ride on an entry marked trainer is sent as written', async () => {
    expect(hasTwoVersions(overUnder)).toBe(true);
    const text = await sent(overUnder, 'trainer');
    expect(text).toMatch(/105%/);   // the over at 105%, as written
    expect(text).toMatch(/92%/);    // and the under
  });

  it('the same ride marked outdoors is sent softened', async () => {
    const text = await sent(overUnder, 'outdoor');
    expect(text).not.toMatch(/105%/);
    const steady = flattenStepsWithSets(versionFor(overUnder, 'outdoor').workout.blocks).map((x) => x.step).filter((s) => s.seconds === 540);
    expect(steady.length).toBe(3);
  });

  it('a ride that rides well outdoors is sent as written either way, and has no choice', async () => {
    expect(hasTwoVersions(sweetSpot)).toBe(false);
    expect(await sent(sweetSpot, 'outdoor')).toBe(await sent(sweetSpot, 'trainer'));
  });
});

describe('where, when the rider hasn’t chosen', () => {
  it("the plan's outdoor weekday gives outdoors; a weekday it doesn't mark gives trainer", () => {
    expect(defaultWhere(entry('2026-11-14'), overUnder, [plan])).toBe('outdoor');
    expect(defaultWhere(entry('2026-11-17'), overUnder, [plan])).toBe('trainer');
  });
  it('a hand-added entry inside a plan’s dates follows that plan too', () => {
    expect(defaultWhere(entry('2026-11-17', { planId: undefined }), overUnder, [plan])).toBe('trainer');
  });
  it("with no plan, the ride's own setting: written for indoors gives trainer, anything else outdoors", () => {
    expect(defaultWhere(entry('2026-11-17', { planId: undefined }), overUnder, [])).toBe('outdoor');
    expect(defaultWhere(entry('2026-11-17', { planId: undefined }), { setting: 'indoor', source: 'library' }, [])).toBe('trainer');
  });
  it("the rider's choice wins over the plan", () => {
    expect(whereFor(entry('2026-11-14', { where: 'trainer' }), overUnder, [plan])).toBe('trainer');
    expect(whereFor(entry('2026-11-17', { where: 'outdoor' }), overUnder, [plan])).toBe('outdoor');
  });
});

describe('every send goes through the entry’s choice', () => {
  it('the Calendar’s bulk send and the other screens call sendPlanned, never the sender directly', async () => {
    const sources = import.meta.glob('../ui/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [file, src] of Object.entries(sources)) expect(src, file).not.toMatch(/\bsendWorkout\(/);
  });
});
