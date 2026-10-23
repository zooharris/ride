import { rideLadders } from '../engine/zones';
import { db, getSetting, setSetting, untracked } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { activityLine, describeSession, durationWords, readVerdict, reviewAfterSync, type CoachPlan, type CoachReview } from '../coach/claude';
import { workoutStats } from '../engine/workout';
import { diffPlan, reviewLastWeek, summarize, type Change, type Replan } from '../engine/adapt';
import type { Goal } from '../engine/goals';
import { addDays, rideIntensity, today } from '../engine/load';
import { generatePlan, type Availability, type AwayRange, type Plan, type Phase as PlanPhase } from '../engine/planner';
import { weeklyLoad } from '../engine/progress';
import type { Basis, Fitness, PlannedWorkout, Profile, Workout } from '../engine/types';
import { newId } from '../engine/workout';
import { retargetWorkout } from '../engine/sessions';
import { deleteEvent, sendWorkout, type HrProfile, type IntervalsCredentials } from '../sync/intervals';
import { autoBackup } from '../data/backup';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, fmtDate, plannedOn, weekStart } from './derived';
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
  /** Days the rider is away; the plan places nothing on them, and a week mostly away is kept light. */
  away?: AwayRange[];
  /** The plan's weeks as built (phase and planned load), for the timeline and the calendar's recovery-week shading. Plans applied before this was kept have none. */
  weeks?: PlanWeekSummary[];
}

export interface PlanWeekSummary { start: string; phase: PlanPhase; label: string; tss: number }

/** Every plan on the calendar, oldest first. Plans never overlap in time. */
export async function getPlans(): Promise<ActivePlan[]> {
  await migrateLegacyPlans();
  const valid = await dropGhostPlans((await db.plans.toArray()).filter((p) => p.goal && p.availability?.equipment));
  const recovered = await recoverPlans(valid);
  return [...valid, ...recovered].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Plans never overlap. A plan that overlaps another and has nothing at all on
 * the calendar is a ghost (a deleted plan brought back by an older device) and
 * is removed; the removal travels to the other devices.
 */
async function dropGhostPlans(plans: ActivePlan[]): Promise<ActivePlan[]> {
  if (plans.length < 2) return plans;
  const owners = new Set((await db.planned.toArray()).map((p) => p.planId).filter(Boolean));
  const overlaps = (a: ActivePlan, b: ActivePlan) => a.id !== b.id && a.start <= b.goalDate && b.start <= a.goalDate;
  const ghosts = plans.filter((p) => !owners.has(p.id) && plans.some((q) => overlaps(p, q) && owners.has(q.id)));
  for (const g of ghosts) await db.plans.delete(g.id);
  return plans.filter((p) => !ghosts.includes(p));
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
  const workouts = await db.workouts.toArray();
  const sessionTss = (workoutId: string) => { const w = findWorkout(workouts, workoutId); return w ? plannedTss(w) : 0; };
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
      byWeek.get(ws)!.tss += sessionTss(s.workoutId);
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
  // Should two ever cover today, the one with sessions on the calendar is the plan in force.
  const counts = new Map<string, number>();
  for (const p of await db.planned.toArray()) if (p.planId) counts.set(p.planId, (counts.get(p.planId) ?? 0) + 1);
  const covering = plans.filter((p) => p.start <= t && p.goalDate >= t).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return covering[0] ?? plans.find((p) => p.start > t) ?? null;
}

export function defaultPlanName(goal: Goal): string {
  if (goal.kind === 'event') return goal.name || 'Event plan';
  return { ftp: 'FTP block', vo2max: 'VO2max block', endurance: 'Endurance block', weight: 'Weight block', general: 'General fitness' }[goal.kind] ?? 'Training plan';
}

/** The plan whose dates collide with [start, end], if any. */
export function overlapping(plans: ActivePlan[], start: string, end: string, exceptId?: string): ActivePlan | undefined {
  return plans.find((p) => p.id !== exceptId && p.start <= end && p.goalDate >= start);
}

export async function buildPlan(data: AppData, goal: Goal, availability: Availability, masters: boolean, startDate?: string, endDate?: string, away?: AwayRange[], layout?: Array<{ start: string; phase: PlanPhase }>): Promise<Plan> {
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const longs = data.rides.filter((r) => r.sport === 'ride' && r.seconds >= 7200 && r.averageSpeedMs);
  const longRideKmh = longs.length ? (longs.reduce((s, r) => s + (r.averageSpeedMs ?? 0), 0) / longs.length) * 3.6 : undefined;
  const notBefore = startDate && startDate > today() ? startDate : today();
  const start = weekStart(notBefore);
  // Re-planning a block already under way: keep its end date, so only the remaining weeks are regenerated.
  const g: Goal = goal.kind !== 'event' && endDate ? { ...goal, weeks: Math.max(1, Math.round((Date.parse(endDate) - Date.parse(start) + 864e5) / (7 * 864e5))) } : goal;
  // Re-checking a plan already under way: its own weeks and phases, from its first week; only the sessions are fitted again.
  if (layout?.length) {
    // What was actually done this week, so the days left respond to it: everything before today, and
    // anything today that was not a planned session (a planned one done today is already in the plan).
    const t = today(), wk = weekStart(t);
    const doneToday = new Set(data.planned.filter((p) => p.date === t && p.status === 'completed').map((p) => p.activityId));
    const done = data.rides.filter((r) => r.date >= wk && (r.date < t || (r.date === t && !doneToday.has(r.id))))
      .map((r) => ({ date: r.date, tss: r.tss ?? 0, seconds: r.seconds, intensity: rideIntensity(r, profile.lthr, rideLadders(profile)), kind: r.sport }));
    return generatePlan({ start: layout[0].start, notBefore: t, goal, availability, basis: profile.basis, masters, profile, assessment, longRideKmh, away, layout, done });
  }
  return generatePlan({ start, notBefore, goal: g, availability, basis: profile.basis, masters, profile, assessment, longRideKmh, away });
}

/**
 * A re-check projects from today; the days before it keep the line the plan
 * had, so the chart on the plan page stays whole and "fitness against the
 * plan's line" compares with what was planned, not with a line redrawn today.
 */
export function mergeProjection(previous: Fitness[] | undefined, next: Fitness[]): Fitness[] {
  const first = next[0]?.date;
  if (!previous?.length || !first) return next;
  return [...previous.filter((f) => f.date < first), ...next];
}

/**
 * The plan's weeks and phases as it was laid out. Plans saved since the 19 Oct
 * build keep them; for an older one they are worked out once from the plan's
 * own first week and saved, so every later re-check uses the same layout.
 */
async function planLayout(data: AppData, active: ActivePlan): Promise<Array<{ start: string; phase: PlanPhase }>> {
  if (active.weeks?.length) return active.weeks.map((w) => ({ start: w.start, phase: w.phase }));
  const first = weekStart(active.start);
  const weeksTo = Math.max(1, Math.round((Date.parse(active.goalDate) - Date.parse(first) + 864e5) / (7 * 864e5)));
  const g: Goal = active.goal.kind === 'event' ? active.goal : { ...active.goal, weeks: weeksTo };
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const original = generatePlan({ start: first, notBefore: first, goal: g, availability: active.availability, basis: profile.basis, masters: active.masters, profile, assessment, away: active.away });
  const weeks: PlanWeekSummary[] = original.weeks.map((w) => ({ start: w.start, phase: w.phase, label: w.label, tss: Math.round(w.tss) }));
  await putPlan({ ...active, weeks });
  return weeks.map((w) => ({ start: w.start, phase: w.phase }));
}

/**
 * Put a plan on the calendar from today. Sessions already there that the new
 * plan keeps (same date, kind and name) are left alone, so a ride already on
 * the Garmin is not deleted and re-sent for nothing.
 */
export async function applyPlan(data: AppData, plan: Plan, goal: Goal, availability: Availability, masters: boolean, accept?: Set<string>, opts: { name?: string; planId?: string; away?: AwayRange[] } = {}): Promise<{ added: number; removed: number; kept: number }> {
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
  const active: ActivePlan = { id: planId, name, goal, availability, masters, away: opts.away ?? existingPlan?.away, start: existingPlan?.start ?? planStart, goalDate: plan.goalDate, requiredCtl: plan.requiredCtl, projection: mergeProjection(existingPlan?.projection, plan.projection), appliedAt: new Date().toISOString(), lastCheck: from, weeks };
  await putPlan(active);
  notify();
  if (c) autoBackup(c, true);
  return { added, removed, kept };
}

/**
 * Send a calendar entry to the Garmin (through Intervals.icu). An entry already
 * sent has its old event deleted first, so "Send again" replaces the copy on
 * the Garmin with the current version instead of adding a second one.
 */
export async function sendPlanned(c: IntervalsCredentials, p: PlannedWorkout, w: Workout, profile?: HrProfile): Promise<number> {
  if (p.icuEventId) { try { await deleteEvent(c, p.icuEventId); } catch { /* already gone: harmless */ } }
  const id = await sendWorkout(c, w, p.date, p.basis, profile);
  await db.planned.update(p.id, { status: 'sent', icuEventId: id });
  return id;
}

/**
 * Batch 6, A6 and A7 (23 Oct 2026): walks the plan put on the calendar in the
 * old "zone 2" band become easy walks, and runs still written as shares of max
 * heart rate get foot-table bands. Runs at every start-up, after the merge with
 * the other devices; it is idempotent (a converted session never qualifies
 * again), so a device that has already received another device's conversion
 * does nothing, and no version marker can hide a session that still needs it.
 *
 * Only sessions still to come: a workout any done session uses is history and
 * is left alone. A walk the rider added or edited is theirs and is left alone.
 * A converted session already on the Garmin is sent again, replacing the old
 * copy; without Intervals.icu credentials on this device such a session waits
 * for a device that has them. If the re-send fails, the session goes back to
 * unsent so the Calendar's "Send N to Garmin" picks it up.
 */
export async function retargetFootSessions(c: IntervalsCredentials | null): Promise<{ walks: number; runs: number; resent: number; failed: number }> {
  const out = { walks: 0, runs: 0, resent: 0, failed: 0 };
  const profile = await db.profile.get('me');
  const planned = await db.planned.toArray();
  const t = today();
  const usedByDone = new Set(planned.filter((p) => p.status === 'completed').map((p) => p.workoutId));
  const workouts = new Map((await db.workouts.toArray()).map((w) => [w.id, w]));
  const byWorkout = new Map<string, PlannedWorkout[]>();
  for (const p of planned) if (p.status !== 'completed' && p.date >= t) byWorkout.set(p.workoutId, [...(byWorkout.get(p.workoutId) ?? []), p]);
  const toResend: Array<{ p: PlannedWorkout; w: Workout }> = [];
  for (const [id, entries] of byWorkout) {
    const w = workouts.get(id);
    if (!w || usedByDone.has(id)) continue;
    if (w.kind === 'walk' && !entries.every((p) => p.planId && !p.userEdited)) continue;
    // A session on the Garmin is only converted where it can be sent again.
    if (!c && entries.some((p) => p.status === 'sent' && p.icuEventId)) continue;
    const next = retargetWorkout(w, profile ?? undefined);
    if (!next) continue;
    await db.workouts.put(next);
    if (w.kind === 'walk') out.walks += entries.length; else out.runs += entries.length;
    for (const p of entries) if (p.status === 'sent' && p.icuEventId) toResend.push({ p, w: next });
  }
  if (c) for (const { p, w } of toResend) {
    try { await sendPlanned(c, p, w, profile ?? undefined); out.resent++; }
    catch {
      try { await deleteEvent(c, p.icuEventId!); } catch { /* already gone */ }
      await db.planned.update(p.id, { status: 'planned', icuEventId: undefined });
      out.failed++;
    }
  }
  if (out.walks || out.runs) {
    await setSetting('retargetLog', { at: new Date().toISOString(), ...out });
    notify();
  }
  return out;
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

/**
 * Take a session off the calendar, after the rider confirms. Anything sent to
 * Intervals.icu (and so the Garmin) comes off there too; a completed session's
 * recording stays, only the calendar entry goes. Returns false if the rider
 * said no.
 */
/**
 * Delete one of the rider's own workouts: it comes off every calendar day it is
 * on, and each of those that was sent to the Garmin comes off Intervals.icu
 * too. Done sessions keep their recording; only the calendar entry goes. Asks first.
 */
export async function deleteWorkoutEverywhere(w: Pick<Workout, 'id' | 'name'>): Promise<boolean> {
  const entries = await db.planned.where('workoutId').equals(w.id).toArray();
  const sent = entries.filter((p) => p.icuEventId && p.status !== 'completed');
  const where = entries.length ? ` It comes off ${entries.length === 1 ? 'the calendar day it is on' : `the ${entries.length} calendar days it is on`}${sent.length ? `, and off Intervals.icu and your Garmin for the ${sent.length === 1 ? 'one' : sent.length} not yet done` : ''}.` : '';
  if (!confirm(`Delete ${w.name}?${where}`)) return false;
  const c = sent.length ? await credentials() : null;
  for (const p of sent) if (c) { try { await deleteEvent(c, p.icuEventId!); } catch { /* a stale event in Intervals.icu is harmless */ } }
  await db.planned.bulkDelete(entries.map((p) => p.id));
  await db.workouts.delete(w.id);
  notify();
  return true;
}

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

/**
 * Move a planned session to another date. A session already on the Garmin
 * comes off it and waits to be sent again; a missed one moved to today or
 * later is to do again.
 */
export async function movePlanned(p: PlannedWorkout, date: string): Promise<void> {
  if (date === p.date) return;
  const c = await credentials();
  if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* harmless */ } }
  const status = p.status === 'sent' || (p.status === 'missed' && date >= today()) ? 'planned' : p.status;
  await db.planned.put({ ...p, date, status, icuEventId: undefined, userEdited: p.planId ? true : p.userEdited, movedFrom: p.movedFrom ?? p.date });
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
  const plan = await buildPlan(data, active.goal, active.availability, active.masters, active.start, active.goalDate, active.away, await planLayout(data, active));
  const workouts = new Map(data.mine.map((w) => [w.id, w]));
  for (const p of data.planned) { const w = findWorkout(data.mine, p.workoutId); if (w) workouts.set(w.id, w); }
  const mine = data.planned.filter((p) => !p.planId || p.planId === active.id);   // this plan's sessions and hand-added ones; other plans are left alone
  const review = reviewLastWeek(mine, workouts, data.rides);
  const rejected = await rejectedSigs();
  // From today: days already gone are history (done or missed), the days left respond to them.
  const changes = diffPlan(mine, workouts, plan, today()).filter((c) => c.date <= active.goalDate && !rejected.has(changeSig(c)));
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
  // Bookkeeping, not an edit: it must not make this device's copy of the plan look newer than a
  // change (or a deletion) made on another device.
  await untracked(() => db.plans.put({ ...a, lastCheck: today() }));
}


/**
 * With the setting on and a key present, Claude reviews each batch of new
 * activities against the plan's own re-check. Nothing is applied here.
 */
export async function coachReviewAfterSync(data: AppData, newIds: string[], asked = false): Promise<{ review: CoachReview; check: Replan | null } | null> {
  const on = asked || (await getSetting<boolean>('coachAuto', false));
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
  const goal = active ? goalWords(active.goal) : 'no active plan';
  const review = await reviewAfterSync(key, {
    profile, date: today(), fitness: fitnessOn(series, today()),
    assessmentNotes: assessment.summary, goal,
    verdict: check?.plan.verdict ?? 'n/a', advice: check?.plan.advice ?? '',
    lastWeek: check?.review.lines ?? [],
    proposedChanges: check ? [...check.summary, ...check.changes.map(changeWords)] : [],
    newActivities: fresh,
    riderNotes: recentNoteLines(data.dayNotes, today(), 14),
    plan: coachPlan(active, today()),
    tomorrow: tomorrowLines(data, today()),
  });
  await setSetting('coachReview', { ...review, at: new Date().toISOString(), ids: newIds } as SavedReview);
  return { review, check };
}

const EVENT_WORDS: Record<string, string> = { century: 'a century', 'gran-fondo': 'a gran fondo', climbing: 'a climbing event', 'time-trial': 'a time trial', 'group-ride': 'a group ride', 'multi-day': 'a multi-day event', other: 'an event' };

/** The plan's goal in words, for the coach. */
export function goalWords(goal: Goal): string {
  switch (goal.kind) {
    case 'event': return `${goal.name || 'an event'} on ${goal.date} (${EVENT_WORDS[goal.eventType] ?? 'an event'}${goal.distanceKm ? `, ${Math.round(goal.distanceKm)} km` : ''})`;
    case 'ftp': return `raise FTP to ${goal.targetWatts} W in ${goal.weeks} weeks`;
    case 'vo2max': return `raise VO2max over ${goal.weeks} weeks`;
    case 'endurance': return `ride ${goal.targetHours} h comfortably within ${goal.weeks} weeks`;
    case 'weight': return `lose weight${goal.targetKg ? ` to ${goal.targetKg} kg` : ''} over ${goal.weeks} weeks`;
    default: return `general fitness over ${goal.weeks} weeks`;
  }
}

/** The plan in the coach's head: its name, goal, this week's phase and the days left. */
export function coachPlan(active: ActivePlan | null, date: string): CoachPlan | undefined {
  if (!active || date > active.goalDate) return undefined;
  const weeks = [...(active.weeks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const week = weeks.filter((w) => w.start <= date).pop();
  const days = Math.round((new Date(active.goalDate + 'T00:00:00').getTime() - new Date(date + 'T00:00:00').getTime()) / 86_400_000);
  return {
    name: active.name, goal: goalWords(active.goal),
    phase: week?.label, recoveryWeek: week?.phase === 'recovery',
    daysToGo: Math.max(0, days), eventName: active.goal.kind === 'event' ? active.goal.name || undefined : undefined,
  };
}

/** Tomorrow's sessions, one line each: what they are, not whether they are done. */
export function tomorrowLines(data: AppData, date: string): string[] {
  const next = addDays(date, 1);
  return plannedOn(data.planned, next).map((p) => { const w = findWorkout(data.mine, p.workoutId); return w ? describeSession({ planned: p, workout: w }, false).replace(/\.$/, '') : undefined; }).filter((x): x is string => !!x);
}

/** Total training load of each of the last four weeks, oldest first (this week so far last). */
export function recentWeeks(data: AppData, date: string): number[] {
  return weeklyLoad(data.rides, addDays(weekStart(date), -21), date, (d) => weekStart(d)).slice(-4).map((w) => w.total);
}

/** A proposed change in words for the coach: "2026-10-23: add Oatlands", never "added  → Oatlands". */
export function changeWords(c: Change): string {
  const what = c.note === 'added' ? `add ${c.after}` : c.note === 'removed' ? `remove ${c.before}` : `replace ${c.before} with ${c.after}${c.note && c.note !== 'changed' ? ` (${c.note})` : ''}`;
  return `${c.date}: ${what}${c.userEdited || c.userAdded ? ' [the rider changed this day by hand; offered, not pre-selected]' : ''}`;
}

/** The coach's review after a sync, kept until the rider dismisses it or a newer one replaces it. */
export type SavedReview = CoachReview & { at?: string; dismissed?: boolean; ids?: string[] };

/** Today's review, unless dismissed. */
export async function getCoachReview(): Promise<SavedReview | null> {
  const r = await getSetting<SavedReview | null>('coachReview', null);
  if (!r || r.date !== today() || r.dismissed) return null;
  // Older builds kept an unreadable reply as raw text; show it as a failed review instead.
  if (!r.failed && r.text.trim().startsWith('{')) return { ...r, text: '', failed: 'the reply could not be read', ...readVerdict(r) };
  // A review saved before 21 Oct 2026 said yes or no for all the changes; read it as all or none.
  return { ...r, ...readVerdict(r) };
}

export async function dismissCoachReview(): Promise<void> {
  const r = await getSetting<SavedReview | null>('coachReview', null);
  if (r) await setSetting('coachReview', { ...r, dismissed: true });
}

/** One suggested change, exactly: the same swap on the same day is the same suggestion. */
export const changeSig = (c: Change) => `${c.date}|${c.kind}|${c.before ?? ''}>${c.after ?? ''}`;

/** Suggestions the rider turned down; each is forgotten once its day has passed. */
async function rejectedSigs(): Promise<Set<string>> {
  const t = today();
  return new Set((await getSetting<string[]>('replanRejected', [])).filter((s) => s.slice(0, 10) >= t));
}

/** Turn suggestions down: they disappear and are not offered again. A different suggestion for the same day still can be. */
export async function rejectChanges(changes: Change[]): Promise<void> {
  const keep = [...(await rejectedSigs())];
  await setSetting('replanRejected', [...new Set([...keep, ...changes.map(changeSig)])]);
}

/** The rider's day notes from the last `days` days, newest first, one line each, for the coach. */
export function recentNoteLines(notes: { date: string; text?: string; badWellness?: boolean }[], date: string, days: number): string[] {
  const from = addDays(date, -days);
  return notes
    .filter((n) => n.date >= from && n.date <= date && (n.text || n.badWellness))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((n) => `${n.date}: ${[n.text, n.badWellness ? 'wellness for this day set aside as wrong' : ''].filter(Boolean).join(' — ')}`);
}

/** The calendar as it is now in storage, for a re-check right after the plan changed (the screen's copy updates a moment later). */
export async function freshData(data: AppData): Promise<AppData> {
  const [planned, mine] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]);
  return { ...data, planned, mine };
}

/** The planned load of one workout: a ride from its steps, anything else from its estimate. */
export function plannedTss(w: Workout): number {
  return w.kind === 'ride' ? workoutStats(w.blocks).tss : w.estimatedTss ?? 0;
}
