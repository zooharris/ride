import type { Assessment } from './assessment';
import { hm } from './assessment';
import { demand, hoursText, type Demand, type Goal } from './goals';
import { generateSession, type SessionIntent, type SessionType } from './generate';
import { generateMobility, generateRun, generateStrength, generateWalk, type StrengthLevel } from './sessions';
import { addDays, fitnessSeries } from './load';
import type { Basis, Equipment, Fitness, Profile, SessionKind, Workout } from './types';
import { workoutStats } from './workout';
import { poorFit, sizeOf, snap } from './snap';

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
  layout?: Array<{ start: string; phase: Phase }>;
  /** The rider's own saved workouts, offered to the planner alongside the Library (Batch 6, B1). The plan never adds to them. */
  ownWorkouts?: Workout[];
  /** Build the sessions as generated, without the Library: plans as they were made before 23 Oct 2026 (tests of the move). */
  noSnap?: boolean;
  /** What the rider has actually done this week up to today, planned or not, so the days left can respond to it. */
  done?: Array<{ date: string; tss: number; seconds: number; intensity?: number; kind?: SessionKind }>;
}

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';

export interface PlannedSession { date: string; kind: SessionKind; type: SessionType | 'strength' | 'mobility' | 'walk' | 'run'; workout: Workout; seconds: number; tss: number; reason: string }
export interface PlanWeek { index: number; start: string; phase: Phase; label: string; targetTss: number; tss: number; hours: number; sessions: PlannedSession[]; note: string }

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
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateOfSlot = (weekStart: string, slot: number) => addDays(weekStart, (slot - dow(weekStart) + 7) % 7);
const KIND_ORDER: Record<SessionKind, number> = { ride: 0, walk: 1, run: 1, strength: 2, mobility: 3, other: 4 };
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
  // Standing commitments: a day pinned to rest carries nothing; a day pinned to strength,
  // a walk or mobility is kept clear of rides; a day pinned to a ride always gets one.
  const pinOf = (dw: number): SessionKind | 'rest' | undefined => (av.pins ?? []).find((p) => p.dow === dw)?.kind;
  // "Never" for a day and kind; a pin ("Always") for the same day and kind is the stronger word.
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
  const canWalk = may.walk;
  const canRun = may.run;
  const pinned = (kind: SessionKind) => (av.pins ?? []).filter((p) => p.kind === kind).map((p) => p.dow);

  // Load trajectory. Fitness moves by (daily load - fitness) / 42 each day, so a
  // week averaging D a day moves it by about (D - fitness) / 6. To climb by Δ in
  // a week needs D = fitness + 6Δ. The ramp is capped for safety and raised a
  // little when the evidence says the rider absorbs load well.
  const ctl0 = a.fitness.ctl;
  const isLoading = (p: Phase) => p === 'base' || p === 'build' || p === 'peak';
  const loadingWeeks = seq.filter(isLoading).length;
  const loadingLeft = seq.slice(pastWeeks).filter(isLoading).length;
  let maxRamp = req.masters ? 4 : 6;
  if (a.afterLongRide.confidence !== 'none' && a.afterLongRide.value < 0.2 && a.compliance.value >= 0.8) maxRamp += 1;
  if (a.rampRate.confidence === 'good' && a.rampRate.value > maxRamp) maxRamp = Math.min(maxRamp + 2, a.rampRate.value);
  const needRamp = d.requiredCtl ? (d.requiredCtl - ctl0) / Math.max(1, loadingLeft) : 2.5;
  const ramp = Math.max(1, Math.min(maxRamp, needRamp));
  decisions.push(`Fitness ${d.requiredCtl ? `needs to rise from ${Math.round(ctl0)} toward ${d.requiredCtl}` : `starts at ${Math.round(ctl0)}`}; the plan climbs about ${ramp.toFixed(1)} points a week (cap ${maxRamp}${maxRamp > (req.masters ? 4 : 6) ? ', raised because your recovery data look good' : ''}).`);
  if (needRamp > maxRamp) decisions.push(`The goal would want ${needRamp.toFixed(1)} a week, which is more than is safe; the verdict below says what that means.`);

  const weeks: PlanWeek[] = [];
  let ctl = ctl0;
  let lastLoading = Math.max(a.weeklyTss.value, ctl0 * 7);
  let phaseIdx = 0;
  let lastPhase: Phase | null = null;
  const blockLengths = countBlocks(seq);
  const afterStrengthPenalty = a.afterStrength.confidence === 'none' ? 0.3 : a.afterStrength.value;
  const afterLongPenalty = a.afterLongRide.confidence === 'none' ? 0.3 : a.afterLongRide.value;
  const afterHardPenalty = a.afterHardRide.confidence === 'none' ? 0.3 : a.afterHardRide.value;
  // Fatigue evidence acts inside the week (an easier day after a hard one, a slightly
  // lower weekly target), not by multiplying recovery weeks. Only solid evidence counts.
  const flat = a.afterLongRide.confidence === 'good' && a.afterLongRide.value >= 0.6 && a.afterHardRide.confidence === 'good' && a.afterHardRide.value >= 0.6;
  const loadScale = flat ? 0.9 : 1;
  if (flat) decisions.push(`Weekly load is set 10% under what the ramp would ask: your mornings after long rides (score ${a.afterLongRide.value.toFixed(2)}) and after hard rides (${a.afterHardRide.value.toFixed(2)}) are clearly flatter than your baseline, and easy days follow hard ones. If those scores improve, the plan removes the discount when it re-checks.`);
  const startLongest = Math.max(90, Math.round((a.longestRide.confidence === 'none' ? 7200 : a.longestRide.value) / 60));
  let longestPlanned = 0;
  let saidTwoLongs = false;
  const saidPoorFit = new Set<string>();   // B2.2: one line per family per plan
  const saidNoCandidate = new Set<string>();   // B2.3
  let saidDropped = false;
  let loadingSeen = 0;

  seq.forEach((phase, i) => {
    phaseIdx = phase === lastPhase ? phaseIdx + 1 : 0;
    lastPhase = phase;
    const weekStart = addDays(req.start, i * 7);
    if (i < pastWeeks) { if (isLoading(phase)) loadingSeen++; return; }
    // The week under way, when re-checking: laid out as it was intended (so nothing moves for no
    // reason), then the days left are fitted to what remains after what was actually done.
    const refit = i === currentIdx && addDays(weekStart, 7) > req.notBefore! && weekStart <= req.notBefore!;
    const isAway = (slot: number) => (req.away ?? []).some((r) => { const d = dateOfSlot(weekStart, slot); return d >= r.from && d <= r.to; });
    const gone = (slot: number) => (!refit && req.notBefore ? dateOfSlot(weekStart, slot) < req.notBefore : false) || isAway(slot);
    const awayDays = awayDaysInWeek(weekStart, req.away);
    const blockLen = blockLengths[i];
    const progress = blockLen > 1 ? phaseIdx / (blockLen - 1) : 1;
    const loadingProgress = loadingWeeks > 1 ? loadingSeen / (loadingWeeks - 1) : 1;

    const daysThisWeek = daysWithTime.filter((d) => !gone(d));
    const slotsThisWeek = slotsAll.filter((d) => !gone(d));

    // Weekly load target. A week mostly away is kept light rather than crammed into the days left.
    let targetTss: number;
    const mostlyAway = awayDays >= 5 || (awayDays > 0 && daysWithTime.filter((d) => !isAway(d)).length <= 2);
    if (mostlyAway && phase !== 'recovery' && phase !== 'taper') {
      targetTss = lastLoading * 0.6;
      decisions.push(`Week of ${new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} is mostly away (${awayDays} of 7 days): kept light, and the block picks up again after it.`);
    } else if (phase === 'recovery') targetTss = lastLoading * 0.6;
    else if (phase === 'taper') targetTss = lastLoading * (phaseIdx === 0 && seq.filter((p) => p === 'taper').length === 2 ? 0.55 : 0.45);
    else { ctl += ramp; targetTss = Math.min(capTss, 7 * (ctl + 6 * ramp)) * loadScale; lastLoading = targetTss; loadingSeen++; }

    // Session mix for the week.
    const isTest = i === 0 && a.ftpStatus.value !== 'fresh' && goal.kind !== 'weight';
    if (isTest && i === 0) decisions.push(`A test in week 1 because ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)} Later tests are added only when your rides suggest the number has moved.`);
    if (i === 0 && !isTest && a.ftpStatus.confidence !== 'none') decisions.push(`No test scheduled: ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)}`);
    const quality: SessionType[] = [];
    if (phase === 'base') { quality.push(goal.kind === 'weight' ? 'tempo' : 'sweetspot'); if (slotsThisWeek.length >= 5 && (a.limiters[0] === 'vo2max' || a.limiters[0] === 'anaerobic')) quality.push('tempo'); }
    if (phase === 'build') {
      // The goal weights the choice; the rider's limiter can override it. A weight or
      // endurance goal leans sub-threshold, but a rider whose data say threshold is the
      // limiter still gets threshold work, because a higher FTP makes every easy ride cheaper.
      const wantsThreshold = d.emphasis.threshold * 1.6 + (a.limiters[0] === 'threshold' ? 0.8 : 0) >= 1;
      const wantsVo2 = a.limiters.includes('vo2max') && d.emphasis.vo2max >= 0.6;
      quality.push(wantsVo2 ? 'vo2max' : wantsThreshold ? 'threshold' : 'sweetspot');
      if (slotsThisWeek.length >= 4) quality.push(quality[0] === 'sweetspot' ? 'tempo' : 'sweetspot');
    }
    if (phase === 'peak') { quality.push(d.emphasis.anaerobic >= 0.8 ? 'anaerobic' : d.emphasis.vo2max >= 0.5 || a.limiters.includes('vo2max') ? 'vo2max' : 'threshold'); if (slotsThisWeek.length >= 4) quality.push('threshold'); }
    if (phase === 'taper') quality.push('openers');
    if (isTest) quality[0] = 'test';

    // Long rides: as many as the slots and the evidence allow.
    const bySize = [...slotsThisWeek].sort((x, y) => av.hours[y] - av.hours[x]);
    const longCandidates = bySize.filter((s) => av.hours[s] >= 2);
    const targetLongest = d.requiredLongest ? Math.round(d.requiredLongest / 60) : Math.round(Math.max(startLongest, (av.hours[bySize[0]] ?? 1) * 60));
    let longMinutes = phase === 'recovery' ? Math.min(100, startLongest) : phase === 'taper' ? Math.min(120, targetLongest * 0.5) : Math.round(lerp(startLongest, targetLongest, loadingProgress));
    longMinutes = Math.min(longMinutes, (av.hours[longCandidates[0] ?? bySize[0]] ?? 1) * 60);
    // Two long days when two big slots exist, the goal rewards durability, and the
    // evidence says long days do not leave the rider flat. The second ride is
    // sized by that same evidence: a rider who bounces back gets two full rides;
    // one who feels long days gets a shorter second one.
    const twoLongs = longCandidates.length >= 2 && d.emphasis.durability >= 0.8 && afterLongPenalty < 0.45 && phase !== 'taper' && phase !== 'recovery' && av.hours[longCandidates[1]] >= 2;
    const longSlots = twoLongs ? longCandidates.slice(0, 2) : longCandidates.slice(0, 1);
    const secondScale = 1 - afterLongPenalty;
    if (twoLongs && !saidTwoLongs) { saidTwoLongs = true; decisions.push(`Two long rides a week: you have ${hoursText(av.hours[longCandidates[0]])} and ${hoursText(av.hours[longCandidates[1]])} on the two biggest days, the goal rewards durability, and ${a.afterLongRide.confidence === 'none' ? 'nothing in the data yet says long days cost you much, so the second is kept a little shorter until there is evidence' : afterLongPenalty < 0.15 ? 'your mornings after long rides look like any other, so both can be full length' : 'your mornings after long rides are a little flatter, so the second is shorter'}.`); }

    const used = new Set<number>(longSlots);
    const plan: Array<{ slot: number; intent: SessionIntent }> = [];
    longSlots.forEach((slot, k) => {
      const mins = k === 0 ? longMinutes : Math.round(Math.min(av.hours[slot] * 60, longMinutes * secondScale));
      const reason = phase === 'recovery' ? 'Recovery week: the long ride stays so the body remembers, but shorter and easy.'
        : phase === 'taper' ? 'Taper: enough riding to stay sharp, not enough to add fatigue.'
        : d.requiredLongest ? `Building toward one ride of ${hoursText(d.requiredLongest / 3600)} before the taper${k ? '; the second long day of the week' : ''}. Steady zone 2, fuel from the first half hour.`
        : `The long ride is where aerobic durability is built${k ? '; the second long day of the week' : ''}. Steady zone 2, fuel from the first half hour.`;
      plan.push({ slot, intent: { type: phase === 'recovery' ? 'endurance' : 'long', minutes: mins, progression: progress, outdoor: av.outdoor[slot] ?? true, reason } });
    });

    // Quality sessions placed by cost.
    const hardDays = new Set<number>();
    for (const q of quality) {
      const candidates = slotsThisWeek.filter((s) => !used.has(s) && av.hours[s] >= 0.9);
      if (candidates.length === 0) break;
      const cost = (s: number) => {
        let c = 0;
        if (hardDays.has((s + 6) % 7)) c += 0.5 + afterHardPenalty * 3;
        if (longSlots.includes((s + 6) % 7)) c += 0.5 + afterLongPenalty * 3;
        if (hardDays.has((s + 1) % 7)) c += 0.5 + afterHardPenalty * 2;
        if (longSlots.includes((s + 1) % 7)) c += 0.5 + afterLongPenalty * 1.5;
        if (pinned('strength').includes((s + 6) % 7)) c += afterStrengthPenalty * 3;
        if (av.hours[s] < 1.5) c += 0.5;
        return c;
      };
      const slot = [...candidates].sort((x, y) => cost(x) - cost(y))[0];
      // A second hard day that can only land somewhere costly is not worth having; the hours go to zone 2 instead.
      if (hardDays.size > 0 && cost(slot) >= 2.5) { if (!saidDropped) { saidDropped = true; decisions.push('Some weeks carry one hard session instead of two: the only free day for a second one sits right after strength or another hard day, and zone 2 there does more good than a compromised interval session.'); } break; }
      used.add(slot); hardDays.add(slot);
      const mins = Math.min(av.hours[slot] * 60, q === 'test' ? 75 : q === 'openers' ? 45 : Math.round(lerp(60, 105, progress)));
      const reason = q === 'test' ? `Start of a ${phase} block: a test sets the numbers every target in the block is built on.`
        : q === 'openers' ? 'The day before the event: short efforts to wake the legs without adding fatigue.'
        : QUALITY_REASON[q](phase, a);
      plan.push({ slot, intent: { type: q, minutes: mins, progression: progress, outdoor: av.outdoor[slot] ?? false, reason } });
    }

    // Fillers: endurance where there is at least 45 minutes; easy spin the day after a long ride if long days cost you.
    for (const s of slotsThisWeek) {
      if (used.has(s) || (av.hours[s] * 60 < 45 && pinOf(s) !== 'ride')) continue;
      const afterLong = longSlots.includes((s + 6) % 7);
      const easy = afterLong && afterLongPenalty >= 0.4;
      used.add(s);
      plan.push({ slot: s, intent: { type: easy ? 'recovery' : 'endurance', minutes: Math.min(av.hours[s] * 60, easy ? 45 : 120), progression: progress, outdoor: av.outdoor[s] ?? false, reason: easy ? 'Easy spin the day after a long ride, because your data say long days leave a dent.' : 'Zone 2 hours: the quiet work that makes everything else possible.' } });
    }

    // ---- Strength, walks and mobility: allocated by the app, never asked for. ----
    const extra: PlannedSession[] = [];
    const rideOn = new Map<number, SessionIntent>(plan.map((p) => [p.slot, p.intent]));
    const hardOn = (dw: number) => hardDays.has(dw);
    const longOn = (dw: number) => longSlots.includes(dw);
    const dateOf = (slot: number) => addDays(weekStart, (slot - dow(weekStart) + 7) % 7);

    // How much strength this week, and how heavy. Masters riders lose muscle and
    // tendon strength fastest, so they keep two sessions through base and build.
    let strengthCount = !may.strength ? 0 : phase === 'base' ? 2 : phase === 'build' ? (req.masters ? 2 : 1) : phase === 'peak' ? 1 : phase === 'taper' ? (phaseIdx === 0 ? 1 : 0) : 1;
    const pinnedStrengthDays = pinned('strength').filter((dw) => daysThisWeek.includes(dw));
    strengthCount = Math.max(strengthCount, pinnedStrengthDays.length);   // a standing commitment is kept even in weeks the plan would lift less
    const level: StrengthLevel = phase === 'base' ? (phaseIdx < 2 && i < 4 ? 'foundation' : 'build') : phase === 'build' ? (quality.length >= 2 ? 'maintain' : 'build') : phase === 'recovery' || phase === 'taper' ? 'light' : 'maintain';
    const strengthDays: number[] = [];
    const strengthCost = (dw: number) => {
      let c = 0;
      if (hardOn(dw)) c += 5;                                            // never on the same day as intervals
      if (hardOn((dw + 1) % 7)) c += 1 + afterStrengthPenalty * 3;         // the day before a hard ride, scaled by your data
      if (longOn((dw + 1) % 7)) c += 0.5 + afterStrengthPenalty * 2;
      if (longOn(dw)) c += 2;                                             // after a long ride the legs have had enough
      if (rideOn.has(dw)) c += 1;                                         // sharing a day with an easy ride is fine but not ideal
      if (strengthDays.includes((dw + 6) % 7) || strengthDays.includes((dw + 1) % 7)) c += 3;  // not on consecutive days
      if (pinned('strength').includes(dw)) c -= 6;                        // a standing commitment wins
      return c;
    };
    const strengthCandidates = () => daysThisWeek.filter((dw) => !strengthDays.includes(dw) && !never(dw, 'strength') && (may.strength || pinnedStrengthDays.includes(dw)) && (av.hours[dw] * 60 - (rideOn.get(dw)?.minutes ?? 0)) >= 25);
    for (let k = 0; k < strengthCount; k++) {
      const cands = strengthCandidates().sort((x, y) => strengthCost(x) - strengthCost(y));
      if (!cands.length) break;
      const dw = cands[0];
      if (strengthCost(dw) >= 4 && !pinnedStrengthDays.includes(dw)) break;
      strengthDays.push(dw);
      const freeMin = av.hours[dw] * 60 - (rideOn.get(dw)?.minutes ?? 0);
      const minutes = Math.round(Math.min(level === 'build' ? 50 : 40, Math.max(25, freeMin)));
      const reason = level === 'foundation' ? 'Early in the block: moderate loads to groove the movements before the weights go up.'
        : level === 'build' ? 'Heavier work while the riding is mostly steady; this is the time of year strength is built, not just kept.'
        : level === 'maintain' ? 'Maintenance: two short sets keep what the base block built while the hard riding takes the energy.'
        : 'Light and quick, so nothing is lost and nothing is added to fatigue.';
      const w = generateStrength({ level, minutes, equipment: av.equipment, variant: k === 0 ? 'A' : 'B', weekInBlock: phaseIdx, reason });
      extra.push({ date: dateOf(dw), kind: 'strength', type: 'strength', workout: w, seconds: minutes * 60, tss: w.estimatedTss ?? 0, reason });
    }
    if (i === 0 && (may.strength || strengthDays.length)) decisions.push(strengthDays.length
      ? `Strength ${strengthCount === 2 ? 'twice' : 'once'} a week in ${phase}, placed on days that do not fight the rides (${strengthDays.map((dw) => DAY[dw]).join(' and ')} this week), ${av.equipment.length ? 'built from the equipment you have' : 'bodyweight only, since no equipment is listed'}. The day before a hard ride is avoided in proportion to ${a.afterStrength.confidence === 'none' ? 'an assumed mild cost; there is no data yet on how you recover from lifting' : 'what your mornings after lifting show'}.`
      : 'No strength session fitted this week: every day with time is already carrying a hard or long ride. Adding 30 minutes on a rest day would make room.');

    // The days a ride cannot use (too short a window, or no bike): a run when runs are on and the
    // day is safe for one, otherwise a walk when walks are on.
    const footDay = (dw: number) => !rideOn.has(dw) && !strengthDays.includes(dw) && av.hours[dw] * 60 >= 25 && (!!av.noBike?.[dw] || av.hours[dw] * 60 < 45);

    // Runs (masters guards): never the day before a hard ride or the day after the long ride; at most
    // two a week in base, one in build, peak and recovery weeks, none in a taper or the last seven
    // days before an event. A day pinned to a run always gets one: the rider chose.
    const QUALITY_TYPES = ['sweetspot', 'threshold', 'vo2max', 'anaerobic'];
    const qualityOn = (dw: number) => QUALITY_TYPES.includes(rideOn.get(dw)?.type ?? '');
    const runCap = phase === 'base' ? 2 : phase === 'taper' ? 0 : 1;
    const nearEvent = (dw: number) => goal.kind === 'event' && dateOf(dw) > addDays(goal.date, -7);
    const pinnedRunDays = pinned('run').filter((dw) => daysThisWeek.includes(dw) && !rideOn.has(dw));
    const runDays: number[] = [...pinnedRunDays];
    if (canRun) {
      for (const dw of daysThisWeek) {
        if (runDays.filter((x) => !pinnedRunDays.includes(x)).length >= runCap) break;
        if (runDays.includes(dw) || !footDay(dw) || never(dw, 'run') || nearEvent(dw)) continue;
        if (qualityOn((dw + 1) % 7) || longOn((dw + 6) % 7)) continue;
        runDays.push(dw);
      }
    }
    let longRunDone = false;
    runDays.forEach((dw, k) => {
      const slot = Math.round(av.hours[dw] * 60);
      const pin = pinnedRunDays.includes(dw);
      const farFromLong = longSlots.every((l) => Math.min((dw - l + 7) % 7, (l - dw + 7) % 7) >= 2);
      const kind = !longRunDone && slot >= 60 && farFromLong && phase !== 'recovery' ? 'long' : phase === 'base' && phaseIdx >= 2 && k === 1 && slot >= 30 ? 'strides' : 'easy';
      if (kind === 'long') longRunDone = true;
      const minutes = kind === 'long' ? 60 : Math.min(45, Math.max(25, slot));
      const reason = pin ? 'Your standing run day: easy, by heart rate.'
        : kind === 'long' ? 'A longer easy run on a day with an hour free and well clear of the long ride: time on feet, by heart rate.'
        : kind === 'strides' ? 'An easy run with six short strides near the end: leg speed and running form, no fatigue to speak of.'
        : av.noBike?.[dw] ? 'No bike that day, so the aerobic work comes from an easy run.' : 'Too short a window for a ride worth doing; an easy run uses it well and adds the impact loading cycling lacks.';
      const w = generateRun({ kind, minutes, where: av.equipment.includes('treadmill') && !av.equipment.includes('outdoor-walk') ? 'treadmill' : 'outdoor', reason });
      extra.push({ date: dateOf(dw), kind: 'run', type: 'run', workout: w, seconds: (w.minutes ?? minutes) * 60, tss: w.estimatedTss ?? 0, reason });
    });
    if (i === 0 && canRun) decisions.push(runDays.length
      ? `Runs take the ${runDays.length === 1 ? 'day' : 'days'} a ride cannot use (${runDays.map((dw) => DAY[dw]).join(', ')}): easy, by heart rate, never the day before a hard ride or the day after the long one; at most two a week in base, one when the riding gets hard, none in the last week before the event.`
      : 'Runs are on, but no day this week has a run: a run needs a day of 25 minutes or more that a ride cannot use, not the day before a hard ride or the day after the long one.');

    // Walks: zone-2 aerobic work for the slots a ride cannot use (too short, or no bike that day).
    const pinnedWalkDays = pinned('walk').filter((dw) => daysThisWeek.includes(dw));
    if (canWalk || pinnedWalkDays.length) {
      const walkDays = daysThisWeek.filter((dw) => pinOf(dw) === 'walk' || (canWalk && !runDays.includes(dw) && !never(dw, 'walk') && footDay(dw)));
      const packKg = av.equipment.includes('treadmill') || av.equipment.includes('outdoor-walk') ? Math.round(Math.min(11, 7 + loadingProgress * 4)) : undefined;
      for (const dw of walkDays) {
        const minutes = Math.min(120, Math.round(av.hours[dw] * 60));
        const reason = pinOf(dw) === 'walk' ? 'Your standing walk day: easy aerobic work on foot.' : av.noBike?.[dw] ? 'No bike that day, so the aerobic work comes from an easy walk instead of nothing.' : 'Too short a window for a ride worth doing; an easy walk uses it well and adds the impact loading cycling lacks.';
        const w = generateWalk({ minutes, packKg, where: av.equipment.includes('treadmill') ? 'treadmill' : 'outdoor', reason });
        extra.push({ date: dateOf(dw), kind: 'walk', type: 'walk', workout: w, seconds: minutes * 60, tss: w.estimatedTss ?? 0, reason });
      }
      if (i === 0 && walkDays.length) decisions.push(`Walks fill the ${walkDays.length === 1 ? 'day' : 'days'} a ride cannot use (${walkDays.map((dw) => DAY[dw]).join(', ')}): easy, with no minimum heart rate and a ceiling at the top of zone 2 (a walk on the flat rarely reaches a cyclist’s zone 2, and does not need to), with a light pack that grows through the block.`);
    }

    // Mobility: short routines after the long ride and after strength.
    for (const slot of longSlots) {
      if (phase === 'taper' || !may.mobility || never(slot, 'mobility')) continue;
      const w = generateMobility({ focus: 'after-long-ride', minutes: 12, reason: 'Twelve minutes after the long ride: hips, back and hamstrings, while they are warm.' });
      extra.push({ date: dateOf(slot), kind: 'mobility', type: 'mobility', workout: w, seconds: 12 * 60, tss: w.estimatedTss ?? 0, reason: w.purpose });
    }
    for (const dw of strengthDays) {
      if (!may.mobility || never(dw, 'mobility')) continue;
      const w = generateMobility({ focus: 'after-strength', minutes: 10, reason: 'Ten minutes after lifting: the hips and legs just worked.' });
      extra.push({ date: dateOf(dw), kind: 'mobility', type: 'mobility', workout: w, seconds: 10 * 60, tss: w.estimatedTss ?? 0, reason: w.purpose });
    }
    for (const dw of pinned('mobility').filter((x) => daysThisWeek.includes(x))) {
      const minutes = Math.min(20, Math.max(10, Math.round(av.hours[dw] * 60)));
      const w = generateMobility({ focus: 'full', minutes, reason: 'Your standing mobility day: the whole body, unhurried.' });
      extra.push({ date: dateOf(dw), kind: 'mobility', type: 'mobility', workout: w, seconds: minutes * 60, tss: w.estimatedTss ?? 0, reason: w.purpose });
    }
    if (i === 0 && may.mobility) decisions.push('Mobility is attached to the long ride and to strength days: ten to twelve minutes while the muscles are warm, which is when stretching does the most and costs the least.');

    // Fit to the weekly target: shrink or grow the endurance minutes.
    const goneDay = (slot: number) => refit && dateOfSlot(weekStart, slot) < req.notBefore!;
    const sessions = buildSessions(plan, weekStart);
    const extraTss = extra.reduce((s, x) => s + x.tss, 0);
    let total = sessions.reduce((s, x) => s + x.tss, 0) + extraTss;
    const soft = plan.filter((p) => p.intent.type === 'endurance' || p.intent.type === 'long');
    for (let pass = 0; pass < 4 && soft.length; pass++) {
      const ratio = (targetTss - extraTss) / Math.max(1, total - extraTss);
      if (ratio > 0.88 && ratio < 1.12) break;
      for (const p of soft) {
        const cap = av.hours[p.slot] * 60;
        const floor = p.intent.type === 'long' ? 90 : 45;
        p.intent.minutes = Math.round(Math.max(floor, Math.min(cap, p.intent.minutes * Math.sqrt(ratio))));
      }
      const re = buildSessions(plan, weekStart);
      sessions.splice(0, sessions.length, ...re);
      total = sessions.reduce((s, x) => s + x.tss, 0) + extraTss;
    }

    // The week under way, re-checked: start from the week exactly as intended, then respond to what was
    // actually done. Load beyond what the days gone asked for comes off the days left (at most half of
    // them), and the day after a big or hard day is an easy spin. Load not done is not added: a missed
    // session is not crammed into the rest of the week. With everything done as planned, nothing changes.
    if (refit) {
      const doneSoFar = (req.done ?? []).filter((x) => x.date >= weekStart && x.date < addDays(weekStart, 7));
      const doneTss = doneSoFar.reduce((s, x) => s + x.tss, 0);
      const plannedGone = sessions.filter((x) => x.date < req.notBefore!).reduce((s, x) => s + x.tss, 0) + extra.filter((x) => x.date < req.notBefore!).reduce((s, x) => s + x.tss, 0);
      // A little over the estimates (an effort-rated lift, a ride run long) is normal and changes nothing.
      const excess = Math.max(0, doneTss - plannedGone - Math.max(25, 0.15 * targetTss));
      // A big day is judged against what that day planned, never by a fixed size: a planned long ride
      // done as planned is not a reason to ease the next day (the plan already placed the days around it).
      // Big means well over the day's plan (60 TSS or half as much again, and 120 in all), or a long
      // ride (2.5 hours) on a day that had no ride planned.
      const plannedOn = (date: string) => sessions.filter((x) => x.date === date).reduce((s, x) => s + x.tss, 0) + extra.filter((x) => x.date === date).reduce((s, x) => s + x.tss, 0);
      const rideOnDay = (date: string) => sessions.some((x) => x.date === date && x.kind === 'ride');
      const days = [...new Set(doneSoFar.map((x) => x.date))];
      const big = days.filter((date) => {
        const items = doneSoFar.filter((x) => x.date === date);
        const done = items.reduce((s, x) => s + x.tss, 0), planned = plannedOn(date);
        const over = done >= 120 && (done - planned >= 60 || (planned > 0 && done >= 1.5 * planned));
        const unplannedLong = !rideOnDay(date) && items.some((x) => (x.kind ?? 'ride') === 'ride' && x.seconds >= 2.5 * 3600);
        return over || unplannedLong;
      }).sort().pop();
      if (big || excess > 0) {
        if (big) {
          const easyDay = addDays(big, 1);
          for (const p of plan) {
            if (dateOfSlot(weekStart, p.slot) !== easyDay || p.intent.type === 'recovery') continue;
            p.intent = { ...p.intent, type: 'recovery', minutes: Math.min(45, p.intent.minutes), reason: `Easy: the day after a big day (${new Date(big + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })}). Spin the legs, nothing more.` };
            hardDays.delete(p.slot);
          }
        }
        const leftSoft = plan.filter((p) => (p.intent.type === 'endurance' || p.intent.type === 'long') && !goneDay(p.slot));
        const leftTss = () => sessions.filter((x) => x.date >= req.notBefore!).reduce((s, x) => s + x.tss, 0) + extra.filter((x) => x.date >= req.notBefore!).reduce((s, x) => s + x.tss, 0);
        let rebuilt = buildSessions(plan, weekStart);
        sessions.splice(0, sessions.length, ...rebuilt);
        const intendedLeft = leftTss();
        const want = Math.max(intendedLeft * 0.5, intendedLeft - excess);
        const planned = new Map(leftSoft.map((p) => [p, p.intent.minutes]));   // no ride is cut below half its planned length
        for (let pass = 0; pass < 4 && leftSoft.length && excess > 0; pass++) {
          const softTss = sessions.filter((x) => x.date >= req.notBefore! && (x.type === 'endurance' || x.type === 'long')).reduce((s, x) => s + x.tss, 0);
          const other = leftTss() - softTss;
          const ratio = (want - other) / Math.max(1, softTss);
          if (ratio > 0.9) break;
          for (const p of leftSoft) {
            const floor = Math.max(p.intent.type === 'long' ? 60 : 30, Math.round((planned.get(p) ?? 0) * 0.5));
            p.intent.minutes = Math.round(Math.max(floor, p.intent.minutes * Math.sqrt(Math.max(0.05, ratio))));
          }
          rebuilt = buildSessions(plan, weekStart);
          sessions.splice(0, sessions.length, ...rebuilt);
        }
      }
      total = sessions.reduce((s, x) => s + x.tss, 0) + extraTss;
    }
    sessions.push(...extra);
    if (refit) {
      // Only the days left are planned; what was on the days gone is history.
      const left = sessions.filter((x) => x.date >= req.notBefore!);
      sessions.splice(0, sessions.length, ...left);
      total = sessions.reduce((s, x) => s + x.tss, 0);
    }
    sessions.sort((x, y) => x.date.localeCompare(y.date) || KIND_ORDER[x.kind] - KIND_ORDER[y.kind]);

    // Library only (Batch 6, B and B2): each session is carried out by the nearest Library workout (or
    // the rider's own), however far, so the calendar shows named workouts; the planner's sentence stays.
    // The plan never creates a workout. When the nearest is a poor fit the decisions say so, once per
    // family per plan, so the rider can add one; strength is built by the plan (its exercises rotate).
    // The week's load is recomputed from what was chosen; there is no second fit against the Library.
    const before = total;
    for (let k = 0; k < sessions.length && !req.noSnap; k++) {
      const x = sessions[k];
      if (x.kind === 'strength') continue;
      const lib = snap(x.workout, { basis: req.basis, extra: req.ownWorkouts, equipment: av.equipment });
      const what = x.workout.name === 'Openers' ? 'openers ride' : x.kind === 'ride' ? `${FAMILY_WORDS[x.workout.family] ?? x.workout.family} ride` : x.kind;
      if (!lib) {
        // B2.3: no candidate at all (a heart-rate rider and a family with no ride that works by heart rate).
        if (!saidNoCandidate.has(what)) { saidNoCandidate.add(what); decisions.push(`The Library has no ${what} that works by heart rate, so the plan builds its own for those days (${x.workout.name}). Adding one to the Library would let the plan use it.`); }
        continue;
      }
      const size = sizeOf(lib);
      if (poorFit(x.workout, lib)) {
        const key = x.kind === 'ride' ? x.workout.family : `${x.kind}:${x.workout.name.replace(/\s*\d.*$/, '')}`;
        if (!saidPoorFit.has(key)) {
          saidPoorFit.add(key);
          const wantMin = Math.round(sizeOf(x.workout).minutes);
          decisions.push(`The plan wanted a ${wantMin}-minute ${what}; the nearest in the Library is ${lib.name}${lib.subtitle ? ` (${lib.subtitle}, ${Math.round(size.minutes)} min)` : ` (${Math.round(size.minutes)} min)`}. A ${what} nearer ${wantMin} minutes in the Library would fit these weeks better.`);
        }
      }
      sessions[k] = { ...x, workout: lib, seconds: Math.round(size.minutes * 60), tss: Math.round(size.tss) };
    }
    total = sessions.reduce((s, x) => s + x.tss, 0);
    if (!refit && targetTss > 0 && Math.abs(total - targetTss) / targetTss > 0.1 && Math.abs(before - targetTss) / targetTss <= 0.1) {
      const pct = Math.round(Math.abs(total - targetTss) / targetTss * 100);
      decisions.push(`Week of ${new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} lands ${pct}% ${total < targetTss ? 'under' : 'over'} its target because the Library's nearest rides are ${total < targetTss ? 'shorter' : 'longer'}; the long ride carries the difference next week.`);
    }
    if (sessions.length === 0 && awayDays === 0) return;   // a first week already over; a week away stays, empty, so the timeline keeps its shape
    for (const s of sessions) if (s.type === 'long' && s.seconds > longestPlanned) longestPlanned = s.seconds;

    weeks.push({
      index: i + 1, start: weekStart, phase, label: weekLabel(phase, seq, i), targetTss: Math.round(targetTss), tss: Math.round(total),
      hours: Math.round(sessions.reduce((s, x) => s + x.seconds, 0) / 360) / 10, sessions,
      note: awayDays >= 7 ? 'Away all week: nothing planned.' : mostlyAway ? `Away ${awayDays} of 7 days: a light week.` : PHASE_NOTE[phase],
    });
  });

  // Projection and verdict.
  const goalDate = goal.kind === 'event' ? goal.date : addDays(req.start, n * 7 - 1);
  const loads = weeks.flatMap((w) => w.sessions.map((s) => ({ date: s.date, tss: s.tss })));
  // Today's fitness is where the line starts: from the first day for a new plan, from today for a
  // plan under way (its past weeks are history, already in today's fitness, not days of zero load).
  const projFrom = req.layout?.length && req.notBefore && req.notBefore > req.start ? req.notBefore : req.start;
  const projection = fitnessSeries(loads, projFrom, goalDate, { ctl: ctl0, atl: a.fitness.atl });
  const taperStart = weeks.find((w) => w.phase === 'taper')?.start;
  const peakPoint = taperStart ? projection.find((f) => f.date === taperStart) : projection[projection.length - 1];
  const projectedCtl = Math.round(peakPoint?.ctl ?? ctl0);
  const formOnDay = Math.round(projection[projection.length - 1]?.tsb ?? 0);
  let verdict: Plan['verdict'] = 'no-target';
  if (d.requiredCtl > 0) verdict = projectedCtl >= d.requiredCtl ? 'on-track' : projectedCtl >= d.requiredCtl * 0.9 ? 'close' : 'short';
  const advice = buildAdvice(verdict, d, projectedCtl, longestPlanned, formOnDay, goal, n, capTss, weeks);
  return { weeks, demand: d, projection, goalDate, requiredCtl: d.requiredCtl, projectedCtl, formOnDay, longestPlanned, verdict, advice, decisions };
}

function buildSessions(plan: Array<{ slot: number; intent: SessionIntent }>, weekStart: string): PlannedSession[] {
  const startDow = dow(weekStart);
  return plan.map(({ slot, intent }) => {
    const date = addDays(weekStart, (slot - startDow + 7) % 7);
    const workout = generateSession(intent);
    const st = workoutStats(workout.blocks);
    return { date, kind: 'ride' as const, type: intent.type, workout, seconds: st.seconds, tss: st.tss, reason: intent.reason };
  });
}

function countBlocks(seq: Phase[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < seq.length) {
    let j = i;
    while (j < seq.length && seq[j] === seq[i]) j++;
    for (let k = i; k < j; k++) out.push(j - i);
    i = j;
  }
  return out;
}

function weekLabel(phase: Phase, seq: Phase[], i: number): string {
  const name = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', recovery: 'Recovery' }[phase];
  if (phase === 'recovery' || phase === 'taper') return name;
  return `${name} ${seq.slice(0, i + 1).filter((p) => p === phase).length}`;
}

const QUALITY_REASON: Record<SessionType, (phase: Phase, a: Assessment) => string> = {
  sweetspot: () => 'Sweet spot: the most fitness per minute without needing a day to recover. The efforts grow a little each week.',
  threshold: (_, a) => a.limiters.includes('threshold') ? 'Threshold is your limiter by the numbers (20-minute power sits close to FTP), so this is where the gains are.' : 'Threshold work raises FTP directly; longer efforts as the block goes on.',
  vo2max: (_, a) => a.limiters.includes('vo2max') ? 'Your five-minute power is low relative to FTP, which caps how far FTP can rise; VO2max work lifts that ceiling.' : 'Short, hard intervals above threshold to add top end on the fitness already built.',
  anaerobic: () => 'The goal rewards sharp power; short all-out efforts with full recoveries.',
  tempo: () => 'Tempo: brisk but sustainable, the intensity of a strong group ride, kind to recovery.',
  endurance: () => 'Zone 2 hours.', long: () => 'Long ride.', recovery: () => 'Easy.', openers: () => 'Openers.', test: () => 'Test.',
};

const FAMILY_WORDS: Partial<Record<string, string>> = { endurance: 'endurance', recovery: 'recovery', tempo: 'tempo', sweetspot: 'sweet spot', threshold: 'threshold', vo2max: 'VO2max', anaerobic: 'anaerobic', test: 'test' };

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
