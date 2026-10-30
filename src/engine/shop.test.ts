import { describe, expect, it } from 'vitest';
import { abilityOf, contribution, rideMinutes } from './contribution';
import { shopWeek, type ShopContext, type Slot } from './shop';
import { shopLibrary } from './planner';
import type { WeekNeeds } from './needs';
import { zeroMinutes } from './contribution';
import { LIBRARY } from '../library/workouts';
import { EXERCISES } from '../library/strength';
import { readyMadeSessions } from '../library/sessions';
import type { Equipment } from './types';

const ride = (id: string) => LIBRARY.find((w) => w.id === id)!;

describe('contributions: what a Library workout gives a week', () => {
  it('bands: easy to 0.75, tempo from 0.76, sweet spot from 0.88, threshold from 0.95, VO2 from 1.06, anaerobic above 1.20', () => {
    expect(abilityOf(0.5)).toBe('recovery');
    expect(abilityOf(0.7)).toBe('easy');
    expect(abilityOf(0.76)).toBe('tempo');
    expect(abilityOf(0.9)).toBe('sweetspot');
    expect(abilityOf(1.0)).toBe('threshold');
    expect(abilityOf(1.1)).toBe('vo2');
    expect(abilityOf(1.3)).toBe('anaerobic');
  });
  it('a threshold 2 × 20 gives about 40 minutes at threshold; a sweet spot 3 × 15 about 45 at sweet spot', () => {
    const t = contribution(ride('lib-thr-2x20'));
    expect(t.at.threshold).toBeGreaterThan(36);
    expect(t.dominant).toBe('threshold');
    const s = contribution(ride('lib-ss-3x15'));
    expect(s.at.sweetspot).toBeGreaterThan(40);
    expect(s.dominant).toBe('sweetspot');
  });
  it('a VO2 4 × 4 by heart rate gives 16 minutes of VO2; a long steady ride is almost all easy', () => {
    expect(Math.round(contribution(ride('lib-vo2-hr-4x4')).at.vo2)).toBe(16);
    const l = contribution(ride('lib-long-180'));
    expect(l.dominant).toBe('easy');
    expect(l.at.easy).toBeGreaterThan(150);
  });
  it('a long ride with a tempo finish counts its tempo', () => {
    const c = contribution(ride('trail-long-tempo-180'));
    expect(c.at.tempo).toBeGreaterThan(20);
  });
  it('a range step is shared across the bands it spans', () => {
    const m = rideMinutes([{ kind: 'step', seconds: 600, intensity: 0.7, intensityHigh: 0.8 }]);
    expect(m.easy + m.tempo).toBeCloseTo(10, 5);
    expect(m.easy).toBeGreaterThan(0);
    expect(m.tempo).toBeGreaterThan(0);
  });
  it('strength: quality and focus from the session; walks count half their minutes as easy, a pack more', () => {
    const all = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk']);
    const heavy = all.find((w) => w.name === 'Heavy legs')!;
    expect(contribution(heavy).quality).toBe('heavy');
    expect(contribution(heavy).focus).toBe('legs');
    const walk = all.find((w) => w.kind === 'walk' && !w.walk?.packKg && w.walk?.minutes === 60) ?? all.find((w) => w.kind === 'walk' && !w.walk?.packKg)!;
    expect(contribution(walk).at.easy).toBeCloseTo(contribution(walk).minutes * 0.5, 5);
    const pack = all.find((w) => w.kind === 'walk' && (w.walk?.packKg ?? 0) >= 6)!;
    expect(contribution(pack).strengthEndurance).toBe(true);
  });
  it('every strength exercise has one or two qualities', () => {
    for (const e of EXERCISES) { expect(e.qualities.length, e.id).toBeGreaterThan(0); expect(e.qualities.length, e.id).toBeLessThanOrEqual(2); }
  });
});

// ---------------------------------------------------------------------------

const MON = '2026-11-02';
const dateOf = (dow: number) => { const d = new Date(MON + 'T00:00:00'); d.setDate(d.getDate() + ((dow + 6) % 7)); return d.toISOString().slice(0, 10); };
function slots(hours: number[], opts: { outdoor?: number[]; noBike?: number[]; pins?: Record<number, Slot['pin']>; never?: Record<number, Slot['never']> } = {}): Slot[] {
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ dow, date: dateOf(dow), minutes: (hours[dow] ?? 0) * 60, outdoor: !!opts.outdoor?.includes(dow), noBike: !!opts.noBike?.includes(dow), pin: opts.pins?.[dow], never: opts.never?.[dow] ?? [] }));
}
const EQ: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'treadmill', 'outdoor-walk'];
function ctx(over: Partial<ShopContext> = {}): ShopContext {
  return { basis: 'power', equipment: EQ, may: { strength: true, mobility: true, walk: true, run: false }, prefs: { walk: 'fine', run: 'fine', mobility: 'fine' },
    costs: { afterLong: 0.3, afterHard: 0.3, afterStrength: 0.3 }, masters: true, recent: new Map(), library: shopLibrary('power', EQ, []), requiredLongest: 0, ...over };
}
function needs(over: Partial<WeekNeeds> = {}): WeekNeeds {
  return { index: 3, start: MON, label: 'build', budgetTss: 450, budgetHours: 8, minutes: { ...zeroMinutes(), easy: 200, sweetspot: 30, threshold: 40 }, longRideSeconds: 3 * 3600, secondLongRideSeconds: 0,
    hardSessions: 2, test: false, openers: false, strength: { quality: 'heavy', dose: 'build', count: 2 }, mobilityMinutes: 30, pairedMobility: { afterLongRide: true, afterStrength: true },
    footAerobicMinutes: 0, restDays: 1, specificity: 0.7, loadingProgress: 0.6, mostlyAway: false, ...over };
}
const HOURS = [3.5, 1, 1.5, 1, 1.5, 0, 4];   // Sunday 3.5 h, weekdays, Saturday 4 h
const dows = (list: { date: string }[]) => list.map((x) => new Date(x.date + 'T00:00:00').getDay());

describe('the shopper: a week filled from the Library', () => {
  it('every session is a Library workout; the long ride is on the biggest day and is the length asked', () => {
    const r = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx());
    expect(r.sessions.every((s) => s.workout.source === 'library')).toBe(true);
    const long = r.sessions.find((s) => s.type === 'long')!;
    expect(dows([long])).toEqual([6]);
    expect(Math.abs(long.seconds - 3 * 3600)).toBeLessThanOrEqual(15 * 60);
    expect(long.workout.setting).not.toBe('indoor');
  });
  it('quality rides are spaced: never two hard days running, never the day before the long ride when another day will do', () => {
    const r = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx());
    const hard = r.sessions.filter((s) => ['sweetspot', 'threshold', 'vo2max', 'anaerobic', 'tempo'].includes(s.type));
    expect(hard.length).toBe(2);
    const d = dows(hard).sort();
    expect(d[1] - d[0]).toBeGreaterThan(1);
    expect(d).not.toContain(5);
    expect(hard.some((s) => s.workout.family === 'threshold')).toBe(true);
  });
  it('strength: the week’s quality, legs then upper body, at the week’s level, on days that are not hard days', () => {
    const r = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx());
    const str = r.sessions.filter((s) => s.kind === 'strength');
    expect(str.map((s) => s.workout.strength?.focus).sort()).toEqual(['legs', 'upper']);
    expect(str.every((s) => s.workout.strength?.quality === 'heavy')).toBe(true);
    const hardDays = r.sessions.filter((s) => ['sweetspot', 'threshold'].includes(s.type)).map((s) => s.date);
    expect(str.some((s) => hardDays.includes(s.date))).toBe(false);
  });
  it('pins and nevers are honoured', () => {
    const r = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6], pins: { 2: 'strength', 1: 'rest' }, never: { 4: ['ride'] } }), ctx());
    expect(r.sessions.filter((s) => s.date === dateOf(1))).toEqual([]);
    expect(r.sessions.filter((s) => s.date === dateOf(2)).map((s) => s.kind)).toContain('strength');
    expect(r.sessions.some((s) => s.date === dateOf(2) && s.kind === 'ride')).toBe(false);
    expect(r.sessions.some((s) => s.date === dateOf(4) && s.kind === 'ride')).toBe(false);
  });
  it('a no-bike day gets foot work: an easy walk', () => {
    const r = shopWeek(needs({ strength: { quality: 'heavy', dose: 'build', count: 0 } }), slots([3.5, 1, 1.5, 1, 1.5, 1, 4], { outdoor: [0, 6], noBike: [5] }), ctx());
    const fri = r.sessions.filter((s) => s.date === dateOf(5));
    expect(fri.some((s) => s.kind === 'walk')).toBe(true);
    expect(fri.some((s) => s.kind === 'ride')).toBe(false);
    expect(fri.find((s) => s.kind === 'walk')!.reason).toMatch(/no bike today/);
  });
  it('rebalances the easy rides toward the week’s budget', () => {
    const lo = shopWeek(needs({ budgetTss: 300 }), slots(HOURS, { outdoor: [0, 6] }), ctx());
    const hi = shopWeek(needs({ budgetTss: 520 }), slots(HOURS, { outdoor: [0, 6] }), ctx());
    expect(hi.tss).toBeGreaterThan(lo.tss);
  });
  it('variety: a ride picked last week is passed over when another does the same job', () => {
    const first = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx());
    const thr = first.sessions.find((s) => s.workout.family === 'threshold')!.workout.id;
    const second = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx({ recent: new Map([[thr, 1]]) }));
    expect(second.sessions.find((s) => s.workout.family === 'threshold')!.workout.id).not.toBe(thr);
  });
  it('reasons are plain sentences from the need, with nothing about fit or gaps', () => {
    const r = shopWeek(needs(), slots(HOURS, { outdoor: [0, 6] }), ctx());
    for (const s of r.sessions) {
      expect(s.reason.length).toBeGreaterThan(10);
      expect(s.reason).not.toMatch(/Library|nearest|fit|gap/i);
    }
    expect(r.sessions.find((s) => s.workout.family === 'threshold')!.reason).toMatch(/^Threshold work: this week asks for 40 minutes at FTP\.$/);
  });
  it('a heart-rate rider is never given a power-only ride', () => {
    const r = shopWeek(needs({ minutes: { ...zeroMinutes(), easy: 200, vo2: 16, threshold: 30 } }), slots(HOURS, { outdoor: [0, 6] }), ctx({ basis: 'hr', library: shopLibrary('hr', EQ, []) }));
    expect(r.sessions.filter((s) => s.kind === 'ride').every((s) => s.workout.bases.includes('hr'))).toBe(true);
  });
});

describe('the sweep (developers only)', () => {
  it('reports what the Library cannot supply: with no VO2max rides, a week that wants VO2 says so', () => {
    const lib = shopLibrary('power', EQ, []);
    const r = shopWeek(needs({ minutes: { ...zeroMinutes(), easy: 200, vo2: 20 }, hardSessions: 1 }), slots(HOURS, { outdoor: [0, 6] }), ctx({ library: { ...lib, rides: lib.rides.filter((w) => w.family !== 'vo2max') } }));
    expect(r.unmet.some((u) => u.kind === 'ride' && u.want === 'vo2')).toBe(true);
  });
  it('runs on a small grid, and the Library meets the thresholds: 97% of weeks with dumbbells and a bench or more, 90% bodyweight only', async () => {
    const { runSweep, FULL_GRID } = await import('./sweep');
    const r = runSweep({ ...FULL_GRID, goals: ['century', 'group-ride', 'ftp', 'vo2max', 'weight'], weeks: [8], hours: [4, 8], days: [3, 5], foot: [{ walk: true, run: true }], riders: ['beginner', 'masters'] });
    expect(r.plans).toBe(5 * 2 * 2 * 5 * 2 * 2);
    for (const [eq, v] of Object.entries(r.byEquipment)) expect(v.met / v.weeks, eq).toBeGreaterThanOrEqual(eq === 'bodyweight' ? 0.9 : 0.97);
  }, 60000);
});
