import { coachConfig, noteModelResult } from './coachConfig';
import type { CoachConfig } from '../coach/llm';
import { db, getSetting, setSetting } from '../data/db';
import { assess, type PowerCurve } from '../engine/assessment';
import { addDays, today } from '../engine/load';
import { contribution } from '../engine/contribution';
import { changeKeys, type Change, type Replan } from '../engine/adapt';
import type { PlanWeek } from '../engine/planner';
import type { PlannedWorkout, Profile, SessionKind, Workout } from '../engine/types';
import { newId } from '../engine/workout';
import { hrVsNormal, minutesWords, readWords, type ActivityRead } from '../engine/reads';
import { activityLine, driverWords, judgeDay, riderLine } from '../coach/claude';
import { buildPacket, type PacketDay, type PacketGroup, type PacketInput, type PacketOption, type PacketSession } from '../coach/packet';
import { ceilingsFrom, checkChanges, judgeSig, kindAllowed, plainWords, toChange, type CheckContext, type CheckSession, type CheckWorkout, type Judgment, type ResolvedChange } from '../coach/judge';
import { deleteEvent } from '../sync/intervals';
import { credentials } from '../sync/syncService';
import { fitnessFromRides, fitnessOn, loadRatio, readinessToday, weekStart } from './derived';
import { readsContext } from './reads';
import { allWorkouts, findWorkout, notify, type AppData } from './store';
import { judgeTheDay, type DayJudgeInput, type DayJudgment, type DayOption, type DaySession } from '../engine/dayJudge';
import { ownRecommendation } from './planService';
import { applyPlan, changeSig, changeWords, getActivePlan, goalWords, movePlanned, pruneOrphanWorkouts, recentNoteLines, rejectedSigs, replan, replacePlanned, storeSessionWorkout, withTimeout, type ActivePlan, type Recommended } from './planService';

/**
 * The re-check thinks (1 Nov 2026), Part C: the coach's judgment of the day.
 * With a key, one call judges from the evidence packet; the result is kept as
 * `coachJudgment` (it travels in the sync note, so every device shows it; only
 * a device with a key can ask for a new one). It is asked for again only when
 * what it was made from changes: the date, the morning's numbers, the
 * activities of the last 14 days, the calendar from today to 14 days ahead, or
 * the rider's notes. Check again asks regardless.
 */
export const JUDGMENT_KEY = 'coachJudgment';
/** How far ahead the coach may change the calendar. */
export const HORIZON = 14;
/** How long the screen waits for the coach's judgment before showing the app's own list. The judge thinks first, so longer than a note. */
export const JUDGE_WAIT_MS = 90_000;

const KIND_ORDER: SessionKind[] = ['ride', 'strength', 'mobility', 'walk', 'run'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dowOf = (date: string) => new Date(date + 'T00:00:00').getDay();
const dayWords = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/** What a workout is for the duplicate check: its Library entry when it is a copy. */
const keyOf = (w: Workout) => w.libraryId ?? w.id;

// ---- the evidence ------------------------------------------------------------

export interface JudgeInputs {
  packet: PacketInput;
  check: CheckContext;
  sig: string;
  active: ActivePlan | null;
}

/** The parts the coach is asked again on. */
export function signatureOf(data: AppData, date = today()): string {
  const from = addDays(date, -14), to = addDays(date, HORIZON);
  const wellnessDate = data.wellness.map((w) => w.date).filter((d) => d <= date).sort().pop();
  return judgeSig({
    date, wellnessDate,
    activities: data.rides.filter((r) => r.date > from && r.date <= date).map((r) => `${r.id}:${Math.round(r.tss ?? 0)}:${r.sport}`),
    calendar: data.planned.filter((p) => p.date >= date && p.date <= to).map((p) => `${p.id}:${p.workoutId}:${p.date}:${p.status}`),
    notes: recentNoteLines(data.dayNotes, date, 14),
  });
}

/**
 * Whether to wait for this morning's numbers before judging: the rider usually
 * has them (3 of the last 7 mornings), today's have not arrived, today's were not
 * set aside, and it is still morning. A rider without a watch is never waited for.
 */
export function waitForMorning(data: AppData, date = today(), hour = new Date().getHours()): boolean {
  if (hour >= 11) return false;
  if (data.wellness.some((w) => w.date === date)) return false;
  if (data.dayNotes.some((n) => n.date === date && n.badWellness)) return false;
  let n = 0;
  for (let i = 1; i <= 7; i++) if (data.wellness.some((w) => w.date === addDays(date, -i))) n++;
  return n >= 3;
}

function minutesOf(w: Workout): number { return Math.round(contribution(w).minutes); }
function tssOf(w: Workout): number | undefined { const t = contribution(w).tss; return t ? Math.round(t) : undefined; }

function needsWords(w: PlanWeek | undefined): string | undefined {
  const n = w?.needs;
  if (!n) return undefined;
  const parts = [`about ${Math.round(n.budgetTss)} TSS in ${n.budgetHours.toFixed(1)} h`];
  if (n.hardSessions) parts.push(`${n.hardSessions} hard ride day${n.hardSessions === 1 ? '' : 's'}`);
  if (n.longRideSeconds) parts.push(`a long ride of ${(n.longRideSeconds / 3600).toFixed(1)} h${n.secondLongRideSeconds ? ` and a second of ${(n.secondLongRideSeconds / 3600).toFixed(1)} h` : ''}`);
  if (n.test) parts.push('a test');
  if (n.strength.count) parts.push(`${n.strength.count} strength session${n.strength.count === 1 ? '' : 's'} (${n.strength.quality})`);
  if (n.mobilityMinutes) parts.push(`${n.mobilityMinutes} min of mobility`);
  if (n.restDays) parts.push(`${n.restDays} rest day${n.restDays === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** Everything the judgment is made from. */
export async function judgeInputs(data: AppData, check?: Replan | null, date = today()): Promise<JudgeInputs> {
  const profile = data.profile as Profile;
  const active = await getActivePlan();
  const series = fitnessFromRides(data.rides);
  const fit = fitnessOn(series, date);
  const ready = readinessToday(data.wellness, fit, date, data.rides);
  const setAside = data.dayNotes.some((n) => n.date === date && n.badWellness);
  const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
  const assessment = assess({ today: date, profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
  const rctx = await readsContext();

  // 1. The rider.
  const rider = [riderLine(profile, date)];
  if (profile.ftpSetOn) rider.push(`FTP last set ${profile.ftpSetOn}.`);
  if (profile.lthrSetOn) rider.push(`Threshold heart rate last set ${profile.lthrSetOn}.`);
  rider.push(...assessment.summary.filter(Boolean));

  // 2. This morning.
  const morning: string[] = [];
  morning.push(setAside ? `The rider set this morning's HRV, sleep and resting heart rate aside as wrong; readiness ${ready.score}/100 comes from form alone.`
    : ready.formOnly ? `No overnight numbers this morning; readiness ${ready.score}/100 comes from form alone.`
    : `Readiness ${ready.score}/100 (${ready.band}), each input against the rider's own four-week normal: ${ready.drivers.map(driverWords).join('; ')}.`);
  if (fit) morning.push(`Fitness ${Math.round(fit.ctl)}, fatigue ${Math.round(fit.atl)}, form ${Math.round(fit.tsb)} (42-day and 7-day weighted daily load; form is fitness minus fatigue).`);
  const forms = series.filter((f) => f.date > addDays(date, -90) && f.date <= date).map((f) => f.tsb).sort((a, b) => a - b);
  if (forms.length >= 30) morning.push(`This rider's form over the last 90 days: lowest ${Math.round(forms[0])}, middle ${Math.round(forms[Math.floor(forms.length / 2)])}, highest ${Math.round(forms[forms.length - 1])}.`);
  const ratio = loadRatio(data.rides, date);
  if (ratio != null) morning.push(`Load of the last 7 days against the last 28: ${ratio.toFixed(2)} (1.00 is steady).`);
  const last7 = data.wellness.filter((w) => w.date > addDays(date, -7) && w.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  for (const w of last7) {
    const bits = [w.hrv != null ? `HRV ${Math.round(w.hrv)} ms` : '', w.restingHr != null ? `resting heart rate ${Math.round(w.restingHr)} bpm` : '', w.avgSleepingHr != null ? `sleeping heart rate ${Math.round(w.avgSleepingHr)} bpm` : '', w.sleepSeconds ? `sleep ${(w.sleepSeconds / 3600).toFixed(1)} h` : '', w.sleepScore != null ? `sleep score ${Math.round(w.sleepScore)}` : '', w.respiration != null ? `breathing rate ${w.respiration.toFixed(1)}` : ''].filter(Boolean);
    if (bits.length) morning.push(`Morning of ${w.date}: ${bits.join(', ')}.`);
  }

  // 3. Notes.
  const notes = recentNoteLines(data.dayNotes, date, 14);

  // 4. Recent activities, every one, planned or not.
  const doneBy = new Map(data.planned.filter((p) => p.activityId).map((p) => [p.activityId!, p]));
  const reads = new Map(rctx.reads.map((r) => [r.id, r]));
  const activities = data.rides.filter((r) => r.date > addDays(date, -14) && r.date <= date).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)).map((r) => {
    const rd = reads.get(r.id);
    return { date: r.date, name: r.name, planned: doneBy.has(r.id), words: rd ? readWords(rd, rctx) : [`${activityLine(r)}.`] };
  });

  // 5. The week so far and intended.
  const wk = weekStart(date);
  const week: string[] = [];
  const thisWeek = check?.plan.weeks.find((w) => w.start === wk) ?? check?.plan.weeks[0];
  const nw = needsWords(thisWeek);
  if (nw) week.push(`The plan meant this week (${thisWeek!.label}) to carry ${nw}.`);
  const doneWeek = data.rides.filter((r) => r.date >= wk && r.date < date);
  week.push(doneWeek.length ? `Done this week before today: ${doneWeek.map((r) => `${r.date} ${r.sport} ${Math.round(r.seconds / 60)} min ${Math.round(r.tss ?? 0)} TSS`).join('; ')} (total ${Math.round(doneWeek.reduce((t, r) => t + (r.tss ?? 0), 0))} TSS).` : 'Nothing done yet this week before today.');
  if (check?.review.lines.length) week.push(...check.review.lines.map((l) => `Last week: ${l}`));

  // 6. The calendar, with refs.
  const to = addDays(date, HORIZON);
  const cal = data.planned.filter((p) => p.date >= date && p.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const sessions: PacketSession[] = [];
  const checkSessions: CheckSession[] = [];
  let ci = 0;
  for (const p of cal) {
    const w = findWorkout(data.mine, p.workoutId);
    if (!w) continue;
    const ref = `C${++ci}`;
    const hand = !p.planId || !!p.userEdited;
    const status: PacketSession['status'] = p.status === 'completed' ? 'done' : p.status === 'missed' ? 'missed' : 'to do';
    sessions.push({ ref, date: p.date, kind: w.kind, name: w.subtitle ? `${w.name} (${w.subtitle})` : w.name, minutes: minutesOf(w), tss: tssOf(w), purpose: p.reason ?? w.purpose, status, handPlaced: hand });
    checkSessions.push({ ref, id: p.id, date: p.date, kind: w.kind, name: w.name, minutes: minutesOf(w), done: p.status === 'completed', handPlaced: hand, workoutKey: keyOf(w) });
  }

  // 7. The plan.
  const plan: string[] = [];
  if (active) {
    plan.push(`Plan "${active.name}": ${goalWords(active.goal)}; runs ${active.start} to ${active.goalDate} (${Math.max(0, Math.round((Date.parse(active.goalDate) - Date.parse(date)) / 864e5))} days left).`);
    const weeks = [...(active.weeks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
    const cur = weeks.filter((w) => w.start <= date).pop();
    const next = weeks.find((w) => w.start > date);
    if (cur) plan.push(`This week: ${cur.label}${cur.phase === 'recovery' ? ' (a recovery week)' : ''}${cur.summary ? `. ${cur.summary}` : ''}`);
    const nextBuilt = check?.plan.weeks.find((w) => w.start === next?.start);
    if (next) plan.push(`Next week: ${next.label}${next.phase === 'recovery' ? ' (a recovery week)' : ''}${needsWords(nextBuilt) ? `; it needs ${needsWords(nextBuilt)}` : ''}.`);
    if (check) {
      plan.push(`Fitness now ${Math.round(check.fitnessNow)}${check.fitnessPlanned != null ? `; the plan expected ${Math.round(check.fitnessPlanned)} today` : ''}. ${check.plan.advice}`.trim());
    }
  }

  // 8. The rider's parameters.
  const params: string[] = [];
  const av = active?.availability;
  // Without a plan, the rider's own ceilings (D2).
  const ceilings = av ? undefined : ceilingsFrom(data.rides, date);
  if (av) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    for (const d of order) {
      const pins = av.pins?.filter((p) => p.dow === d).map((p) => `always ${p.kind}`) ?? [];
      const nev = av.never?.filter((n) => n.dow === d).map((n) => `never ${n.kind}`) ?? [];
      params.push(`${DAY[d]}: ${av.hours[d] > 0 ? `${av.hours[d]} h available, ${av.noBike?.[d] ? 'no bike' : av.outdoor[d] ? 'rides outdoors' : 'rides indoors'}` : 'no time'}${[...pins, ...nev].length ? `; ${[...pins, ...nev].join(', ')}` : ''}.`);
    }
    const may = { strength: av.may?.strength ?? true, mobility: av.may?.mobility ?? true, walk: av.may?.walk ?? true, run: av.may?.run ?? false };
    const off = Object.entries(may).filter(([, v]) => !v).map(([k]) => k);
    if (off.length) params.push(`The app may never schedule: ${off.join(', ')}.`);
    params.push(`Equipment: ${av.equipment.join(', ') || 'none listed'}.`);
  } else {
    const longestRide = data.rides.filter((r) => r.sport === 'ride' && r.date >= addDays(date, -56)).reduce((m, r) => Math.max(m, r.seconds), 0);
    const ride = ceilings?.ride;
    params.push(ceilings ? `No plan in force, so no hours are set.${longestRide ? ` The rider's longest ride in the last 8 weeks was ${minutesWords(longestRide)}; keep any ride you add or put in under about ${minutesWords((ride ?? 0) * 60)},` : ` Keep any session you add or put in under about ${minutesWords((ride ?? 0) * 60)},`} and other kinds likewise under a quarter more than the rider's longest of that kind.` : 'No plan in force and no activities yet, so no hours are set: keep what you add modest; the rider decides.');
  }
  const away = (active?.away ?? []).filter((r) => r.to >= date && r.from <= to);
  for (const r of away) params.push(`Away ${r.from} to ${r.to}${r.note ? ` (${r.note})` : ''}: nothing may go on these days.`);

  // 9. The next 7 days, and the Library once: every kind some day allows, up to the longest day's hours.
  const pool = allWorkouts(data.mine).filter((w) => w.source !== 'generated' && (w.kind !== 'ride' || w.bases.includes(profile.basis)));
  const refOf = new Map<string, string>();
  const checkWorkouts: CheckWorkout[] = [];
  const ref = (w: Workout) => {
    let r = refOf.get(w.id);
    if (!r) { r = `W${refOf.size + 1}`; refOf.set(w.id, r); checkWorkouts.push({ ref: r, id: w.id, kind: w.kind, name: w.name, minutes: minutesOf(w), key: keyOf(w) }); }
    return r;
  };
  const days: PacketDay[] = [];
  const kindsAny = new Set<SessionKind>();
  const settings = new Set<string>();
  let maxCap = 0;
  for (let k = 0; k < 7; k++) {
    const d = addDays(date, k);
    const dow = dowOf(d);
    const cap = av ? av.hours[dow] * 60 : 120;
    const allowed = KIND_ORDER.filter((kind) => !kindAllowed(kind, d, { availability: av, away }));
    if (allowed.length && cap > 0) { allowed.forEach((x) => kindsAny.add(x)); maxCap = Math.max(maxCap, cap); if (allowed.includes('ride')) settings.add(!av ? 'any' : av.outdoor[dow] ? 'outdoor' : 'indoor'); }
    const where = av && allowed.includes('ride') ? (av.outdoor[dow] ? ', rides outdoors' : ', rides indoors') : '';
    days.push({ date: d, header: `${dayWords(d)} (${d}): ${av ? `${av.hours[dow]} h available${where}` : 'no hours set'}${allowed.length ? `; may hold ${allowed.join(', ')}` : '; nothing may go on this day'}.` });
  }
  const catalogue: PacketGroup[] = [];
  for (const kind of KIND_ORDER.filter((x) => kindsAny.has(x))) {
    const fit = pool.filter((w) => w.kind === kind && minutesOf(w) > 0 && minutesOf(w) <= maxCap * 1.1 + 5 && (kind !== 'ride' || settings.has('any') || w.setting === 'any' || settings.has(w.setting ?? 'any')));
    const families = kind === 'ride' ? [...new Set(fit.map((w) => w.family))] : [kind];
    for (const fam of families) {
      const items = fit.filter((w) => (kind === 'ride' ? w.family === fam : true));
      catalogue.push({ label: kind === 'ride' ? `ride · ${fam}` : kind, items: items.map((w): PacketOption => ({ ref: ref(w), name: `${w.subtitle ? `${w.name} (${w.subtitle})` : w.name}${kind === 'ride' && w.setting && w.setting !== 'any' ? `, ${w.setting} only` : ''}`, kind: w.kind, minutes: minutesOf(w), tss: tssOf(w), family: w.family })) });
    }
  }

  // 10. The app's own view.
  const appView = check ? check.changes.map(changeWords) : [];

  const packet: PacketInput = { date, rider, morning, notes, activities, week, calendar: sessions, plan, params, days, catalogue, appView };
  return { packet, check: { today: date, horizon: HORIZON, availability: av, away, sessions: checkSessions, workouts: checkWorkouts, ...(ceilings ? { ceilingMinutes: ceilings } : {}) }, sig: signatureOf(data, date), active };
}

// ---- asking ------------------------------------------------------------------

const listeners = new Set<() => void>();
export function onJudgment(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export async function getJudgment(): Promise<Judgment | null> {
  return getSetting<Judgment | null>(JUDGMENT_KEY, null);
}

/** Whether the coach judges the plan: the switch on and a key on this device, or (without a key) a judgment of today another device made. */
export async function coachJudges(): Promise<{ on: boolean; key: CoachConfig | null }> {
  const auto = await getSetting<boolean>('coachAuto', false);
  const key = await coachConfig();
  return { on: auto, key };
}

const inFlight = new Map<string, Promise<Judgment | null>>();
const failedThisSession = new Set<string>();

/**
 * The judgment for the data as they are, asking the coach when it is out of
 * date. `force` (Check again) asks whatever the signature. Without a key on this
 * device nothing is asked; the shared judgment is returned as it is.
 */
export async function ensureJudgment(data: AppData, opts: { force?: boolean; check?: Replan | null } = {}): Promise<Judgment | null> {
  if (!data.profile) return null;
  const { on, key } = await coachJudges();
  const saved = await getJudgment();
  if (!key || (!on && !opts.force)) return saved;
  const sig = signatureOf(data);
  if (!opts.force) {
    if (saved && !saved.failed && saved.sig === sig) return saved;
    if (waitForMorning(data)) return saved;
    if (failedThisSession.has(sig)) return saved;
  }
  const running = inFlight.get(sig);
  if (running) return running;
  const p = ask(data, key, sig, opts.check).finally(() => inFlight.delete(sig));
  inFlight.set(sig, p);
  return p;
}

async function ask(data: AppData, key: CoachConfig, sig: string, check?: Replan | null): Promise<Judgment | null> {
  try {
    // Today asks before its own re-check has finished (check null); the plan's week, needs and line must still be in the packet.
    const c = check ?? await replan(data).catch(() => null);
    const inputs = await judgeInputs(data, c);
    const text = buildPacket(inputs.packet);
    let reply = await judgeDay(key, data.profile as Profile, inputs.packet.date, text);
    // A reply that does not keep to the form is asked for once more.
    if ('failed' in reply) reply = await judgeDay(key, data.profile as Profile, inputs.packet.date, `${text}\n\nAnswer only in the JSON form given: note, assessment, stance, changes.`);
    if ('failed' in reply) { failedThisSession.add(sig); await noteModelResult(false); return getJudgment(); }
    await noteModelResult(true);
    const { ok, dropped } = checkChanges(reply.changes, inputs.check);
    if (dropped.length) console.info('[coach] changes set aside by the app\'s checks:', dropped);
    // The rider never sees a C or W ref: any that slipped into the prose becomes the session's own name.
    const names = new Map<string, string>([...inputs.check.sessions, ...inputs.check.workouts].map((x) => [x.ref, x.name]));
    const j: Judgment = { date: inputs.packet.date, sig, at: new Date().toISOString(), note: plainWords(reply.note, names), assessment: plainWords(reply.assessment, names), stance: reply.stance, changes: ok.map((c) => ({ ...c, why: plainWords(c.why, names) })) };
    await setSetting(JUDGMENT_KEY, j);
    listeners.forEach((l) => l());
    notify();
    return j;
  } catch (e) {
    failedThisSession.add(sig);
    console.info('[coach] the judgment could not be made:', (e as Error).message);
    throw e;
  }
}

// ---- showing and applying ----------------------------------------------------

/** A judged change still makes sense on the calendar as it is now (an entry not since removed, done or moved). */
export function stillValid(c: ResolvedChange, planned: PlannedWorkout[], date = today()): boolean {
  if (c.date < date || (c.toDate && c.toDate < date)) return false;
  if (!c.plannedId) return true;
  const p = planned.find((x) => x.id === c.plannedId);
  return !!p && p.date === c.date && p.status !== 'completed';
}

/** The judged changes as change rows, without those the rider turned down, keyed back to what they do. */
export function judgedRows(j: Judgment, planned: PlannedWorkout[], rejected: Set<string>): { changes: Change[]; reasons: Map<string, string>; judged: Map<string, ResolvedChange> } {
  const changes: Change[] = [], reasons = new Map<string, string>(), judged = new Map<string, ResolvedChange>();
  for (const r of j.changes) {
    if (!stillValid(r, planned)) continue;
    const c = toChange(r);
    const sig = changeSig(c);
    if (rejected.has(sig)) continue;
    changes.push(c); reasons.set(sig, r.why); judged.set(sig, r);
  }
  return { changes, reasons, judged };
}

/**
 * Make the accepted judged changes on the calendar. Sessions already on the
 * Garmin that change come off it and wait to be sent again. Returns how many
 * of the changed sessions had been sent, so the screen can offer to send again.
 */
export async function applyJudged(data: AppData, changes: ResolvedChange[], active: ActivePlan | null): Promise<{ made: number; wereSent: number }> {
  const profile = data.profile as Profile;
  const c = await credentials();
  let made = 0, wereSent = 0;
  for (const ch of changes) {
    const p = ch.plannedId ? await db.planned.get(ch.plannedId) : undefined;
    if (ch.plannedId && (!p || p.status === 'completed')) continue;
    if (p?.status === 'sent') wereSent++;
    if (ch.action === 'replace' && p && ch.workoutId) {
      const w = findWorkout(data.mine, ch.workoutId);
      if (!w || (await replacePlanned(p, w, profile.basis)) !== 'replaced') continue;
      await db.planned.update(p.id, { reason: ch.why });
    } else if (ch.action === 'remove' && p) {
      if (p.icuEventId && c) { try { await deleteEvent(c, p.icuEventId); } catch { /* a stale event is harmless */ } }
      await db.planned.delete(p.id);
    } else if (ch.action === 'move' && p && ch.toDate) {
      await movePlanned(p, ch.toDate);
      await db.planned.update(p.id, { reason: ch.why });
    } else if (ch.action === 'add' && ch.workoutId) {
      const w = findWorkout(data.mine, ch.workoutId);
      if (!w) continue;
      const workoutId = await storeSessionWorkout(w);
      await db.planned.add({ id: newId(), date: ch.date, workoutId, basis: w.bases.includes(profile.basis) ? profile.basis : w.bases[0], status: 'planned', reason: ch.why, ...(active ? { planId: active.id, planName: active.name } : {}) });
    } else continue;
    made++;
  }
  await pruneOrphanWorkouts();
  // The coach's own changes are not new evidence: the saved judgment keeps the applied changes off its list and takes the
  // calendar's new signature, so nothing is asked again until something else changes (the morning, an activity, a note).
  const j = await getJudgment();
  if (j && made) {
    const applied = new Set(changes.map((x) => `${x.action}|${x.plannedId ?? ''}|${x.workoutId ?? ''}|${x.date}`));
    const left = j.changes.filter((x) => !applied.has(`${x.action}|${x.plannedId ?? ''}|${x.workoutId ?? ''}|${x.date}`));
    await setSetting(JUDGMENT_KEY, { ...j, changes: left, sig: signatureOf({ ...data, planned: await db.planned.toArray() }) });
  }
  notify();
  return { made, wereSent };
}

/**
 * What the rider is shown, in one voice. With the coach judging (the switch on,
 * and a key here or a judgment of today from another device): the coach's
 * changes only, each with its reason. While a new judgment is being made the
 * list waits ("Checking your plan…") up to `waitMs`, then shows the app's own.
 * Before this morning's numbers arrive, yesterday's changes that still make
 * sense stay on offer. With the coach off: the app's own list.
 */
export async function recommendFor(data: AppData, check: Replan | null, onWaiting?: () => void, noWait = false, waitMs = JUDGE_WAIT_MS): Promise<Recommended & { fellBack?: boolean }> {
  const { on, key } = await coachJudges();
  let j = await getJudgment();
  const t = today();
  if (!on || (!key && j?.date !== t)) return fallbackRecommendation(data, check);
  const rejected = await rejectedSigs();
  const fromJudgment = (x: Judgment): Recommended => ({ ...judgedRows(x, data.planned, rejected), status: 'ready', byCoach: true });
  const sig = signatureOf(data);
  if (j && !j.failed && (j.sig === sig || !key)) return fromJudgment(j);
  if (key && waitForMorning(data) && j && !j.failed) return fromJudgment(j);
  if (noWait) return j && !j.failed && j.date === t ? fromJudgment(j) : { ...(await fallbackRecommendation(data, check)), fellBack: true };
  onWaiting?.();
  j = await withTimeout(ensureJudgment(data, { check }), waitMs);
  return j && !j.failed && j.date === t ? fromJudgment(j) : { ...(await fallbackRecommendation(data, check)), fellBack: true };
}

/** Accept recommended rows: the coach's through applyJudged, the app's own through the plan. */
export async function acceptRecommended(data: AppData, check: Replan | null, rec: Recommended, changes: Change[], active: ActivePlan | null): Promise<{ made: number; wereSent: number }> {
  // The coach's changes and the day judge's are made one by one; the plan's own (structural) changes through the plan.
  const judged = changes.map((c) => rec.judged?.get(changeSig(c))).filter((x): x is ResolvedChange => !!x);
  const own = changes.filter((c) => !rec.judged?.has(changeSig(c)));
  let made = 0, wereSent = 0;
  if (judged.length) { const r = await applyJudged(data, judged, active); made += r.made; wereSent += r.wereSent; }
  if (own.length && check && active) {
    const sent = new Set(data.planned.filter((p) => p.status === 'sent').map((p) => `${p.date}`));
    await applyPlan(data, check.plan, active.goal, active.availability, active.masters, new Set(own.flatMap(changeKeys)), { planId: active.id });
    made += own.length; wereSent += own.filter((c) => sent.has(c.date)).length;
  }
  return { made, wereSent };
}

// ---- without a coach: the app's own day judge (Part E) ----------------------

/**
 * The day judged by the app itself, from the same data the coach's packet is
 * made from: this morning against the rider's normal, recent load among the
 * rider's own days, the latest ride against the rider's own history, the rider's
 * own morning-after evidence when the morning is missing.
 */
export async function dayJudgment(data: AppData, date = today()): Promise<DayJudgment | null> {
  if (!data.profile) return null;
  const profile = data.profile;
  const active = await getActivePlan();
  const av = active?.availability;
  const away = active?.away ?? [];
  const fit = fitnessOn(fitnessFromRides(data.rides), date);
  const ready = readinessToday(data.wellness, fit, date, data.rides);
  const setAside = data.dayNotes.some((n) => n.date === date && n.badWellness);
  // Yesterday's kind, for the rider's own morning-after evidence.
  const y = addDays(date, -1);
  const yRides = data.rides.filter((r) => r.date === y);
  const yesterdayKind = yRides.some((r) => r.sport === 'ride' && r.seconds >= 2.5 * 3600) ? 'long' as const
    : yRides.some((r) => r.sport === 'ride' && (r.intensityFactor ?? 0) >= 0.85) ? 'hard' as const
    : yRides.some((r) => r.sport === 'strength') ? 'strength' as const : undefined;
  let morningAfterCost: number | undefined;
  if (yesterdayKind) {
    const curve = (await getSetting<{ curve: PowerCurve } | null>('powerCurve', null))?.curve;
    const a = assess({ today: date, profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve });
    const ev = yesterdayKind === 'long' ? a.afterLongRide : yesterdayKind === 'hard' ? a.afterHardRide : a.afterStrength;
    if (ev.confidence !== 'none') morningAfterCost = ev.value;
  }
  // The latest ride in the last week, against the rider's own history.
  const { reads } = await readsContext();
  const from = addDays(date, -7);
  const recent = reads.filter((r) => r.kind === 'ride' && r.date >= from && r.date < date).sort((a, b) => b.date.localeCompare(a.date));
  const latest = recent[0];
  let performance: DayJudgeInput['performance'];
  if (latest) {
    const prior = reads.filter((r) => r.kind === 'ride' && r.date < latest.date && r.date >= addDays(latest.date, -56));
    const spreadOf = (xs: number[]) => { if (xs.length < 3) return undefined; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
    const vs = hrVsNormal(latest, reads);
    const pastVs = prior.map((r) => hrVsNormal(r, reads)?.beats).filter((x): x is number => x != null);
    const spread = spreadOf(pastVs);
    const steady = (r: ActivityRead) => r.drift != null && !r.planned?.steps.length;
    const drifts = prior.filter(steady).map((r) => r.drift!);
    const driftSpread = spreadOf(drifts);
    performance = {
      ...(vs && spread != null ? { hrVsNormal: { beats: vs.beats, spread } } : {}),
      ...(steady(latest) && driftSpread != null ? { drift: { value: latest.drift!, usual: drifts.reduce((a, b) => a + b, 0) / drifts.length, spread: driftSpread } } : {}),
      ...(latest.planned?.verdict ? { verdict: latest.planned.verdict } : {}),
    };
  }
  // The calendar to the end of the week.
  const end = addDays(date, 6 - ((dowOf(date) + 6) % 7));
  const week: DaySession[] = data.planned.filter((p) => p.date >= date && p.date <= end).map((p): DaySession | undefined => {
    const w = findWorkout(data.mine, p.workoutId);
    return w ? { id: p.id, date: p.date, kind: w.kind, name: w.name, ...(w.kind === 'ride' ? { family: w.family as string } : {}), minutes: minutesOf(w), done: p.status === 'completed', handPlaced: !p.planId || !!p.userEdited } : undefined;
  }).filter((x): x is DaySession => !!x);
  const outdoor = av?.outdoor[dowOf(date)];
  const rides: DayOption[] = allWorkouts(data.mine).filter((w) => w.kind === 'ride' && w.source !== 'generated' && w.bases.includes(profile.basis) && w.family !== 'test' && (!av || w.setting === 'any' || w.setting === (outdoor ? 'outdoor' : 'indoor')))
    .map((w) => ({ id: w.id, name: w.name, family: w.family, minutes: minutesOf(w), setting: w.setting }));
  return judgeTheDay({
    date, readiness: ready, setAside, loads: data.rides.map((r) => ({ date: r.date, tss: r.tss ?? 0 })),
    yesterdayKind, morningAfterCost, performance, week,
    hours: av?.hours, rideAllowed: (d) => !kindAllowed('ride', d, { availability: av, away }), rides,
  });
}

/** The list without a coach: the day judge's changes for today, with its reasons, and the plan's own structural changes. */
export async function fallbackRecommendation(data: AppData, check: Replan | null): Promise<Recommended> {
  const base = ownRecommendation(check);
  let day: DayJudgment | null = null;
  try { day = await dayJudgment(data); } catch { day = null; }
  if (!day || !day.changes.length) return base;
  const rejected = await rejectedSigs();
  const reasons = new Map<string, string>(), judged = new Map<string, ResolvedChange>();
  const rows: Change[] = [];
  for (const r of day.changes) {
    const c = toChange(r);
    const sig = changeSig(c);
    if (rejected.has(sig)) continue;
    rows.push(c); reasons.set(sig, r.why); judged.set(sig, r);
  }
  const taken = new Set(day.changes.flatMap((r) => [`${r.date}|${r.kind}`, ...(r.toDate ? [`${r.toDate}|${r.kind}`] : [])]));
  const rest = base.changes.filter((c) => !taken.has(`${c.date}|${c.kind}`));
  return { changes: [...rows, ...rest], reasons, judged, status: 'ready', byCoach: false, reason: `The app's view of today: ${day.stance === 'lighter' ? 'a lighter day than planned' : day.stance === 'easy' ? 'keep today easy' : 'rest'}.` };
}
