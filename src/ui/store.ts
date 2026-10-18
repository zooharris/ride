import { useEffect, useState } from 'preact/hooks';
import { db, getSetting, loadProfile } from '../data/db';
import type { Equipment, PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { newId } from '../engine/workout';

/** A tiny change bus: screens re-read from IndexedDB after any write. */
const listeners = new Set<() => void>();
export function notify(): void { listeners.forEach((l) => l()); }

export interface AppData {
  profile: Profile | null;
  planned: PlannedWorkout[];
  rides: Ride[];
  wellness: Wellness[];
  mine: Workout[];
  loaded: boolean;
}

export function useAppData(): AppData {
  const [data, setData] = useState<AppData>({ profile: null, planned: [], rides: [], wellness: [], mine: [], loaded: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [profile, planned, rides, wellness, mine] = await Promise.all([
        loadProfile(),
        db.planned.toArray(),
        db.rides.orderBy('date').reverse().toArray(),
        db.wellness.orderBy('date').toArray(),
        db.workouts.toArray(),
      ]);
      if (alive) setData({ profile, planned, rides, wellness, mine, loaded: true });
    };
    load();
    listeners.add(load);
    return () => { alive = false; listeners.delete(load); };
  }, []);
  return data;
}

/** Ready-made strength, mobility and walk sessions, built for the equipment the rider told the planner about. */
let readyCache: { key: string; list: Workout[] } = { key: '', list: [] };
export const DEFAULT_EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'outdoor-walk'];
export function readyMade(equipment: Equipment[] = currentEquipment): Workout[] {
  const key = [...equipment].sort().join(',');
  if (readyCache.key !== key) readyCache = { key, list: readyMadeSessions(equipment) };
  return readyCache.list;
}
let currentEquipment: Equipment[] = DEFAULT_EQUIPMENT;
export function setCurrentEquipment(e: Equipment[]): void { if (e.length) currentEquipment = e; }
export function getCurrentEquipment(): Equipment[] { return currentEquipment; }
getSetting<{ availability?: { equipment?: Equipment[] } } | null>('planRequest', null).then((s) => { if (s?.availability?.equipment?.length) setCurrentEquipment(s.availability.equipment); }).catch(() => {});

export function allWorkouts(mine: Workout[]): Workout[] {
  return [...mine, ...LIBRARY, ...readyMade()];
}

export function findWorkout(mine: Workout[], id: string): Workout | undefined {
  return mine.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id) ?? readyMade().find((w) => w.id === id);
}

/**
 * Put a workout on a date. A ready-made session is stored as its own copy
 * first, so the calendar entry keeps exactly what was chosen even if the
 * rider's equipment changes later.
 */
export async function scheduleWorkout(w: Workout, date: string, basis: 'power' | 'hr'): Promise<void> {
  let id = w.id;
  if (w.source === 'library' && w.kind !== 'ride') {
    id = `gen-${newId()}`;
    await db.workouts.put({ ...w, id, source: 'generated' });
  }
  await db.planned.put({ id: newId(), date, workoutId: id, basis: w.bases.includes(basis) ? basis : w.bases[0], status: 'planned' });
  notify();
}
