import { describe, expect, it } from 'vitest';
import { CORE, LIBRARY } from './workouts';
import { REWORK_IDS, REWORKED } from './rework';
import { OUTDOOR } from './outdoor';
import { INDOOR } from './indoor';
import { BATCH1 } from './batch1';
import { BATCH2 } from './batch2';
import { trainsOf } from './trains';
import { workoutStats } from '../engine/workout';
import { stepProblems } from './stepRule';
import { outdoorVersion, tagsOf } from './tags';

/** The rides as they were before the rework, by id: the batches and the outdoor and indoor sets carry them unchanged. */
const before = new Map([...CORE, ...OUTDOOR, ...INDOOR, ...BATCH1, ...BATCH2].map((w) => [w.id, w]));

describe('the dullest rides, reworked (B7)', () => {
  it('thirty of them', () => { expect(REWORK_IDS.length).toBe(30); expect(Object.keys(REWORKED).length).toBe(30); });
  for (const id of REWORK_IDS) it(id, () => {
    const now = LIBRARY.find((w) => w.id === id)!;
    const was = before.get(id);
    expect(now.why).toBeTruthy();
    const s = workoutStats(now.blocks);
    // Name, family and place in plans kept; length within 5 minutes; load within 10%; still the same system.
    expect(was, id).toBeTruthy();
    if (was) {
      const s0 = workoutStats(was.blocks);
      expect(Math.abs(s.seconds - s0.seconds)).toBeLessThanOrEqual(300);
      expect(Math.abs(s.tss - s0.tss) / s0.tss, `${now.name}: ${s0.tss} → ${s.tss}`).toBeLessThanOrEqual(0.1);
      expect(now.family).toBe(was.family);
      const sys0 = trainsOf(was).counted.filter((x) => x !== 'endurance');
      const sys = trainsOf(now).counted;
      for (const x of sys0) expect(sys).toContain(x);
    }
    expect(trainsOf(now).counted.length).toBeLessThanOrEqual(3);
    expect(stepProblems(now)).toEqual([]);
    // Rides that worked outdoors still do.
    if (was && tagsOf(was).outdoor !== 'indoor') expect(tagsOf(now).outdoor).not.toBe('indoor');
    expect(outdoorVersion(now).workout.blocks.length).toBeGreaterThan(0);
  });
});
