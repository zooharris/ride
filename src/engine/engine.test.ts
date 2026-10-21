import { describe, expect, it } from 'vitest';
import { POWER_ZONES, hrZone, powerToHrFraction, powerZone, zoneTable } from './zones';
import { flattenSteps, formatDuration, renderIntervalsText, workoutStats } from './workout';
import { estimatedRideTss, fitnessSeries, hrIntensity, hrTss, looksLikeADrive, powerTss, rideIntensity, rideTss } from './load';
import { hrToPowerFraction } from './zones';
import { scoreRide } from './compliance';
import { readiness } from './readiness';
import type { Profile, Ride, Workout } from './types';

const profile: Profile = {
  name: 'Test', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 80,
  basis: 'power', masters: true, units: 'imperial', rideDays: [0, 2, 4, 6], hoursPerWeek: 8,
};

const sweetSpot: Workout = {
  id: 'ss', name: '3 x 10 sweet spot', family: 'sweetspot', purpose: '', phases: ['base'], bases: ['power', 'hr'], source: 'library', setting: 'any', kind: 'ride',
  blocks: [
    { kind: 'step', seconds: 600, intensity: 0.55, label: 'Warm up' },
    { kind: 'repeat', times: 3, label: 'Sweet spot', steps: [
      { kind: 'step', seconds: 600, intensity: 0.88, intensityHigh: 0.92 },
      { kind: 'step', seconds: 300, intensity: 0.5 },
    ] },
    { kind: 'step', seconds: 600, intensity: 0.5, label: 'Cool down' },
  ],
};

describe('zones', () => {
  it('classifies power intensities by Coggan zones', () => {
    expect(powerZone(0.5)).toBe(1);
    expect(powerZone(0.7)).toBe(2);
    expect(powerZone(0.88)).toBe(3);
    expect(powerZone(1.0)).toBe(4);
    expect(powerZone(1.1)).toBe(5);
    expect(powerZone(1.3)).toBe(6);
    expect(powerZone(2.0)).toBe(7);
  });
  it('classifies hr fractions', () => {
    expect(hrZone(0.8)).toBe(1);
    expect(hrZone(0.85)).toBe(2);
    expect(hrZone(0.97)).toBe(4);
  });
  it('maps a power fraction to the same position inside the HR zone', () => {
    // 0.88 FTP is sweet spot (Z3); HR Z3 is 0.89..0.94
    const hr = powerToHrFraction(0.88);
    expect(hr).toBeGreaterThanOrEqual(0.89);
    expect(hr).toBeLessThan(0.94);
    // zone edges land on zone edges
    expect(powerToHrFraction(0.55)).toBeCloseTo(0.82, 3);
    expect(powerToHrFraction(0.90)).toBeCloseTo(0.94, 3);
    // the top never explodes
    expect(powerToHrFraction(2.0)).toBeLessThan(1.15);
  });
  it('produces absolute boundaries from the profile', () => {
    const t = zoneTable(profile, 'power');
    expect(t[1]).toMatchObject({ low: 138, high: 187 });   // Z2 55..75% of 250
    expect(t[6].high).toBeNull();
    expect(POWER_ZONES).toHaveLength(7);
  });
});

describe('workout', () => {
  it('computes duration, TSS, IF and dominant zone', () => {
    const s = workoutStats(sweetSpot.blocks);
    expect(s.seconds).toBe(600 + 3 * 900 + 600);
    // 30 min at 0.90 = 40.5, warm-up, recoveries and cool-down add 15.5
    expect(s.tss).toBe(56);
    expect(s.intensityFactor).toBeGreaterThan(0.7);
    expect(s.dominantZone).toBe(3);
  });
  it('an hour at FTP is 100 TSS', () => {
    expect(workoutStats([{ kind: 'step', seconds: 3600, intensity: 1 }]).tss).toBe(100);
  });
  it('formats durations the way Intervals.icu reads them', () => {
    expect(formatDuration(90)).toBe('1m30s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(5400)).toBe('1h30m');
  });
  it('renders power text with % FTP and repeats', () => {
    const t = renderIntervalsText(sweetSpot, 'power');
    expect(t).toContain('- Warm up 10m 55%');
    expect(t).toContain('Sweet spot 3x');
    expect(t).toContain('- 10m 88-92%');
    expect(t).toContain('- 5m 50%');
    expect(t).not.toContain('LTHR');
  });
  it('renders HR text entirely in % LTHR', () => {
    const t = renderIntervalsText(sweetSpot, 'hr');
    expect(t.split('\n').filter((l) => l.startsWith('- ')).every((l) => l.includes('LTHR'))).toBe(true);
    expect(t).toMatch(/- 10m 9\d-9\d% LTHR/);
  });
});

describe('load', () => {
  it('power TSS: an hour at FTP is 100', () => {
    expect(powerTss(3600, 250, 250)).toBe(100);
    expect(powerTss(7200, 175, 250)).toBe(98);
  });
  it('hr TSS: an hour at threshold heart rate is 100, and a zone-2 heart rate costs what zone-2 power costs', () => {
    expect(hrTss(3600, 160, 160)).toBe(100);
    expect(hrTss(3600, 136, 160)).toBe(40);        // 85% of LTHR is zone 2: not 72, which 0.85² would give
    expect(hrTss(24180, 149, 169)).toBe(354);      // a 6 h 43 century at 88% of LTHR: endurance pace, not sweet spot
    expect(hrIntensity(149, 169)).toBeCloseTo(0.73, 2);
  });
  it('the heart-rate to power mapping is monotonic and meets at threshold', () => {
    let last = -1;
    for (let h = 0; h <= 1.3; h += 0.01) { const p = hrToPowerFraction(h); expect(p).toBeGreaterThanOrEqual(last); last = p; }
    expect(hrToPowerFraction(1)).toBe(1);
    expect(hrToPowerFraction(0.82)).toBe(0.55);
    expect(hrToPowerFraction(0.89)).toBe(0.75);
  });
  it('prefers power and falls back to HR', () => {
    expect(rideTss({ seconds: 3600, normalizedPower: 200, averageHr: 150 }, 250, 160)).toBe(64);
    expect(rideTss({ seconds: 3600, averageHr: 150 }, 250, 160)).toBe(80);
    expect(rideTss({ seconds: 3600 }, 250, 160)).toBe(0);
  });
  it('a ride intensity is the power one when known, the heart-rate equivalent otherwise, unknown with neither', () => {
    expect(rideIntensity({ intensityFactor: 0.84, averageHr: 150 }, 160)).toBe(0.84);
    expect(rideIntensity({ averageHr: 150 }, 160)).toBeCloseTo(0.89, 2);
    expect(rideIntensity({}, 160)).toBeUndefined();
  });
  it('a ride with neither power nor heart rate is estimated from its time; a car is not a ride', () => {
    expect(estimatedRideTss(3600)).toBe(45);
    expect(looksLikeADrive({ sport: 'ride', type: 'Ride', averageSpeedMs: 17 })).toBe(true);        // 38 mph, no power
    expect(looksLikeADrive({ sport: 'ride', type: 'Ride', averageSpeedMs: 17, normalizedPower: 300 })).toBe(false);
    expect(looksLikeADrive({ sport: 'ride', type: 'VirtualRide', averageSpeedMs: 17 })).toBe(false);
    expect(looksLikeADrive({ sport: 'ride', type: 'Ride', averageSpeedMs: 7 })).toBe(false);
  });
  it('fitness series follows the 42/7 day model, with form as fitness minus fatigue of the same day', () => {
    const f = fitnessSeries([{ date: '2026-01-01', tss: 100 }], '2026-01-01', '2026-01-03');
    expect(f[0].ctl).toBeCloseTo(100 / 42, 1);
    expect(f[0].atl).toBeCloseTo(100 / 7, 1);
    for (const day of f) expect(day.tsb).toBeCloseTo(day.ctl - day.atl, 1);
    // form is negative after a hard day
    expect(f[0].tsb).toBeLessThan(0);
    expect(f[1].tsb).toBeLessThan(0);
    expect(f[2].atl).toBeLessThan(f[1].atl);
    expect(f).toHaveLength(3);
  });
});

describe('compliance', () => {
  const planned = workoutStats(sweetSpot.blocks);
  const ride = (seconds: number, tss: number): Ride => ({
    id: 'r', date: '2026-10-18', startTime: '', name: '', type: 'Ride', sport: 'ride', seconds, tss,
  });
  it('nailed when within 10%', () => {
    expect(scoreRide(sweetSpot, ride(planned.seconds, planned.tss)).verdict).toBe('nailed');
  });
  it('partial when half the time', () => {
    expect(scoreRide(sweetSpot, ride(planned.seconds * 0.45, planned.tss * 0.4)).verdict).toBe('partial');
  });
  it('overcooked when load far above plan at similar duration', () => {
    expect(scoreRide(sweetSpot, ride(planned.seconds, planned.tss * 1.5)).verdict).toBe('overcooked');
  });
  it('done when close', () => {
    expect(scoreRide(sweetSpot, ride(planned.seconds * 0.8, planned.tss * 0.8)).verdict).toBe('done');
  });
});

describe('readiness', () => {
  const base = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, hrv: 50, sleepSeconds: 7 * 3600, restingHr: 50 }));
  it('is neutral at baseline', () => {
    const r = readiness({ date: '2026-10-10', hrv: 50, sleepSeconds: 7 * 3600, restingHr: 50 }, base, -5);
    expect(r.score).toBeGreaterThan(45);
    expect(r.score).toBeLessThan(65);
  });
  it('drops with low HRV, short sleep and high resting HR', () => {
    const r = readiness({ date: '2026-10-10', hrv: 35, sleepSeconds: 5 * 3600, restingHr: 58 }, base, -30);
    expect(r.band === 'rest' || r.band === 'easy').toBe(true);
    expect(r.drivers.find((d) => d.name === 'HRV')?.effect).toBe('down');
  });
  it('works with no wellness at all', () => {
    const r = readiness(undefined, [], 0);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.drivers).toHaveLength(1);
  });
});

describe('library', () => {
  it('has unique ids and sane numbers for every workout', async () => {
    const { LIBRARY } = await import('../library/workouts');
    const ids = new Set<string>();
    const names = LIBRARY.map((w) => w.name);
    expect(new Set(names).size, 'every library ride has a unique name').toBe(names.length);
    for (const w of LIBRARY) {
      if (w.family !== 'test') expect(w.subtitle, w.name).toBeTruthy();
      expect(ids.has(w.id), `duplicate id ${w.id}`).toBe(false);
      ids.add(w.id);
      const s = workoutStats(w.blocks);
      expect(s.seconds, w.name).toBeGreaterThan(20 * 60);
      expect(s.seconds, w.name).toBeLessThanOrEqual(6 * 3600 + 60);
      expect(s.tss, w.name).toBeGreaterThan(5);
      expect(w.purpose.length, w.name).toBeGreaterThan(40);
      for (const st of flattenSteps(w.blocks)) {
        expect(st.intensity, w.name).toBeGreaterThan(0.3);
        expect(st.intensityHigh ?? 2, w.name).toBeGreaterThanOrEqual(st.intensity);
      }
    }
    expect(LIBRARY.length).toBeGreaterThanOrEqual(55);
  });
  it('trail rides land on their stated total duration', async () => {
    const { OUTDOOR } = await import('../library/outdoor');
    const w = OUTDOOR.find((x) => x.id === 'trail-ss-3x12')!;
    expect(workoutStats(w.blocks).seconds).toBe(105 * 60);
    const l = OUTDOOR.find((x) => x.id === 'trail-long-195')!;
    expect(workoutStats(l.blocks).seconds).toBe(195 * 60);
  });
});

describe('ride analysis', () => {
  it('compares each planned step with the ridden average and counts hits', async () => {
    const { analyseRide, downsample } = await import('./analysis');
    const seconds = workoutStats(sweetSpot.blocks).seconds;
    const time = Array.from({ length: seconds }, (_, i) => i);
    // ride the plan: 230 W in the sweet-spot steps (target 220–230 at FTP 250), 130 W elsewhere, except the last effort at 190 W
    const steps: Array<[number, number, number]> = [];
    let t = 0;
    for (const st of flattenSteps(sweetSpot.blocks)) { steps.push([t, t + st.seconds, st.intensity]); t += st.seconds; }
    let effort = 0;
    const watts = time.map((s) => {
      const st = steps.find(([a, b]) => s >= a && s < b)!;
      if (st[2] >= 0.85) { if (s === st[0]) effort++; return effort === 3 ? 190 : 228; }
      return 130;
    });
    const a = analyseRide(sweetSpot, profile, 'power', time, watts);
    expect(a.workSteps).toBe(3);
    expect(a.workHit).toBe(2);
    expect(a.summary).toMatch(/2 of 3 work intervals on target, 1 under/);
    const ds = downsample(time, watts, 100);
    expect(ds.length).toBeGreaterThan(80);
    expect(ds.length).toBeLessThanOrEqual(101);
  });
});

describe('ready-made sessions', () => {
  it('builds strength, mobility and walks for the rider’s equipment with unique ids', async () => {
    const { readyMadeSessions } = await import('../library/sessions');
    const list = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'treadmill']);
    expect(new Set(list.map((w) => w.id)).size).toBe(list.length);
    expect(list.filter((w) => w.kind === 'strength').length).toBe(21);   // 15 + 6 of Batch 5c's 8 (the kettlebell two need a kettlebell)
    expect(list.filter((w) => w.kind === 'mobility').length).toBe(17);
    expect(list.filter((w) => w.kind === 'walk').length).toBe(14);
    for (const w of list) if (w.kind !== 'walk' && w.kind !== 'run') expect((w.exercises ?? []).length).toBeGreaterThanOrEqual(4);
    expect(list.filter((w) => w.kind === 'run').length).toBe(10);   // built always; shown only when the week has runs on
    for (const w of list) { expect(w.minutes).toBeGreaterThan(0); expect(w.source).toBe('library'); }
    for (const w of list.filter((w) => w.kind === 'strength')) for (const e of w.exercises ?? []) expect(e.equipment.some((q) => ['bodyweight', 'dumbbells', 'bench'].includes(q))).toBe(true);
    expect(list.find((w) => w.kind === 'walk')?.setting).toBe('indoor');   // the hill walk is outdoors by nature; the rest follow the treadmill
  });
  it('keeps bodyweight-only riders to bodyweight exercises', async () => {
    const { readyMadeSessions } = await import('../library/sessions');
    for (const w of readyMadeSessions(['bodyweight']).filter((w) => w.kind === 'strength')) for (const e of w.exercises ?? []) expect(e.equipment).toContain('bodyweight');
  });
});

describe('no minimum on recovery', () => {
  it('recovery-family rides lose their floors and render with a token floor', async () => {
    const { LIBRARY } = await import('../library/workouts');
    const { renderIntervalsText, stepTargets } = await import('./workout');
    const easy = LIBRARY.find((w) => w.family === 'recovery' && w.id === 'lib-spin-30')!;
    const steps = easy.blocks.flatMap((b) => (b.kind === 'step' ? [b] : b.steps));
    expect(steps.every((s) => s.noFloor)).toBe(true);
    expect(renderIntervalsText(easy, 'power')).toMatch(/ 10-\d+%/);
    expect(renderIntervalsText(easy, 'hr')).toMatch(/ 20-\d+% LTHR/);
    expect(stepTargets(steps[0], { ftp: 200, lthr: 150 } as never).watts).toMatch(/^up to \d+$/);
    const hard = LIBRARY.find((w) => w.family === 'threshold')!;
    expect(hard.blocks.flatMap((b) => (b.kind === 'step' ? [b] : b.steps)).some((s) => s.noFloor)).toBe(false);
  });
  it('a walk with no minimum is estimated as a stroll', async () => {
    const { estimateSessionTss } = await import('./sessions');
    const none = estimateSessionTss({ kind: 'walk', walk: { minutes: 60, hrLow: 0, hrHigh: 0.6 } });
    const z2 = estimateSessionTss({ kind: 'walk', walk: { minutes: 60, hrLow: 0.6, hrHigh: 0.7 } });
    expect(none).toBeGreaterThan(0);
    expect(none).toBeLessThan(z2);
  });
});

describe('historyStart', () => {
  it('starts at least 120 days back, at the earliest activity, never more than two years', async () => {
    const { historyStart } = await import('./load');
    expect(historyStart([], '2026-10-19')).toBe('2026-06-21');
    expect(historyStart(['2026-09-01'], '2026-10-19')).toBe('2026-06-21');
    expect(historyStart(['2026-01-05', '2026-09-01'], '2026-10-19')).toBe('2026-01-05');
    expect(historyStart(['2023-01-01', '2025-03-01'], '2026-10-19')).toBe('2025-03-01');
  });
});
