import { db, type PowerCurve } from '../data/db';
import { CURVE_SECONDS, meanMaxPower } from '../engine/progress';
import { hrAtPower, steadyAtHr } from '../engine/hrPower';
import { judgeSession } from '../engine/sessionVerdict';
import { addDays, today } from '../engine/load';
import type { Basis, Profile, Ride, Workout } from '../engine/types';
import { fetchPowerStream } from '../sync/intervals';
import { credentials } from '../sync/syncService';

/**
 * Builds the per-ride cache: for every ride with power, its mean-maximal curve and (Step 2b, 30 Oct 2026)
 * heart rate alongside power: time and heart rate in each power band, power at a steady heart rate, and,
 * for a planned hard session, how it went. Read from the full recording if this device has it, else a
 * time, watts and heart-rate download. Rides without a record come first, newest first; records from before
 * heart rate was kept (no `v: 2`) are re-read once after them, the last 16 weeks first. One ride at a time.
 * `onProgress` reports done/total; a second call while one runs joins it.
 */
export const CURVE_VERSION = 2;

export interface CurveContext {
  profile: Profile;
  /** The planned session a recording was matched to, if any. */
  sessionOf: (rideId: string) => { workout: Workout; basis: Basis } | undefined;
}

export interface CurveProgress { done: number; total: number; error?: string; rebuilding?: boolean }
let running: Promise<void> | null = null;
const listeners = new Set<(p: CurveProgress) => void>();
let last: CurveProgress | null = null;

export function buildPowerCurves(rides: Ride[], onProgress: (p: CurveProgress) => void, ctx?: CurveContext): () => void {
  listeners.add(onProgress);
  if (!running) running = run(rides, ctx).finally(() => { running = null; });
  else if (last) onProgress(last);
  return () => listeners.delete(onProgress);
}

/** Follow a build already under way (Settings > History), without starting one. */
export function watchPowerCurves(onProgress: (p: CurveProgress) => void): () => void {
  listeners.add(onProgress);
  if (running && last) onProgress(last);
  return () => listeners.delete(onProgress);
}

async function run(rides: Ride[], ctx?: CurveContext): Promise<void> {
  const emit = (p: CurveProgress) => { last = p; listeners.forEach((l) => l(p)); };
  const have = new Map((await db.powerCurves.toArray()).map((c) => [c.id, c]));
  const recent = addDays(today(), -16 * 7);
  const withPower = rides.filter((r) => r.sport === 'ride' && (r.normalizedPower || r.averagePower));
  const missing = withPower.filter((r) => !have.has(r.id)).sort((a, b) => b.date.localeCompare(a.date));
  // Re-read once: records from before heart rate was kept, and records whose ride has since been matched to a planned session.
  const stale = ctx ? withPower.filter((r) => { const c = have.get(r.id); return !!c && (c.v !== CURVE_VERSION || (!c.judged && !!ctx.sessionOf(r.id))); })
    .sort((a, b) => Number(b.date >= recent) - Number(a.date >= recent) || b.date.localeCompare(a.date)) : [];
  const todo = [...missing, ...stale];
  const rebuilding = stale.length > 0;
  if (!todo.length) { emit({ done: 0, total: 0 }); return; }
  const c = await credentials();
  let done = 0;
  emit({ done, total: todo.length, rebuilding });
  for (const r of todo) {
    try {
      const full = await db.streams.get(r.id);
      const s = full?.watts ? { time: full.time, watts: full.watts, heartrate: full.heartrate } : c ? await fetchPowerStream(c, r.id) : null;
      if (!s) { emit({ done, total: todo.length, rebuilding, error: 'Connect Intervals.icu to read your rides.' }); return; }
      await db.powerCurves.put(curveRecord(r, s, ctx));
    } catch (e) {
      emit({ done, total: todo.length, rebuilding, error: (e as Error).message });
      return;
    }
    done++;
    emit({ done, total: todo.length, rebuilding });
  }
}

/** One ride's record. Pure apart from the context's lookups. */
export function curveRecord(r: Pick<Ride, 'id' | 'date'>, s: { time: number[]; watts?: number[]; heartrate?: number[] }, ctx?: CurveContext): PowerCurve {
  const w = s.watts?.length ? meanMaxPower(s.time, s.watts, CURVE_SECONDS) : CURVE_SECONDS.map(() => 0);
  if (!ctx) return { id: r.id, date: r.date, w };
  const p = ctx.profile;
  const bands = hrAtPower(s.time, s.watts, s.heartrate, p.ftp);
  const steady = steadyAtHr(s.time, s.watts, s.heartrate, p.lthr);
  const session = ctx.sessionOf(r.id);
  const verdict = session ? judgeSession(session.workout, p, session.basis, s.time, s.watts, s.heartrate) : undefined;
  return {
    id: r.id, date: r.date, w, v: CURVE_VERSION, ftpAtBuild: p.ftp, lthrAtBuild: p.lthr,
    ...(bands.length ? { hrAtPower: bands } : {}), ...(steady ? { steadyAtHr: steady } : {}),
    ...(verdict ? { verdict } : {}), ...(session ? { judged: true } : {}),
  };
}

/** What the cache needs from the app's data: the profile, and each recording's planned session. */
export function curveContext(profile: Profile | null | undefined, planned: Array<{ activityId?: string; workoutId: string; basis: Basis }>, find: (id: string) => Workout | undefined): CurveContext | undefined {
  if (!profile) return undefined;
  const byActivity = new Map(planned.filter((p) => p.activityId).map((p) => [p.activityId!, p]));
  return { profile, sessionOf: (id) => { const p = byActivity.get(id); const w = p ? find(p.workoutId) : undefined; return p && w && w.kind === 'ride' ? { workout: w, basis: p.basis } : undefined; } };
}
