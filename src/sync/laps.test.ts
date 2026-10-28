import { describe, expect, it } from 'vitest';
import { nameLaps, sessionLapNames } from './intervals';
import type { Workout } from '../engine/types';

// Todd's two sessions of 28 Oct, as the app holds them, and the laps his Epix recorded.
const side = (name: string, holdSeconds: number) => ({ name, holdSeconds, reps: 'each side', cue: 'x', equipment: [] });
const mobility = { id: 'm', name: 'Mobility: after strength (10 min)', kind: 'mobility', exercises: [side('Couch stretch', 60), side('Half-kneeling hip flexor stretch', 45), side('Pigeon', 60), side('Figure-four', 45), side('Hamstring stretch with strap', 45)] } as unknown as Workout;
const strength = { id: 's', name: 'Strength A: legs and trunk', kind: 'strength', effort: 6, exercises: [
  { name: 'Bodyweight squat', reps: '10–12', sets: 3 }, { name: 'Reverse lunge', reps: '10–12 per side', sets: 3 }, { name: 'Hip thrust on bench', reps: '10–12', sets: 3 },
  { name: 'Side-lying leg raise', reps: '10–12 per side', sets: 2 }, { name: 'Plank', holdSeconds: 30, sets: 2 }, { name: 'Side plank', holdSeconds: 30, sets: 2 },
].map((e) => ({ cue: 'x', equipment: [], ...e })) } as unknown as Workout;
const laps = (secs: number[]) => { let t = 0; return secs.map((s) => ({ start: t, end: (t += s) })); };

describe('naming the laps of a strength or mobility recording', () => {
  it("names this morning's mobility laps, ignoring the 2-second end lap", () => {
    const r = nameLaps(laps([63, 64, 43, 43, 96, 65, 44, 45, 47, 44, 2]), sessionLapNames(mobility));
    expect(r.matched).toBe(true);
    expect(r.names.slice(0, 3)).toEqual(['Couch stretch, left side', 'Couch stretch, right side', 'Half-kneeling hip flexor stretch, left side']);
    expect(r.names[9]).toBe('Hamstring stretch with strap, right side');
  });
  it("names this morning's strength laps: sets and rests, in order", () => {
    const secs = [55, 91, 60, 98, 55, 89, 121, 85, 80, 85, 101, 96, 56, 91, 73, 88, 67, 95, 123, 94, 100, 89, 37, 38, 35, 41, 29, 46, 33, 45, 4];
    const r = nameLaps(laps(secs), sessionLapNames(strength));
    expect(r.matched).toBe(true);
    expect(r.names.slice(0, 3)).toEqual(['Bodyweight squat, set 1 of 3', 'Rest', 'Bodyweight squat, set 2 of 3']);
    expect(r.names[22]).toBe('Plank, set 1 of 2');
    expect(r.names[29]).toBe('Rest');
  });
  it('numbers the laps, never guesses, when a lap press was missed or extra', () => {
    const r = nameLaps(laps([63, 64, 43, 96, 65, 44, 45, 47, 44]), sessionLapNames(mobility));
    expect(r.matched).toBe(false);
    expect(r.names[0]).toBe('Lap 1');
  });
  it('numbers the laps of a recording with no session', () => {
    expect(nameLaps(laps([60, 60]), undefined)).toEqual({ names: ['Lap 1', 'Lap 2'], matched: false });
  });
});
