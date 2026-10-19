import { db, getSetting, setSetting } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { reviewAfterSync, type CoachReview } from '../coach/claude';
import { clock } from '../engine/workout';
import { diffPlan, reviewLastWeek, summarize, type Replan } from '../engine/adapt';
import type { Goal } from '../engine/goals';
import { today } from '../engine/load';
import { generatePlan, type Availability, type Plan } from '../engine/planner';
import type { Basis, Fitness, PlannedWorkout, Profile, Workout } from '../engine/types';
import { newId } from '../engine/workout';
import { deleteEvent } from '../sync/intervals';
import { autoBackup } from '../data/backup';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, weekStart } from './derived';
import type { AppData } from './store';
import { findWorkout, notify } from './store';

/** The plan in force: what was asked for, and the fitness line it expected. */
export interface ActivePlan {
  id: string;
  name: string;
  goal: Goal;
  availability: Availability;
  masters: boolean;
  start: string;             // first day the plan covers (its first session is on or after this)
  goalDate: string;          // last day the plan covers
  requiredCtl: number;
  projection: Fitness[];
  appliedAt: string;
  lastCheck?: string;
}

/** Every plan on the calendar, oldest first. Plans never overlap in time. */
export async function getPlans(): Promise<ActivePlan[]> {
  let plans = await getSetting<ActivePlan[] | null>('plans', null);
  if (!plans) {
    // One-time move from the single-plan setting.
    const old = await getSetting<ActivePlan | null>('activePlan', null);
    plans = old && old.goal && old.availability?.equipment ? [{ ...old, name: old.name || defaultPlanName(old.goal) }] : [];
    await setSetting('plans', plans);
    await setSetting('activePlan', null);
  }
  return plans.filter((p) => p.goal && p.availability?.equipment).sort((a, b) => a.start.localeCompare(b.start));
}

export async function savePlans(plans: ActivePlan[]): Promise<void> { await setSetting('plans', plans); }

/** The plan that covers today, else the next one to start, else null. */
export async function getActivePlan(): Promise<ActivePlan | null> {
  const plans = await getPlans();
  const t = today();
  return plans.find((p) => p.start <= t && p.goalDate >= t) ?? plans.find((p) => p.start > t) ?? null;
}

export function defaultPlanName(goal: Goal): string {
  if (goal.kind === 'event') return goal.name || 'Event plan';
  return { ftp: 'FTP block', vo2max: 'VO2max block', endurance: 'Endurance block', weight: 'Weight block', general: 'General fitness' }[goal.kind] ?? 'Training plan';
}

/** The plan whose dates collide with [start, end], if any. */
export function overlapping(plans: ActivePlan[], start: string, end: string, exceptId?: string): ActivePlan | undefined {
  return plans.find((p) => p.id !== exceptId && p.start <= end && p.goalDate >= start);
}

export async function buildPlan(data: AppData, goal: Goal, availability: Availability, masters: boolean, startDate?: string, endDate?: string): Promise<Plan> {
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const longs = data.rides.filter((r) => r.sport === 'ride' && r.seconds >= 7200 && r.averageSpeedMs);
  const longRideKmh = longs.length ? (longs.reduce((s, r) => s + (r.averageSpeedMs ?? 0), 0) / longs.length) * 3.6 : undefined;
  const notBefore = startDate && startDate > today() ? startDate : today();
  const start = weekStart(notBefore);
  // Re-planning a block already under way: keep its end date, so only the remaining weeks are regenerated.
  const g: Goal = goal.kind !== 'event' && endDate ? { ...goal, weeks: Math.max(1, Math.round((Date.parse(endDate) - Date.parse(start) + 864e5) / (7 * 864e5))) } : goal;
  return generatePlan({ start, notBefore, goal: g, availability, basis: profile.basis, masters, profile, assessment, longRideKmh });
}

/**
 * Put a plan on the calendar from today. Sessions already there that the new
 * plan keeps (same date, kind and name) are left alone, so a ride already on
 * the Garmin is not deleted and re-sent for nothing.
 */
export async function applyPlan(data: AppData, plan: Plan, goal: Goal, availability: Availability, masters: boolean, accept?: Set<string>, opts: { name?: string; planId?: string } = {}): Promise<{ added: number; removed: number; kept: number }> {
  const from = today();
  const profile = data.profile as Profile;
  const plans = await getPlans();
  const existingPlan = opts.planId ? plans.find((p) => p.id === opts.planId) : undefined;
  const planId = existingPlan?.id ?? newId();
  const name = opts.name?.trim() || existingPlan?.name || defaultPlanName(goal);
  const planStart = plan.weeks[0]?.sessions[0]?.date ?? plan.weeks[0]?.start ?? from;
  // Only this plan's own sessions are replaced; anything added by hand, or by another plan, stays.
  const future = data.planned.filter((p) => p.date >= from && p.status !== 'completed' && (existingPlan ? p.planId === planId : (p.planId ? p.planId === planId : isPlanSession(p, data) && !plans.length)));
  const incoming = plan.weeks.flatMap((w) => w.sessions.filter((s) => s.date >= from).map((s) => ({ s, label: w.label })));
  const key = (date: string, kind: string) => `${date}|${kind}`;
  const sig = (date: string, kind: string, name: string) => `${date}|${kind}|${name}`;
  // Which date-and-kind slots may change. Without an explicit list, every slot the rider has not edited.
  const edited = new Set<string>();
  for (const p of future) {
    const w = findWorkout(data.mine, p.workoutId);
    if (!w) continue;
    if (p.userEdited) edited.add(key(p.date, w.kind));
    if (p.movedFrom) edited.add(key(p.movedFrom, w.kind));
  }
  const allowed = (k: string) => (accept ? accept.has(k) : !edited.has(k));
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
    else if (allowed(key(item.s.date, item.s.kind))) toAdd.push(item);
  }
  for (const [k, p] of existing) {
    if (keep.has(k)) continue;
    const w = findWorkout(data.mine, p.workoutId);
    if (w && !allowed(key(p.date, w.kind))) { kept++; continue; }   // the rider's own edit, or a change they declined
    if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* a stale event is harmless */ } }
    await db.planned.delete(p.id);
    removed++;
  }
  await db.workouts.bulkPut(toAdd.map((x) => x.s.workout));
  await db.planned.bulkAdd(toAdd.map((x) => ({ id: newId(), date: x.s.date, workoutId: x.s.workout.id, basis: profile.basis, status: 'planned' as const, note: x.label, planId })));
  added = toAdd.length;
  await pruneOrphanWorkouts();
  const active: ActivePlan = { id: planId, name, goal, availability, masters, start: existingPlan?.start ?? planStart, goalDate: plan.goalDate, requiredCtl: plan.requiredCtl, projection: plan.projection, appliedAt: new Date().toISOString(), lastCheck: from };
  await savePlans([...plans.filter((p) => p.id !== planId), active]);
  notify();
  if (c) autoBackup(c, true);
  return { added, removed, kept };
}

/**
 * Replace what is planned on a date with another workout of any kind. The old
 * entry's slot, date and plan membership are kept; if it was already on the
 * Garmin the old event is removed and the new one waits to be sent.
 */
export async function replacePlanned(p: PlannedWorkout, w: Workout, basis: Basis): Promise<void> {
  const c = await credentials();
  if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* harmless */ } }
  let workoutId = w.id;
  if (w.source === 'library' && w.kind !== 'ride') { workoutId = `gen-${newId()}`; await db.workouts.put({ ...w, id: workoutId, source: 'generated' }); }
  await db.planned.put({ ...p, workoutId, basis: w.bases.includes(basis) ? basis : w.bases[0], status: 'planned', icuEventId: undefined, activityId: undefined, userEdited: p.planId ? true : p.userEdited });
  await pruneOrphanWorkouts();
  notify();
}

/** Move a planned session to another date. A session already on the Garmin comes off it and waits to be sent again. */
export async function movePlanned(p: PlannedWorkout, date: string): Promise<void> {
  if (date === p.date) return;
  const c = await credentials();
  if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* harmless */ } }
  await db.planned.put({ ...p, date, status: p.status === 'sent' ? 'planned' : p.status, icuEventId: undefined, userEdited: p.planId ? true : p.userEdited, movedFrom: p.movedFrom ?? p.date });
  notify();
}

/** Did a plan put this on the calendar? Older plan entries carry no id but point at generated sessions. */
export function isPlanSession(p: { planId?: string; workoutId: string }, data: AppData): boolean {
  if (p.planId) return true;
  return findWorkout(data.mine, p.workoutId)?.source === 'generated';
}

/** Re-run the planner from today and explain the differences. */
export async function replan(data: AppData): Promise<Replan | null> {
  const active = await getActivePlan();
  if (!active) return null;
  if (active.goal.kind === 'event' && active.goal.date <= today()) return null;
  const plan = await buildPlan(data, active.goal, active.availability, active.masters, active.start, active.goalDate);
  const workouts = new Map(data.mine.map((w) => [w.id, w]));
  for (const p of data.planned) { const w = findWorkout(data.mine, p.workoutId); if (w) workouts.set(w.id, w); }
  const mine = data.planned.filter((p) => !p.planId || p.planId === active.id);   // this plan's sessions and hand-added ones; other plans are left alone
  const review = reviewLastWeek(mine, workouts, data.rides);
  const changes = diffPlan(mine, workouts, plan).filter((c) => c.date <= active.goalDate);
  const series = fitnessFromRides(data.rides);
  const fitnessNow = fitnessOn(series, today())?.ctl ?? 0;
  const fitnessPlanned = active.projection?.find((f) => f.date === today())?.ctl;
  const summary = summarize(review, changes, plan, fitnessNow, fitnessPlanned, active.projection);
  return { review, plan, changes, summary, fitnessNow, fitnessPlanned };
}

/**
 * Cancel the plan in force: everything it put on the calendar from today on
 * that has not been done comes off, including from Intervals.icu and the Garmin.
 * Completed sessions stay as history.
 */
export async function cancelPlan(data: AppData, planId?: string): Promise<{ removed: number }> {
  const from = today();
  const plans = await getPlans();
  const target = planId ? plans.find((p) => p.id === planId) : await getActivePlan();
  const future = data.planned.filter((p) => p.date >= from && p.status !== 'completed' && (target ? p.planId === target.id : isPlanSession(p, data)));
  const c = await credentials();
  for (const p of future) {
    if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* a stale event is harmless */ } }
    await db.planned.delete(p.id);
  }
  await savePlans(plans.filter((p) => p.id !== target?.id));
  await pruneOrphanWorkouts();
  notify();
  return { removed: future.length };
}

/**
 * Generated workouts (from a plan or a ready-made session) that nothing on the
 * calendar points at any more are just clutter in storage; drop them. Hand-built
 * and library workouts are never touched.
 */
export async function pruneOrphanWorkouts(): Promise<number> {
  const used = new Set((await db.planned.toArray()).map((p) => p.workoutId));
  const orphans = (await db.workouts.where('source').equals('generated').toArray()).filter((w) => !used.has(w.id));
  if (orphans.length) await db.workouts.bulkDelete(orphans.map((w) => w.id));
  return orphans.length;
}

export async function markChecked(): Promise<void> {
  const a = await getActivePlan();
  if (!a) return;
  const plans = await getPlans();
  await savePlans(plans.map((p) => (p.id === a.id ? { ...p, lastCheck: today() } : p)));
}


/**
 * With the setting on and a key present, Claude reviews each batch of new
 * activities against the plan's own re-check. Nothing is applied here.
 */
export async function coachReviewAfterSync(data: AppData, newIds: string[]): Promise<{ review: CoachReview; check: Replan | null } | null> {
  const on = await getSetting<boolean>('coachAuto', false);
  const key = await getSetting<string>('claudeKey', '');
  if (!on || !key || newIds.length === 0) return null;
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const active = await getActivePlan();
  const check = active ? await replan(data) : null;
  const series = fitnessFromRides(data.rides);
  const fresh = data.rides.filter((r) => newIds.includes(r.id)).map((r) => `${r.date} ${r.name} (${r.sport}): ${clock(r.seconds)}, ${r.tss ?? '?'} TSS${r.normalizedPower ? `, NP ${r.normalizedPower} W` : ''}${r.averageHr ? `, avg HR ${Math.round(r.averageHr)}` : ''}${r.decoupling != null ? `, HR drift ${r.decoupling.toFixed(1)}%` : ''}`);
  const goal = active ? (active.goal.kind === 'event' ? `${active.goal.name || 'event'} on ${active.goal.date} (${active.goal.eventType})` : active.goal.kind) : 'no active plan';
  const review = await reviewAfterSync(key, {
    profile, date: today(), fitness: fitnessOn(series, today()),
    assessmentNotes: assessment.summary, goal,
    verdict: check?.plan.verdict ?? 'n/a', advice: check?.plan.advice ?? '',
    lastWeek: check?.review.lines ?? [],
    proposedChanges: check ? [...check.summary, ...check.changes.map((c) => `${c.date}: ${c.note} ${c.before ?? ''}${c.before && c.after ? ' → ' : ''}${c.after ?? ''}`)] : [],
    newActivities: fresh,
  });
  await setSetting('coachReview', review);
  return { review, check };
}
