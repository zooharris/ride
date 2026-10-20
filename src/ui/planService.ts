import { db, getSetting, setSetting, untracked } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { activityLine, durationWords, reviewAfterSync, type CoachReview } from '../coach/claude';
import { workoutStats } from '../engine/workout';
import { diffPlan, reviewLastWeek, summarize, type Replan } from '../engine/adapt';
import type { Goal } from '../engine/goals';
import { addDays, today } from '../engine/load';
import { generatePlan, type Availability, type Plan, type Phase as PlanPhase } from '../engine/planner';
import type { Basis, Fitness, PlannedWorkout, Profile, Workout } from '../engine/types';
import { newId } from '../engine/workout';
import { deleteEvent } from '../sync/intervals';
import { autoBackup } from '../data/backup';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, fmtDate, weekStart } from './derived';
import type { AppData } from './store';
import { findWorkout, notify } from './store';

/** The plan in force: what was asked for, and the fitness line it expected. */
export interface ActivePlan {
  updatedAt?: string;
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
  /** The plan's weeks as built (phase and planned load), for the timeline and the calendar's recovery-week shading. Plans applied before this was kept have none. */
  weeks?: PlanWeekSummary[];
}

export interface PlanWeekSummary { start: string; phase: PlanPhase; label: string; tss: number }

/** Every plan on the calendar, oldest first. Plans never overlap in time. */
export async function getPlans(): Promise<ActivePlan[]> {
  await migrateLegacyPlans();
  const valid = (await db.plans.toArray()).filter((p) => p.goal && p.availability?.equipment);
  const recovered = await recoverPlans(valid);
  return [...valid, ...recovered].sort((a, b) => a.start.localeCompare(b.start));
}

/** Save one plan. Each plan is its own record, so a device can only add, change or remove a plan, never replace the whole set. */
export async function putPlan(plan: ActivePlan): Promise<void> { await db.plans.put(plan); }

/** Remove one plan; the deletion travels to the other devices. */
export async function deletePlan(id: string): Promise<void> { await db.plans.delete(id); }

/** Give a plan a new name, here and on its sessions (so a rebuilt plan keeps it). */
export async function renamePlan(id: string, name: string): Promise<void> {
  const n = name.trim();
  const p = await db.plans.get(id);
  if (!p || !n) return;
  await putPlan({ ...p, name: n });
  const sessions = await db.planned.filter((x) => x.planId === id).toArray();
  for (const x of sessions) await db.planned.update(x.id, { planName: n });
  notify();
}

/**
 * Plans used to live in one list under the `plans` setting (and before that a
 * single `activePlan`). Any entry there that the table lacks, and that was not
 * deleted since, is copied in, unstamped, so a real record from another device
 * always wins over it. The old setting is left alone: older builds still read it.
 */
async function migrateLegacyPlans(): Promise<void> {
  const list = (await getSetting<ActivePlan[] | null>('plans', null)) ?? [];
  const old = await getSetting<ActivePlan | null>('activePlan', null);
  const legacy = [...list, ...(old && old.goal && old.availability?.equipment ? [{ ...old, name: old.name || defaultPlanName(old.goal) }] : [])];
  if (!legacy.length) return;
  const toCopy: ActivePlan[] = [];
  for (const p of legacy) {
    if (!p?.id || (await db.plans.get(p.id)) || (await db.tombstones.get(`plans:${p.id}`))) continue;
    const { updatedAt: _u, ...rest } = p;
    toCopy.push(rest as ActivePlan);
  }
  if (toCopy.length) await untracked(() => db.plans.bulkPut(toCopy));
}

/**
 * Sessions still to come that a plan put on the calendar, whose plan record is
 * missing. The plan is rebuilt from the sessions (their stored plan name, else
 * the last plan request) and saved, so the other devices get it back too.
 * Never before this device has finished a round of sync with the others (the
 * record may simply not have arrived yet), and never for a plan that was
 * deleted on purpose; a cancelled plan also leaves nothing to come.
 */
async function recoverPlans(plans: ActivePlan[]): Promise<ActivePlan[]> {
  const known = new Set(plans.map((p) => p.id));
  const t = today();
  const all = await db.planned.toArray();
  const candidates = [...new Set(all.filter((p) => p.planId && !known.has(p.planId) && p.date >= t && p.status !== 'completed').map((p) => p.planId!))];
  if (!candidates.length) return [];
  const synced = !!(await getSetting<{ last?: string } | null>('deviceSync', null))?.last;
  if (!synced && (await credentials())) return [];
  const orphanIds: string[] = [];
  for (const id of candidates) if (!(await db.tombstones.get(`plans:${id}`))) orphanIds.push(id);
  if (!orphanIds.length) return [];
  const req = await getSetting<{ goal: Goal; availability: Availability; masters: boolean } | null>('planRequest', null);
  const out: ActivePlan[] = [];
  for (const id of orphanIds) {
    const sessions = all.filter((p) => p.planId === id).sort((a, b) => a.date.localeCompare(b.date));
    const start = sessions[0].date;
    const last = sessions[sessions.length - 1].date;
    const goal: Goal = req?.goal ?? { kind: 'general', weeks: Math.max(1, Math.round((Date.parse(last) - Date.parse(start)) / (7 * 864e5)) + 1) };
    const availability: Availability = req?.availability?.equipment ? req.availability : { hours: [0, 0, 0, 0, 0, 0, 0], outdoor: [false, false, false, false, false, false, false], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] };
    const goalDate = goal.kind === 'event' && goal.date > last ? goal.date : last;
    const byWeek = new Map<string, PlanWeekSummary>();
    for (const s of sessions) {
      const ws = weekStart(s.date);
      if (!byWeek.has(ws)) {
        const label = s.note ?? '';
        const phase = (['recovery', 'taper', 'peak', 'build', 'base'] as PlanPhase[]).find((ph) => label.toLowerCase().startsWith(ph)) ?? 'base';
        byWeek.set(ws, { start: ws, phase, label, tss: 0 });
      }
    }
    const name = sessions.find((s) => s.planName)?.planName ?? defaultPlanName(goal);
    const plan: ActivePlan = { id, name, goal, availability, masters: req?.masters ?? true, start, goalDate, requiredCtl: 0, projection: [], appliedAt: new Date().toISOString(), lastCheck: t, weeks: [...byWeek.values()] };
    await putPlan(plan);
    out.push(plan);
  }
  return out;
}

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
  await db.planned.bulkAdd(toAdd.map((x) => ({ id: newId(), date: x.s.date, workoutId: x.s.workout.id, basis: profile.basis, status: 'planned' as const, note: x.label, planId, planName: name })));
  added = toAdd.length;
  await pruneOrphanWorkouts();
  const newWeeks: PlanWeekSummary[] = plan.weeks.map((w) => ({ start: w.start, phase: w.phase, label: w.label, tss: Math.round(w.tss) }));
  const weeks = [...(existingPlan?.weeks ?? []).filter((w) => w.start < (newWeeks[0]?.start ?? '9999')), ...newWeeks];
  const active: ActivePlan = { id: planId, name, goal, availability, masters, start: existingPlan?.start ?? planStart, goalDate: plan.goalDate, requiredCtl: plan.requiredCtl, projection: plan.projection, appliedAt: new Date().toISOString(), lastCheck: from, weeks };
  await putPlan(active);
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
/**
 * Take a session off the calendar, after the rider confirms. Anything sent to
 * Intervals.icu (and so the Garmin) comes off there too; a completed session's
 * recording stays, only the calendar entry goes. Returns false if the rider
 * said no.
 */
export async function removePlanned(id: string, mine: Workout[]): Promise<boolean> {
  const p = await db.planned.get(id);
  if (!p) return false;
  const w = findWorkout(mine, p.workoutId);
  const what = `${w?.name ?? 'this session'} from ${fmtDate(p.date)}`;
  const also = p.status === 'completed' ? ' The recording stays in Intervals.icu and in your activities; only the calendar entry goes.' : p.icuEventId ? ' It will also be removed from Intervals.icu and your Garmin.' : '';
  if (!confirm(`Remove ${what}?${also}`)) return false;
  if (p.icuEventId && p.status !== 'completed') {
    const c = await credentials();
    if (c) { try { await deleteEvent(c, p.icuEventId); } catch { /* the app's record is what matters; a stale event is harmless */ } }
  }
  await db.planned.delete(id);
  await pruneOrphanWorkouts();
  notify();
  return true;
}

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
  if (target) await deletePlan(target.id);
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
  await putPlan({ ...a, lastCheck: today() });
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
  const fresh = data.rides.filter((r) => newIds.includes(r.id)).map((r) => `${activityLine(r)}${r.decoupling != null && r.sport === 'ride' ? `, heart-rate drift ${r.decoupling.toFixed(1)}%` : ''}${plannedFor(r)}`);
  // What each new activity was meant to be, when it completed a session on the calendar.
  function plannedFor(r: { id: string }): string {
    const p = data.planned.find((x) => x.activityId === r.id);
    const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
    if (!w) return '';
    const secs = w.kind === 'ride' ? workoutStats(w.blocks).seconds : (w.minutes ?? 0) * 60;
    return `; completed the planned session "${w.name}"${secs ? ` (planned duration ${durationWords(secs)})` : ''}`;
  }
  const goal = active ? (active.goal.kind === 'event' ? `${active.goal.name || 'event'} on ${active.goal.date} (${active.goal.eventType})` : active.goal.kind) : 'no active plan';
  const review = await reviewAfterSync(key, {
    profile, date: today(), fitness: fitnessOn(series, today()),
    assessmentNotes: assessment.summary, goal,
    verdict: check?.plan.verdict ?? 'n/a', advice: check?.plan.advice ?? '',
    lastWeek: check?.review.lines ?? [],
    proposedChanges: check ? [...check.summary, ...check.changes.map((c) => `${c.date}: ${c.note} ${c.before ?? ''}${c.before && c.after ? ' → ' : ''}${c.after ?? ''}`)] : [],
    newActivities: fresh,
    riderNotes: recentNoteLines(data.dayNotes, today(), 14),
  });
  await setSetting('coachReview', review);
  return { review, check };
}

/** The rider's day notes from the last `days` days, newest first, one line each, for the coach. */
export function recentNoteLines(notes: { date: string; text?: string; badWellness?: boolean }[], date: string, days: number): string[] {
  const from = addDays(date, -days);
  return notes
    .filter((n) => n.date >= from && n.date <= date && (n.text || n.badWellness))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((n) => `${n.date}: ${[n.text, n.badWellness ? 'wellness for this day set aside as wrong' : ''].filter(Boolean).join(' — ')}`);
}
