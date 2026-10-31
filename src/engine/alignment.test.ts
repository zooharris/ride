import { describe, expect, it } from 'vitest';
import { analyseRide, stepAt, stepReadout, stepWindows } from './analysis';
import type { Profile, Workout } from './types';

const profile = { ftp: 250, lthr: 160, maxHr: 185 } as unknown as Profile;
// 10 min warm-up, 3 × (5 min at 120% / 3 min easy), 10 min cool-down: 11 steps, 54 minutes.
const w = {
  id: 'v', name: 'Test VO2', kind: 'ride', blocks: [
    { kind: 'step', seconds: 600, intensity: 0.55, label: 'Warm-up' },
    { kind: 'repeat', times: 3, label: 'Set', steps: [{ kind: 'step', seconds: 300, intensity: 1.2, label: 'Hard effort' }, { kind: 'step', seconds: 180, intensity: 0.5, label: 'Easy' }] },
    { kind: 'step', seconds: 600, intensity: 0.5, label: 'Cool-down' },
  ],
} as unknown as Workout;
const plan = [600, 300, 180, 300, 180, 300, 180, 600];
const lapsFrom = (secs: number[], from = 0) => { let t = from; return secs.map((s) => ({ start: t, end: (t += s) })); };

// A ride whose hard efforts start 4 minutes late (a longer warm-up), at exactly 300 W.
function ride(warm: number) {
  const time: number[] = [], watts: number[] = [];
  const secs = [warm, 300, 180, 300, 180, 300, 180, 600];
  const pw = [130, 300, 120, 300, 120, 300, 120, 120];
  let t = 0;
  secs.forEach((s, i) => { for (let k = 0; k < s; k++) { time.push(t++); watts.push(pw[i]); } });
  return { time, watts, laps: lapsFrom(secs) };
}

describe('lining the plan up with the ride (31 Oct)', () => {
  it('each step takes its lap when the laps match the steps one for one', () => {
    const r = ride(840);
    const a = analyseRide(w, profile, 'power', r.time, r.watts, undefined, r.laps);
    expect(a.aligned).toBe('laps');
    expect(a.steps[1]).toMatchObject({ startSec: 840, endSec: 1140, actual: 300, hit: true });
    expect(a.workHit).toBe(3);
  });
  it('without laps the plan is laid along the clock, and the late warm-up throws the efforts off', () => {
    const r = ride(840);
    const a = analyseRide(w, profile, 'power', r.time, r.watts);
    expect(a.aligned).toBe('clock');
    expect(a.steps[1].startSec).toBe(600);
    expect(a.workHit).toBeLessThan(3);
  });
  it('one more lap at the end, riding on after the workout, is left out', () => {
    expect(stepWindows(plan, lapsFrom([...plan, 20])).by).toBe('laps');
    expect(stepWindows(plan, lapsFrom([...plan, 1800])).by).toBe('laps');   // a long ride home: the rest still matches the plan's length
  });
  it('laps that do not match fall back to the clock', () => {
    expect(stepWindows(plan, lapsFrom([600, 1200, 1200])).by).toBe('clock');
    expect(stepWindows(plan, lapsFrom([60, 60, 60, 60, 60, 60, 60, 60, 60])).by).toBe('clock');
    // Overlapping intervals are efforts Intervals.icu found, not laps.
    const over = lapsFrom(plan); over[3] = { start: over[2].start + 10, end: over[3].end };
    expect(stepWindows(plan, over).by).toBe('clock');
  });
  it("the player's laps carry their step and are used directly, a skipped step taking no time", () => {
    const laps = lapsFrom([700, 300, 180, 300, 180, 300, 600]).map((l, i) => ({ ...l, step: i < 5 ? i : i + 1 }));   // step 5 skipped
    const r = stepWindows(plan, laps);
    expect(r.by).toBe('laps');
    expect(r.windows[0]).toEqual({ start: 0, end: 700 });
    expect(r.windows[5].end - r.windows[5].start).toBe(0);
  });
});

describe('the readout for a step under the cursor', () => {
  const r = ride(600);
  const a = analyseRide(w, profile, 'power', r.time, r.watts, undefined, r.laps);
  it('names the round of a repeat and judges what was ridden', () => {
    const s = stepAt(a, 600 + 480 + 100)!;
    expect(stepReadout(s, 'W')).toBe('Hard effort 2 of 3 · target 300 W · you rode 300 W, in target');
  });
  it('says under or over, and gives a step outside a repeat no count', () => {
    const easy = { ...a.steps[0], actual: 100, hit: false };
    expect(stepReadout(easy, 'W')).toMatch(/^Warm-up · target 138 W · you rode 100 W, under$/);
    expect(stepReadout({ ...a.steps[1], actual: 400, hit: false }, 'W')).toMatch(/you rode 400 W, over$/);
    expect(stepReadout({ ...a.steps[1], actual: 160, hit: true }, 'bpm')).toMatch(/you averaged 160 bpm, in target$/);
  });
  it('outside every step there is nothing to say', () => {
    expect(stepAt(a, 99999)).toBeUndefined();
    expect(stepAt(undefined, 10)).toBeUndefined();
  });
});
