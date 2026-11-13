import { describe, expect, it } from 'vitest';
import type { Profile, WorkoutStep } from '../engine/types';
import { breathProvisional, breathTargetOf, breathTargetWords, breathZones, powerToVe, ridePowerZones, veToPower } from '../engine/zones';
import { stepBreath } from '../engine/workout';
import { BREATH_GAP_S, BREATH_RISE_WAIT_S, BREATH_SHORT_S, breathLearn, breathStartWatts, breathStatus, breathStepStart, breathTick, breathTrend, type BreathStep } from './breathControl';
import { breathBlocked, chooseBreathMode } from './mode';
import { breathBand, buildTimeline } from './timeline';
import { stepStats, timeInZone } from './summary';
import { LIBRARY } from '../library/workouts';
import playerSrc from '../ui/screens/Player.tsx?raw';
import rideSrc from '../ui/screens/RideScreens.tsx?raw';
import settingsSrc from '../ui/screens/Settings.tsx?raw';
import stepsSrc from '../ui/StepsTable.tsx?raw';
import type { Sample } from './types';

/** Riding by breathing on the trainer (Step 5 brief, 11 Nov 2026). Numbers are examples, not any rider's. */
const rider = (more: Partial<Profile> = {}): Profile => ({ name: 'R', ftp: 250, lthr: 160, maxHr: 185, restingHr: 50, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6, vt1Ve: 60, vt2Ve: 90, ...more }) as Profile;

describe('a breathing target for every step, from its power target', () => {
  const p = rider();
  const zones = breathZones(p)!;
  const power = ridePowerZones(p);
  it('the anchors are the rider’s own boundaries: endurance tops at the first threshold, FTP at the second', () => {
    expect(powerToVe(power[1].high, power, zones)).toBe(zones[1].high);   // top of power zone 2 = first threshold
    expect(zones[1].high).toBeCloseTo(60, 0);   // the first threshold, as a whole percent of the second
    expect(powerToVe(1, power, zones)).toBe(90);                          // FTP = second threshold
    expect(powerToVe(power[4].high, power, zones)).toBe(zones[3].high);   // top of VO2max = top of breathing zone 4
  });
  it('rises with power everywhere, sweet spot above tempo, and comes back the other way', () => {
    let last = -1;
    for (let f = 0.3; f <= 1.6; f += 0.05) { const v = powerToVe(f, power, zones); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    expect(powerToVe(0.9, power, zones)).toBeGreaterThan(powerToVe(0.8, power, zones));
    for (const f of [0.5, 0.7, 0.88, 1.0, 1.1]) expect(Math.abs(veToPower(powerToVe(f, power, zones), power, zones) - f)).toBeLessThan(0.01);
  });
  it('a ceiling stays a ceiling; a single value gets a band; the words lead with the share of the second threshold', () => {
    const easy = breathTargetOf(0.55, 0.55, true, p)!;
    expect(easy.ceiling).toBe(true);
    expect(easy.lo).toBe(0);
    expect(breathTargetWords(easy)).toMatch(/^under \d+% · \d+ L\/min$/);
    const ss = stepBreath({ seconds: 600, intensity: 0.88, intensityHigh: 0.93 } as WorkoutStep, p)!;
    expect(breathTargetWords(ss)).toMatch(/^\d+–\d+% · \d+–\d+ L\/min$/);
    expect(ss.zone).toBe(3);
    const single = stepBreath({ seconds: 600, intensity: 0.9 } as WorkoutStep, p)!;
    expect(single.hi).toBeGreaterThan(single.lo);
  });
  it('provisional until the first threshold is known; nothing at all without the second', () => {
    expect(breathProvisional(p)).toBe(false);
    expect(breathProvisional(rider({ vt1Ve: undefined }))).toBe(true);
    expect(breathTargetOf(0.9, 0.95, false, rider({ vt1Ve: undefined, vt2Ve: undefined }))).toBeUndefined();
    expect(stepBreath({ seconds: 600, intensity: 0.9 } as WorkoutStep, rider({ vt2Ve: undefined }))).toBeUndefined();
  });
});

describe('which rides, and the player’s choice', () => {
  it('a ride that works by heart rate works by breathing; a power-only ride does not, and says why', () => {
    expect(breathBlocked(true, true)).toBeUndefined();
    expect(breathBlocked(false, true)).toMatch(/too short to ride by breathing/);
    expect(breathBlocked(true, false)).toMatch(/needs your breathing zones/);
  });
  it('a strap sending and a trainer in control: the trainer adjusts; no control: the rider’s gears; no breathing yet: wait', () => {
    const trainer = { id: 't', name: 'T', kind: 'trainer', status: 'connected', controllable: true } as never;
    expect(chooseBreathMode([trainer], { ve: { value: 40, from: 's', kind: 'breath' } }).mode).toBe('breath-trainer');
    expect(chooseBreathMode([], { ve: { value: 40, from: 's', kind: 'breath' } }).mode).toBe('breath-self');
    expect(chooseBreathMode([trainer], {}).mode).toBeUndefined();
  });
  it('Breathing appears only with a strap connected, and is greyed with its reason when it can’t be used', () => {
    expect(playerSrc).toMatch(/strapOn && !workout\.test && <button[^>]*disabled=\{!!whyNotBreath\}/);
    expect(playerSrc).toMatch(/profile\.preferBreath && strapOn/);
    expect(settingsSrc).toMatch(/breathZones\(p\) && <div class="field"><label>In the ride player, start on/);
  });
  it('the ride page’s steps show breathing only for a rider with zones', () => {
    expect(stepsSrc).toMatch(/const showBreath = breath && !!breathZones\(profile\)/);
  });
  it('the riding screen has the breathing hero, the way on when breathing stops, and the trainer adjusting to breathing', () => {
    expect(rideSrc).toMatch(/function BreathHero/);
    expect(rideSrc).toMatch(/Breathing has stopped arriving/);
    expect(rideSrc).toMatch(/Carry on by heart rate/);
    expect(rideSrc).toMatch(/Carry on by power/);
    expect(rideSrc).toMatch(/'Adjusts to breathing'/);
  });
});

describe('the trainer follows the breathing', () => {
  const step: BreathStep = { seconds: 900, noFloor: false, zone: 3, low: 70, high: 78, plannedWatts: 220, hrHigh: 165 };
  it('starts at learned watts, else a neighbour’s scaled, else the planned watts', () => {
    expect(breathStartWatts({ 3: { watts: 231, at: 'x', n: 2 } }, 3, 220)).toEqual({ watts: 230, learned: true });
    expect(breathStartWatts({ 2: { watts: 200, at: 'x', n: 2 } }, 3, 220).watts).toBe(230);
    expect(breathStartWatts({}, 3, 222)).toEqual({ watts: 220, learned: false });
  });
  it('rises a little when breathing is under, no more than every 20 seconds, and waits a minute after a rise', () => {
    let st = breathStepStart({ watts: 200, learned: false });
    let r = breathTick(st, step, BREATH_GAP_S, 60, undefined, 250);
    expect(r.state.target).toBe(210);           // well under: 4% of an FTP of 250, 10 W
    st = r.state;
    r = breathTick(st, step, BREATH_GAP_S + 30, 60, undefined, 250);
    expect(r.state.target).toBe(210);           // waiting after the rise
    r = breathTick(st, step, BREATH_GAP_S + BREATH_RISE_WAIT_S, 68, undefined, 250);
    expect(r.state.target).toBe(215);           // a little under: 2% of 250, 5 W
  });
  it('eases when breathing is over; holds when it is in range or not yet usable', () => {
    const st = breathStepStart({ watts: 240, learned: true });
    expect(breathTick(st, step, 30, 90, undefined, 250).state.target).toBe(230);
    expect(breathTick(st, step, 30, 75, undefined, 250).state.target).toBe(240);
    expect(breathTick(st, step, 30, undefined, undefined, 250).state.target).toBe(240);
  });
  it('short steps are held, not steered', () => {
    const st = breathStepStart({ watts: 300, learned: true });
    expect(breathTick(st, { ...step, seconds: BREATH_SHORT_S - 1 }, 60, 50, undefined, 250).state.target).toBe(300);
    expect(breathStatus(st, { ...step, seconds: 60 }, 30, 50, true)).toMatch(/Short efforts aren't steered by breathing/);
  });
  it('heart rate well above its zone eases the trainer, even on a short step', () => {
    let st = breathStepStart({ watts: 300, learned: true });
    st = breathTick(st, { ...step, seconds: 60 }, 1, 50, 180, 250).state;
    const r = breathTick(st, { ...step, seconds: 60 }, 22, 50, 180, 250);
    expect(r.easedNow).toBe(true);
    expect(r.state.target).toBe(240);
  });
  it('never above its ceiling: at the limit it asks', () => {
    let st = breathStepStart({ watts: 200, learned: false });
    for (let t = 20; t < 2000; t += 70) st = breathTick(st, step, t, 50, undefined, 250).state;
    expect(st.target).toBeLessThanOrEqual(250);
    expect(st.asking).toBe(true);
  });
  it('says when it is holding for the strap to be read, and when breathing is rising', () => {
    const st = breathStepStart({ watts: 200, learned: false });
    expect(breathStatus(st, step, 30, 72, false)).toMatch(/reads your strap for today/);
    expect(breathTrend({ ...st, vePrev: 60, veMark: 70 })).toBe('rising');
    expect(breathTrend({ ...st, vePrev: 70, veMark: 60 })).toBe('falling');
  });
  it('learns: 70% the new, 30% the old', () => {
    expect(breathLearn({ 3: { watts: 200, at: 'x', n: 1 } }, 3, 230, 'y')[3]).toEqual({ watts: 221, at: 'y', n: 2 });
  });
});

describe('after the ride', () => {
  const p = rider();
  const w = LIBRARY.find((x) => x.bases.includes('hr') && x.id === 'b2-thr-3x15')!;
  const tl = buildTimeline(w, p);
  it('steps are judged by ventilation against their breathing band, and time in breathing zone is counted', () => {
    const work = tl.find((s) => s.work)!;
    const b = breathBand(work, p)!;
    const inside = (b.low + b.high) / 2;
    const samples: Sample[] = Array.from({ length: 100 }, (_, i) => ({ t: i, s: work.index, w: 240, ve: i < 80 ? inside : b.high + 5 }) as Sample);
    const st = stepStats(samples, tl, (s) => breathBand(s, p)!, 'breath').find((x) => x.step.index === work.index)!;
    expect(st.onTarget).toBeCloseTo(0.8, 2);
    expect(st.avgVe).toBeGreaterThan(0);
    expect(timeInZone(samples, tl, (s) => breathBand(s, p), (x) => x.ve).seconds).toBe(80);
  });
});

describe('breathing changes are a share of FTP (12 Nov 2026)', () => {
  it('2%, or 4% when far off, in whole watts, never under 5 W', async () => {
    const { breathChange } = await import('./breathControl');
    expect([breathChange(120, false), breathChange(120, true)]).toEqual([5, 5]);
    expect([breathChange(250, false), breathChange(250, true)]).toEqual([5, 10]);
    expect([breathChange(400, false), breathChange(400, true)]).toEqual([8, 16]);
  });
});
