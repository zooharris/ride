import type { Workout, WorkoutStep } from '../engine/types';
import { workoutStats } from '../engine/workout';

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

/** The outdoor rule, from the steps alone. */
export function outdoorRating(w: Workout): OutdoorRating {
  if (w.trainerOnly) return 'indoor';
  const s = flatSteps(w);
  // Fast on/off: four or more on/off pairs in a row, every step under a minute, with work among them (30/30s, 40/20s).
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    run = s[i].seconds < 60 ? run + 1 : 0;
    if (run >= 8 && s.slice(i - 7, i + 1).some((x) => x.intensity >= WORK)) return 'indoor';
  }
  // A target held for three minutes or more with no range: a single number of watts is hard to keep on an
  // open road. (A one-minute pickup at a single number is ridden by feel anywhere.)
  const tight = s.some((x) => x.intensity >= WORK && x.intensity < ALL_OUT && x.seconds >= 180 && !x.intensityHigh && !x.noFloor);
  // A cluster: three or more steps in a row of two minutes or less, with work among them.
  let cluster = false;
  for (let i = 0; i + 2 < s.length && !cluster; i++) {
    const three = s.slice(i, i + 3);
    cluster = three.every((x) => x.seconds <= 120) && three.some((x) => x.intensity >= WORK);
  }
  return tight || cluster ? 'adjustable' : 'well';
}

function rideIntensity(w: Workout, purpose: Purpose): Intensity {
  const IF = workoutStats(w.blocks).intensityFactor;
  const byIf: Intensity = IF >= 0.88 ? 'very-hard' : IF >= 0.8 ? 'hard' : IF >= 0.7 ? 'moderate' : 'easy';
  return atLeast(byIf, PURPOSE_FLOOR[purpose]);
}

function compute(w: Workout): WorkoutTags {
  if (w.kind === 'ride') {
    const o = OVERRIDES[w.id] ?? {};
    const purpose = o.purpose ?? RIDE_PURPOSE[w.family];
    return {
      purpose,
      minutes: Math.round(workoutStats(w.blocks).seconds / 60),
      intensity: o.intensity ?? rideIntensity(w, purpose),
      outdoor: o.outdoor ?? outdoorRating(w),
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

/** The workout with its tags set as data (the Library's own workouts are assembled through this). */
export function withTags(w: Workout): Workout {
  return w.tags ? w : { ...w, tags: compute(w) };
}
