import { describe, expect, it } from 'vitest';
import { countsOf, equipmentText, matchItems, usualText } from './ExerciseAdd';
import { buildDoneRecord, lastDone } from '../engine/record';
import { sessionLapNames, sessionSteps } from '../sync/intervals';
import type { PlannedWorkout, Workout } from '../engine/types';

describe('adding exercises (13 Nov 2026)', () => {
  it('narrows the list by name, anywhere in the name, ignoring case and accents', () => {
    const items = [{ name: 'Farmer carry' }, { name: 'Suitcase carry' }, { name: 'Goblet squat' }, { name: 'Child’s pose' }];
    expect(matchItems(items, 'car').map((i) => i.name)).toEqual(['Farmer carry', 'Suitcase carry']);
    expect(matchItems(items, 'SQUAT').map((i) => i.name)).toEqual(['Goblet squat']);
    expect(matchItems(items, 'childs')).toHaveLength(1);
    expect(matchItems(items, '  ')).toHaveLength(4);
    expect(matchItems(items, 'zzz')).toHaveLength(0);
  });
  it('counts how many times each exercise is in the session', () => {
    const c = countsOf([{ name: 'Suitcase carry' }, { name: 'Band kickback' }, { name: 'Suitcase carry' }]);
    expect(c.get('Suitcase carry')).toBe(2);
    expect(c.get('Band kickback')).toBe(1);
    expect(c.get('Goblet squat')).toBeUndefined();
  });
  it('says the usual sets and the equipment in words', () => {
    expect(usualText({ name: 'x', cue: '', equipment: [], sets: 3, reps: '8–10 per side' })).toBe('3 × 8–10 per side');
    expect(usualText({ name: 'x', cue: '', equipment: [], sets: 3, holdSeconds: 40 })).toBe('3 × 40 s');
    expect(usualText({ name: 'x', cue: '', equipment: [], holdSeconds: 45, reps: 'each side' })).toBe('45 s, each side');
    expect(equipmentText(['bodyweight'])).toBe('No equipment');
    expect(equipmentText(['dumbbells', 'bodyweight'])).toBe('Dumbbells');
    expect(equipmentText(['bench', 'dumbbells'])).toBe('A bench or sturdy chair or dumbbells');
  });
});

describe('an exercise in a session more than once', () => {
  const w = { kind: 'strength', minutes: 40, name: 'Carries', effort: 6, exercises: [
    { name: 'Suitcase carry', sets: 3, holdSeconds: 40, cue: 'c', equipment: ['dumbbells'], load: 'Light: warm-up' },
    { name: 'Band kickback', sets: 3, reps: '12–15 each side', cue: 'c', equipment: ['band'] },
    { name: 'Suitcase carry', sets: 2, holdSeconds: 60, cue: 'c', equipment: ['dumbbells'] },
  ] } as unknown as Workout;
  it('keeps a separate done row for each', () => {
    const r = buildDoneRecord(w)!;
    expect(r.exercises!.map((e) => e.name)).toEqual(['Suitcase carry', 'Band kickback', 'Suitcase carry']);
    expect(r.exercises![0].holdSeconds).toBe(40);
    expect(r.exercises![2].holdSeconds).toBe(60);
  });
  it('sends both, in order', () => {
    const text = sessionSteps(w).join('\n');
    expect(text.match(/Suitcase carry/g)).toHaveLength(2);
    expect(text.indexOf('Suitcase carry 40s')).toBeLessThan(text.indexOf('Band kickback'));
    expect(text.indexOf('Band kickback')).toBeLessThan(text.lastIndexOf('Suitcase carry 1m'));
    expect(sessionLapNames(w).filter((n) => n.startsWith('Suitcase carry'))).toHaveLength(5);
  });
  it('"Last time" is the heavier of the two, in any unit', () => {
    const done = (date: string, rows: Array<{ weight: number; unit: 'lb' | 'kg' }>) => ({
      id: date, date, status: 'completed', workoutId: 'w',
      done: { exercises: rows.map((r) => ({ name: 'Goblet squat', exerciseId: 'goblet-squat', sets: 3, reps: '10', ...r })) },
    }) as unknown as PlannedWorkout;
    expect(lastDone('Goblet squat', [done('2026-11-10', [{ weight: 20, unit: 'lb' }, { weight: 40, unit: 'lb' }])])!.weight).toBe(40);
    expect(lastDone('Goblet squat', [done('2026-11-10', [{ weight: 25, unit: 'kg' }, { weight: 40, unit: 'lb' }])])!.weight).toBe(25);
    // The latest session wins, as before.
    expect(lastDone('Goblet squat', [done('2026-11-03', [{ weight: 50, unit: 'lb' }]), done('2026-11-10', [{ weight: 30, unit: 'lb' }, { weight: 35, unit: 'lb' }])])).toMatchObject({ weight: 35, date: '2026-11-10' });
  });
});
