import { rideLadders } from '../engine/zones';
import { db, getSetting, setSetting, untracked } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { activityLine, describeSession, durationWords, readVerdict, reviewAfterSync, type CoachPlan, type CoachReview } from '../coach/claude';
import { workoutStats } from '../engine/workout';
import { diffPlan, reviewLastWeek, splitByHorizon, summarize, type Change, type Replan } from '../engine/adapt';
import type { Goal } from '../engine/goals';
import type { SessionType } from '../engine/generate';
import { addDays, rideIntensity, today } from '../engine/load';
import { generatePlan, type Availability, type AwayRange, type Plan, type Phase as PlanPhase, type QualityScores } from '../engine/planner';
import { weeklyLoad } from '../engine/progress';
import type { Basis, Equipment, Fitness, PlannedWorkout, Profile, StrengthDose, StrengthQuality, Workout } from '../engine/types';
import { pickStrength, strengthReason } from '../engine/shop';
import { newId } from '../engine/workout';
import { retargetWorkout } from '../engine/sessions';
import { sameWithin, snap } from '../engine/snap';
import { deleteEvent, sendWorkout, type HrProfile, type IntervalsCredentials } from '../sync/intervals';
import { autoBackup } from '../data/backup';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, fmtDate, plannedOn, weekStart } from './derived';
import type { AppData } from './store';
import { alreadyOnDay, findWorkout, getCurrentEquipment, loadAppData, notify, readyMade } from './store';

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
  /** What decided the quality sessions when the plan was made; a re-check keeps them unless these move (Batch 6, C3). Plans made before have none until their first re-check. */
  qualityScores?: QualityScores;
}

type PlanRequestKeep = { scores: QualityScores; byWeek: Record<string, SessionType[]> };
const QUALITY_FAMILIES = new Set(['sweetspot', 'tempo', 'threshold', 'vo2max', 'anaerobic']);

export interface PlanWeekSummary { start: string; phase: PlanPhase; label: string; tss: number; /** The week in one sentence, as the plan built it (30 Oct 2026). */ summary?: string }

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

export async function buildPlan(data: AppData, goal: Goal, availability: Availability, masters: boolean, startDate?: string, endDate?: string, away?: AwayRange[], layout?: Array<{ start: string; phase: PlanPhase }>, keepQuality?: PlanRequestKeep): Promise<Plan> {
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
    // A ride added by hand today (an extra workout on the trainer, say) is not in the plan, so it counts as extra load.
    const doneToday = new Set(data.planned.filter((p) => p.date === t && p.status === 'completed' && p.planId).map((p) => p.activityId));
    const done = data.rides.filter((r) => r.date >= wk && (r.date < t || (r.date === t && !doneToday.has(r.id))))
      .map((r) => ({ date: r.date, tss: r.tss ?? 0, seconds: r.seconds, intensity: rideIntensity(r, profile.lthr, rideLadders(profile)), kind: r.sport }));
    return generatePlan({ start: layout[0].start, notBefore: t, goal, availability, basis: profile.basis, masters, profile, assessment, longRideKmh, away, layout, done, ownWorkouts: ownWorkouts(data.mine), keepQuality, recentPicks: recentPicks(data, t) });
  }
  return generatePlan({ start, notBefore, goal: g, availability, basis: profile.basis, masters, profile, assessment, longRideKmh, away, ownWorkouts: ownWorkouts(data.mine), recentPicks: recentPicks(data, notBefore) });
}

/** What was on the calendar in the three weeks before a date, as Library ids, so the plan does not repeat it straight away. */
function recentPicks(data: AppData, before: string): Array<{ date: string; id: string }> {
  const from = addDays(before, -21);
  const out: Array<{ date: string; id: string }> = [];
  for (const p of data.planned) {
    if (p.date >= before || p.date < from) continue;
    const w = findWorkout(data.mine, p.workoutId);
    if (w) out.push({ date: p.date, id: w.libraryId ?? w.id });
  }
  return out;
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
    if (existing.has(k) && !keep.has(k)) {
      keep.set(k, true); kept++;
      const p = existing.get(k)!;
      if (p.reason !== item.s.reason) await db.planned.update(p.id, { reason: item.s.reason });   // the same session, kept: its reason follows the plan
    }
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
  const rows: PlannedWorkout[] = [];
  for (const x of toAdd) rows.push({ id: newId(), date: x.s.date, workoutId: await storeSessionWorkout(x.s.workout), basis: profile.basis, status: 'planned' as const, note: x.label, planId, planName: name, reason: x.s.reason });
  await db.planned.bulkAdd(rows);
  added = toAdd.length;
  await pruneOrphanWorkouts();
  const newWeeks: PlanWeekSummary[] = plan.weeks.map((w) => ({ start: w.start, phase: w.phase, label: w.label, tss: Math.round(w.tss), ...(w.summary ? { summary: w.summary.replace(/^Week \d+: /, '') } : {}) }));
  const weeks = [...(existingPlan?.weeks ?? []).filter((w) => w.start < (newWeeks[0]?.start ?? '9999')), ...newWeeks];
  const active: ActivePlan = { id: planId, name, goal, availability, masters, away: opts.away ?? existingPlan?.away, start: existingPlan?.start ?? planStart, goalDate: plan.goalDate, requiredCtl: plan.requiredCtl, projection: mergeProjection(existingPlan?.projection, plan.projection), appliedAt: new Date().toISOString(), lastCheck: from, weeks, qualityScores: existingPlan?.qualityScores ?? plan.qualityScores };
  await putPlan(active);
  notify();
  if (c) autoBackup(c, true);
  return { added, removed, kept };
}

/** The rider's own saved workouts, offered to the planner alongside the Library; never the entries Part B created (B2.6 retires them). */
export const ownWorkouts = (all: Workout[]) => all.filter((w) => w.source === 'mine' && !isCreatedByPlan(w));
/** A workout Part B (23 Oct 2026) added to the Library for a plan, before B2 stopped plans creating workouts. */
const isCreatedByPlan = (w: Workout) => w.id.startsWith('lib-gen-');

/**
 * Batch 6, B4 and B2 (23 Oct 2026): sessions a plan put on the calendar before
 * plans were built from the Library are generated ("Long Endurance 3:00",
 * "Easy walk 30 min with a 22 lb pack"). Each is pointed at its nearest Library
 * workout, the one the plan now picks, so the calendar carries names from day
 * one and the first re-check finds nothing to change. Only sessions still to
 * come, made by a plan and not edited or moved by the rider; strength is
 * built by the plan and stays. A session already on the Garmin is re-pointed
 * only when the Library workout is still the same session by the re-check's
 * rule (so the watch's copy still matches); otherwise it stays, and the
 * re-check offers the change, which re-sends it when accepted. Runs at start-up
 * after the walk re-target (A6); idempotent.
 */
export async function nameRideSessions(): Promise<number> {
  const t = today();
  const planned = (await db.planned.toArray()).filter((p) => p.planId && !p.userEdited && !p.movedFrom && p.status !== 'completed' && p.date >= t);
  if (!planned.length) return 0;
  const workouts = await db.workouts.toArray();
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const own = ownWorkouts(workouts);
  const equipment = (await getSetting<{ availability?: { equipment?: Equipment[] } } | null>('planRequest', null))?.availability?.equipment;
  let n = 0;
  for (const p of planned) {
    const w = byId.get(p.workoutId);
    if (!w || w.source !== 'generated' || w.kind === 'strength') continue;
    const lib = snap(w, { basis: p.basis, extra: own, equipment });
    if (!lib) continue;
    if (w.kind !== 'ride' && lib.name === w.name) continue;                      // already the Library's session, as its own copy
    if (p.status === 'sent' && !sameWithin(w, lib)) continue;                     // the watch's copy would no longer match
    await db.planned.update(p.id, { workoutId: await storeSessionWorkout(lib) });
    n++;
  }
  if (n) { await pruneOrphanWorkouts(); notify(); }
  return n;
}

/**
 * Batch 6, B2.6: Part B briefly let a plan add a workout to the Library when
 * nothing there was close enough (ids "lib-gen-…"). B2 stopped that. Every
 * session still to come that uses one is pointed at its nearest Library
 * workout, and an entry no calendar entry uses any more is deleted. A done
 * session keeps what it was planned against (its record and verdict depend on
 * it), so an entry a done session uses is kept. Sent copies on the Garmin are
 * left alone. Idempotent.
 */
export async function retireCreatedWorkouts(): Promise<number> {
  const workouts = await db.workouts.toArray();
  const created = workouts.filter(isCreatedByPlan);
  if (!created.length) return 0;
  const own = ownWorkouts(workouts);
  const byId = new Map(created.map((w) => [w.id, w]));
  const planned = await db.planned.toArray();
  const equipment = (await getSetting<{ availability?: { equipment?: Equipment[] } } | null>('planRequest', null))?.availability?.equipment;
  let n = 0;
  for (const p of planned) {
    const w = byId.get(p.workoutId);
    if (!w || p.status === 'completed') continue;
    const lib = snap(w, { basis: p.basis, extra: own, equipment });
    if (!lib) continue;
    await db.planned.update(p.id, { workoutId: await storeSessionWorkout(lib) });
    n++;
  }
  const used = new Set((await db.planned.toArray()).map((p) => p.workoutId));
  const unused = created.filter((w) => !used.has(w.id)).map((w) => w.id);
  if (unused.length) await db.workouts.bulkDelete(unused);
  if (n || unused.length) notify();
  return n;
}

/**
 * Where a plan session's workout lives: a Library ride and the rider's own
 * workouts are used by id, never copied; a ready-made walk, run or mobility
 * routine is stored as its own copy (as when it is added by hand, so the entry
 * keeps what was chosen if the equipment changes); strength, and a ride with no
 * Library candidate at all (B2.3), are stored as generated. Nothing is ever
 * added to the Library (Batch 6, B2).
 */
export async function storeSessionWorkout(w: Workout): Promise<string> {
  if (w.source === 'mine' || (w.source === 'library' && w.kind === 'ride')) return w.id;
  if (w.source === 'library') { const id = `gen-${newId()}`; await db.workouts.put({ ...w, id, source: 'generated', libraryId: w.libraryId ?? w.id }); return id; }
  await db.workouts.put(w);
  return w.id;
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
export async function replacePlanned(p: PlannedWorkout, w: Workout, basis: Basis): Promise<'replaced' | 'already'> {
  // Replacing with a workout that is already another entry on that day would make a duplicate (Batch 10 B).
  if (await alreadyOnDay(w, p.date, p.id)) return 'already';
  const c = await credentials();
  if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* harmless */ } }
  let workoutId = w.id;
  if (w.source === 'library' && w.kind !== 'ride') { workoutId = `gen-${newId()}`; await db.workouts.put({ ...w, id: workoutId, source: 'generated', libraryId: w.libraryId ?? w.id }); }
  await db.planned.put({ ...p, workoutId, basis: w.bases.includes(basis) ? basis : w.bases[0], status: 'planned', icuEventId: undefined, activityId: undefined, userEdited: p.planId ? true : p.userEdited });
  await pruneOrphanWorkouts();
  notify();
  return 'replaced';
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
  const layout = await planLayout(data, active);
  const workouts = new Map(data.mine.map((w) => [w.id, w]));
  for (const p of data.planned) { const w = findWorkout(data.mine, p.workoutId); if (w) workouts.set(w.id, w); }
  // Batch 6, C3: the quality sessions already on the calendar, by plan week, and the scores they were chosen with.
  // A plan made before the scores were kept gets them now, from today's data, so from here on it holds steady.
  const byWeek: Record<string, SessionType[]> = {};
  for (const p of data.planned) {
    if (p.planId !== active.id || p.status === 'completed' || p.date < today()) continue;
    const w = workouts.get(p.workoutId);
    if (!w || w.kind !== 'ride' || !QUALITY_FAMILIES.has(w.family)) continue;
    const wk = layout.find((l) => p.date >= l.start && p.date < addDays(l.start, 7))?.start;
    if (wk) (byWeek[wk] ??= []).push(w.family as SessionType);
  }
  let scores = active.qualityScores;
  if (!scores) {
    scores = (await buildPlan(data, active.goal, active.availability, active.masters, active.start, active.goalDate, active.away, layout)).qualityScores;
    await putPlan({ ...active, qualityScores: scores });
  }
  const plan = await buildPlan(data, active.goal, active.availability, active.masters, active.start, active.goalDate, active.away, layout, { scores, byWeek });
  const mine = data.planned.filter((p) => !p.planId || p.planId === active.id);   // this plan's sessions and hand-added ones; other plans are left alone
  const review = reviewLastWeek(mine, workouts, data.rides);
  const rejected = await rejectedSigs();
  // From today: days already gone are history (done or missed), the days left respond to them.
  const all = diffPlan(mine, workouts, plan, today()).filter((c) => c.date <= active.goalDate && !rejected.has(changeSig(c)));
  const series = fitnessFromRides(data.rides);
  const fitnessNow = fitnessOn(series, today())?.ctl ?? 0;
  const fitnessPlanned = active.projection?.find((f) => f.date === today())?.ctl;
  // Batch 6, C2: the next two weeks' changes, and later ones only with a cause; the rest wait their turn.
  const { now: changes, later } = splitByHorizon(all, review, fitnessNow, fitnessPlanned, today());
  // The longest ride on the calendar from today, so "the longest planned is now …" is said only when it changes.
  const calendarLongest = Math.max(0, ...mine.filter((p) => p.date >= today() && p.status !== 'completed').map((p) => workouts.get(p.workoutId)).filter((w): w is Workout => !!w && w.kind === 'ride').map((w) => workoutStats(w.blocks).seconds));
  const summary = summarize(review, changes, plan, fitnessNow, fitnessPlanned, active.projection, calendarLongest);
  return { review, plan, changes, later, summary, fitnessNow, fitnessPlanned };
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
    why: check?.summary ?? [],
    proposedChanges: check ? check.changes.map(changeWords) : [],
    newActivities: fresh,
    riderNotes: recentNoteLines(data.dayNotes, today(), 14),
    plan: coachPlan(active, today()),
    tomorrow: tomorrowLines(data, today()),
  });
  const saved = { ...review, at: new Date().toISOString(), ids: newIds, changesSig: check ? changesSigOf(check.changes) : '' } as SavedReview;
  await setSetting('coachReview', saved);
  // Batch 7, A4: its verdicts on the plan's changes decide the recommended list too, with no second call.
  if (check?.changes.length && !review.failed && review.verdicts?.length) await setSetting(RECHECK_KEY, saved);
  return { review, check };
}

/** The proposals a review judged, as one string: a review whose signature differs from the rows on screen judged other rows. */
export const changesSigOf = (changes: Change[]) => changes.map(changeSig).sort().join(';');

/**
 * Batch 6, C6: the plan re-checked itself and proposes changes the coach has
 * not seen. With the coach on (Settings) and a key present, Claude gives its
 * view of each, once per set of changes (a failure is not retried for the same
 * set until the app starts again). Nothing is applied here.
 */
export function coachReviewRecheck(data: AppData, check: Replan): Promise<CoachReview | null> {
  // One request per set of changes: a screen that asks again while the first is in flight waits for the same answer.
  const sig = changesSigOf(check.changes);
  const inFlight = recheckInFlight.get(sig);
  if (inFlight) return inFlight;
  const p = askRecheck(data, check).finally(() => recheckInFlight.delete(sig));
  recheckInFlight.set(sig, p);
  return p;
}
const recheckInFlight = new Map<string, Promise<CoachReview | null>>();

async function askRecheck(data: AppData, check: Replan): Promise<CoachReview | null> {
  if (!check.changes.length) return null;
  const on = await getSetting<boolean>('coachAuto', false);
  const key = await getSetting<string>('claudeKey', '');
  if (!on || !key) return null;
  const sig = changesSigOf(check.changes);
  const saved = await getSetting<SavedReview | null>(RECHECK_KEY, null);
  if (saved && !saved.failed && judgedAll(check.changes, saved)) return null;
  if (recheckAsked.has(sig)) return null;
  recheckAsked.add(sig);
  const profile = data.profile as Profile;
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const active = await getActivePlan();
  const series = fitnessFromRides(data.rides);
  const review = await reviewAfterSync(key, {
    profile, date: today(), fitness: fitnessOn(series, today()),
    assessmentNotes: assessment.summary, goal: active ? goalWords(active.goal) : 'no active plan',
    verdict: check.plan.verdict, advice: check.plan.advice,
    lastWeek: check.review.lines, why: check.summary,
    proposedChanges: check.changes.map(changeWords),
    newActivities: [],
    riderNotes: recentNoteLines(data.dayNotes, today(), 14),
    plan: coachPlan(active, today()),
    tomorrow: tomorrowLines(data, today()),
  }, 'recheck');
  // A failed re-check review is not kept: the rows simply show no coach view, and the next start asks again.
  if (review.failed) return null;
  await setSetting(RECHECK_KEY, { ...review, at: new Date().toISOString(), ids: [], changesSig: sig } as SavedReview);
  return review;
}
const recheckAsked = new Set<string>();

/**
 * Batch 7, A4: the coach's verdicts on the plan's changes are kept apart from
 * its review of synced activities (`coachReview`, shown on the coach card), so
 * one never hides the other. Local to this device.
 */
export const RECHECK_KEY = 'coachRecheck';

/** Whether the coach is reviewing plan changes on this device: the switch on and a key present. */
export async function coachIsOn(): Promise<boolean> {
  return !!(await getSetting<boolean>('coachAuto', false)) && !!(await getSetting<string>('claudeKey', '')).trim();
}

/** The coach's saved verdicts on the plan's changes, if any. */
export async function getRecheckReview(): Promise<SavedReview | null> {
  const r = await getSetting<SavedReview | null>(RECHECK_KEY, null);
  return r ? { ...r, ...readVerdict(r) } : null;
}

/** Whether a review judged every one of these changes (each is in the set it was shown, and has a verdict). */
function judgedAll(changes: Change[], review: SavedReview): boolean {
  const judged = new Set((review.changesSig ?? '').split(';').filter(Boolean));
  return changes.every((c) => judged.has(changeSig(c)) && !!review.verdicts?.some((v) => v.date === c.date && v.kind === c.kind));
}

export interface Recommended {
  changes: Change[];
  /** The coach's few words on each recommended change, by its signature. Empty when the list is the app's own. */
  reasons: Map<string, string>;
  status: 'ready' | 'waiting';
  /** True when the coach chose the list; then `reason` is its one sentence on the changes. */
  byCoach: boolean;
  reason?: string;
}

/**
 * Batch 7, A1: what the rider is shown, in one voice. With the coach off, the
 * plan's own changes. With the coach on and its verdicts covering every change
 * on screen, only the ones it would apply, each with its reason; the ones it set
 * aside are not returned anywhere. With the coach on and no such verdicts yet,
 * "waiting": the caller holds the list behind "Checking your plan…".
 */
export function recommendedChanges(check: Replan, review: SavedReview | null, coachOn: boolean): Recommended {
  if (!coachOn) return { changes: check.changes, reasons: new Map(), status: 'ready', byCoach: false };
  if (!check.changes.length) return { changes: [], reasons: new Map(), status: 'ready', byCoach: true };
  if (!review || review.failed || !review.verdicts?.length || !judgedAll(check.changes, review)) return { changes: [], reasons: new Map(), status: 'waiting', byCoach: true };
  const reasons = new Map<string, string>();
  const changes = check.changes.filter((c) => {
    const v = review.verdicts!.find((x) => x.date === c.date && x.kind === c.kind);
    if (v?.apply) reasons.set(changeSig(c), v.why);
    return !!v?.apply;
  });
  return { changes, reasons, status: 'ready', byCoach: true, reason: review.reason || undefined };
}

/** The app's own list, when the coach did not answer in time: same heading, no coach in it. */
export const ownRecommendation = (check: Replan): Recommended => ({ changes: check.changes, reasons: new Map(), status: 'ready', byCoach: false });

/** How long the list waits for the coach before showing the app's own (Batch 7, A2). */
export const COACH_WAIT_MS = 10_000;

/** A promise, or null after `ms`: the coach's answer, or nothing if it takes too long. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/**
 * Batch 7, A2: the recommended list for a re-check, waiting for the coach when
 * it is on and has not judged these changes, up to COACH_WAIT_MS; then the
 * app's own list, with no error. `onWaiting` is called when the wait starts, so
 * the screen can show "Checking your plan…". An answer that comes after the
 * wait is saved and used next time.
 */
export async function recommendFor(data: AppData, check: Replan, onWaiting?: () => void, noWait = false, waitMs = COACH_WAIT_MS): Promise<Recommended & { fellBack?: boolean }> {
  const on = await coachIsOn();
  const first = recommendedChanges(check, await getRecheckReview(), on);
  if (first.status === 'ready') return first;
  if (noWait) return { ...ownRecommendation(check), fellBack: true };
  onWaiting?.();
  await withTimeout(coachReviewRecheck(data, check), waitMs);
  const after = recommendedChanges(check, await getRecheckReview(), on);
  return after.status === 'ready' ? after : { ...ownRecommendation(check), fellBack: true };
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

/** A proposed change in words for the coach: "2026-10-23 ride: add Oatlands", never "added  → Oatlands". The date and kind key the coach's verdict. */
export function changeWords(c: Change): string {
  const b = `${c.before}${c.beforeSub ? ` (${c.beforeSub})` : ''}`, a = `${c.after}${c.afterSub ? ` (${c.afterSub})` : ''}`;
  const what = c.note === 'moved' ? `move ${a} here from ${c.movedFrom}${c.before !== c.after ? ` (it was ${b} there)` : ''}` : c.note === 'added' ? `add ${a}` : c.note === 'removed' ? `remove ${b}` : `replace ${b} with ${a}${c.note && c.note !== 'changed' ? ` (${c.note})` : ''}`;
  return `${c.date} ${c.kind}: ${what}${c.userEdited || c.userAdded ? ' [the rider changed this day by hand; offered, not pre-selected]' : ''}`;
}

/** The coach's review after a sync, kept until the rider dismisses it or a newer one replaces it. */
export type SavedReview = CoachReview & { at?: string; dismissed?: boolean; ids?: string[] };

/** Today's review, unless dismissed. */
export async function getCoachReview(): Promise<SavedReview | null> {
  const r = await getSetting<SavedReview | null>('coachReview', null);
  // Batch 7, A4: the card shows only the review of synced activities; the coach's view of plan changes lives with the list.
  if (!r || r.date !== today() || r.dismissed || r.mode === 'recheck') return null;
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

/** A strength session the planner built before 30 Oct 2026 ("Strength A: legs and trunk"), or one of the Library's old level copies ("Build B: …"). */
const OLD_STRENGTH = /^(Strength|Foundation|Build|Maintain|Light) ([AB]): /;

/** The level an old strength session was built at, from its name or its first exercise's sets and reps. */
function oldDose(w: Workout): StrengthDose {
  const m = OLD_STRENGTH.exec(w.name);
  const word = m?.[1].toLowerCase();
  if (word && word !== 'strength') return word as StrengthDose;
  const e = (w.exercises ?? []).find((x) => x.sets && x.reps);
  if (!e) return 'maintain';
  if (e.sets! >= 4) return 'build';
  if (e.sets === 3) return 'foundation';
  return /10/.test(e.reps ?? '') ? 'light' : 'maintain';
}

export interface LibraryMove { date: string; from: string; to: string; sent: boolean }

/**
 * 30 Oct 2026 (the plan engine, 2D): strength sessions a plan put on the calendar before plans were built
 * from the Library ("Strength A: legs and trunk") are replaced by the Library session the plan would pick
 * for that week: the same focus (A legs, B upper body) and level, of the quality the week asks for. Date,
 * plan and sent status are kept; a session already on the Garmin is sent again, replacing the old copy
 * (without Intervals.icu credentials on this device such a session waits for a device that has them).
 * Done sessions and sessions added by hand are left alone. Idempotent: a replaced session carries its
 * Library id and never qualifies again. `dryRun` lists what would change and changes nothing.
 */
export async function moveSessionsToLibrary(opts: { dryRun?: boolean } = {}): Promise<{ moves: LibraryMove[]; resent: number; failed: number }> {
  const out = { moves: [] as LibraryMove[], resent: 0, failed: 0 };
  const t = today();
  const planned = (await db.planned.toArray()).filter((p) => p.planId && p.status !== 'completed' && p.date >= t);
  if (!planned.length) return out;
  const workouts = new Map((await db.workouts.toArray()).map((w) => [w.id, w]));
  const old = planned.filter((p) => { const w = workouts.get(p.workoutId); return !!w && w.kind === 'strength' && !w.libraryId && !w.strength && OLD_STRENGTH.test(w.name); });
  if (!old.length) return out;
  const c = await credentials();
  const data = await loadAppData();
  const plans = await getPlans();
  // The quality each week asks for, from the plan as it would be built today; heavy when it cannot be worked out.
  const qualityOf = new Map<string, StrengthQuality>();
  for (const plan of plans) {
    try {
      const layout = await planLayout(data, plan);
      const built = await buildPlan(data, plan.goal, plan.availability, plan.masters, plan.start, plan.goalDate, plan.away, layout);
      for (const w of built.weeks) if (w.needs) qualityOf.set(`${plan.id}|${w.start}`, w.needs.strength.quality);
    } catch { /* heavy, below */ }
  }
  const equipmentOf = (planId: string) => plans.find((x) => x.id === planId)?.availability.equipment ?? getCurrentEquipment();
  const usedInWeek = new Map<string, Set<string>>();
  for (const p of old.sort((a, b) => a.date.localeCompare(b.date))) {
    const w = workouts.get(p.workoutId)!;
    if (p.status === 'sent' && p.icuEventId && !c) continue;   // waits for a device that can send it again
    const ws = weekStart(p.date);
    const focus = OLD_STRENGTH.exec(w.name)?.[2] === 'B' ? 'upper' : 'legs';
    const dose = oldDose(w);
    const quality = qualityOf.get(`${p.planId}|${ws}`) ?? 'heavy';
    const eq = equipmentOf(p.planId!);
    const avoid = usedInWeek.get(ws) ?? new Set<string>();
    const lib = pickStrength(readyMade(eq).filter((x) => x.kind === 'strength' && x.strength), eq, quality, focus, dose, avoid);
    if (!lib) continue;
    avoid.add(lib.id); usedInWeek.set(ws, avoid);
    out.moves.push({ date: p.date, from: w.name, to: `${lib.name} (${lib.subtitle ?? ''})`, sent: p.status === 'sent' });
    if (opts.dryRun) continue;
    const reason = strengthReason(lib.strength!.quality, lib.strength!.focus, dose);
    const workoutId = await storeSessionWorkout(lib);
    await db.planned.update(p.id, { workoutId, reason });
    if (p.status === 'sent' && p.icuEventId && c) {
      const profile = await db.profile.get('me');
      try { await sendPlanned(c, { ...p, workoutId }, (await db.workouts.get(workoutId))!, profile ?? undefined); out.resent++; }
      catch {
        try { await deleteEvent(c, p.icuEventId); } catch { /* already gone */ }
        await db.planned.update(p.id, { status: 'planned', icuEventId: undefined });
        out.failed++;
      }
    }
  }
  if (!opts.dryRun && out.moves.length) {
    await pruneOrphanWorkouts();
    await setSetting('libraryMoveLog', { at: new Date().toISOString(), ...out });
    notify();
  }
  return out;
}

/** A reason for a ride from what it is, for a calendar entry the plan's rebuild does not match by name. */
function rideReason(w: Workout, longest: boolean): string | undefined {
  const m = Math.round(workoutStats(w.blocks).seconds / 60);
  switch (w.family) {
    case 'endurance': return longest && m >= 90 ? 'The long ride: steady zone 2, fuel from the first half hour.' : 'Easy riding: zone 2, the quiet work that makes everything else possible.';
    case 'recovery': return /openers/i.test(`${w.name} ${w.subtitle ?? ''}`) ? 'Openers: short efforts that wake the legs without adding fatigue.' : 'An easy spin: blood through the legs, nothing more.';
    case 'tempo': return 'Tempo: brisk but sustainable, the pace of a strong group ride.';
    case 'sweetspot': return 'Sweet spot: just under FTP, the most fitness per minute.';
    case 'threshold': return 'Threshold work: efforts at FTP, which raise it directly.';
    case 'vo2max': return 'VO2max work: hard efforts above FTP that lift the ceiling.';
    case 'anaerobic': return 'Short, sharp efforts well above FTP: the power to attack and bridge.';
    case 'test': return 'A test: it sets the numbers every target is built on.';
    default: return undefined;
  }
}

/**
 * 30 Oct 2026: plans placed before reasons were stored have none on their sessions. Once, each session
 * still to come gets the reason the plan gives it today when the plan, rebuilt, has the same session that
 * day; a ride it doesn't match gets a sentence from what the ride is. Sessions that already have a reason
 * are left alone.
 */
export async function fillPlanReasons(): Promise<number> {
  if (await getSetting<boolean>('planReasonsFilled', false)) return 0;
  const t = today();
  const plans = await getPlans();
  const planned = (await db.planned.toArray()).filter((p) => p.planId && !p.reason && p.status !== 'completed' && p.date >= t);
  if (!planned.length || !plans.length) { await setSetting('planReasonsFilled', true); return 0; }
  const data = await loadAppData();
  let n = 0;
  for (const plan of plans) {
    const mine = planned.filter((p) => p.planId === plan.id);
    if (!mine.length) continue;
    const reasons = new Map<string, string>();
    try {
      const layout = await planLayout(data, plan);
      const built = await buildPlan(data, plan.goal, plan.availability, plan.masters, plan.start, plan.goalDate, plan.away, layout);
      for (const w of built.weeks) for (const s of w.sessions) reasons.set(`${s.date}|${s.workout.libraryId ?? s.workout.id}`, s.reason);
    } catch { /* fall back to the ride's own sentence below */ }
    for (const p of mine) {
      const w = findWorkout(data.mine, p.workoutId);
      if (!w) continue;
      let reason = reasons.get(`${p.date}|${w.libraryId ?? w.id}`);
      if (!reason && w.kind === 'ride') {
        const week = data.planned.filter((x) => weekStart(x.date) === weekStart(p.date)).map((x) => findWorkout(data.mine, x.workoutId)).filter((x): x is Workout => x?.kind === 'ride');
        const longest = Math.max(...week.map((x) => workoutStats(x.blocks).seconds));
        reason = rideReason(w, workoutStats(w.blocks).seconds >= longest);
      }
      if (reason) { await db.planned.update(p.id, { reason }); n++; }
    }
  }
  await setSetting('planReasonsFilled', true);
  if (n) notify();
  return n;
}
