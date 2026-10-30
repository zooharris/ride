import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, DEFAULT_PROFILE } from './db';
import type { Ride } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

describe('Step 2b: the per-ride cache is re-read once for heart rate', () => {
  it('a record from before heart rate was kept is rebuilt; a v2 record is not; progress says it is a re-read', async () => {
    const { buildPowerCurves } = await import('../ui/powerCurves');
    const time = Array.from({ length: 1800 }, (_, i) => i);
    await db.streams.bulkPut([{ id: 'old', time, watts: time.map(() => 150), heartrate: time.map(() => 120) }, { id: 'new', time, watts: time.map(() => 150), heartrate: time.map(() => 120) }]);
    await db.powerCurves.bulkPut([{ id: 'old', date: '2026-10-20', w: [1] }, { id: 'new', date: '2026-10-21', w: [2], v: 2 }]);
    const rides = ['old', 'new'].map((id, k) => ({ id, date: `2026-10-2${k}`, startTime: '', name: 'r', type: 'Ride', sport: 'ride', seconds: 1800, averagePower: 150 } as Ride));
    const seen: Array<{ done: number; total: number; rebuilding?: boolean }> = [];
    await new Promise<void>((res) => { buildPowerCurves(rides, (p) => { seen.push(p); if (p.done === p.total) res(); }, { profile: DEFAULT_PROFILE, sessionOf: () => undefined }); });
    expect(seen[0]).toMatchObject({ total: 1, rebuilding: true });
    expect((await db.powerCurves.get('old'))).toMatchObject({ v: 2, steadyAtHr: { seconds: 1200 } });
    expect((await db.powerCurves.get('new'))!.w).toEqual([2]);   // untouched
  });
});
