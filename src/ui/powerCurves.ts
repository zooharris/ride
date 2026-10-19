import { db, type PowerCurve } from '../data/db';
import { CURVE_SECONDS, meanMaxPower } from '../engine/progress';
import type { Ride } from '../engine/types';
import { fetchPowerStream } from '../sync/intervals';
import { credentials } from '../sync/syncService';

/**
 * Builds the power-curve cache: for every ride with power that has no curve
 * yet, read its power (from the full recording if this device already has it,
 * else a time-and-watts-only download) and store its mean-maximal curve. One
 * ride at a time, newest first, so the chart fills in from the recent end.
 * `onProgress` reports done/total; a second call while one runs joins it.
 */
let running: Promise<void> | null = null;
const listeners = new Set<(p: { done: number; total: number; error?: string }) => void>();

export function buildPowerCurves(rides: Ride[], onProgress: (p: { done: number; total: number; error?: string }) => void): () => void {
  listeners.add(onProgress);
  if (!running) running = run(rides).finally(() => { running = null; });
  return () => listeners.delete(onProgress);
}

async function run(rides: Ride[]): Promise<void> {
  const emit = (p: { done: number; total: number; error?: string }) => listeners.forEach((l) => l(p));
  const have = new Set((await db.powerCurves.toCollection().primaryKeys()) as string[]);
  const todo = rides.filter((r) => r.sport === 'ride' && (r.normalizedPower || r.averagePower) && !have.has(r.id)).sort((a, b) => b.date.localeCompare(a.date));
  if (!todo.length) { emit({ done: 0, total: 0 }); return; }
  const c = await credentials();
  let done = 0;
  emit({ done, total: todo.length });
  for (const r of todo) {
    try {
      const full = await db.streams.get(r.id);
      const s = full?.watts ? { time: full.time, watts: full.watts } : c ? await fetchPowerStream(c, r.id) : null;
      if (!s) { emit({ done, total: todo.length, error: 'Connect Intervals.icu to build the power curve.' }); return; }
      const curve: PowerCurve = { id: r.id, date: r.date, w: s.watts?.length ? meanMaxPower(s.time, s.watts, CURVE_SECONDS) : CURVE_SECONDS.map(() => 0) };
      await db.powerCurves.put(curve);
    } catch (e) {
      emit({ done, total: todo.length, error: (e as Error).message });
      return;
    }
    done++;
    emit({ done, total: todo.length });
  }
}
