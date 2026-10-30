import type { Basis, Profile, Workout } from './types';
import { analyseRide } from './analysis';
import { flattenSteps } from './workout';

/**
 * Step 2b, Part B (30 Oct 2026): how a planned hard session went, judged from
 * its recording against its own steps. Pure. Never shown on a screen: it feeds
 * Today's two FTP messages and the coach.
 *
 * A hard session: work steps at or above 0.88 of threshold totalling 8 minutes
 * or more, with at least half that work in the recording.
 *  - held: every work interval within its band with 3% slack under the bottom,
 *    and the last of a repeated set at 92% or more of the first;
 *  - short (fell short): any work interval more than 5% under the bottom of its
 *    band, or the last of a repeated set more than 8% below the first;
 *  - under (a little under): neither; counts for nothing either way.
 * Heart rate over the last work interval: high at 1.05 of threshold heart rate
 * or more, low at 0.95 or less, otherwise settled.
 */
export interface SessionVerdict {
  kind: 'held' | 'short' | 'under';
  hr?: 'high' | 'low' | 'settled';
  /** Minutes of hard work the plan asked for. */
  work: number;
  /** Hard work intervals in the recording. */
  intervals: number;
}

export const HARD_SHARE = 0.88;
export const HARD_MINUTES = 8;
const SLACK = 0.03, SHORT = 0.05, FADE = 0.92;

export function judgeSession(workout: Workout, profile: Profile, basis: Basis, time: number[], watts?: number[], hr?: number[]): SessionVerdict | undefined {
  if (workout.kind !== 'ride' || !time.length) return undefined;
  const steps = flattenSteps(workout.blocks);
  const hard = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.intensity >= HARD_SHARE);
  const plannedWork = hard.reduce((t, x) => t + x.s.seconds, 0);
  if (plannedWork < HARD_MINUTES * 60) return undefined;
  const a = analyseRide(workout, profile, basis, time, watts, hr);
  const end = time[time.length - 1];
  // A work interval counts when the recording covers it and has data for it.
  const done = hard.map(({ s, i }) => ({ s, r: a.steps[i] })).filter(({ r }) => r && r.actual != null && r.endSec <= end + 5);
  const covered = done.reduce((t, x) => t + x.s.seconds, 0);
  if (covered < plannedWork / 2) return undefined;

  let short = false, held = true;
  for (const { r } of done) {
    const miss = (r.targetLow - r.actual!) / r.targetLow;
    if (miss > SHORT) short = true;
    if (miss > SLACK) held = false;
  }
  // Repeated sets: consecutive work intervals with the same band. The last against the first.
  let k = 0;
  while (k < done.length) {
    let j = k;
    while (j + 1 < done.length && done[j + 1].r.targetLow === done[k].r.targetLow && done[j + 1].r.targetHigh === done[k].r.targetHigh) j++;
    if (j > k) {
      const first = done[k].r.actual!, last = done[j].r.actual!;
      if (last < first * FADE) { short = true; held = false; }
    }
    k = j + 1;
  }
  const lastHr = done[done.length - 1]?.r.actualHr;
  const hrWord: SessionVerdict['hr'] = lastHr && profile.lthr > 0 ? (lastHr >= profile.lthr * 1.05 ? 'high' : lastHr <= profile.lthr * 0.95 ? 'low' : 'settled') : undefined;
  return { kind: short ? 'short' : held ? 'held' : 'under', ...(hrWord ? { hr: hrWord } : {}), work: Math.round(plannedWork / 60), intervals: done.length };
}

/** Counts against the setting: fell short, or held only with heart rate high. */
export const offVerdict = (v: SessionVerdict) => v.kind === 'short' || (v.kind === 'held' && v.hr === 'high');
