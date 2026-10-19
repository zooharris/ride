import type { Family, Workout, WorkoutBlock, WorkoutStep } from './types';
import { clock, newId, relaxFloors } from './workout';

/**
 * Build a session to fit a slot. The planner says what it wants (type, minutes,
 * how far through a block we are, indoor or out); this returns a real workout
 * with a name and a sentence, built from the same model the builder uses.
 */
export type SessionType = 'endurance' | 'long' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2max' | 'anaerobic' | 'recovery' | 'openers' | 'test';

export interface SessionIntent {
  type: SessionType;
  minutes: number;
  progression: number;    // 0 at the start of a block, 1 at its end
  outdoor: boolean;
  reason: string;         // why this session, this week; shown on the day
}

const m = (minutes: number) => Math.round(minutes * 60);
const step = (minutes: number, intensity: number, extra: Partial<WorkoutStep> = {}): WorkoutStep => ({ kind: 'step', seconds: m(minutes), intensity, ...extra });
const rep = (times: number, label: string, ...steps: WorkoutStep[]): WorkoutBlock => ({ kind: 'repeat', times, label, steps });
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

function warmUp(minutes: number, outdoor: boolean): WorkoutBlock[] {
  if (outdoor && minutes >= 90) {
    return [step(15, 0.55, { intensityHigh: 0.7, label: 'Warm up, build gently' }), step(1, 0.95, { label: 'Pickup' }), step(3, 0.6, { label: 'Easy' }), step(1, 0.95, { label: 'Pickup' }), step(5, 0.6, { label: 'Easy' })];
  }
  const w = minutes >= 60 ? 12 : 8;
  return [step(w, 0.5, { intensityHigh: 0.68, label: 'Warm up' })];
}

function warmMinutes(minutes: number, outdoor: boolean): number { return outdoor && minutes >= 90 ? 25 : minutes >= 60 ? 12 : 8; }
function coolMinutes(minutes: number): number { return minutes >= 150 ? 5 : minutes >= 60 ? 10 : 6; }

export function generateSession(intent: SessionIntent): Workout {
  const { type, minutes, progression: t, outdoor } = intent;
  const wm = warmMinutes(minutes, outdoor);
  const cm = coolMinutes(minutes);
  const budget = Math.max(10, minutes - wm - cm);
  const blocks: WorkoutBlock[] = [];
  let name = '';
  let family: Family = 'endurance';
  let main: WorkoutBlock[] = [];
  let mainMinutes = 0;

  switch (type) {
    case 'sweetspot': {
      const len = Math.round(lerp(10, 20, t));
      const rest = 5;
      const reps = Math.max(2, Math.min(4, Math.floor(budget / (len + rest))));
      main = [rep(reps, 'Sweet spot', step(len, 0.88, { intensityHigh: 0.93 }), step(rest, 0.55, { label: 'Easy' }))];
      mainMinutes = reps * (len + rest);
      name = `Sweet Spot ${reps} × ${len}`; family = 'sweetspot';
      break;
    }
    case 'threshold': {
      const len = Math.round(lerp(8, 15, t));
      const rest = Math.round(len / 2);
      const reps = Math.max(2, Math.min(4, Math.floor(budget / (len + rest))));
      main = [rep(reps, 'Threshold', step(len, 0.95, { intensityHigh: 1.0 }), step(rest, 0.55, { label: 'Easy' }))];
      mainMinutes = reps * (len + rest);
      name = `Threshold ${reps} × ${len}`; family = 'threshold';
      break;
    }
    case 'vo2max': {
      const len = Math.round(lerp(3, 5, t));
      const reps = Math.max(4, Math.min(6, Math.floor(budget / (2 * len))));
      main = [rep(reps, 'VO2max', step(len, 1.1, { intensityHigh: 1.18 }), step(len, 0.5, { label: 'Easy' }))];
      mainMinutes = reps * 2 * len;
      name = `VO2max ${reps} × ${len}`; family = 'vo2max';
      break;
    }
    case 'anaerobic': {
      const reps = Math.max(5, Math.min(8, Math.floor(budget / 6)));
      main = [rep(reps, 'Anaerobic', step(1, 1.3, { intensityHigh: 1.4 }), step(5, 0.5, { label: 'Easy' }))];
      mainMinutes = reps * 6;
      name = `Anaerobic ${reps} × 1`; family = 'anaerobic';
      break;
    }
    case 'tempo': {
      const len = Math.round(lerp(15, 30, t));
      const rest = 5;
      const reps = Math.max(1, Math.min(3, Math.floor(budget / (len + rest))));
      main = [rep(reps, 'Tempo', step(len, 0.8, { intensityHigh: 0.86 }), step(rest, 0.55, { label: 'Easy' }))];
      mainMinutes = reps * (len + rest);
      name = reps === 1 ? `Tempo ${len}` : `Tempo ${reps} × ${len}`; family = 'tempo';
      break;
    }
    case 'openers': {
      main = [rep(3, 'Openers', step(1, 1.0), step(3, 0.5)), step(0.25, 1.3, { label: 'Sprint' }), step(3, 0.5)];
      mainMinutes = 15.25;
      name = 'Openers'; family = 'recovery';
      break;
    }
    case 'test': {
      main = [step(5, 1.05, { label: 'Blow out' }), step(10, 0.5, { label: 'Easy' }), step(20, 1.0, { intensityHigh: 1.05, label: 'Test, 20 minutes all-out and even' })];
      mainMinutes = 35;
      name = '20-Minute FTP Test'; family = 'test';
      break;
    }
    case 'recovery': {
      main = [step(budget, 0.45, { intensityHigh: 0.55, cadence: 95, label: 'Easy spin' })];
      mainMinutes = budget;
      name = `Recovery Spin ${minutes}`; family = 'recovery';
      break;
    }
    case 'long':
    case 'endurance':
    default: {
      // Zone 2 with a cadence change every half hour so a long ride has a rhythm.
      const pieces: WorkoutStep[] = [];
      let left = budget;
      let i = 0;
      while (left > 0) {
        const piece = Math.min(30, left);
        pieces.push(step(piece, 0.6, { intensityHigh: 0.72, cadence: i % 2 ? 95 : 85, label: i % 2 ? 'Zone 2, spin a little quicker' : 'Zone 2, steady' }));
        left -= piece; i++;
      }
      main = pieces;
      mainMinutes = budget;
      name = type === 'long' ? `Long Endurance ${clock(m(minutes)).replace(/:00$/, '')}` : `Endurance ${clock(m(minutes)).replace(/:00$/, '')}`;
      family = 'endurance';
      break;
    }
  }

  blocks.push(...warmUp(minutes, outdoor));
  blocks.push(...main);
  const fill = budget - mainMinutes;
  if (fill >= 5) blocks.push(step(fill, 0.6, { intensityHigh: 0.72, label: outdoor ? 'Zone 2 for the rest of the ride' : 'Zone 2 to finish' }));
  blocks.push(step(cm, 0.5, { label: 'Cool down' }));

  const bases: Workout['bases'] = type === 'vo2max' || type === 'anaerobic' || type === 'openers' ? ['power'] : ['power', 'hr'];
  return relaxFloors({
    id: `gen-${newId()}`,
    name,
    kind: 'ride',
    family,
    purpose: intent.reason,
    physiology: PHYSIOLOGY[type],
    phases: ['any'],
    bases,
    setting: outdoor ? 'outdoor' : 'indoor',
    blocks,
    source: 'generated',
  });
}

const PHYSIOLOGY: Record<SessionType, string> = {
  endurance: 'Aerobic base: mitochondria, capillaries, fat oxidation.',
  long: 'Aerobic durability: holding form and fuelling late in a ride.',
  tempo: 'Muscular endurance at a sustainable intensity.',
  sweetspot: 'Sub-threshold power with manageable fatigue; the efficient FTP builder.',
  threshold: 'Lactate threshold; raises FTP directly.',
  vo2max: 'Maximal oxygen uptake; the ceiling FTP sits under.',
  anaerobic: 'Short, sharp power and repeatability.',
  recovery: 'Circulation with almost no stress.',
  openers: 'Neural activation the day before an event.',
  test: 'FTP estimate.',
};
