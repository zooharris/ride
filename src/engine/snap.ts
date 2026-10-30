import type { Basis, Workout } from './types';
import { workoutStats } from './workout';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import type { Equipment } from './types';

/**
 * Library-only plans (Batch 6, Parts B and B2, 23 Oct 2026). The planner still
 * decides what a session is from the rider's data (type, length, progression);
 * this picks the nearest Library workout to carry it out, always. The plan never
 * creates a workout: the Library is the rider's to curate, and when its nearest
 * workout is a poor fit the plan says so (planner.ts) instead of making one.
 *
 * Strength is not snapped: the planner rotates the exercises week by week
 * inside a block, and the Library's strength sessions are fixed, so snapping
 * would freeze them. Its names are already stable ("Strength A: legs and trunk").
 */

/** A session's length and load: rides from their steps, everything else from its estimate. */
export function sizeOf(w: Workout): { minutes: number; tss: number } {
  if (w.kind === 'ride' && w.blocks?.length) { const s = workoutStats(w.blocks); return { minutes: s.seconds / 60, tss: s.tss }; }
  return { minutes: w.walk?.minutes ?? w.minutes ?? 0, tss: w.estimatedTss ?? 0 };
}

/** How close two sessions must be to count as the same: rides 12%, others 15%, with floors in minutes and load. */
export function tolerance(kind: Workout['kind'], minutes: number, tss: number, wide = false): { minutes: number; tss: number } {
  const share = wide ? 0.15 : kind === 'ride' ? 0.12 : 0.15;
  return { minutes: Math.max(wide ? 15 : 10, minutes * share), tss: Math.max(8, tss * share) };
}

/** "Mobility: after the long ride (12 min)" → "Mobility: after the long ride"; "Reston easy run 30 min" → "Reston easy run". */
const stem = (name: string) => name.replace(/\s*\(\d+ min\)$/, '').replace(/\s+\d+(:\d\d)?\s*(min)?$/i, '').trim();

/**
 * What a session is, apart from its size: rides by family; walks by band (and,
 * for the re-check, pack); runs and mobility by name. When the plan picks a
 * walk, the pack is left to the load: a plan whose pack grows through a block
 * steps through the Library's 15, 20 and 30 lb walks. For the re-check a walk
 * with a different pack is a different session for the rider.
 */
function sameShape(a: Workout, b: Workout, comparePack = true): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'ride') return a.family === b.family;
  if (a.kind === 'walk') {
    const x = a.walk, y = b.walk;
    if (!x || !y) return false;
    if ((x.zoneLow ?? -1) !== (y.zoneLow ?? -1) || (x.zoneHigh ?? -1) !== (y.zoneHigh ?? -1)) return false;
    if (!comparePack) return true;
    if (!x.packKg !== !y.packKg) return false;
    return !x.packKg || Math.abs(x.packKg - (y.packKg ?? 0)) <= 2;
  }
  if (a.kind === 'run' || a.kind === 'mobility') return stem(a.name) === stem(b.name);
  return false;
}

/**
 * Whether two sessions are, for the rider, the same session: the same workout,
 * or the same name, or the same shape within the tolerance. `wide` (beyond the
 * next two weeks) allows 15 minutes / 15%.
 */
export function sameWithin(before: Workout, after: Workout, wide = false): boolean {
  // A strength session at another level is a different session for the rider (30 Oct 2026).
  if (before.kind === 'strength' && after.kind === 'strength' && (before.strength?.dose ?? '') !== (after.strength?.dose ?? '') && before.strength && after.strength) return false;
  if (before.id === after.id || before.name === after.name) return true;
  if (before.kind === 'strength' || !sameShape(before, after)) return false;
  const b = sizeOf(before), a = sizeOf(after);
  const tol = tolerance(before.kind, b.minutes, b.tss, wide);
  return Math.abs(a.minutes - b.minutes) <= tol.minutes && Math.abs(a.tss - b.tss) <= tol.tss;
}

const readyCache = new Map<string, Workout[]>();
function readyFor(eq: Equipment[]): Workout[] {
  const k = [...eq].sort().join(',');
  if (!readyCache.has(k)) readyCache.set(k, readyMadeSessions(eq));
  return readyCache.get(k)!;
}

export interface SnapOptions {
  basis: Basis;
  /** The rider's own saved workouts, offered alongside the Library. */
  extra?: Workout[];
  /** For walks, runs and mobility: the rider's equipment, which decides the ready-made sessions. */
  equipment?: Equipment[];
}

/** The Library sessions that could carry a generated one. Indoor sessions take any ride; outdoor sessions take outdoor-shaped or core rides, never trainer-only ones. */
function candidates(w: Workout, opts: SnapOptions): Workout[] {
  if (w.kind === 'ride') {
    const pool = [...(opts.extra ?? []).filter((x) => x.kind === 'ride'), ...LIBRARY];
    // Openers are a session of their own (short efforts the day before an event), not just a short
    // recovery ride: they are carried by a Library ride that is openers, whatever its length.
    const openers = (x: Workout) => x.name === 'Openers' || x.subtitle === 'Openers';
    // Openers are power-only wherever they come from (one-minute efforts cannot be held by heart rate), so the
    // basis does not restrict them: the planner's own would be power-only too.
    return pool.filter((x) => x.family === w.family && openers(x) === openers(w) && (openers(w) || x.bases.includes(opts.basis)) && (w.setting !== 'outdoor' || x.setting !== 'indoor'));
  }
  const ready = readyFor(opts.equipment ?? ['bodyweight']);
  return [...(opts.extra ?? []), ...ready].filter((x) => x.kind === w.kind);
}

/**
 * The nearest Library workout (or the rider's own) of the same kind, by the sum
 * of the minutes and load distances, each over the tolerance scale so the two
 * count alike. Always the nearest, however far: the plan never creates a
 * workout. Null only when there is no candidate at all (a heart-rate rider and a
 * family with no ride that works by heart rate); the caller then keeps its own
 * session for that day and says so. Strength is never snapped.
 */
export function snap(w: Workout, opts: SnapOptions): Workout | null {
  if (w.kind === 'strength' || w.kind === 'other') return null;
  const me = sizeOf(w);
  const tol = tolerance(w.kind, me.minutes, me.tss);
  let best: Workout | null = null, bestD = Infinity;
  for (const c of candidates(w, opts)) {
    if (w.kind !== 'ride' && !sameShape(w, c, false)) continue;
    const s = sizeOf(c);
    const d = Math.abs(s.minutes - me.minutes) / tol.minutes + Math.abs(s.tss - me.tss) / tol.tss;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Whether the chosen workout is a poor fit for what the plan wanted: more than 25% off in length or load. */
export function poorFit(wanted: Workout, chosen: Workout): boolean {
  const a = sizeOf(wanted), b = sizeOf(chosen);
  const off = (x: number, y: number) => x > 0 && Math.abs(y - x) / x > 0.25;
  return off(a.minutes, b.minutes) || off(a.tss, b.tss);
}
