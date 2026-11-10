import { describe, expect, it } from 'vitest';
import { BATCH1 } from './batch1';
import { LIBRARY } from './workouts';
import { outdoorVersion, tagsOf } from './tags';
import { bandOf } from '../engine/depth';
import { flattenStepsWithSets } from '../engine/workout';
import { buildTimeline, cueAt } from '../player/timeline';
import type { Profile } from '../engine/types';

/** What the depth sweep asked for (docs/library-depth.md, 9 Nov): purpose, length band, and how many must work by heart rate. */
const WANTED: Array<{ purpose: string; band: string; n: number; hr: number }> = [
  { purpose: 'endurance', band: '45–60 min', n: 7, hr: 7 }, { purpose: 'endurance', band: '1–1½ h', n: 4, hr: 4 },
  { purpose: 'endurance', band: '1½–2 h', n: 2, hr: 2 }, { purpose: 'endurance', band: '2–3 h', n: 2, hr: 2 }, { purpose: 'endurance', band: '3–4 h', n: 1, hr: 1 },
  { purpose: 'vo2', band: '1–1½ h', n: 4, hr: 4 }, { purpose: 'vo2', band: '45–60 min', n: 2, hr: 2 }, { purpose: 'vo2', band: '1½–2 h', n: 2, hr: 0 }, { purpose: 'vo2', band: 'under 45 min', n: 2, hr: 0 },
  { purpose: 'sweetspot', band: '3–4 h', n: 3, hr: 3 }, { purpose: 'sweetspot', band: '45–60 min', n: 2, hr: 2 }, { purpose: 'sweetspot', band: '2–3 h', n: 1, hr: 1 },
  { purpose: 'recovery', band: 'under 45 min', n: 4, hr: 4 }, { purpose: 'recovery', band: '45–60 min', n: 1, hr: 1 },
  { purpose: 'tempo', band: '1½–2 h', n: 2, hr: 2 }, { purpose: 'tempo', band: '45–60 min', n: 1, hr: 1 }, { purpose: 'tempo', band: '2–3 h', n: 1, hr: 1 }, { purpose: 'tempo', band: '1–1½ h', n: 1, hr: 1 },
  { purpose: 'threshold', band: '45–60 min', n: 4, hr: 4 },
  { purpose: 'mixed', band: '2–3 h', n: 2, hr: 0 }, { purpose: 'mixed', band: '1–1½ h', n: 2, hr: 0 },
  { purpose: 'anaerobic', band: '45–60 min', n: 1, hr: 1 }, { purpose: 'anaerobic', band: '1–1½ h', n: 1, hr: 0 },
];

describe('the Library grows up, Part C, batch 1 (9 Nov 2026)', () => {
  it('is the 52 rides the depth sweep asked for, each in its purpose and length', () => {
    expect(BATCH1).toHaveLength(52);
    for (const want of WANTED) {
      const got = BATCH1.filter((w) => tagsOf(w).purpose === want.purpose && bandOf(tagsOf(w).minutes) === want.band);
      expect(got.length, `${want.purpose} ${want.band}`).toBe(want.n);
      expect(got.filter((w) => w.bases.includes('hr')).length, `${want.purpose} ${want.band} by heart rate`).toBeGreaterThanOrEqual(want.hr);
    }
  });

  it('every name in the Library is used once, and every new ride has a descriptive subtitle', () => {
    const names = LIBRARY.map((w) => w.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(LIBRARY.map((w) => w.id)).size).toBe(LIBRARY.length);
    for (const w of BATCH1) expect(w.subtitle, w.name).toBeTruthy();
  });

  it('every new ride has in-ride cues, and the steps add up to whole minutes', () => {
    for (const w of BATCH1) {
      const steps = flattenStepsWithSets(w.blocks).map((x) => x.step);
      expect(steps.some((s) => s.cues?.length), w.name).toBe(true);
      const secs = steps.reduce((a, s) => a + s.seconds, 0);
      expect(Math.abs(secs / 60 - Math.round(secs / 60)), w.name).toBeLessThan(0.02);
    }
  });

  it('a ride that works by heart rate never asks heart rate to follow efforts shorter than two minutes', () => {
    for (const w of BATCH1.filter((x) => x.bases.includes('hr') && tagsOf(x).purpose !== 'recovery' && tagsOf(x).purpose !== 'endurance'))
      for (const s of flattenStepsWithSets(w.blocks).map((x) => x.step)) if (s.intensity >= 0.88) expect(s.seconds, w.name).toBeGreaterThanOrEqual(120);
  });

  it('long rides meant for the road ride well outdoors; the criterium is adjusted for it', () => {
    for (const w of BATCH1.filter((x) => x.setting === 'outdoor')) expect(tagsOf(w).outdoor, w.name).toBe('well');
    expect(tagsOf(BATCH1.find((w) => w.name === 'Jamestown')!).outdoor).not.toBe('well');
  });
});

describe('in-ride cues (9 Nov 2026)', () => {
  const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 75, basis: 'power', masters: false, units: 'imperial', rideDays: [], hoursPerWeek: 6 };
  const oldRag = BATCH1.find((w) => w.name === 'Old Rag')!;
  const tl = buildTimeline(oldRag, profile);
  const efforts = tl.filter((s) => s.name === 'VO2max');
  it('a cue shows from its moment until the next one', () => {
    expect(cueAt(efforts[0], 0)).toMatch(/Go hard/);
    expect(cueAt(efforts[0], 100)).toMatch(/Go hard/);
    expect(cueAt(efforts[0], 200)).toMatch(/Last minute/);
  });
  it('a cue for the last repetition shows only on the last one', () => {
    expect(cueAt(efforts[0], 10)).not.toMatch(/The last one/);
    expect(cueAt(efforts[4], 10)).toMatch(/The last one/);
  });
  it('a step with no cues has none', () => {
    expect(cueAt(tl.find((s) => s.name === 'Zone 2')!, 30)).toBeUndefined();
  });
});

describe('the outdoor version (9 Nov 2026, Part C)', () => {
  it('over-unders become steady efforts at their average; the note says so', () => {
    const ou = LIBRARY.find((w) => w.id === 'lib-over-under')!;
    const { workout, note } = outdoorVersion(ou);
    expect(note).toMatch(/steady efforts/);
    const set = workout.blocks.find((b) => b.kind === 'repeat');
    expect(set && set.kind === 'repeat' && set.steps).toHaveLength(2);
    const steady = set!.kind === 'repeat' ? set!.steps[0] : undefined;
    expect(steady!.seconds).toBe(540);
    expect((steady!.intensity + steady!.intensityHigh!) / 2).toBeCloseTo((1.05 * 360 + 0.92 * 180) / 540, 2);
    expect(steady!.intensityHigh! - steady!.intensity).toBeCloseTo(0.06, 2);
  });
  it('a ride that rides well outdoors goes out exactly as written', () => {
    const w = LIBRARY.find((x) => x.id === 'lib-ss-3x15')!;
    expect(outdoorVersion(w).workout).toBe(w);
    expect(outdoorVersion(w).note).toBeUndefined();
  });
  it('sprints and surges are left alone', () => {
    const crit = BATCH1.find((w) => w.name === 'Jamestown')!;
    const out = flattenStepsWithSets(outdoorVersion(crit).workout.blocks).map((x) => x.step);
    expect(out.filter((s) => s.label === 'Corner exit')).toHaveLength(12);
  });
});
