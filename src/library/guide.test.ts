import { describe, expect, it } from 'vitest';
import { GUIDE_RIDES } from './guide';
import { trainsOf, type System } from './trains';
import { flattenSteps, workoutStats } from '../engine/workout';
import { stepProblems } from './stepRule';
import type { Workout, WorkoutStep } from '../engine/types';

const L2 = (key: string) => GUIDE_RIDES.find((w) => w.id === `g-${key}-2`)!;
const counts = (w: Workout) => Object.fromEntries(trainsOf(w).parts.map((p) => [p.sys, { amount: p.amount, counts: p.counts }]));

describe('the twelve sample rides measure as the guide says', () => {
  const expectCounts = (key: string, want: Partial<Record<System, number>>, tooLittle: Partial<Record<System, number>> = {}) => {
    const got = counts(L2(key));
    for (const [sys, amt] of Object.entries(want)) expect(got[sys], `${key} ${sys}`).toEqual({ amount: amt, counts: true });
    for (const [sys, amt] of Object.entries(tooLittle)) expect(got[sys], `${key} ${sys}`).toEqual({ amount: amt, counts: false });
    expect(Object.keys(got).sort()).toEqual([...Object.keys(want), ...Object.keys(tooLittle)].sort());
  };
  it('1 Signal Knob', () => expectCounts('signal-knob', { sprint: 4, vo2: 480, threshold: 720 }));
  it('2 Woodstock Tower', () => expectCounts('woodstock-tower', { vo2: 720, sweetspot: 960 }, { threshold: 240 }));
  it('3 Goshen Pass', () => expectCounts('goshen-pass', { vo2: 540, threshold: 1260 }));
  it('4 Edinburg Gap', () => expectCounts('edinburg-gap', { vo2: 1080, tempo: 900 }));
  it('5 Thunder Ridge', () => expectCounts('thunder-ridge', { anaerobic: 200, threshold: 1300 }));
  it('6 Damascus', () => expectCounts('damascus', { anaerobic: 240, threshold: 1080, tempo: 1020 }, { sprint: 1, vo2: 60 }));
  it('7 High Bridge', () => expectCounts('high-bridge', { threshold: 1440, endurance: 3000 }, { sprint: 2 }));
  it('8 Seven Bends', () => expectCounts('seven-bends', { threshold: 600, sweetspot: 720, tempo: 900 }));
  it('9 Back Bay', () => expectCounts('back-bay', { sprint: 4, endurance: 2820 }));
  it('10 Belle Isle', () => expectCounts('belle-isle', {}, { endurance: 960 }));
  it('11 Crabtree Falls', () => expectCounts('crabtree-falls', { tempo: 1440 }, { sweetspot: 480 }));
  it('12 First Landing', () => expectCounts('first-landing', {}, { endurance: 1380 }));
  it('labels, hardest first', () => {
    expect(trainsOf(L2('signal-knob')).label).toBe('Sprint, VO2max and threshold');
    expect(trainsOf(L2('belle-isle')).label).toBe('A skill ride');
    expect(trainsOf(L2('seven-bends')).label).toBe('Threshold, sweet spot and tempo');
  });
});

/** The guide's section 14 and section 8, checked on all 48 rides. */
describe('every guide ride passes the check', () => {
  const work = (s: WorkoutStep) => !!s.allOut || s.intensity >= 0.75;
  for (const w of GUIDE_RIDES) {
    it(w.name, () => {
      const t = trainsOf(w);
      const steps = flattenSteps(w.blocks);
      // 1. At most three systems count.
      expect(t.counted.length).toBeLessThanOrEqual(3);
      // 3. Every step change asks for something different.
      expect(stepProblems(w)).toEqual([]);
      // 5. Limits.
      const amt = (s: System) => t.parts.find((p) => p.sys === s)?.amount ?? 0;
      expect(amt('threshold')).toBeLessThanOrEqual(45 * 60);
      expect(amt('sweetspot')).toBeLessThanOrEqual(60 * 60);
      expect(amt('vo2')).toBeLessThanOrEqual(24 * 60);
      expect(amt('anaerobic')).toBeLessThanOrEqual(10 * 60);
      const easyDay = w.family === 'endurance' || w.family === 'recovery';
      expect(amt('sprint')).toBeLessThanOrEqual(easyDay ? 6 : 10);
      // Cool-down at least 4 minutes.
      expect(steps[steps.length - 1].label).toMatch(/cool/i);
      expect(steps[steps.length - 1].seconds).toBeGreaterThanOrEqual(240);
      // Warm-up before work above threshold: ten minutes, with a minute near threshold; on an easy day, 15 min before a sprint.
      const firstAbove = steps.findIndex((s) => s.allOut || s.intensity > 1.05);
      if (firstAbove >= 0) {
        const before = steps.slice(0, firstAbove);
        const secs = before.reduce((a, s) => a + s.seconds, 0);
        if (easyDay) expect(secs).toBeGreaterThanOrEqual(15 * 60);
        else { expect(secs).toBeGreaterThanOrEqual(10 * 60); expect(before.some((s) => s.intensity >= 0.9 && s.seconds >= 60)).toBe(true); }
      }
      // Easy after a VO2max effort at least half its length (over-unders excepted); after a sprint at least 2 minutes.
      steps.forEach((s, i) => {
        const next = steps[i + 1];
        if (!next || work(next)) return;
        if (!s.allOut && s.intensity > 1.05 && s.intensity <= 1.2) expect(next.seconds).toBeGreaterThanOrEqual(s.seconds / 2);
        if (s.allOut && i < steps.length - 2) expect(next.seconds).toBeGreaterThanOrEqual(120);
      });
      // Easy-day sprints: 10 seconds or less, then at least 3 minutes easy; nothing between 75% and a sprint.
      if (easyDay) steps.forEach((s, i) => {
        if (s.allOut) { expect(s.seconds).toBeLessThanOrEqual(10); expect(steps[i + 1].seconds).toBeGreaterThanOrEqual(180); }
        else expect(s.intensity).toBeLessThan(0.75);
      });
      // 6. Power only when a targeted effort is under 3 minutes, unless it is a small change inside a longer block.
      if (w.bases.includes('hr')) steps.forEach((s, i) => {
        if (s.allOut || s.intensity < 0.75 || s.seconds >= 180) return;
        const near = [steps[i - 1], steps[i + 1]].filter(Boolean).some((n) => work(n!) && !n!.allOut && Math.abs(n!.intensity - s.intensity) <= 0.1);
        expect(near, `${w.name}: a ${s.seconds}s effort at ${s.intensity} in a heart-rate ride`).toBe(true);
      });
      // 7. An outdoor version or "indoors" with a reason.
      if (w.indoorWhy) expect(w.tags?.outdoor).toBe('indoor');
      // 4 and the page: why it is built this way.
      expect(w.why).toBeTruthy();
      // 9. Cues of the five kinds, none over 110 characters.
      const cues = steps.flatMap((s) => s.cues ?? []);
      for (const k of ['why', 'focus', 'hard', 'next', 'lesson'] as const) if (!(k === 'hard' && t.counted.length === 0 && !w.skills)) expect(cues.some((c) => c.kind === k), `${w.name} has a ${k} cue`).toBe(true);
      for (const c of cues) expect(c.text.length, c.text).toBeLessThanOrEqual(110);
    });
  }
});

describe('families: each level differs from the last by one thing', () => {
  const keys = [...new Set(GUIDE_RIDES.map((w) => w.tags!.series!.id))];
  it('twelve families of four', () => { expect(keys.length).toBe(12); for (const k of keys) expect(GUIDE_RIDES.filter((w) => w.tags!.series!.id === k).length).toBe(4); });
  for (const k of keys) it(k, () => {
    const lv = GUIDE_RIDES.filter((w) => w.tags!.series!.id === k).sort((a, b) => a.tags!.series!.rung - b.tags!.series!.rung);
    for (let i = 1; i < 4; i++) {
      const a = lv[i - 1], b = lv[i];
      expect(b.levelChange).toBeTruthy();
      // One thing: the ride grows (or its targets rise) and nothing else about it is different. Measured as: the step lists
      // differ, and the change is one of more efforts, longer efforts, a higher target, a shorter rest, one more set or a longer ride.
      const sa = workoutStats(a.blocks), sb = workoutStats(b.blocks);
      expect(sb.tss, `${b.name} is harder than ${a.name}`).toBeGreaterThan(sa.tss - 1);
      expect(JSON.stringify(a.blocks)).not.toBe(JSON.stringify(b.blocks));
      // Only one kind of difference between the two step lists: count, length, or target.
      const fa = flattenSteps(a.blocks), fb = flattenSteps(b.blocks);
      const sameCount = fa.length === fb.length;
      const lenDiff = sameCount ? fa.filter((s, j) => s.seconds !== fb[j].seconds).length : 0;
      const tgtDiff = sameCount ? fa.filter((s, j) => s.intensity !== fb[j].intensity || s.cadence !== fb[j].cadence || s.intensityHigh !== fb[j].intensityHigh).length : 0;
      expect(sameCount ? (lenDiff > 0) !== (tgtDiff > 0) : true, `${b.name}: changes one thing`).toBe(true);
    }
  });
});

describe('zone 2 inside a repeated set is endurance, not a rest (13 Nov 2026)', () => {
  it('Aquia: six sprints and 54 minutes of endurance; Appomattox: 24 minutes of tempo and 80 of endurance', async () => {
    const { LIBRARY } = await import('./workouts');
    const of = (id: string) => Object.fromEntries(trainsOf(LIBRARY.find((w) => w.id === id)!).parts.map((p) => [p.sys, p.amount]));
    expect(of('b2-z2-sprints-70')).toEqual({ sprint: 6, endurance: 54 * 60 });
    expect(of('b1-z2-hilltempo-135')).toEqual({ tempo: 24 * 60, endurance: 80 * 60 });
    expect(trainsOf(LIBRARY.find((w) => w.id === 'b1-z2-hilltempo-135')!).label).toBe('Tempo and endurance');
  });
  it('Aldie: a step named "Zone 2 for the rest" is endurance riding, not a rest', async () => {
    const { LIBRARY } = await import('./workouts');
    const t = trainsOf(LIBRARY.find((w) => w.id === 'trail-ss-4x10')!);
    expect(t.label).toBe('Sweet spot and endurance');
    expect(t.parts.find((p) => p.sys === 'endurance')?.amount).toBe(30 * 60);
  });
});
