import { useEffect, useState } from 'preact/hooks';
import { db, loadProfile } from '../data/db';
import type { PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';

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

export function allWorkouts(mine: Workout[]): Workout[] {
  return [...mine, ...LIBRARY];
}

export function findWorkout(mine: Workout[], id: string): Workout | undefined {
  return mine.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id);
}
