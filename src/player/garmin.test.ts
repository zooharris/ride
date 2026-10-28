import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ uploads: [] as string[], deleted: [] as string[], n: 0 }));
vi.mock('../sync/intervals', async (orig) => ({
  ...(await orig<typeof import('../sync/intervals')>()),
  uploadActivityFile: async (_c: unknown, _f: unknown, o: { externalId: string }) => { calls.uploads.push(o.externalId); return `up${++calls.n}`; },
  deleteActivity: async (_c: unknown, id: string) => { calls.deleted.push(id); },
  updateActivityEffort: async () => {},
  updateActivityType: async () => {},
  updateActivityDescription: async () => {},
}));
vi.mock('../sync/syncService', async (orig) => ({
  ...(await orig<typeof import('../sync/syncService')>()),
  credentials: async () => ({ athleteId: 'i1', apiKey: 'k' }),
  syncAll: async () => ({ newIds: [] }),
}));

import { db } from '../data/db';
import { LIBRARY } from '../library/workouts';
import { today } from '../engine/load';
import type { Ride } from '../engine/types';
import type { Recording } from './types';
import { uploadRide } from './rides';
import { applyGarminRule, deletePlayerRide, keepVeloiqInstead, markPlayerMade } from './garmin';
import { garminTwin, sameRide } from './twin';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const w = LIBRARY.filter((x) => x.kind === 'ride')[0];
const d = today();
const t0 = new Date(`${d}T18:00:00`).getTime();
const at = (ms: number) => { const x = new Date(ms); const p = (n: number) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; };
const ride = (id: string, startMs: number, seconds: number, o: Partial<Ride> = {}): Ride => ({ id, date: d, startTime: at(startMs), name: w.name, type: 'VirtualRide', sport: 'ride', seconds, elapsedSeconds: seconds, ...o } as Ride);
const rec = (o: Partial<Recording> = {}): Recording => ({
  id: 'rec1', status: 'finished', startedAt: at(t0), startMs: t0, date: d, name: w.name, basis: 'power', ftp: 240, lthr: 160,
  samples: Array.from({ length: 3600 }, (_, t) => ({ t, w: 200 })), laps: [], events: [], timerSeconds: 3600, distanceM: 0, savedMs: 0, workoutId: w.id, plannedId: 'p1', ...o,
});

beforeEach(async () => {
  await db.delete(); await db.open();
  calls.uploads.length = 0; calls.deleted.length = 0;
  await db.planned.add({ id: 'p1', date: d, workoutId: w.id, basis: 'power', status: 'sent' });
});

/** VeloIQ's ride uploaded and done (as the player leaves it), before any Garmin recording. */
async function uploadedP(o: Partial<Recording> = {}, withFile = true) {
  await db.rides.put(ride('P', t0, 3600, { averagePower: 200 }));
  await markPlayerMade('P', d);
  await db.planned.update('p1', { status: 'completed', activityId: 'P', matchedByHand: true });
  if (withFile) await db.recordings.put(rec({ status: 'uploaded', activityId: 'P', ...o }));
}

describe('the same ride', () => {
  it('shares at least half of the shorter recording', () => {
    const a = { startMs: 0, seconds: 3600 };
    expect(sameRide(a, { startMs: 1800_000, seconds: 3600 })).toBe(true);   // exactly half of the hour
    expect(sameRide(a, { startMs: 1801_000, seconds: 3600 })).toBe(false);
    expect(sameRide(a, { startMs: 3000_000, seconds: 600 })).toBe(true);    // all of a short one
  });
  it('two Garmin rides overlapping one of VeloIQ\'s: the longer overlap wins', () => {
    const g1 = ride('G1', t0 + 1500_000, 3600), g2 = ride('G2', t0 - 60_000, 3600);
    expect(garminTwin({ startMs: t0, seconds: 3600 }, [g1, g2], new Set())?.id).toBe('G2');
  });
});

describe('Garmin first: its recording is in when VeloIQ saves', () => {
  it('does not upload, and the Garmin\'s ride completes the session', async () => {
    await db.rides.put(ride('G', t0 - 30_000, 3660));
    await db.recordings.put(rec());
    const r = await uploadRide('rec1');
    expect(r).toMatchObject({ ok: true, superseded: true, activityId: 'G' });
    expect(calls.uploads).toHaveLength(0);
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: 'G' });
    expect(await db.recordings.get('rec1')).toMatchObject({ status: 'superseded', supersededBy: 'G' });
  });
  it('"Save VeloIQ\'s instead" uploads VeloIQ\'s, which completes the session; the Garmin\'s counts no load', async () => {
    await db.rides.put(ride('G', t0, 3600));
    await db.recordings.put(rec());
    await uploadRide('rec1');
    const r = await keepVeloiqInstead('rec1');
    expect(r.ok).toBe(true);
    expect(calls.uploads).toEqual(['veloiq-rec1-kept']);
    // It holds VeloIQ's recording; the pull that follows the upload marks it done, as for any upload.
    expect(await db.planned.get('p1')).toMatchObject({ activityId: r.activityId, matchedByHand: true });
    expect((await db.activityEdits.get('G'))?.excluded).toBe(true);
    expect(await db.activityEdits.get(r.activityId!)).toMatchObject({ source: 'veloiq', keepVeloiq: true });
  });
  it('uploads as usual when no Garmin recording is in, and marks the activity as the player\'s', async () => {
    await db.recordings.put(rec());
    const r = await uploadRide('rec1');
    expect(calls.uploads).toEqual(['veloiq-rec1']);
    expect((await db.activityEdits.get(r.activityId!))?.source).toBe('veloiq');
  });
});

describe('the Garmin rule at sync: the Garmin\'s arrives later', () => {
  it('moves the session to the Garmin\'s ride and deletes VeloIQ\'s, with Undo', async () => {
    await uploadedP();
    await db.rides.put(ride('G', t0 + 20_000, 3600));
    const swaps = await applyGarminRule();
    expect(swaps).toEqual([{ name: w.name, garminId: 'G', recordingId: 'rec1', noPower: true, undo: true }]);
    expect(calls.deleted).toEqual(['P']);
    expect(await db.rides.get('P')).toBeUndefined();
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: 'G', matchedByHand: true });
    expect((await db.activityEdits.get('G'))?.replaced).toMatchObject({ name: w.name, recordingId: 'rec1' });
  });
  it('still swaps once VeloIQ\'s file is gone (after 30 days), without Undo', async () => {
    await uploadedP({}, false);
    await db.rides.put(ride('G', t0, 3600, { averagePower: 190 }));
    const swaps = await applyGarminRule();
    expect(swaps).toMatchObject([{ garminId: 'G', undo: false, noPower: false }]);
    expect((await db.activityEdits.get('G'))?.replaced?.noUndo).toBe(true);
  });
  it('Undo brings VeloIQ\'s back, and the rule never swaps that pair again', async () => {
    await uploadedP();
    await db.rides.put(ride('G', t0, 3600));
    await applyGarminRule();
    const back = await keepVeloiqInstead('rec1');
    expect(back.ok).toBe(true);
    await db.rides.put(ride(back.activityId!, t0, 3600));
    expect(await applyGarminRule()).toEqual([]);
    expect(calls.deleted).toEqual(['P']);
  });
  it('leaves VeloIQ\'s alone when the rider chose to keep it', async () => {
    await uploadedP({ keepVeloiq: true });
    await db.rides.put(ride('G', t0, 3600));
    expect(await applyGarminRule()).toEqual([]);
    await db.recordings.update('rec1', { keepVeloiq: false });
    await markPlayerMade('P', d, true);
    expect(await applyGarminRule()).toEqual([]);
  });
  it('never deletes a ride the player did not make', async () => {
    await db.rides.put(ride('A', t0, 3600));
    await db.rides.put(ride('B', t0, 3600));
    expect(await applyGarminRule()).toEqual([]);
    await expect(deletePlayerRide('A')).rejects.toThrow();
    expect(calls.deleted).toEqual([]);
    expect(await db.rides.count()).toBe(2);
  });
});
