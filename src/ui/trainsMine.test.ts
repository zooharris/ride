import { describe, expect, it } from 'vitest';
import { applyFilters, NO_FILTERS } from './LibraryFilters';
import { trainsOf } from '../library/trains';
import type { Workout } from '../engine/types';

const step = (min: number, intensity: number) => ({ kind: 'step' as const, seconds: min * 60, intensity });
const mine = (blocks: Workout['blocks']): Workout => ({ id: 'mine-1', name: 'My sweet spot', kind: 'ride', family: 'sweetspot', purpose: 'x', phases: ['any'], bases: ['power', 'hr'], setting: 'any', blocks, source: 'mine' } as Workout);

describe('a ride of the rider\'s own says what it trains (13 Nov 2026)', () => {
  it('is measured like a Library ride and found by the Trains filter', () => {
    const w = mine([step(15, 0.6), step(20, 0.9), step(5, 0.55), step(20, 0.9), step(10, 0.5)]);
    expect(trainsOf(w).counted).toContain('sweetspot');
    expect(applyFilters([w], { ...NO_FILTERS, trains: ['sweetspot'] }, 'ride').map((x) => x.id)).toEqual(['mine-1']);
    expect(applyFilters([w], { ...NO_FILTERS, trains: ['vo2'] }, 'ride')).toEqual([]);
  });
  it('steps that train nothing that counts count nothing', () => {
    const w = mine([step(20, 0.55)]);
    expect(trainsOf(w).counted).toEqual([]);
  });
});
