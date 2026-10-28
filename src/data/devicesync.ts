import { APP_NAME } from '../appName';
import { db, getSetting, setSetting, untracked, type Settings, type Tombstone } from './db';
import { readBackupNote, writeBackupNote, type IntervalsCredentials } from '../sync/intervals';
import type { DayNote, PlannedWorkout, Profile, Workout, ActivityEdit } from '../engine/types';
import type { ActivePlan } from '../ui/planService';
import { decodeSealed, encodeSealed, isSealed, makeLock, newDataKey, open, seal, unlockWithAnswer, unlockWithPassphrase, type LockEnvelope } from './notecrypto';

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
  /** Absent in notes written before day notes existed. */
  dayNotes?: DayNote[];
  /** One record per plan. Absent in notes written before plans had their own table (they travelled as the `plans` setting). */
  plans?: ActivePlan[];
  /** Absent in notes written before activity edits existed. */
  activityEdits?: ActivityEdit[];
  tombstones: Tombstone[];
  /** Present on schema-1 (backup-only) notes written by older builds. */
  sync?: unknown[];
}

/** Settings that belong to one device, or come from Intervals.icu anyway. */
const LOCAL_ONLY = new Set(['powerCurve', 'lastAutoBackup', 'lastBackup', 'deviceSync', 'deviceId', 'noteKey', 'noteLock', 'coachChat', 'historyLoadedFrom', 'scoringRules', 'progressOverlays', 'chartChat', 'retargetLog', 'coachRecheck', 'playerDevices', 'playerSim', 'playerSound', 'playerAutoPause', 'playerGuard', 'playerSmoothing', 'playerSlots']);
/**
 * Secrets never leave the device in the sync note: the Intervals.icu key and the
 * Claude key are pasted once on each device. A file backup may carry them, at
 * the rider's choice, so a restore from file is one step.
 */
export const SECRET_SETTINGS = new Set(['intervals', 'claudeKey']);
const inNote = (s: Settings) => !LOCAL_ONLY.has(s.key) && !SECRET_SETTINGS.has(s.key);
const TOMBSTONE_DAYS = 120;

export interface DeviceSyncState {
  last?: string; pushed?: string; error?: string; device?: string;
  /** The note in Intervals.icu is encrypted and this device cannot open it; the question is shown so the rider can unlock. */
  locked?: { question: string; at: string };
}

/** Thrown by readRemote when the note is encrypted and this device holds no key that opens it. */
export class NoteLockedError extends Error {
  constructor(public question: string, public lock: LockEnvelope) { super('The note in Intervals.icu is encrypted; unlock it in Settings with your passphrase or by answering your question.'); }
}

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

export async function localDoc(opts: { withSecrets?: boolean } = {}): Promise<SyncDoc> {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
  const keep = opts.withSecrets ? (s: Settings) => !LOCAL_ONLY.has(s.key) : inNote;
  return {
    app: APP_NAME,
    schema: 2,
    exportedAt: new Date().toISOString(),
    device: await deviceId(),
    profile: await db.profile.get('me'),
    settings: (await db.settings.toArray()).filter(keep),
    workouts: await db.workouts.toArray(),
    planned: await db.planned.toArray(),
    dayNotes: await db.dayNotes.toArray(),
    plans: await db.plans.toArray(),
    activityEdits: await db.activityEdits.toArray(),
    tombstones: (await db.tombstones.toArray()).filter((t) => t.at >= cutoff),
  };
}

const t = (s?: string) => (s ? Date.parse(s) : 0);

/**
 * Merge a remote document into this device. Returns how many records changed
 * here and whether anything here is newer than, or missing from, the remote.
 */
/**
 * A calendar entry's completion is a fact (a recording was paired, or the rider
 * logged it); "missed", "sent" and "planned" are states a device works out for
 * itself, so a device that marked a session missed before it heard that another
 * device had completed it must not win on its newer stamp. The completion wins
 * unless the other side is an explicit undo by the rider: the recording refused
 * ("This was a different workout", which lists it in notActivityIds) or a
 * hand-logged completion taken back (undoneAt), and that undo is the newer change.
 */
export function completionWins(mine: PlannedWorkout, remote: PlannedWorkout): 'mine' | 'remote' | undefined {
  const done = (p: PlannedWorkout) => p.status === 'completed';
  if (done(mine) === done(remote)) return undefined;
  const [winner, other] = done(mine) ? [mine, remote] : [remote, mine];
  const refused = !!winner.activityId && !!other.notActivityIds?.includes(winner.activityId);
  const undone = !!other.undoneAt && t(other.undoneAt) > t(winner.updatedAt);
  if ((refused || undone) && t(other.updatedAt) > t(winner.updatedAt)) return winner === mine ? 'remote' : 'mine';
  return winner === mine ? 'mine' : 'remote';
}

export async function mergeRemote(remote: SyncDoc): Promise<{ applied: number; localNewer: boolean }> {
  let applied = 0;
  let localNewer = false;
  const remoteTomb = new Map((remote.tombstones ?? []).map((x) => [x.id, x.at]));
  const localTomb = new Map((await db.tombstones.toArray()).map((x) => [x.id, x.at]));

  await untracked(() => db.transaction('rw', [db.profile, db.settings, db.workouts, db.planned, db.dayNotes, db.plans, db.activityEdits, db.tombstones], async () => {
    // Tombstones: union; a remote tombstone newer than a local record deletes it.
    for (const [id, at] of remoteTomb) {
      const have = localTomb.get(id);
      if (!have || have < at) { await db.tombstones.put({ id, at }); localTomb.set(id, at); }
    }
    for (const [id, at] of localTomb) if (!remoteTomb.has(id) || remoteTomb.get(id)! < at) localNewer = true;

    // Plans, calendar entries and workouts have ids that are never reused: once deleted, an id stays
    // deleted, whatever a device that had not heard of the deletion later wrote to its copy (an old
    // build re-checking a plan it still had brought a deleted plan back, 20 Oct 2026). Settings,
    // day notes and the like are keyed by names and dates that can be written again, so there the
    // newest change still wins.
    const FOREVER = new Set(['plans', 'planned', 'workouts']);
    const mergeTable = async <R extends { updatedAt?: string }>(name: string, table: { get: (k: string) => Promise<R | undefined>; put: (r: R) => Promise<unknown>; delete: (k: string) => Promise<void>; toArray: () => Promise<R[]> }, remoteRows: R[], keyOf: (r: R) => string, local: (r: R) => boolean = () => true) => {
      const remoteKeys = new Set<string>();
      for (const r of remoteRows) {
        const key = keyOf(r);
        remoteKeys.add(key);
        const tomb = localTomb.get(`${name}:${key}`);
        // A record restored from a backup after it was deleted comes back; nothing else does.
        const restoredAfter = (row: R, at: string) => t((row as { restoredAt?: string }).restoredAt) > t(at);
        if (tomb && FOREVER.has(name) && restoredAfter(r, tomb)) { await db.tombstones.delete(`${name}:${key}`); localTomb.delete(`${name}:${key}`); }
        else if (tomb && (FOREVER.has(name) || t(tomb) >= t(r.updatedAt))) { if (FOREVER.has(name)) localNewer = true; continue; }   // deleted here
        const mine = await table.get(key);
        if (!mine) { await table.put(r); applied++; continue; }
        const verdict = name === 'planned' ? completionWins(mine as unknown as PlannedWorkout, r as unknown as PlannedWorkout) : undefined;
        if (verdict === 'remote' || (verdict == null && t(r.updatedAt) > t(mine.updatedAt))) { await table.put(r); applied++; }
        else if (verdict === 'mine' || t(mine.updatedAt) > t(r.updatedAt)) localNewer = true;
        else if (JSON.stringify(mine) !== JSON.stringify(r)) localNewer = true;   // both unstamped (older builds) and different: this device's copy goes up
      }
      for (const mine of (await table.toArray()).filter(local)) {
        const key = keyOf(mine);
        if (remoteKeys.has(key)) continue;
        const tomb = remoteTomb.get(`${name}:${key}`);
        const restored = t((mine as { restoredAt?: string }).restoredAt) > t(tomb);
        if (tomb && !restored && (FOREVER.has(name) || t(tomb) >= t(mine.updatedAt))) { await table.delete(key); applied++; }
        else localNewer = true;                                      // made here, not yet in the note
      }
    };

    if (remote.profile) {
      const mine = await db.profile.get('me');
      if (!mine || t(remote.profile.updatedAt) > t(mine.updatedAt)) { await db.profile.put(remote.profile); applied++; }
      else if (t(mine.updatedAt) > t(remote.profile.updatedAt) || (!mine.updatedAt && JSON.stringify(mine) !== JSON.stringify(remote.profile))) localNewer = true;
    } else if (await db.profile.get('me')) localNewer = true;
    await mergeTable<Settings>('settings', db.settings, (remote.settings ?? []).filter(inNote), (s) => s.key, inNote);
    await mergeTable<Workout>('workouts', db.workouts, remote.workouts ?? [], (w) => w.id);
    await mergeTable<PlannedWorkout>('planned', db.planned, remote.planned ?? [], (p) => p.id);
    await mergeTable<DayNote>('dayNotes', db.dayNotes, remote.dayNotes ?? [], (n) => n.date);
    await mergeTable<ActivePlan>('plans', db.plans, remote.plans ?? [], (p) => p.id);
    await mergeTable<ActivityEdit>('activityEdits', db.activityEdits, remote.activityEdits ?? [], (e) => e.id);
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
  let payload = note.payload;
  if (isSealed(payload)) {
    const sealed = decodeSealed(payload);
    const key = await getSetting<string | null>('noteKey', null);
    const opened = key ? await open(sealed, key) : null;
    if (opened == null) throw new NoteLockedError(sealed.lock.question, sealed.lock);
    // The lock that travels with the note is the current one (another device may have changed the passphrase); keep it.
    await setSetting('noteLock', sealed.lock);
    payload = opened;
  }
  const text = await gunzipBase64(payload);
  const doc = JSON.parse(text) as SyncDoc;
  if (!doc.tombstones) doc.tombstones = [];
  return doc;
}

export async function writeRemote(c: IntervalsCredentials): Promise<SyncDoc> {
  const doc = await localDoc();
  let payload = await gzipBase64(JSON.stringify(doc));
  const key = await getSetting<string | null>('noteKey', null);
  const lock = await getSetting<LockEnvelope | null>('noteLock', null);
  if (key && lock) payload = encodeSealed(await seal(payload, key, lock));
  await writeBackupNote(c, payload);
  return doc;
}

// ---- the lock on the note ----

/** Whether this device holds a key for an encrypted note, and the question that goes with it. */
export async function lockStatus(): Promise<{ on: boolean; question?: string }> {
  const key = await getSetting<string | null>('noteKey', null);
  const lock = await getSetting<LockEnvelope | null>('noteLock', null);
  return { on: !!(key && lock), question: lock?.question };
}

/** Turn encryption on from this device (a fresh data key), or change the passphrase or question with the key this device holds. */
export async function setLock(passphrase: string, question: string, answer: string): Promise<void> {
  const key = (await getSetting<string | null>('noteKey', null)) ?? newDataKey();
  const lock = await makeLock(key, passphrase, question, answer);
  await setSetting('noteKey', key);
  await setSetting('noteLock', lock);
}

/** Turn encryption off from this device; the next push writes the note in the clear. */
export async function clearLock(): Promise<void> {
  await setSetting('noteKey', null);
  await setSetting('noteLock', null);
}

/**
 * Open a locked note on this device with the passphrase, or with the answer to
 * the question. On success the data key is kept here and the note is merged.
 */
export async function unlockNote(c: IntervalsCredentials, secret: string, by: 'passphrase' | 'answer'): Promise<boolean> {
  const note = await readBackupNote(c);
  if (!note || !isSealed(note.payload)) return true;
  const sealed = decodeSealed(note.payload);
  const key = by === 'passphrase' ? await unlockWithPassphrase(sealed.lock, secret) : await unlockWithAnswer(sealed.lock, secret);
  if (!key) return false;
  await setSetting('noteKey', key);
  await setSetting('noteLock', sealed.lock);
  const prev = (await getSetting<DeviceSyncState | null>('deviceSync', null)) ?? {};
  await setSetting('deviceSync', { ...prev, locked: undefined });
  return true;
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
      if (e instanceof NoteLockedError) {
        // Nothing is pushed: writing this device's data in the clear over an encrypted note would undo the lock.
        const state: DeviceSyncState = { ...prev, error: undefined, locked: { question: e.question, at: new Date().toISOString() } };
        await setSetting('deviceSync', state).catch(() => {});
        return state;
      }
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
