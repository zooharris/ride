import { describe, expect, it } from 'vitest';
import { LIBRARY } from './workouts';
import { CUE_MAX, LESSONS, withLessons } from './cueKinds';
import { aiCues, applyCues, cueAllowed, cueMoments, readCues } from '../coach/rideCues';
import type { CoachConfig } from '../coach/llm';
import type { Workout, WorkoutStep } from '../engine/types';

const flat = (w: Workout) => w.blocks.flatMap((b) => (b.kind === 'step' ? [{ s: b, set: false }] : b.steps.map((s) => ({ s, set: true }))));
const easy = (s: WorkoutStep) => !s.allOut && (s.intensityHigh ? (s.intensity + s.intensityHigh) / 2 : s.intensity) < 0.75;
const rides = LIBRARY.filter((w) => w.kind === 'ride' && w.family !== 'test');

describe('written cues of five kinds (B5)', () => {
  it('at least 40 lessons, each short, all different', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(LESSONS).size).toBe(LESSONS.length);
    for (const l of LESSONS) expect(l.length, l).toBeLessThanOrEqual(CUE_MAX);
  });
  it('every Library ride has a cue of each kind that fits it, none over 110 characters, no lesson twice', () => {
    const missing: string[] = [];
    for (const w0 of rides) {
      const w = withLessons(w0, 0).workout;
      const steps = flat(w);
      const cues = steps.flatMap(({ s }) => s.cues ?? []);
      for (const c of cues) expect(c.text.length, `${w.name}: ${c.text}`).toBeLessThanOrEqual(CUE_MAX);
      const hard = steps.some(({ s }) => !easy(s) && !/warm|cool/i.test(s.label ?? ''));
      const kinds = new Set(cues.map((c) => c.kind ?? 'focus'));
      const want: string[] = ['focus'];
      if (hard) want.push('why', 'hard');
      // "What comes next" fits a ride with an easy spell of a minute or more right before a hard effort.
      const all = w.blocks.flatMap((b) => (b.kind === 'step' ? [b] : Array.from({ length: b.times }, () => b.steps).flat()));
      if (all.some((s, i) => easy(s) && s.seconds >= 60 && !/cool/i.test(s.label ?? '') && all[i + 1] && !easy(all[i + 1]))) want.push('next');
      if (steps.some(({ s }) => easy(s) && s.seconds >= 180 && !/warm|cool/i.test(s.label ?? ''))) want.push('lesson');
      for (const k of want) if (!kinds.has(k as never)) missing.push(`${w.name} (${w.id}): ${k}`);
      const lessons = cues.filter((c) => c.kind === 'lesson').map((c) => c.text);
      expect(new Set(lessons).size, w.name).toBe(lessons.length);
    }
    expect(missing).toEqual([]);
  });
  it('the next ride carries on in the list, so consecutive rides do not share a lesson', () => {
    const a = withLessons(rides.find((w) => w.id === 'lib-ss-3x15')!, 0);
    const b = withLessons(rides.find((w) => w.id === 'lib-tempo-2x20')!, a.used);
    const la = flat(a.workout).flatMap(({ s }) => s.cues ?? []).filter((c) => c.kind === 'lesson').map((c) => c.text);
    const lb = flat(b.workout).flatMap(({ s }) => s.cues ?? []).filter((c) => c.kind === 'lesson').map((c) => c.text);
    expect(la.length).toBeGreaterThan(0);
    expect(lb.length).toBeGreaterThan(0);
    expect(la.filter((x) => lb.includes(x))).toEqual([]);
  });
});

describe('cues written by the rider\'s AI (B6)', () => {
  const w = LIBRARY.find((x) => x.id === 'g-goshen-pass-2')!;
  const cfg = { provider: 'anthropic', key: 'k' } as CoachConfig;
  const ids = cueMoments(w).map((m) => m.id);
  it('a good answer rewords the cues and changes nothing else', async () => {
    const r = await aiCues(cfg, w, ['2026-11-10: Threshold, 60 min'], 1000, async () => JSON.stringify({ cues: { [ids[0]]: 'Ease in, Sam. Tuesday was hard; let the legs wake up slowly.' } }));
    expect(r?.changed).toBe(1);
    expect(cueMoments(r!.workout)[0].text).toBe('Ease in, Sam. Tuesday was hard; let the legs wake up slowly.');
    const strip = (x: Workout) => JSON.stringify(x.blocks, (k, v) => (k === 'cues' ? undefined : v));
    expect(strip(r!.workout)).toBe(strip(w));
  });
  it('a late answer is not waited for', async () => {
    const t0 = Date.now();
    const r = await aiCues(cfg, w, [], 50, () => new Promise((res) => setTimeout(() => res(JSON.stringify({ cues: { [ids[0]]: 'Late.' } })), 400)));
    expect(r).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it('a failure leaves the written cues, with no error', async () => {
    expect(await aiCues(cfg, w, [], 1000, async () => { throw new Error('network'); })).toBeUndefined();
  });
  it('a cue that states a target is thrown away; the written one stays', () => {
    for (const bad of ['Hold 250 W here.', 'Keep it at 160 bpm.', 'Ride at 95% now.', 'Spin at 100 rpm.', 'x'.repeat(111)]) expect(cueAllowed(bad), bad).toBe(false);
    const r = applyCues(w, { [ids[0]]: 'Hold 250 W here.', [ids[1]]: 'Smooth and steady, as on Tuesday.' });
    expect(r.changed).toBe(1);
    expect(cueMoments(r.workout)[0].text).toBe(cueMoments(w)[0].text);
  });
  it('an answer that is not cues is ignored', async () => {
    expect(readCues('Sure! Here is a new workout: 5 x 5 at 120%.')).toEqual({});
    expect(readCues('{"workout": {"blocks": []}}')).toEqual({});
    expect(await aiCues(cfg, w, [], 1000, async () => '{"blocks": [], "cues": "make it harder"}')).toBeUndefined();
  });
});
