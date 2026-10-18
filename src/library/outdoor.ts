import type { Family, Phase, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';

/**
 * Outdoor workouts, shaped for a long uninterrupted road or path:
 * a 25-minute warm-up with two one-minute pickups, the intervals, and the rest
 * of the ride in zone 2, so the quality work happens on fresh legs and the ride
 * still delivers its endurance hours. Durations are the whole ride.
 */
const m = (minutes: number) => Math.round(minutes * 60);
const step = (minutes: number, intensity: number, extra: Partial<WorkoutStep> = {}): WorkoutStep =>
  ({ kind: 'step', seconds: m(minutes), intensity, ...extra });

function warmUp(): WorkoutBlock[] {
  return [
    step(15, 0.55, { intensityHigh: 0.7, label: 'Warm up, build gently' }),
    step(1, 0.95, { label: 'Pickup' }),
    step(3, 0.6, { label: 'Easy' }),
    step(1, 0.95, { label: 'Pickup' }),
    step(5, 0.6, { label: 'Easy' }),
  ];
}

interface Set { reps: number; work: number; lo: number; hi: number; rest: number; label: string }

function trail(opts: {
  id: string; name: string; family: Family; phases: Phase[]; bases: Array<'power' | 'hr'>;
  total: number; set?: Set; purpose: string; physiology?: string;
}): Workout {
  const blocks: WorkoutBlock[] = [...warmUp()];
  let used = 25;
  if (opts.set) {
    const s = opts.set;
    const body: WorkoutStep[] = [step(s.work, s.lo, { intensityHigh: s.hi }), step(s.rest, 0.55, { label: 'Easy between' })];
    blocks.push({ kind: 'repeat', times: s.reps, label: s.label, steps: body });
    used += s.reps * (s.work + s.rest);
  }
  const fill = opts.total - used - 5;
  if (fill > 0) blocks.push(step(fill, 0.6, { intensityHigh: 0.72, label: 'Zone 2 for the rest' }));
  blocks.push(step(5, 0.5, { label: 'Cool down' }));
  return { ...opts, blocks, source: 'library', setting: 'outdoor' };
}

const ss = (reps: number, work: number, rest = 5): Set => ({ reps, work, lo: 0.88, hi: 0.93, rest, label: 'Sweet spot' });
const thr = (reps: number, work: number, rest = 4): Set => ({ reps, work, lo: 0.95, hi: 1.0, rest, label: 'Threshold' });
const vo2 = (reps: number, work: number, rest = 4): Set => ({ reps, work, lo: 1.1, hi: 1.18, rest, label: 'VO2max' });
const tempo = (reps: number, work: number, rest = 5): Set => ({ reps, work, lo: 0.8, hi: 0.86, rest, label: 'Tempo' });

const PH_BASE: Phase[] = ['base', 'build'];
const BOTH: Array<'power' | 'hr'> = ['power', 'hr'];

export const OUTDOOR: Workout[] = [
  // Sweet spot progression
  trail({ id: 'trail-ss-3x10', name: 'Sweet Spot 3 x 10', family: 'sweetspot', phases: PH_BASE, bases: BOTH, total: 90, set: ss(3, 10),
    purpose: 'The first quality ride of a base block. Three ten-minute efforts just under threshold with five minutes easy between, then zone 2 home. Pace the first one as if there were six.',
    physiology: 'Sub-threshold muscular endurance; the start of FTP work.' }),
  trail({ id: 'trail-ss-3x12', name: 'Sweet Spot 3 x 12', family: 'sweetspot', phases: PH_BASE, bases: BOTH, total: 105, set: ss(3, 12),
    purpose: 'Two minutes longer per effort than last week, which is all progression needs to be. On the trail, start each effort right after a road crossing so the middle is uninterrupted.',
    physiology: 'Sub-threshold muscular endurance, progressive overload.' }),
  trail({ id: 'trail-ss-3x15', name: 'Sweet Spot 3 x 15', family: 'sweetspot', phases: PH_BASE, bases: BOTH, total: 120, set: ss(3, 15),
    purpose: 'Forty-five minutes of sweet spot inside a two-hour ride. The last effort will feel like the real work; that is the point of the week.',
    physiology: 'Sustained sub-threshold power; glycogen depletion resistance.' }),
  trail({ id: 'trail-ss-2x20', name: 'Sweet Spot 2 x 20', family: 'sweetspot', phases: PH_BASE, bases: BOTH, total: 120, set: ss(2, 20, 6),
    purpose: 'Two long blocks that mimic a sustained climb or a hard section of a group ride. Twenty minutes is long enough to demand pacing, which is a skill in itself.',
    physiology: 'Sustained sub-threshold power; pacing.' }),
  trail({ id: 'trail-ss-4x10', name: 'Sweet Spot 4 x 10', family: 'sweetspot', phases: PH_BASE, bases: BOTH, total: 120, set: ss(4, 10),
    purpose: 'Same total work as 2 x 20, broken into four. Easier on the head, slightly harder on the legs because the recoveries are short.',
    physiology: 'Sub-threshold repeatability.' }),
  trail({ id: 'trail-ss-3x20', name: 'Sweet Spot 3 x 20', family: 'sweetspot', phases: ['build'], bases: BOTH, total: 150, set: ss(3, 20, 6),
    purpose: 'An hour of sweet spot. The biggest sweet-spot day in the library and a real test of fuelling; eat from the first interval.',
    physiology: 'Deep muscular endurance; fuelling under load.' }),

  // Threshold progression
  trail({ id: 'trail-thr-3x8', name: 'Threshold 3 x 8', family: 'threshold', phases: ['build'], bases: BOTH, total: 90, set: thr(3, 8),
    purpose: 'The move from sweet spot to threshold. Three eight-minute efforts right at FTP with four minutes easy. Hard and steady, not hard and fading.',
    physiology: 'Lactate threshold; raises FTP directly.' }),
  trail({ id: 'trail-thr-4x8', name: 'Threshold 4 x 8', family: 'threshold', phases: ['build'], bases: BOTH, total: 105, set: thr(4, 8),
    purpose: 'One more effort than last week. If the fourth is noticeably slower than the first, the pacing was off, not the fitness.',
    physiology: 'Lactate threshold; repeatability at FTP.' }),
  trail({ id: 'trail-thr-3x10', name: 'Threshold 3 x 10', family: 'threshold', phases: ['build'], bases: BOTH, total: 105, set: thr(3, 10, 5),
    purpose: 'Longer threshold efforts with a little more recovery. Thirty minutes at FTP in a session is a serious day for a masters rider; the next day should be easy.',
    physiology: 'Lactate threshold; time-trial tolerance.' }),
  trail({ id: 'trail-thr-2x15', name: 'Threshold 2 x 15', family: 'threshold', phases: ['build', 'peak'], bases: BOTH, total: 105, set: thr(2, 15, 8),
    purpose: 'Two long threshold efforts. Closer to a time trial than an interval session; ride the first one conservatively.',
    physiology: 'Sustained threshold; mental tolerance.' }),

  // VO2max progression
  trail({ id: 'trail-vo2-4x4', name: 'VO2max 4 x 4', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'], total: 90, set: vo2(4, 4),
    purpose: 'Four four-minute efforts well above threshold, equal rest. Hard breathing by the second minute is the sign you are in the right place. Needs a long flat stretch with no crossings.',
    physiology: 'Maximal oxygen uptake; raises the ceiling FTP sits under.' }),
  trail({ id: 'trail-vo2-5x4', name: 'VO2max 5 x 4', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'], total: 105, set: vo2(5, 4),
    purpose: 'Five efforts. The sharpening session at the end of a winter block, done fresh; skip it if readiness is low and ride zone 2 instead.',
    physiology: 'Maximal oxygen uptake.' }),
  trail({ id: 'trail-vo2-6x3', name: 'VO2max 6 x 3', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'], total: 90, set: vo2(6, 3, 3),
    purpose: 'Shorter and sharper: six three-minute efforts. The same minutes at VO2max as 4 x 4 but easier to hit the target power on each one.',
    physiology: 'Maximal oxygen uptake with higher power per effort.' }),

  // Tempo
  trail({ id: 'trail-tempo-2x20', name: 'Tempo 2 x 20', family: 'tempo', phases: PH_BASE, bases: BOTH, total: 105, set: tempo(2, 20),
    purpose: 'Brisk but sustainable. The intensity of a strong group ride; good for the week after a recovery week when the legs want to go but should not go hard.',
    physiology: 'Muscular endurance; aerobic capacity at moderate strain.' }),
  trail({ id: 'trail-tempo-40', name: 'Tempo 40', family: 'tempo', phases: PH_BASE, bases: BOTH, total: 105, set: tempo(1, 40, 0),
    purpose: 'One forty-minute block of tempo. Century pace plus a little; teaches the body to hold a steady effort without surging.',
    physiology: 'Sustained aerobic power; even pacing.' }),

  // Long and easy rides
  trail({ id: 'trail-long-90', name: 'Easy 90', family: 'endurance', phases: ['any'], bases: BOTH, total: 90,
    purpose: 'Ninety minutes of zone 2 with no intervals. The recovery-week quality ride: the body absorbs the block while the legs stay used to the bike.',
    physiology: 'Aerobic maintenance with minimal stress.' }),
  trail({ id: 'trail-long-120', name: 'Long 2:00', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 120,
    purpose: 'The Sunday long ride at its shortest. Steady zone 2, fuel from the first half hour, keep the cadence relaxed.',
    physiology: 'Aerobic base; fat oxidation.' }),
  trail({ id: 'trail-long-135', name: 'Long 2:15', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 135,
    purpose: 'Fifteen minutes on from last week. Long rides grow by small steps so the day after is still a normal day.',
    physiology: 'Aerobic base; fat oxidation.' }),
  trail({ id: 'trail-long-150', name: 'Long 2:30', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 150,
    purpose: 'Two and a half hours. From here on the second half of the ride is where the adaptation happens; stay in zone 2 even when it feels too easy early.',
    physiology: 'Aerobic durability; the decoupling test ride.' }),
  trail({ id: 'trail-long-165', name: 'Long 2:45', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 165,
    purpose: 'Approaching three hours. Watch heart rate against power in the last forty minutes; a drift under five percent is a sign the base is built.',
    physiology: 'Aerobic durability.' }),
  trail({ id: 'trail-long-180', name: 'Long 3:00', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 180,
    purpose: 'Three hours. Half a century in time; everything you learn about fuelling and position here pays on event day.',
    physiology: 'Aerobic durability; fuelling practice.' }),
  trail({ id: 'trail-long-195', name: 'Long 3:15', family: 'endurance', phases: PH_BASE, bases: BOTH, total: 195,
    purpose: 'The longest ride of a winter block. Plan the turnaround so the last hour is with the wind if there is one.',
    physiology: 'Aerobic durability.' }),
  trail({ id: 'trail-long-240', name: 'Long 4:00', family: 'endurance', phases: ['build', 'peak'], bases: BOTH, total: 240,
    purpose: 'A century-prep ride. Four hours of zone 2 with real fuelling: seventy grams of carbohydrate an hour after the first forty-five minutes.',
    physiology: 'Event-specific durability.' }),

  // Test
  trail({ id: 'trail-20min-test', name: '20-Minute FTP Retest', family: 'test', phases: ['any'], bases: BOTH, total: 75,
    set: { reps: 1, work: 20, lo: 1.0, hi: 1.05, rest: 0, label: 'Test: 20 minutes all-out, steady' },
    purpose: 'After the full warm-up, twenty minutes as hard as you can hold evenly on the longest uninterrupted stretch. New FTP is ninety-five percent of the average power. Pick a still day.',
    physiology: 'FTP estimate.' }),
];
