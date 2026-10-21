import type { Equipment, Exercise, Workout } from '../engine/types';
import { estimateSessionTss, generateMobility, generateRun, generateStrength, generateWalk } from '../engine/sessions';
import { exercisesFor, firstFirst, lightLoad, type Pattern } from './strength';
import { MOBILITY } from './mobility';

/**
 * Ready-made non-riding sessions for the Library. The level-based strength
 * days and the focus-based mobility routines come from the same generators
 * the planner uses, so what you pick by hand matches what a plan would give;
 * the themed sessions below them are hand-designed. Built for the rider's
 * equipment on request, with stable ids.
 */
const NAMED_BY_MINUTES = new Set(['before-long-ride', 'after-trainer', 'feet-ankles', 'sunday-30', 'aero-neck', 'reset-5']);

export function readyMadeSessions(equipment: Equipment[]): Workout[] {
  const eq = equipment.length ? equipment : ['bodyweight' as Equipment];
  const fix = (w: Workout, id: string, prefix?: string): Workout => ({ ...w, id, source: 'library', name: prefix ? w.name.replace(/^Strength /, `${prefix} `) : w.name });
  const LEVEL: Record<string, string> = { foundation: 'Foundation', build: 'Build', maintain: 'Maintain', light: 'Light' };
  const out: Workout[] = [];

  // Strength by level, the planner's own A/B days
  const levels: Array<['foundation' | 'build' | 'maintain' | 'light', string]> = [
    ['foundation', 'Moderate loads, 3 sets: learn the movements, early in a block.'],
    ['build', 'Heavier, 4 sets: the off-season strength builder.'],
    ['maintain', 'Two sets at a working weight: keeps strength while the riding gets hard.'],
    ['light', 'Light and quick: recovery and taper weeks.'],
  ];
  for (const [level, reason] of levels) {
    const minutes = level === 'build' ? 50 : level === 'light' ? 30 : 40;
    out.push(fix(generateStrength({ level, minutes, equipment: eq, variant: 'A', weekInBlock: 0, reason }), `lib-str-${level}-a`, LEVEL[level]));
    out.push(fix(generateStrength({ level, minutes, equipment: eq, variant: 'B', weekInBlock: 1, reason }), `lib-str-${level}-b`, LEVEL[level]));
  }

  // Themed strength sessions
  const themed: Array<{ id: string; name: string; minutes: number; purpose: string; physiology?: string; patterns: Pattern[]; sets: number; reps: string; load: string; only?: Equipment[]; needs?: Equipment; needsAny?: Equipment[]; prefer?: string[]; effort: number }> = [
    { id: 'core-hips', effort: 4, name: 'Core and hips (20 min)', minutes: 20, purpose: 'A short trunk and hip session for any day; no fatigue to carry into tomorrow’s ride.', physiology: 'A stable pelvis and trunk let the legs deliver power without the upper body absorbing it.', patterns: ['trunk', 'hip', 'trunk', 'hip', 'trunk'], sets: 2, reps: '12–15', load: 'Bodyweight or light; quality over load', prefer: ['dead-bug', 'clamshell', 'side-plank', 'side-lying-leg-raise', 'bird-dog'] },
    { id: 'posture', effort: 6, name: 'Upper body and posture (30 min)', minutes: 30, purpose: 'Push and pull for the shoulders, upper back and neck that hours on the hoods round forward.', patterns: ['pull', 'push', 'pull', 'push', 'carry'], sets: 3, reps: '10–12', load: 'Moderate; strict form, full range' },
    { id: 'single-leg', effort: 6, name: 'Single-leg strength (35 min)', minutes: 35, purpose: 'Every exercise on one leg at a time, the way the pedal stroke works; finds and fixes the weaker side.', physiology: 'One-sided strength and hip control; the difference between legs is often what limits a sprint or a standing climb.', patterns: ['single-leg', 'single-leg', 'hinge', 'hip', 'trunk'], sets: 3, reps: '8–10 per side', load: 'Moderate; the weaker side sets the weight' },
    { id: 'glutes-hams', effort: 6, name: 'Glutes and hamstrings (35 min)', minutes: 35, purpose: 'The posterior chain: what pulls the pedal through the bottom of the stroke and keeps the low back out of trouble.', patterns: ['hinge', 'hinge', 'single-leg', 'hip', 'trunk'], sets: 3, reps: '8–10', load: 'Moderate to heavy on the hinges' },
    { id: 'power', effort: 7, name: 'Legs: power (30 min)', minutes: 30, purpose: 'Fewer reps, moved fast: strength that turns into a sprint or a kick over a rise.', physiology: 'Rate of force development falls with age faster than strength itself; moving loads quickly keeps it.', patterns: ['hinge', 'squat', 'single-leg', 'trunk'], sets: 4, reps: '5', load: 'Moderate, moved as fast as control allows; long rests', prefer: ['kb-swing', 'db-swing', 'kb-goblet-squat', 'goblet-squat', 'step-up', 'hollow-hold'] },
    { id: 'anywhere', effort: 5, name: 'Bodyweight anywhere (25 min)', minutes: 25, purpose: 'No equipment: a hotel room or a living-room floor is enough.', patterns: ['squat', 'single-leg', 'hinge', 'push', 'trunk', 'hip'], sets: 3, reps: '12–15', load: 'Bodyweight; slow and controlled', only: ['bodyweight'] },
    { id: 'express', effort: 6, name: 'Full body express (25 min)', minutes: 25, purpose: 'One of everything in under half an hour for a busy day.', patterns: ['squat', 'hinge', 'push', 'pull', 'carry', 'rotate'], sets: 2, reps: '10', load: 'Moderate; keep moving between exercises' },
    { id: 'kettlebell', needs: 'kettlebell', only: ['kettlebell', 'bodyweight'], effort: 6, name: 'Kettlebell full body (30 min)', minutes: 30, purpose: 'One kettlebell, every pattern: swings, squats, presses, rows, a lunge and a carry, finished with a get-up.', physiology: 'Hip power and one-sided trunk strength together; the swing trains the hinge that drives the pedal down.', patterns: ['hinge', 'squat', 'push', 'pull', 'single-leg', 'carry', 'trunk'], sets: 3, reps: '8–10', load: 'Moderate bell; heavier for swings and squats, lighter for presses and the get-up', prefer: ['kb-swing', 'kb-goblet-squat', 'kb-press', 'kb-row', 'kb-rack-lunge', 'kb-suitcase-carry', 'kb-get-up'] },
    // 21 Oct 2026 (Batch 5c): built only from the exercises already in the library; prefer names the exercises so each session is what its title says.
    { id: 'kb-swings-carries', needs: 'kettlebell', effort: 6, name: 'Kettlebell swings and carries (20 min)', minutes: 20, purpose: 'Hip power and one-sided trunk strength in twenty minutes; the bell does the rest.', physiology: 'Swings train the hip snap that drives the pedal down; carries make the trunk hold still while one side works, as it does on every pedal stroke.', patterns: ['hinge', 'carry', 'hinge', 'carry', 'trunk'], sets: 4, reps: '12–15', load: 'Moderate to heavy bell; swings crisp, carries tall', prefer: ['kb-swing', 'kb-suitcase-carry', 'kb-deadlift', 'kb-rack-carry', 'kb-get-up'] },
    { id: 'kb-legs', needs: 'kettlebell', effort: 7, name: 'Kettlebell legs (35 min)', minutes: 35, purpose: 'A full leg session with one bell: squat, hinge, two single-leg moves and calves.', physiology: 'Quads, glutes and hamstrings through the full range, and one leg at a time, the way the pedals ask for it.', patterns: ['squat', 'hinge', 'single-leg', 'hinge', 'hip', 'trunk'], sets: 3, reps: '8–10', load: 'Heavier bell for squats and deadlifts, lighter racked for lunges', prefer: ['kb-goblet-squat', 'kb-deadlift', 'kb-rack-lunge', 'kb-sl-rdl', 'calf-raise', 'hollow-hold'] },
    { id: 'heavy-legs', needsAny: ['dumbbells', 'kettlebell', 'barbell'], effort: 8, name: 'Legs: heavy (45 min)', minutes: 45, purpose: 'Few reps, heavy: the session that builds the most strength, for the off-season.', physiology: 'Maximal strength is what masters riders lose fastest and gain most from on the bike: sprint and standing-climb power, and tendons that tolerate more.', patterns: ['squat', 'hinge', 'single-leg', 'squat', 'hinge', 'trunk'], sets: 4, reps: '5–6', load: 'Heavy: the last rep clean but close to the limit; three minutes between sets', prefer: ['back-squat', 'bb-deadlift', 'split-squat', 'db-front-squat', 'db-rdl', 'plank'] },
    { id: 'hotel-15', only: ['bodyweight'], effort: 5, name: 'Hotel room (15 min)', minutes: 15, purpose: 'A travel day kept: six bodyweight exercises, brisk, on a hotel-room floor.', patterns: ['squat', 'single-leg', 'push', 'hinge', 'trunk', 'hip'], sets: 2, reps: '12–15', load: 'Bodyweight; brisk between exercises', prefer: ['bw-squat', 'reverse-lunge', 'pushup', 'glute-bridge', 'dead-bug', 'clamshell'] },
    { id: 'upper-back', needsAny: ['dumbbells', 'kettlebell', 'band', 'pullup-bar', 'barbell'], effort: 5, name: 'Upper back and shoulders (25 min)', minutes: 25, purpose: 'The posture hours on the hoods take away: shoulder blades back and down, shoulders strong overhead.', patterns: ['pull', 'pull', 'push', 'pull', 'rotate'], sets: 3, reps: '10–12', load: 'Light to moderate; strict form, full range, shoulder blades doing the work', prefer: ['band-face-pull', 'one-arm-row', 'db-overhead', 'band-pull-apart', 'kb-halo|band-woodchop'] },
    { id: 'balance', effort: 5, name: 'Balance and single leg (30 min)', minutes: 30, purpose: 'Everything on one leg, slowly, with control before weight.', physiology: 'The one-sided control the pedal stroke asks for, and the balance and strength that keep a masters rider steady off the bike too.', patterns: ['single-leg', 'hinge', 'single-leg', 'hip', 'hip', 'trunk'], sets: 3, reps: '8 per side', load: 'Light; control over weight, a hand near a wall if needed', prefer: ['step-up', 'single-leg-rdl', 'lateral-lunge', 'side-lying-leg-raise', 'calf-raise', 'bird-dog'] },
    { id: 'hip-power', effort: 7, name: 'Hips: power (25 min)', minutes: 25, purpose: 'The kick over a rise and the jump from the group: hips moved fast.', physiology: 'Rate of force development falls with age faster than strength does; moving moderate loads quickly keeps it.', patterns: ['hinge', 'hinge', 'single-leg', 'hip', 'carry'], sets: 4, reps: '6–8', load: 'Moderate, moved fast; full rest between sets', prefer: ['kb-swing|db-swing', 'hip-thrust', 'step-up', 'monster-walk', 'farmer-carry'] },
    { id: 'aero-trunk', effort: 4, name: 'Trunk for the aero position (20 min)', minutes: 20, purpose: 'A front and side trunk that holds a low position for hours.', physiology: 'Holding the aero position is a long isometric effort for the trunk; when it tires, the lower back and shoulders take over and the position collapses.', patterns: ['trunk', 'trunk', 'rotate', 'trunk', 'hip'], sets: 3, reps: '12', load: 'Bodyweight; holds of 40 seconds, breathing through every one', prefer: ['hollow-hold', 'side-plank', 'pallof|russian-twist', 'bird-dog', 'clamshell'] },
  ];
  for (const t of themed) {
    if (t.needs && !eq.includes(t.needs)) continue;
    if (t.needsAny && !t.needsAny.some((q) => eq.includes(q))) continue;
    const have = t.only ?? eq;
    const used = new Set<string>();
    const exercises: Exercise[] = [];
    // A prefer entry "a|b" names alternatives: whichever the rider has, and only one of them.
    const groups = (t.prefer ?? []).map((g) => g.split('|'));
    const groupOf = (id: string) => groups.findIndex((g) => g.includes(id));
    const usedGroups = new Set<number>();
    for (const p of t.patterns) {
      const rank = (id: string) => { const i = groupOf(id); return i < 0 ? 99 : i; };
      const options = exercisesFor(p, have).filter((e) => !used.has(e.id) && !usedGroups.has(groupOf(e.id))).sort((a, b) => rank(a.id) - rank(b.id));
      const pick = options[0];
      if (!pick) continue;
      used.add(pick.id);
      if (groupOf(pick.id) >= 0) usedGroups.add(groupOf(pick.id));
      const isHold = /plank|dead bug|bird dog|pallof|wall sit|hollow|carry/i.test(pick.name);
      exercises.push({ name: pick.name, sets: t.sets, reps: isHold ? undefined : pick.unilateral && !/per side/.test(pick.reps ?? t.reps) ? `${pick.reps ?? t.reps} per side` : pick.reps ?? t.reps, holdSeconds: isHold ? 40 : undefined, load: pick.loadable ? t.load : lightLoad(pick), cue: pick.cue, why: pick.why, equipment: pick.equipment });
    }
    out.push({ id: `lib-str-${t.id}`, name: t.name, kind: 'strength', family: 'recovery', purpose: t.purpose, physiology: t.physiology, phases: ['any'], bases: ['power', 'hr'], setting: 'any', blocks: [], exercises: firstFirst(exercises), effort: t.effort, estimatedTss: estimateSessionTss({ kind: 'strength', minutes: t.minutes, effort: t.effort }), minutes: t.minutes, source: 'library' });
  }

  // Mobility by focus, the planner's own routines
  const focuses: Array<['after-long-ride' | 'after-strength' | 'hips-and-back' | 'upper-body' | 'full', number, string]> = [
    ['after-long-ride', 12, 'Hips, back and hamstrings while they are warm.'],
    ['after-strength', 10, 'The hips and legs just worked.'],
    ['hips-and-back', 15, 'The two areas cycling stiffens most.'],
    ['upper-body', 10, 'Thoracic spine, chest and neck: the antidote to hours on the hoods.'],
    ['full', 20, 'The whole body, for a rest day.'],
  ];
  for (const [focus, minutes, reason] of focuses) out.push(fix(generateMobility({ focus, minutes, reason }), `lib-mob-${focus}`));

  // Hand-designed mobility routines, by stretch
  const routines: Array<{ id: string; name: string; purpose: string; ids: string[]; hold?: number; holdMax?: number }> = [
    { id: 'morning', name: 'Morning five minutes', purpose: 'Five minutes to loosen what sleep and yesterday’s ride left stiff; before coffee is fine.', ids: ['cat-cow', 'knee-to-chest', 'half-kneel-hip', 'shoulder-rolls'] },
    { id: 'hams-calves', name: 'Hamstrings and calves (10 min)', purpose: 'The back of the legs, for riders who feel the saddle height in the hamstrings or get tight calves.', ids: ['downward-dog', 'hamstring-strap', 'standing-hamstring', 'calf-wall', 'ankle-rocks'] },
    { id: 'desk', name: 'Neck and shoulders, desk day (8 min)', purpose: 'For a day of screens before an evening ride: neck, chest and upper back.', ids: ['shoulder-rolls', 'neck-stretch', 'doorway-pec', 'wall-angel', 'thoracic-rotation'] },
    { id: 'deep-hips', name: 'Deep hips (15 min)', purpose: 'Longer holds for the hips and glutes: the session for a rest day when the hips feel locked.', ids: ['couch-stretch', 'pigeon', 'ninety-ninety', 'frog', 'lying-it-band', 'figure-four'] },
    { id: 'low-back', name: 'Low-back relief (10 min)', purpose: 'Gentle spinal movement and hip-flexor length for a back that aches after long rides.', ids: ['cat-cow', 'child-pose', 'knee-to-chest', 'seated-twist', 'half-kneel-hip'] },
    { id: 'pre-ride', name: 'Before the ride (6 min)', purpose: 'Short, moving holds to open the hips and back before rolling out; nothing long or sleepy.', ids: ['cat-cow', 'ninety-ninety', 'half-kneel-hip', 'ankle-rocks', 'shoulder-rolls'] },
    // 21 Oct 2026 (Batch 5c): stretches already in the library only.
    { id: 'before-long-ride', name: 'Before the long ride (8 min)', purpose: 'Open the hips and back before four hours in the saddle: moving holds, nothing long or sleepy.', ids: ['half-kneel-hip', 'ninety-ninety', 'cat-cow', 'thoracic-rotation', 'ankle-rocks', 'shoulder-rolls'], holdMax: 30 },
    { id: 'after-trainer', name: 'After the trainer (10 min)', purpose: 'An hour indoors is an hour without a single stop or coast: the hips and chest need opening.', ids: ['couch-stretch', 'standing-hamstring', 'child-pose', 'thoracic-extension', 'doorway-pec', 'neck-stretch'] },
    { id: 'feet-ankles', name: 'Feet and ankles (8 min)', purpose: 'The ankle range an efficient pedal stroke needs, and the calves that cramp at mile 60.', ids: ['ankle-rocks', 'calf-wall', 'downward-dog', 'quad-stretch'], hold: 45 },
    { id: 'sunday-30', name: 'Sunday full body (30 min)', purpose: 'The week’s stiffness, taken out slowly on a rest day: every area cycling tightens, a minute and a half each.', ids: ['cat-cow', 'child-pose', 'couch-stretch', 'pigeon', 'frog', 'hamstring-strap', 'quad-stretch', 'calf-wall', 'thoracic-extension', 'lat-stretch', 'doorway-pec', 'neck-stretch', 'seated-twist'], hold: 90 },
    { id: 'aero-neck', name: 'Neck and shoulders after the aero bars (8 min)', purpose: 'The neck that holds the head up in a low position, and the upper back that rounds to get there.', ids: ['shoulder-rolls', 'neck-stretch', 'wall-angel', 'thoracic-rotation', 'doorway-pec', 'lat-stretch'] },
    { id: 'reset-5', name: 'Five-minute reset (5 min)', purpose: 'Between meetings: no mat, no change of clothes.', ids: ['shoulder-rolls', 'cat-cow', 'half-kneel-hip', 'standing-hamstring'], holdMax: 30 },
  ];
  for (const r of routines) {
    const exercises: Exercise[] = r.ids.map((id) => MOBILITY.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => ({ name: m.name, holdSeconds: r.hold ?? (r.id === 'pre-ride' ? Math.min(m.holdSeconds ?? 30, 30) : r.holdMax ? Math.min(m.holdSeconds ?? 30, r.holdMax) : m.holdSeconds), reps: m.perSide ? 'each side' : undefined, cue: m.cue, why: m.why, equipment: m.equipment }));
    const minutes = Math.max(5, Math.round(exercises.reduce((s, e) => s + ((e.holdSeconds ?? 30) * (e.reps ? 2 : 1) + 15), 0) / 60));
    // Routines added on 21 Oct 2026 name their real length (their holds decide it), as runs do.
    const name = NAMED_BY_MINUTES.has(r.id) ? r.name.replace(/\(\d+ min\)$/, `(${minutes} min)`) : r.name;
    out.push({ id: `lib-mob-${r.id}`, name, kind: 'mobility', family: 'recovery', purpose: r.purpose, phases: ['any'], bases: ['power', 'hr'], setting: 'any', blocks: [], exercises, estimatedTss: Math.max(1, Math.round(minutes / 60 * 8)), minutes, source: 'library' });
  }

  // Walks
  const where = eq.includes('treadmill') ? 'treadmill' : 'outdoor';
  const walk = (id: string, w: Workout, patch: Partial<Workout> = {}) => { const m = { ...fix(w, id), ...patch }; out.push({ ...m, estimatedTss: estimateSessionTss(m) }); };
  walk('lib-walk-20-easy', generateWalk({ minutes: 20, where, reason: 'A recovery walk: easy, unhurried, blood through the legs the day after a hard ride.' }), { name: 'Recovery walk 20 min', walk: { minutes: 20, hrLow: 0.5, hrHigh: 0.6 } });
  walk('lib-walk-30', generateWalk({ minutes: 30, where, reason: 'A short aerobic walk for a day the bike cannot be used.' }));
  walk('lib-walk-45', generateWalk({ minutes: 45, where, reason: 'Forty-five minutes of zone 2 on foot.' }));
  walk('lib-walk-45-pack', generateWalk({ minutes: 45, packKg: 9, where, reason: 'Zone 2 with a light pack: more work per minute and some load for the bones.' }));
  walk('lib-walk-60-pack', generateWalk({ minutes: 60, packKg: 9, where, reason: 'An hour with a pack; a solid aerobic session with no fatigue to carry into tomorrow.' }));
  walk('lib-walk-60-heavy', generateWalk({ minutes: 60, packKg: 13.6, where, reason: 'An hour under a 30 lb pack: the legs and back work like a long seated climb, with the bone loading riding never gives.' }), { name: 'Weighted walk 1:00, heavy pack' });
  walk('lib-walk-90', generateWalk({ minutes: 90, where, reason: 'A long walk in zone 2: ninety minutes of aerobic work that costs the legs very little.' }), { name: 'Long walk 1:30' });
  if (where === 'treadmill') walk('lib-walk-incline', generateWalk({ minutes: 40, where, reason: 'Set the treadmill to a steady 8–12% grade and walk briskly without holding on: glutes and calves work like a climb and heart rate reaches zone 2 with no pack.' }), { name: 'Incline walk 40 min', walk: { minutes: 40, hrLow: 0.6, hrHigh: 0.72 } });
  walk('lib-walk-brisk', generateWalk({ minutes: 30, where, reason: 'Thirty minutes at the top of zone 2 into low zone 3: a brisk walk with purpose, arms swinging, for a day with no time for more.' }), { name: 'Brisk walk 30 min', walk: { minutes: 30, hrLow: 0.68, hrHigh: 0.78 } });
  // 21 Oct 2026 (Batch 5c)
  walk('lib-walk-20-recovery', generateWalk({ minutes: 20, where, reason: 'The day after the long ride: a stroll with the legs moving and nothing asked of them.' }), { name: 'Recovery stroll 20 min', walk: { minutes: 20, hrLow: 0, hrHigh: 0.65 } });
  walk('lib-walk-hills', generateWalk({ minutes: 45, where: 'outdoor', reason: 'Find the hills: forty-five minutes with real climbs, the heart rate allowed into low zone 3 on the way up.' }), { name: 'Hill walk 45 min', walk: { minutes: 45, hrLow: 0.65, hrHigh: 0.78 } });
  walk('lib-walk-ruck-60', generateWalk({ minutes: 60, packKg: 9, where, reason: 'An hour under a 20 lb pack: posture, trunk and legs working together like a long seated climb, without the impact of a run.' }), { name: 'Ruck 60 min, 20 lb pack' });
  if (where === 'treadmill') walk('lib-walk-incline-30', generateWalk({ minutes: 30, where, reason: 'Half an hour on a steady 8–12% grade: the quads and glutes at a climbing angle, heart rate held in zone 2. Walk without holding on.' }), { name: 'Incline treadmill 30 min' });
  walk('lib-walk-45-brisk', generateWalk({ minutes: 45, where, reason: 'Forty-five minutes at the top of zone 2: the pace of someone late for something.' }), { name: 'Brisk walk 45 min', walk: { minutes: 45, hrLow: 0.65, hrHigh: 0.75 } });

  // Runs: always built (so a run on the calendar is always found); the Library and the picker
  // show them only when the rider's week has runs on.
  const runWhere = eq.includes('treadmill') && !eq.includes('outdoor-walk') ? 'treadmill' : 'outdoor';
  const run = (id: string, w: Workout) => out.push(fix(w, id));
  run('lib-run-easy-30', generateRun({ kind: 'easy', minutes: 30, where: runWhere, reason: 'Thirty easy minutes on foot: aerobic work with the impact cycling lacks, at a heart rate low enough to run again in two days.' }));
  run('lib-run-easy-45', generateRun({ kind: 'easy', minutes: 45, where: runWhere, reason: 'Forty-five easy minutes: the same aerobic work as an hour of zone 2 riding, with the running muscles and tendons doing it.' }));
  run('lib-run-long-60', generateRun({ kind: 'long', minutes: 60, where: runWhere, reason: 'An hour at an easy heart rate, two or more days clear of the long ride: time on feet without adding much fatigue.' }));
  run('lib-run-strides-35', generateRun({ kind: 'strides', minutes: 35, where: runWhere, reason: 'An easy run with six short strides near the end: quick, relaxed turnover that keeps running form sharp.' }));
  run('lib-run-tempo-44', generateRun({ kind: 'tempo', minutes: 44, where: runWhere, reason: 'Three eight-minute blocks at a comfortably hard heart rate: one a week at most, never the day before a hard ride.' }));
  run('lib-run-hills-35', generateRun({ kind: 'hills', minutes: 35, where: runWhere, reason: 'Six one-minute climbs at a hard effort, walking down between them: leg power for standing climbs, with the impact kept low.' }));
  // 21 Oct 2026 (Batch 5c): the planner places none of these.
  run('lib-run-easy-60', generateRun({ kind: 'easy', minutes: 60, where: runWhere, reason: 'An hour at an easy heart rate: the most aerobic work a run can give without asking much of the legs the next day.' }));
  run('lib-run-fartlek-35', generateRun({ kind: 'fartlek', minutes: 35, where: runWhere, reason: 'Speed play by feel: eight one-minute pickups with two easy minutes after each; the watch holds the band, you pick the stretches of trail.' }));
  run('lib-run-progression-40', generateRun({ kind: 'progression', minutes: 40, where: runWhere, reason: 'A run that finishes faster than it starts, the way a race does: easy, steady, then ten strong minutes.' }));
  run('lib-run-walk-30', generateRun({ kind: 'run-walk', minutes: 30, where: runWhere, reason: 'For a cyclist starting to run: ten two-minute runs with a minute of walking after each; the tendons and feet get the impact in doses.' }));
  return out;
}
