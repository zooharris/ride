import { describe, expect, it } from 'vitest';
import { readyMadeSessions } from '../library/sessions';
import { EXERCISES, exercisesFor } from '../library/strength';
import type { Equipment } from './types';

const home: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'band'];
const gym: Equipment[] = [...home, 'barbell', 'pullup-bar', 'dip-bars'];
const strength = (eq: Equipment[]) => readyMadeSessions(eq).filter((w) => w.kind === 'strength' && w.strength);
const names = (eq: Equipment[], focus: 'legs' | 'upper') => strength(eq).filter((w) => w.strength!.focus === focus).flatMap((w) => w.exercises!.map((e) => e.name));

describe('strength: seven patterns, home and gym versions', () => {
  it('every exercise has a unique id and a cue', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) expect(e.cue.length).toBeGreaterThan(20);
  });
  it('gym exercises appear only when the equipment is there', () => {
    const homeAll = (['squat', 'hinge', 'push', 'pull'] as const).flatMap((p) => exercisesFor(p, home).map((e) => e.name));
    for (const n of ['Back squat', 'Barbell deadlift', 'Barbell row', 'Pull-up', 'Dip', 'Barbell good morning']) expect(homeAll).not.toContain(n);
    expect(exercisesFor('pull', gym).map((e) => e.name)).toContain('Pull-up');
    expect(exercisesFor('squat', gym).map((e) => e.name)).toContain('Back squat');
  });
  it('the sessions by quality include rotation and carries with home equipment', () => {
    expect(names(home, 'legs').some((n) => /twist|woodchop|pallof/i.test(n))).toBe(true);
    expect(names(home, 'upper').some((n) => /carry/i.test(n))).toBe(true);
  });
  it('bodyweight only still gets complete sessions for both focuses', () => {
    for (const f of ['legs', 'upper'] as const) for (const w of strength(['bodyweight']).filter((x) => x.strength!.focus === f)) {
      expect(w.exercises!.length).toBeGreaterThanOrEqual(4);
      expect(w.exercises!.some((e) => /plank|dead bug|bird dog|hollow/i.test(e.name))).toBe(true);
    }
  });
  it('exercise-specific reps override the scheme (pull-ups 3–8)', () => {
    const gymUpper = readyMadeSessions(gym).find((w) => w.name === 'Heavy upper body, gym');
    expect(gymUpper).toBeUndefined();   // it needs a kettlebell and dumbbells too
    const full = readyMadeSessions([...gym, 'kettlebell']).find((w) => w.name === 'Heavy upper body, gym')!;
    expect(full.exercises!.find((e) => e.name === 'Pull-up')!.reps).toBe('3–8');
  });
  it('kettlebell: its exercises appear only with one, lead the rotation, and get their own session', async () => {
    const all = (eq: Equipment[]) => (['squat', 'hinge', 'single-leg', 'push', 'pull', 'carry', 'rotate', 'trunk'] as const).flatMap((p) => exercisesFor(p, eq).map((e) => e.id));
    expect(all(home).some((id) => id.startsWith('kb-'))).toBe(false);
    const kb: Equipment[] = [...home, 'kettlebell'];
    expect(exercisesFor('hinge', kb)[0].id.startsWith('kb-')).toBe(true);
    expect([...names(kb, 'legs'), ...names(kb, 'upper')].some((n) => /Kettlebell/.test(n))).toBe(true);
    // a barbell still comes before the kettlebell
    expect(exercisesFor('hinge', [...kb, 'barbell'])[0].equipment).toContain('barbell');
    const { readyMadeSessions } = await import('../library/sessions');
    expect(readyMadeSessions(home).some((w) => w.id === 'lib-str-kettlebell')).toBe(false);
    const session = readyMadeSessions(kb).find((w) => w.id === 'lib-str-kettlebell')!;
    expect(session.exercises!.map((e) => e.name)).toEqual(['Kettlebell swing', 'Kettlebell goblet squat', 'Kettlebell overhead press', 'Kettlebell row', 'Kettlebell reverse lunge, racked', 'Kettlebell suitcase carry', 'Kettlebell Turkish get-up']);
    expect(session.exercises!.find((e) => e.name === 'Kettlebell Turkish get-up')!.load).toMatch(/Light kettlebell/);
  });
});
