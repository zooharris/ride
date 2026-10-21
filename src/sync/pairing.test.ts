import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { addDays, today } from '../engine/load';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const lift = { id: 'gen-lift', name: 'Strength A: legs and trunk', kind: 'strength', minutes: 40, source: 'generated', family: 'recovery', phases: ['any'], bases: ['power', 'hr'], setting: 'indoor', blocks: [],
  exercises: [{ name: 'Goblet squat', sets: 3, reps: '10', cue: 'c', equipment: ['dumbbells'] }] } as unknown as Workout;
const rec = (id: string, seconds: number, date = today()): Ride => ({ id, name: 'Cardio', type: 'Workout', date, startTime: `${date}T10:00:00`, sport: 'strength', seconds, elapsedSeconds: seconds });

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.workouts.put(lift);
});

describe('matching rules at launch, with no network', () => {
  it('takes an accidental 24-second recording off a session it was matched to', async () => {
    const { recheckMatches } = await import('./syncService');
    const p: PlannedWorkout = { id: 'p1', date: today(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'blip', icuEventId: 9 };
    await db.planned.put(p);
    await db.rides.put(rec('blip', 24));
    expect(await recheckMatches()).toBe(1);
    const after = await db.planned.get('p1');
    expect(after?.status).toBe('sent');
    expect(after?.activityId).toBeUndefined();
  });
  it('pairs a believable recording, records what was done, and keeps hand-logged sessions', async () => {
    const { recheckMatches } = await import('./syncService');
    await db.planned.bulkPut([
      { id: 'p2', date: today(), workoutId: lift.id, basis: 'power', status: 'sent' },
      { id: 'p3', date: addDays(today(), -1), workoutId: lift.id, basis: 'power', status: 'completed', loggedSeconds: 1800, rpe: 6 },
    ]);
    await db.rides.put(rec('real', 2400));
    await recheckMatches();
    const p2 = await db.planned.get('p2');
    expect(p2?.status).toBe('completed');
    expect(p2?.activityId).toBe('real');
    expect(p2?.done?.exercises?.[0]).toMatchObject({ name: 'Goblet squat', sets: 3, reps: '10' });
    expect((await db.planned.get('p3'))?.status).toBe('completed');
  });
  it('lets the effort rating set a strength session’s load', async () => {
    const { recheckMatches } = await import('./syncService');
    await db.planned.put({ id: 'p4', date: today(), workoutId: lift.id, basis: 'power', status: 'sent', rpe: 8 });
    await db.rides.put({ ...rec('lifted', 2400), tss: 5 });
    await recheckMatches();
    expect((await db.rides.get('lifted'))?.tss).toBeGreaterThan(30);
  });
  it('deletes a recording: the session it completed goes back to to-do, a hand-logged one is undone', async () => {
    const { deleteRecording } = await import('./records');
    await db.planned.bulkPut([
      { id: 'q1', date: today(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'oops', icuEventId: 3, rpe: 6, done: { exercises: [] } },
      { id: 'q2', date: today(), workoutId: lift.id, basis: 'power', status: 'completed', activityId: 'man', manualActivityId: 'man', loggedSeconds: 1200 },
    ]);
    await db.rides.bulkPut([rec('oops', 1800), rec('man', 1200)]);
    await deleteRecording('oops');
    await deleteRecording('man');
    expect(await db.rides.count()).toBe(0);
    expect(await db.planned.get('q1')).toMatchObject({ status: 'sent' });
    expect((await db.planned.get('q1'))?.done).toBeUndefined();
    expect(await db.planned.get('q2')).toMatchObject({ status: 'planned' });
    expect((await db.planned.get('q2'))?.loggedSeconds).toBeUndefined();
  });
  it('keeps a hand match whatever the rules say, and the rider can undo it', async () => {
    const { recheckMatches, unmatchRecording } = await import('./syncService');
    const { matchByHand } = await import('./records');
    // done a day late and only 4 minutes long: the rules would never match it
    await db.planned.put({ id: 'h1', date: addDays(today(), -1), workoutId: lift.id, basis: 'power', status: 'missed' });
    await db.rides.put(rec('late', 240));
    await matchByHand((await db.planned.get('h1'))!, lift, (await db.rides.get('late'))!);
    await recheckMatches();
    expect(await db.planned.get('h1')).toMatchObject({ status: 'completed', activityId: 'late', matchedByHand: true });
    expect((await db.planned.get('h1'))?.done?.exercises?.[0].name).toBe('Goblet squat');
    await unmatchRecording('h1');
    await recheckMatches();
    expect((await db.planned.get('h1'))?.status).toBe('missed');
  });
  it('applies the rider\u2019s kind, effort and leave-out edits to an unplanned activity', async () => {
    const { setActivityKind, setExcluded, saveActivityEffort } = await import('./records');
    await db.rides.put({ ...rec('walky', 2700), type: 'Run', sport: 'other', averageSpeedMs: 2.5, averageHr: 100 });
    await setActivityKind((await db.rides.get('walky'))!, 'walk');
    expect((await db.rides.get('walky'))?.sport).toBe('walk');
    await db.rides.put({ ...rec('lift2', 1800), tss: 4 });
    await saveActivityEffort((await db.rides.get('lift2'))!, 8);
    const rated = (await db.rides.get('lift2'))!.tss!;
    expect(rated).toBeGreaterThan(30);
    await setExcluded((await db.rides.get('lift2'))!, true);
    expect(await db.rides.get('lift2')).toMatchObject({ tss: 0, uncountedTss: rated });
    await setExcluded((await db.rides.get('lift2'))!, false);
    expect((await db.rides.get('lift2'))?.tss).toBe(rated);
  });
});

describe('a done session stays done unless its recording is really gone', () => {
  const sessionDone = (id: string, activityId: string, extra: Partial<PlannedWorkout> = {}): PlannedWorkout => ({ id, date: addDays(today(), -3), workoutId: lift.id, basis: 'power', status: 'completed', activityId, rpe: 8, done: { exercises: [{ name: 'Goblet squat', sets: 3, reps: '10', weight: 35 }] }, ...extra });
  it('a recording this device has not synced does not undo the session or wipe its record', async () => {
    const { recheckMatches } = await import('./syncService');
    await db.planned.put(sessionDone('d1', 'on-the-phone'));
    await recheckMatches();
    const after = await db.planned.get('d1');
    expect(after?.status).toBe('completed');
    expect(after?.done?.exercises?.[0]).toMatchObject({ weight: 35 });
    expect(after?.rpe).toBe(8);
  });
  it('a recording that is here but no longer fits does undo it; one deleted in Intervals.icu does too', async () => {
    const { applyPairing } = await import('./syncService');
    await db.planned.bulkPut([sessionDone('d2', 'blip'), sessionDone('d3', 'deleted')]);
    const blip = rec('blip', 20, addDays(today(), -3));
    await db.rides.put(blip);
    const planned = await db.planned.toArray();
    await applyPairing([blip], planned, (id) => (id === lift.id ? lift : undefined), null, { ftp: 200, lthr: 160 } as never, { gone: new Set(['deleted']) });
    expect((await db.planned.get('d2'))?.status).toBe('missed');
    expect((await db.planned.get('d3'))?.status).toBe('missed');
  });
  it('a hand match stands even when the recording no longer fits the rules', async () => {
    const { applyPairing } = await import('./syncService');
    await db.planned.put(sessionDone('d4', 'tiny', { matchedByHand: true }));
    const tiny = rec('tiny', 60, addDays(today(), -3));
    await applyPairing([tiny], await db.planned.toArray(), (id) => (id === lift.id ? lift : undefined), null, null);
    expect((await db.planned.get('d4'))?.status).toBe('completed');
  });
  it('the activity the app made for a hand-logged session does not replace the record the rider edited', async () => {
    const { recheckMatches } = await import('./syncService');
    await db.planned.put({ id: 'h1', date: today(), workoutId: lift.id, basis: 'power', status: 'completed', loggedSeconds: 1500, rpe: 7, manualActivityId: 'man', done: { exercises: [{ name: 'Goblet squat', sets: 3, reps: '10', weight: 35 }] } });
    await db.rides.put({ ...rec('man', 1500), name: lift.name });
    await recheckMatches();
    const after = await db.planned.get('h1');
    expect(after?.activityId).toBe('man');
    expect(after?.done?.exercises?.[0]).toMatchObject({ weight: 35 });
  });
});

describe('missed sessions and the best-fitting recording', () => {
  it('marks every past session still to do as missed, however old', async () => {
    const { markMissedAll } = await import('./syncService');
    await db.planned.bulkPut([
      { id: 'm1', date: addDays(today(), -40), workoutId: lift.id, basis: 'power', status: 'sent' },
      { id: 'm2', date: addDays(today(), -1), workoutId: lift.id, basis: 'power', status: 'planned' },
      { id: 'm3', date: today(), workoutId: lift.id, basis: 'power', status: 'planned' },
      { id: 'm4', date: addDays(today(), -5), workoutId: lift.id, basis: 'power', status: 'completed', loggedSeconds: 1200 },
    ]);
    expect(await markMissedAll()).toBe(2);
    expect((await db.planned.get('m1'))?.status).toBe('missed');
    expect((await db.planned.get('m3'))?.status).toBe('planned');
    expect((await db.planned.get('m4'))?.status).toBe('completed');
  });
  it('two rides planned and two recorded: the long recording completes the long ride', async () => {
    const { pairRecordings } = await import('./syncService');
    const rideW = (id: string, minutes: number) => ({ id, name: id, kind: 'ride', blocks: [{ steps: [{ seconds: minutes * 60, intensity: 0.65 }] }] } as unknown as Workout);
    const long = rideW('long', 180), spin = rideW('spin', 45);
    const planned: PlannedWorkout[] = [{ id: 'a', date: today(), workoutId: 'spin', basis: 'power', status: 'sent' }, { id: 'b', date: today(), workoutId: 'long', basis: 'power', status: 'sent' }];
    const rides: Ride[] = [{ ...rec('r-short', 2700), sport: 'ride', type: 'Ride', name: 'Herndon Road Cycling' }, { ...rec('r-long', 10500), sport: 'ride', type: 'Ride', name: 'Loudoun Road Cycling' }];
    const m = pairRecordings(planned, rides, (id) => (id === 'long' ? long : id === 'spin' ? spin : undefined));
    expect(m.get('b')?.id).toBe('r-long');
    expect(m.get('a')?.id).toBe('r-short');
  });
  it('a ride-typed recording named for the day’s strength session is not taken as the ride', async () => {
    const { pairRecordings, looksNamedAfter } = await import('./syncService');
    expect(looksNamedAfter('Strength A: legs and', 'Strength A: legs and trunk')).toBe(true);
    expect(looksNamedAfter('Herndon Road Cycling', 'Strength A: legs and trunk')).toBe(false);
    const rideW = { id: 'spin', name: 'Reston', kind: 'ride', blocks: [{ steps: [{ seconds: 2700, intensity: 0.65 }] }] } as unknown as Workout;
    const planned: PlannedWorkout[] = [{ id: 'a', date: today(), workoutId: 'spin', basis: 'power', status: 'sent' }, { id: 'b', date: today(), workoutId: lift.id, basis: 'power', status: 'sent' }];
    const rides: Ride[] = [{ ...rec('cut', 2400), sport: 'ride', type: 'Ride', name: 'Strength A: legs and' }];
    const m = pairRecordings(planned, rides, (id) => (id === 'spin' ? rideW : id === lift.id ? lift : undefined));
    expect(m.get('a')).toBeUndefined();
  });
});
