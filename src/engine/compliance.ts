import type { Ride, Workout } from './types';
import { workoutStats } from './workout';

export type Verdict = 'nailed' | 'done' | 'partial' | 'overcooked' | 'missed';

export interface Compliance {
  verdict: Verdict;
  durationRatio: number;   // actual / planned
  loadRatio: number;       // actual TSS / planned TSS
  reason: string;
}

/**
 * Score a completed ride against the workout it was meant to be. Phase 1 scores
 * duration and load; step-by-step zone compliance arrives with ride streams.
 */
export function scoreRide(workout: Workout, ride: Ride): Compliance {
  const planned = workoutStats(workout.blocks);
  const durationRatio = planned.seconds ? ride.seconds / planned.seconds : 0;
  const loadRatio = planned.tss && ride.tss != null ? ride.tss / planned.tss : durationRatio;
  const r = (n: number) => Math.round(n * 100);

  if (durationRatio < 0.5) {
    return { verdict: 'partial', durationRatio, loadRatio, reason: `Rode ${r(durationRatio)}% of the planned time.` };
  }
  if (loadRatio > 1.3 && durationRatio < 1.3) {
    return { verdict: 'overcooked', durationRatio, loadRatio, reason: `Load was ${r(loadRatio)}% of plan at a similar duration: harder than intended.` };
  }
  if (durationRatio >= 0.9 && loadRatio >= 0.9 && loadRatio <= 1.15) {
    return { verdict: 'nailed', durationRatio, loadRatio, reason: `Duration and load both within 10% of plan.` };
  }
  if (durationRatio >= 0.75 && loadRatio >= 0.7) {
    return { verdict: 'done', durationRatio, loadRatio, reason: `Close to plan: ${r(durationRatio)}% of the time, ${r(loadRatio)}% of the load.` };
  }
  return { verdict: 'partial', durationRatio, loadRatio, reason: `Short of plan: ${r(durationRatio)}% of the time, ${r(loadRatio)}% of the load.` };
}
