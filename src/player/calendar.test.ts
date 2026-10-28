import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { LIBRARY } from '../library/workouts';
import { addDays, today } from '../engine/load';
import { calendarEntryFor, longEnough } from './rides';
import { plannedSeconds } from '../sync/syncService';
import { pairRecordings } from '../sync/syncService';
import type { Recording } from './types';
import type { Ride } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const rides = LIBRARY.filter((w) => w.kind === 'ride');
const a = rides[0], b = rides[1];
const d = today();
const rec = (o: Partial<Recording>): Recording => ({
  id: 'r', status: 'finished', startedAt: `${d}T18:00:00`, startMs: Date.now(), date: d, name: a.name, basis: 'power', ftp: 240, lthr: 160,
  samples: [], laps: [], events: [], timerSeconds: 3600, distanceM: 0, savedMs: 0, workoutId: a.id, ...o,
});

beforeEach(async () => { await db.delete(); await db.open(); });

describe('a ride on the trainer goes on the calendar of the day it was ridden', () => {
  it('completes the session it was started from when that is today', async () => {
    await db.planned.add({ id: 'p1', date: d, workoutId: a.id, basis: 'power', status: 'sent' });
    const e = await calendarEntryFor(rec({ plannedId: 'p1' }), 'act1');
    expect(e).toMatchObject({ added: false, p: { id: 'p1', activityId: 'act1', matchedByHand: true } });
    expect(await db.planned.count()).toBe(1);
  });

  it('leaves a session planned for another day where it is, and adds a done copy today', async () => {
    const sat = addDays(d, 4);
    await db.planned.add({ id: 'sat', date: sat, workoutId: a.id, basis: 'power', status: 'planned' });
    const e = await calendarEntryFor(rec({ plannedId: 'sat' }), 'act2');
    expect(e?.added).toBe(true);
    expect(e?.p).toMatchObject({ date: d, workoutId: a.id, activityId: 'act2' });
    expect(e?.p.planId).toBeUndefined();
    expect(await db.planned.get('sat')).toMatchObject({ date: sat, status: 'planned' });
    expect((await db.planned.get('sat'))?.activityId).toBeUndefined();
  });

  it('uses the same workout already on today and not yet done, from the Library', async () => {
    await db.planned.add({ id: 'p2', date: d, workoutId: a.id, basis: 'power', status: 'planned' });
    const e = await calendarEntryFor(rec({}), 'act3');
    expect(e).toMatchObject({ added: false, p: { id: 'p2' } });
  });

  it('adds a Library ride not on the calendar, even with a different ride planned today, and keeps that one to do', async () => {
    await db.planned.add({ id: 'other', date: d, workoutId: b.id, basis: 'power', status: 'planned' });
    const e = await calendarEntryFor(rec({}), 'act4');
    expect(e?.added).toBe(true);
    // The automatic pairing gives the recording to the new entry, not to the other ride planned today.
    const ride = { id: 'act4', date: d, startTime: `${d}T18:00:00`, name: a.name, type: 'VirtualRide', sport: 'ride', seconds: 3600 } as Ride;
    const m = pairRecordings(await db.planned.toArray(), [ride], (id) => LIBRARY.find((w) => w.id === id));
    expect(m.get(e!.p.id)?.id).toBe('act4');
    expect(m.has('other')).toBe(false);
  });

  it('adds a second copy when the same workout today is already done (ridden twice)', async () => {
    await db.planned.add({ id: 'done', date: d, workoutId: a.id, basis: 'power', status: 'completed', activityId: 'old' });
    expect((await calendarEntryFor(rec({ plannedId: 'done' }), 'act5'))?.added).toBe(true);
  });

  it('puts nothing on the calendar for a free ride', async () => {
    expect(await calendarEntryFor(rec({ workoutId: undefined, name: 'Free ride' }), 'act6')).toBeUndefined();
  });
});

describe('a ride too short to count as its workout', () => {
  const len = plannedSeconds(a)!;
  it('does not count under five minutes', async () => {
    expect(await longEnough(rec({ timerSeconds: 240 }))).toBe(false);
  });
  it('does not count under a fifth of the workout, even past five minutes', async () => {
    const long = rides.find((w) => (plannedSeconds(w) ?? 0) >= 3600)!;
    const want = plannedSeconds(long)!;
    expect(await longEnough(rec({ workoutId: long.id, timerSeconds: Math.floor(want * 0.19) }))).toBe(false);
    expect(await longEnough(rec({ workoutId: long.id, timerSeconds: Math.ceil(want * 0.21) }))).toBe(true);
  });
  it('counts a partial ride over a fifth of the workout and five minutes', async () => {
    expect(await longEnough(rec({ timerSeconds: Math.max(300, Math.ceil(len * 0.25)) }))).toBe(true);
  });
  it('a free ride always counts (it completes nothing)', async () => {
    expect(await longEnough(rec({ workoutId: undefined, timerSeconds: 60 }))).toBe(true);
  });
});
