import type { Equipment, Exercise, StrengthDose, StrengthFocus, StrengthQuality, Workout } from '../engine/types';
import { EXERCISES, firstFirst, lightLoad, type ExerciseDef } from './strength';

/**
 * The Library's strength sessions by quality and focus (30 Oct 2026, the plan
 * engine). Each is a fixed list of exercises with the equipment it needs; the
 * dose (how many sets, how many reps, how heavy) is applied when the session
 * goes on the calendar, at the level the plan or the rider picks. Nothing is
 * substituted for missing equipment: a rider without a barbell is offered the
 * sessions that need none, and sees the barbell ones only under "Everything,
 * gym included".
 */
export interface StrengthSessionDef {
  id: string;
  name: string;
  quality: StrengthQuality;
  focus: StrengthFocus;
  /** Equipment beyond bodyweight the session needs (all of it). */
  needs: Equipment[];
  /** Exercise ids, in order. An exercise marked to go first (swings) moves to the front. */
  ids: string[];
  /** Exercises to do fast: the reps say so. */
  fast?: string[];
  purpose: string;
}

const LEGS = 'legs and trunk', UPPER = 'upper body and posterior chain';

export const STRENGTH_SESSIONS: StrengthSessionDef[] = [
  // Heavy strength
  { id: 'heavy-legs', name: 'Heavy legs', quality: 'heavy', focus: 'legs', needs: ['dumbbells', 'bench'], ids: ['db-front-squat', 'split-squat', 'db-deadlift', 'hip-thrust', 'calf-raise', 'plank'],
    purpose: 'Few reps, big lifts for the legs: the strength masters riders lose fastest and gain most from.' },
  { id: 'heavy-upper', name: 'Heavy upper body', quality: 'heavy', focus: 'upper', needs: ['dumbbells', 'bench'], ids: ['db-bench', 'one-arm-row', 'db-overhead', 'db-rdl', 'db-pullover', 'farmer-carry'],
    purpose: 'Pressing, pulling and the posterior chain, heavy: an upper body that holds the bars steady for hours.' },
  { id: 'heavy-legs-kb', name: 'Heavy legs, kettlebell', quality: 'heavy', focus: 'legs', needs: ['kettlebell'], ids: ['kb-goblet-squat', 'kb-deadlift', 'kb-rack-lunge', 'kb-sl-rdl', 'calf-raise', 'kb-suitcase-carry'],
    purpose: 'One heavy kettlebell, every leg pattern: squat, hinge, a lunge and a single-leg deadlift.' },
  { id: 'heavy-upper-kb', name: 'Heavy upper body, kettlebell', quality: 'heavy', focus: 'upper', needs: ['kettlebell'], ids: ['kb-press', 'kb-row', 'kb-deadlift', 'pushup', 'kb-rack-carry', 'plank'],
    purpose: 'Press, row and deadlift with one bell, then a carry: upper-body strength for a kettlebell-only home.' },
  { id: 'heavy-legs-bb', name: 'Heavy legs, barbell', quality: 'heavy', focus: 'legs', needs: ['barbell', 'dumbbells'], ids: ['back-squat', 'bb-deadlift', 'bb-good-morning', 'walking-lunge', 'farmer-carry', 'plank'],
    purpose: 'The barbell lifts that build the most leg strength there is, with a lunge and a carry to finish.' },
  { id: 'heavy-upper-gym', name: 'Heavy upper body, gym', quality: 'heavy', focus: 'upper', needs: ['pullup-bar', 'dip-bars', 'barbell', 'dumbbells', 'kettlebell'], ids: ['pull-up', 'dip', 'bb-row', 'bb-deadlift', 'db-overhead', 'kb-rack-carry'],
    purpose: 'Pull-ups, dips and the barbell: the heaviest upper-body and posterior-chain session in the Library.' },
  { id: 'heavy-legs-bw', name: 'Legs: strength, bodyweight', quality: 'heavy', focus: 'legs', needs: [], ids: ['split-squat', 'single-leg-rdl', 'reverse-lunge', 'single-leg-bridge', 'calf-raise', 'side-plank'],
    purpose: 'With no weights, strength comes from one leg doing the work of two and from slow lowering: the hardest bodyweight versions.' },
  { id: 'heavy-upper-bw', name: 'Upper body: strength, bodyweight', quality: 'heavy', focus: 'upper', needs: [], ids: ['pushup', 'single-leg-rdl', 'single-leg-bridge', 'side-plank', 'hollow-hold', 'bird-dog'],
    purpose: 'No equipment: push-ups lowered slowly (feet on a step once they are easy) and the posterior chain one leg at a time.' },

  // Power
  { id: 'power-legs', name: 'Legs: power', quality: 'power', focus: 'legs', needs: ['dumbbells', 'bench'], ids: ['db-swing', 'step-up', 'walking-lunge', 'goblet-squat', 'russian-twist', 'hollow-hold'], fast: ['step-up', 'goblet-squat'],
    purpose: 'Moving a load fast: the bridge from strength to a sprint or a kick over a rise.' },
  { id: 'power-upper', name: 'Upper body: power', quality: 'power', focus: 'upper', needs: ['dumbbells'], ids: ['floor-press', 'bent-row', 'db-swing', 'lateral-lunge', 'reverse-fly', 'suitcase-carry'], fast: ['floor-press', 'bent-row'],
    purpose: 'Fast presses and rows with the hips snapping through a swing: power for out-of-the-saddle efforts.' },
  { id: 'power-legs-kb', name: 'Legs: power, kettlebell', quality: 'power', focus: 'legs', needs: ['kettlebell'], ids: ['kb-swing', 'kb-goblet-squat', 'kb-rack-lunge', 'kb-halo', 'kb-rack-carry', 'kb-get-up'], fast: ['kb-goblet-squat'],
    purpose: 'Swings first, then a fast squat and lunge, a halo and the get-up: power with one bell.' },
  { id: 'power-legs-bw', name: 'Legs: power, bodyweight', quality: 'power', focus: 'legs', needs: [], ids: ['step-up', 'bw-squat', 'reverse-lunge', 'lateral-lunge', 'russian-twist', 'hollow-hold'], fast: ['step-up', 'bw-squat', 'reverse-lunge'],
    purpose: 'No weights: speed is the load. Quick step-ups, squats and lunges for the legs that start a sprint.' },
  { id: 'power-upper-bw', name: 'Upper body: power, bodyweight', quality: 'power', focus: 'upper', needs: [], ids: ['pushup', 'glute-bridge', 'lateral-lunge', 'russian-twist', 'side-plank', 'bird-dog'], fast: ['pushup', 'glute-bridge', 'lateral-lunge'],
    purpose: 'No equipment: fast push-ups, a hip drive and quick lateral lunges, with the trunk holding it together.' },

  // Strength endurance
  { id: 'endurance-legs', name: 'Legs: endurance', quality: 'endurance', focus: 'legs', needs: [], ids: ['wall-sit', 'walking-lunge', 'glute-bridge', 'single-leg-bridge', 'side-plank', 'dead-bug'],
    purpose: 'Higher reps and long holds: legs and a trunk that last to the end of a long day.' },
  { id: 'endurance-upper', name: 'Upper body: endurance', quality: 'endurance', focus: 'upper', needs: ['dumbbells', 'bench'], ids: ['pushup', 'bench-dip', 'bent-row', 'reverse-fly', 'overhead-carry', 'plank'],
    purpose: 'Many reps and carries for the shoulders, arms and upper back that hold the position for hours.' },
  { id: 'endurance-upper-bands', name: 'Upper body: endurance, bands', quality: 'endurance', focus: 'upper', needs: ['band'], ids: ['band-row', 'band-pull-apart', 'band-face-pull', 'band-lat-pulldown', 'band-woodchop', 'monster-walk'],
    purpose: 'A band and a door frame: rows, pulldowns and the rear shoulders that hours on the hoods let go.' },
  { id: 'endurance-legs-bands', name: 'Legs: endurance, bands', quality: 'endurance', focus: 'legs', needs: ['band'], ids: ['band-good-morning', 'bw-squat', 'monster-walk', 'walking-lunge', 'pallof', 'side-plank'],
    purpose: 'Bands and bodyweight, many reps: the posterior chain and hips for a long climb.' },
  { id: 'endurance-upper-bw', name: 'Upper body and trunk, bodyweight', quality: 'endurance', focus: 'upper', needs: [], ids: ['pushup', 'plank', 'hollow-hold', 'russian-twist', 'side-plank', 'bird-dog'],
    purpose: 'No equipment: push-ups and the trunk work that keeps the upper body in position for hours.' },

  // One leg at a time
  { id: 'stability-legs', name: 'Legs: one leg at a time', quality: 'stability', focus: 'legs', needs: [], ids: ['bw-squat', 'step-up', 'single-leg-rdl', 'side-lying-leg-raise', 'clamshell', 'bird-dog'],
    purpose: 'Single-leg lifts and hip control: finds and fixes the weaker side, the way the pedal stroke works.' },
  { id: 'stability-upper', name: 'Upper body: one side at a time', quality: 'stability', focus: 'upper', needs: ['dumbbells'], ids: ['one-arm-row', 'pushup', 'lateral-lunge', 'single-leg-rdl', 'overhead-carry', 'side-plank'],
    purpose: 'One arm, one leg, one side at a time: the trunk resists the twist while the limbs work.' },
  { id: 'stability-upper-bw', name: 'Upper body: one side at a time, bodyweight', quality: 'stability', focus: 'upper', needs: [], ids: ['pushup', 'side-plank', 'bird-dog', 'dead-bug', 'lateral-lunge', 'single-leg-rdl'],
    purpose: 'No equipment: one side at a time, with the trunk holding still while the arms and legs move.' },

  // Short versions (30 Oct 2026, from the sweep): four exercises, so a session fits half an hour at any level.
  { id: 'heavy-legs-short', name: 'Heavy legs, short', quality: 'heavy', focus: 'legs', needs: ['dumbbells'], ids: ['goblet-squat', 'db-rdl', 'reverse-lunge', 'plank'],
    purpose: 'The heavy leg session in four lifts, for a day with half an hour.' },
  { id: 'heavy-upper-short', name: 'Heavy upper body, short', quality: 'heavy', focus: 'upper', needs: ['dumbbells', 'bench'], ids: ['db-bench', 'one-arm-row', 'db-overhead', 'farmer-carry'],
    purpose: 'Press, row, press overhead and carry: heavy upper-body work in half an hour.' },
  { id: 'heavy-legs-bw-short', name: 'Legs: strength, bodyweight, short', quality: 'heavy', focus: 'legs', needs: [], ids: ['split-squat', 'single-leg-rdl', 'single-leg-bridge', 'side-plank'],
    purpose: 'One leg doing the work of two, in half an hour and no equipment.' },
  { id: 'heavy-upper-bw-short', name: 'Upper body: strength, bodyweight, short', quality: 'heavy', focus: 'upper', needs: [], ids: ['pushup', 'single-leg-rdl', 'hollow-hold', 'bird-dog'],
    purpose: 'Slow push-ups and the posterior chain, in half an hour and no equipment.' },
  { id: 'power-legs-short', name: 'Legs: power, short', quality: 'power', focus: 'legs', needs: ['dumbbells'], ids: ['db-swing', 'step-up', 'goblet-squat', 'hollow-hold'], fast: ['step-up', 'goblet-squat'],
    purpose: 'Swings, fast step-ups and fast squats: leg power in half an hour.' },
  { id: 'power-upper-short', name: 'Upper body: power, short', quality: 'power', focus: 'upper', needs: ['dumbbells'], ids: ['floor-press', 'bent-row', 'db-swing', 'suitcase-carry'], fast: ['floor-press', 'bent-row'],
    purpose: 'Fast presses and rows with a swing: upper-body power in half an hour.' },
  { id: 'power-legs-bw-short', name: 'Legs: power, bodyweight, short', quality: 'power', focus: 'legs', needs: [], ids: ['step-up', 'bw-squat', 'reverse-lunge', 'hollow-hold'], fast: ['step-up', 'bw-squat', 'reverse-lunge'],
    purpose: 'Quick step-ups, squats and lunges: leg speed in half an hour, no equipment.' },
  { id: 'power-upper-bw-short', name: 'Upper body: power, bodyweight, short', quality: 'power', focus: 'upper', needs: [], ids: ['pushup', 'glute-bridge', 'lateral-lunge', 'side-plank'], fast: ['pushup', 'glute-bridge', 'lateral-lunge'],
    purpose: 'Fast push-ups, a hip drive and quick lateral lunges, in half an hour.' },
  { id: 'endurance-legs-short', name: 'Legs: endurance, short', quality: 'endurance', focus: 'legs', needs: [], ids: ['wall-sit', 'walking-lunge', 'glute-bridge', 'side-plank'],
    purpose: 'Long holds and many reps for the legs, in half an hour.' },
  { id: 'endurance-upper-short', name: 'Upper body: endurance, short', quality: 'endurance', focus: 'upper', needs: [], ids: ['pushup', 'plank', 'russian-twist', 'bird-dog'],
    purpose: 'Push-ups and the trunk work that holds the position, in half an hour.' },
  { id: 'stability-legs-short', name: 'Legs: one leg at a time, short', quality: 'stability', focus: 'legs', needs: [], ids: ['single-leg-rdl', 'step-up', 'clamshell', 'bird-dog'],
    purpose: 'Single-leg work and hip control in half an hour.' },
  { id: 'stability-upper-short', name: 'Upper body: one side at a time, short', quality: 'stability', focus: 'upper', needs: [], ids: ['pushup', 'side-plank', 'dead-bug', 'lateral-lunge'],
    purpose: 'One side at a time, with the trunk holding still, in half an hour.' },
];

// ---------------------------------------------------------------------------
// Doses. Sets and reps by quality and level; trunk, hip and carry work takes the lighter set count.

interface Scheme { sets: number; trunkSets: number; reps: string; load: string; hold: number }
const DOSE: Record<StrengthQuality, Record<StrengthDose, Scheme>> = {
  heavy: {
    foundation: { sets: 3, trunkSets: 2, reps: '10–12', load: 'Moderate: leave 2–3 reps in reserve; learn the movement first', hold: 30 },
    build:      { sets: 4, trunkSets: 3, reps: '6–8', load: 'Heavier: leave 1–2 reps in reserve on the last set', hold: 40 },
    maintain:   { sets: 2, trunkSets: 2, reps: '8', load: 'Build weights, fewer sets: keeps what was built', hold: 40 },
    light:      { sets: 2, trunkSets: 2, reps: '10', load: 'Light and quick; maintenance, not a stimulus', hold: 30 },
  },
  power: {
    foundation: { sets: 3, trunkSets: 2, reps: '8', load: 'Moderate weight, up fast, down under control', hold: 30 },
    build:      { sets: 4, trunkSets: 3, reps: '5', load: 'Moved fast with a full rest between sets; stop before the speed drops', hold: 40 },
    maintain:   { sets: 2, trunkSets: 2, reps: '5', load: 'Build weights, moved fast, fewer sets', hold: 40 },
    light:      { sets: 2, trunkSets: 2, reps: '5', load: 'Light and quick', hold: 30 },
  },
  endurance: {
    foundation: { sets: 3, trunkSets: 2, reps: '12–15', load: 'Light to moderate, steady tempo', hold: 40 },
    build:      { sets: 3, trunkSets: 3, reps: '15–20', load: 'Moderate, short rests: the last reps should burn', hold: 60 },
    maintain:   { sets: 2, trunkSets: 2, reps: '15', load: 'Build weights, fewer sets', hold: 45 },
    light:      { sets: 2, trunkSets: 2, reps: '12', load: 'Light and easy', hold: 30 },
  },
  stability: {
    foundation: { sets: 3, trunkSets: 2, reps: '8–10', load: 'Slow and controlled; balance before weight', hold: 30 },
    build:      { sets: 4, trunkSets: 3, reps: '8', load: 'Add weight once every rep is steady; slow on the way down', hold: 40 },
    maintain:   { sets: 2, trunkSets: 2, reps: '8', load: 'Build weights, fewer sets', hold: 40 },
    light:      { sets: 2, trunkSets: 2, reps: '8', load: 'Light; balance and control only', hold: 30 },
  },
};
/** Minutes for six exercises at each level (scaled for more or fewer). */
const DOSE_MINUTES: Record<StrengthDose, number> = { foundation: 40, build: 45, maintain: 30, light: 25 };
/** Effort (RPE) by level, which drives the load estimate. */
const DOSE_EFFORT: Record<StrengthDose, number> = { foundation: 6, build: 7, maintain: 5, light: 4 };
export const DOSE_WORDS: Record<StrengthDose, string> = { foundation: 'Foundation', build: 'Build', maintain: 'Maintain', light: 'Light' };

const isHold = (d: ExerciseDef) => /plank|dead bug|bird dog|pallof|wall sit|hollow|carry/i.test(d.name);
const accessory = (d: ExerciseDef) => d.pattern === 'trunk' || d.pattern === 'hip' || d.pattern === 'rotate' || d.pattern === 'carry';

/** "Build: 4 × 6–8": the level and the main sets, for the card and the calendar. */
export function doseLine(quality: StrengthQuality, dose: StrengthDose): string {
  const s = DOSE[quality][dose];
  return `${DOSE_WORDS[dose]}: ${s.sets} × ${s.reps}`;
}

export function doseMinutes(def: Pick<StrengthSessionDef, 'ids'>, dose: StrengthDose): number {
  return Math.round(DOSE_MINUTES[dose] * Math.max(4, def.ids.length) / 6);
}

const def = (id: string) => EXERCISES.find((e) => e.id === id)!;

/** The session as a Library workout at a level: its exercises with sets, reps and load, its length and load estimate. */
export function strengthWorkout(d: StrengthSessionDef, dose: StrengthDose, estimate: (minutes: number, effort: number) => number): Workout {
  const s = DOSE[d.quality][dose];
  const exercises: Exercise[] = d.ids.map((id) => {
    const e = def(id);
    const hold = isHold(e);
    const fast = d.fast?.includes(id) || (d.quality === 'power' && (e.first || e.qualities[0] === 'power'));
    const reps = hold ? undefined : `${e.reps ?? s.reps}${e.unilateral ? ' per side' : ''}${fast ? ', fast' : ''}`;
    return {
      name: e.name, sets: accessory(e) ? s.trunkSets : s.sets, reps, holdSeconds: hold ? s.hold : undefined,
      load: e.loadable ? s.load : lightLoad(e), cue: e.cue, why: e.why, equipment: e.equipment,
    };
  });
  const minutes = doseMinutes(d, dose);
  const effort = DOSE_EFFORT[dose];
  return {
    id: `lib-sq-${d.id}`, name: d.name, subtitle: doseLine(d.quality, dose), kind: 'strength', family: 'recovery', purpose: d.purpose,
    physiology: QUALITY_PHYSIOLOGY[d.quality], phases: ['any'], bases: ['power', 'hr'], setting: 'any', blocks: [],
    exercises: firstFirst(exercises), minutes, effort, estimatedTss: estimate(minutes, effort), source: 'library',
    strength: { quality: d.quality, focus: d.focus, needs: d.needs },
  };
}

const QUALITY_PHYSIOLOGY: Record<StrengthQuality, string> = {
  heavy: 'Heavy, low-rep work builds muscle and tendon strength, which masters riders lose fastest and which no amount of riding replaces.',
  power: 'Rate of force development falls with age faster than strength; moving a load fast keeps the quick part of the stroke.',
  endurance: 'Higher reps, carries and long holds train the muscles to keep working well when they are tired, as at the end of a long day.',
  stability: 'One side at a time finds and fixes the weaker leg, and trains the hips and trunk to hold the pelvis level over every pedal stroke.',
};

/** A session's focus in words, as the card shows it. */
export const FOCUS_WORDS: Record<StrengthFocus, string> = { legs: LEGS, upper: UPPER, full: 'whole body' };

/** Whether a rider with this equipment can do the session. */
export function hasNeeds(needs: Equipment[], equipment: Equipment[]): boolean {
  return needs.every((q) => equipment.includes(q));
}

/** Equipment names for a "Needs …" tag. */
export const EQUIPMENT_WORDS: Partial<Record<Equipment, string>> = { dumbbells: 'Dumbbells', bench: 'Bench', kettlebell: 'Kettlebell', band: 'Bands', barbell: 'Barbell', 'pullup-bar': 'Pull-up bar', 'dip-bars': 'Dip bars' };

/** Re-dose a strength workout (a Library session, or a calendar copy of one) at another level. */
export function redose(w: Workout, dose: StrengthDose, estimate: (minutes: number, effort: number) => number): Workout {
  const id = (w.libraryId ?? w.id).replace(/^lib-sq-/, '');
  const d = STRENGTH_SESSIONS.find((x) => x.id === id);
  if (!d) return w;
  const fresh = strengthWorkout(d, dose, estimate);
  return { ...fresh, id: w.id, source: w.source, libraryId: w.libraryId, purpose: w.purpose || fresh.purpose, strength: { ...fresh.strength!, dose } };
}
