import type { Assessment } from './assessment';
import { hm } from './assessment';
import { demand, hoursText, type Demand, type Goal } from './goals';
import { generateSession, type SessionIntent, type SessionType } from './generate';
import { addDays, fitnessSeries } from './load';
import type { Basis, Fitness, Profile, Workout } from './types';
import { workoutStats } from './workout';

/**
 * The planner: an assessment of the rider and a model of the goal go in; a
 * week-by-week allocation of sessions to the rider's actual slots comes out,
 * with a sentence for every decision. Every rule of thumb in here is a prior
 * that the assessment's evidence overrides when it is good enough.
 */
export interface Availability {
  hours: number[];        // index 0 = Sunday; 0 means not available
  outdoor: boolean[];     // ride outdoors on that day when the slot allows
  strengthDays: number[]; // days with a strength session
}

export interface PlanRequest {
  start: string;
  goal: Goal;
  availability: Availability;
  basis: Basis;
  masters: boolean;
  profile: Profile;
  assessment: Assessment;
  longRideKmh?: number;   // the rider's own pace on long rides, if known
}

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';

export interface PlannedSession { date: string; type: SessionType; workout: Workout; seconds: number; tss: number; reason: string }
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
const dow = (date: string) => new Date(date + 'T00:00:00').getDay();

export function planWeeks(goal: Goal, start: string): number {
  if (goal.kind === 'event') return Math.max(4, Math.floor((Date.parse(goal.date) - Date.parse(start)) / (7 * 864e5)));
  return Math.max(4, Math.min(24, goal.weeks));
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
  const tired = a.afterLongRide.confidence !== 'none' && a.afterLongRide.value >= 0.45 && a.afterHardRide.confidence !== 'none' && a.afterHardRide.value >= 0.45;
  const cycle = tired ? 2 : masters ? 3 : 4;
  for (let i = cycle - 1; i < seq.length - taper - 1; i += cycle) seq[i] = 'recovery';
  decisions.push(`${base} base week${base === 1 ? '' : 's'}, ${build} build, ${peak} peak${taper ? `, ${taper} taper` : ''}: the split follows what the goal rewards (${topEmphasis(d)}) and what your data flag as the limiter (${a.limiters[0]}).`);
  decisions.push(tired
    ? 'A recovery week every second week: your mornings after long and hard rides are noticeably flat, so the plan gives fatigue more room to clear.'
    : `A recovery week every ${cycle} weeks is the starting rhythm${masters ? ' for a masters rider' : ''}; as rides and wellness come in, the plan brings one forward when fatigue says so.`);
  return { seq, decisions };
}

function topEmphasis(d: Demand): string {
  const e = Object.entries(d.emphasis).sort((x, y) => y[1] - x[1])[0][0];
  return { durability: 'durability', threshold: 'threshold power', vo2max: 'top-end power', anaerobic: 'sharp power', base: 'aerobic base' }[e] ?? e;
}

export function generatePlan(req: PlanRequest): Plan {
  const { goal, availability: av, assessment: a, profile } = req;
  const d = demand(goal, profile, a, req.longRideKmh);
  const n = planWeeks(goal, req.start);
  const { seq, decisions } = phaseSequence(n, d, a, goal, req.masters);
  const slotsAll = [0, 1, 2, 3, 4, 5, 6].filter((i) => (av.hours[i] ?? 0) > 0);
  const capMinutes = slotsAll.reduce((s, i) => s + av.hours[i] * 60, 0);
  const capTss = capMinutes / 60 * 62;

  // Load trajectory. Fitness moves by (daily load - fitness) / 42 each day, so a
  // week averaging D a day moves it by about (D - fitness) / 6. To climb by Δ in
  // a week needs D = fitness + 6Δ. The ramp is capped for safety and raised a
  // little when the evidence says the rider absorbs load well.
  const ctl0 = a.fitness.ctl;
  const loadingWeeks = seq.filter((p) => p === 'base' || p === 'build' || p === 'peak').length;
  let maxRamp = req.masters ? 4 : 6;
  if (a.afterLongRide.confidence !== 'none' && a.afterLongRide.value < 0.2 && a.compliance.value >= 0.8) maxRamp += 1;
  if (a.rampRate.confidence === 'good' && a.rampRate.value > maxRamp) maxRamp = Math.min(maxRamp + 2, a.rampRate.value);
  const needRamp = d.requiredCtl ? (d.requiredCtl - ctl0) / Math.max(1, loadingWeeks) : 2.5;
  const ramp = Math.max(1, Math.min(maxRamp, needRamp));
  decisions.push(`Fitness ${d.requiredCtl ? `needs to rise from ${Math.round(ctl0)} toward ${d.requiredCtl}` : `starts at ${Math.round(ctl0)}`}; the plan climbs about ${ramp.toFixed(1)} points a week (cap ${maxRamp}${maxRamp > (req.masters ? 4 : 6) ? ', raised because your recovery data look good' : ''}).`);
  if (needRamp > maxRamp) decisions.push(`The goal would want ${needRamp.toFixed(1)} a week, which is more than is safe; the verdict below says what that means.`);

  const weeks: PlanWeek[] = [];
  let ctl = ctl0;
  let lastLoading = Math.max(a.weeklyTss.value, ctl0 * 7);
  let phaseIdx = 0;
  let lastPhase: Phase | null = null;
  const blockLengths = countBlocks(seq);
  const strength = new Set(av.strengthDays);
  const afterStrengthPenalty = a.afterStrength.confidence === 'none' ? 0.3 : a.afterStrength.value;
  const afterLongPenalty = a.afterLongRide.confidence === 'none' ? 0.3 : a.afterLongRide.value;
  const afterHardPenalty = a.afterHardRide.confidence === 'none' ? 0.3 : a.afterHardRide.value;
  const startLongest = Math.max(90, Math.round((a.longestRide.confidence === 'none' ? 7200 : a.longestRide.value) / 60));
  let longestPlanned = 0;
  let saidTwoLongs = false;
  let saidStrength = false;
  let saidDropped = false;
  let loadingSeen = 0;

  seq.forEach((phase, i) => {
    phaseIdx = phase === lastPhase ? phaseIdx + 1 : 0;
    lastPhase = phase;
    const weekStart = addDays(req.start, i * 7);
    const blockLen = blockLengths[i];
    const progress = blockLen > 1 ? phaseIdx / (blockLen - 1) : 1;
    const loadingProgress = loadingWeeks > 1 ? loadingSeen / (loadingWeeks - 1) : 1;

    // Weekly load target.
    let targetTss: number;
    if (phase === 'recovery') targetTss = lastLoading * 0.6;
    else if (phase === 'taper') targetTss = lastLoading * (phaseIdx === 0 && seq.filter((p) => p === 'taper').length === 2 ? 0.55 : 0.45);
    else { ctl += ramp; targetTss = Math.min(capTss, 7 * (ctl + 6 * ramp)); lastLoading = targetTss; loadingSeen++; }

    // Session mix for the week.
    const isTest = i === 0 && a.ftpStatus.value !== 'fresh' && goal.kind !== 'weight';
    if (isTest && i === 0) decisions.push(`A test in week 1 because ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)} Later tests are added only when your rides suggest the number has moved.`);
    if (i === 0 && !isTest && a.ftpStatus.confidence !== 'none') decisions.push(`No test scheduled: ${a.ftpStatus.note.charAt(0).toLowerCase()}${a.ftpStatus.note.slice(1)}`);
    const quality: SessionType[] = [];
    if (phase === 'base') { quality.push(goal.kind === 'weight' ? 'tempo' : 'sweetspot'); if (slotsAll.length >= 5 && (a.limiters[0] === 'vo2max' || a.limiters[0] === 'anaerobic')) quality.push('tempo'); }
    if (phase === 'build') {
      // The goal weights the choice; the rider's limiter can override it. A weight or
      // endurance goal leans sub-threshold, but a rider whose data say threshold is the
      // limiter still gets threshold work, because a higher FTP makes every easy ride cheaper.
      const wantsThreshold = d.emphasis.threshold * 1.6 + (a.limiters[0] === 'threshold' ? 0.8 : 0) >= 1;
      const wantsVo2 = a.limiters.includes('vo2max') && d.emphasis.vo2max >= 0.6;
      quality.push(wantsVo2 ? 'vo2max' : wantsThreshold ? 'threshold' : 'sweetspot');
      if (slotsAll.length >= 4) quality.push(quality[0] === 'sweetspot' ? 'tempo' : 'sweetspot');
    }
    if (phase === 'peak') { quality.push(d.emphasis.anaerobic >= 0.8 ? 'anaerobic' : d.emphasis.vo2max >= 0.5 || a.limiters.includes('vo2max') ? 'vo2max' : 'threshold'); if (slotsAll.length >= 4) quality.push('threshold'); }
    if (phase === 'taper') quality.push('openers');
    if (isTest) quality[0] = 'test';

    // Long rides: as many as the slots and the evidence allow.
    const bySize = [...slotsAll].sort((x, y) => av.hours[y] - av.hours[x]);
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
        : d.requiredLongest ? `Building toward one ride of ${hoursText(d.requiredLongest / 3600)} before the taper; ${k ? 'the second long day of the week, kept shorter.' : `this week ${hoursText(mins / 60)}.`}`
        : `The long ride is where aerobic durability is built; ${hoursText(mins / 60)} this week.`;
      plan.push({ slot, intent: { type: phase === 'recovery' ? 'endurance' : 'long', minutes: mins, progression: progress, outdoor: av.outdoor[slot] ?? true, reason } });
    });

    // Quality sessions placed by cost.
    const hardDays = new Set<number>();
    for (const q of quality) {
      const candidates = slotsAll.filter((s) => !used.has(s) && av.hours[s] >= 0.9);
      if (candidates.length === 0) break;
      const cost = (s: number) => {
        let c = 0;
        if (hardDays.has((s + 6) % 7)) c += 0.5 + afterHardPenalty * 3;
        if (longSlots.includes((s + 6) % 7)) c += 0.5 + afterLongPenalty * 3;
        if (hardDays.has((s + 1) % 7)) c += 0.5 + afterHardPenalty * 2;
        if (longSlots.includes((s + 1) % 7)) c += 0.5 + afterLongPenalty * 1.5;
        if (strength.has((s + 6) % 7)) c += afterStrengthPenalty * 3;
        if (av.hours[s] < 1.5) c += 0.5;
        return c;
      };
      const slot = [...candidates].sort((x, y) => cost(x) - cost(y))[0];
      // A second hard day that can only land somewhere costly is not worth having; the hours go to zone 2 instead.
      if (hardDays.size > 0 && cost(slot) >= 2.5) { if (!saidDropped) { saidDropped = true; decisions.push('Some weeks carry one hard session instead of two: the only free day for a second one sits right after strength or another hard day, and zone 2 there does more good than a compromised interval session.'); } break; }
      used.add(slot); hardDays.add(slot);
      if (strength.has((slot + 6) % 7) && !saidStrength) { saidStrength = true; decisions.push(afterStrengthPenalty < 0.15 ? 'Hard rides can follow strength days: your mornings after lifting look like any other.' : `Hard rides land the day after strength only when nothing better is free; ${a.afterStrength.confidence === 'none' ? 'no data yet on how you recover from lifting, so a mild cost is assumed' : 'your data put a cost on it'}.`); }
      const mins = Math.min(av.hours[slot] * 60, q === 'test' ? 75 : q === 'openers' ? 45 : Math.round(lerp(60, 105, progress)));
      const reason = q === 'test' ? `Start of a ${phase} block: a test sets the numbers every target in the block is built on.`
        : q === 'openers' ? 'The day before the event: short efforts to wake the legs without adding fatigue.'
        : QUALITY_REASON[q](phase, a);
      plan.push({ slot, intent: { type: q, minutes: mins, progression: progress, outdoor: av.outdoor[slot] ?? false, reason } });
    }

    // Fillers: endurance where there is at least 45 minutes; easy spin the day after a long ride if long days cost you.
    for (const s of slotsAll) {
      if (used.has(s) || av.hours[s] * 60 < 45) continue;
      const afterLong = longSlots.includes((s + 6) % 7);
      const easy = afterLong && afterLongPenalty >= 0.4;
      used.add(s);
      plan.push({ slot: s, intent: { type: easy ? 'recovery' : 'endurance', minutes: Math.min(av.hours[s] * 60, easy ? 45 : 120), progression: progress, outdoor: av.outdoor[s] ?? false, reason: easy ? 'Easy spin the day after a long ride, because your data say long days leave a dent.' : 'Zone 2 hours: the quiet work that makes everything else possible.' } });
    }

    // Fit to the weekly target: shrink or grow the endurance minutes.
    const sessions = buildSessions(plan, weekStart);
    let total = sessions.reduce((s, x) => s + x.tss, 0);
    const soft = plan.filter((p) => p.intent.type === 'endurance' || p.intent.type === 'long');
    for (let pass = 0; pass < 4 && soft.length; pass++) {
      const ratio = targetTss / Math.max(1, total);
      if (ratio > 0.88 && ratio < 1.12) break;
      for (const p of soft) {
        const cap = av.hours[p.slot] * 60;
        const floor = p.intent.type === 'long' ? 90 : 45;
        p.intent.minutes = Math.round(Math.max(floor, Math.min(cap, p.intent.minutes * Math.sqrt(ratio))));
      }
      const re = buildSessions(plan, weekStart);
      sessions.splice(0, sessions.length, ...re);
      total = sessions.reduce((s, x) => s + x.tss, 0);
    }
    sessions.sort((x, y) => x.date.localeCompare(y.date));
    for (const s of sessions) if (s.type === 'long' && s.seconds > longestPlanned) longestPlanned = s.seconds;

    weeks.push({
      index: i + 1, start: weekStart, phase, label: weekLabel(phase, seq, i), targetTss: Math.round(targetTss), tss: Math.round(total),
      hours: Math.round(sessions.reduce((s, x) => s + x.seconds, 0) / 360) / 10, sessions,
      note: PHASE_NOTE[phase],
    });
  });

  // Projection and verdict.
  const goalDate = goal.kind === 'event' ? goal.date : addDays(req.start, n * 7 - 1);
  const loads = weeks.flatMap((w) => w.sessions.map((s) => ({ date: s.date, tss: s.tss })));
  const projection = fitnessSeries(loads, req.start, goalDate, { ctl: ctl0, atl: a.fitness.atl });
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
    return { date, type: intent.type, workout, seconds: st.seconds, tss: st.tss, reason: intent.reason };
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
