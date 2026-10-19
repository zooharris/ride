import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { OUTDOOR } from './outdoor';
import { INDOOR } from './indoor';
import { RIDE_NAMES } from './names';

// Small helpers so the library reads like a training plan, not JSON.
const m = (minutes: number) => Math.round(minutes * 60);
const step = (minutes: number, intensity: number, extra: Partial<WorkoutStep> = {}): WorkoutStep =>
  ({ kind: 'step', seconds: m(minutes), intensity, ...extra });
const warm = (minutes = 10) => step(minutes, 0.5, { intensityHigh: 0.65, label: 'Warm up' });
const cool = (minutes = 10) => step(minutes, 0.5, { label: 'Cool down' });
const rep = (times: number, label: string, ...steps: WorkoutStep[]): WorkoutBlock => ({ kind: 'repeat', times, label, steps });

const lib = (w: Omit<Workout, 'source' | 'setting' | 'kind'>): Workout => ({ ...w, source: 'library', setting: 'any', kind: 'ride' });

/**
 * The phase-1 starter library: 20 workouts across every family, each with a
 * short, standard or long feel so the calendar has something for most days.
 * Intensities are fractions of FTP; the engine renders them as HR when asked.
 */
const CORE: Workout[] = [
  // Recovery
  lib({ id: 'lib-spin-30', name: 'Easy Spin', family: 'recovery', phases: ['any'], bases: ['power', 'hr'],
    purpose: 'Thirty minutes of light pedalling to move blood through tired legs the day after strength work or intervals. Keep the cadence high and the ego at home.',
    physiology: 'Circulation and neuromuscular refresh with almost no training stress.',
    blocks: [step(30, 0.45, { intensityHigh: 0.55, cadence: 95 })] }),
  lib({ id: 'lib-opener', name: 'Openers', family: 'recovery', phases: ['peak', 'taper'], bases: ['power'],
    purpose: 'The day before an event: a short ride with a few brisk efforts to wake the legs up without adding fatigue. You should finish feeling better than you started.',
    physiology: 'Neural activation; keeps the engine primed during a taper.',
    blocks: [warm(10), rep(3, 'Openers', step(1, 1.0), step(3, 0.5)), step(1, 1.2, { label: 'Sprint prime' }), cool(10)] }),

  // Endurance
  lib({ id: 'lib-z2-60', name: 'Foundation 60', family: 'endurance', phases: ['base', 'build', 'any'], bases: ['power', 'hr'],
    purpose: 'An hour of steady zone 2. The bread and butter of aerobic fitness, and the ride most riders over fifty should be doing more of. Conversational the whole way.',
    physiology: 'Mitochondrial density, fat oxidation, capillary growth.',
    blocks: [warm(10), step(45, 0.62, { intensityHigh: 0.72, label: 'Steady' }), cool(5)] }),
  lib({ id: 'lib-z2-90', name: 'Foundation 90', family: 'endurance', phases: ['base', 'build', 'any'], bases: ['power', 'hr'],
    purpose: 'Ninety minutes of zone 2 with three short cadence changes to keep the legs honest. Fuel from the first half hour.',
    physiology: 'Aerobic base; practises fuelling for longer rides.',
    blocks: [warm(10), step(35, 0.62, { intensityHigh: 0.72 }), step(5, 0.68, { cadence: 100, label: 'High cadence' }), step(30, 0.62, { intensityHigh: 0.72 }), step(5, 0.68, { cadence: 100, label: 'High cadence' }), cool(5)] }),
  lib({ id: 'lib-long-150', name: 'Long Steady', family: 'endurance', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Two and a half hours in the aerobic zone. The weekly long ride that builds the engine for a century. Watch heart rate against power in the last hour: if it drifts up more than five percent, aerobic base is the next thing to build.',
    physiology: 'Aerobic durability and glycogen sparing; the decoupling test ride.',
    blocks: [warm(15), step(130, 0.6, { intensityHigh: 0.72 }), cool(5)] }),

  // Tempo
  lib({ id: 'lib-tempo-2x20', name: 'Tempo 2 x 20', family: 'tempo', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Two twenty-minute blocks of comfortably hard riding. The feeling of a brisk group ride: hard to talk in full sentences, easy to keep going.',
    physiology: 'Muscular endurance and lactate clearance at a sustainable intensity.',
    blocks: [warm(12), rep(2, 'Tempo', step(20, 0.8, { intensityHigh: 0.86 }), step(5, 0.5)), cool(8)] }),
  lib({ id: 'lib-force-3x8', name: 'Low Cadence Force', family: 'tempo', phases: ['base'], bases: ['power'],
    purpose: 'Three eight-minute tempo efforts at sixty rpm, seated. Strength work on the bike, and the closest thing to lifting you can do in the saddle.',
    physiology: 'Muscular force production and pedalling economy.',
    blocks: [warm(12), rep(3, 'Force', step(8, 0.82, { cadence: 60 }), step(4, 0.5, { cadence: 95 })), cool(8)] }),

  // Sweet spot
  lib({ id: 'lib-ss-3x10', name: 'Sweet Spot 3 x 10', family: 'sweetspot', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'The entry point to sweet spot: three ten-minute efforts just below threshold. The most training effect per minute you can get without needing a day to recover.',
    physiology: 'FTP development with manageable fatigue.',
    blocks: [warm(12), rep(3, 'Sweet spot', step(10, 0.88, { intensityHigh: 0.93 }), step(5, 0.5)), cool(8)] }),
  lib({ id: 'lib-ss-3x15', name: 'Sweet Spot 3 x 15', family: 'sweetspot', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'The standard sweet spot session. Forty-five minutes of work, each block long enough that the last five minutes ask something of you.',
    physiology: 'FTP development; muscular endurance at high aerobic load.',
    blocks: [warm(12), rep(3, 'Sweet spot', step(15, 0.88, { intensityHigh: 0.93 }), step(5, 0.5)), cool(8)] }),
  lib({ id: 'lib-ss-2x20', name: 'Sweet Spot 2 x 20', family: 'sweetspot', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Two twenty-minute blocks. Long enough to mimic a sustained climb, short enough to recover from by the next morning.',
    physiology: 'Sustained sub-threshold power; pacing discipline.',
    blocks: [warm(12), rep(2, 'Sweet spot', step(20, 0.88, { intensityHigh: 0.93 }), step(6, 0.5)), cool(8)] }),
  lib({ id: 'lib-ss-long', name: 'Sweet Spot Progression', family: 'sweetspot', phases: ['build'], bases: ['power', 'hr'],
    purpose: 'Four blocks that climb through sweet spot, with the last one touching threshold. A ninety-minute session for a build week when the legs are ready.',
    physiology: 'Progressive overload within one ride.',
    blocks: [warm(12), step(12, 0.86), step(4, 0.5), step(12, 0.89), step(4, 0.5), step(12, 0.92), step(4, 0.5), step(10, 0.96), cool(10)] }),

  // Threshold
  lib({ id: 'lib-thr-2x20', name: 'Threshold 2 x 20', family: 'threshold', phases: ['build', 'peak'], bases: ['power', 'hr'],
    purpose: 'The classic. Two twenty-minute efforts at FTP. If you can finish both with the same power, your FTP is probably higher than you think.',
    physiology: 'Lactate threshold; time-trial pacing.',
    blocks: [warm(15), rep(2, 'Threshold', step(20, 0.97, { intensityHigh: 1.02 }), step(8, 0.5)), cool(10)] }),
  lib({ id: 'lib-over-under', name: 'Over-Unders 3 x 9', family: 'threshold', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'Three nine-minute blocks alternating two minutes just over threshold with one minute just under. Teaches the body to clear lactate while still working, which is what a surging climb feels like.',
    physiology: 'Lactate shuttling and tolerance.',
    blocks: [warm(15), rep(3, 'Over-under', step(2, 1.05), step(1, 0.92), step(2, 1.05), step(1, 0.92), step(2, 1.05), step(1, 0.92), step(6, 0.5)), cool(10)] }),

  // VO2max
  lib({ id: 'lib-vo2-5x3', name: 'VO2max 5 x 3', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'Five three-minute efforts well above threshold, with equal recovery. Hard. One of these a week is plenty in a base block, two at most in build.',
    physiology: 'Maximal oxygen uptake; cardiac stroke volume.',
    blocks: [warm(15), rep(5, 'VO2max', step(3, 1.12, { intensityHigh: 1.18 }), step(3, 0.5)), cool(10)] }),
  lib({ id: 'lib-vo2-30-30', name: '30/30s', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'Two sets of ten repetitions of thirty seconds hard, thirty seconds easy. The short intervals keep you at a high oxygen cost for longer than you could hold it continuously. Power only: heart rate cannot keep up.',
    physiology: 'VO2max with lower perceived strain per minute.',
    blocks: [warm(15), rep(10, 'Set 1', step(0.5, 1.2), step(0.5, 0.5)), step(5, 0.5, { label: 'Between sets' }), rep(10, 'Set 2', step(0.5, 1.2), step(0.5, 0.5)), cool(10)] }),

  // Anaerobic and sprint
  lib({ id: 'lib-sprints', name: 'Neuromuscular Sprints', family: 'anaerobic', phases: ['build', 'peak', 'any'], bases: ['power'],
    purpose: 'Eight fifteen-second all-out sprints with long, lazy recoveries. Masters riders lose top-end power first, and this is the cheapest way to keep it. Fresh legs, full gas, long rests.',
    physiology: 'Neuromuscular power and recruitment of fast-twitch fibres.',
    blocks: [warm(15), rep(8, 'Sprints', step(0.25, 1.8), step(4.75, 0.5)), cool(10)] }),
  lib({ id: 'lib-anaerobic-6x1', name: 'Anaerobic 6 x 1', family: 'anaerobic', phases: ['peak'], bases: ['power'],
    purpose: 'Six one-minute efforts far above threshold, with five minutes between. The capacity to attack, bridge, or survive a steep pitch on a group ride.',
    physiology: 'Anaerobic capacity and buffering.',
    blocks: [warm(15), rep(6, 'Anaerobic', step(1, 1.35), step(5, 0.5)), cool(10)] }),

  // Longer and extra sessions
  lib({ id: 'lib-spin-45', name: 'Easy Spin 45', family: 'recovery', phases: ['any'], bases: ['power', 'hr'],
    purpose: 'Forty-five minutes of light pedalling with a few minutes of higher cadence in the middle. For the day after the long ride when thirty minutes is not quite enough to feel loose.',
    physiology: 'Circulation and neuromuscular refresh.',
    blocks: [step(15, 0.45, { intensityHigh: 0.55 }), step(10, 0.55, { cadence: 100, label: 'High cadence' }), step(20, 0.45, { intensityHigh: 0.55 })] }),
  lib({ id: 'lib-z2-120', name: 'Foundation 120', family: 'endurance', phases: ['base', 'build', 'any'], bases: ['power', 'hr'],
    purpose: 'Two hours of zone 2 with a cadence change every half hour. The mid-week long ride for a rider with the time, or a weekend ride in a recovery week.',
    physiology: 'Aerobic base; fat oxidation.',
    blocks: [warm(10), step(25, 0.62, { intensityHigh: 0.72 }), step(5, 0.68, { cadence: 100, label: 'High cadence' }), step(25, 0.62, { intensityHigh: 0.72 }), step(5, 0.68, { cadence: 100, label: 'High cadence' }), step(25, 0.62, { intensityHigh: 0.72 }), step(5, 0.68, { cadence: 100, label: 'High cadence' }), step(15, 0.62, { intensityHigh: 0.72 }), cool(5)] }),
  lib({ id: 'lib-long-180', name: 'Long Steady 3:00', family: 'endurance', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Three hours in the aerobic zone. The weekly long ride once the base is in; eat from the first half hour and keep the second half as steady as the first.',
    physiology: 'Aerobic durability; glycogen sparing.',
    blocks: [warm(15), step(160, 0.6, { intensityHigh: 0.72 }), cool(5)] }),
  lib({ id: 'lib-long-210', name: 'Long Steady 3:30', family: 'endurance', phases: ['build'], bases: ['power', 'hr'],
    purpose: 'Three and a half hours of zone 2. Watch heart rate against power in the final hour: if it drifts up more than five percent, the base is not done yet.',
    physiology: 'Aerobic durability; the decoupling test at length.',
    blocks: [warm(15), step(190, 0.6, { intensityHigh: 0.72 }), cool(5)] }),
  lib({ id: 'lib-long-240', name: 'Long Steady 4:00', family: 'endurance', phases: ['build', 'peak'], bases: ['power', 'hr'],
    purpose: 'Four hours. Century preparation: seventy grams of carbohydrate an hour after the first forty-five minutes, and a position you can hold for the last hour.',
    physiology: 'Event-specific durability.',
    blocks: [warm(15), step(220, 0.6, { intensityHigh: 0.72 }), cool(5)] }),
  lib({ id: 'lib-long-300', name: 'Long Steady 5:00', family: 'endurance', phases: ['peak'], bases: ['power', 'hr'],
    purpose: 'Five hours of zone 2: the final long ride before a century, three to four weeks out. Nothing above zone 2, a proper stop for food, and a rest day after.',
    physiology: 'Deep aerobic durability.',
    blocks: [warm(15), step(280, 0.6, { intensityHigh: 0.72 }), cool(5)] }),
  lib({ id: 'lib-tempo-3x15', name: 'Tempo 3 x 15', family: 'tempo', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Three fifteen-minute tempo blocks with short recoveries. Forty-five minutes of comfortably hard riding; the staple of a base block for a rider who finds sweet spot too much every week.',
    physiology: 'Muscular endurance at moderate strain.',
    blocks: [warm(12), rep(3, 'Tempo', step(15, 0.8, { intensityHigh: 0.86 }), step(4, 0.5)), cool(8)] }),
  lib({ id: 'lib-thr-3x12', name: 'Threshold 3 x 12', family: 'threshold', phases: ['build', 'peak'], bases: ['power', 'hr'],
    purpose: 'Thirty-six minutes at FTP in three efforts. Sits between 3 x 10 and 2 x 20 in the threshold progression; the recovery between efforts is long enough that each one should be as good as the first.',
    physiology: 'Lactate threshold; repeatability at FTP.',
    blocks: [warm(15), rep(3, 'Threshold', step(12, 0.97, { intensityHigh: 1.02 }), step(6, 0.5)), cool(10)] }),
  lib({ id: 'lib-vo2-4x5', name: 'VO2max 4 x 5', family: 'vo2max', phases: ['peak'], bases: ['power'],
    purpose: 'Four five-minute efforts above threshold with five minutes easy. Longer than 4 x 4 and the top of the VO2max progression for a masters rider; once a week at most, fresh.',
    physiology: 'Maximal oxygen uptake; sustained high-intensity tolerance.',
    blocks: [warm(15), rep(4, 'VO2max', step(5, 1.08, { intensityHigh: 1.15 }), step(5, 0.5)), cool(10)] }),

  // Tests
  lib({ id: 'lib-ramp', name: 'Ramp Test', family: 'test', phases: ['any'], bases: ['power'],
    purpose: 'Start easy and add six percent every minute until you cannot. FTP is estimated as seventy-five percent of the best one-minute power. Takes twenty minutes and needs no pacing judgement; do it at the start of each block.',
    physiology: 'FTP estimate.',
    blocks: [step(5, 0.46), step(1, 0.52), step(1, 0.58), step(1, 0.64), step(1, 0.7), step(1, 0.76), step(1, 0.82), step(1, 0.88), step(1, 0.94), step(1, 1.0), step(1, 1.06), step(1, 1.12), step(1, 1.18), step(1, 1.24), step(1, 1.3), step(1, 1.36), cool(10)] }),
  lib({ id: 'lib-20min', name: '20-Minute FTP Test', family: 'test', phases: ['any'], bases: ['power', 'hr'],
    purpose: 'A thorough warm-up, then twenty minutes as hard as you can hold evenly. FTP is ninety-five percent of the result; on heart rate, your average over the last fifteen minutes is a good LTHR. Harder than the ramp test, closer to the truth for steady-state riders.',
    physiology: 'FTP and LTHR estimate.',
    blocks: [warm(15), step(5, 1.05, { label: 'Blow out' }), step(10, 0.5), step(20, 1.0, { label: 'Test' }), cool(10)] }),
  lib({ id: 'lib-lthr-30', name: '30-Minute LTHR Test', family: 'test', phases: ['any'], bases: ['hr'],
    purpose: 'Thirty minutes at the hardest pace you can hold evenly, alone. Press lap at ten minutes: the average heart rate of the final twenty minutes is your lactate threshold heart rate. The test to run when you are training by heart rate.',
    physiology: 'LTHR estimate (Friel protocol).',
    blocks: [warm(15), step(30, 1.0, { label: 'Test, lap at 10 min' }), cool(10)] }),
];

/** The whole library: core sessions, trail-shaped outdoor rides, and indoor short forms. */
export const LIBRARY: Workout[] = [...CORE, ...OUTDOOR, ...INDOOR].map((w) => {
  const place = RIDE_NAMES[w.id];
  return place ? { ...w, name: place, subtitle: w.name } : w;
});

export function libraryById(id: string): Workout | undefined {
  return LIBRARY.find((w) => w.id === id);
}

export const FAMILY_LABEL: Record<Workout['family'], string> = {
  recovery: 'Recovery',
  endurance: 'Endurance',
  tempo: 'Tempo',
  sweetspot: 'Sweet spot',
  threshold: 'Threshold',
  vo2max: 'VO2max',
  anaerobic: 'Anaerobic',
  test: 'Test',
};
