import { APP_NAME } from '../appName';
import { db, getSetting, setSetting, untracked, type Settings, type Tombstone } from './db';
import { readBackupNote, writeBackupNote, type IntervalsCredentials } from '../sync/intervals';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';

/**
 * Sync across the rider's devices, with no server: the private note in the
 * rider's own Intervals.icu calendar (31 Dec 2099) holds the app's own data —
 * profile, settings, plans, calendar entries, workouts — and every install
 * merges with it. The newest change per record wins (every write stamps
 * `updatedAt`), deletions carry as tombstones, and whatever this device has
 * that the note lacks is written back. The note is also the backup a new
 * device restores from, so there is nothing to set up beyond connecting
 * Intervals.icu on each device.
 */
export interface SyncDoc {
  app: string;
  schema: 2;
  exportedAt: string;
  device?: string;
  profile: (Profile & { id: 'me' }) | undefined;
  settings: Settings[];
  workouts: Workout[];
  planned: PlannedWorkout[];
  tombstones: Tombstone[];
  /** Present on schema-1 (backup-only) notes written by older builds. */
  sync?: unknown[];
}

/** Settings that belong to one device, or come from Intervals.icu anyway. */
const LOCAL_ONLY = new Set(['powerCurve', 'lastAutoBackup', 'lastBackup', 'deviceSync', 'deviceId']);
const TOMBSTONE_DAYS = 120;

export interface DeviceSyncState { last?: string; pushed?: string; error?: string; device?: string }

export async function deviceId(): Promise<string> {
  let id = await getSetting<string | null>('deviceId', null);
  if (!id) {
    const ua = navigator.userAgent;
    const kind = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device';
    id = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
    await setSetting('deviceId', id);
  }
  return id;
}

export async function localDoc(): Promise<SyncDoc> {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
  return {
    app: APP_NAME,
    schema: 2,
    exportedAt: new Date().toISOString(),
    device: await deviceId(),
    profile: await db.profile.get('me'),
    settings: (await db.settings.toArray()).filter((s) => !LOCAL_ONLY.has(s.key)),
    workouts: await db.workouts.toArray(),
    planned: await db.planned.toArray(),
    tombstones: (await db.tombstones.toArray()).filter((t) => t.at >= cutoff),
  };
}

const t = (s?: string) => (s ? Date.parse(s) : 0);

/**
 * Merge a remote document into this device. Returns how many records changed
 * here and whether anything here is newer than, or missing from, the remote.
 */
export async function mergeRemote(remote: SyncDoc): Promise<{ applied: number; localNewer: boolean }> {
  let applied = 0;
  let localNewer = false;
  const remoteTomb = new Map((remote.tombstones ?? []).map((x) => [x.id, x.at]));
  const localTomb = new Map((await db.tombstones.toArray()).map((x) => [x.id, x.at]));

  await untracked(() => db.transaction('rw', [db.profile, db.settings, db.workouts, db.planned, db.tombstones], async () => {
    // Tombstones: union; a remote tombstone newer than a local record deletes it.
    for (const [id, at] of remoteTomb) {
      const have = localTomb.get(id);
      if (!have || have < at) { await db.tombstones.put({ id, at }); localTomb.set(id, at); }
    }
    for (const [id, at] of localTomb) if (!remoteTomb.has(id) || remoteTomb.get(id)! < at) localNewer = true;

    const mergeTable = async <R extends { updatedAt?: string }>(name: string, table: { get: (k: string) => Promise<R | undefined>; put: (r: R) => Promise<unknown>; delete: (k: string) => Promise<void>; toArray: () => Promise<R[]> }, remoteRows: R[], keyOf: (r: R) => string) => {
      const remoteKeys = new Set<string>();
      for (const r of remoteRows) {
        const key = keyOf(r);
        remoteKeys.add(key);
        const tomb = localTomb.get(`${name}:${key}`);
        if (tomb && t(tomb) >= t(r.updatedAt)) continue;           // deleted here after the remote wrote it
        const mine = await table.get(key);
        if (!mine) { await table.put(r); applied++; continue; }
        if (t(r.updatedAt) > t(mine.updatedAt)) { await table.put(r); applied++; }
        else if (t(mine.updatedAt) > t(r.updatedAt)) localNewer = true;
        else if (JSON.stringify(mine) !== JSON.stringify(r)) localNewer = true;   // both unstamped (older builds) and different: this device's copy goes up
      }
      for (const mine of await table.toArray()) {
        const key = keyOf(mine);
        if (remoteKeys.has(key)) continue;
        const tomb = remoteTomb.get(`${name}:${key}`);
        if (tomb && t(tomb) >= t(mine.updatedAt)) { await table.delete(key); applied++; }
        else localNewer = true;                                      // made here, not yet in the note
      }
    };

    if (remote.profile) {
      const mine = await db.profile.get('me');
      if (!mine || t(remote.profile.updatedAt) > t(mine.updatedAt)) { await db.profile.put(remote.profile); applied++; }
      else if (t(mine.updatedAt) > t(remote.profile.updatedAt) || (!mine.updatedAt && JSON.stringify(mine) !== JSON.stringify(remote.profile))) localNewer = true;
    } else if (await db.profile.get('me')) localNewer = true;
    await mergeTable<Settings>('settings', db.settings, (remote.settings ?? []).filter((s) => !LOCAL_ONLY.has(s.key)), (s) => s.key);
    await mergeTable<Workout>('workouts', db.workouts, remote.workouts ?? [], (w) => w.id);
    await mergeTable<PlannedWorkout>('planned', db.planned, remote.planned ?? [], (p) => p.id);
  }));
  return { applied, localNewer };
}

// ---- transport: the note, gzip + base64 ----
async function gzipBase64(text: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') return 'raw:' + btoa(unescape(encodeURIComponent(text)));
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return 'gz:' + btoa(bin);
}
async function gunzipBase64(payload: string): Promise<string> {
  if (payload.startsWith('raw:')) return decodeURIComponent(escape(atob(payload.slice(4))));
  const bin = atob(payload.replace(/^gz:/, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

export async function readRemote(c: IntervalsCredentials): Promise<SyncDoc | null> {
  const note = await readBackupNote(c);
  if (!note) return null;
  const text = await gunzipBase64(note.payload);
  const doc = JSON.parse(text) as SyncDoc;
  if (!doc.tombstones) doc.tombstones = [];
  return doc;
}

export async function writeRemote(c: IntervalsCredentials): Promise<SyncDoc> {
  const doc = await localDoc();
  await writeBackupNote(c, await gzipBase64(JSON.stringify(doc)));
  return doc;
}

let running: Promise<DeviceSyncState> | null = null;
let listeners: Array<() => void> = [];
/** Screens re-read after a merge changed something here. */
export function onDeviceSync(fn: () => void): () => void { listeners.push(fn); return () => { listeners = listeners.filter((l) => l !== fn); }; }

/**
 * One round: read the note, merge it in, write back if this device has
 * anything newer. Concurrent calls share one round. Never throws; the state is
 * kept under the `deviceSync` setting for Settings to show.
 */
export function syncDevices(c: IntervalsCredentials): Promise<DeviceSyncState> {
  if (running) return running;
  running = (async () => {
    const prev = (await getSetting<DeviceSyncState | null>('deviceSync', null)) ?? {};
    try {
      const remote = await readRemote(c);
      let applied = 0, push = true, from: string | undefined;
      if (remote) {
        const r = await mergeRemote(remote);
        applied = r.applied; push = r.localNewer; from = remote.device;
      }
      const now = new Date().toISOString();
      const state: DeviceSyncState = { last: now, pushed: prev.pushed, device: from };
      if (push) { await writeRemote(c); state.pushed = now; }
      await setSetting('deviceSync', state);
      if (applied) listeners.forEach((l) => l());
      return state;
    } catch (e) {
      const state: DeviceSyncState = { ...prev, error: `${new Date().toISOString()} ${(e as Error).message}` };
      await setSetting('deviceSync', state).catch(() => {});
      return state;
    } finally { running = null; }
  })();
  return running;
}

/** A push a few seconds after the last local change, so edits reach the note without a Sync tap. */
let timer: ReturnType<typeof setTimeout> | undefined;
export function schedulePush(getCredentials: () => Promise<IntervalsCredentials | null>, delayMs = 4000): void {
  clearTimeout(timer);
  timer = setTimeout(async () => { const c = await getCredentials(); if (c) syncDevices(c); }, delayMs);
}
