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
