import type { Workout, WorkoutStep } from '../engine/types';
import { flattenStepsWithSets } from '../engine/workout';
import { HR_ZONES, POWER_ZONES, powerToHrFraction } from '../engine/zones';

/**
 * Every step change must mean something (10 Nov 2026 brief, Part 1). When a ride moves from one step to the next,
 * the rider must be asked to do something different: a target different enough to feel and to follow, a different
 * cadence, or a cue saying what the new step is for. If none changes, the two steps are one step.
 *
 * "Different enough" is general, not any rider's number:
 *  - Power: the two targets' mid-points differ by at least POWER_STEP of FTP (3%: about 7 W at an FTP of 240, a step
 *    a trainer holds and a rider feels; progressions such as sweet-spot stairs climb by about this much), and neither range simply contains the
 *    other (a rider already inside the new range is asked for nothing). Two "up to" ceilings differ only when the
 *    ceilings themselves differ by that much. A change inside one easy ceiling is never a power change.
 *  - Heart rate, for a ride that works by heart rate: the same test on the heart-rate targets the app derives, with
 *    HR_STEP of threshold heart rate (about 5 beats for most riders), on the standard zone tables, which every rider's
 *    own tables are shaped like.
 */
export const POWER_STEP = 0.03;
export const HR_STEP = 0.03;

type Span = { lo: number; hi: number; ceilingOnly: boolean };

const powerSpan = (s: WorkoutStep): Span => s.noFloor
  ? { lo: 0, hi: s.intensityHigh ?? s.intensity, ceilingOnly: true }
  : { lo: s.intensity, hi: s.intensityHigh ?? s.intensity, ceilingOnly: false };

const hrSpan = (s: WorkoutStep): Span => {
  const p = powerSpan(s);
  const f = (x: number) => powerToHrFraction(x, HR_ZONES, POWER_ZONES);
  return { lo: p.ceilingOnly ? 0 : f(p.lo), hi: f(p.hi), ceilingOnly: p.ceilingOnly };
};

/** Whether moving from span a to span b asks for something the rider can feel. */
function differs(a: Span, b: Span, step: number): boolean {
  if (a.ceilingOnly && b.ceilingOnly) return Math.abs(a.hi - b.hi) >= step - 1e-9;
  if (a.ceilingOnly || b.ceilingOnly) {
    // An easy ceiling against a held target: different only if the held target sits clearly above the ceiling.
    const [c, h] = a.ceilingOnly ? [a, b] : [b, a];
    return h.lo - c.hi >= step - 1e-9;
  }
  const mid = (x: Span) => (x.lo + x.hi) / 2;
  const contains = (x: Span, y: Span) => x.lo <= y.lo + 1e-9 && x.hi >= y.hi - 1e-9;
  return Math.abs(mid(a) - mid(b)) >= step - 1e-9 && !contains(a, b) && !contains(b, a);
}

export interface StepProblem { at: number; from: WorkoutStep; to: WorkoutStep; why: 'power' | 'heart rate' }

/** The step changes in a ride that ask for nothing new, in ridden order (repeats unrolled). */
export function stepProblems(w: Workout): StepProblem[] {
  if (w.kind !== 'ride') return [];
  const steps = flattenStepsWithSets(w.blocks).map((x) => x.step);
  const hr = w.bases.includes('hr');
  const out: StepProblem[] = [];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i];
    if ((a.cadence ?? 0) !== (b.cadence ?? 0)) continue;          // a cadence change is something to do
    if (b.cues?.some((c) => c.at >= 0 && c.at <= 15)) continue;    // the new step says what it is for
    if (!differs(powerSpan(a), powerSpan(b), POWER_STEP)) { out.push({ at: i, from: a, to: b, why: 'power' }); continue; }
    if (hr && !differs(hrSpan(a), hrSpan(b), HR_STEP)) out.push({ at: i, from: a, to: b, why: 'heart rate' });
  }
  return out;
}
