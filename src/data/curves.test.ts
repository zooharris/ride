import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, DEFAULT_PROFILE } from './db';
import type { Ride } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

describe('Step 2b: the per-ride cache is re-read once for heart rate', () => {
  it('a record from before heart rate was kept is rebuilt; a current record is not; progress says it is a re-read', async () => {
    const { buildPowerCurves, BREATH_VERSION } = await import('../ui/powerCurves');
    const time = Array.from({ length: 1800 }, (_, i) => i);
    await db.streams.bulkPut([{ id: 'old', time, watts: time.map(() => 150), heartrate: time.map(() => 120) }, { id: 'new', time, watts: time.map(() => 150), heartrate: time.map(() => 120) }]);
    await db.powerCurves.bulkPut([{ id: 'old', date: '2026-10-20', w: [1] }, { id: 'new', date: '2026-10-21', w: [2], v: 2, bv: BREATH_VERSION, hv: 1 }]);
    const rides = ['old', 'new'].map((id, k) => ({ id, date: `2026-10-2${k}`, startTime: '', name: 'r', type: 'Ride', sport: 'ride', seconds: 1800, averagePower: 150 } as Ride));
    const seen: Array<{ done: number; total: number; rebuilding?: boolean }> = [];
    await new Promise<void>((res) => { buildPowerCurves(rides, (p) => { seen.push(p); if (p.done === p.total) res(); }, { profile: DEFAULT_PROFILE, sessionOf: () => undefined }); });
    expect(seen[0]).toMatchObject({ total: 1, rebuilding: true });
    // Part A5: the ride's highest 30-second heart rate is kept with it.
    expect((await db.powerCurves.get('old'))).toMatchObject({ v: 2, steadyAtHr: { seconds: 1200 }, hr30: 120, hv: 1 });
    expect((await db.powerCurves.get('new'))!.w).toEqual([2]);   // untouched
  });
});

describe('2A: a Garmin ride with breathing is learned from in the background pass', () => {
  it('its bands are kept, the first breathing day noted, the normal learned; on a later pass the ride gets its offset', async () => {
    const { buildPowerCurves, BREATH_NORMAL_KEY } = await import('../ui/powerCurves');
    const { getSetting } = await import('./db');
    const { FIRST_BREATHING_KEY } = await import('../player/breathRead');
    const { STREAMS_VERSION } = await import('./db');
    // The app's own date (local), not UTC: between 7pm and midnight Eastern the UTC date is already tomorrow.
    const { today } = await import('../engine/load');
    const date = today();
    const time = Array.from({ length: 3600 }, (_, i) => i);
    const ve = time.map((t) => 31 + ((t * 7) % 5) * 0.2), br = time.map((t) => 22 + ((t * 3) % 7) * 0.1);
    await db.streams.put({ id: 'garmin1', v: STREAMS_VERSION, time, watts: time.map(() => 160), heartrate: time.map(() => 130), ve, br, tv: ve.map((v, i) => v / br[i]) });
    const rides = [{ id: 'garmin1', date, startTime: '', name: 'Sunday Z2', type: 'Ride', sport: 'ride', seconds: 3600, averagePower: 160 } as Ride];
    const ctx = { profile: { ...DEFAULT_PROFILE, ftp: 250 }, sessionOf: () => undefined };
    const pass = () => new Promise<void>((res) => { buildPowerCurves(rides, (p) => { if (p.done === p.total) res(); }, ctx); });
    await pass();
    const rec = await db.powerCurves.get('garmin1');
    expect(rec!.veAtPower![0]).toMatchObject({ lo: 0.6, seconds: 3000 });
    expect(await getSetting(FIRST_BREATHING_KEY, '')).toBe(date);
    expect((await getSetting<{ rides: number } | undefined>(BREATH_NORMAL_KEY, undefined))!.rides).toBe(1);
    // A second pass (the record read again) has the normal to compare with: the offset goes on the Garmin ride's edit.
    await db.powerCurves.update('garmin1', { bv: 0 });
    await new Promise((r) => setTimeout(r, 20));
    await pass();
    expect((await db.activityEdits.get('garmin1'))?.breathOffset).toBeCloseTo(1, 1);
  });
});
