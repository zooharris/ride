import { describe, expect, it } from 'vitest';
import { learnWalkRates, ownWalkRate, setWalkRates, MIN_WALKS } from './walkRates';
import { sessionTssPerHour } from './sessions';
import { EASY_WALK, bandTssPerHour } from './foot';

describe('the walk load rule is learned from each rider (12 Nov 2026)', () => {
  it('a rider with no walks gets the starting rate', () => {
    setWalkRates({});
    expect(sessionTssPerHour('walk', { zoneLow: EASY_WALK.zoneLow, zoneHigh: EASY_WALK.zoneHigh })).toBeCloseTo(bandTssPerHour(EASY_WALK), 6);
  });
  it('with five walks with heart rate in a band, their own rate', () => {
    const four = Array.from({ length: MIN_WALKS - 1 }, () => ({ band: EASY_WALK, seconds: 3600, tss: 30 }));
    expect(ownWalkRate(EASY_WALK, learnWalkRates(four))).toBeUndefined();
    const five = [...four, { band: EASY_WALK, seconds: 1800, tss: 15 }];
    const rates = learnWalkRates(five);
    expect(ownWalkRate(EASY_WALK, rates)).toBe(30);
    setWalkRates(rates);
    expect(sessionTssPerHour('walk', { zoneLow: EASY_WALK.zoneLow, zoneHigh: EASY_WALK.zoneHigh })).toBe(30);
    expect(sessionTssPerHour('walk', { zoneLow: EASY_WALK.zoneLow, zoneHigh: EASY_WALK.zoneHigh, packKg: 10 })).toBe(35);
    setWalkRates({});
  });
});
