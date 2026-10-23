import { describe, expect, it } from 'vitest';
import { flattenSteps, flattenStepsWithSets, stepShare, stepTargets, stepTip } from './workout';
import type { Profile, WorkoutBlock } from './types';
import { DEFAULT_PROFILE } from '../data/db';
import { LIBRARY } from '../library/workouts';

const todd: Profile = { ...DEFAULT_PROFILE, ftp: 210, lthr: 154, maxHr: 180, hrZoneMode: 'abs', hrZoneTops: [116, 132, 145, 157, 168, 176] } as Profile;
const blocks: WorkoutBlock[] = [
  { kind: 'step', seconds: 600, intensity: 0.5, intensityHigh: 0.65, label: 'Warm up' },
  { kind: 'repeat', times: 3, label: 'Sweet spot', steps: [{ kind: 'step', seconds: 600, intensity: 0.88, intensityHigh: 0.93, cadence: 90 }, { kind: 'step', seconds: 300, intensity: 0.55, label: 'Easy' }] },
  { kind: 'step', seconds: 300, intensity: 0.55, noFloor: true, label: 'Cool down' },
];

describe('Batch 7 B: what the ride diagram shows under the pointer', () => {
  it('lists the steps in ride order with the set each belongs to', () => {
    const s = flattenStepsWithSets(blocks);
    expect(s.map((x) => x.step)).toEqual(flattenSteps(blocks));
    expect(s[0].set).toBeUndefined();
    expect(s.slice(1, 7).map((x) => x.set?.rep)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(s[3].set).toEqual({ label: 'Sweet spot', rep: 2, times: 3 });
    expect(s[7].set).toBeUndefined();
  });

  it('a plain step: its name, time, share of FTP, watts and beats', () => {
    const t = stepTip(blocks[0] as never, undefined, todd);
    expect(t).toMatchObject({ title: 'Warm up', time: '10m', share: '50–65%' });
    expect(t.watts).toBe(`${stepTargets(blocks[0] as never, todd).watts} W`);
    expect(t.bpm).toBe(`${stepTargets(blocks[0] as never, todd).bpm} bpm`);
  });

  it('a step in a repeat, with a cadence: "Sweet spot · set 2 of 3 · 90 rpm", and the table’s numbers', () => {
    const s = flattenStepsWithSets(blocks)[3];
    const t = stepTip(s.step, s.set, todd);
    expect(t.title).toBe('Sweet spot · set 2 of 3 · 90 rpm');
    expect(stepTip(flattenStepsWithSets(blocks)[4].step, flattenStepsWithSets(blocks)[4].set, todd).title).toBe('Easy · set 2 of 3');   // its own name wins
    expect(t.share).toBe('88–93%');
    expect(t.watts).toBe('185–195 W');
  });

  it('a step with no minimum reads "up to"', () => {
    const t = stepTip(blocks[2] as never, undefined, todd);
    expect(t.share).toBe('up to 55%');
    expect(t.watts).toMatch(/^up to \d+ W$/);
    expect(t.bpm).toMatch(/^up to \d+ bpm$/);
  });

  it('the share of FTP is the same text the steps table shows, for every step of every Library ride', () => {
    for (const w of LIBRARY) for (const { step, set } of flattenStepsWithSets(w.blocks)) expect(stepTip(step, set, todd).share).toBe(stepShare(step));
  });
});
