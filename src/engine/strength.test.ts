import { describe, expect, it } from 'vitest';
import { generateStrength } from './sessions';
import { EXERCISES, exercisesFor } from '../library/strength';
import type { Equipment } from './types';

const home: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'band'];
const gym: Equipment[] = [...home, 'barbell', 'pullup-bar', 'dip-bars'];
const names = (eq: Equipment[], v: 'A' | 'B', week: number) =>
  generateStrength({ level: 'foundation', minutes: 45, equipment: eq, variant: v, weekInBlock: week, reason: '' }).exercises!.map((e) => e.name);

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
  it('the A and B days include a rotation and a carry with home equipment', () => {
    const a = names(home, 'A', 0), b = names(home, 'B', 0);
    expect(a.some((n) => /twist|woodchop|pallof/i.test(n))).toBe(true);
    expect(b.some((n) => /carry/i.test(n))).toBe(true);
  });
  it('bodyweight only still gets a full session (carry and rotate fall back to trunk work)', () => {
    const b = names(['bodyweight'], 'B', 0);
    expect(b.length).toBeGreaterThanOrEqual(4);
    expect(b.some((n) => /plank|dead bug|bird dog|hollow/i.test(n))).toBe(true);
  });
  it('exercise-specific reps override the scheme (pull-ups 3–8)', () => {
    for (let w = 0; w < 8; w++) {
      const ex = generateStrength({ level: 'build', minutes: 50, equipment: gym, variant: 'B', weekInBlock: w, reason: '' }).exercises!;
      const pu = ex.find((e) => e.name === 'Pull-up');
      if (pu) { expect(pu.reps).toBe('3–8'); return; }
    }
    throw new Error('pull-up never chosen over eight weeks');
  });
  it('kettlebell: its exercises appear only with one, lead the rotation, and get their own session', async () => {
    const all = (eq: Equipment[]) => (['squat', 'hinge', 'single-leg', 'push', 'pull', 'carry', 'rotate', 'trunk'] as const).flatMap((p) => exercisesFor(p, eq).map((e) => e.id));
    expect(all(home).some((id) => id.startsWith('kb-'))).toBe(false);
    const kb: Equipment[] = [...home, 'kettlebell'];
    expect(exercisesFor('hinge', kb)[0].id.startsWith('kb-')).toBe(true);
    const a = names(kb, 'A', 0), b = names(kb, 'B', 0);
    expect([...a, ...b].some((n) => /Kettlebell/.test(n))).toBe(true);
    // a barbell still comes before the kettlebell
    expect(exercisesFor('hinge', [...kb, 'barbell'])[0].equipment).toContain('barbell');
    const { readyMadeSessions } = await import('../library/sessions');
    expect(readyMadeSessions(home).some((w) => w.id === 'lib-str-kettlebell')).toBe(false);
    const session = readyMadeSessions(kb).find((w) => w.id === 'lib-str-kettlebell')!;
    expect(session.exercises!.map((e) => e.name)).toEqual(['Kettlebell swing', 'Kettlebell goblet squat', 'Kettlebell overhead press', 'Kettlebell row', 'Kettlebell reverse lunge, racked', 'Kettlebell suitcase carry', 'Kettlebell Turkish get-up']);
    expect(session.exercises!.find((e) => e.name === 'Kettlebell Turkish get-up')!.load).toMatch(/Light kettlebell/);
  });
});
