import type { Equipment, Workout } from '../engine/types';
import { generateMobility, generateStrength, generateWalk } from '../engine/sessions';

/**
 * Ready-made non-riding sessions for the Library, built by the same generators
 * the planner uses so what you pick by hand matches what the plan would give.
 * Built for the rider's equipment on request, with stable ids so a calendar
 * entry keeps pointing at the same session.
 */
export function readyMadeSessions(equipment: Equipment[]): Workout[] {
  const eq = equipment.length ? equipment : ['bodyweight' as Equipment];
  const fix = (w: Workout, id: string, prefix?: string): Workout => ({ ...w, id, source: 'library', name: prefix ? w.name.replace(/^Strength /, `${prefix} `) : w.name });
  const LEVEL: Record<string, string> = { foundation: 'Foundation', build: 'Build', maintain: 'Maintain', light: 'Light' };
  const out: Workout[] = [];
  const levels: Array<['foundation' | 'build' | 'maintain' | 'light', string]> = [
    ['foundation', 'Moderate loads, 3 sets: learn the movements, early in a block.'],
    ['build', 'Heavier, 4 sets: the off-season strength builder.'],
    ['maintain', 'Two sets at a working weight: keeps strength while the riding gets hard.'],
    ['light', 'Light and quick: recovery and taper weeks.'],
  ];
  for (const [level, reason] of levels) {
    out.push(fix(generateStrength({ level, minutes: level === 'build' ? 50 : level === 'light' ? 30 : 40, equipment: eq, variant: 'A', weekInBlock: 0, reason }), `lib-str-${level}-a`, LEVEL[level]));
    out.push(fix(generateStrength({ level, minutes: level === 'build' ? 50 : level === 'light' ? 30 : 40, equipment: eq, variant: 'B', weekInBlock: 1, reason }), `lib-str-${level}-b`, LEVEL[level]));
  }
  const focuses: Array<['after-long-ride' | 'after-strength' | 'hips-and-back' | 'upper-body' | 'full', number, string]> = [
    ['after-long-ride', 12, 'Hips, back and hamstrings while they are warm.'],
    ['after-strength', 10, 'The hips and legs just worked.'],
    ['hips-and-back', 15, 'The two areas cycling stiffens most.'],
    ['upper-body', 10, 'Thoracic spine, chest and neck: the antidote to hours on the hoods.'],
    ['full', 20, 'The whole body, for a rest day.'],
  ];
  for (const [focus, minutes, reason] of focuses) out.push(fix(generateMobility({ focus, minutes, reason }), `lib-mob-${focus}`));
  const where = eq.includes('treadmill') ? 'treadmill' : 'outdoor';
  out.push(fix(generateWalk({ minutes: 30, where, reason: 'A short aerobic walk for a day the bike cannot be used.' }), 'lib-walk-30'));
  out.push(fix(generateWalk({ minutes: 45, where, reason: 'Forty-five minutes of zone 2 on foot.' }), 'lib-walk-45'));
  out.push(fix(generateWalk({ minutes: 45, packKg: 9, where, reason: 'Zone 2 with a light pack: more work per minute and some load for the bones.' }), 'lib-walk-45-pack'));
  out.push(fix(generateWalk({ minutes: 60, packKg: 9, where, reason: 'An hour with a pack; a solid aerobic session with no fatigue to carry into tomorrow.' }), 'lib-walk-60-pack'));
  return out;
}
