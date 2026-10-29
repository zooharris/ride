import { describe, expect, it } from 'vitest';
import { buildDoneRecord, lastDone, mayWriteDescription, recordText, recordTss } from './record';
import type { PlannedWorkout, Workout } from './types';

const strength = { kind: 'strength', minutes: 40, exercises: [
  { name: 'Goblet squat', sets: 3, reps: '10–12', cue: 'c', equipment: ['dumbbells'] },
  { name: 'Side plank', sets: 2, holdSeconds: 30, cue: 'c', equipment: ['bodyweight'] },
] } as unknown as Workout;

describe('the record of what was done', () => {
  it('copies the plan for strength and mobility, with library ids', () => {
    const r = buildDoneRecord(strength)!;
    expect(r.exercises).toHaveLength(2);
    expect(r.exercises![0]).toMatchObject({ name: 'Goblet squat', exerciseId: 'goblet-squat', sets: 3, reps: '10–12' });
    expect(r.exercises![1]).toMatchObject({ holdSeconds: 30, exerciseId: 'side-plank' });
    expect(r.editedAt).toBeUndefined();
  });
  it('records a walk as minutes and pack, using logged minutes when given', () => {
    const w = { kind: 'walk', walk: { minutes: 45, hrLow: 0.6, hrHigh: 0.7, packKg: 6.8 } } as unknown as Workout;
    expect(buildDoneRecord(w)).toEqual({ walk: { minutes: 45, packKg: 6.8 } });
    expect(buildDoneRecord(w, 38)!.walk!.minutes).toBe(38);
  });
  it('has no record for a ride', () => {
    expect(buildDoneRecord({ kind: 'ride' } as Workout)).toBeUndefined();
  });
  it('writes a readable description ending with the app mark', () => {
    const r = buildDoneRecord(strength)!;
    r.exercises![0].weight = 35; r.exercises![0].unit = 'lb';
    r.exercises![1].skipped = true;
    const t = recordText('Strength A', r, 7, 'imperial');
    expect(t).toBe('Strength A — what was done\nGoblet squat · 3 × 10–12 · 35 lb\nSide plank · skipped\nEffort 7/10\n— AntoVelo');
    expect(mayWriteDescription('')).toBe(true);
    expect(mayWriteDescription(t)).toBe(true);
    expect(mayWriteDescription('Felt strong today')).toBe(false);
    expect(mayWriteDescription('Strength A — what was done\nEffort 6/10\n— VeloIQ')).toBe(true); // written before the rename
  });
  it('finds the last weight used, latest first, ignoring skipped and later days', () => {
    const p = (date: string, weight: number | undefined, skipped = false): PlannedWorkout => ({ id: date, date, workoutId: 'w', basis: 'power', status: 'completed',
      done: { exercises: [{ name: 'Goblet squat', exerciseId: 'goblet-squat', sets: 3, reps: '10', weight, unit: 'lb', skipped }] } });
    const history = [p('2026-10-06', 30), p('2026-10-13', 35), p('2026-10-16', 40, true), p('2026-10-20', 45)];
    expect(lastDone('Goblet squat', history, '2026-10-20')).toMatchObject({ weight: 35, date: '2026-10-13' });
    expect(lastDone('Goblet squat', history)).toMatchObject({ weight: 45 });
    expect(lastDone('Plank', history)).toBeUndefined();
  });
  it('takes strength load from the effort rating, and only for strength', () => {
    expect(recordTss(strength, 2400, 7)).toBeGreaterThan(20);
    expect(recordTss(strength, 2400, undefined)).toBeUndefined();
    expect(recordTss({ kind: 'mobility' } as Workout, 600, 5)).toBeUndefined();
  });
});
