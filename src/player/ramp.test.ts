import { describe, expect, it } from 'vitest';
import type { Profile } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { buildTimeline, endRamp, ergWatts, rampExpectedSteps, rampView, RAMP_STEPS_MAX, totalSeconds } from './timeline';
import { RideEngine, type Live } from './engine';
import { rampGaveOut } from './tests';

const profile: Profile = { name: 'T', ftp: 225, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 77, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const ramp = LIBRARY.find((w) => w.id === 'lib-ramp')!;
const watts = (tl: ReturnType<typeof buildTimeline>, i: number, ftp = profile.ftp) => ergWatts(tl[i], ftp);

describe('the open-ended ramp (B1)', () => {
  it('is a five-minute warm-up, sixty one-minute steps climbing by the chosen step, and a ten-minute cool-down', () => {
    const tl = buildTimeline(ramp, profile, { rampStep: 20 });
    expect(tl).toHaveLength(RAMP_STEPS_MAX + 2);
    expect(tl[0].seconds).toBe(300);
    expect(watts(tl, 0)).toBe(Math.round(225 * 0.46));
    expect(watts(tl, 1)).toBe(124);
    expect(watts(tl, 2)).toBe(144);
    expect(watts(tl, 10)).toBe(124 + 9 * 20);
    expect(tl[1].ramp).toBe(1);
    expect(tl[60].ramp).toBe(60);
    expect(tl[61].name).toBe('Cool down');
    expect(tl[61].rampOpen).toBe(true);
    expect(watts(tl, 61)).toBe(Math.round(225 * 0.4));
  });
  it('climbs by 10 W when that is chosen', () => {
    const tl = buildTimeline(ramp, profile, { rampStep: 10 });
    expect(watts(tl, 2) - watts(tl, 1)).toBe(10);
  });
  it('with no FTP starts at 100 W against the 200 W reference', () => {
    const tl = buildTimeline(ramp, { ...profile, ftp: 0 }, { rampStep: 20 });
    expect(watts(tl, 0, 200)).toBe(60);
    expect(watts(tl, 1, 200)).toBe(100);
    expect(watts(tl, 3, 200)).toBe(140);
  });
  it('expects most riders to reach about 135% of FTP before the picture stops', () => {
    const n = rampExpectedSteps(225, 20);
    expect(124 + (n - 1) * 20).toBeGreaterThanOrEqual(225 * 1.35);
    expect(124 + (n - 2) * 20).toBeLessThan(225 * 1.35);
  });
});

describe('ending the ramp', () => {
  const tl = buildTimeline(ramp, profile, { rampStep: 20 });
  it('cuts the step being ridden where it ended, drops the rest, and starts the cool-down at once', () => {
    const at = 300 + 7 * 60 + 25; // 25 s into ramp step 8
    const out = endRamp(tl, at);
    expect(out).toHaveLength(10);
    expect(out[8].ramp).toBe(8);
    expect(out[8].end).toBe(at);
    expect(out[8].seconds).toBe(25);
    expect(out[9]).toMatchObject({ name: 'Cool down', index: 9, start: at, end: at + 600 });
    expect(out[9].rampOpen).toBeUndefined();
    out.forEach((s, i) => expect(s.index).toBe(i));
  });
  it('is rebuilt the same way from a recording (a ride recovered after the browser closed)', () => {
    const at = 300 + 7 * 60 + 25;
    expect(buildTimeline(ramp, profile, { rampStep: 20, rampEndAt: at })).toEqual(endRamp(tl, at));
  });
  it('the chart shows the warm-up, the steps ridden and the next three while the ramp is open; everything once it has ended', () => {
    const at = 300 + 4 * 60 + 10; // ramp step 5
    const v = rampView(tl, at);
    expect(v.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(totalSeconds(v)).toBe(300 + 8 * 60);
    expect(rampView(endRamp(tl, at), at)).toHaveLength(7);
    expect(rampView(tl, 10).map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('the automatic stop (B3)', () => {
  const ten = (w: number) => Array.from({ length: 10 }, () => w);
  it('fires when ten seconds average under 85% of the step', () => {
    expect(rampGaveOut(ten(250), 300, 12, 6)).toBe(true);
  });
  it('does not fire on a three-second dip', () => {
    expect(rampGaveOut([300, 300, 300, 300, 300, 300, 300, 150, 150, 150], 300, 30, 6)).toBe(false);
  });
  it('does not fire in the first ramp step, or in the first five seconds of a step', () => {
    expect(rampGaveOut(ten(0), 300, 30, 1)).toBe(false);
    expect(rampGaveOut(ten(0), 300, 4, 6)).toBe(false);
  });
  it('decides nothing when the power meter has dropped readings', () => {
    expect(rampGaveOut([0, 0, 0, 0, 0, 0, 0, undefined, undefined, undefined], 300, 30, 6)).toBe(false);
  });
});

describe('the ramp in the ride engine', () => {
  const make = () => {
    const tl = buildTimeline(ramp, profile, { rampStep: 20 });
    return { tl, e: new RideEngine({ timeline: tl, ftp: profile.ftp, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0) };
  };
  /** A rider who holds the target until `giveUpAt` (seconds into the workout), then can only manage 150 W. */
  const ride = (e: RideEngine, from: number, n: number, giveUpAt: number) => Array.from({ length: n }, (_, i) => {
    const target = e.ergTarget() ?? 0;
    const live: Live = { watts: e.position >= giveUpAt ? 150 : target, cadence: 90, speedKmh: 30 };
    return e.tick((from + i) * 1000, live);
  });

  it('ends by itself when the legs go, notes it, and rides on into the cool-down', () => {
    const { tl, e } = make();
    const giveUp = 300 + 9 * 60 + 20; // 20 s into ramp step 10 (304 W)
    ride(e, 1, 3, giveUp); // countdown
    const outs = ride(e, 4, giveUp + 30, giveUp);
    expect(outs.some((o) => o.note?.startsWith('Legs went'))).toBe(true);
    expect(e.rampEndAt).toBeGreaterThan(giveUp);
    expect(e.rampEndAt! - giveUp).toBeLessThanOrEqual(5);
    expect(e.events.find((x) => x.type === 'test')?.value).toBe('auto');
    expect(tl).toHaveLength(12); // the same array, changed in place: warm-up, 10 steps, cool-down
    expect(e.step?.name).toBe('Cool down');
    expect(e.ergTarget()).toBe(Math.round(225 * 0.4));
  });
  it('ends at once on the rider’s button, and only on the ramp', () => {
    const { e } = make();
    ride(e, 1, 3, 1e9);
    ride(e, 4, 100, 1e9); // still in the warm-up
    expect(e.endTest(104_000, 'rider')).toBe(false);
    ride(e, 104, 300, 1e9); // into the ramp
    expect(e.step?.ramp).toBeGreaterThan(0);
    expect(e.endTest(404_000, 'rider')).toBe(true);
    expect(e.endTest(405_000, 'rider')).toBe(false);
    ride(e, 404, 2, 1e9);
    expect(e.step?.name).toBe('Cool down');
    expect(e.events.find((x) => x.type === 'test')?.value).toBe('rider');
  });
});
