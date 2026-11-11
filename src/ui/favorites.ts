import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PlannedWorkout, Workout } from '../engine/types';
import { getSetting, setSetting } from '../data/db';
import { addDays, today } from '../engine/load';

/**
 * The rider's favourite workouts and what they did recently (9 Nov 2026, "the Library grows up",
 * Part B). Favourites are a setting, so they travel to the rider's other devices with the rest
 * of their settings and never mix with another rider's. A star on a calendar copy of a Library
 * workout stars the Library workout itself.
 */

const KEY = 'libraryFavorites';
/** "Recently done" reaches back this far. */
const RECENT_DAYS = 90;

/** The Library workout a workout stands for: itself, or the one a calendar copy came from. */
export const libraryKey = (w: Pick<Workout, 'id' | 'libraryId'>) => w.libraryId ?? w.id;

let favorites = new Set<string>();
let loaded = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function load(): Promise<void> {
  const v = await getSetting<string[] | null>(KEY, null).catch(() => null);
  const next = new Set(v ?? []);
  const changed = next.size !== favorites.size || [...next].some((x) => !favorites.has(x));
  favorites = next;
  loaded = true;
  if (changed) notify();
}

export function isFavorite(w: Pick<Workout, 'id' | 'libraryId'>): boolean {
  return favorites.has(libraryKey(w));
}

export async function toggleFavorite(w: Pick<Workout, 'id' | 'libraryId'>): Promise<void> {
  const k = libraryKey(w);
  favorites = new Set(favorites);
  if (favorites.has(k)) favorites.delete(k); else favorites.add(k);
  notify();
  await setSetting(KEY, [...favorites]).catch(() => {});
}

/**
 * The favourites, kept current. `refresh` is anything that changes when a sync may have brought
 * another device's stars (the app's data), so the set is read again then.
 */
export function useFavorites(refresh?: unknown): Set<string> {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => { void load(); }, [refresh]);
  return loaded ? favorites : new Set();
}

/** When each Library workout was last done, from the calendar's completed sessions in the last 90 days. */
export function recentlyDone(planned: PlannedWorkout[], find: (id: string) => Workout | undefined, now = today(), days = RECENT_DAYS): Map<string, string> {
  const since = addDays(now, -days);
  const out = new Map<string, string>();
  for (const p of planned) {
    if (p.status !== 'completed' || p.date < since || p.date > now) continue;
    const w = find(p.workoutId);
    const k = w ? libraryKey(w) : p.workoutId;
    if ((out.get(k) ?? '') < p.date) out.set(k, p.date);
  }
  return out;
}

/** Favourites and recent together, as the filters take them. */
export function useMine(planned: PlannedWorkout[], find: (id: string) => Workout | undefined, refresh?: unknown) {
  const fav = useFavorites(refresh);
  const recent = useMemo(() => recentlyDone(planned, find), [planned]); // eslint-disable-line react-hooks/exhaustive-deps
  // When each was last done at any time, for the Last done sort (10 Nov 2026).
  const last = useMemo(() => recentlyDone(planned, find, today(), 365 * 50), [planned]); // eslint-disable-line react-hooks/exhaustive-deps
  return { favorites: fav, recent, last };
}

/** The star itself: on any workout card or page. */
export function starLabel(on: boolean, name: string): string {
  return on ? `Remove ${name} from favorites` : `Add ${name} to favorites`;
}
