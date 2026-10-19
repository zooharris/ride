import { describe, expect, it } from 'vitest';
import { sportOf } from './intervals';

describe('activity types from Intervals.icu', () => {
  it('maps rides, walks, strength and mobility', () => {
    expect(sportOf('Ride')).toBe('ride');
    expect(sportOf('VirtualRide')).toBe('ride');
    expect(sportOf('Walk')).toBe('walk');
    expect(sportOf('Hike')).toBe('walk');
    expect(sportOf('WeightTraining')).toBe('strength');
    expect(sportOf('Yoga')).toBe('mobility');
  });
  it('treats a slow treadmill "run" as a walk, a real run as other', () => {
    expect(sportOf('Run', 1.5)).toBe('walk');          // 5.4 km/h
    expect(sportOf('VirtualRun', 1.7)).toBe('walk');
    expect(sportOf('Run', 3.0)).toBe('other');          // 10.8 km/h
    expect(sportOf('Run')).toBe('other');               // no speed known
  });
});
