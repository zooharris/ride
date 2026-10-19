import { describe, expect, it } from 'vitest';
import { sessionSteps, sportOf } from './intervals';
import { readyMadeSessions } from '../library/sessions';

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

describe('strength and mobility as Garmin steps', () => {
  const all = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'treadmill']);
  it('sets end on a lap press, rests and holds are timed, ranges are spelled out', () => {
    const w = all.find((x) => x.kind === 'strength' && /Foundation A/.test(x.name))!;
    const lines = sessionSteps(w);
    expect(lines.some((l) => /^- Press lap Goblet squat × 10 to 12 50s$/.test(l))).toBe(true);
    expect(lines).toContain('- Rest 1m30s');
    expect(lines).toContain('3x');
    expect(lines.some((l) => /\d+[-–]\d+/.test(l))).toBe(false);
    expect(lines.some((l) => /^- (Plank|Dead bug) \d+s$/.test(l))).toBe(true);
    // Repeat blocks are separated by a blank line.
    const idx = lines.indexOf('3x');
    expect(lines[idx - 1] ?? '').toBe('');
  });
  it('stretches are timed per side with no rests and no lap presses', () => {
    const w = all.find((x) => x.kind === 'mobility' && /after the long ride/.test(x.name))!;
    const lines = sessionSteps(w);
    expect(lines.every((l) => !/Press lap|Rest/.test(l))).toBe(true);
    expect(lines.some((l) => /, left \d+s$|, left \dm$/.test(l))).toBe(true);
  });
});
