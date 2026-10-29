import { describe, expect, it } from 'vitest';
import { loadRatio, readinessSeries, readinessToday } from './derived';
import { addDays } from '../engine/load';
import type { Wellness } from '../engine/types';

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
const morning = (date: string, i: number): Wellness => ({ date, hrv: 50 + ((i % 5) - 2) * 2, sleepSeconds: 7 * 3600, restingHr: 50 + ((i % 3) - 1) });

describe('readiness over time', () => {
  const wellness = days('2026-08-01', 60).map(morning);
  it('starts once a week of mornings gives a normal, and every day is on the same calibration', () => {
    const s = readinessSeries(wellness, [], [], '2026-08-01', '2026-09-29');
    expect(s[0].date).toBe('2026-08-08');
    expect(s.every((d) => d.score >= 55 && d.score <= 85)).toBe(true);
    // The same day worked out on its own gives the same score as in the series.
    const d = s[30];
    expect(readinessToday(wellness, undefined, d.date).score).toBe(d.score);
  });
  it('the load ratio compares the last week with the last four, and needs some training to compare', () => {
    const steady = days('2026-09-01', 28).map((date) => ({ date, tss: 50 }));
    expect(loadRatio(steady, '2026-09-28')).toBeCloseTo(1, 5);
    const ramp = [...days('2026-09-01', 21).map((date) => ({ date, tss: 30 })), ...days('2026-09-22', 7).map((date) => ({ date, tss: 90 }))];
    expect(loadRatio(ramp, '2026-09-28')!).toBeGreaterThan(1.3);
    expect(loadRatio([{ date: '2026-09-28', tss: 40 }], '2026-09-28')).toBeUndefined();
  });
});
