import { describe, expect, it } from 'vitest';
import { sameSession } from './adapt';
import type { Workout } from './types';

const ride = (name: string, minutes: number, intensity = 0.65, family = 'endurance'): Workout => ({
  id: name, name, kind: 'ride', family, phases: ['any'], bases: ['power', 'hr'], setting: 'any', purpose: '', source: 'generated',
  blocks: [{ kind: 'step', seconds: minutes * 60, intensity }],
} as unknown as Workout);

describe('the re-check offers only changes that matter', () => {
  it('treats a ride a few minutes longer or shorter as the same session', () => {
    expect(sameSession(ride('Long Endurance 2:23', 143), ride('Long Endurance 2:20', 140))).toBe(true);
    expect(sameSession(ride('Endurance 47', 47), ride('Endurance 46', 46))).toBe(true);
    expect(sameSession(ride('Endurance 1:17', 77), ride('Endurance 1:11', 71))).toBe(true);
  });
  it('offers a real change in length, a different ride, or a different intensity', () => {
    expect(sameSession(ride('Long Endurance 2:23', 143), ride('Long Endurance 3', 180))).toBe(false);
    expect(sameSession(ride('Endurance 1:00', 60), ride('Endurance 1:15', 75))).toBe(false);
    expect(sameSession(ride('Endurance 1:00', 60), ride('Sweet Spot 1:00', 60, 0.9, 'sweetspot'))).toBe(false);
    expect(sameSession(ride('Endurance 1:30', 90, 0.6), ride('Endurance 1:30', 90, 0.6))).toBe(true);
  });
  it('always offers a different strength or mobility session', () => {
    const s = (name: string) => ({ ...ride(name, 40), kind: 'strength', blocks: [], minutes: 40 } as unknown as Workout);
    expect(sameSession(s('Strength A: legs and trunk'), s('Strength B: upper body and posterior chain'))).toBe(false);
  });
});
