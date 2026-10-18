import { APP_NAME, BACKUP_FILE_PREFIX } from '../appName';
import { db } from './db';
import { today } from '../engine/load';

export interface Backup {
  app: string;
  schema: 1;
  exportedAt: string;
  profile: unknown;
  settings: unknown[];
  workouts: unknown[];
  planned: unknown[];
  sync: unknown[];
}

/**
 * Everything the app alone owns, in one JSON file. Rides and wellness are left
 * out on purpose: they come back from Intervals.icu on the next sync.
 * The Intervals.icu API key is included so a restore is a one-step job; keep
 * the file where you keep passwords.
 */
export async function makeBackup(): Promise<Backup> {
  return {
    app: APP_NAME,
    schema: 1,
    exportedAt: new Date().toISOString(),
    profile: await db.profile.get('me'),
    settings: await db.settings.toArray(),
    workouts: await db.workouts.toArray(),
    planned: await db.planned.toArray(),
    sync: await db.sync.toArray(),
  };
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

export async function restoreBackup(text: string): Promise<{ workouts: number; planned: number }> {
  const data = JSON.parse(text) as Backup;
  if (data.schema !== 1 || !data.profile) throw new Error('This is not a backup file this app can read.');
  await db.transaction('rw', [db.profile, db.settings, db.workouts, db.planned, db.sync], async () => {
    await db.profile.clear();
    await db.settings.clear();
    await db.workouts.clear();
    await db.planned.clear();
    await db.sync.clear();
    await db.profile.put(data.profile as never);
    await db.settings.bulkPut(data.settings as never[]);
    await db.workouts.bulkPut(data.workouts as never[]);
    await db.planned.bulkPut(data.planned as never[]);
    await db.sync.bulkPut(data.sync as never[]);
  });
  return { workouts: data.workouts.length, planned: data.planned.length };
}
