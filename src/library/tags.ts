import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { workoutStats } from '../engine/workout';
import { trainsOf } from './trains';

/**
 * The Library's tags (9 Nov 2026, "the Library grows up", Part A). Every Library workout
 * carries them as data: what it is for, how long, how hard, and (rides) whether it rides
 * well outdoors on a bike computer. The Library's filters read them; new workouts are
 * written with them. Nothing here depends on any rider: the rules read only the
 * workout's own steps, so they hold for everyone.
 *
 * The planner does not shop by these tags: it already reads every ride's steps to know
 * exactly how many minutes it gives at each intensity (engine/contribution.ts), which is
 * the same information, finer. The tags are for people.
 */

export type Purpose =
  | 'recovery' | 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2' | 'anaerobic' | 'mixed' | 'test'
  | 'strength' | 'mobility';

export type Intensity = 'easy' | 'moderate' | 'hard' | 'very-hard';

/**
 * How a ride fares outdoors on a bike computer, where the rider steers the watts by feel:
 * 'well': long steady steps, sent as they are; 'adjustable': tight targets or clusters of
 * short steps the app will soften when sending it outdoors (Part C); 'indoor': fast on/off
 * work or drills with no honest outdoor version.
 */
export type OutdoorRating = 'well' | 'adjustable' | 'indoor';

export interface WorkoutTags {
  purpose: Purpose;
  minutes: number;
  intensity: Intensity;
  /** Rides only. */
  outdoor?: OutdoorRating;
  /** A ride's place in a progression family (Part C): the family and its rung, 1 the easiest. */
  series?: { id: string; rung: number };
}

export const PURPOSE_LABEL: Record<Purpose, string> = {
  recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo', sweetspot: 'Sweet spot', threshold: 'Threshold',
  vo2: 'VO2max', anaerobic: 'Anaerobic and sprints', mixed: 'Race and group rides', test: 'Test',
  strength: 'Strength', mobility: 'Mobility',
};
export const INTENSITY_LABEL: Record<Intensity, string> = { easy: 'Easy', moderate: 'Moderate', hard: 'Hard', 'very-hard': 'Very hard' };
export const OUTDOOR_LABEL: Record<OutdoorRating, string> = { well: 'Rides well outdoors', adjustable: 'Adjusted for outdoors', indoor: 'Indoors only' };

/**
 * The few rides the rules can't judge from their steps alone. A ride written from now on
 * states its tags itself instead.
 */
const OVERRIDES: Record<string, Partial<WorkoutTags>> = {
  // Single-leg pedalling on an open road is unsafe, whatever the steps look like.
  'in-spinups': { outdoor: 'indoor' },
  // Group rides and their simulations: mixed efforts by design, not one purpose.
  'in-race-sim': { purpose: 'mixed' },
  'trail-group-150': { purpose: 'mixed', outdoor: 'well' },
  // Tests are ridden "as hard as you can hold evenly": the target is a guide, and outdoors is where many riders test.
  'lib-20min': { outdoor: 'well' },
  'lib-lthr-30': { outdoor: 'well' },
  'trail-20min-test': { outdoor: 'well' },
};

/**
 * A ride's purpose is what it trains (12 Nov 2026, brief B1: one way of describing a ride, not two): the hardest
 * system that counts in its steps (library/trains), sprints filed with anaerobic. A ride where nothing counts keeps
 * its family's purpose (recovery, or easy riding), and so does an easy-day ride whose only work is a few short
 * sprints: they keep the top end awake but do not make it a hard ride. Tests are tests.
 */
function purposeOf(w: Workout): Purpose {
  if (w.family === 'test') return 'test';
  const t = trainsOf(w);
  const top = t.counted[0];
  const easyFamily = w.family === 'endurance' || w.family === 'recovery';
  if (!top || (easyFamily && top === 'sprint')) return RIDE_PURPOSE[w.family];
  return top === 'sprint' || top === 'anaerobic' ? 'anaerobic' : top;
}

const RIDE_PURPOSE: Record<Workout['family'], Purpose> = {
  recovery: 'recovery', endurance: 'endurance', tempo: 'tempo', sweetspot: 'sweetspot',
  threshold: 'threshold', vo2max: 'vo2', anaerobic: 'anaerobic', test: 'test',
};
/** The least a purpose can be, whatever its average says (a VO2max ride with long rests still asks a lot). */
const PURPOSE_FLOOR: Record<Purpose, Intensity> = {
  recovery: 'easy', endurance: 'easy', tempo: 'moderate', sweetspot: 'hard', threshold: 'hard', vo2: 'very-hard',
  anaerobic: 'very-hard', mixed: 'hard', test: 'very-hard', strength: 'moderate', mobility: 'easy',
};
const LEVELS: Intensity[] = ['easy', 'moderate', 'hard', 'very-hard'];
const atLeast = (a: Intensity, b: Intensity): Intensity => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);

/** Effort at or above tempo: where a target has to be held. */
const WORK = 0.76;
/** Above this a short effort is "as hard as you can", not a band to hold, on any device. */
const ALL_OUT = 1.2;

function flatSteps(w: Workout): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const b of w.blocks) {
    if (b.kind === 'step') out.push(b);
    else for (let i = 0; i < b.times; i++) out.push(...b.steps);
  }
  return out;
}

/** The outdoor rule, from the steps alone: indoors only for fast on/off work; otherwise adjusted when the outdoor version changes anything. */
export function outdoorRating(w: Workout): OutdoorRating {
  if (w.trainerOnly) return 'indoor';
  const s = flatSteps(w);
  // Fast on/off: four or more on/off pairs in a row, every step under a minute, with work among them (30/30s, 40/20s).
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    run = s[i].seconds < 60 ? run + 1 : 0;
    if (run >= 8 && s.slice(i - 7, i + 1).some((x) => x.intensity >= WORK)) return 'indoor';
  }
  // Too busy to follow on a road: more than eight changes of target inside any ten minutes of hard riding (a criterium simulation).
  let t = 0;
  const starts = s.map((x) => { const at = t; t += x.seconds; return at; });
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && starts[j + 1] < starts[i] + 600) j++;
    if (j - i > 8 && s.slice(i, j + 1).some((x) => x.intensity >= WORK)) return 'indoor';
  }
  return adjustBlocks(w.blocks).changes.length ? 'adjustable' : 'well';
}

/** Narrower than about 4% of FTP (a single number, in practice) a held target is too tight for an open road; an outdoor band is 6% wide. */
const TIGHT = 0.035;
const OUTDOOR_BAND = 0.06;
/** Efforts shorter than this are ridden by feel anywhere (a pickup, a surge): left alone. */
const HELD = 120;
const isWork = (x: WorkoutStep) => x.intensity >= WORK && x.intensity < ALL_OUT;

/**
 * The outdoor version of a ride's steps (9 Nov 2026, Part C): back-to-back efforts of two minutes or
 * less at different targets (over-unders, pyramids) become one steady effort at their average, and a
 * target held for two minutes or more whose range is narrower than about 4% of FTP is widened to 6%,
 * centred on the same effort. Sprints, surges, recoveries and everything else are left as they are.
 * `changes` says, in plain words, what was softened (nothing: the ride needs no adjusting).
 */
function adjustBlocks(blocks: WorkoutBlock[]): { blocks: WorkoutBlock[]; changes: string[] } {
  let merged = 0, widened = 0;
  const mergeRun = (steps: WorkoutStep[]): WorkoutStep[] => {
    const out: WorkoutStep[] = [];
    for (let i = 0; i < steps.length; i++) {
      let j = i;
      while (j < steps.length && isWork(steps[j]) && steps[j].seconds <= HELD) j++;
      const group = steps.slice(i, j);
      if (group.length >= 2 && new Set(group.map((x) => x.intensity)).size > 1) {
        const secs = group.reduce((a, x) => a + x.seconds, 0);
        const avg = (f: (x: WorkoutStep) => number) => Math.round(group.reduce((a, x) => a + f(x) * x.seconds, 0) / secs * 1000) / 1000;
        out.push({ kind: 'step', seconds: secs, intensity: avg((x) => x.intensity), intensityHigh: avg((x) => x.intensityHigh ?? x.intensity), label: `${group[0].label ?? 'Effort'}, ridden steady` });
        merged++;
        i = j - 1;
      } else out.push(steps[i]);
    }
    return out;
  };
  const widen = (x: WorkoutStep): WorkoutStep => {
    if (!isWork(x) || x.noFloor || x.seconds < HELD) return x;
    const hi = x.intensityHigh ?? x.intensity;
    if (hi - x.intensity >= TIGHT) return x;
    const mid = (x.intensity + hi) / 2;
    widened++;
    return { ...x, intensity: Math.round((mid - OUTDOOR_BAND / 2) * 1000) / 1000, intensityHigh: Math.round((mid + OUTDOOR_BAND / 2) * 1000) / 1000 };
  };
  // Runs of plain steps at the top level are merged together; a repeated set is merged within itself.
  const out: WorkoutBlock[] = [];
  let pending: WorkoutStep[] = [];
  const flush = () => { out.push(...mergeRun(pending).map(widen)); pending = []; };
  for (const b of blocks) {
    if (b.kind === 'step') { pending.push(b); continue; }
    flush();
    out.push({ ...b, steps: mergeRun(b.steps).map(widen) });
  }
  flush();
  const changes: string[] = [];
  if (merged) changes.push('quick back-and-forth changes of target are ridden as steady efforts at their average');
  if (widened) changes.push('held targets get a wider range (6% of FTP) around the same effort');
  return { blocks: out, changes };
}

/**
 * The ride as it goes to a bike computer for an open road: unchanged unless it is rated adjusted for
 * outdoors, then softened as above. `note` is one plain sentence for the rider; absent when nothing changed.
 */
export function outdoorVersion(w: Workout): { workout: Workout; note?: string } {
  if (w.kind !== 'ride' || tagsOf(w).outdoor !== 'adjustable') return { workout: w };
  const { blocks, changes } = adjustBlocks(w.blocks);
  if (!changes.length) return { workout: w };
  const said = changes.join(', and ');
  return { workout: { ...w, blocks }, note: `Adjusted for riding outdoors: ${said}.` };
}

function rideIntensity(w: Workout, purpose: Purpose): Intensity {
  const IF = workoutStats(w.blocks).intensityFactor;
  const byIf: Intensity = IF >= 0.88 ? 'very-hard' : IF >= 0.8 ? 'hard' : IF >= 0.7 ? 'moderate' : 'easy';
  return atLeast(byIf, PURPOSE_FLOOR[purpose]);
}

function compute(w: Workout, given: Partial<WorkoutTags> = {}): WorkoutTags {
  if (w.kind === 'ride') {
    const o = { ...(OVERRIDES[w.id] ?? {}), ...given };
    const purpose = o.purpose ?? purposeOf(w);
    return {
      purpose,
      minutes: Math.round(workoutStats(w.blocks).seconds / 60),
      intensity: o.intensity ?? rideIntensity(w, purpose),
      outdoor: o.outdoor ?? outdoorRating(w),
      ...(o.series ? { series: o.series } : {}),
    };
  }
  const minutes = Math.round(w.walk?.minutes ?? w.minutes ?? 0);
  if (w.kind === 'strength') {
    const e = w.effort ?? 6;
    return { purpose: 'strength', minutes, intensity: e >= 8 ? 'very-hard' : e >= 7 ? 'hard' : e >= 5 ? 'moderate' : 'easy' };
  }
  if (w.kind === 'walk') {
    const recovery = (w.walk?.zoneHigh ?? 3) <= 2 || /recovery|stroll/i.test(w.name);
    const loaded = (w.walk?.packKg ?? 0) >= 9 || /hill|incline|ruck/i.test(w.name);
    return { purpose: recovery ? 'recovery' : 'endurance', minutes, intensity: loaded ? 'moderate' : 'easy' };
  }
  if (w.kind === 'run') {
    const bands = (w.run?.steps ?? []).flatMap((s) => [s.band, s.recoverBand]);
    if (bands.includes('hard')) return { purpose: 'vo2', minutes, intensity: 'very-hard' };
    if (bands.includes('tempo')) return { purpose: 'tempo', minutes, intensity: 'hard' };
    const walky = (w.run?.steps ?? []).every((s) => s.band === 'walk' || s.band === 'easy' || !s.band);
    return { purpose: 'endurance', minutes, intensity: minutes >= 60 || !walky ? 'moderate' : 'easy' };
  }
  return { purpose: 'mobility', minutes, intensity: 'easy' };
}

const cache = new Map<string, WorkoutTags>();

/** A workout's tags: its own when it carries them, otherwise worked out from its content (and kept for Library workouts). */
export function tagsOf(w: Workout): WorkoutTags {
  // A copy (on the calendar, or edited into the rider's own) may have changed since it was tagged: work it out again.
  if (w.source !== 'library' || w.libraryId) return compute(w);
  if (w.tags) return w.tags;
  const key = `${w.kind}|${w.id}`;
  if (!cache.has(key)) cache.set(key, compute(w));
  return cache.get(key)!;
}

/**
 * The workout with its tags set as data (the Library's own workouts are assembled through this). `given`
 * is what a new workout states about itself (its purpose when the steps can't say, its family and rung);
 * the rest is worked out from its content.
 */
export function withTags(w: Workout, given?: Partial<WorkoutTags>): Workout {
  return w.tags && !given ? w : { ...w, tags: compute(w, given) };
}
