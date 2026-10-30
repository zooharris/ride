import type { Exercise, Profile, RunStep, WalkSpec, Workout } from './types';
import { runMinutes, runSeconds } from './run';
import { EASY_WALK, bandKeyOf, bandTssPerHour, recoveryBand, stepBand, walkBand, type FootBand } from './foot';
import { newId } from './workout';
import { mobilityFor, type Target } from '../library/mobility';

/**
 * Generators for the non-riding sessions. Like ride generation, each returns a
 * complete session with a name, the actual exercises, and a reason.
 */

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
  /** The heart-rate band; an easy walk (no minimum, up to the top of zone 2) unless given. A caller that passes one names the walk itself. */
  band?: FootBand;
}

/** "Easy walk 30 min with a 15 lb pack": the name of a walk in the default band. */
export function easyWalkName(minutes: number, packKg?: number): string {
  return `Easy walk ${minutes} min${packKg ? ` with a ${Math.round(packKg * 2.2)} lb pack` : ''}`;
}

export const EASY_WALK_PHYSIOLOGY = "Easy aerobic work on foot, with the impact and bone loading cycling does not give. A walk on the flat rarely reaches a cyclist's zone 2 and does not need to: the heart rate drifts up over the walk while the legs, hips and back do the work. Far less fatigue than a ride of the same length.";

export function generateWalk(intent: WalkIntent): Workout {
  const band = intent.band ?? EASY_WALK;
  const walk: WalkSpec = { minutes: intent.minutes, zoneLow: band.zoneLow, zoneHigh: band.zoneHigh, packKg: intent.packKg };
  return {
    id: `gen-${newId()}`,
    name: easyWalkName(intent.minutes, intent.packKg),
    kind: 'walk',
    family: 'endurance',
    purpose: intent.reason,
    physiology: intent.band ? 'Aerobic work on foot with the impact and bone loading cycling does not give, and far less fatigue than a ride of the same length.' : EASY_WALK_PHYSIOLOGY,
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: intent.where === 'outdoor' ? 'outdoor' : 'indoor',
    blocks: [],
    walk,
    estimatedTss: estimateSessionTss({ kind: 'walk', walk }),
    minutes: intent.minutes,
    source: 'generated',
  };
}

/**
 * The one-time re-target of 23 Oct 2026 (Batch 6, A6), for one workout.
 *  - A walk the planner wrote in its old default band (60–70% of max heart rate,
 *    or zone 2) becomes an easy walk: no minimum, up to the top of zone 2, named
 *    and described as one, its load re-estimated. Only for walks the plan made;
 *    the caller decides that.
 *  - A run whose steps are still written as shares of max heart rate gets the
 *    nearest band on the foot table for each step, so no run depends on max
 *    heart rate any more. The meaning is kept, so every such run converts.
 * Returns the converted workout, or null when there is nothing to change.
 */
export function retargetWorkout(w: Workout, profile?: Pick<Profile, 'lthr' | 'maxHr'> & Partial<Profile>): Workout | null {
  if (w.kind === 'walk' && w.walk) {
    const v = w.walk;
    const near = (a: number | undefined, b: number) => a != null && Math.abs(a - b) < 0.03;
    const oldShareOfMax = v.zoneHigh == null && ((v.hrLow == null && v.hrHigh == null) || (near(v.hrLow, 0.6) && near(v.hrHigh, 0.7)));
    const oldZone2 = v.zoneLow === 2 && v.zoneHigh === 3;
    if (!oldShareOfMax && !oldZone2) return null;
    const walk: WalkSpec = { minutes: v.minutes, zoneLow: EASY_WALK.zoneLow, zoneHigh: EASY_WALK.zoneHigh, ...(v.packKg ? { packKg: v.packKg } : {}) };
    const purpose = w.purpose
      .replace('a zone 2 walk uses it well', 'an easy walk uses it well')
      .replace('Your standing walk day: zone 2 on foot.', 'Your standing walk day: easy aerobic work on foot.')
      .replace('a brisk walk instead of nothing', 'an easy walk instead of nothing');
    return { ...w, name: w.name.replace(/^Zone 2 walk/, 'Easy walk'), purpose, physiology: EASY_WALK_PHYSIOLOGY, walk, estimatedTss: estimateSessionTss({ kind: 'walk', walk }) };
  }
  if (w.kind === 'run' && w.run?.steps.some((s) => (!s.band && (s.hrLow != null || s.hrHigh != null)) || (!s.recoverBand && (s.recoverLow != null || s.recoverHigh != null)))) {
    const steps: RunStep[] = w.run.steps.map((s) => {
      const { hrLow, hrHigh, recoverLow, recoverHigh, ...rest } = s;
      const out: RunStep = { ...rest, band: s.band ?? bandKeyOf(stepBand(s, profile)) };
      if (s.recoverBand) out.recoverBand = s.recoverBand;
      else if (recoverHigh != null || recoverLow != null) out.recoverBand = bandKeyOf(recoveryBand(s, profile));
      void hrLow; void hrHigh;
      return out;
    });
    const run = { ...w.run, steps };
    return { ...w, run, estimatedTss: estimateSessionTss({ kind: 'run', run, minutes: w.minutes, walk: undefined, effort: w.effort }) };
  }
  return null;
}

/**
 * Training stress per hour for a non-ride session, so the calendar, the planner
 * and the builders all estimate the same way.
 *  - Walks go by the heart-rate band: the same heart-rate TSS a recorded walk
 *    is scored with, plus a little for a weighted pack.
 *  - Strength goes by planned effort (RPE 1–10), the same curve used when a
 *    session is logged with an effort rating.
 *  - Mobility is a flat, small amount.
 */
export function sessionTssPerHour(kind: Workout['kind'], opts: Partial<WalkSpec> & { effort?: number } = {}): number {
  if (kind === 'walk') {
    const b = walkBand({ minutes: 0, ...opts });
    return bandTssPerHour(b) + (opts.packKg ?? 0) * 0.5;
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
    tss += (s.seconds * n) / 3600 * RUN_TSS_PER_HOUR[bandKeyOf(stepBand(s))];
    if (n > 1 && s.recoverSeconds) tss += (s.recoverSeconds * (n - 1)) / 3600 * RUN_TSS_PER_HOUR[bandKeyOf(recoveryBand(s))];
  }
  return Math.round(tss);
}

export type RunKind = 'easy' | 'long' | 'strides' | 'tempo' | 'hills' | 'fartlek' | 'progression' | 'run-walk';
export interface RunIntent { kind: RunKind; minutes: number; where: 'outdoor' | 'treadmill'; reason: string }

const EASY = { band: 'easy' as const };
const RUN_NAME: Record<RunKind, (m: number) => string> = {
  easy: (m) => `Reston easy run ${m} min`, long: (m) => `Vienna long run ${m} min`, strides: (m) => `Strides at Herndon ${m} min`,
  tempo: (m) => `Tempo on the trail ${m} min`, hills: (m) => `Hills at Difficult Run ${m} min`,
  fartlek: (m) => `Fartlek at Sunset Hills ${m} min`, progression: (m) => `Progression to Vienna ${m} min`, 'run-walk': (m) => `Run-walk at Herndon ${m} min`,
};
/** Load per hour by kind, as the brief sets it: easy and long 55, strides 60, tempo 75, hills 80. */
/** The newer kinds (0) take their load from their steps' bands instead. */
const RUN_KIND_TSS: Record<RunKind, { perHour: number; effort: number }> = { easy: { perHour: 55, effort: 4 }, long: { perHour: 55, effort: 4 }, strides: { perHour: 60, effort: 5 }, tempo: { perHour: 75, effort: 7 }, hills: { perHour: 80, effort: 7 }, fartlek: { perHour: 0, effort: 6 }, progression: { perHour: 0, effort: 6 }, 'run-walk': { perHour: 0, effort: 3 } };
const RUN_PHYSIOLOGY: Record<RunKind, string> = {
  easy: 'Aerobic work with the impact and bone loading cycling never gives, and calf and foot strength the bike leaves alone. Easy means easy: a masters rider recovers from running more slowly than from riding, so the heart rate stays low and the pace is whatever that allows.',
  long: 'Time on feet at an easy heart rate: the tendons, feet and hips get used to running for longer while the aerobic system does the same work a long ride does, at a lower dose.',
  strides: 'Six short, quick strides on top of an easy run teach the legs to turn over fast and smoothly, with almost no fatigue: running form without running hard.',
  tempo: 'Three blocks at a comfortably hard heart rate raise the pace you can hold aerobically; for a cyclist it is threshold work with the legs used differently. Keep it to one a week at most.',
  hills: 'Short climbs at a hard effort build leg strength and power that carry to standing climbs on the bike, with the downhill walk as recovery so the impact stays low.',
  fartlek: 'Speed play: short pickups chosen by feel and held in the band by the watch. It trains changes of pace, the way a group ride surges, without the structure of intervals.',
  progression: 'A run that finishes faster than it starts teaches pacing and holding form on tired legs, the way the end of a long ride asks for it, with only the last ten minutes hard.',
  'run-walk': 'Running in two-minute doses with walking between: the feet, calves and tendons, which adapt more slowly than the heart, get the impact a little at a time. The way to start running.',
};

/** A run with its steps, minutes and load, for the Library and the planner. */
export function generateRun(intent: RunIntent): Workout {
  let steps: RunStep[];
  if (intent.kind === 'strides') steps = [
    { seconds: Math.max(10, intent.minutes - 9) * 60, ...EASY, label: 'easy' },   // + 6 strides and their recoveries (7 min) + 2 min easy = the minutes asked
    { seconds: 20, band: 'hard', label: 'stride: fast but relaxed, not a sprint', repeat: 6, recoverSeconds: 60, recoverBand: 'walk' },
    { seconds: 2 * 60, ...EASY, label: 'easy' },
  ];
  else if (intent.kind === 'tempo') steps = [
    { seconds: 10 * 60, ...EASY, label: 'warm-up' },
    { seconds: 8 * 60, band: 'tempo', label: 'tempo', repeat: 3, recoverSeconds: 3 * 60, recoverBand: 'easy' },
    { seconds: 5 * 60, ...EASY, label: 'cool-down' },
  ];
  else if (intent.kind === 'hills') steps = [
    { seconds: 10 * 60, ...EASY, label: 'warm-up' },
    { seconds: 60, band: 'hard', label: 'uphill, strong', repeat: 6, recoverSeconds: 90, recoverBand: 'walk' },
    { seconds: 5 * 60, ...EASY, label: 'cool-down' },
  ];
  else if (intent.kind === 'fartlek') steps = [
    { seconds: 10 * 60, ...EASY, label: 'warm-up' },
    { seconds: 60, band: 'tempo', label: 'pick it up', repeat: 8, recoverSeconds: 2 * 60, recoverBand: 'easy' },
    { seconds: 3 * 60, ...EASY, label: 'easy' },
  ];
  else if (intent.kind === 'progression') steps = [
    { seconds: 15 * 60, ...EASY, label: 'easy' },
    { seconds: 10 * 60, band: 'steady', label: 'steady' },
    { seconds: 10 * 60, band: 'tempo', label: 'strong' },
    { seconds: 5 * 60, ...EASY, label: 'cool-down' },
  ];
  else if (intent.kind === 'run-walk') steps = [
    { seconds: 2 * 60, ...EASY, label: 'run', repeat: 10, recoverSeconds: 60, recoverLow: 0, recoverHigh: 0.7 },
    { seconds: 60, band: 'walk', label: 'walk' },
  ];
  else steps = [{ seconds: intent.minutes * 60, ...EASY, label: intent.kind === 'long' ? 'long and easy' : 'easy' }];
  const run = { steps, where: intent.where };
  const minutes = runMinutes(run);
  const k = RUN_KIND_TSS[intent.kind];
  return {
    id: `gen-${newId()}`,
    name: RUN_NAME[intent.kind](minutes),
    kind: 'run',
    family: ['tempo', 'hills', 'fartlek', 'progression'].includes(intent.kind) ? 'tempo' : 'endurance',
    purpose: intent.reason,
    physiology: RUN_PHYSIOLOGY[intent.kind],
    phases: ['any'],
    bases: ['power', 'hr'],
    setting: intent.where === 'outdoor' ? 'outdoor' : 'indoor',
    blocks: [],
    run,
    estimatedTss: k.perHour ? Math.round(runSeconds(run) / 3600 * k.perHour) : runStepsTss(steps),
    effort: k.effort,
    minutes,
    source: 'generated',
  };
}
