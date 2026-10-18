import Dexie, { type Table } from 'dexie';
import type { PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';

export interface Settings {
  key: string;
  value: unknown;
}

export interface StreamSet {
  id: string;               // activity id
  time: number[];           // seconds from start
  watts?: number[];
  heartrate?: number[];
  cadence?: number[];
  intervals?: Array<{ label?: string; type?: string; start: number; end: number; avgWatts?: number; avgHr?: number }>;
}

export interface SyncState {
  key: 'intervals';
  athleteId: string;
  lastActivitySync?: string;   // ISO
  lastWellnessSync?: string;
  lastError?: string;
}

/**
 * IndexedDB schema. Version it; never rename a store without a migration.
 * Rides and wellness are a cache of Intervals.icu and can be re-pulled; the rest
 * is the app's own data and is what the backup file carries.
 */
class RideDb extends Dexie {
  profile!: Table<Profile & { id: 'me' }, string>;
  settings!: Table<Settings, string>;
  workouts!: Table<Workout, string>;        // only source === 'mine'; the library is code
  planned!: Table<PlannedWorkout, string>;
  rides!: Table<Ride, string>;
  wellness!: Table<Wellness, string>;
  sync!: Table<SyncState, string>;
  streams!: Table<StreamSet, string>;

  constructor() {
    super('ride');
    this.version(1).stores({
      profile: 'id',
      settings: 'key',
      workouts: 'id, family, source',
      planned: 'id, date, workoutId, status',
      rides: 'id, date',
      wellness: 'date',
      sync: 'key',
    });
    this.version(2).stores({ streams: 'id' });
  }
}

export const db = new RideDb();

// Workouts saved before `setting` existed get the neutral value on read.
db.workouts.hook('reading', (w) => (w ? { ...w, setting: w.setting ?? 'any', kind: w.kind ?? 'ride' } : w));
db.rides.hook('reading', (r) => (r && !r.sport ? { ...r, sport: 'ride' } : r));

export const DEFAULT_PROFILE: Profile = {
  name: '',
  ftp: 200,
  lthr: 155,
  maxHr: 175,
  restingHr: 55,
  weightKg: 75,
  basis: 'power',
  masters: true,
  units: 'imperial',
  rideDays: [0, 2, 4, 6],
  hoursPerWeek: 7,
};

export async function loadProfile(): Promise<Profile | null> {
  const p = await db.profile.get('me');
  if (!p) return null;
  const { id: _id, ...rest } = p;
  return rest;
}

export async function saveProfile(p: Profile): Promise<void> {
  await db.profile.put({ ...p, id: 'me' });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return s ? (s.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
