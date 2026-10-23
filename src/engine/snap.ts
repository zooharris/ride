import type { Basis, Workout } from './types';
import { workoutStats } from './workout';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { SPARE_NAMES } from '../library/names';
import type { Equipment } from './types';

/**
 * Library-first plans (Batch 6, Part B, 23 Oct 2026). The planner still decides
 * what a session is from the rider's data (type, length, progression); this
 * picks the Library workout that carries it out, so the calendar shows named
 * workouts the rider can find, re-add and swap, and a re-check that rebuilds the
 * plan lands on the same names instead of moving rides by a few minutes.
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

/** What a session is, apart from its size: rides by family; walks by band and pack; runs and mobility by name. */
function sameShape(a: Workout, b: Workout): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'ride') return a.family === b.family;
  if (a.kind === 'walk') {
    const x = a.walk, y = b.walk;
    if (!x || !y) return false;
    if ((x.zoneLow ?? -1) !== (y.zoneLow ?? -1) || (x.zoneHigh ?? -1) !== (y.zoneHigh ?? -1)) return false;
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
  /** The rider's own rides and the plan-made entries, offered alongside the Library. */
  extra?: Workout[];
  /** For walks, runs and mobility: the rider's equipment, which decides the ready-made sessions. */
  equipment?: Equipment[];
}

/** The Library sessions that could carry a generated one. Indoor sessions take any ride; outdoor sessions take outdoor-shaped or core rides, never trainer-only ones. */
function candidates(w: Workout, opts: SnapOptions): Workout[] {
  if (w.kind === 'ride') {
    const pool = [...(opts.extra ?? []).filter((x) => x.kind === 'ride'), ...LIBRARY];
    return pool.filter((x) => x.family === w.family && x.bases.includes(opts.basis) && (w.setting !== 'outdoor' || x.setting !== 'indoor'));
  }
  const ready = readyFor(opts.equipment ?? ['bodyweight']);
  return [...(opts.extra ?? []), ...ready].filter((x) => x.kind === w.kind);
}

/**
 * The nearest Library workout within the tolerance, by the sum of the minutes
 * and load distances (each over its tolerance), or null when nothing is close
 * enough (the caller keeps the generated session and adds it to the Library).
 * Openers keep their generated session; strength is never snapped.
 */
export function snap(w: Workout, opts: SnapOptions): Workout | null {
  if (w.kind === 'strength' || w.kind === 'other' || /^Openers$/.test(w.name)) return null;
  const me = sizeOf(w);
  const tol = tolerance(w.kind, me.minutes, me.tss);
  let best: Workout | null = null, bestD = Infinity;
  for (const c of candidates(w, opts)) {
    if (w.kind !== 'ride' && !sameShape(w, c)) continue;
    const s = sizeOf(c);
    const dm = Math.abs(s.minutes - me.minutes), dt = Math.abs(s.tss - me.tss);
    if (dm > tol.minutes || dt > tol.tss) continue;
    const d = dm / tol.minutes + dt / tol.tss;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * A session the Library could not carry becomes a Library entry of its own, so
 * it is never a one-off: reused when the same intent comes back (within the
 * tolerance), stored with My Workouts and tagged plan-made. A ride gets a place
 * name from the spare list by its kind (long and endurance rides the trail
 * towns, interval rides the roads and landmarks, easy rides the local loops)
 * and keeps its descriptive name as the subtitle; when the names run out it
 * keeps its descriptive name. Other kinds keep their own descriptive names.
 */
export function planMadeEntry(w: Workout, own: Workout[]): { entry: Workout; isNew: boolean } {
  const existing = own.find((e) => e.planMade && e.kind === w.kind && sameShape(e, w) && sameWithin(e, w));
  if (existing) return { entry: existing, isNew: false };
  const size = sizeOf(w);
  const base = `lib-gen-${w.kind === 'ride' ? w.family : w.kind}-${Math.round(size.minutes)}`;
  const ids = new Set(own.map((e) => e.id));
  let id = base;
  for (let k = 2; ids.has(id); k++) id = `${base}-${k}`;
  let name = w.name, subtitle = w.subtitle;
  if (w.kind === 'ride') {
    const taken = new Set([...own.map((e) => e.name), ...LIBRARY.map((e) => e.name)]);
    const group = w.family === 'endurance' ? 'long' : w.family === 'recovery' ? 'easy' : 'interval';
    const order = [group, ...(['long', 'interval', 'easy'] as const).filter((g) => g !== group)] as Array<keyof typeof SPARE_NAMES>;
    const place = order.flatMap((g) => SPARE_NAMES[g]).find((n) => !taken.has(n));
    if (place) { name = place; subtitle = w.name; }
  }
  return { entry: { ...w, id, name, subtitle, source: 'mine', planMade: true }, isNew: true };
}
