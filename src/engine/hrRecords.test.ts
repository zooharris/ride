import { describe, expect, it } from 'vitest';
import { best20MinHr, hasPowerHistory, hrRecords } from './hrRecords';
import type { Ride } from './types';

const ws = (d: string) => d; // a week per day is enough for these sums
const ride = (id: string, date: string, x: Partial<Ride>): Ride => ({ id, date, startTime: date, name: id, type: 'Ride', sport: 'ride', seconds: 3600, ...x });

describe('records for a rider with no power meter', () => {
  it('the best 20 minutes of heart rate', () => {
    const t = Array.from({ length: 3600 }, (_, i) => i);
    const hr = t.map((i) => (i >= 1000 && i < 2200 ? 160 : 130));
    expect(best20MinHr(t, hr)).toBe(160);
    expect(best20MinHr(t.slice(0, 600), hr.slice(0, 600))).toBeUndefined();
  });
  it('each record in the range, the year and all time, with what set it', () => {
    const rides = [
      ride('a', '2025-06-01', { seconds: 4 * 3600, distanceM: 120000, elevationM: 1500, tss: 200 }),
      ride('b', '2026-10-01', { seconds: 2 * 3600, distanceM: 60000, elevationM: 900, tss: 100 }),
      ride('c', '2026-11-10', { seconds: 3 * 3600, distanceM: 50000, elevationM: 1000, tss: 150 }),
    ];
    const rows = hrRecords(rides, { b: 158, c: 162 }, '2026-09-01', '2026-11-12', ws);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.time.range).toEqual({ v: 3 * 3600, id: 'c', date: '2026-11-10' });
    expect(by.time.all?.id).toBe('a');
    expect(by.time.isNew).toBe(false);
    expect(by.distance.range?.id).toBe('b');
    expect(by.climb.year?.id).toBe('c');
    expect(by.hr20.range).toEqual({ v: 162, id: 'c', date: '2026-11-10' });
    expect(by.hr20.isNew).toBe(true);
    expect(by.weekLoad.all?.v).toBe(200);
  });
  it('power in the history brings the power cards back', () => {
    expect(hasPowerHistory([ride('a', '2026-01-01', { averageHr: 140 })])).toBe(false);
    expect(hasPowerHistory([ride('a', '2026-01-01', { averageHr: 140 }), ride('b', '2026-01-02', { averagePower: 180 })])).toBe(true);
  });
});
