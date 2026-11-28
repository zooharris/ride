import { describe, expect, it } from 'vitest';
import { dayKindName, monthlyBests, sessionKind, weeklyGain } from './labMore';
import type { Ride } from './types';

const ride = (o: Partial<Ride>): Ride => ({ id: 'a', date: '2026-05-04', startTime: '', name: 'r', type: 'Ride', sport: 'ride', seconds: 5400, ...o } as Ride);
const z = (...min: number[]) => min.map((m) => m * 60);

describe('the kind of a session', () => {
  it('names a ride for the hardest work it held a real amount of', () => {
    expect(sessionKind(ride({ powerZoneSeconds: z(10, 60, 10, 5, 1, 0, 0) }))).toBe('endurance');
    expect(sessionKind(ride({ powerZoneSeconds: z(10, 30, 35, 5, 1, 0, 0) }))).toBe('tempo');
    expect(sessionKind(ride({ powerZoneSeconds: z(10, 30, 35, 16, 1, 0, 0) }))).toBe('threshold');
    expect(sessionKind(ride({ powerZoneSeconds: z(10, 30, 5, 16, 9, 1, 0) }))).toBe('vo2');
    expect(sessionKind(ride({ powerZoneSeconds: z(10, 30, 5, 16, 9, 1.5, 1) }))).toBe('sprint');
  });
  it('calls a short, easy ride recovery, and a long easy one endurance', () => {
    expect(sessionKind(ride({ seconds: 2400, powerZoneSeconds: z(30, 10) }))).toBe('recovery');
    expect(sessionKind(ride({ seconds: 7200, powerZoneSeconds: z(80, 40) }))).toBe('endurance');
  });
  it('sorts by heart rate when there is no power, and says other when there is neither', () => {
    expect(sessionKind(ride({ hrZoneSeconds: z(10, 30, 5, 20, 2) }))).toBe('threshold');
    expect(sessionKind(ride({}))).toBe('other');
  });
  it('keeps runs, strength and walks as themselves', () => {
    expect(sessionKind(ride({ sport: 'run' }))).toBe('run');
    expect(sessionKind(ride({ sport: 'strength' }))).toBe('strength');
  });
  it('names a day for its heaviest session', () => {
    expect(dayKindName([ride({ tss: 20, sport: 'strength' }), ride({ tss: 90, powerZoneSeconds: z(5, 30, 5, 20) })])).toBe('threshold');
    expect(dayKindName([])).toBeUndefined();
  });
});

describe('the best of each month', () => {
  it('keeps each month\'s best and marks records, never the first month', () => {
    const c = (date: string, w: number) => ({ id: date, date, w: [w] });
    const m = monthlyBests([c('2026-01-03', 300), c('2026-01-20', 310), c('2026-02-02', 305), c('2026-03-09', 320)], 0);
    expect(m.map((x) => x.best)).toEqual([310, 305, 320]);
    expect(m.map((x) => x.record)).toEqual([false, false, true]);
  });
});

describe('fitness gained each week', () => {
  it('is the last day of the week against the day before it began', () => {
    const series = Array.from({ length: 21 }, (_, k) => ({ date: `2026-05-${String(k + 1).padStart(2, '0')}`, ctl: 50 + k, atl: 0, tsb: 0 }));
    const g = weeklyGain(series, '2026-05-04', '2026-05-17', (d) => d <= '2026-05-10' ? '2026-05-04' : '2026-05-11');
    expect(g).toEqual([{ start: '2026-05-04', gain: 7 }, { start: '2026-05-11', gain: 7 }]);
  });
});
