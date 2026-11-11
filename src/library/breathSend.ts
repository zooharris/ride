import type { Profile, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { stepBreath } from '../engine/workout';
import { breathZones } from '../engine/zones';
import { BREATH_SHORT_S, type BreathPowerTable } from '../player/breathControl';

/**
 * Breathing outdoors (Step 6, 11 Nov 2026). A bike computer holds power or heart-rate targets, never breathing. So a
 * ride still goes to the Garmin by power or heart rate, with two additions for a rider with breathing zones:
 *  - every step's text carries its breathing target, to ride to with the strap maker's own live breathing field;
 *  - a third way to send, "by breathing": each step's target is the power this rider's breathing zone for that step
 *    corresponds to, from the watts the player learned on the trainer (riding by breathing). Short steps keep their
 *    planned watts: breathing can't follow them.
 * The learned table changes only on the trainer: road riding is too uneven (hills, stops, wind) to learn watts from.
 */

/** Whether a ride works by breathing for this rider: it works by heart rate, and the rider has breathing zones. */
export const worksByBreath = (w: Pick<Workout, 'kind' | 'bases'>, p: Pick<Profile, 'vt1Ve' | 'vt2Ve' | 'breathZoneMode' | 'breathZonePcts' | 'breathZoneTops'> | undefined): boolean =>
  w.kind === 'ride' && w.bases.includes('hr') && !!p && !!breathZones(p);

const L = (v: number) => Math.round(v);

/**
 * A step's breathing target in words for the Garmin's step text. Written without "%" or units Intervals.icu would
 * read as a target or a length ("litres a minute", "percent"), so the line's own target stays the only one.
 */
export function breathStepText(step: WorkoutStep, p: Profile): string | undefined {
  const b = stepBreath(step, p);
  if (!b) return undefined;
  return b.ceiling ? `breathing under ${L(b.hi)} litres a minute` : `breathing ${L(b.lo)} to ${L(b.hi)} litres a minute`;
}

/** The ride with each step's breathing target added to its text, for a rider with zones on a ride that works by breathing. */
export function withBreathText(w: Workout, p: Profile | undefined): Workout {
  if (!p || !worksByBreath(w, p)) return w;
  const one = (s: WorkoutStep): WorkoutStep => { const t = breathStepText(s, p); return t ? { ...s, label: s.label ? `${s.label} · ${t}` : t } : s; };
  return { ...w, blocks: w.blocks.map((b): WorkoutBlock => (b.kind === 'step' ? one(b) as WorkoutBlock : { ...b, steps: b.steps.map(one) })) };
}

/** The breathing zones a ride's steered steps (two minutes or more) use. */
export function breathZonesUsed(w: Workout, p: Profile): number[] {
  const out = new Set<number>();
  const one = (s: WorkoutStep) => { if (s.seconds >= BREATH_SHORT_S) { const b = stepBreath(s, p); if (b) out.add(b.zone); } };
  for (const b of w.blocks) if (b.kind === 'step') one(b); else b.steps.forEach(one);
  return [...out].sort();
}

/** Whether the ride can go "by breathing": it works by breathing and the learned table covers every zone its steered steps use. */
export function canSendByBreath(w: Workout, p: Profile | undefined, table: BreathPowerTable | undefined): boolean {
  if (!p || !table || !worksByBreath(w, p) || !(p.ftp > 0)) return false;
  const zones = breathZonesUsed(w, p);
  return zones.length > 0 && zones.every((z) => (table[z]?.watts ?? 0) > 0);
}

/** The line shown when "by breathing" can't be pressed for a ride that works by breathing. */
export const BREATH_SEND_NEEDS = 'Ride by breathing on the trainer a few times first, so Antogo knows the watts your breathing zones match.';

/**
 * The ride as power targets from the learned table: each steered step a band of 3% either side of the watts that held
 * its breathing zone (a ceiling step keeps no floor); short steps as planned.
 */
export function breathPowerVersion(w: Workout, p: Profile, table: BreathPowerTable): Workout {
  const one = (s: WorkoutStep): WorkoutStep => {
    if (s.seconds < BREATH_SHORT_S) return s;
    const b = stepBreath(s, p);
    const watts = b ? table[b.zone]?.watts : undefined;
    if (!watts || !(p.ftp > 0)) return s;
    const f = watts / p.ftp;
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return s.noFloor ? { ...s, intensity: r(f * 1.03), intensityHigh: undefined } : { ...s, intensity: r(f * 0.97), intensityHigh: r(f * 1.03) };
  };
  return { ...w, blocks: w.blocks.map((b): WorkoutBlock => (b.kind === 'step' ? one(b) as WorkoutBlock : { ...b, steps: b.steps.map(one) })) };
}

/** The ride exactly as a send would shape it: by breathing as power from the table, each step's breathing text added. */
export function shapedForSend(w: Workout, basis: 'power' | 'hr' | 'breath', p: Profile | undefined, table: BreathPowerTable): { workout: Workout; targets: 'power' | 'hr' } {
  const byBreath = basis === 'breath' && !!p && canSendByBreath(w, p, table);
  return { workout: withBreathText(byBreath ? breathPowerVersion(w, p!, table) : w, p), targets: byBreath ? 'power' : basis === 'breath' ? (w.bases.includes('hr') ? 'hr' : 'power') : basis };
}
