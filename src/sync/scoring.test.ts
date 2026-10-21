import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { today } from '../engine/load';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { isTrivialRecording, scoreActivity } from './syncService';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const profile = { ftp: 222, lthr: 169 };
const ride = (p: Partial<Ride>): Ride => ({ id: p.id ?? 'r', date: today(), startTime: '', name: 'Ride', type: 'Ride', sport: 'ride', seconds: 3600, ...p });

describe('scoring an activity', () => {
  it('scores a ride from power, else heart rate, else Intervals.icu, else an estimate from the time', () => {
    const power = ride({ normalizedPower: 180, ftpAtRide: 222, averageHr: 150, icuLoad: 99 });
    scoreActivity(power, profile);
    expect(power.tssBasis).toBe('power');
    expect(power.tss).toBe(66);
    const hr = ride({ averageHr: 149, icuLoad: 99 });
    scoreActivity(hr, profile);
    expect(hr.tssBasis).toBe('heart-rate');
    expect(hr.tss).toBe(53);
    const icu = ride({ icuLoad: 40 });
    scoreActivity(icu, profile);
    expect(icu).toMatchObject({ tss: 40, tssBasis: 'intervals' });
    const bare = ride({ seconds: 2544 });                      // a 42-minute ride with no strap and no meter
    scoreActivity(bare, profile);
    expect(bare).toMatchObject({ tss: 32, tssBasis: 'estimate' });
  });
  it('a ride at car speed with no power is not training', () => {
    const car = ride({ seconds: 979, averageSpeedMs: 17, averageHr: 90 });
    scoreActivity(car, profile);
    expect(car).toMatchObject({ tss: 0, notTraining: 'drive' });
  });
  it('a recording under five minutes is not training unless the rider matched it by hand', () => {
    expect(isTrivialRecording({ seconds: 78 })).toBe(true);
    expect(isTrivialRecording({ seconds: 60, elapsedSeconds: 400 })).toBe(false);
    const blip = ride({ seconds: 1, elapsedSeconds: 1, type: 'Workout', sport: 'strength', averageHr: 80 });
    scoreActivity(blip, profile);
    expect(blip).toMatchObject({ tss: 0, notTraining: 'trivial' });
    scoreActivity(blip, profile, { handMatched: true });
    expect(blip.notTraining).toBeUndefined();
    expect(blip.tssBasis).toBeDefined();
  });
  it('strength from a strap before Intervals.icu, and never Intervals.icu’s ride load for a session sent as a ride', () => {
    const strap = ride({ sport: 'strength', type: 'WeightTraining', seconds: 2400, averageHr: 110, icuLoad: 30 });
    scoreActivity(strap, profile);
    expect(strap.tssBasis).toBe('heart-rate');
    const asRide = ride({ sport: 'strength', type: 'Ride', seconds: 2400, icuLoad: 30 });
    scoreActivity(asRide, profile);
    expect(asRide).toMatchObject({ tss: 21, tssBasis: 'estimate' });
  });
});

describe('what the lists see', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  it('a hand-matched tiny recording stays a done session through a re-check', async () => {
    const lift = { id: 'lift', name: 'Strength A', kind: 'strength', minutes: 40, source: 'generated', family: 'recovery', phases: ['any'], bases: ['power', 'hr'], setting: 'indoor', blocks: [], exercises: [] } as unknown as Workout;
    await db.workouts.put(lift);
    await db.profile.put({ id: 'me', ...profile } as never);
    const blip = ride({ id: 'blip', seconds: 90, elapsedSeconds: 90, type: 'Workout', sport: 'strength', averageHr: 95 });
    scoreActivity(blip, profile);
    await db.rides.put(blip);
    const p: PlannedWorkout = { id: 'p1', date: today(), workoutId: lift.id, basis: 'power', status: 'sent' };
    await db.planned.put(p);
    const { matchByHand } = await import('./records');
    await matchByHand(p, lift, blip);
    const after = await db.rides.get('blip');
    expect(after?.notTraining).toBeUndefined();
    expect(after?.tssBasis).toBeDefined();
    expect((await db.planned.get('p1'))?.status).toBe('completed');
  });
});

describe('re-scoring once after a rule change', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  it('scores every stored activity by the current rules, once', async () => {
    const { rescoreAllOnce, SCORING_RULES } = await import('./syncService');
    await db.profile.put({ id: 'me', ...profile } as never);
    await db.rides.bulkPut([
      ride({ id: 'old-hr', date: '2026-06-20', seconds: 24180, averageHr: 149, tss: 524 }),          // scored by the old heart-rate formula
      ride({ id: 'old-bare', date: '2026-07-12', seconds: 2544, tss: 0 }),
      ride({ id: 'blip', date: '2026-08-24', seconds: 1, elapsedSeconds: 1, type: 'Workout', sport: 'strength', tss: 0 }),
    ]);
    expect(await rescoreAllOnce()).toBe(true);
    expect((await db.rides.get('old-hr'))?.tss).toBe(354);
    expect((await db.rides.get('old-bare'))).toMatchObject({ tss: 32, tssBasis: 'estimate' });
    expect((await db.rides.get('blip'))?.notTraining).toBe('trivial');
    expect((await db.settings.get('scoringRules'))?.value).toBe(SCORING_RULES);
    expect(await rescoreAllOnce()).toBe(false);
  });
});
