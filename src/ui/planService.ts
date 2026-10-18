import { db, getSetting, setSetting } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { diffPlan, reviewLastWeek, summarize, type Replan } from '../engine/adapt';
import type { Goal } from '../engine/goals';
import { today } from '../engine/load';
import { generatePlan, type Availability, type Plan } from '../engine/planner';
import type { Fitness, Profile } from '../engine/types';
import { newId } from '../engine/workout';
import { deleteEvent } from '../sync/intervals';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, weekStart } from './derived';
import type { AppData } from './store';
import { findWorkout, notify } from './store';

/** The plan in force: what was asked for, and the fitness line it expected. */
export interface ActivePlan {
  goal: Goal;
  availability: Availability;
  masters: boolean;
  start: string;
  goalDate: string;
  requiredCtl: number;
  projection: Fitness[];
  appliedAt: string;
  lastCheck?: string;
}

export async function getActivePlan(): Promise<ActivePlan | null> {
  const a = await getSetting<ActivePlan | null>('activePlan', null);
  return a && a.goal && a.availability?.equipment ? a : null;
}

export async function buildPlan(data: AppData, goal: Goal, availability: Availability, masters: boolean): Promise<Plan> {
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const longs = data.rides.filter((r) => r.sport === 'ride' && r.seconds >= 7200 && r.averageSpeedMs);
  const longRideKmh = longs.length ? (longs.reduce((s, r) => s + (r.averageSpeedMs ?? 0), 0) / longs.length) * 3.6 : undefined;
  return generatePlan({ start: weekStart(today()), notBefore: today(), goal, availability, basis: profile.basis, masters, profile, assessment, longRideKmh });
}

/**
 * Put a plan on the calendar from today. Sessions already there that the new
 * plan keeps (same date, kind and name) are left alone, so a ride already on
 * the Garmin is not deleted and re-sent for nothing.
 */
export async function applyPlan(data: AppData, plan: Plan, goal: Goal, availability: Availability, masters: boolean): Promise<{ added: number; removed: number; kept: number }> {
  const from = today();
  const profile = data.profile as Profile;
  const future = data.planned.filter((p) => p.date >= from && p.status !== 'completed');
  const incoming = plan.weeks.flatMap((w) => w.sessions.filter((s) => s.date >= from).map((s) => ({ s, label: w.label })));
  const sig = (date: string, kind: string, name: string) => `${date}|${kind}|${name}`;
  const keep = new Map<string, true>();
  const existing = new Map<string, typeof future[number]>();
  for (const p of future) {
    const w = findWorkout(data.mine, p.workoutId);
    if (w) existing.set(sig(p.date, w.kind, w.name), p);
  }
  const c = await credentials();
  let kept = 0, added = 0, removed = 0;
  const toAdd: Array<{ s: typeof incoming[number]['s']; label: string }> = [];
  for (const item of incoming) {
    const k = sig(item.s.date, item.s.kind, item.s.workout.name);
    if (existing.has(k) && !keep.has(k)) { keep.set(k, true); kept++; }
    else toAdd.push(item);
  }
  for (const [k, p] of existing) {
    if (keep.has(k)) continue;
    if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* a stale event is harmless */ } }
    await db.planned.delete(p.id);
    removed++;
  }
  await db.workouts.bulkPut(toAdd.map((x) => x.s.workout));
  await db.planned.bulkAdd(toAdd.map((x) => ({ id: newId(), date: x.s.date, workoutId: x.s.workout.id, basis: profile.basis, status: 'planned' as const, note: x.label })));
  added = toAdd.length;
  const active: ActivePlan = { goal, availability, masters, start: plan.weeks[0]?.start ?? from, goalDate: plan.goalDate, requiredCtl: plan.requiredCtl, projection: plan.projection, appliedAt: new Date().toISOString(), lastCheck: from };
  await setSetting('activePlan', active);
  notify();
  return { added, removed, kept };
}

/** Re-run the planner from today and explain the differences. */
export async function replan(data: AppData): Promise<Replan | null> {
  const active = await getActivePlan();
  if (!active) return null;
  if (active.goal.kind === 'event' && active.goal.date <= today()) return null;
  const plan = await buildPlan(data, active.goal, active.availability, active.masters);
  const workouts = new Map(data.mine.map((w) => [w.id, w]));
  for (const p of data.planned) { const w = findWorkout(data.mine, p.workoutId); if (w) workouts.set(w.id, w); }
  const review = reviewLastWeek(data.planned, workouts, data.rides);
  const changes = diffPlan(data.planned, workouts, plan);
  const series = fitnessFromRides(data.rides);
  const fitnessNow = fitnessOn(series, today())?.ctl ?? 0;
  const fitnessPlanned = active.projection?.find((f) => f.date === today())?.ctl;
  const summary = summarize(review, changes, plan, fitnessNow, fitnessPlanned, active.projection);
  return { review, plan, changes, summary, fitnessNow, fitnessPlanned };
}

export async function markChecked(): Promise<void> {
  const a = await getActivePlan();
  if (a) await setSetting('activePlan', { ...a, lastCheck: today() });
}
