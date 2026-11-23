import { inApp } from '../shell';
import { APP_NAME, BACKUP_FILE_PREFIX } from '../appName';
import { db, type KeptFile } from './db';
import type { Ride, Wellness } from '../engine/types';
import { today } from '../engine/load';

import { LOCAL_ONLY, localDoc, readRemote, SECRET_SETTINGS, syncDevices, type SyncDoc } from './devicesync';
import { untracked } from './db';
import type { IntervalsCredentials } from '../sync/intervals';
import type { Recording } from '../player/types';
import { zipEntries, zipRead, zipStore } from '../import/zip';

/**
 * A backup file: the document the sync across devices keeps, plus what only this device holds that is still the
 * rider's (12 Nov 2026, "back up everything"): the ride player's recordings kept here, and this device's player
 * preferences and coach conversations. Older backups have neither and still restore.
 */
export type Backup = SyncDoc & { recordings?: Recording[]; history?: BackupHistory };

/**
 * Stage 0 (22 Nov 2026): the rider's whole history in the backup, so it is not tied to one browser or to the data
 * service still being able to send it: every activity and day of wellness on this device, and each activity's
 * original file (as base64 text). Older backups have none and still restore.
 */
export interface BackupHistory {
  rides: Ride[];
  wellness: Wellness[];
  files: Array<{ id: string; date: string; status: KeptFile['status']; at: string; why?: string; b64?: string }>;
}

/** Bytes as base64 text, in pieces so a large file never overflows the call stack. */
export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The device's own settings that are the rider's, not the device's, so a full backup carries them: the ride
 * player's preferences, the ramp step, the coach's conversations and last re-check, and the Progress overlays.
 * Paired sensors, caches, the note's key and history depth stay with the device.
 */
export const BACKUP_ALSO = new Set(['coachChat', 'chartChat', 'coachRecheck', 'progressOverlays', 'playerSound', 'playerAutoPause', 'playerGuard', 'playerSmoothing', 'rampStep']);

/**
 * Everything the app alone owns, in one JSON file: the same document the sync
 * across devices keeps in Intervals.icu, with the additions above and, since
 * Stage 0 (22 Nov 2026), the whole history: activities, wellness and each
 * activity's original file, which may not come back from the data service. The service's API key is
 * included so a restore is a one-step job; keep the file where you keep
 * passwords. The sync note never carries the keys.
 */
export async function makeBackup(opts: { files?: boolean } = {}): Promise<Backup> {
  const inline = opts.files !== false;
  const doc = await localDoc({ withSecrets: true });
  const extra = (await db.settings.toArray()).filter((x) => BACKUP_ALSO.has(x.key));
  const have = new Set(doc.settings.map((x) => x.key));
  const recordings = (await db.recordings.toArray()).filter((r) => r.status !== 'discarded');
  const history: BackupHistory = {
    rides: await db.rides.toArray(),
    wellness: await db.wellness.toArray(),
    files: (await db.files.toArray()).map((f) => ({ id: f.id, date: f.date, status: f.status, at: f.at, ...(f.why ? { why: f.why } : {}), ...(inline && f.bytes ? { b64: toB64(f.bytes) } : {}) })),
  };
  return { ...doc, settings: [...doc.settings, ...extra.filter((x) => !have.has(x.key))], recordings, history };
}

/** What a backup holds, in words, for the question before a restore. */
export function backupSummary(text: string): { ok: boolean; words: string; exportedAt?: string } {
  try {
    const d = JSON.parse(text) as Omit<Partial<Backup>, 'schema'> & { schema?: number };
    if ((d.schema !== 1 && d.schema !== 2) || !d.profile) return { ok: false, words: 'This is not a backup file this app can read.' };
    const n = (x: unknown[] | undefined, one: string, many: string) => `${x?.length ?? 0} ${(x?.length ?? 0) === 1 ? one : many}`;
    return { ok: true, exportedAt: d.exportedAt, words: [n(d.planned, 'calendar entry', 'calendar entries'), n(d.workouts, 'workout', 'workouts'), n(d.plans, 'plan', 'plans'), ...(d.recordings?.length ? [n(d.recordings, 'ride recording', 'ride recordings')] : []),
      ...(d.history?.rides.length ? [n(d.history.rides, 'activity', 'activities')] : []),
      ...(d.history?.wellness.length ? [n(d.history.wellness, 'day of wellness', 'days of wellness')] : []),
      ...(d.history?.files.some((f) => f.b64) ? [n(d.history.files.filter((f) => f.b64), 'original activity file', 'original activity files')] : [])].join(', ') };
  } catch { return { ok: false, words: 'This is not a backup file this app can read.' }; }
}

export function backupFileName(): string {
  return `${BACKUP_FILE_PREFIX}-backup-${today()}.zip`;
}

/** The backup's own document inside the archive, and the folder its original activity files sit in. */
export const BACKUP_DOC = 'backup.json';
const FILES_DIR = 'activity-files/';
/** An activity's original file as it is named in the archive: its day and id, so the folder reads in order. */
const fileEntry = (f: Pick<KeptFile, 'id' | 'date'>, bytes: Uint8Array) => `${FILES_DIR}${f.date}_${encodeURIComponent(f.id)}.${bytes[0] === 0x1f && bytes[1] === 0x8b ? 'fit.gz' : bytes[8] === 0x2e && bytes[9] === 0x46 ? 'fit' : 'bin'}`;
const entryId = (name: string) => { const m = /^activity-files\/\d{4}-\d{2}-\d{2}_(.+?)\.(?:fit\.gz|fit|bin)$/.exec(name); return m ? decodeURIComponent(m[1]) : undefined; };

/**
 * The backup as one archive (22 Nov 2026): the document, and each activity's original file beside it as the file it
 * is, not as text inside the document. So a history of any size the device can hold backs up (one document with years
 * of files in it passes what a browser can hold as text), and the rider can open the archive and find their files.
 */
export async function makeBackupArchive(): Promise<Blob> {
  const doc = await makeBackup({ files: false });
  const entries: Array<{ name: string; data: Uint8Array }> = [{ name: BACKUP_DOC, data: new TextEncoder().encode(JSON.stringify(doc)) }];
  await db.files.each((f) => { if (f.status === 'kept' && f.bytes) entries.push({ name: fileEntry(f, f.bytes), data: f.bytes }); });
  return zipStore(entries);
}

const isZip = async (b: Blob) => { const h = new Uint8Array(await b.slice(0, 2).arrayBuffer()); return h[0] === 0x50 && h[1] === 0x4b; };

/** What a backup file holds, in words: an archive (since 22 Nov 2026) or the single document earlier backups were. */
export async function backupSummaryOf(file: Blob): Promise<{ ok: boolean; words: string; exportedAt?: string }> {
  if (!(await isZip(file))) return backupSummary(await file.text());
  try {
    const entries = await zipEntries(file);
    const doc = entries.find((e) => e.name === BACKUP_DOC);
    if (!doc) return { ok: false, words: 'This is not a backup file this app can read.' };
    const sum = backupSummary(new TextDecoder().decode(await zipRead(file, doc)));
    const n = entries.filter((e) => entryId(e.name)).length;
    return sum.ok && n ? { ...sum, words: `${sum.words}, ${n} original activity ${n === 1 ? 'file' : 'files'}` } : sum;
  } catch { return { ok: false, words: 'This is not a backup file this app can read.' }; }
}

/** Restore from a backup file of either kind. The archive's activity files are added one at a time where this device lacks them. */
export async function restoreBackupFile(file: Blob): Promise<{ workouts: number; planned: number }> {
  if (!(await isZip(file))) return restoreBackup(await file.text());
  const entries = await zipEntries(file);
  const doc = entries.find((e) => e.name === BACKUP_DOC);
  if (!doc) throw new Error('This is not a backup file this app can read.');
  const text = new TextDecoder().decode(await zipRead(file, doc));
  const out = await restoreBackup(text);
  const meta = new Map(((JSON.parse(text) as Backup).history?.files ?? []).map((f) => [f.id, f]));
  const have = new Set((await db.files.where('status').equals('kept').primaryKeys()) as string[]);
  for (const e of entries) {
    const id = entryId(e.name);
    if (!id || have.has(id)) continue;
    const bytes = await zipRead(file, e);
    const m = meta.get(id);
    await db.files.put({ id, date: m?.date ?? e.name.slice(FILES_DIR.length, FILES_DIR.length + 10), status: 'kept', at: m?.at ?? new Date().toISOString(), bytes, size: bytes.byteLength });
  }
  return out;
}

export async function downloadBackup(): Promise<void> {
  const blob = await makeBackupArchive();
  const file = new File([blob], backupFileName(), { type: 'application/zip' });
  // On iOS the share sheet is the way into iCloud Drive; elsewhere a download.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  // The installed app saves a file as a computer does.
  if (!inApp() && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${APP_NAME} backup` });
      await db.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  await db.settings.put({ key: 'lastBackup', value: new Date().toISOString() });
}

/**
 * Replace this device's own data with a backup (file, or the note in
 * Intervals.icu). The restored records are stamped now, so they win on the
 * next sync across devices; the clean-up leaves no tombstones. Keys this
 * device already holds are kept when the backup brings none (the note never
 * carries them), so a restore from the note does not disconnect the device.
 */
export async function restoreBackup(text: string): Promise<{ workouts: number; planned: number }> {
  const data = JSON.parse(text) as Omit<Backup, 'schema'> & { schema: number };
  if ((data.schema !== 1 && data.schema !== 2) || !data.profile) throw new Error('This is not a backup file this app can read.');
  const strip = <R extends { updatedAt?: string }>(r: R): R => { const { updatedAt: _u, ...rest } = r; return rest as R; };
  const incomingKeys = new Set((data.settings as Array<{ key: string }>).map((s) => s.key));
  // This device's keys, and what belongs to the device itself (its paired sensors, its id, the note's key), are kept when the backup brings none.
  const keptSecrets = (await db.settings.toArray()).filter((s) => (SECRET_SETTINGS.has(s.key) || LOCAL_ONLY.has(s.key)) && !incomingKeys.has(s.key));
  await db.transaction('rw', [db.profile, db.settings, db.workouts, db.planned, db.dayNotes, db.plans, db.activityEdits, db.sync, db.tombstones], async () => {
    await untracked(async () => {
      await db.profile.clear();
      await db.settings.clear();
      await db.workouts.clear();
      await db.planned.clear();
      await db.dayNotes.clear();
      await db.plans.clear();
      await db.activityEdits.clear();
      await db.sync.clear();
    });
    await db.profile.put(strip(data.profile as never));
    await db.settings.bulkPut((data.settings as never[]).map(strip));
    if (keptSecrets.length) await untracked(() => db.settings.bulkPut(keptSecrets));
    // Plans, sessions and workouts are marked as restored: that is the one thing that brings back a
    // record deleted after the backup was made (deletions are otherwise final across devices).
    const restoredAt = new Date().toISOString();
    const restore = <R extends { updatedAt?: string }>(r: R): R => ({ ...strip(r), restoredAt });
    const ids = (rows: unknown[] | undefined, table: string) => (rows ?? []).map((r) => `${table}:${(r as { id: string }).id}`);
    await db.tombstones.bulkDelete([...ids(data.workouts, 'workouts'), ...ids(data.planned, 'planned'), ...ids(data.plans, 'plans')]);
    await db.workouts.bulkPut((data.workouts as never[]).map(restore));
    await db.planned.bulkPut((data.planned as never[]).map(restore));
    if (data.dayNotes) await db.dayNotes.bulkPut((data.dayNotes as never[]).map(strip));
    if (data.plans) await db.plans.bulkPut((data.plans as never[]).map(restore));
    if (data.activityEdits) await db.activityEdits.bulkPut((data.activityEdits as never[]).map(strip));
    if (data.sync) await db.sync.bulkPut(data.sync as never[]);
  });
  // Ride recordings belong to this device and are never cleared by a restore: the backup's are added where this device lacks them.
  if (data.recordings?.length) {
    const here = new Set((await db.recordings.toArray()).map((r) => r.id));
    await db.recordings.bulkPut(data.recordings.filter((r) => !here.has(r.id)));
  }
  // The history (Stage 0): activities, wellness and original files are added where this device lacks them; what is here stays.
  if (data.history) {
    const h = data.history;
    const haveR = new Set((await db.rides.toCollection().primaryKeys()) as string[]);
    await db.rides.bulkPut(h.rides.filter((r) => !haveR.has(r.id)));
    const haveW = new Set((await db.wellness.toCollection().primaryKeys()) as string[]);
    await db.wellness.bulkPut(h.wellness.filter((w) => !haveW.has(w.date)));
    const haveF = new Set((await db.files.where('status').equals('kept').primaryKeys()) as string[]);
    // A file listed as kept whose bytes are not in this document sits beside it in the archive and is added from there.
    await db.files.bulkPut(h.files.filter((f) => !haveF.has(f.id) && (f.b64 || f.status !== 'kept')).map((f) => {
      const bytes = f.b64 ? fromB64(f.b64) : undefined;
      return { id: f.id, date: f.date, status: f.status, at: f.at, ...(f.why ? { why: f.why } : {}), ...(bytes ? { bytes, size: bytes.byteLength } : {}) };
    }));
  }
  return { workouts: data.workouts.length, planned: data.planned.length };
}

/** The note in Intervals.icu is kept in step by the sync across devices; this runs one round of it. */
export async function autoBackup(c: IntervalsCredentials, _force = false): Promise<{ ok: boolean; when?: string; error?: string }> {
  const s = await syncDevices(c);
  return s.error && (!s.last || s.error > s.last) ? { ok: false, error: s.error.replace(/^\S+ /, ''), when: s.last } : { ok: true, when: s.last };
}

export async function fetchAutoBackup(c: IntervalsCredentials): Promise<{ text: string; exportedAt: string } | null> {
  const doc = await readRemote(c);
  return doc ? { text: JSON.stringify(doc), exportedAt: doc.exportedAt } : null;
}
