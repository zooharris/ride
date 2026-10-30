import type { Equipment, Exercise, StrengthQuality } from '../engine/types';

/**
 * Strength exercises for cyclists, by movement pattern. Each one says how to do
 * it and why it matters on the bike. Sessions are built from these by pattern,
 * so a rider with only bodyweight still gets a complete session.
 */
export type Pattern = 'squat' | 'hinge' | 'single-leg' | 'push' | 'pull' | 'carry' | 'rotate' | 'trunk' | 'hip';

/**
 * What a strength exercise trains, apart from the muscles (30 Oct 2026): heavy strength
 * (loadable lifts done for few, hard reps), power (moved fast), strength endurance (holds,
 * carries, high reps) and stability (one leg or one side at a time, resisting rotation).
 * Each exercise has one or two; a session's quality is what most of its exercises share.
 */
export type { StrengthQuality } from '../engine/types';
export const QUALITY_LABEL: Record<StrengthQuality, string> = { heavy: 'Heavy strength', power: 'Power', endurance: 'Strength endurance', stability: 'One leg at a time' };

export interface ExerciseDef extends Omit<Exercise, 'sets' | 'reps' | 'load'> {
  id: string;
  pattern: Pattern;
  /** Suitable for heavier, lower-rep work (needs load) or best kept light. */
  loadable: boolean;
  unilateral?: boolean;
  /** Reps that suit this exercise whatever the session's scheme (e.g. pull-ups: as many clean reps as you have, up to 8). */
  reps?: string;
  /** An explosive move that goes first in any session that includes it, while the legs are fresh (swings). */
  first?: true;
  /** What it trains: heavy strength, power, strength endurance, stability (one or two). */
  qualities: StrengthQuality[];
}

const E = (id: string, pattern: Pattern, name: string, equipment: Equipment[], cue: string, why: string, loadable = true, unilateral = false, reps?: string): ExerciseDef =>
  ({ id, pattern, name, equipment, cue, why, loadable, unilateral, qualities: QUALITIES[id] ?? [], ...(reps ? { reps } : {}) });

/** Each exercise's qualities (30 Oct 2026). Kept beside the list so the list itself reads as before. */
const QUALITIES: Record<string, StrengthQuality[]> = {
  // squat
  'goblet-squat': ['heavy'], 'bw-squat': ['endurance'], 'db-front-squat': ['heavy'], 'wall-sit': ['endurance'], 'back-squat': ['heavy'], 'kb-goblet-squat': ['heavy'],
  // hinge
  'db-rdl': ['heavy'], 'hip-thrust': ['heavy'], 'glute-bridge': ['endurance'], 'single-leg-rdl': ['stability'], 'single-leg-bridge': ['stability', 'endurance'],
  'db-swing': ['power'], 'db-deadlift': ['heavy'], 'bb-deadlift': ['heavy'], 'bb-good-morning': ['heavy'], 'band-good-morning': ['endurance'],
  'kb-swing': ['power'], 'kb-deadlift': ['heavy'], 'kb-sl-rdl': ['stability'],
  // single leg
  'split-squat': ['stability', 'heavy'], 'reverse-lunge': ['stability'], 'step-up': ['power', 'stability'], 'lateral-lunge': ['stability'], 'walking-lunge': ['endurance', 'stability'], 'kb-rack-lunge': ['stability', 'heavy'],
  // push
  'db-bench': ['heavy'], 'pushup': ['endurance', 'power'], 'db-overhead': ['heavy', 'power'], 'floor-press': ['heavy'], 'dip': ['heavy'], 'bench-dip': ['endurance'], 'kb-press': ['power', 'heavy'],
  // pull
  'one-arm-row': ['heavy'], 'bent-row': ['heavy', 'power'], 'band-pull-apart': ['endurance'], 'reverse-fly': ['endurance'], 'band-row': ['endurance'], 'db-pullover': ['endurance'],
  'pull-up': ['heavy'], 'band-lat-pulldown': ['endurance'], 'bb-row': ['heavy'], 'band-face-pull': ['endurance', 'stability'], 'kb-row': ['heavy'],
  // trunk and rotation
  'dead-bug': ['stability'], 'plank': ['endurance'], 'side-plank': ['stability', 'endurance'], 'bird-dog': ['stability'], 'hollow-hold': ['endurance'], 'kb-get-up': ['power', 'stability'],
  pallof: ['stability'], 'band-woodchop': ['power'], 'russian-twist': ['endurance'], 'kb-halo': ['power', 'stability'],
  // hips and calves
  clamshell: ['stability'], 'side-lying-leg-raise': ['stability'], 'calf-raise': ['endurance'], 'monster-walk': ['stability', 'endurance'],
  // carries
  'farmer-carry': ['endurance', 'heavy'], 'suitcase-carry': ['stability'], 'overhead-carry': ['stability'], 'kb-suitcase-carry': ['stability'], 'kb-rack-carry': ['endurance'],
};

export const EXERCISES: ExerciseDef[] = [
  // Squat
  E('goblet-squat', 'squat', 'Goblet squat', ['dumbbells'], 'Hold one dumbbell at your chest, sit down between your heels, chest up, knees tracking over toes.', 'Quad and glute strength through the full pedal stroke; teaches a tall torso under load.'),
  E('bw-squat', 'squat', 'Bodyweight squat', ['bodyweight'], 'Feet shoulder width, sit back and down to thigh-parallel, drive up through the whole foot.', 'The base pattern; keeps knees and hips moving well.'),
  E('db-front-squat', 'squat', 'Dumbbell front squat', ['dumbbells'], 'A dumbbell on each shoulder, elbows forward, squat to parallel without the torso folding.', 'Heavier quad work than a goblet allows once the pattern is clean.'),
  // Hinge
  E('db-rdl', 'hinge', 'Dumbbell Romanian deadlift', ['dumbbells'], 'Soft knees, push the hips back until the hamstrings pull, dumbbells sliding down the thighs, flat back, stand tall.', 'Hamstrings and glutes: the muscles that pull the pedal through the bottom of the stroke and protect the lower back.'),
  E('hip-thrust', 'hinge', 'Hip thrust on bench', ['bench', 'dumbbells'], 'Upper back on the bench, feet flat, dumbbell across the hips; drive the hips up until the torso is level, squeeze, lower slowly.', 'The strongest glute exercise there is; glutes are what fade first on a long climb.'),
  E('glute-bridge', 'hinge', 'Glute bridge', ['bodyweight'], 'On your back, feet flat, push through the heels until hips are fully open, hold a second.', 'Glute activation without any equipment.'),
  E('single-leg-rdl', 'hinge', 'Single-leg Romanian deadlift', ['dumbbells', 'bodyweight'], 'One foot down, hinge forward reaching the dumbbell toward the floor as the other leg rises behind; keep hips level.', 'Hamstring strength plus the balance and hip stability a one-leg sport demands.', true, true),
  // Single leg
  E('split-squat', 'single-leg', 'Bulgarian split squat', ['bench', 'dumbbells', 'bodyweight'], 'Rear foot on the bench, front shin vertical, lower straight down until the rear knee nearly touches, drive up.', 'The most bike-specific leg exercise: one leg working at a time, hip flexor of the rear leg stretched.', true, true),
  E('reverse-lunge', 'single-leg', 'Reverse lunge', ['dumbbells', 'bodyweight'], 'Step back into a lunge, front knee over the ankle, push through the front heel to stand.', 'Single-leg strength that is kind to the knees.', true, true),
  E('step-up', 'single-leg', 'Step-up onto bench', ['bench', 'dumbbells', 'bodyweight'], 'Whole foot on the bench, drive up without pushing off the back leg, control the way down.', 'Quad and glute power at a knee angle close to the top of the pedal stroke.', true, true),
  // Push
  E('db-bench', 'push', 'Dumbbell bench press', ['bench', 'dumbbells'], 'Dumbbells over the chest, lower to the sides of the chest with elbows at about 45 degrees, press up.', 'Upper-body strength holds the bars steady for hours and balances a cyclist’s rounded posture.'),
  E('pushup', 'push', 'Push-up', ['bodyweight'], 'Hands under shoulders, body in one line, chest to the floor and back; from the knees if needed.', 'Pressing strength and a trunk that holds a plank for the whole set.'),
  E('db-overhead', 'push', 'Dumbbell overhead press', ['dumbbells'], 'Dumbbells at the shoulders, press straight up without arching the back, lower under control.', 'Shoulder strength and thoracic extension, the opposite of the riding position.'),
  // Pull
  E('one-arm-row', 'pull', 'One-arm dumbbell row', ['dumbbells', 'bench'], 'Hand and knee on the bench, pull the dumbbell to the hip, elbow close, squeeze the shoulder blade.', 'Upper-back strength that stops shoulders rounding over the bars and keeps the neck happy.', true, true),
  E('bent-row', 'pull', 'Bent-over dumbbell row', ['dumbbells'], 'Hinge forward with a flat back, row both dumbbells to the ribs, pause, lower slowly.', 'Posterior chain and upper back together.'),
  E('band-pull-apart', 'pull', 'Band pull-apart', ['band'], 'Arms straight in front holding a band, pull it apart to the chest, squeeze the shoulder blades.', 'Rear shoulders and posture; the antidote to hours on the hoods.', false),
  E('reverse-fly', 'pull', 'Dumbbell reverse fly', ['dumbbells'], 'Hinged forward, light dumbbells, raise the arms out to the sides leading with the elbows.', 'Rear shoulders and upper back; light weight, strict form.', false),
  // Trunk
  E('dead-bug', 'trunk', 'Dead bug', ['bodyweight'], 'On your back, arms up, knees over hips; lower one arm and the opposite leg slowly without the lower back lifting.', 'A trunk that transfers power without the pelvis rocking.', false),
  E('plank', 'trunk', 'Plank', ['bodyweight'], 'Forearms down, body in one line, glutes tight, breathe.', 'Front-of-body endurance for the riding position.', false),
  E('side-plank', 'trunk', 'Side plank', ['bodyweight'], 'Elbow under the shoulder, hips lifted and stacked, body straight; both sides.', 'Lateral trunk strength that keeps the hips level on each pedal stroke.', false, true),
  E('pallof', 'rotate', 'Pallof press with band', ['band'], 'Band anchored to the side at chest height, press the hands straight out and resist the pull to rotate.', 'Anti-rotation strength; the trunk stays still while the legs work.', false, true),
  E('bird-dog', 'trunk', 'Bird dog', ['bodyweight'], 'On hands and knees, reach one arm and the opposite leg out long, hold, switch; no twist in the hips.', 'Back endurance and hip control.', false, true),
  // Hip
  E('clamshell', 'hip', 'Clamshell', ['bodyweight', 'band'], 'On your side, knees bent, feet together, lift the top knee without the pelvis rolling back.', 'Glute medius, which keeps the knee tracking straight over the pedal.', false, true),
  E('side-lying-leg-raise', 'hip', 'Side-lying leg raise', ['bodyweight'], 'On your side, top leg straight, lift it to about 45 degrees with the toes pointing forward, lower slowly.', 'Hip abductors for a stable pelvis in the saddle.', false, true),
  E('calf-raise', 'hip', 'Single-leg calf raise', ['bodyweight', 'dumbbells'], 'On one foot, rise onto the toes, pause, lower past level if on a step.', 'Calves and ankle stiffness for an efficient pedal stroke.', true, true),
  E('monster-walk', 'hip', 'Band monster walk', ['band'], 'Band around the ankles or above the knees, quarter squat, step sideways keeping tension; both directions.', 'Glute medius under load; the hip stays level when you stand on the pedals.', false),
  // More squat, hinge, single leg
  E('wall-sit', 'squat', 'Wall sit', ['bodyweight'], 'Back flat against a wall, thighs level, hold; breathe steadily.', 'Isometric quad endurance like a long seated climb.', false),
  E('single-leg-bridge', 'hinge', 'Single-leg glute bridge', ['bodyweight'], 'On your back, one foot flat, the other leg held up; drive the hips up with the one leg, keep the pelvis level.', 'One-sided glute strength and pelvic control.', false, true),
  E('lateral-lunge', 'single-leg', 'Lateral lunge', ['bodyweight', 'dumbbells'], 'Step wide to one side, sit into that hip with the other leg straight, push back to standing.', 'Adductors and glutes in the sideways plane the bike never trains; protects the hips.', true, true),
  { ...E('db-swing', 'hinge', 'Dumbbell swing', ['dumbbells'], 'One dumbbell held in both hands, hinge and swing it between the legs, snap the hips forward to chest height; the arms just hold on.', 'Explosive hip extension: power for sprints and standing climbs.'), first: true },
  // More push and pull
  E('floor-press', 'push', 'Dumbbell floor press', ['dumbbells'], 'On your back on the floor, dumbbells pressed from the upper arms resting on the floor to lockout.', 'A pressing option with no bench, kind to the shoulders.'),
  E('band-row', 'pull', 'Band row', ['band'], 'Band anchored in front at chest height, row the hands to the ribs, squeeze the shoulder blades, slow return.', 'Upper-back strength with just a band.'),
  E('db-pullover', 'pull', 'Dumbbell pullover', ['dumbbells', 'bench'], 'Lying across the bench, one dumbbell held over the chest, lower it in an arc behind the head and pull it back.', 'Lats and chest opening; the breathing muscles get a stretch under load.'),
  // More trunk
  E('farmer-carry', 'carry', 'Farmer carry', ['dumbbells'], 'A heavy dumbbell in each hand, walk tall for the distance or time; no leaning.', 'Grip, trunk and posture under load; useful strength for the whole day, not just the bike.', true),
  E('hollow-hold', 'trunk', 'Hollow hold', ['bodyweight'], 'On your back, lower back pressed down, arms and legs held long and low, hold.', 'Deep front-trunk strength for an aero position that does not sag.', false),
  E('suitcase-carry', 'carry', 'Suitcase carry', ['dumbbells'], 'One heavy dumbbell in one hand, walk tall without leaning to either side; switch hands.', 'Lateral trunk strength; the hips stay level while one leg pushes.', true, true),
  // Gym and home versions of the seven patterns (Oct 20, 2026). Gym versions need a barbell,
  // a pull-up bar or dip bars; each has a home version with dumbbells, a bench or a band.
  E('back-squat', 'squat', 'Back squat', ['barbell'], 'Bar across the upper back (not the neck), from a rack or safety stands; sit down to thighs level, knees over toes, heels down, drive up.', 'The heaviest leg loading there is: quads and glutes for power at the top of the stroke, and bone loading riding never gives.'),
  E('walking-lunge', 'single-leg', 'Walking lunge', ['dumbbells', 'bodyweight'], 'A dumbbell in each hand, a long step forward, lower until the back knee nearly touches, front shin vertical, step through into the next.', 'Single-leg strength with balance and hip control, one leg at a time like the pedal stroke.', true, true),
  E('db-deadlift', 'hinge', 'Dumbbell deadlift', ['dumbbells'], 'Dumbbells beside the feet, hips back, flat back; push the floor away and stand tall, then lower the same way.', 'Whole posterior chain from the floor: glutes, hamstrings and back that hold the riding position for hours.'),
  E('bb-deadlift', 'hinge', 'Barbell deadlift', ['barbell'], 'Bar over the middle of the feet, shins close, flat back, hands just outside the knees; push the floor away, bar close to the legs, stand tall, lower with control.', 'The strongest hinge: posterior chain and grip under the heaviest load you can move safely.'),
  E('bb-good-morning', 'hinge', 'Barbell good morning', ['barbell'], 'Light bar across the upper back, soft knees, push the hips back until the torso tips about 45 degrees with a flat back, then drive the hips forward.', 'Hamstrings and lower back in the bent-over position cycling holds; keep the weight light.'),
  E('band-good-morning', 'hinge', 'Band good morning', ['band'], 'Band under both feet and over the upper back; push the hips back with a flat back until the torso tips about 45 degrees, stand back up.', 'The same hamstring and lower-back work as the barbell version with just a band.', false, false, '12–15'),
  E('dip', 'push', 'Dip', ['dip-bars'], 'On two parallel bars, arms straight, shoulders down; bend the elbows straight back with a slight lean until the upper arms are level, press up.', 'Chest, shoulders and triceps that hold the upper body still over the bars.', false, false, '5–10'),
  E('bench-dip', 'push', 'Bench dip', ['bench'], 'Hands on the bench edge behind you, fingers forward, knees bent; bend the elbows straight back to a right angle, shoulders down, press up.', 'Triceps and shoulder strength with only a bench; bend the knees more to make it easier.', false, false, '8–12'),
  E('pull-up', 'pull', 'Pull-up', ['pullup-bar'], 'Hang with hands just wider than the shoulders, draw the shoulder blades down and pull until the chin clears the bar, lower slowly to a straight-arm hang.', 'Back and arm strength for climbing out of the saddle and a body that is not just legs.', false, false, '3–8'),
  E('band-lat-pulldown', 'pull', 'Band lat pulldown', ['band'], 'Band anchored high (top of a door), kneeling tall; pull the elbows down and out until the hands are by the shoulders, return slowly.', 'The pull-up muscles with a band: lats and upper back.', false, false, '12–15'),
  E('bb-row', 'pull', 'Barbell row', ['barbell'], 'Overhand grip just outside the knees, hinge to about 45 degrees with a flat back, row the bar to the lower ribs, lower slowly.', 'Heavy upper-back and posterior-chain work: posture on the bike and the hinge held under load.'),
  E('band-face-pull', 'pull', 'Band face pull', ['band'], 'Band anchored at head height, pull the hands toward the face with elbows high and wide, thumbs back, squeeze the shoulder blades.', 'Rear shoulders and the rotator cuff: the antidote to hours on the hoods.', false, false, '12–15'),
  E('overhead-carry', 'carry', 'Overhead carry', ['dumbbells'], 'Press one dumbbell overhead, arm straight beside the ear, ribs down; walk tall without leaning, then switch hands.', 'Shoulder stability and a trunk that stays upright under load.', true, true),
  E('band-woodchop', 'rotate', 'Band woodchop', ['band'], 'Band anchored high to one side, both hands on it, feet wide; pull down and across to the opposite knee, turning the hips and chest, arms long; return slowly.', 'Rotational power from the hips through the trunk, controlled on the way back.', false, true, '10–12'),
  E('russian-twist', 'rotate', 'Russian twist', ['dumbbells', 'bodyweight'], 'Sit with knees bent, heels down, lean back about 45 degrees with a straight back; turn the chest and dumbbell side to side, knees still.', 'Obliques and trunk rotation; the trunk turns while the hips stay put.', false, true, '10–12'),
  // Kettlebell versions (Oct 21, 2026). One bell is enough for all of these; they lead the
  // rotation for a rider who has one, after any gym lifts.
  E('kb-goblet-squat', 'squat', 'Kettlebell goblet squat', ['kettlebell'], 'Hold the bell by the horns at your chest, elbows in; sit down between your heels with the chest up, drive up through the whole foot.', 'Quad and glute strength through the full pedal stroke; the bell at the chest keeps the torso tall.'),
  { ...E('kb-swing', 'hinge', 'Kettlebell swing', ['kettlebell'], 'Hike the bell back between the legs, snap the hips forward so it floats to chest height; arms just guide it, flat back, glutes tight at the top.', 'Explosive hip extension and posterior-chain endurance: power for sprints and standing climbs.', true, false, '10–15'), first: true },
  E('kb-deadlift', 'hinge', 'Kettlebell deadlift', ['kettlebell'], 'Bell between the feet, hips back, flat back, hands on the handle; push the floor away and stand tall, lower the same way.', 'Glutes, hamstrings and back from the floor; the pattern to learn before the swing.'),
  E('kb-sl-rdl', 'hinge', 'Kettlebell single-leg deadlift', ['kettlebell'], 'Bell in the hand opposite the standing leg; hinge forward as the free leg rises behind, hips square, bell toward the floor, stand tall.', 'Hamstring strength with the hip stability each pedal stroke asks for.', true, true),
  E('kb-rack-lunge', 'single-leg', 'Kettlebell reverse lunge, racked', ['kettlebell'], 'Bell in the rack position at one shoulder, step back into a lunge, front knee over the ankle, push through the front heel to stand.', 'Single-leg strength with the trunk resisting a one-sided load, as on a hard climb.', true, true),
  E('kb-press', 'push', 'Kettlebell overhead press', ['kettlebell'], 'Bell racked at the shoulder, ribs down, glutes tight; press straight up until the arm is beside the ear, lower back to the rack.', 'Shoulder strength and stability, the opposite of the riding position, one side at a time.', true, true),
  E('kb-row', 'pull', 'Kettlebell row', ['kettlebell'], 'Staggered stance, hinge forward with a flat back, free hand on the front knee; row the bell to the hip, squeeze the shoulder blade, lower slowly.', 'Upper-back strength that stops the shoulders rounding over the bars.', true, true),
  E('kb-suitcase-carry', 'carry', 'Kettlebell suitcase carry', ['kettlebell'], 'Bell in one hand by your side, walk tall without leaning or letting the hip drop; switch hands.', 'Lateral trunk strength; the hips stay level while one leg pushes.', true, true),
  E('kb-rack-carry', 'carry', 'Kettlebell rack carry', ['kettlebell'], 'Bell in the rack position at one shoulder, elbow tucked, ribs down; walk tall, then switch sides.', 'Trunk and upper-back endurance under an off-centre load.', true, true),
  E('kb-halo', 'rotate', 'Kettlebell halo', ['kettlebell'], 'Hold the bell upside down by the horns at the chest; circle it slowly around the head, close to the neck, ribs down; both directions.', 'Shoulder mobility and a trunk that stays still while the arms move: the hoods posture undone.', false, false, '5 each way'),
  E('kb-get-up', 'trunk', 'Kettlebell Turkish get-up', ['kettlebell'], 'Light bell pressed up from the floor, eyes on it; roll to the elbow, the hand, bridge, sweep the leg through, kneel, stand; reverse it slowly.', 'Shoulder stability and whole-body control in one movement; light and slow, never rushed.', false, true, '1–2'),
];

/** Carries and rotation borrow a trunk exercise when the rider has nothing for them (e.g. bodyweight only). */
const GYM: Equipment[] = ['barbell', 'pullup-bar', 'dip-bars'];
const FALLBACK: Partial<Record<Pattern, Pattern>> = { carry: 'trunk', rotate: 'trunk' };

export function exercisesFor(pattern: Pattern, have: Equipment[]): ExerciseDef[] {
  // When the rider has gym equipment, its exercises lead the rotation: a barbell should be used, not saved for week five.
  // A kettlebell comes next, for the same reason.
  const gym = (e: ExerciseDef) => (e.equipment.some((q) => GYM.includes(q)) ? 0 : e.equipment.includes('kettlebell') ? 1 : 2);
  const found = EXERCISES.filter((e) => e.pattern === pattern && e.equipment.some((q) => have.includes(q))).sort((x, y) => gym(x) - gym(y));
  const fb = FALLBACK[pattern];
  return found.length || !fb ? found : exercisesFor(fb, have);
}

/** Load advice for an exercise that is not loaded heavily: a band says so, the rest is bodyweight. */
export function lightLoad(e: Pick<ExerciseDef, 'equipment'>): string {
  if (e.equipment.length === 1 && e.equipment[0] === 'band') return 'Light to medium band; slow and controlled';
  if (e.equipment.length === 1 && e.equipment[0] === 'kettlebell') return 'Light kettlebell; slow and controlled';
  return 'Bodyweight; slow and controlled';
}

/** An exercise marked to go first moves to the front of the session; the rest keep their order. */
export function firstFirst<T extends { name: string }>(list: T[]): T[] {
  const lead = list.filter((e) => EXERCISES.some((d) => d.first && d.name === e.name));
  return [...lead, ...list.filter((e) => !lead.includes(e))];
}
