import type { ActivePlan } from '../ui/planService';
import type { Recording } from '../player/types';
import type { Thumb } from './thumbs';
import Dexie, { type Table } from 'dexie';
import type { DayNote, PlannedWorkout, Profile, Ride, Wellness, Workout, ActivityEdit } from '../engine/types';

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

/** A ride's mean-maximal power at CURVE_SECONDS, computed once from its power stream (a cache; rebuilt if lost). */
export interface PowerCurve {
  id: string;               // activity id
  date: string;
  w: number[];
}

export interface SyncState {
  key: 'intervals';
  athleteId: string;
  lastActivitySync?: string;   // ISO
  lastWellnessSync?: string;
  lastError?: string;
  /** When the latest failed pull happened (ISO); "Last synced" says it failed when this is newer than the last success. */
  lastErrorAt?: string;
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
  powerCurves!: Table<PowerCurve, string>;
  plans!: Table<ActivePlan, string>;
  activityEdits!: Table<ActivityEdit, string>;
  /** Rides recorded by the ride player: this computer only (never in the sync note or a backup), kept until uploaded and 30 days after. */
  recordings!: Table<Recording, string>;
  /** The small pictures of done activities (route shape, effort profile) for the calendar and lists: this device only, rebuilt on demand. */
  thumbs!: Table<Thumb, string>;

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
    this.version(5).stores({ powerCurves: 'id, date' });
    // One record per plan, so devices merge plans one by one instead of one list overwriting another.
    this.version(6).stores({ plans: 'id' });
    // The rider's edits to recorded activities (kind, left out of load, what was done, effort).
    this.version(7).stores({ activityEdits: 'id, date' });
    // Intensity factor was stored as Intervals.icu sends it, a percent (84); the engine reads a fraction (0.84).
    this.version(8).stores({}).upgrade((tx) => tx.table('rides').toCollection().modify((r: { intensityFactor?: number }) => {
      if (r.intensityFactor != null && r.intensityFactor > 3) r.intensityFactor = Math.round(r.intensityFactor) / 100;
    }));
    // Intervals.icu's sweet-spot time was stored as an eighth power zone; it is time already inside zones 3 and 4.
    this.version(9).stores({}).upgrade((tx) => tx.table('rides').toCollection().modify((r: { powerZoneSeconds?: number[]; sweetSpotSeconds?: number }) => {
      if (r.powerZoneSeconds && r.powerZoneSeconds.length > 7) {
        const ss = r.powerZoneSeconds[7];
        if (ss > 0) r.sweetSpotSeconds = ss;
        r.powerZoneSeconds = r.powerZoneSeconds.slice(0, 7);
      }
    }));
    this.version(10).stores({ recordings: 'id, status, startMs' });
    this.version(11).stores({ thumbs: 'id' });
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
const TRACKED = ['profile', 'settings', 'workouts', 'planned', 'dayNotes', 'plans', 'activityEdits'] as const;
for (const name of TRACKED) {
  const table = db.table(name);
  table.hook('creating', function (_pk, obj: { updatedAt?: string }) { if (tracking) obj.updatedAt = new Date().toISOString(); });
  // Dexie lists a key the new object lacks as `updatedAt: undefined`, so the test is for a real stamp,
  // not for the key: a put() of a record built without one must still be stamped, or the other
  // device's older copy wins the next merge.
  table.hook('updating', function (mods: { updatedAt?: string }) { return tracking && typeof mods.updatedAt !== 'string' ? { updatedAt: new Date().toISOString() } : undefined; });
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
  // A changed FTP carries the day it changed (Settings, a sync from Intervals.icu, or a test result), for "set 12 September".
  const before = await db.profile.get('me');
  const stamp = before && before.ftp !== p.ftp && p.ftpSetOn === before.ftpSetOn ? { ftpSetOn: localDay() } : {};
  await db.profile.put({ ...p, ...stamp, id: 'me' });
}

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return s ? (s.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
