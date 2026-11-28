import { describe, expect, it } from 'vitest';
import { Measures, type MeasureInput } from './measures';
import { LAB_FAMILIES, enduranceVentilation, familyMeasures, labExtra, labMeta, newest, periodBefore, periodDays, readings, searchMeasures, type LabInput } from './lab';
import { addDays } from './load';
import type { Ride, Wellness } from './types';

const T = '2026-11-27';
const ws = (d: string) => { const x = new Date(d + 'T00:00:00Z'); const k = (x.getUTCDay() + 6) % 7; return addDays(d, -k); };
const ride = (date: string, extra: Partial<Ride> = {}): Ride => ({ id: date, date, startTime: date, name: 'r', type: 'Ride', sport: 'ride', seconds: 3600, tss: 50, ...extra });
function lab(rides: Ride[], wellness: Wellness[] = [], li: Partial<LabInput> = {}, over: Partial<MeasureInput> = {}): Measures {
  const input: MeasureInput = { rides, wellness, series: [], today: T, weekStartOf: ws, weightUnit: 'kg', distUnit: 'km', profile: { id: 'me', ftp: 250, lthr: 160, maxHr: 180, weightKg: 70 } as never, ...over };
  return new Measures(input, labExtra({ distUnit: 'km', weightUnit: 'kg', curves: [], tests: [], ...li }));
}

describe('the Lab: families and measures', () => {
  it('every measure sits in one family and says what it needs', () => {
    const M = lab([]);
    for (const d of M.defs) { const m = labMeta(M, d.id); expect(m, d.id).toBeTruthy(); expect(m!.needs.startsWith('Needs')).toBe(true); expect(d.desc.length).toBeGreaterThan(10); }
    const ids = M.defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const total = LAB_FAMILIES.reduce((n, f) => n + familyMeasures(M, f.id).length, 0);
    expect(total).toBe(M.defs.length);
    for (const f of LAB_FAMILIES) expect(familyMeasures(M, f.id).length, f.id).toBeGreaterThan(1);
  });
  it('the standing list is unchanged without the Lab’s additions', () => {
    const plain = new Measures({ rides: [], wellness: [], series: [], today: T, weekStartOf: ws, weightUnit: 'kg', distUnit: 'km', profile: {} as never });
    expect(plain.def('np')).toBeUndefined();
    expect(plain.defs.length).toBe(29);
  });
  it('a rider with no power has no power measures, and nothing is drawn for them', () => {
    const M = lab([ride('2026-11-20', { averageHr: 130, maxHr: 160, hrZoneSeconds: [600, 1800, 900, 300, 0], tssBasis: 'heart-rate' }), ride('2026-11-24', { averageHr: 134, maxHr: 165, tssBasis: 'heart-rate' })]);
    for (const id of ['np', 'avgPower', 'best5m', 'cp', 'work', 'weekWork', 'late5', 'intensity', 'sweetSpot']) expect(M.count(id), id).toBe(0);
    expect(M.values('avgHr').get('2026-11-24')).toBe(134);
    expect(M.values('hz2').get('2026-11-16')).toBeCloseTo(0.5, 5);
    expect(M.values('hrLoad').get('2026-11-23')).toBe(50);
    expect(M.count('hz5')).toBe(0);   // a zone never ridden in is not a row of noughts
    // listed last in its family, with what it needs
    const power = familyMeasures(M, 'power');
    expect(M.count(power[power.length - 1].id)).toBe(0);
    expect(labMeta(M, 'np')!.needs).toBe('Needs a power meter');
  });
  it('per-ride measures take the day’s rides; weekly ones sum the week', () => {
    const M = lab([
      ride('2026-11-24', { normalizedPower: 200, averagePower: 180, workKj: 650, averageCadence: 88, coastingSeconds: 360, averageSpeedMs: 7.5, rpe: 6, calories: 700, intensityFactor: 0.8 }),
      { ...ride('2026-11-24', { normalizedPower: 220, workKj: 300, averageCadence: 92, seconds: 1800 }), id: 'b' },
      { ...ride('2026-11-25'), id: 'w', sport: 'walk', seconds: 2400, calories: 150 },
    ]);
    expect(M.values('np').get('2026-11-24')).toBe(220);
    expect(M.values('cadence').get('2026-11-24')).toBe(90);
    expect(M.values('coasting').get('2026-11-24')).toBe(10);
    expect(M.values('speed').get('2026-11-24')).toBeCloseTo(27, 5);
    expect(M.values('weekWork').get('2026-11-23')).toBe(950);
    expect(M.values('weekRides').get('2026-11-23')).toBe(2);
    expect(M.values('weekSessions').get('2026-11-23')).toBe(3);
    expect(M.values('weekDays').get('2026-11-23')).toBe(2);
    expect(M.values('longest').get('2026-11-23')).toBe(1);
    expect(M.values('weekEnergy').get('2026-11-23')).toBe(850);
    expect(M.values('felt').get('2026-11-24')).toBe(6);
    expect(newest(M, 'np')).toEqual({ date: '2026-11-24', value: 220 });
  });
  it('bests, late efforts and breathing come from the per-ride cache', () => {
    const w = [900, 800, 600, 500, 400, 350, 300, 280, 260, 250, 230, 0, 0];
    const M = lab([ride('2026-11-20')], [], {
      curves: [{ id: 'a', date: '2026-11-20', w, hr30: 171, late: { v: 1, at: 900, b5: 300, a5: 270, b20: 250, a20: 240 }, breathAtPower: [{ lo: 0.55, hi: 0.6, seconds: 200, ve: 40, br: 22 }, { lo: 0.6, hi: 0.65, seconds: 200, ve: 50, br: 24 }, { lo: 0.9, hi: 0.95, seconds: 600, ve: 90 }] }],
      tests: [{ date: '2026-11-10', ftpEstimate: 255, vo2: 48.2, vt1: 180, vt2: 240 }],
    });
    expect(M.values('best5m').get('2026-11-20')).toBe(300);
    expect(M.values('best20m').get('2026-11-20')).toBe(260);
    expect(M.count('best60m')).toBe(1);
    expect(M.values('late5').get('2026-11-20')).toBe(90);
    expect(M.values('late20w').get('2026-11-20')).toBe(240);
    expect(M.values('hr30').get('2026-11-20')).toBe(171);
    expect(M.values('veEndurance').get('2026-11-20')).toBe(45);
    expect(M.values('vo2test').get('2026-11-10')).toBe(48.2);
    expect(M.values('vt2').get('2026-11-10')).toBe(240);
    expect(enduranceVentilation([{ lo: 0.55, hi: 0.6, seconds: 120, ve: 40 }])).toBeUndefined();   // under five minutes: no figure
  });
  it('critical power is fitted only when the efforts fit one line', () => {
    // CP 250 W, reserve 20 kJ: best power for t seconds = 250 + 20000 / t
    const at = (s: number) => Math.round(250 + 20000 / s);
    const w = [0, 0, 0, 0, 0, at(120), at(300), at(600), at(1200), at(1800), 0, 0, 0];
    const M = lab([ride('2026-11-20')], [], { curves: [{ id: 'a', date: '2026-11-20', w }] });
    expect(M.values('cp').get('2026-11-23')).toBeCloseTo(250, 0);
    expect(M.values('wPrime').get('2026-11-23')).toBeCloseTo(20, 0);
    const odd = lab([ride('2026-11-20')], [], { curves: [{ id: 'a', date: '2026-11-20', w: [0, 0, 0, 0, 0, 600, 300, 290, 285, 120, 0, 0, 0] }] });
    expect(odd.count('cp')).toBe(0);
  });
  it('fitness gained in a week, the week against the month, and the 7-day weight', () => {
    const series = Array.from({ length: 15 }, (_, k) => ({ date: addDays(T, k - 14), ctl: 40 + k, atl: 40, tsb: 0 }));
    const M = lab([ride(T)], [{ date: addDays(T, -8), weightKg: 80 }, { date: addDays(T, -2), weightKg: 79 }, { date: T, weightKg: 78 }], { loadRatio: (d) => (d === T ? 1.2 : undefined) }, { series });
    expect(M.values('ramp').get(T)).toBe(7);
    expect(M.values('loadRatio').get(T)).toBe(1.2);
    expect(M.count('loadRatio')).toBe(1);
    expect(M.values('weight7').get(T)).toBe(78.5);
    expect(M.values('weight7').get(addDays(T, -8))).toBe(80);
  });
  it('a rider with nothing recorded has no readings, even where the sums give noughts', () => {
    const series = Array.from({ length: 42 }, (_, k) => ({ date: addDays(T, k - 41), ctl: 0, atl: 0, tsb: 0 }));
    const M = lab([], [], {}, { series });
    expect(M.count('fitness')).toBe(42);
    for (const d of M.defs) expect(readings(M, d.id), d.id).toBe(0);
    expect(newest(M, 'fitness')).toBeUndefined();
    const one = lab([ride(T)], [], {}, { series: series.map((f, k) => ({ ...f, ctl: k === 41 ? 1.2 : 0 })) });
    expect(readings(one, 'fitness')).toBe(42);
    expect(readings(one, 'weekRides')).toBeGreaterThan(0);
  });
  it('search finds a measure by any of its words, or by its family', () => {
    const M = lab([]);
    expect(searchMeasures(M, 'cadence').map((d) => d.id)).toContain('cadence');
    expect(searchMeasures(M, 'sleep score').map((d) => d.id)).toEqual(['sleepScore']);
    expect(searchMeasures(M, 'durability').length).toBe(4);
    expect(searchMeasures(M, '  ')).toEqual([]);
    expect(searchMeasures(M, 'zzzz')).toEqual([]);
  });
});

describe('the Lab: one period choice', () => {
  it('counts back from today, takes the plan’s days, and falls back when a choice has nothing behind it', () => {
    expect(periodDays('4w', T, { earliest: '2025-01-01' })).toEqual({ from: '2026-10-31', to: T });
    expect(periodDays('all', T, { earliest: '2025-01-01' })).toEqual({ from: '2025-01-01', to: T });
    expect(periodDays('plan', T, { earliest: '2025-01-01', plan: { start: '2026-10-05', end: '2027-01-10' } })).toEqual({ from: '2026-10-05', to: T });
    expect(periodDays('plan', T, { earliest: '2025-01-01' })).toEqual(periodDays('3m', T, { earliest: '2025-01-01' }));
    expect(periodDays('custom', T, { earliest: '2025-01-01', custom: { from: '2026-06-01', to: '2026-06-30' } })).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(periodBefore('2026-10-31', T)).toEqual({ from: '2026-10-03', to: '2026-10-30' });
  });
});
