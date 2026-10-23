import { describe, expect, it } from 'vitest';
import { changeKeys, diffPlan, splitByHorizon, summarize, type Change, type WeekReview } from './adapt';
import { HOLD_QUALITY, generatePlan, qualityMoved, type Plan, type PlanRequest, type PlannedSession, type QualityScores } from './planner';
import { LIBRARY } from '../library/workouts';
import { generateMobility } from './sessions';
import { assess } from './assessment';
import { addDays } from './load';
import { readReview, readVerdict } from '../coach/claude';
import { changeSig, changesSigOf, recommendedChanges, type SavedReview } from '../ui/planService';
import type { PlannedWorkout, Profile, Ride, Wellness, Workout } from './types';

const T = '2026-10-19';   // a Monday
const lib = (id: string) => LIBRARY.find((w) => w.id === id)!;
const LONG = lib('trail-long-180');          // Purcellville
const TEMPO = lib('in-tempo-60');            // Floris
const mob = { ...generateMobility({ focus: 'after-long-ride', minutes: 12, reason: 'r' }), id: 'mob-1' };

function planOf(sessions: Array<{ date: string; w: Workout }>): Plan {
  const ps: PlannedSession[] = sessions.map(({ date, w }) => ({ date, kind: w.kind, type: 'long', workout: w, seconds: 3600, tss: 50, reason: 'r' }));
  return { weeks: [{ index: 1, start: T, phase: 'base', label: 'Base 1', targetTss: 400, tss: 400, hours: 6, sessions: ps, note: '' }], demand: {} as Plan['demand'], projection: [], goalDate: addDays(T, 60), requiredCtl: 0, projectedCtl: 0, formOnDay: 0, longestPlanned: 3 * 3600, verdict: 'no-target', advice: '', decisions: [], qualityScores: { threshold: 0, vo2max: 0, anaerobic: 0, limiterVo2: 0, limiterTopEnd: 0 } };
}
const cal = (entries: Array<{ id: string; date: string; w: Workout }>): { planned: PlannedWorkout[]; workouts: Map<string, Workout> } => ({
  planned: entries.map((e) => ({ id: e.id, date: e.date, workoutId: e.w.id, basis: 'power' as const, status: 'planned' as const, planId: 'plan' })),
  workouts: new Map(entries.map((e) => [e.w.id, e.w])),
});
const SAT = addDays(T, 5), SUN = addDays(T, 6);

describe('Batch 6 C1: a move is one row', () => {
  it('the long ride from Saturday to Sunday, with its mobility, is one change that accepts every slot', () => {
    const { planned, workouts } = cal([{ id: 'a', date: SAT, w: LONG }, { id: 'b', date: SAT, w: mob }]);
    const changes = diffPlan(planned, workouts, planOf([{ date: SUN, w: LONG }, { date: SUN, w: mob }]), T);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ note: 'moved', date: SUN, movedFrom: SAT, kind: 'ride', after: 'Purcellville' });
    expect(changeKeys(changes[0]).sort()).toEqual([`${SAT}|mobility`, `${SAT}|ride`, `${SUN}|mobility`, `${SUN}|ride`].sort());
  });

  it('a removal with nothing arriving elsewhere stays a removal; a different session elsewhere is not a move', () => {
    const { planned, workouts } = cal([{ id: 'a', date: SAT, w: LONG }]);
    expect(diffPlan(planned, workouts, planOf([]), T)).toMatchObject([{ note: 'removed', date: SAT }]);
    const other = diffPlan(planned, workouts, planOf([{ date: SUN, w: TEMPO }]), T);
    expect(other.map((c) => c.note).sort()).toEqual(['added', 'removed']);
  });

  it('the summary says the long ride moves, and says "now 3h" only when the longest ride changes', () => {
    const review: WeekReview = { from: T, to: T, planned: 0, completed: 0, missed: 0, lines: [] };
    const move: Change = { date: SUN, kind: 'ride', before: 'Purcellville', beforeSub: 'Long Endurance 3:00', after: 'Purcellville', afterSub: 'Long Endurance 3:00', note: 'moved', movedFrom: SAT };
    const lines = summarize(review, [move], planOf([]), 50, 50, undefined, 3 * 3600);
    expect(lines.some((l) => /^The long ride moves from \w+ to \w+\.$/.test(l))).toBe(true);
    expect(lines.some((l) => /re-sized/.test(l))).toBe(false);
    const resized: Change = { date: SUN, kind: 'ride', before: 'Purcellville', beforeSub: 'Long Endurance 3:00', after: 'Round Hill', afterSub: 'Long Endurance 3:15', note: 'changed' };
    expect(summarize(review, [resized], planOf([]), 50, 50, undefined, 3 * 3600).some((l) => /re-sized/.test(l))).toBe(false);   // longest unchanged
    expect(summarize(review, [resized], planOf([]), 50, 50, undefined, 2.5 * 3600).some((l) => /re-sized; the longest planned is now/.test(l))).toBe(true);
  });
});

describe('Batch 6 C2: two weeks on Today, later changes only with a cause', () => {
  const quiet: WeekReview = { from: T, to: T, planned: 3, completed: 3, missed: 0, lines: [], unplannedTss: 0 };
  const near: Change = { date: addDays(T, 3), kind: 'ride', note: 'changed' };
  const far: Change = { date: addDays(T, 40), kind: 'ride', note: 'changed' };
  it('without a cause the far change waits', () => {
    expect(splitByHorizon([near, far], quiet, 50, 50, T)).toEqual({ now: [near], later: [far] });
  });
  it('fitness off the line, a missed session, or a big unplanned one brings it forward', () => {
    expect(splitByHorizon([near, far], quiet, 46, 50, T).later).toEqual([]);
    expect(splitByHorizon([near, far], { ...quiet, missed: 1 }, 50, 50, T).later).toEqual([]);
    expect(splitByHorizon([near, far], { ...quiet, unplannedTss: 150 }, 50, 50, T).later).toEqual([]);
    expect(splitByHorizon([near, far], { ...quiet, unplannedTss: 60 }, 50, 50, T).later).toEqual([far]);
  });
});

describe('Batch 6 C3: the quality type holds unless the evidence moves', () => {
  const s: QualityScores = { threshold: 1.0, vo2max: 0.4, anaerobic: 0.2, limiterVo2: 0, limiterTopEnd: 0 };
  it('holds at 0.14, flips at 0.15', () => {
    expect(HOLD_QUALITY).toBe(0.15);
    expect(qualityMoved(s, { ...s, threshold: 1.14 })).toBe(false);
    expect(qualityMoved(s, { ...s, threshold: 1.15 })).toBe(true);
    expect(qualityMoved(s, { ...s, limiterVo2: 1 })).toBe(true);   // a new limiter is a real cause
  });

  // A steady rider and a century: build weeks carry threshold or sweet spot.
  const profile: Profile = { name: 'T', ftp: 210, lthr: 154, maxHr: 180, restingHr: 50, weightKg: 90, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
  const rides: Ride[] = [], wellness: Wellness[] = [];
  for (let i = 84; i >= 1; i--) {
    const d = addDays(T, -i), dw = new Date(d + 'T00:00:00').getDay();
    const r = (h: number, IF: number): Ride => ({ id: d + h, date: d, startTime: d, name: 'r', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 3600 * IF * IF / 36), normalizedPower: IF * 210, averageHr: 130, intensityFactor: IF });
    if (dw === 6) rides.push(r(1.75, 0.82)); if (dw === 0) rides.push(r(2.75, 0.68)); if (dw === 3) rides.push(r(1.25, 0.72));
    wellness.push({ date: d, hrv: 50, restingHr: 50, sleepSeconds: 7 * 3600 });
  }
  const req: PlanRequest = { start: T, goal: { kind: 'event', date: '2027-02-06', name: 'C', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' }, availability: { hours: [4, 0, 1.5, 1, 1.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] }, basis: 'power', masters: true, profile, assessment: assess({ today: T, profile, rides, wellness, planned: [] }) };

  it('a re-check keeps the calendar’s quality type for a week when the scores have not moved, and not when they have', () => {
    const base = generatePlan(req);
    const wk = base.weeks.find((w) => w.phase === 'build')!;
    const was = wk.sessions.filter((x) => x.kind === 'ride').map((x) => x.workout.family).filter((f) => ['sweetspot', 'threshold', 'tempo', 'vo2max'].includes(f));
    const other = was[0] === 'threshold' ? 'sweetspot' : 'threshold';
    expect(was.length).toBeGreaterThan(0);
    expect(was[0]).not.toBe(other);
    expect(was).not.toContain(other);   // so a held 'other' can only come from the calendar
    const held = generatePlan({ ...req, keepQuality: { scores: base.qualityScores, byWeek: { [wk.start]: [other as never] } } });
    expect(held.weeks.find((w) => w.start === wk.start)!.sessions.some((x) => x.workout.family === other)).toBe(true);
    const moved = generatePlan({ ...req, keepQuality: { scores: { ...base.qualityScores, threshold: base.qualityScores.threshold + 0.5 }, byWeek: { [wk.start]: [other as never] } } });
    expect(moved.weeks.find((w) => w.start === wk.start)!.sessions.filter((x) => x.kind === 'ride').map((x) => x.workout.family)).toContain(was[0]);
  });
});

describe('Batch 6 C5 and Batch 7 A1: one verdict per change, one voice on screen', () => {
  it('reads the new form, the old form, and a malformed reply', () => {
    const r = readReview('d', { content: [{ type: 'text', text: JSON.stringify({ text: 't', verdicts: [{ date: '2026-10-22', kind: 'Mobility', apply: true, why: 'w' }, { date: '2026-10-24', kind: 'ride', apply: false, why: 'keep the long ride' }, { date: 'x', kind: 'ride', apply: true }], reason: 'r' }) }] });
    expect(r.verdicts).toEqual([{ date: '2026-10-22', kind: 'mobility', apply: true, why: 'w' }, { date: '2026-10-24', kind: 'ride', apply: false, why: 'keep the long ride' }]);
    expect(r).toMatchObject({ applyChanges: 'some', skip: ['2026-10-24'] });
    expect(readVerdict({ applyChanges: 'all', skip: [] })).toEqual({ applyChanges: 'all', skip: [], verdicts: undefined });
    expect(readReview('d', { content: [{ type: 'text', text: 'not json' }] }).failed).toBeTruthy();
  });

  const thu: Change = { date: '2026-10-22', kind: 'mobility', after: 'Mobility: after strength (10 min)', note: 'added' };
  const sat: Change = { date: '2026-10-24', kind: 'ride', before: 'Purcellville', after: 'Lake Fairfax', note: 'changed' };
  const nov: Change = { date: '2026-11-22', kind: 'ride', before: 'Hunter Mill', after: 'Great Falls', note: 'changed' };
  const review = (changes: Change[], verdicts: Array<[string, string, boolean]>): SavedReview => ({ date: 'd', text: 't', reason: 'Only the mobility is worth it.', applyChanges: 'some', skip: [], verdicts: verdicts.map(([date, kind, apply]) => ({ date, kind, apply, why: `why ${date}` })), changesSig: changesSigOf(changes) });
  const check = (changes: Change[]) => ({ review: { from: '', to: '', planned: 0, completed: 0, missed: 0, lines: [] }, plan: {} as never, changes, summary: ['The app’s own reason.'], fitnessNow: 0 });

  it('Batch 7 A1: coach off: the plan’s own list, with its own reasons', () => {
    const r = recommendedChanges(check([thu, sat]), null, false);
    expect(r).toMatchObject({ status: 'ready', byCoach: false });
    expect(r.changes).toEqual([thu, sat]);
    expect(r.reasons.size).toBe(0);
  });

  it('Batch 7 A1: coach on and it judged these changes: only what it would apply, each with its reason; the rest are gone', () => {
    const all = [thu, sat, nov];
    const r = recommendedChanges(check(all), review(all, [['2026-10-22', 'mobility', true], ['2026-10-24', 'ride', false], ['2026-11-22', 'ride', false]]), true);
    expect(r).toMatchObject({ status: 'ready', byCoach: true, reason: 'Only the mobility is worth it.' });
    expect(r.changes).toEqual([thu]);
    expect(r.reasons.get(changeSig(thu))).toBe('why 2026-10-22');
    expect(r.reasons.has(changeSig(sat))).toBe(false);
  });

  it('Batch 7 A1: coach on, and it judged other changes, nothing yet, or failed: waiting', () => {
    expect(recommendedChanges(check([thu, sat, nov]), review([thu, sat], [['2026-10-22', 'mobility', true], ['2026-10-24', 'ride', true]]), true).status).toBe('waiting');
    expect(recommendedChanges(check([thu]), null, true).status).toBe('waiting');
    expect(recommendedChanges(check([thu]), { ...review([thu], [['2026-10-22', 'mobility', true]]), failed: 'x' }, true).status).toBe('waiting');
    expect(recommendedChanges(check([thu]), { date: 'd', text: 't', reason: 'r', applyChanges: 'all', skip: [] }, true).status).toBe('waiting');   // an older review without verdicts
  });

  it('Batch 7 A1: after one is rejected the rest are still judged: no second wait', () => {
    const all = [thu, sat];
    const r = recommendedChanges(check([sat]), review(all, [['2026-10-22', 'mobility', true], ['2026-10-24', 'ride', true]]), true);
    expect(r.status).toBe('ready');
    expect(r.changes).toEqual([sat]);
  });

  it('Batch 7 A1: the coach set every change aside: an empty list, ready (nothing is shown)', () => {
    const r = recommendedChanges(check([thu, sat]), review([thu, sat], [['2026-10-22', 'mobility', false], ['2026-10-24', 'ride', false]]), true);
    expect(r).toMatchObject({ status: 'ready', byCoach: true });
    expect(r.changes).toEqual([]);
  });
});
