import type { Equipment, Exercise, RunStep, Workout } from './types';
import { bandOf, runMinutes, runSeconds } from './run';
import { newId } from './workout';
import { exercisesFor, firstFirst, lightLoad, type Pattern } from '../library/strength';
import { mobilityFor, type Target } from '../library/mobility';

/**
 * Generators for the non-riding sessions. Like ride generation, each returns a
 * complete session with a name, the actual exercises, and a reason.
 */

export type StrengthLevel = 'foundation' | 'build' | 'maintain' | 'light';

export interface StrengthIntent {
  level: StrengthLevel;
  minutes: number;
  equipment: Equipment[];
  variant: 'A' | 'B';     // A: legs and trunk; B: upper body and posterior chain
  weekInBlock: number;    // rotates exercise choices
  reason: string;
}

const SCHEME: Record<StrengthLevel, { sets: number; reps: string; load: string; trunkSets: number; hold: number }> = {
  foundation: { sets: 3, reps: '10–12', load: 'Leave 2–3 reps in reserve; learn the movement first', trunkSets: 2, hold: 30 },
  build:      { sets: 4, reps: '6–8', load: 'Heavier: leave 1–2 reps in reserve on the last set', trunkSets: 3, hold: 40 },
  maintain:   { sets: 2, reps: '8', load: 'Moderate: the weight you used last block, fewer sets', trunkSets: 2, hold: 40 },
  light:      { sets: 2, reps: '10', load: 'Light and quick; this is maintenance, not a stimulus', trunkSets: 2, hold: 30 },
};

// Between them the two days cover all seven patterns: squat, lunge (single leg), hinge, push, pull, carry and rotate.
const PLAN_A: Pattern[] = ['squat', 'single-leg', 'hinge', 'hip', 'rotate', 'trunk'];
const PLAN_B: Pattern[] = ['push', 'pull', 'single-leg', 'hinge', 'pull', 'carry'];

export function generateStrength(intent: StrengthIntent): Workout {
  const s = SCHEME[intent.level];
  const patterns = intent.variant === 'A' ? PLAN_A : PLAN_B;
  const have: Equipment[] = intent.equipment.length ? intent.equipment : ['bodyweight'];
  const used = new Set<string>();
  const exercises: Exercise[] = [];
  const perSession = intent.minutes >= 40 ? patterns.length : Math.max(4, Math.round(patterns.length * intent.minutes / 40));
  for (const p of patterns.slice(0, perSession)) {
    const options = exercisesFor(p, have).filter((e) => !used.has(e.id));
    if (!options.length) continue;
    // rotate through the options week by week so the same pattern gets a different exercise
    // a pattern both days share is offset on B so the two days differ; B-only patterns start at the top (a gym lift first)
    const offset = intent.variant === 'B' && PLAN_A.includes(p) ? 1 : 0;
    const pick = options[(intent.weekInBlock + offset) % options.length];
    used.add(pick.id);
    const isHold = /plank|dead bug|bird dog|pallof|wall sit|hollow|carry/i.test(pick.name);
    exercises.push({
      name: pick.name,
      sets: p === 'trunk' || p === 'hip' || p === 'rotate' || p === 'carry' ? s.trunkSets : s.sets,
      reps: isHold ? undefined : pick.unilateral ? `${pick.reps ?? s.reps} per side` : pick.reps ?? s.reps,
      holdSeconds: isHold ? s.hold : undefined,
      load: pick.loadable ? s.load : lightLoad(pick),
      cue: pick.cue,
      why: pick.why,
      equipment: pick.equipment,
    });
  }
  const effort = intent.level === 'build' ? 7 : intent.level === 'light' ? 4 : intent.level === 'maintain' ? 5 : 6;
  const tss = estimateSessionTss({ kind: 'strength', minutes: intent.minutes, effort });
  return {
    id: `gen-${newId()}`,
    name: `Strength ${intent.variant}: ${intent.variant === 'A' ? 'legs and trunk' : 'upper body and posterior chain'}`,
    kind: 'strength',
    family: 'recovery',
    purpose: intent.reason,
    physiology: intent.level === 'build' ? 'Heavier work for muscle and tendon strength, which masters riders lose fastest and which no amount of riding replaces.' : 'Keeps strength and bone loading while the riding does the fitness work.',
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: 'indoor',
    blocks: [],
    exercises: firstFirst(exercises),
    estimatedTss: tss,
    effort,
    minutes: intent.minutes,
    source: 'generated',
  };
}

export interface MobilityIntent {
  focus: 'after-long-ride' | 'after-strength' | 'hips-and-back' | 'upper-body' | 'full';
  minutes: number;
  reason: string;
}

const FOCUS: Record<MobilityIntent['focus'], { targets: Target[]; name: string }> = {
  'after-long-ride': { targets: ['low-back', 'hips', 'glutes', 'hamstrings', 'quads'], name: 'After the long ride' },
  'after-strength': { targets: ['hips', 'glutes', 'hamstrings', 'quads', 'calves'], name: 'After strength' },
  'hips-and-back': { targets: ['hips', 'glutes', 'low-back', 'thoracic'], name: 'Hips and back' },
  'upper-body': { targets: ['thoracic', 'neck-shoulders'], name: 'Upper body and posture' },
  full: { targets: ['low-back', 'hips', 'glutes', 'hamstrings', 'quads', 'thoracic', 'neck-shoulders', 'calves'], name: 'Full mobility' },
};

export function generateMobility(intent: MobilityIntent): Workout {
  const f = FOCUS[intent.focus];
  const pool = mobilityFor(f.targets);
  // Each stretch takes its hold (twice if per side) plus about 15 seconds to move between.
  const cost = (m: (typeof pool)[number]) => ((m.holdSeconds ?? 45) * (m.perSide ? 2 : 1) + 15) / 60;
  const exercises: Exercise[] = [];
  let left = intent.minutes;
  for (const m of pool) {
    if (left - cost(m) < 0) break;
    exercises.push({ name: m.name, holdSeconds: m.holdSeconds, reps: m.perSide ? 'each side' : undefined, cue: m.cue, why: m.why, equipment: m.equipment });
    left -= cost(m);
  }
  return {
    id: `gen-${newId()}`,
    name: `Mobility: ${f.name.toLowerCase()} (${intent.minutes} min)`,
    kind: 'mobility',
    family: 'recovery',
    purpose: intent.reason,
    physiology: 'Keeps the hips, back and shoulders moving through the range cycling never uses, so the position stays comfortable and power stays available.',
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: 'any',
    blocks: [],
    exercises,
    estimatedTss: Math.round(intent.minutes / 60 * 8),
    minutes: intent.minutes,
    source: 'generated',
  };
}

export interface WalkIntent {
  minutes: number;
  packKg?: number;
  where: 'treadmill' | 'outdoor';
  reason: string;
}

export function generateWalk(intent: WalkIntent): Workout {
  const pack = intent.packKg ? ` with a ${Math.round(intent.packKg * 2.2)} lb pack` : '';
  return {
    id: `gen-${newId()}`,
    name: `Zone 2 walk ${intent.minutes} min${pack}`,
    kind: 'walk',
    family: 'endurance',
    purpose: intent.reason,
    physiology: 'Aerobic work at zone 2 with impact and bone loading cycling does not give, and far less fatigue than a ride of the same length.',
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: intent.where === 'outdoor' ? 'outdoor' : 'indoor',
    blocks: [],
    walk: { minutes: intent.minutes, hrLow: 0.6, hrHigh: 0.7, packKg: intent.packKg },
    estimatedTss: estimateSessionTss({ kind: 'walk', walk: { minutes: intent.minutes, hrLow: 0.6, hrHigh: 0.7, packKg: intent.packKg } }),
    minutes: intent.minutes,
    source: 'generated',
  };
}

/**
 * Training stress per hour for a non-ride session, so the calendar, the planner
 * and the builders all estimate the same way.
 *  - Walks go by the heart-rate target: the same heart-rate TSS Intervals.icu
 *    would credit a recorded walk with (threshold taken as 92% of max), plus a
 *    little for a weighted pack.
 *  - Strength goes by planned effort (RPE 1–10), the same curve used when a
 *    session is logged with an effort rating.
 *  - Mobility is a flat, small amount.
 */
export function sessionTssPerHour(kind: Workout['kind'], opts: { hrLow?: number; hrHigh?: number; packKg?: number; effort?: number } = {}): number {
  if (kind === 'walk') {
    const lo = opts.hrLow ?? 0.6, hi = opts.hrHigh ?? 0.7;
    // No minimum (lo = 0): assume a stroll, around half of max heart rate, never above the ceiling.
    const mid = lo > 0 ? (lo + hi) / 2 : Math.min(hi, 0.5);
    const intensity = mid / 0.92;
    return intensity * intensity * 100 + (opts.packKg ?? 0) * 0.5;
  }
  if (kind === 'mobility') return 8;
  if (kind === 'run') { const e = opts.effort ?? 4; return e <= 4 ? 55 : e === 5 ? 60 : e === 6 ? 68 : e === 7 ? 75 : 80; }
  if (kind === 'strength') { const r = opts.effort ?? 6; return r * r * (50 / 49); }
  return 0;
}

/** Estimated training stress for a built or ready-made non-ride session. */
export function estimateSessionTss(w: Pick<Workout, 'kind' | 'minutes' | 'walk' | 'effort'> & Partial<Pick<Workout, 'run'>>): number {
  if (w.kind === 'run' && w.run?.steps.length) return runStepsTss(w.run.steps);
  const minutes = w.walk?.minutes ?? w.minutes ?? 0;
  return Math.round(minutes / 60 * sessionTssPerHour(w.kind, { ...w.walk, effort: w.effort }));
}

/** Training stress to credit a non-ride session with when it is logged by hand. */
export function loggedTss(w: Workout, seconds: number, rpe?: number): number {
  const hours = seconds / 3600;
  if (w.kind === 'walk') return Math.round(hours * sessionTssPerHour('walk', w.walk));
  if (w.kind === 'mobility') return Math.round(hours * 8);
  // A run logged by hand: its planned load per hour, or 55 an hour for an easy one.
  if (w.kind === 'run') return Math.round(hours * (w.run?.steps.length && w.minutes ? runStepsTss(w.run.steps) / (w.minutes / 60) : 55));
  return Math.round(hours * sessionTssPerHour('strength', { effort: rpe ?? 6 }));
}

/** Training load per hour of a run step by its band: easy 55, steady 65, tempo 75, hard 85, walking 30. */
const RUN_TSS_PER_HOUR = { easy: 55, steady: 65, tempo: 75, hard: 85, walk: 30 } as const;
/** A run's load from its steps, work and recoveries each at their own band. */
export function runStepsTss(steps: RunStep[]): number {
  let tss = 0;
  for (const s of steps) {
    const n = Math.max(1, s.repeat ?? 1);
    tss += (s.seconds * n) / 3600 * RUN_TSS_PER_HOUR[bandOf(s.hrLow, s.hrHigh)];
    if (n > 1 && s.recoverSeconds) tss += (s.recoverSeconds * (n - 1)) / 3600 * RUN_TSS_PER_HOUR[bandOf(s.recoverLow ?? 0.65, s.recoverHigh ?? 0.75)];
  }
  return Math.round(tss);
}

export type RunKind = 'easy' | 'long' | 'strides' | 'tempo' | 'hills';
export interface RunIntent { kind: RunKind; minutes: number; where: 'outdoor' | 'treadmill'; reason: string }

const EASY = { hrLow: 0.65, hrHigh: 0.75 };
const RUN_NAME: Record<RunKind, (m: number) => string> = {
  easy: (m) => `Reston easy run ${m} min`, long: (m) => `Vienna long run ${m} min`, strides: (m) => `Strides at Herndon ${m} min`,
  tempo: (m) => `Tempo on the trail ${m} min`, hills: (m) => `Hills at Difficult Run ${m} min`,
};
/** Load per hour by kind, as the brief sets it: easy and long 55, strides 60, tempo 75, hills 80. */
const RUN_KIND_TSS: Record<RunKind, { perHour: number; effort: number }> = { easy: { perHour: 55, effort: 4 }, long: { perHour: 55, effort: 4 }, strides: { perHour: 60, effort: 5 }, tempo: { perHour: 75, effort: 7 }, hills: { perHour: 80, effort: 7 } };
const RUN_PHYSIOLOGY: Record<RunKind, string> = {
  easy: 'Aerobic work with the impact and bone loading cycling never gives, and calf and foot strength the bike leaves alone. Easy means easy: a masters rider recovers from running more slowly than from riding, so the heart rate stays low and the pace is whatever that allows.',
  long: 'Time on feet at an easy heart rate: the tendons, feet and hips get used to running for longer while the aerobic system does the same work a long ride does, at a lower dose.',
  strides: 'Six short, quick strides on top of an easy run teach the legs to turn over fast and smoothly, with almost no fatigue: running form without running hard.',
  tempo: 'Three blocks at a comfortably hard heart rate raise the pace you can hold aerobically; for a cyclist it is threshold work with the legs used differently. Keep it to one a week at most.',
  hills: 'Short climbs at a hard effort build leg strength and power that carry to standing climbs on the bike, with the downhill walk as recovery so the impact stays low.',
};

/** A run with its steps, minutes and load, for the Library and the planner. */
export function generateRun(intent: RunIntent): Workout {
  let steps: RunStep[];
  if (intent.kind === 'strides') steps = [
    { seconds: Math.max(10, intent.minutes - 9) * 60, ...EASY, label: 'easy' },   // + 6 strides and their recoveries (7 min) + 2 min easy = the minutes asked
    { seconds: 20, hrLow: 0.85, hrHigh: 0.95, label: 'stride: fast but relaxed, not a sprint', repeat: 6, recoverSeconds: 60, recoverLow: 0, recoverHigh: 0.7 },
    { seconds: 2 * 60, ...EASY, label: 'easy' },
  ];
  else if (intent.kind === 'tempo') steps = [
    { seconds: 10 * 60, ...EASY, label: 'warm-up' },
    { seconds: 8 * 60, hrLow: 0.85, hrHigh: 0.9, label: 'tempo', repeat: 3, recoverSeconds: 3 * 60, recoverLow: 0.65, recoverHigh: 0.75 },
    { seconds: 5 * 60, ...EASY, label: 'cool-down' },
  ];
  else if (intent.kind === 'hills') steps = [
    { seconds: 10 * 60, ...EASY, label: 'warm-up' },
    { seconds: 60, hrLow: 0.88, hrHigh: 0.95, label: 'uphill, strong', repeat: 6, recoverSeconds: 90, recoverLow: 0, recoverHigh: 0.7 },
    { seconds: 5 * 60, ...EASY, label: 'cool-down' },
  ];
  else steps = [{ seconds: intent.minutes * 60, ...EASY, label: intent.kind === 'long' ? 'long and easy' : 'easy' }];
  const run = { steps, where: intent.where };
  const minutes = runMinutes(run);
  const k = RUN_KIND_TSS[intent.kind];
  return {
    id: `gen-${newId()}`,
    name: RUN_NAME[intent.kind](minutes),
    kind: 'run',
    family: intent.kind === 'tempo' || intent.kind === 'hills' ? 'tempo' : 'endurance',
    purpose: intent.reason,
    physiology: RUN_PHYSIOLOGY[intent.kind],
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: intent.where === 'outdoor' ? 'outdoor' : 'indoor',
    blocks: [],
    run,
    estimatedTss: Math.round(runSeconds(run) / 3600 * k.perHour),
    effort: k.effort,
    minutes,
    source: 'generated',
  };
}
