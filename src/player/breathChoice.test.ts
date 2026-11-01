import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ uploads: [] as string[], deleted: [] as string[], n: 0, breathing: new Set<string>() }));
vi.mock('../sync/intervals', async (orig) => ({
  ...(await orig<typeof import('../sync/intervals')>()),
  uploadActivityFile: async (_c: unknown, _f: unknown, o: { externalId: string }) => { calls.uploads.push(o.externalId); return `up${++calls.n}`; },
  deleteActivity: async (_c: unknown, id: string) => { calls.deleted.push(id); },
  updateActivityEffort: async () => {},
  updateActivityType: async () => {},
  updateActivityDescription: async () => {},
  fetchHasBreathing: async (_c: unknown, id: string) => calls.breathing.has(id),
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
import { applyGarminRule, CHOICE_DAYS, keepAntogoChoice, keepGarminChoice, markPlayerMade, pendingChoices, recommendKeep } from './garmin';
import { upsertEdit } from '../sync/records';

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
  calls.uploads.length = 0; calls.deleted.length = 0; calls.breathing.clear();
  await db.planned.add({ id: 'p1', date: d, workoutId: w.id, basis: 'power', status: 'sent' });
});

/** Antogo's ride uploaded and done (as the player leaves it), before any Garmin recording. */
async function uploadedP(o: Partial<Recording> = {}, withFile = true) {
  await db.rides.put(ride('P', t0, 3600, { averagePower: 200 }));
  await markPlayerMade('P', d, false, o.breathing ? 'VitalPro R 4821' : undefined);
  await db.planned.update('p1', { status: 'completed', activityId: 'P', matchedByHand: true });
  if (withFile) await db.recordings.put(rec({ status: 'uploaded', activityId: 'P', ...o }));
}

const breathing = { breathing: true, breathSensor: 'VitalPro R 4821' } as Partial<Recording>;
const excluded = async (id: string) => !!(await db.activityEdits.get(id))?.excluded;

describe('2B: two recordings of one ride, when Antogo\'s has the breathing', () => {
  it('the Garmin\'s has no breathing: nothing is swapped, the rider is asked, the ride counts once', async () => {
    await uploadedP(breathing);
    await db.rides.put(ride('G', t0 + 20_000, 3600, { averagePower: 195 }));
    expect(await applyGarminRule()).toEqual([]);
    expect(calls.deleted).toEqual([]);
    expect((await db.activityEdits.get('P'))?.choice).toEqual({ garminId: 'G', since: d });
    expect(await excluded('G')).toBe(true);
    const pending = pendingChoices(await db.activityEdits.toArray(), await db.rides.toArray());
    expect(pending).toMatchObject([{ playerId: 'P', garminId: 'G', recommend: { keep: 'antogo', stoppedEarly: false } }]);
    // Asked once: the next sync leaves it waiting.
    expect(await applyGarminRule()).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });
  it('both have breathing: the silent rule stands, with Undo', async () => {
    await uploadedP(breathing);
    await db.rides.put(ride('G', t0, 3600));
    calls.breathing.add('G');
    expect(await applyGarminRule()).toMatchObject([{ garminId: 'G', undo: true }]);
    expect(calls.deleted).toEqual(['P']);
  });
  it('without breathing on Antogo\'s side nothing changes: the silent rule', async () => {
    await uploadedP();
    await db.rides.put(ride('G', t0, 3600));
    expect(await applyGarminRule()).toMatchObject([{ garminId: 'G' }]);
    expect((await db.activityEdits.get('G'))?.excluded).toBeUndefined();
  });
  it('the recommendation: Antogo\'s unless it stopped short of 95% of the Garmin\'s', () => {
    expect(recommendKeep(3600, 3700)).toEqual({ keep: 'antogo', stoppedEarly: false });
    expect(recommendKeep(3000, 3600)).toEqual({ keep: 'garmin', stoppedEarly: true });
  });
  it('Keep Antogo\'s: Antogo\'s stays and completes the session, the Garmin\'s stays out of training load, and nobody asks again', async () => {
    await uploadedP(breathing);
    await db.rides.put(ride('G', t0, 3600));
    await applyGarminRule();
    await keepAntogoChoice('P');
    expect(await db.planned.get('p1')).toMatchObject({ activityId: 'P', status: 'completed' });
    expect(await db.activityEdits.get('P')).toMatchObject({ keepVeloiq: true });
    expect((await db.activityEdits.get('P'))?.choice).toBeUndefined();
    expect(await excluded('G')).toBe(true);
    expect(pendingChoices(await db.activityEdits.toArray(), await db.rides.toArray())).toEqual([]);
    expect(await applyGarminRule()).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });
  it('Keep Garmin\'s: the swap is made with Undo, and the Garmin\'s counts again', async () => {
    await uploadedP(breathing);
    await db.rides.put(ride('G', t0, 3600));
    await applyGarminRule();
    const s = await keepGarminChoice('P');
    expect(s).toMatchObject({ garminId: 'G', undo: true, recordingId: 'rec1' });
    expect(calls.deleted).toEqual(['P']);
    expect(await db.planned.get('p1')).toMatchObject({ activityId: 'G' });
    expect(await excluded('G')).toBe(false);
    expect(await db.activityEdits.get('P')).toBeUndefined();
  });
  it('a choice not made in 30 days falls back to the Garmin\'s, with Undo', async () => {
    await uploadedP(breathing);
    await db.rides.put(ride('G', t0, 3600));
    await applyGarminRule();
    const old = new Date(Date.parse(d) - (CHOICE_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    await upsertEdit('P', d, { choice: { garminId: 'G', since: old } });
    expect(await applyGarminRule()).toMatchObject([{ garminId: 'G', undo: true }]);
    expect(calls.deleted).toEqual(['P']);
    expect(await excluded('G')).toBe(false);
  });
  it('at Save: the Garmin\'s already in without breathing, Antogo\'s with it is uploaded (the rider chooses at the next sync)', async () => {
    await db.rides.put(ride('G', t0, 3600));
    const r = await uploadRide((await db.recordings.put(rec(breathing)), 'rec1'));
    expect(r.ok).toBe(true);
    expect(calls.uploads.length).toBe(1);
  });
});
