import { describe, expect, it } from 'vitest';
import { LIBRARY, libraryById } from './workouts';
import { readyMadeSessions } from './sessions';
import { outdoorRating, tagsOf } from './tags';
import type { Workout } from '../engine/types';

const EVERYTHING = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk']);

describe('Library tags (9 Nov 2026, Part A)', () => {
  it('every Library workout carries its tags as data', () => {
    for (const w of [...LIBRARY, ...EVERYTHING]) {
      expect(w.tags, w.name).toBeDefined();
      expect(w.tags!.minutes, w.name).toBeGreaterThan(0);
      if (w.kind === 'ride') expect(w.tags!.outdoor, w.name).toBeDefined();
      else expect(w.tags!.outdoor, w.name).toBeUndefined();
    }
  });

  it('fast on/off work and drills are indoors only; the Ramp Test too', () => {
    expect(libraryById('lib-vo2-30-30')!.tags!.outdoor).toBe('indoor');
    expect(libraryById('in-vo2-40-20')!.tags!.outdoor).toBe('indoor');
    expect(libraryById('in-spinups')!.tags!.outdoor).toBe('indoor');
    expect(LIBRARY.filter((w) => w.trainerOnly).every((w) => w.tags!.outdoor === 'indoor')).toBe(true);
  });

  it('every ride written for the road rides well outdoors', () => {
    for (const w of LIBRARY.filter((x) => x.setting === 'outdoor')) expect(w.tags!.outdoor, w.subtitle).toBe('well');
  });

  it('clusters of short steps and long single-number targets are adjusted for outdoors', () => {
    expect(libraryById('lib-over-under')!.tags!.outdoor).toBe('adjustable');
    expect(libraryById('in-ss-bursts')!.tags!.outdoor).toBe('adjustable');
    const held = (seconds: number, high?: number): Workout => ({ id: 'x', name: 'x', kind: 'ride', family: 'threshold', purpose: '', phases: ['any'], bases: ['power'], setting: 'any', source: 'mine', blocks: [{ kind: 'step', seconds, intensity: 0.95, intensityHigh: high }] });
    expect(outdoorRating(held(600))).toBe('adjustable');
    expect(outdoorRating(held(600, 1.0))).toBe('well');
    expect(outdoorRating(held(60))).toBe('well');
  });

  it('purpose and intensity follow what the ride is, not just its average', () => {
    const vo2 = libraryById('lib-vo2-5x3')!;
    expect(vo2.tags!.purpose).toBe('vo2');
    expect(vo2.tags!.intensity).toBe('very-hard');
    expect(libraryById('in-race-sim')!.tags!.purpose).toBe('mixed');
    expect(libraryById('lib-spin-30')!.tags!.intensity).toBe('easy');
  });

  it("a rider's own workout gets tags worked out on the spot", () => {
    const mine: Workout = { id: 'm1', name: 'Mine', kind: 'ride', family: 'sweetspot', purpose: '', phases: ['any'], bases: ['power'], setting: 'any', source: 'mine', blocks: [{ kind: 'step', seconds: 3600, intensity: 0.88, intensityHigh: 0.93 }] };
    expect(tagsOf(mine)).toMatchObject({ purpose: 'sweetspot', minutes: 60, outdoor: 'well' });
  });
});
