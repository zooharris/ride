import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getSetting, setSetting } from './db';
import { backupSummary, makeBackup, restoreBackup } from './backup';
import type { Recording } from '../player/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const rec = (id: string): Recording => ({ id, status: 'uploaded', startedAt: '2026-11-08T09:00:00', startMs: 1, date: '2026-11-08', name: 'Indoor', basis: 'power', ftp: 250, lthr: 165, samples: [{ t: 0, w: 100 }], laps: [], events: [], timerSeconds: 1, distanceM: 0, savedMs: 0, activityId: `a-${id}` });

beforeEach(async () => { await db.delete(); await db.open(); });

describe('back up everything (12 Nov 2026)', () => {
  it('a round trip brings back the plans, calendar, workouts, settings, learned values, favourites, notes, efforts and recordings', async () => {
    await db.profile.put({ id: 'me', name: 'R', ftp: 250, lthr: 165, maxHr: 182, restingHr: 52, weightKg: 70, basis: 'power', masters: true, units: 'metric', rideDays: [1], hoursPerWeek: 6 });
    await db.workouts.put({ id: 'w1', name: 'Mine', kind: 'ride', family: 'endurance', purpose: '', phases: ['any'], bases: ['power'], setting: 'any', blocks: [], source: 'mine' });
    await db.planned.put({ id: 'p1', date: '2026-11-14', workoutId: 'w1', basis: 'power', status: 'planned' });
    await db.plans.put({ id: 'plan1', name: 'Plan' } as never);
    await db.dayNotes.put({ date: '2026-11-08', text: 'tired' });
    await db.activityEdits.put({ id: 'a1', date: '2026-11-08', rpe: 7 });
    await setSetting('hrPowerTable', { 2: { watts: 180 } });
    await setSetting('breathPowerTable', { 1: { watts: 150 } });
    await setSetting('libraryFavorites', ['lib-z2-105']);
    await setSetting('playerSound', 'beeps');
    await setSetting('coachChat', { date: '2026-11-08', turns: [] });
    await setSetting('intervals', { athleteId: 'i1', apiKey: 'k' });
    await db.recordings.put(rec('r1'));
    const file = JSON.stringify(await makeBackup());

    expect(backupSummary(file)).toMatchObject({ ok: true, words: '1 calendar entry, 1 workout, 1 plan, 1 ride recording' });

    // A different device's data, then the restore.
    await db.delete(); await db.open();
    await setSetting('playerDevices', ['my strap']);
    await db.recordings.put(rec('here'));
    await restoreBackup(file);

    expect((await db.profile.get('me'))?.ftp).toBe(250);
    expect(await db.workouts.get('w1')).toBeTruthy();
    expect(await db.planned.get('p1')).toBeTruthy();
    expect(await db.plans.get('plan1')).toBeTruthy();
    expect((await db.dayNotes.get('2026-11-08'))?.text).toBe('tired');
    expect((await db.activityEdits.get('a1'))?.rpe).toBe(7);
    expect(await getSetting('hrPowerTable', null)).toEqual({ 2: { watts: 180 } });
    expect(await getSetting('breathPowerTable', null)).toEqual({ 1: { watts: 150 } });
    expect(await getSetting('libraryFavorites', null)).toEqual(['lib-z2-105']);
    expect(await getSetting('playerSound', null)).toBe('beeps');
    expect(await getSetting('coachChat', null)).toBeTruthy();
    expect(await getSetting('intervals', null)).toEqual({ athleteId: 'i1', apiKey: 'k' });
    // This device's own sensors and recordings stay; the backup's recording is added.
    expect(await getSetting('playerDevices', null)).toEqual(['my strap']);
    expect((await db.recordings.toArray()).map((r) => r.id).sort()).toEqual(['here', 'r1']);
  });

  it('a backup made before this build (no recordings, no device settings) still restores', async () => {
    const old = { app: 'Antogo Cycling', schema: 2, exportedAt: '2026-11-01T00:00:00Z', profile: { id: 'me', ftp: 230 }, settings: [{ key: 'libraryFavorites', value: ['x'] }], workouts: [], planned: [{ id: 'p', date: '2026-11-02', workoutId: 'w', basis: 'power', status: 'planned' }], tombstones: [] };
    expect(backupSummary(JSON.stringify(old)).ok).toBe(true);
    await restoreBackup(JSON.stringify(old));
    expect((await db.profile.get('me'))?.ftp).toBe(230);
    expect(await db.planned.count()).toBe(1);
  });

  it('something that is not a backup is refused, in words', () => {
    expect(backupSummary('{"hello":1}')).toEqual({ ok: false, words: 'This is not a backup file this app can read.' });
    expect(backupSummary('not json').ok).toBe(false);
  });
});
