import { describe, expect, it } from 'vitest';
import { activityLine, describeSession, durationWords } from './claude';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';

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
  it('gives a done session its recorded duration, named, so it cannot be confused with the training load', () => {
    const walk = { ...strength, name: 'Recovery walk', kind: 'walk', minutes: 30, estimatedTss: 12, exercises: undefined, walk: { hrLow: 0, hrHigh: 0.7 } } as Workout;
    const rec = { id: 'a', date: '2026-10-19', startTime: '', name: 'Recovery walk', type: 'Walk', sport: 'walk', seconds: 1839, tss: 16, averageHr: 92 } as Ride;
    const line = describeSession({ planned: planned({ status: 'completed', planId: 'plan', activityId: 'a' }), workout: walk, recorded: rec });
    expect(line).toMatch(/planned duration 30 min/);
    expect(line).toMatch(/recorded duration 30 min 39 s/);
    expect(line).toMatch(/recorded training load 16 TSS/);
    expect(activityLine(rec)).toMatch(/duration 30 min 39 s, training load 16 TSS/);
    expect(durationWords(3900)).toBe('1 h 05 min');
  });
});
