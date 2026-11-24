import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Saving a ride from the player (23 Nov 2026): into Antogo's own record first, with no data service needed; then on to
 * Intervals.icu for a rider who is connected. The stand-in service here keeps what was sent and, at a pull, hands
 * back its own copy of each, as the real one does.
 */
const svc = vi.hoisted(() => ({ connected: false, fail: false, uploads: [] as Array<{ id: string; name: string }>, n: 0, pulls: 0 }));
vi.mock('../sync/intervals', async (orig) => ({
  ...(await orig<typeof import('../sync/intervals')>()),
  uploadActivityFile: async (_c: unknown, _f: unknown, o: { name: string }) => { if (svc.fail) throw new Error('Intervals.icu could not be reached.'); const id = `i${++svc.n}`; svc.uploads.push({ id, name: o.name }); return id; },
  deleteActivity: async () => {},
  updateActivityEffort: async () => {},
  updateActivityDescription: async () => {},
}));
vi.mock('../sync/syncService', async (orig) => {
  const real = await orig<typeof import('../sync/syncService')>();
  return {
    ...real,
    credentials: async () => (svc.connected ? { athleteId: 'i1', apiKey: 'k' } : undefined),
    // A pull: the service's own copy of each ride sent arrives, then second copies are made one, as in the real pull.
    syncAll: async () => {
      if (!svc.connected) throw new Error('not connected');
      svc.pulls++;
      const { db } = await import('../data/db');
      const { mergeFileCopies } = await import('../import/importer');
      for (const u of svc.uploads) {
        if (await db.rides.get(u.id)) continue;
        const rec = (await db.recordings.toArray()).find((r) => r.activityId === u.id);
        if (!rec) continue;
        await db.rides.put({ id: u.id, date: rec.date, startTime: rec.startedAt, name: u.name, type: 'VirtualRide', sport: 'ride', seconds: rec.timerSeconds, movingSeconds: rec.timerSeconds, elapsedSeconds: rec.timerSeconds, averagePower: 200, tss: 50 } as never);
      }
      await mergeFileCopies();
      return { newIds: [] };
    },
  };
});

import { db } from '../data/db';
import { LIBRARY } from '../library/workouts';
import { today } from '../engine/load';
import { setThresholdCtx } from '../engine/thresholdCtx';
import type { Profile } from '../engine/types';
import type { Recording } from './types';
import { sendWaitingRides, UNDER_FIVE, uploadRide, waitingRides } from './rides';
import { applyGarminRule } from './garmin';
import { addActivity } from '../import/importer';
import { readActivityFile } from '../import/readers';
import { encodeFitActivity } from '../export/activityFiles';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const profile: Profile = { name: 'Sam Example', ftp: 240, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };
const w = LIBRARY.filter((x) => x.kind === 'ride')[0];
const d = today();
const t0 = new Date(`${d}T07:00:00`).getTime();
const at = (ms: number) => { const x = new Date(ms); const p = (n: number) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`; };
const rec = (o: Partial<Recording> = {}, seconds = 3600): Recording => ({
  id: 'rec1', status: 'finished', startedAt: at(t0), startMs: t0, date: d, name: w.name, basis: 'power', ftp: 240, lthr: 160,
  samples: Array.from({ length: seconds }, (_, t) => ({ t, w: 200, hr: 140, rpm: 88 })), laps: [], events: [], timerSeconds: seconds, distanceM: 0, savedMs: 0, workoutId: w.id, plannedId: 'p1', ...o,
});

beforeEach(async () => {
  setThresholdCtx(undefined);
  await db.delete(); await db.open();
  Object.assign(svc, { connected: false, fail: false, uploads: [], n: 0, pulls: 0 });
  await db.profile.put({ ...profile, id: 'me' });
  await db.planned.add({ id: 'p1', date: d, workoutId: w.id, basis: 'power', status: 'planned' });
});

describe('saving a ride from the player', () => {
  it('a rider with no data service: the ride is in Antogo\'s record at once, worked out, with its file, and completes its session', async () => {
    await db.recordings.put(rec({ rpe: 6 }));
    const r = await uploadRide('rec1');
    expect(r).toMatchObject({ ok: true, matched: w.name });
    expect(r.text).toMatch(/^Saved, and matched to/);
    expect(r.text).not.toMatch(/Intervals/);
    expect(svc.uploads).toEqual([]);
    const ride = (await db.rides.get(r.activityId!))!;
    expect(ride).toMatchObject({ name: w.name, sport: 'ride', source: 'file', ownNumbers: true });
    expect(ride.tss).toBeGreaterThan(40);
    expect((await db.files.get(ride.id))?.status).toBe('kept');
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: ride.id, matchedByHand: true, rpe: 6 });
    expect(await db.recordings.get('rec1')).toMatchObject({ status: 'saved', localId: ride.id });
    expect((await db.activityEdits.get(ride.id))?.source).toBe('veloiq');
    expect(await waitingRides()).toEqual([]);
    // Saving again changes nothing.
    expect(await uploadRide('rec1')).toMatchObject({ ok: true, text: 'Already saved.', activityId: ride.id });
    expect(await db.rides.count()).toBe(1);
  });

  it('a connected rider: saved first, sent after, and one activity once the service\'s copy comes back', async () => {
    svc.connected = true;
    await db.recordings.put(rec({ rpe: 7 }));
    const r = await uploadRide('rec1');
    expect(r.ok).toBe(true);
    expect(svc.uploads).toHaveLength(1);
    expect(r.activityId).toBe('i1');
    expect((await db.rides.toArray()).map((x) => x.id)).toEqual(['i1']);        // one activity, the service's id
    expect((await db.files.get('i1'))?.status).toBe('kept');                    // with the file saved here
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: 'i1', rpe: 7 });
    expect((await db.activityEdits.get('i1'))?.source).toBe('veloiq');
    expect(await db.recordings.get('rec1')).toMatchObject({ status: 'uploaded', activityId: 'i1' });
  });

  it('a send that fails: the ride is still saved and shown, nothing is "waiting", and the send is tried again quietly', async () => {
    svc.connected = true; svc.fail = true;
    await db.recordings.put(rec());
    const r = await uploadRide('rec1');
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/^Saved/);
    const local = (await db.recordings.get('rec1'))!.localId!;
    expect(await db.rides.get(local)).toBeTruthy();
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: local });
    expect(await waitingRides()).toEqual([]);
    expect(await sendWaitingRides()).toEqual({ sent: 0, left: 1 });             // still unreachable
    expect(await db.rides.count()).toBe(1);
    svc.fail = false;
    expect(await sendWaitingRides()).toEqual({ sent: 1, left: 0 });
    expect((await db.rides.toArray()).map((x) => x.id)).toEqual(['i1']);
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: 'i1' });
  });

  it('a ride under five minutes is saved, counts 0, is not listed, and the message says where to find it', async () => {
    await db.recordings.put(rec({}, 240));
    const r = await uploadRide('rec1');
    expect(r).toMatchObject({ ok: true, tooShort: true });
    expect(r.text).toContain(UNDER_FIVE);
    expect(r.text).toContain('The session is still on your calendar.');
    const ride = (await db.rides.get(r.activityId!))!;
    expect(ride).toMatchObject({ notTraining: 'trivial', tss: 0 });
    expect(await db.planned.get('p1')).toMatchObject({ status: 'planned' });
    // A free ride that short says the same, without the session.
    await db.recordings.put(rec({ id: 'rec2', startMs: t0 + 3_600_000, startedAt: at(t0 + 3_600_000), workoutId: undefined, plannedId: undefined, name: 'Free ride' }, 200));
    const free = await uploadRide('rec2');
    expect(free.text).toBe(`Saved. ${UNDER_FIVE}`);
  });

  it('a ride too short for its session but over five minutes is a ride on its own, and listed', async () => {
    await db.recordings.put(rec({}, 320));
    const r = await uploadRide('rec1');
    expect(r.text).toMatch(/Too short to count as/);
    expect((await db.rides.get(r.activityId!))!.notTraining).toBeUndefined();
  });

  it('a ride from before this version that was waiting is saved, not lost', async () => {
    await db.recordings.put(rec({ error: 'Intervals.icu is not connected on this device.' }));
    expect(await waitingRides()).toHaveLength(1);
    expect(await sendWaitingRides()).toEqual({ sent: 1, left: 0 });
    expect(await waitingRides()).toEqual([]);
    expect(await db.rides.count()).toBe(1);
  });

  it('the rider\'s device recorded it too, and its recording arrives later with no data service: the device\'s is kept', async () => {
    await db.recordings.put(rec({ rpe: 5 }));
    const saved = await uploadRide('rec1');
    // The device's own file of the same hour, started twenty seconds earlier (from Garmin with the rider's key, or picked by hand).
    const t = Array.from({ length: 3620 }, (_, i) => i);
    const file = encodeFitActivity({ id: 'a', date: d, startTime: at(t0 - 20_000), name: 'x', type: 'Ride', sport: 'ride', seconds: 3620 } as never, { time: t, watts: t.map(() => 198), heartrate: t.map(() => 141) });
    const parsed = await readActivityFile('edge.fit', file);
    const device = await addActivity(parsed as never, file, profile);
    expect(device).not.toBe('already');                                         // not quietly taken for Antogo's own
    expect(await db.rides.count()).toBe(2);
    const swaps = await applyGarminRule();
    expect(swaps).toHaveLength(1);
    const left = await db.rides.toArray();
    expect(left.map((x) => x.id)).toEqual([(device as { id: string }).id]);
    expect(await db.rides.get(saved.activityId!)).toBeUndefined();
    expect(await db.planned.get('p1')).toMatchObject({ status: 'completed', activityId: left[0].id });
    expect(await db.recordings.get('rec1')).toMatchObject({ status: 'superseded', supersededBy: left[0].id });
  });
});
