import type { Basis, Family, Fitness, Workout } from './types';
import { addDays, fitnessSeries } from './load';
import { workoutStats } from './workout';

/** What the rider wants. */
export type Goal =
  | { kind: 'event'; eventType: 'century' | 'gran-fondo' | 'climbing' | 'time-trial' | 'group-ride' | 'other'; date: string; name?: string; priority?: 'A' | 'B' | 'C' }
  | { kind: 'ftp'; weeks: number; targetWatts?: number }
  | { kind: 'vo2max'; weeks: number }
  | { kind: 'endurance'; weeks: number; targetHours?: number }
  | { kind: 'weight'; weeks: number }
  | { kind: 'general'; weeks: number };

/** What the rider can give. */
export interface PlanRequest {
  start: string;            // first day of the plan, YYYY-MM-DD
  goal: Goal;
  days: number[];           // days of the week available to ride, 0 = Sunday
  longDay: number;          // which of those carries the long ride
  strengthDays: number[];   // no hard ride the day after one of these
  hoursPerWeek: number;
  basis: Basis;
  masters: boolean;         // 2:1 load/recovery rhythm, two hard days max
  currentCtl: number;       // fitness today, from the load model
  indoorMidweek: boolean;   // prefer compact indoor sessions on weekdays
}

export type PlanPhase = 'base' | 'build' | 'peak' | 'taper' | 'recovery';
export type DayRole = 'long' | 'key' | 'secondary' | 'endurance' | 'test' | 'openers' | 'easy';

export interface PlanDay { date: string; role: DayRole; workoutId: string; seconds: number; tss: number }
export interface PlanWeek { index: number; start: string; phase: PlanPhase; label: string; hours: number; tss: number; days: PlanDay[] }
export interface PhaseNote { phase: PlanPhase; from: number; to: number; why: string }

export interface GeneratedPlan {
  weeks: PlanWeek[];
  phases: PhaseNote[];
  projection: Fitness[];
  goalDate: string;
  required: number;             // fitness the goal wants (0 when the goal has no number)
  projectedAtGoal: number;      // fitness at the start of the taper (or the end of the plan)
  formOnDay: number;            // form (TSB) on the goal date
  verdict: 'on-track' | 'close' | 'short' | 'no-target';
  advice: string;
}

const EVENT_CTL: Record<Extract<Goal, { kind: 'event' }>['eventType'], number> = {
  century: 60, 'gran-fondo': 68, climbing: 62, 'time-trial': 65, 'group-ride': 55, other: 55,
};

export function planWeeks(goal: Goal, start: string): number {
  if (goal.kind === 'event') return Math.max(4, Math.floor((Date.parse(goal.date) - Date.parse(start)) / (7 * 864e5)));
  return Math.max(4, Math.min(24, goal.weeks));
}

/** Phase sequence for the plan: a label per week. */
export function phaseSequence(goal: Goal, n: number, masters: boolean): PlanPhase[] {
  const taper = goal.kind === 'event' ? (n >= 12 ? 2 : 1) : 0;
  const core = n - taper;
  const split: Record<Goal['kind'] | 'event', [number, number, number]> = {
    event: [0.45, 0.35, 0.2], ftp: [0.35, 0.5, 0.15], vo2max: [0.3, 0.3, 0.4],
    endurance: [0.65, 0.35, 0], weight: [0.7, 0.3, 0], general: [0.5, 0.5, 0],
  } as never;
  let [b, , p] = split[goal.kind];
  if (goal.kind === 'event' && (goal.eventType === 'time-trial' || goal.eventType === 'climbing')) [b, p] = [0.4, 0.2];
  const base = Math.max(1, Math.round(core * b));
  const peak = Math.round(core * p);
  const build = Math.max(0, core - base - peak);
  const seq: PlanPhase[] = [...Array(base).fill('base'), ...Array(build).fill('build'), ...Array(peak).fill('peak'), ...Array(taper).fill('taper')];
  // Recovery weeks: every third week for masters, every fourth otherwise, never in the taper
  // and never the week right before it.
  const cycle = masters ? 3 : 4;
  for (let i = cycle - 1; i < seq.length - taper - 1; i += cycle) seq[i] = 'recovery';
  return seq;
}

const PHASE_HOURS: Record<PlanPhase, number> = { base: 0.95, build: 1.0, peak: 0.9, recovery: 0.6, taper: 0.5 };

interface Pick { role: DayRole; families: Family[]; targetHours: number; outdoor: boolean }

function keyFamilies(phase: PlanPhase, goal: Goal, weekInPhase: number): Family[] {
  if (phase === 'recovery') return ['endurance'];
  if (phase === 'taper') return ['recovery'];
  switch (goal.kind) {
    case 'vo2max': return phase === 'base' ? ['sweetspot'] : ['vo2max'];
    case 'ftp': return phase === 'base' ? ['sweetspot'] : phase === 'build' ? ['threshold'] : weekInPhase % 2 ? ['vo2max'] : ['threshold'];
    case 'endurance': case 'weight': return phase === 'base' ? (weekInPhase % 2 ? ['tempo'] : ['sweetspot']) : ['sweetspot'];
    case 'general': return phase === 'base' ? ['sweetspot'] : weekInPhase % 2 ? ['vo2max'] : ['threshold'];
    case 'event':
      if (phase === 'base') return ['sweetspot'];
      if (phase === 'build') return goal.eventType === 'time-trial' || goal.eventType === 'climbing' ? ['threshold'] : weekInPhase % 2 ? ['threshold'] : ['sweetspot'];
      return goal.eventType === 'time-trial' ? ['threshold'] : weekInPhase % 2 ? ['threshold'] : ['vo2max'];
  }
}

function secondaryFamilies(phase: PlanPhase, goal: Goal): Family[] {
  if (phase === 'base') return goal.kind === 'weight' || goal.kind === 'endurance' ? ['endurance'] : ['tempo'];
  if (phase === 'build') return ['sweetspot'];
  if (phase === 'peak') return ['threshold'];
  return ['endurance'];
}

/**
 * Choose a library workout: right family, right setting, right basis, closest
 * duration, and not one used in the last few weeks for that role.
 */
export function chooseWorkout(library: Workout[], families: Family[], targetSeconds: number, basis: Basis, outdoor: boolean, recent: (id: string) => number): Workout | undefined {
  const fits = library.filter((w) => families.includes(w.family) && w.bases.includes(basis) && w.source === 'library');
  if (fits.length === 0) return undefined;
  const score = (w: Workout) => {
    const s = workoutStats(w.blocks).seconds;
    let sc = Math.abs(s - targetSeconds) / 60;                       // minutes off target
    if (outdoor && w.setting === 'indoor') sc += 25;
    if (!outdoor && w.setting === 'outdoor') sc += 25;
    sc += recent(w.id);
    return sc;
  };
  return [...fits].sort((a, b) => score(a) - score(b))[0];
}

export function generatePlan(req: PlanRequest, library: Workout[]): GeneratedPlan {
  const n = planWeeks(req.goal, req.start);
  const seq = phaseSequence(req.goal, n, req.masters);
  const days = [...new Set(req.days)].sort();
  const weeks: PlanWeek[] = [];
  const recentQueue: string[] = [];
  const remember = (id: string) => { recentQueue.push(id); if (recentQueue.length > 12) recentQueue.shift(); };
  const recent = (id: string) => { const i = recentQueue.lastIndexOf(id); return i < 0 ? 0 : 36 - 3 * (recentQueue.length - 1 - i); };

  // Which day is the key session: the available day farthest from the long ride,
  // and not the day after a strength session when another choice exists.
  const dist = (a: number, b: number) => Math.min((a - b + 7) % 7, (b - a + 7) % 7);
  const afterStrength = (d: number) => req.strengthDays.includes((d + 6) % 7);
  const candidates = days.filter((d) => d !== req.longDay).sort((a, b) => dist(b, req.longDay) - dist(a, req.longDay));
  const keyDay = candidates.find((d) => !afterStrength(d)) ?? candidates[0];
  const secondaryDay = candidates.filter((d) => d !== keyDay && dist(d, keyDay) >= 2 && !afterStrength(d))[0];

  let phaseWeek = 0;
  let lastPhase: PlanPhase | null = null;
  seq.forEach((phase, i) => {
    phaseWeek = phase === lastPhase ? phaseWeek + 1 : 0;
    const enteringBlock = phase !== lastPhase && (phase === 'base' || phase === 'build');
    lastPhase = phase;
    const weekStart = addDays(req.start, i * 7);
    const hours = req.hoursPerWeek * PHASE_HOURS[phase] * (phase === 'base' ? 0.85 + 0.15 * Math.min(1, phaseWeek / 3) : 1);
    const picks: Array<{ dow: number; pick: Pick }> = [];

    // Long ride: 35-45% of the week, growing through base and build, capped at four hours.
    const longShare = phase === 'recovery' ? 0.3 : phase === 'taper' ? 0.35 : 0.42;
    const longMax = phase === 'recovery' ? 1.5 : phase === 'taper' ? 2 : 4;
    const longHours = Math.min(longMax, Math.max(1, hours * longShare));
    picks.push({ dow: req.longDay, pick: { role: phase === 'recovery' ? 'easy' : 'long', families: ['endurance'], targetHours: longHours, outdoor: true } });

    // Key session, or a test at the start of a block.
    if (keyDay !== undefined) {
      const isTest = enteringBlock && req.goal.kind !== 'weight';
      const keyHours = Math.min(2, Math.max(0.9, hours * 0.25));
      picks.push({ dow: keyDay, pick: isTest
        ? { role: 'test', families: ['test'], targetHours: 1, outdoor: !req.indoorMidweek || keyDay === 0 || keyDay === 6 }
        : phase === 'taper'
          ? { role: 'openers', families: ['recovery'], targetHours: 0.6, outdoor: false }
          : { role: 'key', families: keyFamilies(phase, req.goal, phaseWeek), targetHours: keyHours, outdoor: !req.indoorMidweek || keyDay === 0 || keyDay === 6 } });
    }

    // Second quality day only in build and peak, and only with four or more days.
    if (secondaryDay !== undefined && days.length >= 4 && (phase === 'build' || phase === 'peak')) {
      picks.push({ dow: secondaryDay, pick: { role: 'secondary', families: secondaryFamilies(phase, req.goal), targetHours: Math.min(1.5, Math.max(0.75, hours * 0.18)), outdoor: !req.indoorMidweek || secondaryDay === 0 || secondaryDay === 6 } });
    }

    // Endurance fillers with whatever hours remain, dropped if under 45 minutes.
    const used = picks.reduce((s, p) => s + p.pick.targetHours, 0);
    const fillers = days.filter((d) => !picks.some((p) => p.dow === d));
    let remaining = Math.max(0, hours - used);
    for (const d of fillers) {
      const share = Math.min(2, remaining / Math.max(1, fillers.length - picks.filter((p) => p.pick.role === 'endurance').length));
      if (share < 0.75) break;
      picks.push({ dow: d, pick: { role: 'endurance', families: ['endurance'], targetHours: share, outdoor: !req.indoorMidweek || d === 0 || d === 6 } });
      remaining -= share;
    }

    const planDays: PlanDay[] = [];
    for (const { dow, pick } of picks) {
      const date = addDays(weekStart, (dow - new Date(weekStart + 'T00:00:00').getDay() + 7) % 7);
      const w = chooseWorkout(library, pick.families, pick.targetHours * 3600, req.basis, pick.outdoor, recent);
      if (!w) continue;
      remember(w.id);
      const s = workoutStats(w.blocks);
      planDays.push({ date, role: pick.role, workoutId: w.id, seconds: s.seconds, tss: s.tss });
    }
    planDays.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({
      index: i + 1, start: weekStart, phase, label: weekLabel(phase, seq, i),
      hours: Math.round(planDays.reduce((s, d) => s + d.seconds, 0) / 360) / 10,
      tss: planDays.reduce((s, d) => s + d.tss, 0), days: planDays,
    });
  });

  // Projection: fitness if every planned ride is done as written.
  const goalDate = req.goal.kind === 'event' ? req.goal.date : addDays(req.start, n * 7 - 1);
  const loads = weeks.flatMap((w) => w.days.map((d) => ({ date: d.date, tss: d.tss })));
  const projection = fitnessSeries(loads, req.start, goalDate, { ctl: req.currentCtl, atl: req.currentCtl });
  // Fitness is judged where it peaks, at the start of the taper; the taper then
  // trades a little fitness for form, which is what event day needs.
  const taperStart = weeks.find((w) => w.phase === 'taper')?.start;
  const peakPoint = taperStart ? projection.find((f) => f.date === taperStart) : projection[projection.length - 1];
  const projectedAtGoal = peakPoint?.ctl ?? req.currentCtl;
  const formOnDay = projection[projection.length - 1]?.tsb ?? 0;
  const required = requiredFitness(req.goal, req.currentCtl);
  let verdict: GeneratedPlan['verdict'] = 'no-target';
  if (required > 0) verdict = projectedAtGoal >= required ? 'on-track' : projectedAtGoal >= required * 0.9 ? 'close' : 'short';

  return { weeks, phases: phaseNotes(seq, req.goal), projection, goalDate, required, projectedAtGoal: Math.round(projectedAtGoal), formOnDay: Math.round(formOnDay), verdict, advice: advice(verdict, required, projectedAtGoal, req, n) };
}

function weekLabel(phase: PlanPhase, seq: PlanPhase[], i: number): string {
  const name = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', recovery: 'Recovery' }[phase];
  if (phase === 'recovery' || phase === 'taper') return name;
  const k = seq.slice(0, i + 1).filter((p) => p === phase).length;
  return `${name} ${k}`;
}

export function requiredFitness(goal: Goal, currentCtl: number): number {
  switch (goal.kind) {
    case 'event': return EVENT_CTL[goal.eventType];
    case 'ftp': return Math.max(55, Math.round(currentCtl * 1.15));
    case 'vo2max': return Math.max(50, Math.round(currentCtl * 1.1));
    case 'endurance': return Math.max(50, Math.round(currentCtl * 1.15));
    default: return 0;
  }
}

function advice(v: GeneratedPlan['verdict'], required: number, projected: number, req: PlanRequest, n: number): string {
  const p = Math.round(projected);
  if (v === 'no-target') return req.goal.kind === 'weight'
    ? 'Weight goals are won by consistency and a modest daily energy deficit, not by hard rides. This plan keeps most riding easy and long so appetite stays steady and the engine still grows. Pair it with a food plan you can keep.'
    : 'General fitness has no finish line, so the plan simply alternates base and build with recovery weeks, and the fitness chart is the scoreboard.';
  if (v === 'on-track') return `On track: this plan should bring your fitness to about ${p} by the goal date, and the goal wants roughly ${required}.`;
  const gap = required - p;
  const extraHours = Math.ceil(gap / 4);  // ~4 fitness points per extra weekly hour over a block, a rough rule of thumb
  const extraWeeks = Math.ceil(gap / 2.5);
  if (v === 'close') return `Close: projected fitness ${p} against a goal that wants about ${required}. Doable if the plan is followed; adding ${extraHours} hour${extraHours > 1 ? 's' : ''} a week would give a margin.`;
  return `Short: projected fitness ${p} against a goal that wants about ${required}. The smallest fixes are ${extraHours} more hour${extraHours > 1 ? 's' : ''} a week, or ${extraWeeks} more week${extraWeeks > 1 ? 's' : ''} (${n} planned now).`;
}

function phaseNotes(seq: PlanPhase[], goal: Goal): PhaseNote[] {
  const notes: PhaseNote[] = [];
  const why: Record<PlanPhase, string> = {
    base: goal.kind === 'weight' || goal.kind === 'endurance'
      ? 'Long rides and steady endurance do the work here; one sweet-spot or tempo session a week keeps the engine honest. The volume is the point.'
      : 'Sweet spot and long rides build the aerobic engine with manageable fatigue. Each week adds a little; the recovery week lets it stick.',
    build: goal.kind === 'vo2max'
      ? 'VO2max intervals raise the ceiling your threshold sits under. One hard session a week, two at most, with the long ride untouched.'
      : 'Threshold work raises FTP directly. The long ride grows toward event length and a second quality day appears when the days allow.',
    peak: goal.kind === 'event' && goal.eventType === 'time-trial'
      ? 'Sustained threshold efforts at race intensity; volume eases slightly so the hard days are done fresh.'
      : 'Shorter, sharper work above threshold. Volume eases a little so the hard days land fresh; fitness is banked, this adds the top end.',
    taper: 'Volume drops by half, intensity stays in short doses, and form rises into the +5 to +20 window for the event. Trust it; the fitness is already there.',
    recovery: 'Load drops to about sixty percent so the previous two weeks turn into fitness. The long ride stays, shorter and easy.',
  };
  seq.forEach((p, i) => {
    const last = notes[notes.length - 1];
    if (last && last.phase === p && last.to === i) last.to = i + 1;
    else if (p === 'recovery' && last && last.to === i) { /* recovery weeks sit inside the phase they interrupt */ last.to = i + 1; }
    else notes.push({ phase: p, from: i, to: i + 1, why: why[p] });
  });
  return notes;
}
