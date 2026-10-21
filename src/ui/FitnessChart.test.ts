import { describe, expect, it } from 'vitest';
import { hm } from './FitnessChart';

describe('sleep as hours and minutes', () => {
  it('never prints sixty minutes', () => {
    expect(hm(6.995)).toBe('7h00');
    expect(hm(7.2)).toBe('7h12');
    expect(hm(0.5)).toBe('0h30');
  });
});
