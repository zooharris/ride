import { describe, expect, it } from 'vitest';
import type { Profile, Ride } from '../engine/types';
import { activityNumbers } from './activityNumbers';
import { breathNumbers } from '../engine/breathNumbers';
import { columnsFor, emptyAtEnd, GROUP_OF, GROUPS, groupNumbers, placeCells, shown, type NumberCell } from './numberGroups';

const profile: Profile = { name: 'Sam Example', ftp: 240, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };

/** An activity with every number the page can show filled in. */
function full(sport: Ride['sport'], extra: Partial<Ride> = {}): Ride {
  return {
    id: 'a1', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'Test', type: sport === 'ride' ? 'Ride' : sport === 'walk' ? 'Walk' : sport === 'run' ? 'Run' : sport === 'strength' ? 'WeightTraining' : sport === 'mobility' ? 'Yoga' : 'Swim',
    sport, seconds: 5400, elapsedSeconds: 6000, movingSeconds: 5000, distanceM: 40_000, elevationM: 420, elevationLossM: 410, tss: 88, tssBasis: 'power',
    normalizedPower: 210, averagePower: 190, intensityFactor: 0.88, variabilityIndex: 1.1, workKj: 1020, workAboveFtpKj: 80, reserveUsedKj: 9.4,
    averageHr: 141, maxHr: 171, averageCadence: 88, coastingSeconds: 300, maxSpeedMs: 15, efficiencyFactor: 1.49, decoupling: 3.2, averageTempC: 14,
    weatherTempC: 12, feelsLikeC: 8, windMs: 5, headwindPct: 40, calories: 1100, carbsUsedG: 180, ftpAtRide: 240, rpe: 6, device: 'Garmin Edge 1050', averageSpeedMs: 7.4,
    ...extra,
  } as unknown as Ride;
}

const breath = breathNumbers({ ve: Array.from({ length: 120 }, (_, i) => 60 + (i % 20)), br: Array.from({ length: 120 }, (_, i) => 30 + (i % 10)) });

describe('Numbers as compact cells', () => {
  for (const sport of ['ride', 'walk', 'run', 'strength', 'mobility', 'other'] as const) {
    it(`keeps every number of a ${sport}, with the same value and wording`, () => {
      const rows = [...activityNumbers(full(sport), profile, '14°C', sport === 'strength' ? 7 : undefined, false), ...(sport === 'ride' ? breath : [])];
      const before = rows.filter(([, v]) => shown(v));
      const after = groupNumbers(rows).flatMap((g) => g.cells);
      expect(after.map((c) => c.label).sort()).toEqual(before.map(([k]) => k).sort());
      for (const [k, v, hint] of before) {
        const c = after.find((x) => x.label === k)!;
        expect(c.value).toBe(String(v));
        expect(c.explain).toBe(hint || undefined);
      }
      // Every label has a group of its own, so nothing falls to the catch-all by accident.
      for (const [k] of rows) expect(GROUP_OF[k], k).toBeDefined();
    });
  }

  it('hides what the list hid, by the same rule', () => {
    const r = full('ride', { normalizedPower: undefined, averagePower: undefined, rpe: undefined, device: undefined, elapsedSeconds: 5420 });
    const labels = groupNumbers(activityNumbers(r, profile)).flatMap((g) => g.cells.map((c) => c.label));
    expect(labels).not.toContain('Normalized power');
    expect(labels).not.toContain('Recorded on');
    expect(labels).not.toContain('Elapsed time');   // within a minute of moving time, as before
    expect(groupNumbers(activityNumbers(full('ride'), profile, undefined, undefined, true)).flatMap((g) => g.cells.map((c) => c.label))).not.toContain('Heart-rate drift');
  });

  it('puts the groups in the brief\'s order, each only when it has something', () => {
    const names = groupNumbers([...activityNumbers(full('ride'), profile, '14°C'), ...breath]).map((g) => g.name);
    expect(names).toEqual(GROUPS.filter((g) => names.includes(g)));
    expect(names.slice(0, 4)).toEqual(['Time and distance', 'Power', 'Heart rate', 'Breathing']);
    expect(groupNumbers(activityNumbers(full('ride'), profile)).map((g) => g.name)).not.toContain('Breathing');
  });

  it('joins a group left with one cell to the group above it', () => {
    const g = groupNumbers(activityNumbers(full('strength'), profile, undefined, 7));
    // Strength: time and load, heart rate, energy burned (one), effort and device: energy burned joins heart rate; "recorded on" joins too.
    expect(g.map((x) => x.name)).toEqual(['Time and distance', 'Heart rate']);
    expect(g[1].cells.map((c) => c.label)).toEqual(['Average heart rate', 'Max heart rate', 'Energy burned', 'Recorded on']);
  });

  it('gives a long value two cells, and never cuts it', () => {
    const cells = groupNumbers(activityNumbers(full('ride'), profile, '14°C')).flatMap((g) => g.cells);
    expect(cells.find((c) => c.label === 'Weather')!.wide).toBe(true);
    expect(cells.find((c) => c.label === 'Weather')!.value).toBe('12°C, felt like 8°C');
    expect(cells.find((c) => c.label === 'Wind')!.wide).toBe(true);
    expect(cells.find((c) => c.label === 'Distance')!.wide).toBe(false);
    const still = groupNumbers(activityNumbers(full('ride', { feelsLikeC: 12, headwindPct: 0 }), profile)).flatMap((g) => g.cells);
    expect(still.find((c) => c.label === 'Weather')!.wide).toBe(false);
  });

  it('a number with no explanation gets no "i"', () => {
    const cells = groupNumbers(activityNumbers(full('ride'), profile)).flatMap((g) => g.cells);
    expect(cells.find((c) => c.label === 'Distance')!.explain).toBeUndefined();
    expect(cells.find((c) => c.label === 'Max heart rate')!.explain).toBeUndefined();
    expect(cells.find((c) => c.label === 'Moving time')!.explain).toBe('Time pedalling, stops excluded');
  });

  it('two across on a phone, three wider; a wide cell never starts in the last column', () => {
    expect(columnsFor(358)).toBe(2);
    expect(columnsFor(740)).toBe(3);
    const c = (wide = false): NumberCell => ({ label: 'x', value: 'y', wide });
    expect(placeCells([c(), c(), c(true)], 3).map((p) => [p.row, p.col])).toEqual([[0, 0], [0, 1], [1, 0]]);
    expect(emptyAtEnd([c(), c(), c(), c()], 3)).toBe(2);
    expect(emptyAtEnd([c(), c(), c()], 3)).toBe(0);
  });
});
