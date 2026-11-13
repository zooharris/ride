import { describe, expect, it } from 'vitest';
import { Measures, fmtValue, rollingNormal, type MeasureInput } from './measures';
import { correlation, ends, linkWords, meanOver, pairUp, slid, slideWords, summary, weekly } from './compare';
import { canPair, showsSentence, suggestionsFor } from '../ui/LargeView';
import { addDays } from './load';
import type { Ride, Wellness } from './types';

const T = '2026-11-12';
const ws = (d: string) => { const x = new Date(d + 'T00:00:00Z'); const k = (x.getUTCDay() + 6) % 7; return addDays(d, -k); };

function input(rides: Ride[], wellness: Wellness[], over: Partial<MeasureInput> = {}): MeasureInput {
  return {
    rides, wellness, series: [], today: T, weekStartOf: ws, weightUnit: 'kg', distUnit: 'km',
    profile: { id: 'me', ftp: 250, lthr: 160, maxHr: 180, weightKg: 70 } as never, ...over,
  };
}
const ride = (date: string, tss: number, extra: Partial<Ride> = {}): Ride => ({ id: date, date, startTime: date, name: 'r', type: 'Ride', sport: 'ride', seconds: 3600, tss, ...extra });

describe('measures', () => {
  it('daily load counts rest days as nothing, weekly load sums the week', () => {
    const m = new Measures(input([ride('2026-11-09', 50), ride('2026-11-10', 70), ride('2026-11-12', 30)], []));
    expect(m.values('load').get('2026-11-11')).toBe(0);
    expect(m.values('load').get('2026-11-10')).toBe(70);
    expect(m.values('weekLoad').get('2026-11-09')).toBe(150);
  });
  it('weight follows the weight unit, distance the distance unit', () => {
    const w = [{ date: '2026-11-10', weightKg: 70 }];
    expect(new Measures(input([], w, { weightUnit: 'lb' })).values('weight').get('2026-11-10')).toBeCloseTo(154.32, 1);
    const r = [ride('2026-11-10', 50, { distanceM: 16093.44 })];
    expect(new Measures(input(r, [], { distUnit: 'mi' })).values('weekDistance').get('2026-11-09')).toBeCloseTo(10, 5);
    expect(new Measures(input(r, [], { distUnit: 'km' })).values('weekDistance').get('2026-11-09')).toBeCloseTo(16.09, 2);
  });
  it('a measure with no data is not offered', () => {
    const m = new Measures(input([ride('2026-11-10', 50)], [{ date: '2026-11-10', hrv: 50 }, { date: '2026-11-11', hrv: 52 }, { date: '2026-11-12', hrv: 55 }]));
    const ids = m.available().map((d) => d.id);
    expect(ids).toContain('hrv');
    expect(ids).not.toContain('sleep');
    expect(ids).not.toContain('breath');
  });
  it('the normal band is the 28 days before, with readiness\'s floor on the spread', () => {
    const v = new Map<string, number>();
    for (let i = 0; i < 20; i++) v.set(addDays('2026-10-01', i), 60);
    const n = rollingNormal(v, 'hrv');
    expect(n.get('2026-10-05')).toBeUndefined(); // fewer than 7 readings before it
    const b = n.get('2026-10-15')!;
    expect(b[0]).toBeCloseTo(60 - 2.4, 5); // a flat line gets the floor: 4% of the mean
    expect(b[1]).toBeCloseTo(62.4, 5);
  });
  it('formats', () => {
    const m = new Measures(input([], []));
    expect(fmtValue(m.def('sleep')!, 7.5)).toBe('7 h 30');
    expect(fmtValue(m.def('form')!, -4.2)).toBe('−4');
    expect(fmtValue(m.def('hrv')!, 61.4)).toBe('61 ms');
  });
});

describe('comparing two measures', () => {
  it('slides move the other measure later, so each day reads the day before', () => {
    const load = new Map([['2026-11-10', 100], ['2026-11-11', 0]]);
    expect(slid(load, 1, 'day').get('2026-11-11')).toBe(100);
    expect(slideWords(1, 'day')).toBe('the day before');
    expect(slideWords(-3, 'day')).toBe('3 days after');
    expect(slideWords(2, 'week')).toBe('2 weeks before');
  });
  it('pairs by the week when either is weekly', () => {
    const daily = new Map([['2026-11-09', 10], ['2026-11-10', 20], ['2026-11-02', 4]]);
    const wk = new Map([['2026-11-09', 100], ['2026-11-02', 50]]);
    const { pairs, cadence } = pairUp(daily, 'day', wk, 'week', 0, '2026-11-01', T, ws);
    expect(cadence).toBe('week');
    expect(pairs).toEqual([{ key: '2026-11-02', x: 50, y: 4 }, { key: '2026-11-09', x: 100, y: 15 }]);
    expect(weekly(daily, ws).get('2026-11-09')).toBe(15);
  });
  it('correlation and its words, by hand', () => {
    // y = 2x exactly: a perfect positive link.
    const p = [1, 2, 3, 4, 5].map((x, i) => ({ key: `k${i}`, x, y: 2 * x }));
    expect(correlation(p)).toBeCloseTo(1, 10);
    // x: 1 2 3 4, y: 2 1 4 3 → r = 0.6 exactly.
    const q = [[1, 2], [2, 1], [3, 4], [4, 3]].map(([x, y], i) => ({ key: `k${i}`, x, y }));
    expect(correlation(q)).toBeCloseTo(0.6, 10);
    expect(linkWords(0.6)).toBe('a strong link');
    expect(linkWords(0.59)).toBe('a moderate link');
    expect(linkWords(-0.45)).toBe('a moderate link');
    expect(linkWords(0.2)).toBe('a weak link');
    expect(linkWords(0.19)).toBe('little or no link');
    expect(linkWords(undefined)).toBe('little or no link');
  });
  it('the two ends: the fifth of days with the lowest and highest other measure', () => {
    // 10 days: x = 1..10, y = 10x. A fifth is 2 days: low y mean 15, high 95; average 55.
    const p = Array.from({ length: 10 }, (_, i) => ({ key: `d${i}`, x: i + 1, y: 10 * (i + 1) }));
    expect(ends(p)).toEqual({ n: 2, lowX: 1.5, highX: 9.5, lowY: 15, highY: 95, avgY: 55 });
  });
  it('range summary: low, high, average and the change from the first seven days to the last', () => {
    const pts: Array<[string, number]> = Array.from({ length: 14 }, (_, i) => [addDays('2026-10-01', i), i < 7 ? 50 : 60]);
    const s = summary(pts, 'day')!;
    expect([s.low, s.high, s.avg, s.change]).toEqual([50, 60, 55, 10]);
    expect(summary(pts.slice(0, 10), 'day')!.change).toBeUndefined();
    expect(meanOver(new Map(pts), '2026-10-08', '2026-10-14')).toBe(60);
  });
});

describe('the large view words', () => {
  const days = Array.from({ length: 60 }, (_, i) => addDays('2026-09-10', i));
  const rides = days.map((d, i) => ride(d, i % 3 === 0 ? 120 : 30));
  const well: Wellness[] = days.map((d, i) => ({ date: d, hrv: 60 - (i % 3 === 1 ? 8 : 0), sleepSeconds: (7 + (i % 5) / 4) * 3600, restingHr: 50 }));
  const m = new Measures(input(rides, well));

  it('suggests from the table, only with data, never itself or the same thing summed differently', () => {
    expect(suggestionsFor(m, 'hrv', days[0], T)).toEqual(['sleep', 'load', 'restingHr']);
    expect(canPair(m.def('load')!, m.def('weekLoad')!)).toBe(false);
    expect(canPair(m.def('hrv')!, m.def('hrv')!)).toBe(false);
    // Weight has no data here: its suggestions still never include a measure with none.
    expect(suggestionsFor(m, 'weight', days[0], T).every((id) => m.count(id) >= 3)).toBe(true);
  });
  it('the slid hard day shows in the next morning, in numbers', () => {
    const pr = pairUp(m.values('hrv'), 'day', m.values('load'), 'day', 1, days[0], T, ws);
    const s = showsSentence(m.def('hrv')!, m.def('load')!, pr.pairs, pr.cadence, 1)!;
    // The day after every hard day, HRV was 8 lower: 52 against an average of 57.3.
    expect(s).toMatch(/^The day after your \d+ hardest days, HRV averaged 52 ms\. Over the range it averaged 57 ms\.$/);
  });
  it('sleep uses its own words for its ends', () => {
    const pr = pairUp(m.values('hrv'), 'day', m.values('sleep'), 'day', 0, days[0], T, ws);
    expect(showsSentence(m.def('hrv')!, m.def('sleep')!, pr.pairs, pr.cadence, 0)).toMatch(/^After your 12 shortest nights, HRV averaged \d+ ms\. After your 12 longest nights it averaged \d+ ms\.$/);
  });
  it('too few days: no sentence', () => {
    const pr = pairUp(m.values('hrv'), 'day', m.values('sleep'), 'day', 0, addDays(T, -10), T, ws);
    expect(showsSentence(m.def('hrv')!, m.def('sleep')!, pr.pairs, pr.cadence, 0)).toBeNull();
  });
  it('is quick with years of history', () => {
    const many = Array.from({ length: 365 * 6 }, (_, i) => addDays('2020-11-12', i));
    const big = new Measures(input(many.map((d) => ride(d, 50)), many.map((d) => ({ date: d, hrv: 55, sleepSeconds: 25000 }))));
    const t0 = Date.now();
    for (const d of big.defs) big.values(d.id);
    big.normal('hrv');
    pairUp(big.values('hrv'), 'day', big.values('load'), 'day', 1, many[0], T, ws);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
