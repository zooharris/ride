import type { Equipment, Exercise } from '../engine/types';

/**
 * Strength exercises for cyclists, by movement pattern. Each one says how to do
 * it and why it matters on the bike. Sessions are built from these by pattern,
 * so a rider with only bodyweight still gets a complete session.
 */
export type Pattern = 'squat' | 'hinge' | 'single-leg' | 'push' | 'pull' | 'trunk' | 'hip';

export interface ExerciseDef extends Omit<Exercise, 'sets' | 'reps' | 'load'> {
  id: string;
  pattern: Pattern;
  /** Suitable for heavier, lower-rep work (needs load) or best kept light. */
  loadable: boolean;
  unilateral?: boolean;
}

const E = (id: string, pattern: Pattern, name: string, equipment: Equipment[], cue: string, why: string, loadable = true, unilateral = false): ExerciseDef =>
  ({ id, pattern, name, equipment, cue, why, loadable, unilateral });

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
  E('pallof', 'trunk', 'Pallof press with band', ['band'], 'Band anchored to the side at chest height, press the hands straight out and resist the pull to rotate.', 'Anti-rotation strength; the trunk stays still while the legs work.', false, true),
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
  E('db-swing', 'hinge', 'Dumbbell swing', ['dumbbells'], 'One dumbbell held in both hands, hinge and swing it between the legs, snap the hips forward to chest height; the arms just hold on.', 'Explosive hip extension: power for sprints and standing climbs.'),
  // More push and pull
  E('floor-press', 'push', 'Dumbbell floor press', ['dumbbells'], 'On your back on the floor, dumbbells pressed from the upper arms resting on the floor to lockout.', 'A pressing option with no bench, kind to the shoulders.'),
  E('band-row', 'pull', 'Band row', ['band'], 'Band anchored in front at chest height, row the hands to the ribs, squeeze the shoulder blades, slow return.', 'Upper-back strength with just a band.'),
  E('db-pullover', 'pull', 'Dumbbell pullover', ['dumbbells', 'bench'], 'Lying across the bench, one dumbbell held over the chest, lower it in an arc behind the head and pull it back.', 'Lats and chest opening; the breathing muscles get a stretch under load.'),
  // More trunk
  E('farmer-carry', 'trunk', 'Farmer carry', ['dumbbells'], 'A heavy dumbbell in each hand, walk tall for the distance or time; no leaning.', 'Grip, trunk and posture under load; useful strength for the whole day, not just the bike.', true),
  E('hollow-hold', 'trunk', 'Hollow hold', ['bodyweight'], 'On your back, lower back pressed down, arms and legs held long and low, hold.', 'Deep front-trunk strength for an aero position that does not sag.', false),
  E('suitcase-carry', 'trunk', 'Suitcase carry', ['dumbbells'], 'One heavy dumbbell in one hand, walk tall without leaning to either side; switch hands.', 'Lateral trunk strength; the hips stay level while one leg pushes.', true, true),
];

export function exercisesFor(pattern: Pattern, have: Equipment[]): ExerciseDef[] {
  return EXERCISES.filter((e) => e.pattern === pattern && e.equipment.some((q) => have.includes(q)));
}
