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

describe('mobility: press lap when in position (31 Oct)', () => {
  const steps = (w: Workout) => import('./intervals').then((m) => m.sessionSteps(w));
  it('a per-side stretch gets a position step between its sides and before the next stretch', async () => {
    const lines = await steps(mobility);
    expect(lines.slice(0, 4)).toEqual([
      '- Couch stretch left side 1m',
      '- Press lap when in position for Couch stretch right side 15s',
      '- Couch stretch right side 1m',
      '- Press lap when in position for Half kneeling hip flexor stretch left side 15s',
    ]);
    expect(lines[lines.length - 1]).toBe('- Hamstring stretch with strap right side 45s');
    for (const l of lines.filter((x) => /when in position/.test(x))) expect(l).toMatch(/^- Press lap when in position for [A-Za-z0-9 ]+ 15s$/);
  });
  it('a single-side stretch is two steps with the move, and the first step of a session has none before it', async () => {
    const w = { ...mobility, exercises: [{ name: 'Cat cow', holdSeconds: 30, cue: 'x', equipment: [] }, { name: 'Child pose', holdSeconds: 40, cue: 'x', equipment: [] }] } as unknown as Workout;
    expect(await steps(w)).toEqual(['- Cat cow 30s', '- Press lap when in position for Child pose 15s', '- Child pose 40s']);
  });
  it('rounds are written out, each with its own position step, and the lap names follow step for step', async () => {
    const w = { ...mobility, exercises: [{ ...side('Pigeon', 60), sets: 2 }, { name: 'Child pose', holdSeconds: 40, cue: 'x', equipment: [] }] } as unknown as Workout;
    const lines = await steps(w);
    expect(lines.filter((l) => /^- Pigeon/.test(l))).toHaveLength(4);
    expect(lines.some((l) => /^\d+x$/.test(l))).toBe(false);
    expect(lines.filter((l) => /when in position/.test(l))).toHaveLength(4);
    const names = sessionLapNames(w);
    expect(names).toHaveLength(lines.length);
    expect(names.slice(0, 4)).toEqual(['Pigeon, left side, set 1 of 2', 'In position', 'Pigeon, right side, set 1 of 2', 'In position']);
  });
  it('a recording made before the position steps existed is still named', () => {
    const r = nameLaps(laps([63, 64, 43, 43, 96, 65, 44, 45, 47, 44, 2]), sessionLapNames(mobility));
    expect(r.matched).toBe(true);
    expect(r.names[1]).toBe('Couch stretch, right side');
  });
  it('a recording with the position steps names them', () => {
    const n = sessionLapNames(mobility);
    expect(n).toHaveLength(19);
    const r = nameLaps(laps(n.map(() => 30)), n);
    expect(r.matched).toBe(true);
    expect(r.names[1]).toBe('In position');
  });
  it('strength is unchanged', () => {
    expect(sessionLapNames(strength).includes('In position')).toBe(false);
  });
});

describe('a long stretch name keeps its side in the position step', () => {
  it('Half kneeling hip flexor stretch right side', async () => {
    const { sessionSteps } = await import('./intervals');
    expect(sessionSteps(mobility)).toContain('- Press lap when in position for Half kneeling hip flexor stretch right side 15s');
  });
});
