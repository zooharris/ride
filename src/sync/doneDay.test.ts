import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addDays, today } from '../engine/load';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { backToPlannedDay, toDoneDay } from './doneDay';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

// A session done on a different day from the one planned (13 Nov 2026).
const lift = { id: 'gen-heavy', name: 'Heavy upper body (short)', kind: 'strength', minutes: 30, source: 'generated', family: 'recovery', phases: ['any'], bases: ['power', 'hr'], setting: 'indoor', blocks: [],
  exercises: [{ name: 'Dumbbell bench press', sets: 3, reps: '5', cue: 'c', equipment: ['dumbbells'] }, { name: 'Farmer carry', sets: 3, reps: '40 m', cue: 'c', equipment: ['dumbbells'] }] } as unknown as Workout;
const rec = (id: string, date: string, seconds = 1800, extra: Partial<Ride> = {}): Ride => ({ id, name: 'Heavy upper body', type: 'WeightTraining', date, startTime: `${date}T08:00:00`, sport: 'strength', seconds, elapsedSeconds: seconds, ...extra });
const yesterday = () => addDays(today(), -1);
const tomorrow = () => addDays(today(), 1);

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.workouts.put(lift);
});

describe('the rule', () => {
  it('moves to the recording day and remembers the planned day; same day changes nothing', () => {
    expect(toDoneDay({ date: '2026-11-12' }, '2026-11-12').patch).toEqual({});
    expect(toDoneDay({ date: '2026-11-12' }, '2026-11-13').patch).toEqual({ date: '2026-11-13', plannedFor: '2026-11-12' });
    // A second move keeps the first planned day.
    expect(toDoneDay({ date: '2026-11-13', plannedFor: '2026-11-12' }, '2026-11-14').patch.plannedFor).toBe('2026-11-12');
  });
  it('takes a sent copy off the device only when its planned day is still to come', () => {
    expect(toDoneDay({ date: tomorrow(), icuEventId: 7 }, today()).dropEvent).toBe(7);
    expect(toDoneDay({ date: yesterday(), icuEventId: 7 }, today()).dropEvent).toBeUndefined();
  });
  it('undo goes back to the planned day, missed or to do as that day requires', () => {
    expect(backToPlannedDay({ date: today(), plannedFor: yesterday(), icuEventId: 3 })).toMatchObject({ date: yesterday(), status: 'missed', plannedFor: undefined });
    expect(backToPlannedDay({ date: today(), plannedFor: tomorrow() })).toMatchObject({ date: tomorrow(), status: 'planned' });
  });
});

describe('matching by hand across days', () => {
  it('the reported case: planned yesterday, done today under another name, matched by hand', async () => {
    const { matchByHand, renameActivity } = await import('./records');
    const p: PlannedWorkout = { id: 'p', date: yesterday(), workoutId: lift.id, basis: 'power', status: 'missed', icuEventId: 11 };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    let after = (await db.planned.get('p'))!;
    expect(after.date).toBe(today());
    expect(after.plannedFor).toBe(yesterday());
    expect(after.status).toBe('completed');
    expect(after.icuEventId).toBe(11);   // its day has passed: nothing on the device to take off
    // Today and the calendar: one entry, on today, holding the recording; nothing left on yesterday.
    expect(await db.planned.where('date').equals(today()).count()).toBe(1);
    expect(await db.planned.where('date').equals(yesterday()).count()).toBe(0);
    // The record, the effort and a renamed activity survive the launch re-check.
    await db.planned.update('p', { rpe: 7, done: { exercises: [{ name: 'Farmer carry', sets: 2 }], editedAt: 'x' } });
    await renameActivity((await db.rides.get('r'))!, 'Heavy upper body (short)').catch(() => {});
    const { recheckMatches } = await import('./syncService');
    await recheckMatches();
    after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: today(), plannedFor: yesterday(), status: 'completed', activityId: 'r', rpe: 7 });
    expect(after.done?.exercises?.[0].name).toBe('Farmer carry');
  });
  it('done a day early: moves to today, comes off the device, and stays done', async () => {
    const { matchByHand } = await import('./records');
    const p: PlannedWorkout = { id: 'p', date: tomorrow(), workoutId: lift.id, basis: 'power', status: 'sent', icuEventId: 12, sentBasis: 'power' };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    const after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: today(), plannedFor: tomorrow(), status: 'completed' });
    expect(after.icuEventId).toBeUndefined();
    expect(after.sentBasis).toBeUndefined();
  });
  it('a same-day match behaves as before', async () => {
    const { matchByHand } = await import('./records');
    const p: PlannedWorkout = { id: 'p', date: today(), workoutId: lift.id, basis: 'power', status: 'sent', icuEventId: 13 };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    const after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: today(), status: 'completed', icuEventId: 13 });
    expect(after.plannedFor).toBeUndefined();
  });
});

describe('undoing a match puts the session back', () => {
  it('"This was a different workout"', async () => {
    const { matchByHand } = await import('./records');
    const { unmatchRecording } = await import('./syncService');
    const p: PlannedWorkout = { id: 'p', date: yesterday(), workoutId: lift.id, basis: 'power', status: 'missed' };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    await unmatchRecording('p');
    const after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: yesterday(), status: 'missed' });
    expect(after.plannedFor).toBeUndefined();
    expect(after.activityId).toBeUndefined();
    expect(after.notActivityIds).toContain('r');
  });
  it('done early and undone: back on tomorrow, to do and ready to send again', async () => {
    const { matchByHand } = await import('./records');
    const { unmatchRecording } = await import('./syncService');
    const p: PlannedWorkout = { id: 'p', date: tomorrow(), workoutId: lift.id, basis: 'power', status: 'sent', icuEventId: 14 };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    await unmatchRecording('p');
    expect(await db.planned.get('p')).toMatchObject({ date: tomorrow(), status: 'planned' });
  });
  it('the automatic undo, when the recording no longer counts', async () => {
    const { recheckMatches } = await import('./syncService');
    // Matched by Intervals.icu's own link and moved, then the recording turns out to be a few seconds long.
    await db.planned.put({ id: 'p', date: today(), plannedFor: yesterday(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'blip' });
    await db.rides.put(rec('blip', today(), 20));
    await recheckMatches();
    const after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: yesterday(), status: 'missed' });
    expect(after.plannedFor ?? after.activityId).toBeUndefined();
  });
  it('a session the rider had moved, then done on yet another day, goes back to where the rider put it', async () => {
    const { matchByHand } = await import('./records');
    const { unmatchRecording } = await import('./syncService');
    const tue = addDays(today(), -2), wed = yesterday();
    const p: PlannedWorkout = { id: 'p', date: wed, movedFrom: tue, userEdited: true, workoutId: lift.id, basis: 'power', status: 'missed' };
    await db.planned.put(p);
    await db.rides.put(rec('r', today()));
    await matchByHand(p, lift, (await db.rides.get('r'))!);
    expect(await db.planned.get('p')).toMatchObject({ date: today(), plannedFor: wed, movedFrom: tue });
    await unmatchRecording('p');
    const after = (await db.planned.get('p'))!;
    expect(after).toMatchObject({ date: wed, movedFrom: tue });
    expect(after.plannedFor).toBeUndefined();
  });
});

describe('automatic pairing across days', () => {
  it('Intervals.icu\'s own link to an event on another day: the session moves, and stays matched', async () => {
    const { recheckMatches } = await import('./syncService');
    await db.planned.put({ id: 'p', date: yesterday(), workoutId: lift.id, basis: 'power', status: 'missed', icuEventId: 21 });
    await db.rides.put(rec('r', today(), 1800, { pairedEventId: 21, name: 'Something else' }));
    await recheckMatches();
    expect(await db.planned.get('p')).toMatchObject({ date: today(), plannedFor: yesterday(), status: 'completed', activityId: 'r' });
    await recheckMatches();
    expect(await db.planned.get('p')).toMatchObject({ date: today(), plannedFor: yesterday(), status: 'completed', activityId: 'r' });
  });
});

describe('matches made before this build', () => {
  it('move to their recording day, across all history; same-day ones are untouched; a second run changes nothing', async () => {
    const { moveDoneToTheirDay } = await import('./syncService');
    const old = addDays(today(), -60);
    await db.planned.bulkPut([
      { id: 'cross', date: yesterday(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'r1', matchedByHand: true, rpe: 6 },
      { id: 'old', date: addDays(old, -1), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'r2', matchedByHand: true },
      { id: 'same', date: today(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'r3' },
      { id: 'logged', date: yesterday(), workoutId: lift.id, basis: 'power', status: 'completed', loggedSeconds: 1800, manualActivityId: 'm1', activityId: 'm1' },
    ]);
    await db.rides.bulkPut([rec('r1', today()), rec('r2', old), rec('r3', today()), rec('m1', today())]);
    expect(await moveDoneToTheirDay()).toBe(2);
    expect(await db.planned.get('cross')).toMatchObject({ date: today(), plannedFor: yesterday(), rpe: 6 });
    expect(await db.planned.get('old')).toMatchObject({ date: old, plannedFor: addDays(old, -1) });
    expect((await db.planned.get('same'))!.plannedFor).toBeUndefined();
    expect((await db.planned.get('logged'))!.date).toBe(yesterday());
    expect(await moveDoneToTheirDay()).toBe(0);
  });
});
