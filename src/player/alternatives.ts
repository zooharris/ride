/**
 * For a power-only workout and a rider with no power: rides from the Library
 * (and the rider's own) that can be ridden by heart rate, closest first in
 * length and in how hard they are. Pure, so it is tested.
 */
import type { Workout } from '../engine/types';
import { workoutStats } from '../engine/workout';

export function hrAlternatives(w: Workout, all: Workout[], n = 3): Workout[] {
  const s = workoutStats(w.blocks);
  const score = (x: Workout) => {
    const t = workoutStats(x.blocks);
    return Math.abs(t.seconds - s.seconds) / 600 + Math.abs(t.intensityFactor - s.intensityFactor) * 20 + (x.family === w.family ? -1 : 0);
  };
  return all
    .filter((x) => x.kind === 'ride' && x.id !== w.id && x.bases.includes('hr'))
    .map((x) => ({ x, d: score(x) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((v) => v.x);
}
