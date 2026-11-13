import { APP_NAME, BACKUP_FILE_PREFIX } from '../appName';
import { db } from './db';
import { today } from '../engine/load';

import { LOCAL_ONLY, localDoc, readRemote, SECRET_SETTINGS, syncDevices, type SyncDoc } from './devicesync';
import { untracked } from './db';
import type { IntervalsCredentials } from '../sync/intervals';
import type { Recording } from '../player/types';

/**
 * A backup file: the document the sync across devices keeps, plus what only this device holds that is still the
 * rider's (12 Nov 2026, "back up everything"): the ride player's recordings kept here, and this device's player
 * preferences and coach conversations. Older backups have neither and still restore.
 */
export type Backup = SyncDoc & { recordings?: Recording[] };

/**
 * The device's own settings that are the rider's, not the device's, so a full backup carries them: the ride
 * player's preferences, the ramp step, the coach's conversations and last re-check, and the Progress overlays.
 * Paired sensors, caches, the note's key and history depth stay with the device.
 */
export const BACKUP_ALSO = new Set(['coachChat', 'chartChat', 'coachRecheck', 'progressOverlays', 'playerSound', 'playerAutoPause', 'playerGuard', 'playerSmoothing', 'rampStep']);

/**
 * Everything the app alone owns, in one JSON file: the same document the sync
 * across devices keeps in Intervals.icu, with the additions above. Activities,
 * wellness and their second-by-second records are left out on purpose: they
 * come back from the data service on the next sync. The service's API key is
 * included so a restore is a one-step job; keep the file where you keep
 * passwords. The sync note never carries the keys.
 */
export async function makeBackup(): Promise<Backup> {
  const doc = await localDoc({ withSecrets: true });
  const extra = (await db.settings.toArray()).filter((x) => BACKUP_ALSO.has(x.key));
  const have = new Set(doc.settings.map((x) => x.key));
  const recordings = (await db.recordings.toArray()).filter((r) => r.status !== 'discarded');
  return { ...doc, settings: [...doc.settings, ...extra.filter((x) => !have.has(x.key))], recordings };
}

/** What a backup holds, in words, for the question before a restore. */
export function backupSummary(text: string): { ok: boolean; words: string; exportedAt?: string } {
  try {
    const d = JSON.parse(text) as Omit<Partial<Backup>, 'schema'> & { schema?: number };
    if ((d.schema !== 1 && d.schema !== 2) || !d.profile) return { ok: false, words: 'This is not a backup file this app can read.' };
    const n = (x: unknown[] | undefined, one: string, many: string) => `${x?.length ?? 0} ${(x?.length ?? 0) === 1 ? one : many}`;
    return { ok: true, exportedAt: d.exportedAt, words: [n(d.planned, 'calendar entry', 'calendar entries'), n(d.workouts, 'workout', 'workouts'), n(d.plans, 'plan', 'plans'), ...(d.recordings?.length ? [n(d.recordings, 'ride recording', 'ride recordings')] : [])].join(', ') };
  } catch { return { ok: false, words: 'This is not a backup file this app can read.' }; }
}

export function backupFileName(): string {
  return `${BACKUP_FILE_PREFIX}-backup-${today()}.json`;
}

export async function downloadBackup(): Promise<void> {
  const data = await makeBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], backupFileName(), { type: 'application/json' });
  // On iOS the share sheet is the way into iCloud Drive; elsewhere a download.
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
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
