/**
 * A workout laid out as the player rides it: every step in order (repeats
 * unrolled), with when it starts and ends, its name and its target. Pure.
 */
import type { Basis, Profile, Workout, WorkoutStep } from '../engine/types';
import { flattenStepsWithSets, stepTargets } from '../engine/workout';
import { hrZone, powerZone, rideHrZones, ridePowerZones } from '../engine/zones';

export interface TimelineStep {
  index: number;
  /** The step's share of threshold (its low end), for telling steady blocks from easy ones. */
  intensity: number;
  start: number;            // seconds from the start of the workout
  end: number;
  seconds: number;
  name: string;
  /** "Set 2 of 3" when the step is part of a repeated set. */
  setNote?: string;
  zone: number;             // power zone 1..7, for colour
  /** Target as a share of threshold: low and high (equal for a single value). */
  low: number;
  high: number;
  noFloor: boolean;
  cadence?: number;
  /** A work step (not warm-up, recovery or cool-down): the ones the summary tables. */
  work: boolean;
  step: WorkoutStep;
}

/** A step without a name of its own: inside a set, the set's name for the work and "Recovery" for the easy part; elsewhere, its zone. */
export function stepName(st: WorkoutStep, zone: number, setLabel?: string): string {
  return st.label ?? (setLabel ? (st.intensity < 0.6 ? 'Recovery' : setLabel) : `Zone ${zone}`);
}

const EASY = /warm|cool|recover|easy|spin/i;

export function buildTimeline(workout: Workout, profile: Profile): TimelineStep[] {
  const ladder = ridePowerZones(profile);
  let t = 0;
  return flattenStepsWithSets(workout.blocks).map(({ step, set }, index) => {
    const zone = powerZone(step.intensity, ladder);
    const name = stepName(step, zone, set?.label);
    const low = step.intensity;
    const high = step.intensityHigh ?? step.intensity;
    const s: TimelineStep = {
      index, intensity: step.intensity, start: t, end: t + step.seconds, seconds: step.seconds, name,
      setNote: set && set.times > 1 ? `set ${set.rep} of ${set.times}` : undefined,
      zone, low, high, noFloor: !!step.noFloor, cadence: step.cadence,
      work: step.intensity >= 0.75 && !EASY.test(name),
      step,
    };
    t += step.seconds;
    return s;
  });
}

export function totalSeconds(tl: TimelineStep[]): number { return tl.length ? tl[tl.length - 1].end : 0; }

/** The step under a moment of the workout, or undefined after the end. */
export function stepAt(tl: TimelineStep[], at: number): TimelineStep | undefined {
  return tl.find((s) => at >= s.start && at < s.end);
}

/**
 * What the trainer holds for a step in ERG, in watts: the middle of a range,
 * the expected effort for a no-minimum recovery step, scaled by the rider's
 * workout intensity.
 */
export function ergWatts(s: TimelineStep, ftp: number, scale = 1): number {
  const share = s.noFloor ? s.low : (s.low + s.high) / 2;
  return Math.round(share * ftp * scale);
}

/** The band shown around a target, in watts or bpm: the range itself, or 5% either side of a single value. */
export function targetBand(s: TimelineStep, basis: Basis, profile: Profile, scale = 1): { low: number; high: number; mid: number; text: string } {
  if (basis === 'power') {
    const lo = s.low * profile.ftp * scale, hi = s.high * profile.ftp * scale;
    const mid = ergWatts(s, profile.ftp, scale);
    const low = Math.round(s.noFloor ? 0 : s.low === s.high ? mid * 0.95 : lo);
    const high = Math.round(s.low === s.high ? mid * 1.05 : hi);
    const text = s.noFloor ? `up to ${Math.round(hi)} W` : s.low === s.high ? `${mid} W` : `${Math.round(lo)}–${Math.round(hi)} W`;
    return { low, high, mid, text };
  }
  const t = stepTargets(s.step, profile).bpm; // "136" or "130–142" or "up to 135"
  const nums = (t.match(/\d+/g) ?? []).map(Number);
  const low = s.noFloor ? 0 : nums[0] ?? 0;
  const high = nums[nums.length - 1] ?? low;
  return { low, high, mid: Math.round((low + high) / 2), text: `${t} bpm` };
}

/** The heart-rate zone a step's band sits in (its middle), for colour and the zone pill on a ride by heart rate. */
export function hrZoneOf(s: TimelineStep, profile: Profile): number {
  const b = targetBand(s, 'hr', profile);
  const mid = s.noFloor ? b.high * 0.97 : b.mid;
  return hrZone(mid / profile.lthr, rideHrZones(profile));
}

/** The Ramp Test's first ramp step in watts: 46% of FTP plus one step, or a fixed 100 W with no FTP. */
export function rampFirstStep(ftp: number, step: number): number {
  return ftp > 0 ? Math.round(ftp * 0.46) + step : 100;
}
