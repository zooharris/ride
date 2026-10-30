import type { Assessment } from './assessment';
import { hm } from './assessment';
import { demand, hoursText, type Demand, type Goal } from './goals';
import type { SessionType } from './generate';
import { addDays, fitnessSeries } from './load';
import type { Basis, Equipment, Family, Fitness, Profile, SessionKind, Workout } from './types';
import { planNeeds, type WeekNeeds } from './needs';
import { DEFAULT_PREFS, hoursWords, shopWeek, type Prefs, type ShopLibrary, type Slot, type Unmet } from './shop';
import { contribution } from './contribution';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';

/**
 * The planner: an assessment of the rider and a model of the goal go in; a
 * week-by-week allocation of sessions to the rider's actual slots comes out,
 * with a sentence for every decision. Every rule of thumb in here is a prior
 * that the assessment's evidence overrides when it is good enough.
 */
export interface Availability {
  hours: number[];        // index 0 = Sunday; time available that day, 0 means none
  outdoor: boolean[];     // ride outdoors on that day when the slot allows
  noBike: boolean[];      // the bike is not available that day (travel, logistics)
  equipment: Equipment[]; // what the rider has: bodyweight, dumbbells, bench, band, treadmill, outdoor-walk, trainer
  pins: Array<{ dow: number; kind: SessionKind | 'rest' }>;  // standing commitments the plan must honour ("Always")
  /** Which kinds the app may schedule at all (rides always). Undefined in plans saved before 21 Oct 2026: see mayOf. */
  may?: MaySchedule;
  /** Kinds a day must never have ("Never"). A pin for the same day and kind wins. */
  never?: Array<{ dow: number; kind: SessionKind }>;
  /** Walks, runs and mobility: prefer, fine, or only if needed (30 Oct 2026). Absent: fine for all three. */
  prefs?: Prefs;
}

export interface MaySchedule { strength: boolean; walk: boolean; run: boolean; mobility: boolean }

/**
 * What the app may schedule. A week saved before these switches existed behaves as it
 * always did: strength and mobility on, walks on when a treadmill or outdoor walks are
 * ticked, runs off.
 */
export function mayOf(av: Pick<Availability, 'may' | 'equipment'>): MaySchedule {
  return av.may ?? { strength: true, mobility: true, walk: av.equipment.includes('treadmill') || av.equipment.includes('outdoor-walk'), run: false };
}

/** The availability with every switch filled in, so nothing downstream reads undefined. */
export function normalizeAvailability(av: Availability): Availability {
  return { ...av, pins: av.pins ?? [], noBike: av.noBike ?? [false, false, false, false, false, false, false], may: mayOf(av), never: av.never ?? [] };
}

/** Days away (travel, a busy week), inclusive. Nothing is planned on them. */
export interface AwayRange { from: string; to: string; note?: string }

/** How many of a week's seven days fall inside the away ranges. */
export function awayDaysInWeek(weekStart: string, away: AwayRange[] = []): number {
  let n = 0;
  for (let k = 0; k < 7; k++) { const d = addDays(weekStart, k); if (away.some((r) => d >= r.from && d <= r.to)) n++; }
  return n;
}

export interface PlanRequest {
  start: string;          // a Monday; the plan's weeks line up with the calendar
  notBefore?: string;     // days before this are already gone (today, when the plan starts mid-week)
  away?: AwayRange[];     // dates the rider is away: nothing is placed on them
  goal: Goal;
  availability: Availability;
  basis: Basis;
  masters: boolean;
  profile: Profile;
  assessment: Assessment;
  longRideKmh?: number;   // the rider's own pace on long rides, if known
  /**
   * Re-checking a plan already on the calendar: its weeks and phases as they
   * were laid out when it was made, first week first (`start` is that week).
   * The phases are kept, weeks already past are not rebuilt (they still count
   * for where each block stands), and only the sessions are fitted again to the
   * rider's latest data. Without it the plan is laid out afresh, which shifts
   * every phase as the weeks go by.
   */
  layout?: Array<{ start: string; phase: Phase; budget?: number }>;
  /** Re-checking with fitness on the plan's line: keep each week's budget from the layout (the steady re-check). */
  keepBudgets?: boolean;
  /** The rider's own saved workouts, offered to the planner alongside the Library (Batch 6, B1). The plan never adds to them. */
  ownWorkouts?: Workout[];
  /**
   * Re-checking: the quality types already on the calendar, by plan week (its Monday), and the scores
   * the plan was made with. They are kept unless the scores have moved (Batch 6, C3).
   */
  keepQuality?: { scores: QualityScores; byWeek: Record<string, SessionType[]> };
  /** Walks, runs and mobility: prefer, fine, or only if needed (30 Oct 2026). Absent: fine. */
  prefs?: Prefs;
  /** Library workouts on the calendar before the plan's first rebuilt day, for variety: the plan avoids repeating them for three weeks. */
  recentPicks?: Array<{ date: string; id: string }>;
  /**
   * Re-checking (30 Oct 2026, the steady re-check): the plan's first day as placed, and its sessions on the calendar from
   * then until today. Days of the week under way before the plan's first day are gone, as they were when it was placed;
   * days from then until today keep what the calendar has on them, which counts toward the week. A test among them (or
   * anywhere since the plan's first day) means no further test is wanted.
   */
  planStart?: string;
  pastSessions?: PlannedSession[];
  /** What the rider has actually done this week up to today, planned or not, so the days left can respond to it. */
  done?: Array<{ date: string; tss: number; seconds: number; intensity?: number; kind?: SessionKind }>;
}

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';

/**
 * What decides a week's quality sessions: the goal's emphasis and the rider's
 * limiters, as numbers. They are recomputed from the data every morning, so a
 * value sitting near a line flips December between threshold and sweet spot
 * from one re-check to the next (22 Oct 2026). Batch 6, C3: a re-check keeps
 * the quality types already on the calendar unless one of these has moved by
 * HOLD_QUALITY or more since the plan was made.
 */
export interface QualityScores { threshold: number; vo2max: number; anaerobic: number; limiterVo2: number; limiterTopEnd: number }
export const HOLD_QUALITY = 0.15;
export function qualityMoved(a: QualityScores, b: QualityScores): boolean {
  return (Object.keys(a) as Array<keyof QualityScores>).some((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) >= HOLD_QUALITY - 1e-9);
}

export interface PlannedSession { date: string; kind: SessionKind; type: SessionType | 'strength' | 'mobility' | 'walk' | 'run'; workout: Workout; seconds: number; tss: number; reason: string }
export interface PlanWeek {
  index: number; start: string; phase: Phase; label: string; targetTss: number; tss: number; hours: number; sessions: PlannedSession[]; note: string;
  /** What the week asked for (needs.ts). */
  needs?: WeekNeeds;
  /** The week in one plain sentence: "Week 8: 3½ hours easy, a 3-hour long ride with tempo late, …". */
  summary?: string;
  /** What the Library could not supply this week: for the developers' sweep only, never shown or stored. */
  unmet?: Unmet[];
}

export interface Plan {
  weeks: PlanWeek[];
  demand: Demand;
  projection: Fitness[];
  goalDate: string;
  requiredCtl: number;
  projectedCtl: number;      // at the start of the taper, or the end of the plan
  formOnDay: number;
  longestPlanned: number;    // seconds
  verdict: 'on-track' | 'close' | 'short' | 'no-target';
  advice: string;
  decisions: string[];       // the reasoning, in sentences
  /** The scores that decide each week's quality sessions, kept with the plan so a re-check holds them steady (Batch 6, C3). */
  qualityScores: QualityScores;
}

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dow = (date: string) => new Date(date + 'T00:00:00').getDay();

export function planWeeks(goal: Goal, start: string): number {
  if (goal.kind === 'event') return Math.max(4, Math.floor((Date.parse(goal.date) - Date.parse(start)) / (7 * 864e5)));
  return Math.max(1, Math.min(24, goal.weeks));
}

/** Phase per week, derived from the goal's emphasis and the rider's limiters, with recovery weeks on a prior rhythm. */
export function phaseSequence(n: number, d: Demand, a: Assessment, goal: Goal, masters: boolean): { seq: Phase[]; decisions: string[] } {
  const decisions: string[] = [];
  const taper = goal.kind === 'event' ? (n >= 10 ? 2 : 1) : 0;
  const core = n - taper;
  const lim = (k: 'durability' | 'threshold' | 'vo2max' | 'anaerobic' | 'base') => a.limiters.includes(k) ? 0.6 : 0;
  const wBase = d.emphasis.durability + d.emphasis.base + lim('durability') + lim('base');
  const wBuild = d.emphasis.threshold * 1.6 + lim('threshold');
  const wPeak = d.emphasis.vo2max + d.emphasis.anaerobic + lim('vo2max') + lim('anaerobic');
  const sum = wBase + wBuild + wPeak;
  let base = Math.round(core * Math.min(0.7, Math.max(0.3, wBase / sum)));
  let peak = Math.round(core * Math.min(0.4, wPeak / sum));
  if (goal.kind === 'endurance' || goal.kind === 'weight') peak = 0;
  let build = Math.max(goal.kind === 'general' ? 1 : 0, core - base - peak);
  if (build === 0 && core - base - peak < 0) base = core - peak;
  const seq: Phase[] = [...Array(base).fill('base'), ...Array(build).fill('build'), ...Array(peak).fill('peak'), ...Array(taper).fill('taper')];
  // Recovery rhythm: a prior of every third week for masters, every fourth otherwise,
  // shortened to every second when the evidence says long and hard days leave the rider flat.
  const cycle = masters ? 3 : 4;
  for (let i = cycle - 1; i < seq.length - taper - 1; i += cycle) seq[i] = 'recovery';
  // No event to taper for: finish on a recovery week, so the block ends fresh and the fitness shows, rather than mid-load.
  if (!taper && n >= 4 && seq[n - 1] !== 'recovery') {
    if (seq[n - 2] === 'recovery') seq[n - 2] = seq[n - 1];
    seq[n - 1] = 'recovery';
  }
  const count = (ph: Phase) => seq.filter((x) => x === ph).length;
  decisions.push(`${count('base')} base week${count('base') === 1 ? '' : 's'}, ${count('build')} build, ${count('peak')} peak, ${count('recovery')} recovery${taper ? `, ${taper} taper` : ''}: the split follows what the goal rewards (${topEmphasis(d)}) and what your data flag as the limiter (${a.limiters[0]}).`);
  decisions.push(`A recovery week every ${cycle} weeks is the starting rhythm${masters ? ' for a masters rider' : ''}; as rides and wellness come in, the plan brings one forward when fatigue says so.`);
  if (!taper && n >= 4) decisions.push('No event to taper for, so the last week is a recovery week: you finish the block with form back near zero and rising, and the fitness in the bank for the next one.');
  return { seq, decisions };
}

function topEmphasis(d: Demand): string {
  const e = Object.entries(d.emphasis).sort((x, y) => y[1] - x[1])[0][0];
  return { durability: 'durability', threshold: 'threshold power', vo2max: 'top-end power', anaerobic: 'sharp power', base: 'aerobic base' }[e] ?? e;
}

export function generatePlan(req: PlanRequest): Plan {
  const { goal, assessment: a, profile } = req;
  const av = normalizeAvailability(req.availability);
  const may = av.may!;
  const d = demand(goal, profile, a, req.longRideKmh);
  const fixed = req.layout?.length ? req.layout : undefined;
  const n = fixed ? fixed.length : planWeeks(goal, req.start);
  const { seq, decisions } = fixed
    ? { seq: fixed.map((w) => w.phase), decisions: ['The weeks keep the phases the plan was made with; only the sessions are fitted again to your latest data.'] }
    : phaseSequence(n, d, a, goal, req.masters);
  // Re-checking: weeks wholly past are history (they count for where each block stands but are
  // not rebuilt). The week under way is re-fitted around what was actually done in it (below).
  const pastWeeks = fixed && req.notBefore ? seq.filter((_, i) => addDays(req.start, i * 7 + 7) <= req.notBefore!).length : 0;
  const currentIdx = fixed && req.notBefore ? pastWeeks : -1;
  const pinOf = (dw: number): SessionKind | 'rest' | undefined => (av.pins ?? []).find((p) => p.dow === dw)?.kind;
  const never = (dw: number, kind: SessionKind) => pinOf(dw) !== kind && (av.never ?? []).some((x) => x.dow === dw && x.kind === kind);
  const daysWithTime = [0, 1, 2, 3, 4, 5, 6].filter((i) => (av.hours[i] ?? 0) > 0 && pinOf(i) !== 'rest');
  const slotsAll = daysWithTime.filter((i) => !av.noBike?.[i] && !never(i, 'ride') && !['strength', 'walk', 'run', 'mobility'].includes(pinOf(i) ?? ''));
  const pinsUsed = (av.pins ?? []).filter((p) => (av.hours[p.dow] ?? 0) > 0 || p.kind === 'rest');
  if (pinsUsed.length) decisions.push(`Standing commitments honoured: ${pinsUsed.map((p) => `${DAY[p.dow]} is ${p.kind === 'rest' ? 'a rest day' : p.kind === 'ride' ? 'always a ride' : `always ${p.kind === 'walk' ? 'a walk' : p.kind === 'run' ? 'a run' : p.kind}`}`).join(', ')}.`);
  const nevers = (av.never ?? []).filter((x) => pinOf(x.dow) !== x.kind && (x.kind === 'ride' || x.kind === 'mobility' || may[x.kind as keyof MaySchedule]));
  if (nevers.length) decisions.push(`${nevers.map((x) => `Never ${x.kind === 'ride' ? 'a ride' : x.kind === 'walk' ? 'a walk' : x.kind === 'run' ? 'a run' : x.kind} on ${DAY[x.dow]}`).join('; ')}.`);
  const off = (['strength', 'walk', 'run', 'mobility'] as const).filter((k) => !may[k] && (k !== 'run'));
  if (off.length && req.availability.may) decisions.push(`Not scheduled, as you asked: ${off.map((k) => (k === 'walk' ? 'walks' : k)).join(', ')}.`);
  const capMinutes = slotsAll.reduce((s, i) => s + av.hours[i] * 60, 0);
  const capTss = capMinutes / 60 * 62;

  // What each week needs (needs.ts), then the Library shopped to fill it (shop.ts).
  const bigSlots = slotsAll.map((i) => av.hours[i] * 60).sort((x, y) => y - x);
  const footMinutes = daysWithTime.filter((i) => av.noBike?.[i] || av.hours[i] * 60 < 45).reduce((s, i) => s + av.hours[i] * 60, 0);
  const awayDays = seq.map((_, i) => awayDaysInWeek(addDays(req.start, i * 7), req.away));
  const needs = planNeeds({ goal, demand: d, assessment: a, availability: av, seq, masters: req.masters, start: req.start, pastWeeks, awayDays, capMinutes,
    rideDays: slotsAll.length, bigSlots, daysWithTime: daysWithTime.length, footMinutes,
    budgets: req.keepBudgets && fixed ? fixed.map((w) => w.budget) : undefined });
  decisions.push(...needs.decisions);

  const qualityScores: QualityScores = {
    threshold: d.emphasis.threshold * 1.6 + (a.limiters[0] === 'threshold' ? 0.8 : 0),
    vo2max: d.emphasis.vo2max,
    anaerobic: d.emphasis.anaerobic,
    limiterVo2: a.limiters.includes('vo2max') ? 1 : 0,
    limiterTopEnd: a.limiters[0] === 'vo2max' || a.limiters[0] === 'anaerobic' ? 1 : 0,
  };
  const scoresMoved = req.keepQuality ? qualityMoved(req.keepQuality.scores, qualityScores) : true;
  if (req.keepQuality && !scoresMoved) decisions.push('Quality sessions already on the calendar are kept: what decides them (the goal’s emphasis and your limiters) has not moved enough since the plan was made to justify a change.');

  const costs = {
    afterLong: a.afterLongRide.confidence === 'none' ? 0.3 : a.afterLongRide.value,
    afterHard: a.afterHardRide.confidence === 'none' ? 0.3 : a.afterHardRide.value,
    afterStrength: a.afterStrength.confidence === 'none' ? 0.3 : a.afterStrength.value,
  };
  const library = shopLibrary(req.basis, av.equipment, req.ownWorkouts ?? []);
  // Variety: what was picked in the last three weeks, from this run and from the calendar before it.
  const picks: Array<{ date: string; id: string }> = [...(req.recentPicks ?? [])];
  const recentFor = (weekStart: string) => {
    const m = new Map<string, number>();
    for (const p of picks) {
      if (p.date >= weekStart || p.date < addDays(weekStart, -21)) continue;
      const ago = Math.ceil((Date.parse(weekStart) - Date.parse(p.date)) / (7 * 864e5));
      m.set(p.id, Math.min(m.get(p.id) ?? 9, ago));
    }
    return m;
  };
  const ctxBase = { basis: req.basis, equipment: av.equipment, may, prefs: { ...DEFAULT_PREFS, ...av.prefs, ...req.prefs }, costs, masters: req.masters, library,
    eventDate: goal.kind === 'event' ? goal.date : undefined, requiredLongest: d.requiredLongest };

  const weeks: PlanWeek[] = [];
  let longestPlanned = 0;
  let saidHardDropped = false;
  let saidTwoLongs = false;
  // The test: wanted once, when the FTP in use looks unverified, in the first week that can hold it; a test already on
  // the calendar since the plan's first day is the test.
  let testPending = a.ftpStatus.value !== 'fresh' && goal.kind !== 'weight' && !(req.pastSessions ?? []).some((x) => x.workout.family === 'test');
  let saidTest = false;
  let firstShopped = true;

  seq.forEach((phase, i) => {
    const weekStart = addDays(req.start, i * 7);
    if (i < pastWeeks) return;
    // A test the first week could not hold (a plan starting late in the week) moves to the next.
    const need = { ...needs.weeks[i], test: testPending, hardSessions: testPending ? Math.max(1, needs.weeks[i].hardSessions) : needs.weeks[i].hardSessions };
    const refit = i === currentIdx && addDays(weekStart, 7) > req.notBefore! && weekStart <= req.notBefore!;
    const isAway = (date: string) => (req.away ?? []).some((r) => date >= r.from && date <= r.to);
    // Placing a plan, the days before today are gone. Re-checking the week under way, only the days before the plan's
    // first day are gone (as they were when it was placed); from then until today the calendar's sessions stand (below).
    const gone = (date: string) => (refit ? !!req.planStart && date < req.planStart : !!req.notBefore && date < req.notBefore) || isAway(date);
    if (need.mostlyAway) decisions.push(`Week of ${new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} is mostly away (${awayDays[i]} of 7 days): kept light, and the block picks up again after it.`);

    const slots: Slot[] = [];
    for (let k = 0; k < 7; k++) {
      const date = addDays(weekStart, k);
      const dw = dow(date);
      if (gone(date)) continue;
      slots.push({ dow: dw, date, minutes: (av.hours[dw] ?? 0) * 60, outdoor: av.outdoor[dw] ?? false, noBike: !!av.noBike?.[dw], pin: pinOf(dw), never: (av.never ?? []).filter((x) => x.dow === dw).map((x) => x.kind) });
    }
    const held = req.keepQuality && !scoresMoved ? req.keepQuality.byWeek[weekStart]?.filter((q) => q !== 'test') as Family[] | undefined : undefined;
    const fixedSessions = refit ? (req.pastSessions ?? []).filter((x) => x.date >= weekStart && x.date < req.notBefore! && !gone(x.date)) : [];
    const shop = shopWeek(need, slots, { ...ctxBase, recent: recentFor(weekStart), heldFamilies: held?.length ? held : undefined }, refit ? { before: req.notBefore!, sessions: fixedSessions } : undefined);
    let sessions = refit ? [...fixedSessions, ...shop.sessions] : shop.sessions;
    if (sessions.some((x) => x.type === 'test' || x.workout.family === 'test')) testPending = false;
    if (need.test && sessions.some((x) => x.type === 'test') && !saidTest) { saidTest = true; decisions.push(`A test ${i === 0 ? 'in week 1' : 'in the first full week'} because ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)} Later tests are added only when your rides suggest the number has moved.`); }
    const hardPlaced = sessions.filter((x) => x.kind === 'ride' && ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'].includes(x.type)).length;
    if (!saidHardDropped && hardPlaced < need.hardSessions && slotsAll.length >= 3) { saidHardDropped = true; decisions.push('Some weeks carry one hard session instead of two: the only free day for a second one sits right after a hard or long day, and zone 2 there does more good than a compromised interval session.'); }
    if (firstShopped) { firstShopped = false; firstWeekDecisions(decisions, i, need, sessions, a, goal, av, may); }
    const longs = sessions.filter((x) => x.type === 'long');
    if (!saidTwoLongs && longs.length >= 2) {
      saidTwoLongs = true;
      const [h1, h2] = longs.map((x) => av.hours[dow(x.date)]).sort((p, q) => q - p);
      decisions.push(`Two long rides a week: you have ${hoursText(h1)} and ${hoursText(h2)} on the two biggest days, the goal rewards durability, and ${a.afterLongRide.confidence === 'none' ? 'nothing in the data yet says long days cost you much, so the second is kept a little shorter until there is evidence' : costs.afterLong < 0.15 ? 'your mornings after long rides look like any other, so both can be full length' : 'your mornings after long rides are a little flatter, so the second is shorter'}.`);
    }

    if (refit) sessions = refitWeek(sessions, weekStart, req, library, slots);
    for (const x of sessions) picks.push({ date: x.date, id: x.workout.libraryId ?? x.workout.id });
    if (sessions.length === 0 && awayDays[i] === 0) return;   // a first week already over; a week away stays, empty, so the timeline keeps its shape
    for (const s of sessions) if (s.type === 'long' && s.seconds > longestPlanned) longestPlanned = s.seconds;
    const total = sessions.reduce((s, x) => s + x.tss, 0);
    weeks.push({
      index: i + 1, start: weekStart, phase, label: weekLabel(phase, seq, i), targetTss: Math.round(need.budgetTss), tss: Math.round(total),
      hours: Math.round(sessions.reduce((s, x) => s + x.seconds, 0) / 360) / 10, sessions,
      note: awayDays[i] >= 7 ? 'Away all week: nothing planned.' : need.mostlyAway ? `Away ${awayDays[i]} of 7 days: a light week.` : PHASE_NOTE[phase],
      needs: need, summary: weekSummary(i + 1, sessions, shop.restDates.filter((dt) => !refit || dt >= req.notBefore!).length), unmet: shop.unmet,
    });
  });

  // Projection and verdict.
  const goalDate = goal.kind === 'event' ? goal.date : addDays(req.start, n * 7 - 1);
  const loads = weeks.flatMap((w) => w.sessions.map((s) => ({ date: s.date, tss: s.tss })));
  // Today's fitness is where the line starts: from the first day for a new plan, from today for a
  // plan under way (its past weeks are history, already in today's fitness, not days of zero load).
  // A plan placed mid-week starts its line today too (30 Oct 2026): from the Monday, today's fitness would be decayed
  // across days already gone, and the line would sit a few points under the rider from the first day.
  const projFrom = req.notBefore && req.notBefore > req.start ? req.notBefore : req.start;
  const projection = fitnessSeries(loads, projFrom, goalDate, { ctl: a.fitness.ctl, atl: a.fitness.atl });
  const taperStart = weeks.find((w) => w.phase === 'taper')?.start;
  const peakPoint = taperStart ? projection.find((f) => f.date === taperStart) : projection[projection.length - 1];
  const projectedCtl = Math.round(peakPoint?.ctl ?? a.fitness.ctl);
  const formOnDay = Math.round(projection[projection.length - 1]?.tsb ?? 0);
  let verdict: Plan['verdict'] = 'no-target';
  if (d.requiredCtl > 0) verdict = projectedCtl >= d.requiredCtl ? 'on-track' : projectedCtl >= d.requiredCtl * 0.9 ? 'close' : 'short';
  const advice = buildAdvice(verdict, d, projectedCtl, longestPlanned, formOnDay, goal, n, capTss, weeks);
  return { weeks, demand: d, projection, goalDate, requiredCtl: d.requiredCtl, projectedCtl, formOnDay, longestPlanned, verdict, advice, decisions, qualityScores };
}

/** The Library the plan shops from, for the rider's basis and equipment, with their own workouts alongside. */
export function shopLibrary(basis: Basis, equipment: Equipment[], own: Workout[]): ShopLibrary {
  const eq = equipment.length ? equipment : (['bodyweight'] as Equipment[]);
  const ready = readyMadeSessions(eq);
  const openers = (w: Workout) => w.name === 'Openers' || w.subtitle === 'Openers';
  return {
    // Openers are power-only wherever they come from (one-minute efforts cannot be held by heart rate), so the basis does not restrict them.
    rides: [...own.filter((w) => w.kind === 'ride'), ...LIBRARY].filter((w) => w.bases.includes(basis) || openers(w)),
    strength: ready.filter((w) => w.kind === 'strength' && w.strength),
    mobility: [...own.filter((w) => w.kind === 'mobility'), ...ready.filter((w) => w.kind === 'mobility')],
    walks: ready.filter((w) => w.kind === 'walk'),
    runs: ready.filter((w) => w.kind === 'run'),
  };
}

/** The reasoning for the first week planned: why strength, foot work and mobility sit where they do. */
function firstWeekDecisions(decisions: string[], i: number, need: WeekNeeds, sessions: PlannedSession[], a: Assessment, goal: Goal, av: Availability, may: MaySchedule): void {
  if (i === 0 && !need.test && a.ftpStatus.confidence !== 'none' && goal.kind !== 'weight') decisions.push(`No test scheduled: ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)}`);
  const strength = sessions.filter((x) => x.kind === 'strength');
  if (may.strength || strength.length) decisions.push(strength.length
    ? `Strength ${strength.length === 2 ? 'twice' : strength.length === 1 ? 'once' : `${strength.length} times`} a week to start, placed on days that do not fight the rides (${strength.map((x) => DAY[dow(x.date)]).join(' and ')} this week), from the Library sessions your equipment allows. The day before a hard ride is avoided in proportion to ${a.afterStrength.confidence === 'none' ? 'an assumed mild cost; there is no data yet on how you recover from lifting' : 'what your mornings after lifting show'}.`
    : 'No strength session fitted this week: every day with time is already carrying a hard or long ride. Adding 30 minutes on a rest day would make room.');
  const runs = sessions.filter((x) => x.kind === 'run');
  if (may.run) decisions.push(runs.length
    ? `Runs take the ${runs.length === 1 ? 'day' : 'days'} a ride cannot use (${runs.map((x) => DAY[dow(x.date)]).join(', ')}): easy, by heart rate, never the day before a hard ride or the day after the long one; at most two a week in base, one when the riding gets hard, none in the last week before the event.`
    : 'Runs are on, but no day this week has a run: a run needs a day of 25 minutes or more that a ride cannot use, not the day before a hard ride or the day after the long one.');
  const walks = sessions.filter((x) => x.kind === 'walk');
  if (walks.length) decisions.push(`Walks fill the ${walks.length === 1 ? 'day' : 'days'} a ride cannot use (${walks.map((x) => DAY[dow(x.date)]).join(', ')}): easy, with no minimum heart rate and a ceiling at the top of zone 2, with a light pack later in the block.`);
  if (may.mobility) decisions.push('Mobility is attached to the long ride and to strength days, while the muscles are warm, which is when stretching does the most and costs the least; a rest day takes a short session when the week needs more.');
  void av;
}

/** "Week 8: 3½ hours easy, a 3-hour long ride with tempo late, two hard days (threshold, VO2max), one strength session, mobility, one rest day." */
export function weekSummary(index: number, sessions: PlannedSession[], restDays: number): string {
  const parts: string[] = [];
  const rides = sessions.filter((x) => x.kind === 'ride');
  const long = rides.filter((x) => x.type === 'long');
  const easyMin = rides.filter((x) => x.type === 'endurance' || x.type === 'recovery').reduce((s, x) => s + x.seconds / 60, 0);
  const hard = rides.filter((x) => ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic'].includes(x.type));
  const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  const count = (n: number, one: string, many = one + 's') => `${NUM[n] ?? n} ${n === 1 ? one : many}`;
  if (easyMin >= 20) parts.push(`${hoursWords(easyMin)} easy`);
  for (const l of long) {
    const c = contribution(l.workout);
    const h = hoursWords(l.seconds / 60).replace(/ hours$/, '-hour').replace(/^an hour$/, 'one-hour');
    parts.push(`a ${h} long ride${c.at.tempo + c.at.sweetspot >= 10 ? ' with tempo late' : ''}`);
  }
  const WORD: Record<string, string> = { tempo: 'tempo', sweetspot: 'sweet spot', threshold: 'threshold', vo2max: 'VO2max', anaerobic: 'sprints' };
  if (hard.length) parts.push(`${count(hard.length, 'hard day')} (${[...new Set(hard.map((x) => WORD[x.type]))].join(', ')})`);
  if (sessions.some((x) => x.type === 'test')) parts.push('a test');
  if (sessions.some((x) => x.type === 'openers')) parts.push('openers');
  const strength = sessions.filter((x) => x.kind === 'strength').length;
  if (strength) parts.push(count(strength, 'strength session'));
  const walks = sessions.filter((x) => x.kind === 'walk').length;
  if (walks) parts.push(count(walks, 'walk'));
  const runs = sessions.filter((x) => x.kind === 'run').length;
  if (runs) parts.push(count(runs, 'easy run'));
  if (sessions.some((x) => x.kind === 'mobility')) parts.push('mobility');
  if (restDays) parts.push(count(restDays, 'rest day'));
  return `Week ${index}: ${parts.length ? parts.join(', ') : 'nothing planned'}.`;
}

/**
 * The week under way, re-checked: start from the week exactly as intended, then respond to what was
 * actually done. Load beyond what the days gone asked for comes off the days left (at most half of
 * them), and the day after a big or hard day is an easy spin. Load not done is not added: a missed
 * session is not crammed into the rest of the week. With everything done as planned, nothing changes.
 */
function refitWeek(sessions: PlannedSession[], weekStart: string, req: PlanRequest, library: ShopLibrary, slots: Slot[]): PlannedSession[] {
  const notBefore = req.notBefore!;
  const doneSoFar = (req.done ?? []).filter((x) => x.date >= weekStart && x.date < addDays(weekStart, 7));
  const doneTss = doneSoFar.reduce((s, x) => s + x.tss, 0);
  const targetTss = sessions.reduce((s, x) => s + x.tss, 0);
  const plannedGone = sessions.filter((x) => x.date < notBefore).reduce((s, x) => s + x.tss, 0);
  // A little over the estimates (an effort-rated lift, a ride run long) is normal and changes nothing.
  const excess = Math.max(0, doneTss - plannedGone - Math.max(25, 0.15 * targetTss));
  // A big day is judged against what that day planned, never by a fixed size: well over the day's plan
  // (60 TSS or half as much again, and 120 in all), or a long ride (2.5 hours) on a day that had no ride planned.
  const plannedOn = (date: string) => sessions.filter((x) => x.date === date).reduce((s, x) => s + x.tss, 0);
  const rideOnDay = (date: string) => sessions.some((x) => x.date === date && x.kind === 'ride');
  const days = [...new Set(doneSoFar.map((x) => x.date))];
  const big = days.filter((date) => {
    const items = doneSoFar.filter((x) => x.date === date);
    const done = items.reduce((s, x) => s + x.tss, 0), planned = plannedOn(date);
    const over = done >= 120 && (done - planned >= 60 || (planned > 0 && done >= 1.5 * planned));
    const unplannedLong = !rideOnDay(date) && items.some((x) => (x.kind ?? 'ride') === 'ride' && x.seconds >= 2.5 * 3600);
    return over || unplannedLong;
  }).sort().pop();
  const out = [...sessions];
  const slotOf = (date: string) => slots.find((s) => s.date === date);
  const fits = (w: Workout, date: string) => { const s = slotOf(date); return !!s && contribution(w).minutes <= s.minutes + 2 && (!s.outdoor || (w.setting !== 'indoor' && !w.trainerOnly)); };
  if (big) {
    const easyDay = addDays(big, 1);
    for (let k = 0; k < out.length; k++) {
      const x = out[k];
      if (x.date !== easyDay || x.kind !== 'ride' || x.type === 'recovery') continue;
      const spin = library.rides.filter((w) => w.family === 'recovery' && !/openers/i.test(w.subtitle ?? w.name) && contribution(w).minutes <= 45 && fits(w, x.date))
        .sort((p, q) => contribution(q).minutes - contribution(p).minutes)[0];
      if (!spin) continue;
      const c = contribution(spin);
      out[k] = { ...x, type: 'recovery', workout: spin, seconds: Math.round(c.minutes * 60), tss: Math.round(c.tss), reason: `Easy: the day after a big day (${new Date(big + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })}). Spin the legs, nothing more.` };
    }
  }
  if (excess > 0) {
    const leftTss = () => out.filter((x) => x.date >= notBefore).reduce((s, x) => s + x.tss, 0);
    const intendedLeft = sessions.filter((x) => x.date >= notBefore).reduce((s, x) => s + x.tss, 0);
    const want = Math.max(intendedLeft * 0.5, intendedLeft - excess);
    // Shorter easy rides in place of the days left (no ride is cut below half its planned length), the biggest cut first.
    for (let pass = 0; pass < 8 && leftTss() > want; pass++) {
      let bestK = -1, best: Workout | null = null, bestCut = 0;
      out.forEach((x, k) => {
        if (x.date < notBefore || x.kind !== 'ride' || !(x.type === 'endurance' || x.type === 'long')) return;
        const planned = sessions[k].seconds / 60;
        const floor = Math.max(x.type === 'long' ? 60 : 30, planned * 0.5);
        for (const w of library.rides) {
          if (w.family !== 'endurance' || !fits(w, x.date)) continue;
          const c = contribution(w);
          if (c.minutes < floor - 1 || c.tss >= x.tss) continue;
          const cut = Math.min(x.tss - c.tss, leftTss() - want);
          if (cut > bestCut) { bestCut = cut; bestK = k; best = w; }
        }
      });
      if (bestK < 0 || !best) break;
      const c = contribution(best);
      out[bestK] = { ...out[bestK], workout: best, seconds: Math.round(c.minutes * 60), tss: Math.round(c.tss) };
    }
  }
  // Only the days left are planned; what was on the days gone is history.
  return out.filter((x) => x.date >= notBefore);
}

function weekLabel(phase: Phase, seq: Phase[], i: number): string {
  const name = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', recovery: 'Recovery' }[phase];
  if (phase === 'recovery' || phase === 'taper') return name;
  return `${name} ${seq.slice(0, i + 1).filter((p) => p === phase).length}`;
}

const PHASE_NOTE: Record<Phase, string> = {
  base: 'Long rides and sweet spot build the aerobic engine with manageable fatigue; each week adds a little.',
  build: 'Threshold work raises FTP; a second quality day appears where the days allow; the long ride keeps growing.',
  peak: 'Shorter, sharper work above threshold; volume eases so the hard days land fresh.',
  taper: 'Volume drops by half, intensity stays in small doses, and form rises for the day.',
  recovery: 'Load drops to about sixty percent so the last two weeks turn into fitness.',
};

function buildAdvice(v: Plan['verdict'], d: Demand, projected: number, longest: number, form: number, goal: Goal, n: number, capTss: number, weeks: PlanWeek[]): string {
  const parts: string[] = [];
  if (v === 'no-target') parts.push(goal.kind === 'weight'
    ? 'No fitness target for a weight goal: the scoreboard is hours ridden and a modest, steady energy deficit you can keep. The plan keeps most riding easy and long so appetite stays level.'
    : 'No single number to hit for general fitness; the fitness chart is the scoreboard.');
  else if (v === 'on-track') parts.push(`On track: fitness should reach about ${projected} at the start of the taper, and the goal wants roughly ${d.requiredCtl}.`);
  else {
    const gap = d.requiredCtl - projected;
    const capped = weeks.some((w) => w.targetTss >= capTss * 0.98);
    parts.push(`${v === 'close' ? 'Close' : 'Short'}: fitness should reach about ${projected} against a goal that wants roughly ${d.requiredCtl}.`);
    parts.push(capped ? `Your available hours are the ceiling; about ${Math.ceil(gap / 4)} more hour${gap > 4 ? 's' : ''} a week would close the gap, or ${Math.ceil(gap / 2.5)} more week${gap > 2.5 ? 's' : ''} (${n} planned now).` : `Following the plan as written is the first fix; if that holds, ${Math.ceil(gap / 2.5)} more week${gap > 2.5 ? 's' : ''} would close the rest.`);
  }
  if (d.requiredLongest) parts.push(longest >= d.requiredLongest * 0.95
    ? `The longest planned ride reaches ${hm(longest)}, which covers the ${hm(d.requiredLongest)} the goal wants.`
    : `The longest planned ride is ${hm(longest)}; the goal wants about ${hm(d.requiredLongest)} before the taper, so a longer slot on the big day would help.`);
  if (goal.kind === 'event') parts.push(form >= 5 && form <= 25 ? `Form on the day projects at ${form > 0 ? '+' : ''}${form}, inside the fresh window.` : `Form on the day projects at ${form > 0 ? '+' : ''}${form}; the taper will be adjusted as the date nears.`);
  return parts.join(' ');
}
