import type { Exercise } from '../engine/types';

/**
 * Mobility and flexibility for what cycling shortens and stiffens. Routines are
 * built from these by target; every entry says how long to hold and why.
 */
export type Target = 'hips' | 'hamstrings' | 'thoracic' | 'glutes' | 'quads' | 'calves' | 'neck-shoulders' | 'low-back';

export interface MobilityDef extends Exercise {
  id: string;
  target: Target;
  perSide?: boolean;
}

const M = (id: string, target: Target, name: string, holdSeconds: number, cue: string, why: string, perSide = false): MobilityDef =>
  ({ id, target, name, holdSeconds, cue, why, equipment: ['bodyweight'], perSide });

export const MOBILITY: MobilityDef[] = [
  M('couch-stretch', 'hips', 'Couch stretch', 60, 'Kneel with one shin up against a wall or couch, the other foot forward; squeeze the glute of the back leg and lift the chest.', 'Hip flexors shorten with every hour in the saddle; this opens them so the hips can extend at the bottom of the stroke.', true),
  M('half-kneel-hip', 'hips', 'Half-kneeling hip flexor stretch', 45, 'One knee down, tuck the pelvis under, shift forward gently until the front of the hip stretches; reach the same-side arm overhead.', 'A gentler hip-flexor opener for after a long ride.', true),
  M('pigeon', 'glutes', 'Pigeon', 60, 'Front shin across the mat, back leg long, square the hips, fold forward over the front leg.', 'Deep glute and hip rotator release; eases the pelvis back to level after hours of pedalling.', true),
  M('figure-four', 'glutes', 'Figure-four', 45, 'On your back, ankle over the opposite knee, pull the lower thigh toward the chest.', 'Glutes and piriformis; a milder pigeon.', true),
  M('hamstring-strap', 'hamstrings', 'Hamstring stretch with strap', 45, 'On your back, a strap or towel around the foot, leg straight up to a stretch without the pelvis lifting.', 'Hamstring length lets the saddle go to a proper height without the low back rounding.', true),
  M('standing-hamstring', 'hamstrings', 'Standing hamstring stretch', 40, 'Heel on a low step, hinge from the hips with a flat back until the back of the thigh stretches.', 'Hamstring length, standing version.', true),
  M('thoracic-rotation', 'thoracic', 'Open book', 45, 'On your side, knees bent, arms stacked in front; open the top arm across to the other side, following it with the eyes, back and forth slowly.', 'Mid-back rotation that the fixed riding posture takes away; helps looking over a shoulder in traffic.', true),
  M('thoracic-extension', 'thoracic', 'Thoracic extension over a roller or towel', 60, 'A foam roller or rolled towel across the mid-back, hands behind the head, extend gently over it; move it up a few inches and repeat.', 'Reverses the rounded upper back; makes an aero position easier to hold.'),
  M('cat-cow', 'low-back', 'Cat-cow', 60, 'On hands and knees, arch and round the spine slowly with the breath.', 'Mobilises the whole spine; the first thing to do after a long ride.'),
  M('child-pose', 'low-back', 'Child’s pose', 60, 'Knees wide, sit back toward the heels, arms long, let the back lengthen.', 'Low-back decompression.'),
  M('quad-stretch', 'quads', 'Standing quad stretch', 40, 'Hold the ankle behind you, knees together, tuck the pelvis; no arching the back.', 'Quads and the front of the hip together.', true),
  M('calf-wall', 'calves', 'Calf stretch at a wall', 40, 'Hands on the wall, back leg straight with the heel down, lean in; then repeat with the back knee bent.', 'Calves and ankles; stiff ankles change the pedal stroke.', true),
  M('neck-stretch', 'neck-shoulders', 'Neck side stretch', 30, 'Sit tall, tip one ear toward the shoulder, the opposite hand reaching down; breathe.', 'The neck holds the head up for hours on the bike; this eases it.', true),
  M('doorway-pec', 'neck-shoulders', 'Doorway chest stretch', 45, 'Forearms on a door frame at shoulder height, step through until the chest opens.', 'Chest and front of shoulder, rounded forward by the bars.'),
  M('wall-angel', 'thoracic', 'Wall angel', 45, 'Back and arms against a wall, slide the arms up and down keeping wrists and elbows in contact.', 'Upper-back posture and shoulder mobility.'),
  M('ninety-ninety', 'hips', '90/90 hip switch', 60, 'Sit with one leg bent in front, the other to the side, both knees at right angles; rotate the knees side to side, sitting tall.', 'Hip rotation in both directions; the full range cycling never uses.'),
  M('frog', 'hips', 'Frog stretch', 60, 'On hands and knees, knees wide, feet turned out, sit the hips back toward the heels and breathe.', 'Adductors and inner hip; opens the groin that a narrow stance tightens.'),
  M('lying-it-band', 'glutes', 'Lying glute and outer-hip stretch', 45, 'On your back, cross one leg over the other and let both knees fall to the side; keep the shoulders down.', 'Outer hip and the tissue along the thigh that knee pain often starts from.', true),
  M('knee-to-chest', 'low-back', 'Knee to chest', 40, 'On your back, hug one knee to the chest, the other leg long on the floor.', 'Low-back release and a gentle hip-flexor stretch on the long leg.', true),
  M('seated-twist', 'low-back', 'Seated spinal twist', 40, 'Sit tall, one knee bent and crossed over, turn the chest toward that knee with the opposite elbow outside it.', 'Spinal rotation and the outer hip together.', true),
  M('downward-dog', 'hamstrings', 'Downward dog with pedalling heels', 60, 'Hands and feet on the floor, hips high; bend one knee and press the other heel down, alternating slowly.', 'Hamstrings, calves and shoulders in one move.'),
  M('lat-stretch', 'thoracic', 'Kneeling lat stretch', 45, 'Kneel with the forearms on a bench or chair, sit the hips back and let the chest sink toward the floor.', 'Lats and the upper back; makes reaching the drops easier.'),
  M('ankle-rocks', 'calves', 'Ankle rocks', 45, 'Half-kneeling, the front foot flat, rock the knee forward over the toes without the heel lifting.', 'Ankle range for a smooth pedal stroke; the first joint that stiffens with age.', true),
  M('shoulder-rolls', 'neck-shoulders', 'Shoulder rolls and chin tucks', 30, 'Roll the shoulders slowly back ten times, then draw the chin straight back ten times as if making a double chin.', 'Resets the neck and shoulders after hours looking up the road.'),
];

export function mobilityFor(targets: Target[]): MobilityDef[] {
  return MOBILITY.filter((m) => targets.includes(m.target));
}
