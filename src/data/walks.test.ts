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
