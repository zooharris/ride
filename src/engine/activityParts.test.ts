import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyseRide } from './analysis';
import { climb, lapMarks, MIN_PART, namesThatFit, partNumbers, partZoneTime, playerAligned, readyQuestions, smoothedAt, targetBands, zoneBands } from './activityParts';
import { POWER_ZONES } from './zones';
import type { Profile, Workout } from './types';
import { db } from '../data/db';
import { askPart, lastPartAnswer, partCoachKey } from '../ui/partCoach';

const profile: Profile = { name: 'Sam Example', ftp: 250, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };
// Warm-up 10 min, 3 × (5 min hard, 3 min easy), an all-out sprint, cool-down 5 min.
const workout: Workout = {
  id: 'w', name: 'Threes', kind: 'ride', family: 'vo2max', purpose: '', phases: ['any'], bases: ['power'], setting: 'any', source: 'library',
  blocks: [
    { kind: 'step', seconds: 600, intensity: 0.6, label: 'Warm up' },
    { kind: 'repeat', times: 3, steps: [{ kind: 'step', seconds: 300, intensity: 1.1, label: 'Hard effort' }, { kind: 'step', seconds: 180, intensity: 0.5, label: 'Easy between' }] },
    { kind: 'step', seconds: 15, intensity: 1.5, allOut: true, label: 'Sprint' },
    { kind: 'step', seconds: 300, intensity: 0.5, label: 'Cool down' },
  ],
} as unknown as Workout;
const STEP_SECS = [600, 300, 180, 300, 180, 300, 180, 15, 300];
const FREE = [false, false, false, false, false, false, false, true, false];
const total = STEP_SECS.reduce((a, b) => a + b, 0);
const time = Array.from({ length: total }, (_, i) => i);
const watts = time.map((t) => { let s = 0, k = 0; for (; k < STEP_SECS.length; k++) { if (t < s + STEP_SECS[k]) break; s += STEP_SECS[k]; } return [150, 275, 125, 275, 125, 275, 125, 600, 125][k] ?? 120; });
const hr = time.map((t) => 120 + Math.min(40, t / 60));
const lapsFromSteps = () => { let s = 0; return STEP_SECS.map((x) => ({ start: s, end: (s += x) })); };

describe('laps and steps (C1)', () => {
  it('named after the planned steps when the laps line up', () => {
    const a = analyseRide(workout, profile, 'power', time, watts, hr, lapsFromSteps());
    expect(a.aligned).toBe('laps');
    const marks = lapMarks({ laps: lapsFromSteps(), analysis: a });
    expect(marks.map((m) => m.name).slice(0, 4)).toEqual(['Warm up', 'Hard effort 1 of 3', 'Easy between 1 of 3', 'Hard effort 2 of 3']);
  });
  it('numbered when they do not line up', () => {
    const odd = [{ start: 0, end: 900 }, { start: 900, end: 2000 }, { start: 2000, end: total }];
    const a = analyseRide(workout, profile, 'power', time, watts, hr, odd);
    expect(a.aligned).toBe('clock');
    expect(lapMarks({ laps: odd, analysis: a }).map((m) => m.name)).toEqual(['1', '2', '3']);
  });
  it('overlapping efforts found by the data service never cross the laps', () => {
    expect(lapMarks({ laps: [{ start: 0, end: 600 }, { start: 300, end: 500 }, { start: 600, end: 1200 }] }).map((m) => [m.start, m.end])).toEqual([[0, 600], [600, 1200]]);
  });
  it('a strength session takes its Laps table names', () => {
    expect(lapMarks({ laps: [{ start: 0, end: 60 }, { start: 60, end: 120 }], names: ['Squat', 'Rest'] }).map((m) => m.name)).toEqual(['Squat', 'Rest']);
  });
  it('a name is shown only where it fits; the rest are dropped, never overlapped', () => {
    expect(namesThatFit([{ x0: 0, x1: 140, name: 'Hard effort 1 of 3' }, { x0: 140, x1: 160, name: 'Easy between 1 of 3' }])).toEqual([true, false]);
  });
});

describe('the planned target (C2)', () => {
  it('drawn from the step windows when the laps line up; no band for the all-out sprint', () => {
    const a = analyseRide(workout, profile, 'power', time, watts, hr, lapsFromSteps());
    const t = targetBands({ measure: 'watts', analysis: a, free: FREE });
    expect(t && 'bands' in t).toBe(true);
    const bands = (t as { bands: Array<{ start: number; low: number }> }).bands;
    expect(bands).toHaveLength(8);
    expect(bands.find((b) => b.start === 600)!.low).toBe(275);
    expect(bands.some((b) => b.start === 2040)).toBe(false);   // the sprint
  });
  it('uses the FTP on record for the day of the ride', () => {
    const a = analyseRide(workout, { ...profile, ftp: 200 }, 'power', time, watts, hr, lapsFromSteps());
    const t = targetBands({ measure: 'watts', analysis: a, free: FREE }) as { bands: Array<{ start: number; low: number }> };
    expect(t.bands.find((b) => b.start === 600)!.low).toBe(220);
  });
  it('greyed, with one plain reason, when a device recording\'s laps do not line up', () => {
    const a = analyseRide(workout, profile, 'power', time, watts, hr, [{ start: 0, end: total }]);
    const t = targetBands({ measure: 'watts', analysis: a, free: FREE });
    expect(t && 'unavailable' in t && t.unavailable).toMatch(/don’t line up/);
  });
  it('a ride from the app\'s player knows when each step began', () => {
    const player = lapsFromSteps().map((l, i) => ({ ...l, step: i }));
    const a = analyseRide(workout, profile, 'power', time, watts, hr, player);
    expect(targetBands({ measure: 'watts', analysis: a, free: FREE })).toHaveProperty('bands');
  });
  it('a player ride ended early still places the steps it rode, and only those', () => {
    const player = lapsFromSteps().slice(0, 3).map((l, i) => ({ ...l, step: i }));
    const a = analyseRide(workout, profile, 'power', time.slice(0, 1080), watts.slice(0, 1080), hr.slice(0, 1080), player);
    expect(a.aligned).toBe('clock');                      // too little ridden for the Intervals against plan table
    const t = targetBands({ measure: 'watts', analysis: playerAligned(a, player), free: FREE }) as { bands: Array<{ start: number }> };
    expect(t.bands.map((b) => b.start)).toEqual([0, 600, 900]);
  });
  it('nothing to draw for a workout with only free steps', () => {
    const a = analyseRide(workout, profile, 'power', time, watts, hr, lapsFromSteps());
    expect(targetBands({ measure: 'watts', analysis: a, free: FREE.map(() => true) })).toBeUndefined();
  });
  it('breathing targets come from the breathing bands given', () => {
    const a = analyseRide(workout, profile, 'power', time, watts, hr, lapsFromSteps());
    const t = targetBands({ measure: 've', analysis: a, free: FREE, breath: STEP_SECS.map(() => ({ low: 40, high: 60, zone: 2 })) }) as { measure: string; bands: Array<{ low: number }> };
    expect(t.measure).toBe('ve');
    expect(t.bands[0].low).toBe(40);
  });
});

describe('zones for the part (C3)', () => {
  it('time in each zone counts the seconds of the part only', () => {
    const bands = zoneBands(POWER_ZONES, 250);
    const z = partZoneTime(time, watts, 600, 899, bands);
    // 600..899 is the first hard effort at 275 W: 110% of 250, zone 5.
    expect(Math.round(z[4])).toBe(300);
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(300, 0);
  });
  it('a gap counts for nothing, and a pause is not counted', () => {
    const t = [0, 1, 2, 3, 100, 101];
    const v = [100, undefined, 100, 100, 100, 100];
    const z = partZoneTime(t, v, 0, 5, zoneBands(POWER_ZONES, 250));
    expect(z.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('smoothing for power (C4)', () => {
  it('30 seconds of power at a sample is the trailing average ending there', () => {
    const sm = smoothedAt([629], time, watts, 30);
    // The last 30 s before 629 s are the first 30 s of the hard effort.
    expect(Math.round(sm[0]!)).toBe(275);
    expect(smoothedAt([10], time, watts, 0)).toEqual([undefined]);
  });
});

describe('more numbers for the part (C5)', () => {
  const s = { time, watts, heartrate: hr, distance: time.map((t) => t * 8), altitude: time.map((t) => 100 + Math.max(0, Math.sin(t / 200) * 20)) };
  it('each number only when the part is long enough', () => {
    const short = partNumbers(s, 600, 600 + MIN_PART.wpb - 1);
    expect(short.np).toBeUndefined();
    expect(short.driftPct).toBeUndefined();
    expect(short.wattsPerBeat).toBeUndefined();
    expect(short.workKj).toBeGreaterThan(0);
    const long = partNumbers(s, 0, MIN_PART.np + 10);
    expect(long.np).toBeGreaterThan(long.workKj! * 1000 / (MIN_PART.np + 10) - 1);
    expect(long.wattsPerBeat).toBeGreaterThan(0);
    expect(long.driftPct).toBeDefined();
    expect(long.distanceM).toBeCloseTo((MIN_PART.np + 10) * 8, -1);
    expect(partNumbers(s, 0, MIN_PART.climb - 1).climbM).toBeUndefined();
  });
  it('heart-rate drift never on a test', () => {
    expect(partNumbers(s, 0, 2200, { test: true }).driftPct).toBeUndefined();
  });
  it('nothing a recording cannot give is shown', () => {
    expect(partNumbers({ time, heartrate: hr }, 0, 2000)).toEqual({});
  });
  it('climb counts real rises, not the altitude\'s noise', () => {
    expect(climb([100, 100.4, 100.1, 100.5, 100.2])).toBe(0);
    expect(climb([100, 105, 102, 110])).toBe(13);
  });
});

describe('the coach on the part selected (C6)', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  it('sends no request when the chart opens; one per question; the last answer is kept with the activity', async () => {
    const fetchSpy = vi.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    expect(await lastPartAnswer('a1')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    const send = vi.fn(async () => 'You held it well.');
    const facts = { profile, activity: 'Saturday Nov 21: Threes (ride)', part: 'the whole activity', lines: ['Power: low 0 W'], over: 'nothing' };
    const a = await askPart('a1', { provider: 'anthropic', key: 'k' }, facts, 'How did I do?', send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.a).toBe('You held it well.');
    expect((await lastPartAnswer('a1'))?.q).toBe('How did I do?');
    expect(partCoachKey('a1')).toBe('activityCoach:a1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('ready questions fit what is on the chart', () => {
    expect(readyQuestions({ view: 'Power', over: ['Heart rate'], lap: 'Hard effort 2 of 3', target: true, whole: false })).toEqual(['Did I hold the target in Hard effort 2 of 3?', 'What do power and heart rate say together in Hard effort 2 of 3?', 'What stands out in my power in Hard effort 2 of 3?']);
    expect(readyQuestions({ view: 'Power', over: [], target: false, whole: true })).toHaveLength(2);
  });
});
