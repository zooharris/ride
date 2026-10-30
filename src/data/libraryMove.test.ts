import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addDays, today } from '../engine/load';
import type { Exercise, Workout } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

/** A strength session as the planner built it before 30 Oct 2026. */
function oldStrength(id: string, variant: 'A' | 'B', sets: number, reps: string): Workout {
  const ex = (name: string): Exercise => ({ name, sets, reps, cue: 'c', equipment: ['dumbbells'] });
  return { id, name: `Strength ${variant}: ${variant === 'A' ? 'legs and trunk' : 'upper body and posterior chain'}`, kind: 'strength', family: 'recovery', purpose: 'old reason', phases: ['any'], bases: ['power', 'hr'], setting: 'indoor', blocks: [],
    exercises: [ex('Goblet squat'), ex('Dumbbell Romanian deadlift'), ex('Plank')], minutes: 40, estimatedTss: 30, source: 'generated' };
}

beforeEach(async () => { await db.delete(); await db.open(); });

describe('30 Oct 2026: planned strength moves onto Library sessions', () => {
  it('future plan sessions take the Library session for their focus and level; done and hand-added stay; idempotent', async () => {
    const { moveSessionsToLibrary } = await import('../ui/planService');
    const t = today();
    await db.workouts.bulkPut([oldStrength('gen-a', 'A', 4, '6–8'), oldStrength('gen-b', 'B', 2, '8'), oldStrength('gen-done', 'A', 3, '10–12'), oldStrength('gen-hand', 'A', 3, '10–12')]);
    await db.planned.bulkPut([
      { id: 'p1', date: addDays(t, 1), workoutId: 'gen-a', basis: 'power', status: 'planned', planId: 'plan' },
      { id: 'p2', date: addDays(t, 2), workoutId: 'gen-b', basis: 'power', status: 'planned', planId: 'plan' },
      { id: 'p3', date: addDays(t, -1), workoutId: 'gen-done', basis: 'power', status: 'completed', planId: 'plan' },
      { id: 'p4', date: addDays(t, 3), workoutId: 'gen-hand', basis: 'power', status: 'planned' },
    ]);
    const dry = await moveSessionsToLibrary({ dryRun: true });
    expect(dry.moves.map((m) => m.from)).toEqual(['Strength A: legs and trunk', 'Strength B: upper body and posterior chain']);
    expect((await db.planned.get('p1'))?.workoutId).toBe('gen-a');               // a dry run changes nothing

    const r = await moveSessionsToLibrary();
    expect(r.moves).toHaveLength(2);
    const w1 = await db.workouts.get((await db.planned.get('p1'))!.workoutId);
    const w2 = await db.workouts.get((await db.planned.get('p2'))!.workoutId);
    expect(w1).toMatchObject({ source: 'generated', strength: { focus: 'legs', dose: 'build' } });
    expect(w1!.libraryId).toMatch(/^lib-sq-/);
    expect(w2).toMatchObject({ strength: { focus: 'upper', dose: 'maintain' } });
    expect((await db.planned.get('p1'))!.reason).toMatch(/at Build level/);
    expect((await db.planned.get('p3'))?.workoutId).toBe('gen-done');
    expect((await db.planned.get('p4'))?.workoutId).toBe('gen-hand');
    expect(await db.workouts.get('gen-a')).toBeUndefined();                     // the old copy, no longer used, is pruned
    expect((await moveSessionsToLibrary()).moves).toEqual([]);                  // idempotent
  });

  it('a session already on the Garmin waits for a device that can send it again', async () => {
    const { moveSessionsToLibrary } = await import('../ui/planService');
    const t = today();
    await db.workouts.put(oldStrength('gen-s', 'A', 4, '6–8'));
    await db.planned.put({ id: 's1', date: addDays(t, 1), workoutId: 'gen-s', basis: 'power', status: 'sent', icuEventId: 5, planId: 'plan' });
    expect((await moveSessionsToLibrary()).moves).toEqual([]);                  // no credentials on this device
    expect((await db.planned.get('s1'))?.workoutId).toBe('gen-s');
  });
});
