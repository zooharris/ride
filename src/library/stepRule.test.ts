import { describe, expect, it } from 'vitest';
import { stepProblems } from './stepRule';
import { LIBRARY } from './workouts';
import { outdoorVersion } from './tags';
import type { Workout, WorkoutStep } from '../engine/types';

/** Every step change must mean something (10 Nov 2026 brief, Part 1). */

const s = (intensity: number, extra: Partial<WorkoutStep> = {}): WorkoutStep => ({ kind: 'step', seconds: 300, intensity, ...extra });
const ride = (steps: WorkoutStep[], bases: Workout['bases'] = ['power']): Workout => ({ id: 't', name: 'T', family: 'endurance', phases: ['any'], bases, blocks: steps, source: 'mine', setting: 'any', kind: 'ride' } as Workout);

describe('the rule', () => {
  it('identical targets fail', () => expect(stepProblems(ride([s(0.6), s(0.6, { label: 'Other' })]))).toHaveLength(1));
  it('targets a few watts apart fail', () => expect(stepProblems(ride([s(0.70), s(0.72)]))).toHaveLength(1));
  it('a target inside the one before fails', () => expect(stepProblems(ride([s(0.55, { intensityHigh: 0.75 }), s(0.65)]))).toHaveLength(1));
  it('two easy ceilings that are the same fail, whatever their expected effort', () =>
    expect(stepProblems(ride([s(0.45, { intensityHigh: 0.55, noFloor: true }), s(0.55, { intensityHigh: 0.55, noFloor: true })]))).toHaveLength(1));
  it('a real change of target passes', () => expect(stepProblems(ride([s(0.6, { intensityHigh: 0.72 }), s(0.88, { intensityHigh: 0.93 })]))).toHaveLength(0));
  it('a cadence change passes', () => expect(stepProblems(ride([s(0.55), s(0.55, { cadence: 105 })]))).toHaveLength(0));
  it('a cue at the start of the new step passes', () => expect(stepProblems(ride([s(0.5), s(0.5, { cues: [{ at: 0, text: 'The work is done.' }] })]))).toHaveLength(0));
  it('a recovery ride with spin-ups inside one easy ceiling passes', () => {
    const easy = s(0.45, { intensityHigh: 0.55 }), spin = s(0.5, { intensityHigh: 0.58, cadence: 105 });
    expect(stepProblems(ride([easy, spin, easy, spin, easy]))).toHaveLength(0);
  });
  it('a ride by heart rate also needs heart-rate targets that differ', () => {
    const stairs = [s(0.86, { intensityHigh: 0.9 }), s(0.89, { intensityHigh: 0.93 })];
    expect(stepProblems(ride(stairs, ['power']))).toHaveLength(0);
    expect(stepProblems(ride(stairs, ['power', 'hr']))[0]?.why).toBe('heart rate');
  });
});

describe('every Library ride passes, and so does its outdoor version', () => {
  for (const w of LIBRARY.filter((x) => x.kind === 'ride')) {
    it(w.name, () => {
      expect(stepProblems(w), w.id).toEqual([]);
      expect(stepProblems(outdoorVersion(w).workout), `${w.id} outdoors`).toEqual([]);
    });
  }
});
