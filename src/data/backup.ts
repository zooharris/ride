import { APP_NAME, BACKUP_FILE_PREFIX } from '../appName';
import { db } from './db';
import { today } from '../engine/load';

import { localDoc, readRemote, syncDevices, type SyncDoc } from './devicesync';
import { untracked } from './db';
import type { IntervalsCredentials } from '../sync/intervals';

export type Backup = SyncDoc;

/**
 * Everything the app alone owns, in one JSON file: the same document the sync
 * across devices keeps in Intervals.icu. Rides and wellness are left out on
 * purpose: they come back from Intervals.icu on the next sync. The Intervals.icu
 * API key is included so a restore is a one-step job; keep the file where you
 * keep passwords.
 */
export async function makeBackup(): Promise<Backup> {
  return localDoc();
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
 * next sync across devices; the clean-up leaves no tombstones.
 */
export async function restoreBackup(text: string): Promise<{ workouts: number; planned: number }> {
  const data = JSON.parse(text) as Omit<Backup, 'schema'> & { schema: number };
  if ((data.schema !== 1 && data.schema !== 2) || !data.profile) throw new Error('This is not a backup file this app can read.');
  const strip = <R extends { updatedAt?: string }>(r: R): R => { const { updatedAt: _u, ...rest } = r; return rest as R; };
  await db.transaction('rw', [db.profile, db.settings, db.workouts, db.planned, db.sync, db.tombstones], async () => {
    await untracked(async () => {
      await db.profile.clear();
      await db.settings.clear();
      await db.workouts.clear();
      await db.planned.clear();
      await db.sync.clear();
    });
    await db.profile.put(strip(data.profile as never));
    await db.settings.bulkPut((data.settings as never[]).map(strip));
    await db.workouts.bulkPut((data.workouts as never[]).map(strip));
    await db.planned.bulkPut((data.planned as never[]).map(strip));
    if (data.sync) await db.sync.bulkPut(data.sync as never[]);
  });
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
