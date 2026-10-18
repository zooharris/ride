import { describe, expect, it } from 'vitest';
import { assess, type Assessment } from './assessment';
import { generatePlan, phaseSequence, planWeeks, type PlanRequest } from './planner';
import { demand } from './goals';
import { generateSession } from './generate';
import { workoutStats } from './workout';
import { addDays } from './load';
import type { Profile, Ride, Wellness } from './types';

const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 90, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const today = '2026-10-19';

function ride(date: string, hours: number, IF: number, extra: Partial<Ride> = {}): Ride {
  const seconds = hours * 3600;
  return { id: date + hours, date, startTime: date, name: 'r', type: 'Ride', sport: 'ride', seconds, tss: Math.round(seconds * IF * IF / 36), normalizedPower: IF * 250, averageHr: 130 + IF * 40, intensityFactor: IF, ...extra };
}

/** Twelve weeks of a steady rider: two rides a weekend, one midweek, long rides with low drift. */
function history(): { rides: Ride[]; wellness: Wellness[] } {
  const rides: Ride[] = [];
  const wellness: Wellness[] = [];
  for (let i = 84; i >= 1; i--) {
    const d = addDays(today, -i);
    const dw = new Date(d + 'T00:00:00').getDay();
    if (dw === 6) rides.push(ride(d, 1.75, 0.82, { efficiencyFactor: 1.5 + (84 - i) / 400 }));
    if (dw === 0) rides.push(ride(d, 2.75, 0.68, { decoupling: 4, efficiencyFactor: 1.5 + (84 - i) / 400 }));
    if (dw === 3) rides.push(ride(d, 1.25, 0.72, { efficiencyFactor: 1.5 + (84 - i) / 400 }));
    wellness.push({ date: d, hrv: 50, restingHr: 50, sleepSeconds: 7 * 3600 });
  }
  return { rides, wellness };
}

const h = history();
// strength sessions on record every Tuesday and Thursday, recorded by whatever the rider had
const strengthActs: Ride[] = h.wellness.filter((w) => [2, 4].includes(new Date(w.date + 'T00:00:00').getDay())).map((w) => ({ id: 's' + w.date, date: w.date, startTime: w.date, name: 'Strength', type: 'WeightTraining', sport: 'strength', seconds: 2400, tss: 25 }));
const baseAssessment = assess({ today, profile, rides: [...h.rides, ...strengthActs], wellness: h.wellness, planned: [] });

const req = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  start: today,
  goal: { kind: 'event', date: '2027-02-06', name: 'Spring century', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' },
  availability: { hours: [4, 0.5, 1.5, 0.5, 1.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['dumbbells', 'bench', 'bodyweight', 'treadmill'], pins: [] },
  basis: 'power', masters: true, profile, assessment: baseAssessment, ...over,
});

describe('assessment', () => {
  it('reads fitness, hours, longest ride and decoupling from history', () => {
    const a = baseAssessment;
    expect(a.fitness.ctl).toBeGreaterThan(30);
    expect(a.weeklyHours.value).toBeCloseTo(5.75, 1);
    expect(a.weeklyHours.confidence).toBe('good');
    expect(a.longestRide.value).toBe(2.75 * 3600);
    expect(a.decoupling.value).toBe(4);
    expect(a.decoupling.confidence).toBe('good');
    expect(a.efficiencyTrend.value).toBeGreaterThan(0);
    expect(a.summary.length).toBeGreaterThan(5);
  });
  it('sees no cost after strength days when the mornings look normal', () => {
    expect(baseAssessment.afterStrength.value).toBe(0);
    expect(baseAssessment.afterStrength.confidence).toBe('good');
  });
  it('sees a cost after strength days when HRV drops', () => {
    const w = h.wellness.map((x) => ({ ...x, hrv: [3, 5].includes(new Date(x.date + 'T00:00:00').getDay()) ? 38 : 50 }));
    const a = assess({ today, profile, rides: [...h.rides, ...strengthActs], wellness: w, planned: [] });
    expect(a.afterStrength.value).toBeGreaterThan(0.5);
  });
  it('is honest with no data', () => {
    const a = assess({ today, profile, rides: [], wellness: [], planned: [] });
    expect(a.weeklyHours.confidence).toBe('none');
    expect(a.longestRide.confidence).toBe('none');
    expect(a.limiters).toContain('base');
  });
  it('flags a VO2max limiter from the power curve', () => {
    const a = assess({ today, profile, rides: h.rides, wellness: h.wellness, planned: [], powerCurve: [{ seconds: 5, watts: 800 }, { seconds: 60, watts: 380 }, { seconds: 300, watts: 265 }, { seconds: 1200, watts: 258 }] });
    expect(a.limiters[0]).toBe('vo2max');
  });
});

describe('goal demand', () => {
  it('models a century from distance, climbing and the rider pace', () => {
    const d = demand({ kind: 'event', date: '2027-02-06', name: 'x', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' }, profile, baseAssessment, 27);
    expect(d.eventHours).toBeGreaterThan(5.5);
    expect(d.eventHours).toBeLessThan(8);
    expect(d.eventTss).toBeGreaterThan(250);
    expect(d.requiredCtl).toBeGreaterThan(55);
    expect(d.requiredLongest).toBeGreaterThan(4 * 3600);
    expect(d.why).toMatch(/hard day/);
  });
  it('asks for more fitness for a bigger FTP jump', () => {
    const small = demand({ kind: 'ftp', weeks: 12, targetWatts: 260 }, profile, baseAssessment);
    const big = demand({ kind: 'ftp', weeks: 12, targetWatts: 290 }, profile, baseAssessment);
    expect(big.requiredCtl).toBeGreaterThan(small.requiredCtl);
  });
});

describe('session generation', () => {
  it('fits the slot and progresses', () => {
    const early = generateSession({ type: 'sweetspot', minutes: 75, progression: 0, outdoor: false, reason: '' });
    const late = generateSession({ type: 'sweetspot', minutes: 105, progression: 1, outdoor: true, reason: '' });
    expect(Math.abs(workoutStats(early.blocks).seconds - 75 * 60)).toBeLessThan(6 * 60);
    expect(Math.abs(workoutStats(late.blocks).seconds - 105 * 60)).toBeLessThan(6 * 60);
    expect(early.name).toMatch(/Sweet Spot \d × 10/);
    expect(late.name).toMatch(/Sweet Spot \d × 20/);
    expect(late.setting).toBe('outdoor');
  });
  it('builds a long ride of exactly the minutes asked', () => {
    const w = generateSession({ type: 'long', minutes: 190, progression: 0.5, outdoor: true, reason: '' });
    expect(workoutStats(w.blocks).seconds).toBe(190 * 60);
    expect(w.name).toBe('Long Endurance 3:10');
  });
});

describe('planner', () => {
  it('schedules two long rides when two big slots exist and long days do not cost the rider', () => {
    const plan = generatePlan(req());
    const base1 = plan.weeks[0];
    const longs = base1.sessions.filter((s) => s.type === 'long');
    expect(longs).toHaveLength(2);
    // this rider bounces back from long days (penalty 0), so both long rides are sized by the budget, not a multiplier
    expect(baseAssessment.afterLongRide.value).toBe(0);
    const shorter: Assessment = { ...baseAssessment, afterLongRide: { value: 0.3, confidence: 'good', note: 'x' } };
    const p2 = generatePlan(req({ assessment: shorter }));
    const l2 = p2.weeks[1].sessions.filter((s) => s.type === 'long').map((s) => s.seconds).sort((x, y) => y - x);
    expect(l2[1]).toBeLessThan(l2[0]);
    expect(longs.map((s) => new Date(s.date + 'T00:00:00').getDay()).sort()).toEqual([0, 6]);
    expect(plan.decisions.some((d) => d.startsWith('Two long rides'))).toBe(true);
  });
  it('drops to one long ride when the data say long days cost a lot', () => {
    const a: Assessment = { ...baseAssessment, afterLongRide: { value: 0.7, confidence: 'good', note: 'x' } };
    const plan = generatePlan(req({ assessment: a }));
    expect(plan.weeks[0].sessions.filter((s) => s.type === 'long')).toHaveLength(1);
  });
  it('uses only available days and keeps within the slot hours', () => {
    const plan = generatePlan(req());
    for (const w of plan.weeks) for (const s of w.sessions) {
      const dw = new Date(s.date + 'T00:00:00').getDay();
      expect([0, 1, 2, 3, 4, 6]).toContain(dw);
      if (s.kind === 'ride') expect([0, 2, 4, 6]).toContain(dw);
      if (s.kind === 'ride') expect(s.seconds).toBeLessThanOrEqual(req().availability.hours[dw] * 3600 + 60);
    }
  });
  it('puts hard rides after strength only when the data say it is free', () => {
    const costly: Assessment = { ...baseAssessment, afterStrength: { value: 0.8, confidence: 'good', note: 'x' } };
    const plan = generatePlan(req({ assessment: costly, availability: { hours: [4, 0.5, 1.5, 1.5, 1.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [], equipment: ['dumbbells', 'bench'], pins: [{ dow: 1, kind: 'strength' }] } }));
    const build = plan.weeks.find((w) => w.phase === 'build')!;
    const hard = build.sessions.filter((s) => ['threshold', 'sweetspot', 'vo2max', 'test'].includes(s.type));
    for (const s of hard) expect(new Date(s.date + 'T00:00:00').getDay()).not.toBe(2);   // Tuesday follows the pinned Monday lift
    expect(build.sessions.some((s) => s.kind === 'strength' && new Date(s.date + 'T00:00:00').getDay() === 1)).toBe(true);  // the pin is honoured
  });
  it('builds phases from the goal and limiters, tests only when the FTP looks unverified, and tapers', () => {
    const plan = generatePlan(req());
    // the history has no hard efforts (IF under 0.9), so the FTP in use is unverified: one test in week 1, none after
    expect(baseAssessment.ftpStatus.value).toBe('stale');
    expect(plan.weeks[0].sessions.some((s) => s.type === 'test')).toBe(true);
    expect(plan.weeks.slice(1).every((w) => !w.sessions.some((s) => s.type === 'test'))).toBe(true);
    const fresh: Assessment = { ...baseAssessment, ftpStatus: { value: 'fresh', confidence: 'good', note: 'x' } };
    expect(generatePlan(req({ assessment: fresh })).weeks[0].sessions.some((s) => s.type === 'test')).toBe(false);
    expect(plan.weeks[plan.weeks.length - 1].phase).toBe('taper');
    expect(plan.weeks.some((w) => w.phase === 'recovery')).toBe(true);
    const rec = plan.weeks.find((w) => w.phase === 'recovery')!;
    expect(rec.tss).toBeLessThan(plan.weeks[rec.index - 2].tss);
  });
  it('grows the long ride toward what the event needs', () => {
    const plan = generatePlan(req());
    const longs = plan.weeks.filter((w) => w.phase !== 'recovery' && w.phase !== 'taper').map((w) => Math.max(...w.sessions.filter((s) => s.type === 'long').map((s) => s.seconds)));
    expect(longs[longs.length - 1]).toBeGreaterThan(longs[0]);
    expect(plan.longestPlanned).toBeGreaterThanOrEqual(3.5 * 3600);
  });
  it('gives an honest verdict and a plain-words plan', () => {
    const plan = generatePlan(req());
    expect(['on-track', 'close', 'short']).toContain(plan.verdict);
    expect(plan.advice).toMatch(/fitness should reach/);
    expect(plan.decisions.length).toBeGreaterThanOrEqual(3);
    const thin = generatePlan(req({ availability: { hours: [1.5, 0, 1, 0, 1, 0, 1.5], outdoor: [], noBike: [], equipment: [], pins: [] } }));
    expect(thin.verdict).toBe('short');
    expect(thin.advice).toMatch(/available hours are the ceiling/);
  });
  it('handles other goal kinds', () => {
    const ftp = generatePlan(req({ goal: { kind: 'ftp', weeks: 10, targetWatts: 270 } }));
    expect(ftp.weeks).toHaveLength(10);
    expect(ftp.weeks.some((w) => w.sessions.some((s) => s.type === 'threshold'))).toBe(true);
    const weight = generatePlan(req({ goal: { kind: 'weight', weeks: 8 } }));
    expect(weight.verdict).toBe('no-target');
    expect(weight.weeks.every((w) => w.sessions.filter((s) => s.type === 'vo2max').length === 0)).toBe(true);
    // the goal leans sub-threshold, but this rider's data flag threshold as the limiter, so threshold work still appears
    expect(weight.weeks.some((w) => w.sessions.some((s) => s.type === 'threshold'))).toBe(true);
    const noLimiter: Assessment = { ...baseAssessment, limiters: ['base'] };
    const weight2 = generatePlan(req({ goal: { kind: 'weight', weeks: 8 }, assessment: noLimiter }));
    expect(weight2.weeks.every((w) => !w.sessions.some((s) => s.type === 'threshold'))).toBe(true);
    const vo2 = generatePlan(req({ goal: { kind: 'vo2max', weeks: 8 } }));
    expect(vo2.weeks.some((w) => w.sessions.some((s) => s.type === 'vo2max'))).toBe(true);
  });
  it('allocates strength, walks and mobility without being asked', () => {
    const plan = generatePlan(req());
    const base1 = plan.weeks[0];
    const strength = base1.sessions.filter((s) => s.kind === 'strength');
    expect(strength).toHaveLength(2);
    for (const s of strength) {
      expect(s.workout.exercises!.length).toBeGreaterThanOrEqual(4);
      expect(s.workout.exercises![0].cue.length).toBeGreaterThan(20);
      expect(s.workout.exercises!.every((e) => e.equipment.some((q) => ['dumbbells', 'bench', 'bodyweight'].includes(q)))).toBe(true);
      // never on the same day as a hard ride
      const dw = new Date(s.date + 'T00:00:00').getDay();
      expect(base1.sessions.some((x) => x.date === s.date && ['sweetspot', 'threshold', 'vo2max', 'test'].includes(x.type))).toBe(false);
      expect(dw).not.toBe(5);
    }
    // the 30-minute Monday and Wednesday windows are too short for a ride, so they become walks or strength
    const short = base1.sessions.filter((s) => [1, 3].includes(new Date(s.date + 'T00:00:00').getDay()));
    expect(short.length).toBeGreaterThanOrEqual(1);
    expect(short.every((s) => s.kind !== 'ride')).toBe(true);
    const walks = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === 'walk');
    expect(walks.length).toBeGreaterThanOrEqual(1);
    expect(walks[0].workout.walk?.minutes).toBeLessThanOrEqual(30);
    // mobility follows the long ride
    const mob = base1.sessions.filter((s) => s.kind === 'mobility');
    expect(mob.length).toBeGreaterThanOrEqual(1);
    expect(mob.some((m) => base1.sessions.some((x) => x.date === m.date && x.type === 'long'))).toBe(true);
    expect(plan.decisions.some((d) => d.startsWith('Strength'))).toBe(true);
  });
  it('goes bodyweight-only with no equipment and skips walks without a way to walk', () => {
    const plan = generatePlan(req({ availability: { hours: [3, 0.5, 1, 0.5, 1, 0, 3], outdoor: [], noBike: [], equipment: [], pins: [] } }));
    const strength = plan.weeks[0].sessions.filter((s) => s.kind === 'strength');
    expect(strength.length).toBeGreaterThan(0);
    expect(strength[0].workout.exercises!.every((e) => e.equipment.includes('bodyweight'))).toBe(true);
    expect(plan.weeks[0].sessions.some((s) => s.kind === 'walk')).toBe(false);
  });
  it('uses a no-bike day for a walk', () => {
    const plan = generatePlan(req({ availability: { hours: [3, 1, 1, 0, 1, 0, 3], outdoor: [], noBike: [false, false, true, false, false, false, false], equipment: ['outdoor-walk', 'bodyweight'], pins: [] } }));
    const tue = plan.weeks.flatMap((w) => w.sessions).filter((s) => new Date(s.date + 'T00:00:00').getDay() === 2);
    expect(tue.length).toBeGreaterThan(0);
    expect(tue.some((s) => s.kind === 'ride')).toBe(false);
    expect(tue.some((s) => s.kind === 'walk' || s.kind === 'strength')).toBe(true);
  });
  it('counts weeks', () => {
    expect(planWeeks({ kind: 'event', date: '2027-02-06', name: '', eventType: 'century', priority: 'A' }, today)).toBe(15);
    const { seq } = phaseSequence(15, demand(req().goal, profile, baseAssessment), baseAssessment, req().goal, true);
    expect(seq).toHaveLength(15);
  });
});
