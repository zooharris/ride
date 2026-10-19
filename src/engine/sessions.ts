import type { Equipment, Exercise, Workout } from './types';
import { newId } from './workout';
import { exercisesFor, type Pattern } from '../library/strength';
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

const PLAN_A: Pattern[] = ['squat', 'single-leg', 'hinge', 'hip', 'trunk', 'trunk'];
const PLAN_B: Pattern[] = ['push', 'pull', 'single-leg', 'hinge', 'pull', 'trunk'];

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
    const pick = options[(intent.weekInBlock + (intent.variant === 'B' ? 1 : 0)) % options.length];
    used.add(pick.id);
    const isHold = /plank|dead bug|bird dog|pallof|wall sit|hollow|carry/i.test(pick.name);
    exercises.push({
      name: pick.name,
      sets: p === 'trunk' || p === 'hip' ? s.trunkSets : s.sets,
      reps: isHold ? undefined : pick.unilateral ? `${s.reps} per side` : s.reps,
      holdSeconds: isHold ? s.hold : undefined,
      load: pick.loadable ? s.load : 'Bodyweight; slow and controlled',
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
    exercises,
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
  if (kind === 'strength') { const r = opts.effort ?? 6; return r * r * (50 / 49); }
  return 0;
}

/** Estimated training stress for a built or ready-made non-ride session. */
export function estimateSessionTss(w: Pick<Workout, 'kind' | 'minutes' | 'walk' | 'effort'>): number {
  const minutes = w.walk?.minutes ?? w.minutes ?? 0;
  return Math.round(minutes / 60 * sessionTssPerHour(w.kind, { ...w.walk, effort: w.effort }));
}

/** Training stress to credit a non-ride session with when it is logged by hand. */
export function loggedTss(w: Workout, seconds: number, rpe?: number): number {
  const hours = seconds / 3600;
  if (w.kind === 'walk') return Math.round(hours * sessionTssPerHour('walk', w.walk));
  if (w.kind === 'mobility') return Math.round(hours * 8);
  return Math.round(hours * sessionTssPerHour('strength', { effort: rpe ?? 6 }));
}
