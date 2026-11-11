import { describe, expect, it } from 'vitest';
import { BATCH2 } from './batch2';
import { LIBRARY } from './workouts';
import { tagsOf } from './tags';
import { bandOf } from '../engine/depth';
import { flattenStepsWithSets } from '../engine/workout';
import { buildTimeline, cueAt } from '../player/timeline';
import type { Profile } from '../engine/types';

const steps = (w: (typeof LIBRARY)[number]) => flattenStepsWithSets(w.blocks).map((x) => x.step);
const byName = (n: string) => BATCH2.find((w) => w.name === n)!;

describe('the Library grows up, Part C, batch 2 (10 Nov 2026)', () => {
  it('adds 61 rides, every name from the pool used once and every id new', () => {
    expect(BATCH2).toHaveLength(61);
    const names = LIBRARY.map((w) => w.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(LIBRARY.map((w) => w.id)).size).toBe(LIBRARY.length);
    expect(LIBRARY.filter((w) => w.id.startsWith('b2-'))).toHaveLength(61);
  });

  it('every subtitle says what the ride is, short enough for a phone row', () => {
    for (const w of BATCH2) {
      expect(w.subtitle, w.name).toBeTruthy();
      expect(w.subtitle!.length, w.subtitle).toBeLessThanOrEqual(40);
    }
  });

  it('every new ride has cues on its work, and its steps add up to whole minutes', () => {
    for (const w of BATCH2) {
      const s = steps(w);
      expect(s.every((x) => x.cues?.length), w.name).toBe(true);
      const secs = s.reduce((a, x) => a + x.seconds, 0);
      expect(Math.abs(secs / 60 - Math.round(secs / 60)), w.name).toBeLessThan(0.02);
    }
  });

  it('a ride that works by heart rate never asks heart rate to follow efforts shorter than two minutes', () => {
    for (const w of BATCH2.filter((x) => x.bases.includes('hr') && tagsOf(x).purpose !== 'recovery' && tagsOf(x).purpose !== 'endurance'))
      for (const s of steps(w)) if (s.intensity >= 0.88) expect(s.seconds, w.name).toBeGreaterThanOrEqual(120);
  });

  it('fills the gaps the depth sweep and modern training call for', () => {
    const has = (re: RegExp) => BATCH2.filter((w) => re.test(w.subtitle ?? '')).length;
    expect(has(/over-under|criss-cross/i)).toBeGreaterThanOrEqual(4);
    expect(has(/30\/15/)).toBe(1);
    expect(has(/Durability/)).toBe(4);
    expect(has(/Torque|Big gear|Low-cadence/)).toBeGreaterThanOrEqual(3);
    expect(has(/Standing starts|Flying sprints|Tabata|Micro-bursts|20\/40/)).toBe(5);
    // Sweet spot by heart rate in 45 to 60 minutes, and easy rides of 65 to 80 minutes.
    const ssHr = BATCH2.filter((w) => tagsOf(w).purpose === 'sweetspot' && w.bases.includes('hr') && bandOf(tagsOf(w).minutes) === '45–60 min');
    expect(ssHr.length).toBeGreaterThanOrEqual(4);
    const easy = BATCH2.filter((w) => tagsOf(w).purpose === 'endurance' && tagsOf(w).minutes >= 65 && tagsOf(w).minutes <= 80);
    expect(easy.length).toBeGreaterThanOrEqual(7);
    // The sweep's shopping list: endurance of 1½–2 h and sweet spot of 3–4 h, both ways.
    expect(BATCH2.some((w) => tagsOf(w).purpose === 'endurance' && bandOf(tagsOf(w).minutes) === '1½–2 h' && w.bases.includes('hr'))).toBe(true);
    expect(BATCH2.some((w) => tagsOf(w).purpose === 'sweetspot' && bandOf(tagsOf(w).minutes) === '3–4 h' && w.bases.includes('hr'))).toBe(true);
  });

  it('fast on/off work is for the trainer; long rides for the road ride well outdoors', () => {
    expect(tagsOf(byName("Mary's Rock")).outdoor).toBe('indoor');
    expect(tagsOf(byName('Natural Chimneys')).outdoor).toBe('indoor');
    for (const w of BATCH2.filter((x) => x.setting === 'outdoor')) expect(tagsOf(w).outdoor, w.name).toBe('well');
  });

  it('the progression families climb in order', () => {
    for (const id of ['over-under', 'threshold-long', 'sweetspot-hr', 'durability']) {
      const rungs = LIBRARY.filter((w) => tagsOf(w).series?.id === id).map((w) => tagsOf(w).series!.rung).sort();
      expect(rungs, id).toEqual([1, 2, 3, 4]);
    }
  });
});

describe('every Library ride speaks in the player (10 Nov 2026)', () => {
  const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 75, basis: 'power', masters: false, units: 'imperial', rideDays: [], hoursPerWeek: 6 };
  it('every Library ride has cues, and every step of the first 96 rides has one', () => {
    const batches = new Set(LIBRARY.filter((w) => /^b[12]-/.test(w.id)).map((w) => w.id));
    for (const w of LIBRARY.filter((x) => x.kind === 'ride')) {
      expect(steps(w).some((s) => s.cues?.length), w.name).toBe(true);
      if (!batches.has(w.id)) expect(steps(w).filter((s) => !s.cues?.length).length, w.name).toBe(0);
    }
  });
  it('hand-written cues are kept; the first rides get cues from their effort', () => {
    const tl = buildTimeline(LIBRARY.find((w) => w.id === 'lib-vo2-5x3')!, profile);
    const hard = tl.filter((s) => s.intensity >= 1.06);
    expect(hard.length).toBeGreaterThan(2);
    expect(cueAt(hard[0], 5)).toMatch(/VO2max/);
    expect(cueAt(hard[hard.length - 1], 5)).toMatch(/The last one/);
    expect(cueAt(hard[0], 5)).not.toMatch(/The last one/);
  });
});
