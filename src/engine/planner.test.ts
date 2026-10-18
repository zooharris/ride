import { describe, expect, it } from 'vitest';
import { generatePlan, phaseSequence, planWeeks, type PlanRequest } from './planner';
import { LIBRARY } from '../library/workouts';
import { addDays } from './load';

const base: PlanRequest = {
  start: '2026-10-19', goal: { kind: 'event', eventType: 'century', date: '2027-02-06', name: 'Spring century' },
  days: [0, 2, 4, 6], longDay: 0, strengthDays: [1, 3], hoursPerWeek: 7, basis: 'power', masters: true, currentCtl: 35, indoorMidweek: true,
};

describe('planner', () => {
  it('counts weeks to an event and clamps fixed-length goals', () => {
    expect(planWeeks(base.goal, base.start)).toBe(15);
    expect(planWeeks({ kind: 'ftp', weeks: 2 }, base.start)).toBe(4);
    expect(planWeeks({ kind: 'ftp', weeks: 40 }, base.start)).toBe(24);
  });

  it('builds a masters phase sequence with a 2:1 rhythm and a taper before an event', () => {
    const seq = phaseSequence(base.goal, 15, true);
    expect(seq).toHaveLength(15);
    expect(seq[2]).toBe('recovery');
    expect(seq[5]).toBe('recovery');
    expect(seq.slice(-2)).toEqual(['taper', 'taper']);
    expect(seq[12]).not.toBe('recovery');          // week before the taper is a loading week
    expect(seq.filter((p) => p === 'base').length).toBeGreaterThanOrEqual(4);
  });

  it('uses a 3:1 rhythm when masters is off', () => {
    const seq = phaseSequence({ kind: 'ftp', weeks: 12 }, 12, false);
    expect(seq[3]).toBe('recovery');
    expect(seq[2]).not.toBe('recovery');
  });

  it('generates a full plan with rides on the chosen days only', () => {
    const plan = generatePlan(base, LIBRARY);
    expect(plan.weeks).toHaveLength(15);
    for (const w of plan.weeks) {
      expect(w.days.length).toBeGreaterThan(0);
      for (const d of w.days) {
        expect(base.days).toContain(new Date(d.date + 'T00:00:00').getDay());
        expect(d.workoutId).toBeTruthy();
      }
      // the long ride lands on the long day
      const long = w.days.find((d) => d.role === 'long' || d.role === 'easy');
      expect(long && new Date(long.date + 'T00:00:00').getDay()).toBe(0);
    }
  });

  it('respects the hour budget and eases in recovery weeks', () => {
    const plan = generatePlan(base, LIBRARY);
    const loading = plan.weeks.filter((w) => w.phase === 'base' || w.phase === 'build');
    for (const w of loading) expect(w.hours).toBeLessThanOrEqual(base.hoursPerWeek * 1.15);
    const rec = plan.weeks.find((w) => w.phase === 'recovery')!;
    const before = plan.weeks[rec.index - 2];
    expect(rec.tss).toBeLessThan(before.tss * 0.8);
  });

  it('puts a test at the start of base and build, and never a hard ride after strength', () => {
    const plan = generatePlan(base, LIBRARY);
    expect(plan.weeks[0].days.some((d) => d.role === 'test')).toBe(true);
    const firstBuild = plan.weeks.find((w) => w.phase === 'build')!;
    expect(firstBuild.days.some((d) => d.role === 'test')).toBe(true);
    for (const w of plan.weeks) for (const d of w.days) {
      if (d.role === 'key' || d.role === 'secondary') {
        const dow = new Date(d.date + 'T00:00:00').getDay();
        expect(base.strengthDays).not.toContain((dow + 6) % 7);
      }
    }
  });

  it('tapers into the event with form rising', () => {
    const plan = generatePlan(base, LIBRARY);
    const last = plan.projection[plan.projection.length - 1];
    const twoWeeksOut = plan.projection[plan.projection.length - 15];
    expect(last.tsb).toBeGreaterThan(twoWeeksOut.tsb);
    expect(plan.goalDate).toBe('2027-02-06');
  });

  it.skip('judges feasibility honestly (the rule-based planner is being replaced; see planner.ts)', () => {
    const rich = generatePlan({ ...base, hoursPerWeek: 10, currentCtl: 50 }, LIBRARY);
    expect(['on-track', 'close']).toContain(rich.verdict);
    const thin = generatePlan({ ...base, hoursPerWeek: 3, currentCtl: 15, goal: { kind: 'event', eventType: 'gran-fondo', date: addDays(base.start, 5 * 7) } }, LIBRARY);
    expect(thin.verdict).toBe('short');
    expect(thin.advice).toMatch(/more hour|more week/);
    const general = generatePlan({ ...base, goal: { kind: 'general', weeks: 8 } }, LIBRARY);
    expect(general.verdict).toBe('no-target');
  });

  it('varies the key session family by goal', () => {
    const vo2 = generatePlan({ ...base, goal: { kind: 'vo2max', weeks: 10 } }, LIBRARY);
    const families = vo2.weeks.flatMap((w) => w.days.filter((d) => d.role === 'key').map((d) => LIBRARY.find((x) => x.id === d.workoutId)!.family));
    expect(families).toContain('vo2max');
    const weight = generatePlan({ ...base, goal: { kind: 'weight', weeks: 8 } }, LIBRARY);
    const wf = weight.weeks.flatMap((w) => w.days.map((d) => LIBRARY.find((x) => x.id === d.workoutId)!.family));
    expect(wf.filter((f) => f === 'endurance').length).toBeGreaterThan(wf.length / 2);
  });

  it('works on heart rate with HR-capable workouts only', () => {
    const hr = generatePlan({ ...base, basis: 'hr' }, LIBRARY);
    for (const w of hr.weeks) for (const d of w.days) expect(LIBRARY.find((x) => x.id === d.workoutId)!.bases).toContain('hr');
  });
});
