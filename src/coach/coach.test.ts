import { describe, expect, it } from 'vitest';
import { describeSession } from './claude';
import type { PlannedWorkout, Workout } from '../engine/types';

const planned = (over: Partial<PlannedWorkout>): PlannedWorkout => ({ id: 'p', date: '2026-10-19', workoutId: 'w', basis: 'power', status: 'planned', ...over });
const strength: Workout = { id: 'w', name: 'Full body express', kind: 'strength', family: 'recovery', purpose: 'Keeps the strength work ticking over on a short day.', phases: [], bases: ['power', 'hr'], setting: 'any', blocks: [], minutes: 30, effort: 6, estimatedTss: 18, source: 'mine', exercises: [{ name: 'Goblet squat', sets: 3, reps: '8', cue: 'chest up', equipment: ['dumbbells'] }] } as Workout;

describe('the coach sees the whole calendar', () => {
  it('describes a hand-added strength session, with its exercises, as part of the day', () => {
    const line = describeSession({ planned: planned({}), workout: strength });
    expect(line).toMatch(/Full body express \(strength session\)/);
    expect(line).toMatch(/30 min/);
    expect(line).toMatch(/Goblet squat/);
    expect(line).toMatch(/added by the rider/);
    expect(line).toMatch(/not done yet/);
  });
  it('says when a session is already done so the coach does not prescribe it again', () => {
    const line = describeSession({ planned: planned({ status: 'completed', rpe: 7, loggedSeconds: 1500, planId: 'plan' }), workout: strength });
    expect(line).toMatch(/ALREADY DONE/);
    expect(line).toMatch(/felt 7\/10/);
    expect(line).not.toMatch(/added by the rider/);
  });
});
