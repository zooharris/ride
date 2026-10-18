import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';

/** Indoor and short-form workouts: tighter structure, less filler, trainer-friendly. */
const m = (minutes: number) => Math.round(minutes * 60);
const step = (minutes: number, intensity: number, extra: Partial<WorkoutStep> = {}): WorkoutStep =>
  ({ kind: 'step', seconds: m(minutes), intensity, ...extra });
const warm = (minutes = 10) => step(minutes, 0.5, { intensityHigh: 0.65, label: 'Warm up' });
const cool = (minutes = 10) => step(minutes, 0.5, { label: 'Cool down' });
const rep = (times: number, label: string, ...steps: WorkoutStep[]): WorkoutBlock => ({ kind: 'repeat', times, label, steps });
const lib = (w: Omit<Workout, 'source' | 'setting' | 'kind'>): Workout => ({ ...w, source: 'library', setting: 'indoor', kind: 'ride' });

export const INDOOR: Workout[] = [
  // Endurance with structure, for a trainer that gets boring
  lib({ id: 'in-z2-cadence-60', name: 'Cadence Ladder 60', family: 'endurance', phases: ['base', 'any'], bases: ['power', 'hr'],
    purpose: 'An hour of zone 2 that climbs through cadences from 80 to 105 rpm and back. Keeps a trainer ride interesting and smooths the pedal stroke.',
    physiology: 'Aerobic base; neuromuscular coordination.',
    blocks: [warm(8), step(8, 0.65, { cadence: 80 }), step(8, 0.65, { cadence: 90 }), step(8, 0.65, { cadence: 100 }), step(6, 0.65, { cadence: 105 }), step(8, 0.65, { cadence: 95 }), step(8, 0.65, { cadence: 85 }), cool(6)] }),
  lib({ id: 'in-z2-surges-75', name: 'Endurance with Surges', family: 'endurance', phases: ['base', 'build'], bases: ['power'],
    purpose: 'Seventy-five minutes of zone 2 with six short surges to threshold scattered through it. Mimics a rolling road without leaving the aerobic zone for long.',
    physiology: 'Aerobic base with brief lactate exposure.',
    blocks: [warm(10), rep(6, 'Z2 with surge', step(9, 0.65), step(1, 1.0, { label: 'Surge' })), cool(5)] }),
  lib({ id: 'in-z2-90', name: 'Indoor Foundation 90', family: 'endurance', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Ninety minutes of zone 2 on the trainer, broken into three blocks with a cadence change so it passes. The weather-backup long ride.',
    physiology: 'Aerobic base.',
    blocks: [warm(10), step(25, 0.62, { intensityHigh: 0.7 }), step(5, 0.68, { cadence: 100 }), step(25, 0.62, { intensityHigh: 0.7 }), step(5, 0.68, { cadence: 100 }), step(15, 0.62, { intensityHigh: 0.7 }), cool(5)] }),

  // Sweet spot, short form
  lib({ id: 'in-ss-4x8', name: 'Sweet Spot 4 x 8', family: 'sweetspot', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'An hour with thirty-two minutes of sweet spot. The lunchtime session: short recoveries, no wasted time.',
    physiology: 'FTP development in a short window.',
    blocks: [warm(10), rep(4, 'Sweet spot', step(8, 0.88, { intensityHigh: 0.93 }), step(3, 0.5)), cool(6)] }),
  lib({ id: 'in-ss-pyramid', name: 'Sweet Spot Pyramid', family: 'sweetspot', phases: ['base', 'build'], bases: ['power', 'hr'],
    purpose: 'Efforts of 5, 10, 15, 10 and 5 minutes. The fifteen in the middle is the hard part; the five at the end feels like a gift.',
    physiology: 'Sub-threshold endurance with a varied rhythm.',
    blocks: [warm(10), step(5, 0.9), step(3, 0.5), step(10, 0.9), step(4, 0.5), step(15, 0.9), step(4, 0.5), step(10, 0.9), step(3, 0.5), step(5, 0.9), cool(8)] }),
  lib({ id: 'in-ss-bursts', name: 'Sweet Spot with Bursts', family: 'sweetspot', phases: ['build'], bases: ['power'],
    purpose: 'Three ten-minute sweet-spot blocks, each with a fifteen-second burst every two minutes. Teaches the legs to recover while still working, the way a group ride demands.',
    physiology: 'Sub-threshold endurance; surge recovery.',
    blocks: [warm(12), rep(3, 'Block', step(1.75, 0.9), step(0.25, 1.3, { label: 'Burst' }), step(1.75, 0.9), step(0.25, 1.3, { label: 'Burst' }), step(1.75, 0.9), step(0.25, 1.3, { label: 'Burst' }), step(1.75, 0.9), step(0.25, 1.3, { label: 'Burst' }), step(2, 0.9), step(5, 0.5, { label: 'Easy' })), cool(8)] }),

  // Threshold, short form
  lib({ id: 'in-thr-2x12', name: 'Threshold 2 x 12', family: 'threshold', phases: ['build'], bases: ['power', 'hr'],
    purpose: 'Two twelve-minute efforts at FTP inside an hour. The sensible threshold session for a weeknight.',
    physiology: 'Lactate threshold.',
    blocks: [warm(12), rep(2, 'Threshold', step(12, 0.97, { intensityHigh: 1.02 }), step(6, 0.5)), cool(8)] }),
  lib({ id: 'in-thr-3x10', name: 'Threshold 3 x 10', family: 'threshold', phases: ['build', 'peak'], bases: ['power', 'hr'],
    purpose: 'Thirty minutes at threshold in three pieces. A big session; the day after is easy or off.',
    physiology: 'Lactate threshold; repeatability.',
    blocks: [warm(15), rep(3, 'Threshold', step(10, 0.97, { intensityHigh: 1.02 }), step(5, 0.5)), cool(10)] }),
  lib({ id: 'in-thr-progressive', name: 'Threshold Progression 20', family: 'threshold', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'One twenty-minute effort that steps up from sweet spot to just over threshold in four five-minute stages. Finishes hard without starting hard.',
    physiology: 'Threshold tolerance; negative-split pacing.',
    blocks: [warm(15), step(5, 0.9, { label: 'Stage 1' }), step(5, 0.95, { label: 'Stage 2' }), step(5, 1.0, { label: 'Stage 3' }), step(5, 1.04, { label: 'Stage 4' }), cool(15)] }),

  // VO2max, short form
  lib({ id: 'in-vo2-4x4', name: 'VO2max 4 x 4', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'Four four-minute efforts with four minutes easy. The classic, and enough for a masters rider in any week that also has a long ride.',
    physiology: 'Maximal oxygen uptake.',
    blocks: [warm(15), rep(4, 'VO2max', step(4, 1.1, { intensityHigh: 1.18 }), step(4, 0.5)), cool(10)] }),
  lib({ id: 'in-vo2-40-20', name: '40/20s', family: 'vo2max', phases: ['build', 'peak'], bases: ['power'],
    purpose: 'Two sets of eight: forty seconds hard, twenty seconds easy. The short recoveries keep oxygen demand high for the whole set. Power only.',
    physiology: 'VO2max with high time at intensity.',
    blocks: [warm(15), rep(8, 'Set 1', step(2 / 3, 1.2), step(1 / 3, 0.5)), step(5, 0.5, { label: 'Between sets' }), rep(8, 'Set 2', step(2 / 3, 1.2), step(1 / 3, 0.5)), cool(10)] }),
  lib({ id: 'in-vo2-hard-start', name: 'Hard-Start VO2max 4 x 4', family: 'vo2max', phases: ['peak'], bases: ['power'],
    purpose: 'Each four-minute effort opens with thirty seconds well above target, then settles. Gets you to maximal oxygen uptake faster so more of each minute counts.',
    physiology: 'VO2max kinetics.',
    blocks: [warm(15), rep(4, 'VO2max', step(0.5, 1.35, { label: 'Hard start' }), step(3.5, 1.1), step(4, 0.5)), cool(10)] }),

  // Mixed and skills
  lib({ id: 'in-race-sim', name: 'Group Ride Simulation', family: 'threshold', phases: ['peak'], bases: ['power'],
    purpose: 'Seventy-five minutes that never settle: tempo with threshold surges, two short climbs, a sprint. Everything a Saturday group ride throws at you, in order.',
    physiology: 'Variable-intensity tolerance.',
    blocks: [warm(12), step(10, 0.82), step(2, 1.05, { label: 'Surge' }), step(8, 0.82), step(3, 1.0, { label: 'Climb' }), step(5, 0.6), step(10, 0.85), step(0.25, 1.6, { label: 'Sprint' }), step(5, 0.6), step(4, 1.02, { label: 'Climb' }), step(3, 0.6), step(1, 1.1, { label: 'Finish' }), cool(10)] }),
  lib({ id: 'in-spinups', name: 'Spin-ups and Single Leg', family: 'recovery', phases: ['any'], bases: ['power', 'hr'],
    purpose: 'Forty-five easy minutes of pedalling drills: spin-ups to the fastest smooth cadence you can hold, and single-leg blocks. Recovery-day work that makes the stroke better.',
    physiology: 'Pedalling economy; neuromuscular coordination.',
    blocks: [warm(8), rep(4, 'Spin-up', step(1, 0.6, { cadence: 110, label: 'Spin-up' }), step(2, 0.55, { cadence: 85 })), rep(4, 'Single leg', step(1, 0.55, { label: 'Left leg' }), step(1, 0.55, { label: 'Right leg' }), step(1, 0.55, { label: 'Both' })), cool(13)] }),
  lib({ id: 'in-rollr-45', name: 'Weather Backup 45', family: 'endurance', phases: ['any'], bases: ['power', 'hr'],
    purpose: 'Forty-five minutes of zone 2 on the trainer with a cadence change every ten minutes. The ride that replaces a walk or a rained-out day; no heroics.',
    physiology: 'Aerobic maintenance.',
    blocks: [warm(5), step(10, 0.65, { cadence: 85 }), step(10, 0.65, { cadence: 95 }), step(10, 0.65, { cadence: 90 }), step(5, 0.65, { cadence: 100 }), cool(5)] }),
];
