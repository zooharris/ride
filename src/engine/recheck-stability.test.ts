import { describe, expect, it } from 'vitest';
import { assess } from './assessment';
import { generatePlan, type Availability, type PlannedSession, type PlanRequest } from './planner';
import { diffPlan } from './adapt';
import { addDays } from './load';
import type { Goal } from './goals';
import type { Basis, PlannedWorkout, Profile, Ride, Wellness, Workout } from './types';
import type { SessionType } from './generate';

/**
 * The steady re-check (30 Oct 2026): a plan placed on any day of the week, re-checked every morning for two weeks on
 * the same evidence, offers no changes. Placed and re-checked the way the app does it (planService: applyPlan, replan).
 */
const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 90, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const T0 = '2026-11-02';   // a Monday
const rides: Ride[] = []; const wellness: Wellness[] = [];
for (let i = 84; i >= 1; i--) {
  const d = addDays(T0, -i); const dw = new Date(d + 'T00:00:00').getDay();
  const r = (h: number, IF: number) => rides.push({ id: d + h, date: d, startTime: d, name: 'r', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 3600 * IF * IF / 36), normalizedPower: IF * 250, averageHr: 140, intensityFactor: IF });
  if (dw === 6) r(1.75, 0.82); if (dw === 0) r(2.75, 0.68); if (dw === 3) r(1.25, 0.72);
  wellness.push({ date: d, hrv: 50, restingHr: 50, sleepSeconds: 25200 });
}
const assessment = assess({ today: T0, profile, rides, wellness, planned: [] });
const AV: Availability = { hours: [3, 1, 1.5, 1, 1.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false],
  equipment: ['dumbbells', 'bench', 'bodyweight', 'kettlebell', 'band', 'treadmill', 'outdoor-walk'], pins: [], may: { strength: true, mobility: true, walk: true, run: false } };
const CENTURY: Goal = { kind: 'event', date: '2027-01-29', name: 'Century', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' };

export function steady(goal: Goal, basis: Basis, placedOn: string, doneAsPlanned: boolean): string[] {
  const base: PlanRequest = { start: addDays(placedOn, -((new Date(placedOn + 'T00:00:00').getDay() + 6) % 7)), notBefore: placedOn, goal, availability: AV, basis, masters: true, profile: { ...profile, basis }, assessment };
  const plan = generatePlan(base);
  // Placed: rides by Library id; everything else as a copy remembering its Library session.
  const workouts = new Map<string, Workout>(); const cal: PlannedWorkout[] = []; let k = 0;
  for (const w of plan.weeks) for (const s of w.sessions) {
    const copy = s.workout.kind === 'ride' ? s.workout : { ...s.workout, id: `gen-${k}`, source: 'generated' as const, libraryId: s.workout.libraryId ?? s.workout.id };
    workouts.set(copy.id, copy);
    cal.push({ id: `p${k++}`, date: s.date, workoutId: copy.id, basis, status: 'planned', planId: 'plan', reason: s.reason });
  }
  const planStart = plan.weeks[0]?.sessions[0]?.date ?? placedOn;
  const layout = plan.weeks.map((w) => ({ start: w.start, phase: w.phase, budget: w.targetTss }));
  const problems: string[] = [];
  for (let day = 1; day <= 14; day++) {
    const t = addDays(placedOn, day);
    const wkStart = addDays(t, -((new Date(t + 'T00:00:00').getDay() + 6) % 7));
    const recentPicks = cal.filter((p) => p.date < t && p.date >= addDays(wkStart, -21)).map((p) => ({ date: p.date, id: workouts.get(p.workoutId)!.libraryId ?? p.workoutId }));
    const pastSessions: PlannedSession[] = cal.filter((p) => p.date >= planStart && p.date < t).map((p) => {
      const w = workouts.get(p.workoutId)!;
      return { date: p.date, kind: w.kind, type: (w.kind === 'ride' ? w.family : w.kind) as SessionType, workout: w, seconds: 0, tss: plan.weeks.flatMap((x) => x.sessions).find((x) => x.date === p.date && (x.workout.libraryId ?? x.workout.id) === (w.libraryId ?? w.id))?.tss ?? 0, reason: p.reason ?? '' };
    });
    const done = doneAsPlanned ? pastSessions.filter((x) => x.date >= wkStart).map((x) => ({ date: x.date, tss: x.tss, seconds: 3600, kind: x.kind })) : [];
    const byWeek: Record<string, SessionType[]> = {};
    for (const p of cal) { const w = workouts.get(p.workoutId)!; if (p.date < t || w.kind !== 'ride' || !['sweetspot', 'tempo', 'threshold', 'vo2max', 'anaerobic'].includes(w.family)) continue; const ws = addDays(p.date, -((new Date(p.date + 'T00:00:00').getDay() + 6) % 7)); (byWeek[ws] ??= []).push(w.family as SessionType); }
    const again = generatePlan({ ...base, start: layout[0].start, notBefore: t, layout, keepBudgets: true, recentPicks, planStart, pastSessions, done, keepQuality: { scores: plan.qualityScores, byWeek } });
    const changes = diffPlan(cal.filter((p) => p.date >= t), workouts, again, t);
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DBG && changes.length && day === Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DAY ?? 1)) {
      const wk = changes[0].date.slice(0, 10); const ws = addDays(wk, -((new Date(wk + 'T00:00:00').getDay() + 6) % 7));
      const show = (pl: typeof plan) => pl.weeks.find((w) => w.start === ws)?.sessions.map((x) => `${x.date.slice(5)} ${x.type} ${x.workout.name}`).join(' | ');
      console.log('ORIG ', show(plan)); console.log('AGAIN', show(again)); console.log('held', JSON.stringify(byWeek[ws]));
      console.log('needs', JSON.stringify(plan.weeks.find((w) => w.start === ws)?.needs?.strength), JSON.stringify(again.weeks.find((w) => w.start === ws)?.needs?.strength), plan.weeks.find((w) => w.start === ws)?.needs?.hardSessions, again.weeks.find((w) => w.start === ws)?.needs?.hardSessions);
    }
    for (const c of changes) problems.push(`placed ${placedOn}, re-checked ${t}: ${c.date} ${c.kind} ${c.before ?? '-'} → ${c.after ?? '-'}`);
  }
  return problems;
}

describe('the steady re-check: a placed plan, re-checked on the same evidence, offers nothing', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((k) => addDays(T0, k));   // placed on a Monday through a Sunday
  it('a century, by power, nothing recorded yet', () => {
    expect(days.flatMap((d) => steady(CENTURY, 'power', d, false))).toEqual([]);
  });
  it('a century, by power, every session done as planned', () => {
    expect(days.flatMap((d) => steady(CENTURY, 'power', d, true))).toEqual([]);
  });
  it('general fitness, by power', () => {
    expect(days.flatMap((d) => steady({ kind: 'general', weeks: 10 }, 'power', d, false))).toEqual([]);
  });
  it('a century, by heart rate', () => {
    expect(days.flatMap((d) => steady(CENTURY, 'hr', d, false))).toEqual([]);
  });
});
