import { describe, expect, it } from 'vitest';
import { dayKind, morningsAfter } from './mornings';
import { addDays } from './load';
import type { Ride, Wellness } from './types';

const ride = (date: string, p: Partial<Ride> = {}): Ride => ({ id: `${date}-${p.sport ?? 'ride'}-${p.seconds ?? 0}`, date, startTime: '', name: 'r', type: 'Ride', sport: 'ride', seconds: 3600, ...p });

describe('the morning after', () => {
  // October 2026: Tuesdays 6, 13, 20, 27. A hard ride every Tuesday; HRV dips on Wednesday.
  const from = '2026-10-01', to = '2026-10-31';
  const tuesdays = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  const rides = tuesdays.map((d) => ride(d, { intensityFactor: 0.9, seconds: 3600 }));
  const wellness: Wellness[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) wellness.push({ date: d, hrv: tuesdays.includes(addDays(d, -1)) ? 24 : 32, restingHr: tuesdays.includes(addDays(d, -1)) ? 58 : 54 });

  it('finds the dip after hard rides, counted once per Tuesday', () => {
    const rows = morningsAfter(rides, wellness, from, to);
    const hard = rows.find((r) => r.kind === 'hard')!;
    expect(hard.n).toBe(4);
    expect(hard.hrv!).toBeLessThan(0);
    expect(hard.restingHr!).toBeGreaterThan(0);
    const rest = rows.find((r) => r.kind === 'rest')!;
    expect(rest.hrv!).toBeGreaterThan(0);
  });
  it('kinds that never occur have no mornings', () => {
    const rows = morningsAfter(rides, wellness, from, to);
    expect(rows.find((r) => r.kind === 'long')!.n).toBe(0);
    expect(rows.find((r) => r.kind === 'strength')!.n).toBe(0);
    expect(rows.find((r) => r.kind === 'long')!.hrv).toBeUndefined();
  });
  it('a day both hard and long counts as long; a ride outranks strength; nothing recorded is rest', () => {
    expect(dayKind([ride('d', { seconds: 10000, intensityFactor: 0.9 })], 160)).toBe('long');
    expect(dayKind([ride('d', { intensityFactor: 0.9 }), ride('d', { sport: 'strength', type: 'WeightTraining' })], 160)).toBe('hard');
    expect(dayKind([ride('d', { sport: 'strength', type: 'WeightTraining' })], 160)).toBe('strength');
    expect(dayKind([], 160)).toBe('rest');
    expect(dayKind([ride('d', { sport: 'walk', type: 'Walk' })], 160)).toBe('other');
    expect(dayKind([ride('d', { averageHr: 155 })], 160)).toBe('hard');        // no power: judged by heart rate (97% of threshold)
  });
});
