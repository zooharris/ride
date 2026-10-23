import type { Basis, Profile, Workout, WorkoutBlock, WorkoutStats, WorkoutStep } from './types';
import { powerToHrFraction, powerZone, rideHrZones, type Zone } from './zones';

/** Flatten repeats into a plain list of steps, in ride order. */
export function flattenSteps(blocks: WorkoutBlock[]): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (const b of blocks) {
    if (b.kind === 'step') out.push(b);
    else for (let i = 0; i < b.times; i++) out.push(...b.steps);
  }
  return out;
}

export function workoutSeconds(blocks: WorkoutBlock[]): number {
  return flattenSteps(blocks).reduce((s, st) => s + st.seconds, 0);
}

/** Representative intensity of a step (the midpoint of a range). */
export function stepIntensity(step: WorkoutStep): number {
  return step.intensityHigh ? (step.intensity + step.intensityHigh) / 2 : step.intensity;
}

/**
 * Derived numbers for a workout. TSS is estimated from the step intensities:
 * each second at intensity i contributes i² / 36 to TSS (so an hour at FTP = 100).
 * This is the standard planned-TSS estimate; actual TSS comes from the ride.
 */
export function workoutStats(blocks: WorkoutBlock[]): WorkoutStats {
  const steps = flattenSteps(blocks);
  const seconds = steps.reduce((s, st) => s + st.seconds, 0);
  const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];
  let work = 0; // Σ seconds × intensity²
  for (const st of steps) {
    const i = stepIntensity(st);
    work += st.seconds * i * i;
    // A range step is classified by its floor: 88–92% is sweet spot (Z3), not threshold.
    zoneSeconds[powerZone(st.intensity) - 1] += st.seconds;
  }
  const tss = Math.round(work / 36);
  const intensityFactor = seconds > 0 ? Math.round(Math.sqrt(work / seconds) * 100) / 100 : 0;
  return { seconds, tss, intensityFactor, dominantZone: dominantZone(zoneSeconds), zoneSeconds };
}

/**
 * The zone a workout is "about". Time in Z1 is never the point of a workout
 * (it is warm-up, recovery and cool-down), so the dominant zone is the zone with
 * the most time above Z1, unless the whole ride is Z1.
 */
export function dominantZone(zoneSeconds: number[]): number {
  let best = 1;
  let bestSeconds = 0;
  for (let z = 2; z <= 7; z++) {
    const s = zoneSeconds[z - 1];
    if (s > bestSeconds) { best = z; bestSeconds = s; }
  }
  return bestSeconds > 0 ? best : 1;
}

/**
 * Render a workout as Intervals.icu workout text, in one target basis.
 * Garmin accepts one target type per workout, so a workout is always rendered
 * entirely as power or entirely as HR.
 *
 * Power steps are "% of FTP"; HR steps are "% LTHR". Intervals.icu converts
 * these to the athlete's current numbers when it builds the Garmin workout, so
 * the file is right on the day FTP changes.
 */
export function renderIntervalsText(workout: Workout, basis: Basis, zones?: Zone[]): string {
  const lines: string[] = [];
  for (const b of workout.blocks) {
    if (b.kind === 'step') {
      lines.push(renderStep(b, basis, zones));
    } else {
      lines.push('');
      lines.push(`${b.label ?? 'Set'} ${b.times}x`);
      for (const st of b.steps) lines.push(renderStep(st, basis, zones));
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Intervals.icu and Garmin need a range with two ends, so a step with no
 * minimum is sent with a floor nothing moving falls under: 10% of FTP (a
 * couple of dozen watts) or 20% of threshold heart rate (about 30 bpm).
 */
export const NO_FLOOR: Record<Basis, number> = { power: 0.1, hr: 0.2 };

function renderStep(step: WorkoutStep, basis: Basis, zones?: Zone[]): string {
  const lo = step.noFloor ? NO_FLOOR[basis] : basis === 'power' ? step.intensity : powerToHrFraction(step.intensity, zones);
  const hi = step.intensityHigh
    ? (basis === 'power' ? step.intensityHigh : powerToHrFraction(step.intensityHigh, zones))
    : step.noFloor ? (basis === 'power' ? step.intensity : powerToHrFraction(step.intensity, zones)) : undefined;
  const pct = (f: number) => Math.round(f * 100);
  const target = hi ? `${pct(lo)}-${pct(hi)}%` : `${pct(lo)}%`;
  const unit = basis === 'power' ? '' : ' LTHR';
  const cadence = step.cadence ? ` ${step.cadence}rpm` : '';
  const label = step.label ? `${step.label} ` : '';
  return `- ${label}${formatDuration(step.seconds)} ${target}${unit}${cadence}`;
}

/** 90 → "1m30s", 600 → "10m", 3600 → "1h". Intervals.icu accepts all three. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join('') || '0s';
}

/** "1:05:00" style for screens. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Targets shown in the app for a step, in the athlete's numbers. */
export function stepTargets(step: WorkoutStep, profile: Profile): { watts: string; bpm: string } {
  const w = (f: number) => Math.round(f * profile.ftp);
  const b = (f: number) => Math.round(powerToHrFraction(f, rideHrZones(profile)) * profile.lthr);
  if (step.noFloor) {
    const top = step.intensityHigh ?? step.intensity;
    return { watts: `up to ${w(top)}`, bpm: `up to ${b(top)}` };
  }
  return {
    watts: step.intensityHigh ? `${w(step.intensity)}–${w(step.intensityHigh)}` : `${w(step.intensity)}`,
    bpm: step.intensityHigh ? `${b(step.intensity)}–${b(step.intensityHigh)}` : `${b(step.intensity)}`,
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * A recovery workout enforces no minimum: every easy step (under 60% of
 * threshold) becomes "up to" its ceiling, so the rider may spin as softly as
 * they like without the Garmin complaining. Harder steps (openers' efforts) keep
 * their targets.
 */
export function relaxFloors(w: Workout): Workout {
  if (w.family !== 'recovery' || w.kind !== 'ride') return w;
  const relax = (s: WorkoutStep): WorkoutStep => (s.intensity < 0.6 && (s.intensityHigh ?? s.intensity) <= 0.65 ? { ...s, noFloor: true } : s);
  return { ...w, blocks: w.blocks.map((b) => b.kind === 'step' ? relax(b) : { ...b, steps: b.steps.map(relax) }) };
}
