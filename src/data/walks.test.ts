import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { bandTssPerHour, bandWords, walkBandWords, walkZoneWords } from '../engine/foot';
import { generateWalk, retargetWorkout } from '../engine/sessions';
import { readyMadeSessions } from '../library/sessions';
import { addDays, today } from '../engine/load';
import type { Profile, Workout } from '../engine/types';
import { DEFAULT_PROFILE } from './db';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

// Todd's numbers on 23 Oct 2026: foot threshold 158, foot tops 120/135/148/158/170/178, max 180.
const todd: Profile = { ...DEFAULT_PROFILE, lthr: 154, maxHr: 186, footLthr: 158, footHrZoneMode: 'abs', footHrZoneTops: [120, 135, 148, 158, 170, 178] };

describe('Batch 6 A: walks are easy by default', () => {
  it('a generated walk has no minimum, a ceiling at the top of zone 2, and an honest load', () => {
    const w = generateWalk({ minutes: 30, where: 'outdoor', reason: 'x' });
    expect(w.walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(w.name).toBe('Easy walk 30 min');
    expect(w.estimatedTss).toBeGreaterThanOrEqual(10);
    expect(w.estimatedTss).toBeLessThanOrEqual(16);
    const pack = generateWalk({ minutes: 30, packKg: 6.8, where: 'outdoor', reason: 'x' });
    expect(pack.name).toBe('Easy walk 30 min with a 15 lb pack');
    expect(pack.estimatedTss).toBeGreaterThanOrEqual(12);
    expect(pack.estimatedTss).toBeLessThanOrEqual(15);
  });

  it('a recovery stroll costs less than an easy walk, and an easy walk less than a zone 2 walk', () => {
    expect(bandTssPerHour({ zoneLow: 0, zoneHigh: 2 })).toBeLessThan(bandTssPerHour({ zoneLow: 0, zoneHigh: 3 }));
    expect(bandTssPerHour({ zoneLow: 0, zoneHigh: 3 })).toBeLessThan(bandTssPerHour({ zoneLow: 2, zoneHigh: 3 }));
    expect(Math.round(bandTssPerHour({ zoneLow: 0, zoneHigh: 3 }))).toBe(24);   // what Todd's recorded walks score an hour
  });

  it('reads in words and beats on the rider’s foot table', () => {
    expect(bandWords({ zoneLow: 0, zoneHigh: 3 }, todd)).toBe('up to the top of zone 2 (up to 135 bpm)');
    expect(bandWords({ zoneLow: 2, zoneHigh: 3 }, todd)).toBe('zone 2 (121–135 bpm)');
  });

  it('an older walk written as shares of max reads from its beats, never "zone 2 into lower zone 2"', () => {
    const old = { minutes: 30, hrLow: 0.6, hrHigh: 0.7 };
    expect(walkZoneWords(old, todd)).toBe('top of zone 1 into zone 2');
    expect(walkBandWords(old, todd)).toMatch(/^about 11\d–130 bpm \(top of zone 1 into zone 2\)$/);
    expect(walkZoneWords({ minutes: 30, zoneLow: 2, zoneHigh: 3 }, todd)).toBe('zone 2');   // a walk written as zones is unchanged
  });

  it('the Library: easy, recovery, zone 2, brisk, hill and incline walks, unique ids', () => {
    const withTreadmill = readyMadeSessions(['bodyweight', 'treadmill']).filter((w) => w.kind === 'walk');
    const without = readyMadeSessions(['bodyweight']).filter((w) => w.kind === 'walk');
    expect(withTreadmill).toHaveLength(21);
    expect(without).toHaveLength(17);
    expect(new Set(withTreadmill.map((w) => w.id)).size).toBe(21);
    const byId = (id: string) => withTreadmill.find((w) => w.id === id)!;
    expect(byId('lib-walk-30').walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(byId('lib-walk-30').name).toBe('Easy walk 30 min');
    expect(byId('lib-walk-ruck-60').walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(byId('lib-walk-ruck-60').name).toBe('Ruck 60 min, 20 lb pack');
    expect(byId('lib-walk-zone2-45').walk).toMatchObject({ zoneLow: 2, zoneHigh: 3 });
    expect(byId('lib-walk-incline-60').walk).toMatchObject({ zoneLow: 2, zoneHigh: 3 });
    expect(byId('lib-walk-hills-30').walk).toMatchObject({ zoneLow: 2, zoneHigh: 3.5 });
    expect(byId('lib-walk-120').name).toBe('Long walk 2:00');
    for (const w of withTreadmill) {
      expect(w.estimatedTss).toBeGreaterThan(0);
      if (w.walk?.zoneLow === 0) expect(w.purpose).not.toMatch(/zone 2/i);
    }
  });
});

describe('Batch 6 A6: the one-time re-target', () => {
  it('converts the plan’s old walks and old runs, and leaves anything else', () => {
    const legacy: Workout = { ...generateWalk({ minutes: 30, where: 'outdoor', reason: 'Too short a window for a ride worth doing; a zone 2 walk uses it well and adds the impact loading cycling lacks.' }), name: 'Zone 2 walk 30 min', walk: { minutes: 30, hrLow: 0.6, hrHigh: 0.7 } };
    const w = retargetWorkout(legacy, todd)!;
    expect(w.walk).toEqual({ minutes: 30, zoneLow: 0, zoneHigh: 3 });
    expect(w.name).toBe('Easy walk 30 min');
    expect(w.purpose).toContain('an easy walk uses it well');
    expect(w.estimatedTss).toBe(12);
    expect(retargetWorkout({ ...legacy, walk: { minutes: 30, zoneLow: 2, zoneHigh: 3 } }, todd)?.walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(retargetWorkout(w, todd)).toBeNull();                                                         // already easy: never again
    expect(retargetWorkout({ ...legacy, walk: { minutes: 30, zoneLow: 2.5, zoneHigh: 3.5 } }, todd)).toBeNull();   // a brisk walk is a choice
    const run: Workout = { ...legacy, kind: 'run', walk: undefined, name: 'Easy run', run: { steps: [{ seconds: 1800, hrLow: 0.65, hrHigh: 0.75 }, { seconds: 60, repeat: 4, hrLow: 0.8, hrHigh: 0.88, recoverSeconds: 90, recoverLow: 0, recoverHigh: 0.65 }] } };
    const r = retargetWorkout(run, todd)!;
    for (const s of r.run!.steps) { expect(s.band).toBeTruthy(); expect(s.hrLow).toBeUndefined(); expect(s.hrHigh).toBeUndefined(); }
    expect(r.run!.steps[1].recoverBand).toBeTruthy();
    expect(r.run!.steps[1].recoverHigh).toBeUndefined();
    expect(retargetWorkout(r, todd)).toBeNull();
  });
});

describe('Batch 6 A6/A7: the calendar is converted once, and what was on the Garmin is sent again', () => {
  beforeEach(async () => { await db.delete(); await db.open(); vi.restoreAllMocks(); });

  const oldWalk = (id: string): Workout => ({ ...generateWalk({ minutes: 30, where: 'outdoor', reason: 'r' }), id, name: 'Zone 2 walk 30 min', walk: { minutes: 30, hrLow: 0.6, hrHigh: 0.7 } });

  it('a plan walk converts; a hand-added zone 2 walk, an edited one, and a done one do not', async () => {
    const { retargetFootSessions } = await import('../ui/planService');
    const t = today();
    await db.profile.put({ ...todd, id: 'me' });
    await db.workouts.bulkPut([oldWalk('g1'), { ...oldWalk('mine1'), walk: { minutes: 30, zoneLow: 2, zoneHigh: 3 } }, oldWalk('g2'), oldWalk('g3')]);
    await db.planned.bulkPut([
      { id: 'p1', date: t, workoutId: 'g1', basis: 'hr', status: 'planned', planId: 'plan' },
      { id: 'p2', date: t, workoutId: 'mine1', basis: 'hr', status: 'planned' },
      { id: 'p3', date: addDays(t, 1), workoutId: 'g2', basis: 'hr', status: 'planned', planId: 'plan', userEdited: true },
      { id: 'p4', date: addDays(t, -1), workoutId: 'g3', basis: 'hr', status: 'completed', planId: 'plan' },
    ]);
    const r = await retargetFootSessions(null);
    expect(r).toMatchObject({ walks: 1, runs: 0, resent: 0 });
    expect((await db.workouts.get('g1'))!.walk).toEqual({ minutes: 30, zoneLow: 0, zoneHigh: 3 });
    expect((await db.workouts.get('mine1'))!.walk).toMatchObject({ zoneLow: 2, zoneHigh: 3 });
    expect((await db.workouts.get('g2'))!.walk).toMatchObject({ hrLow: 0.6 });
    expect((await db.workouts.get('g3'))!.walk).toMatchObject({ hrLow: 0.6 });
    expect(await retargetFootSessions(null)).toMatchObject({ walks: 0, runs: 0 });   // idempotent
  });

  it('a converted walk already on the Garmin is sent again in place of the old copy; without credentials it waits', async () => {
    const intervals = await import('../sync/intervals');
    const del = vi.spyOn(intervals, 'deleteEvent').mockResolvedValue();
    const send = vi.spyOn(intervals, 'sendWorkout').mockResolvedValue(222);
    const { retargetFootSessions } = await import('../ui/planService');
    const t = today();
    await db.profile.put({ ...todd, id: 'me' });
    await db.workouts.put(oldWalk('g1'));
    await db.planned.put({ id: 'p1', date: t, workoutId: 'g1', basis: 'hr', status: 'sent', icuEventId: 111, planId: 'plan' });
    expect(await retargetFootSessions(null)).toMatchObject({ walks: 0 });   // no credentials here: left for a device that has them
    const c = { athleteId: 'i1', apiKey: 'k' };
    expect(await retargetFootSessions(c)).toMatchObject({ walks: 1, resent: 1, failed: 0 });
    expect(del).toHaveBeenCalledWith(c, 111);
    expect(send.mock.calls[0][1].walk).toMatchObject({ zoneLow: 0, zoneHigh: 3 });
    expect(await db.planned.get('p1')).toMatchObject({ status: 'sent', icuEventId: 222 });
  });

  it('a failed re-send leaves the session unsent, for Send N to Garmin', async () => {
    const intervals = await import('../sync/intervals');
    vi.spyOn(intervals, 'deleteEvent').mockResolvedValue();
    vi.spyOn(intervals, 'sendWorkout').mockRejectedValue(new Error('offline'));
    const { retargetFootSessions } = await import('../ui/planService');
    await db.profile.put({ ...todd, id: 'me' });
    await db.workouts.put(oldWalk('g1'));
    await db.planned.put({ id: 'p1', date: today(), workoutId: 'g1', basis: 'hr', status: 'sent', icuEventId: 111, planId: 'plan' });
    expect(await retargetFootSessions({ athleteId: 'i1', apiKey: 'k' })).toMatchObject({ walks: 1, resent: 0, failed: 1 });
    const p = await db.planned.get('p1');
    expect(p?.status).toBe('planned');
    expect(p?.icuEventId).toBeUndefined();
  });
});

describe('Batch 6 B: plan sessions are stored as Library workouts', () => {
  beforeEach(async () => { await db.delete(); await db.open(); vi.restoreAllMocks(); });

  it('a Library ride by id; a ready-made walk as its own copy; strength as generated; nothing is ever added to the Library', async () => {
    const { storeSessionWorkout } = await import('../ui/planService');
    const { LIBRARY } = await import('../library/workouts');
    const { generateStrength } = await import('../engine/sessions');
    const lib = LIBRARY.find((w) => w.id === 'trail-long-180')!;
    expect(await storeSessionWorkout(lib)).toBe('trail-long-180');
    expect(await db.workouts.count()).toBe(0);                                   // never copied
    const ready = readyMadeSessions(['bodyweight']).find((w) => w.id === 'lib-walk-30')!;
    const copy = await storeSessionWorkout(ready);
    expect(copy).toMatch(/^gen-/);
    expect((await db.workouts.get(copy))?.name).toBe('Easy walk 30 min');
    const str = generateStrength({ level: 'build', minutes: 40, equipment: ['bodyweight'], variant: 'A', weekInBlock: 2, reason: 'r' });
    expect(await storeSessionWorkout(str)).toBe(str.id);
    expect((await db.workouts.get(str.id))?.source).toBe('generated');
    expect((await db.workouts.toArray()).filter((w) => w.source === 'mine')).toEqual([]);
  });

  it('a session already on the Garmin is re-pointed only when the Library workout is still the same session', async () => {
    const { nameRideSessions } = await import('../ui/planService');
    const { generateSession } = await import('../engine/generate');
    const t = today();
    const far = generateSession({ type: 'threshold', minutes: 240, progression: 0.5, outdoor: true, reason: 'r' });   // nearest Library threshold ride is far off
    await db.workouts.bulkPut([{ ...far, id: 'f1' }, { ...far, id: 'f2' }]);
    await db.planned.bulkPut([
      { id: 'q1', date: t, workoutId: 'f1', basis: 'power', status: 'sent', icuEventId: 9, planId: 'plan' },
      { id: 'q2', date: t, workoutId: 'f2', basis: 'power', status: 'planned', planId: 'plan' },
    ]);
    expect(await nameRideSessions()).toBe(1);
    expect((await db.planned.get('q1'))?.workoutId).toBe('f1');                   // on the watch, and the Library ride differs: left for the re-check
    expect((await db.planned.get('q2'))?.workoutId).not.toBe('f2');               // not sent: the nearest Library ride
  });

  it('workouts Part B added to the Library are retired: sessions to come move to the nearest Library workout; one a done session uses is kept', async () => {
    const { retireCreatedWorkouts } = await import('../ui/planService');
    const { generateSession } = await import('../engine/generate');
    const t = today();
    const made = { ...generateSession({ type: 'tempo', minutes: 60, progression: 0.5, outdoor: false, reason: 'r' }), source: 'mine' as const, name: 'Ashburn' };
    await db.workouts.bulkPut([{ ...made, id: 'lib-gen-tempo-60' }, { ...made, id: 'lib-gen-tempo-61' }, { ...made, id: 'mine-keep', name: 'My tempo' }]);
    await db.planned.bulkPut([
      { id: 'r1', date: t, workoutId: 'lib-gen-tempo-60', basis: 'power', status: 'planned', planId: 'plan' },
      { id: 'r2', date: addDays(t, -2), workoutId: 'lib-gen-tempo-61', basis: 'power', status: 'completed', planId: 'plan' },
    ]);
    expect(await retireCreatedWorkouts()).toBe(1);
    const r1 = await db.planned.get('r1');
    expect(r1?.workoutId).not.toMatch(/^lib-gen-/);
    expect(await db.workouts.get('lib-gen-tempo-60')).toBeUndefined();             // no longer used: gone
    expect(await db.workouts.get('lib-gen-tempo-61')).toBeTruthy();               // a done session's plan is history
    expect(await db.workouts.get('mine-keep')).toBeTruthy();                      // the rider's own are never touched
    expect(await retireCreatedWorkouts()).toBe(0);
  });

  it('the calendar’s generated plan sessions take their Library names once; edited, moved, done and hand-added ones stay', async () => {
    const { nameRideSessions } = await import('../ui/planService');
    const { generateSession } = await import('../engine/generate');
    const t = today();
    const long = generateSession({ type: 'long', minutes: 180, progression: 0.5, outdoor: true, reason: 'r' });
    const mk = (id: string) => ({ ...long, id });
    await db.workouts.bulkPut([mk('g1'), mk('g2'), mk('g3'), mk('g4'), mk('g5')]);
    await db.planned.bulkPut([
      { id: 'p1', date: t, workoutId: 'g1', basis: 'power', status: 'sent', icuEventId: 7, planId: 'plan' },
      { id: 'p2', date: t, workoutId: 'g2', basis: 'power', status: 'planned', planId: 'plan', userEdited: true },
      { id: 'p3', date: t, workoutId: 'g3', basis: 'power', status: 'planned', planId: 'plan', movedFrom: addDays(t, -1) },
      { id: 'p4', date: addDays(t, -1), workoutId: 'g4', basis: 'power', status: 'completed', planId: 'plan' },
      { id: 'p5', date: t, workoutId: 'g5', basis: 'power', status: 'planned' },
    ]);
    expect(await nameRideSessions()).toBe(1);
    const p1 = await db.planned.get('p1');
    expect(p1?.workoutId).not.toBe('g1');
    expect(p1?.icuEventId).toBe(7);                                              // the Garmin copy is left alone (the same session)
    expect((await db.planned.get('p2'))?.workoutId).toBe('g2');
    expect((await db.planned.get('p3'))?.workoutId).toBe('g3');
    expect((await db.planned.get('p4'))?.workoutId).toBe('g4');
    expect((await db.planned.get('p5'))?.workoutId).toBe('g5');
    expect(await db.workouts.get('g1')).toBeUndefined();                          // the orphaned copy is pruned
    expect(await nameRideSessions()).toBe(0);                                     // idempotent
  });
});
