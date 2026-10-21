import { describe, expect, it } from 'vitest';
import { aerobicPoints, isSteadyAerobicRide, ftpByDay, meanMaxPower, monthlyTotals, powerHistogram, rollingDays, rollingMean, weekStreak, weeklyLoad, weeklyZones } from './progress';
import type { Ride } from './types';

const ride = (p: Partial<Ride>): Ride => ({ id: p.id ?? Math.random().toString(36), date: '2026-10-10', startTime: '', name: 'r', type: 'Ride', sport: 'ride', seconds: 3600, ...p });
const mondayOf = (d: string) => { const x = new Date(d + 'T00:00:00'); const diff = (x.getDay() + 6) % 7; x.setDate(x.getDate() - diff); return x.toISOString().slice(0, 10); };

describe('meanMaxPower', () => {
  it('finds the best average for each duration on a one-second grid', () => {
    const time = Array.from({ length: 600 }, (_, i) => i);
    const watts = time.map((t) => (t >= 100 && t < 400 ? 300 : 150));
    const [p1, p5m, p10m] = meanMaxPower(time, watts, [1, 300, 600]);
    expect(p1).toBe(300);
    expect(p5m).toBe(300);
    expect(p10m).toBe(225);   // 300 s at 300 W and 300 s at 150 W
  });
  it('reads a 2-second recording the same as a 1-second one', () => {
    const t1 = Array.from({ length: 120 }, (_, i) => i), w1 = t1.map(() => 200);
    const t2 = Array.from({ length: 60 }, (_, i) => i * 2), w2 = t2.map(() => 200);
    expect(meanMaxPower(t2, w2, [60])).toEqual(meanMaxPower(t1, w1, [60]));
  });
  it('counts a long gap as zero and gives 0 for durations longer than the ride', () => {
    const time = [0, 1, 2, 100, 101], watts = [400, 400, 400, 400, 400];
    expect(meanMaxPower(time, watts, [3, 200])).toEqual([400, 0]);
  });
});

describe('powerHistogram', () => {
  it('bins time by power, weighting by the gap to the next sample', () => {
    const h = powerHistogram([0, 1, 2, 4], [110, 120, 260, 0], 25);
    expect(h.find((b) => b.from === 100)?.seconds).toBe(2);
    expect(h.find((b) => b.from === 250)?.seconds).toBe(2);
    expect(h.find((b) => b.from === 125)?.seconds).toBe(0);
  });
});

describe('weekly charts', () => {
  const rides = [
    ride({ date: '2026-10-05', tss: 80, powerZoneSeconds: [600, 1800, 600, 0, 0, 0, 0] }),
    ride({ date: '2026-10-07', tss: 30, sport: 'strength' }),
    ride({ date: '2026-10-13', tss: 100, hrZoneSeconds: [0, 3600, 0, 0, 0] }),
  ];
  it('sums load by kind per week, empty weeks included', () => {
    const w = weeklyLoad(rides, '2026-09-28', '2026-10-18', mondayOf);
    expect(w.map((x) => x.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(w[1].byKind.ride).toBe(80);
    expect(w[1].byKind.strength).toBe(30);
    expect(w[1].total).toBe(110);
    expect(w[0].total).toBe(0);
  });
  it('adds ride zone time, falling back to heart-rate zones', () => {
    const z = weeklyZones(rides, '2026-10-05', '2026-10-18', mondayOf);
    expect(z[0].seconds[1]).toBe(1800);
    expect(z[1].seconds[1]).toBe(3600);
  });
  it('counts the streak of active weeks', () => {
    expect(weekStreak(rides, '2026-10-15', mondayOf)).toBe(2);
    expect(weekStreak(rides, '2026-10-27', mondayOf)).toBe(0);
  });
});

describe('aerobic points and rolling means', () => {
  it('keeps steady rides of an hour or more', () => {
    const pts = aerobicPoints([
      ride({ date: '2026-10-01', intensityFactor: 0.7, efficiencyFactor: 1.4, decoupling: 4 }),
      ride({ date: '2026-10-02', intensityFactor: 0.9, efficiencyFactor: 1.6 }),
      ride({ date: '2026-10-03', seconds: 1800, intensityFactor: 0.6, efficiencyFactor: 1.3 }),
    ], () => undefined);
    expect(pts.map((p) => p.date)).toEqual(['2026-10-01']);
  });
  it('rolls a mean over defined values', () => {
    expect(rollingMean([2, null, 4, 6], 2)).toEqual([2, null, 3, 5]);
    expect(rollingDays(['2026-10-01', '2026-10-02', '2026-10-05'], [10, 20, 30], 3)).toEqual([10, 15, 30]);
  });
});

describe('totals and FTP history', () => {
  it('totals by month, the current month last', () => {
    const m = monthlyTotals([ride({ date: '2026-10-03', seconds: 7200, distanceM: 50000 }), ride({ date: '2026-09-30' })], '2026-10-19', 3);
    expect(m.map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m[2].hours).toBe(2);
    expect(m[2].distanceM).toBe(50000);
    expect(m[1].sessions).toBe(1);
  });
  it('carries FTP forward from the rides and ends at the current value', () => {
    const f = ftpByDay([ride({ date: '2026-10-02', ftpAtRide: 220 }), ride({ date: '2026-10-04', ftpAtRide: 230 })], '2026-10-01', '2026-10-06', 235);
    expect(f.map((x) => x.ftp)).toEqual([220, 220, 220, 230, 230, 235]);
  });
});

describe('isSteadyAerobicRide', () => {
  const steady = (p: Partial<Ride> = {}) => ride({ seconds: 5400, intensityFactor: 0.7, efficiencyFactor: 1.3, decoupling: 4, ...p });
  it('takes an endurance ride of an hour or more with a believable drift', () => {
    expect(isSteadyAerobicRide(steady())).toBe(true);
    expect(isSteadyAerobicRide(steady({ seconds: 3000 }))).toBe(false);
    expect(isSteadyAerobicRide(steady({ sport: 'walk' }))).toBe(false);
  });
  it('leaves out hard rides, by intensity factor when known, by heart rate otherwise', () => {
    expect(isSteadyAerobicRide(steady({ intensityFactor: 0.84 }))).toBe(false);
    expect(isSteadyAerobicRide(steady({ intensityFactor: undefined, averageHr: 140 }), 169)).toBe(true);    // 83% of threshold: zone 2
    expect(isSteadyAerobicRide(steady({ intensityFactor: undefined, averageHr: 155 }), 169)).toBe(false);   // 92%: tempo
    expect(isSteadyAerobicRide(steady({ intensityFactor: undefined }))).toBe(false);                        // nothing to judge by
  });
  it('the planned purpose outranks the numbers, and an implausible drift means the ride was not steady', () => {
    expect(isSteadyAerobicRide(steady({ intensityFactor: 0.84 }), undefined, () => true)).toBe(true);
    expect(isSteadyAerobicRide(steady(), undefined, () => false)).toBe(false);
    expect(isSteadyAerobicRide(steady({ decoupling: -38.7 }))).toBe(false);
    expect(isSteadyAerobicRide(steady({ decoupling: 17.6 }))).toBe(false);
  });
  it('aerobicPoints uses the same rule', () => {
    const pts = aerobicPoints([steady({ date: '2026-10-01' }), steady({ date: '2026-10-02', intensityFactor: 0.9 }), steady({ date: '2026-10-03', decoupling: -30 })], () => undefined);
    expect(pts.map((p) => p.date)).toEqual(['2026-10-01']);
  });
});
