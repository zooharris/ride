import Dexie, { type Table } from 'dexie';
import type { DayNote, PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';

export interface Settings {
  key: string;
  value: unknown;
  updatedAt?: string;
}

/** A record deleted on this device, so the deletion carries to the rider's other devices. */
export interface Tombstone {
  id: string;               // `${table}:${primary key}`
  at: string;               // ISO
}

export interface StreamSet {
  id: string;               // activity id
  v?: number;               // stream-set version; older cached sets are refetched for the fields they lack
  time: number[];           // seconds from start
  watts?: number[];
  heartrate?: number[];
  cadence?: number[];
  distance?: number[];      // metres from start
  altitude?: number[];      // metres
  velocity?: number[];      // metres per second
  temp?: number[];          // °C
  lat?: number[];
  lng?: number[];
  intervals?: Array<{ label?: string; type?: string; start: number; end: number; avgWatts?: number; avgHr?: number }>;
}
export const STREAMS_VERSION = 2;

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
  workouts!: Table<Workout, string>;        // source 'mine' (hand-built) and 'generated' (plan or ready-made copies); the library is code
  planned!: Table<PlannedWorkout, string>;
  rides!: Table<Ride, string>;
  wellness!: Table<Wellness, string>;
  sync!: Table<SyncState, string>;
  streams!: Table<StreamSet, string>;
  tombstones!: Table<Tombstone, string>;
  dayNotes!: Table<DayNote, string>;

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
    this.version(3).stores({ tombstones: 'id' });
    this.version(4).stores({ dayNotes: 'date' });
  }
}

export const db = new RideDb();

/**
 * Change tracking for the sync across devices: every write to the app's own
 * tables stamps `updatedAt`, every delete leaves a tombstone. Records arriving
 * from another device are applied inside `untracked()` so their own stamps
 * survive and no tombstones are made for the clean-up they do.
 */
let tracking = true;
export async function untracked<T>(fn: () => Promise<T>): Promise<T> {
  const was = tracking;
  tracking = false;
  try { return await fn(); } finally { tracking = was; }
}
const TRACKED = ['profile', 'settings', 'workouts', 'planned', 'dayNotes'] as const;
for (const name of TRACKED) {
  const table = db.table(name);
  table.hook('creating', function (_pk, obj: { updatedAt?: string }) { if (tracking) obj.updatedAt = new Date().toISOString(); });
  table.hook('updating', function (mods: { updatedAt?: string }) { return tracking && !('updatedAt' in mods) ? { updatedAt: new Date().toISOString() } : undefined; });
  table.hook('deleting', function (pk) {
    if (!tracking) return;
    const at = new Date().toISOString();
    Dexie.ignoreTransaction(() => db.tombstones.put({ id: `${name}:${String(pk)}`, at }).catch(() => {}));
  });
}

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
