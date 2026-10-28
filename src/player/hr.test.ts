import { describe, expect, it } from 'vitest';
import type { Profile, Workout } from '../engine/types';
import { buildTimeline, hrZoneOf, targetBand } from './timeline';
import { hrCue, CUE_HOLD_S, type CueState } from './hrCue';
import { observationHr, stepStats, timeInZone, totals } from './summary';
import { RideEngine } from './engine';
import { chooseFreeMode } from './mode';
import type { Sample } from './types';
import type { SensorSnapshot } from './sources';

const profile: Profile = { name: 'T', ftp: 240, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 77, basis: 'hr', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const z2: Workout = {
  id: 'v', name: 'Vienna', kind: 'ride', family: 'endurance', source: 'library', bases: ['power', 'hr'], phases: ['any'], setting: 'any', purpose: '',
  blocks: [
    { kind: 'step', seconds: 600, intensity: 0.55, label: 'Warm up' },
    { kind: 'repeat', times: 2, label: 'Endurance', steps: [{ kind: 'step', seconds: 1500, intensity: 0.7 }] },
    { kind: 'step', seconds: 300, intensity: 0.5, noFloor: true, label: 'Cool down' },
  ],
} as unknown as Workout;
const tl = buildTimeline(z2, profile);

describe('the heart-rate cue (riding with your gears)', () => {
  const band = { low: 124, high: 138 };
  const run = (bpms: number[], noFloor = false, from = 0) => {
    let st: CueState = {};
    return bpms.map((b, i) => { const r = hrCue(st, b, band, noFloor, from + i); st = r.state; return r; });
  };
  it('says nothing for the first 20 seconds outside the zone, then "ease off"', () => {
    const out = run(Array(25).fill(142));
    expect(out.slice(0, CUE_HOLD_S).every((o) => !o.cue)).toBe(true);
    expect(out[CUE_HOLD_S].cue).toBe('over');
    expect(out[CUE_HOLD_S].tone).toBe(true);
    expect(out.filter((o) => o.tone)).toHaveLength(1);
  });
  it('clears at once when heart rate is back in the zone', () => {
    const out = run([...Array(22).fill(115), 130]);
    expect(out[21].cue).toBe('under');
    expect(out[22].cue).toBeUndefined();
  });
  it('never says push on a recovery step', () => {
    const out = run(Array(40).fill(100), true);
    expect(out.every((o) => !o.cue)).toBe(true);
  });
  it('a new cue within a minute of the last tone shows without a second tone', () => {
    const out = run([...Array(21).fill(142), ...Array(5).fill(130), ...Array(21).fill(115)]);
    expect(out.filter((o) => o.cue === 'under')).not.toHaveLength(0);
    expect(out.filter((o) => o.tone)).toHaveLength(1);
  });
  it('a lost heart rate clears the cue', () => {
    let st: CueState = {};
    for (let i = 0; i < 25; i++) st = hrCue(st, 142, band, false, i).state;
    expect(hrCue(st, undefined, band, false, 25).cue).toBeUndefined();
  });
});

describe('a ride by heart rate, in numbers', () => {
  const band = (s: (typeof tl)[number]) => targetBand(s, 'hr', profile);
  const samples: Sample[] = [];
  let t = 0;
  for (const s of tl) for (let i = 0; i < s.seconds; i++) {
    const b = band(s);
    const inZone = i > 120;
    const hr = inZone ? Math.round((b.low + b.high) / 2) || 100 : (b.low || 100) - 8;
    // In the same zone, power fades across the two endurance blocks (drift).
    const w = s.index === 1 ? 170 : s.index === 2 ? 158 : 120;
    samples.push({ t: t++, hr, w, s: s.index, p: t });
  }
  it('takes training load from heart rate on a ride by heart rate, even with power present', () => {
    const byHr = totals(samples, 240, 160, undefined, 'hr');
    const byPower = totals(samples, 240, 160);
    expect(byHr.tss).not.toBe(byPower.tss);
  });
  it('counts time in the target zone', () => {
    const z = timeInZone(samples, tl, band);
    expect(z.seconds).toBeGreaterThan(0);
    expect(z.share!).toBeGreaterThan(0.85);
    expect(z.share!).toBeLessThan(1);
  });
  it('scores each step on heart rate, and notices power fading in the same zone', () => {
    const st = stepStats(samples, tl, band, 'hr');
    expect(st[1].onTarget!).toBeGreaterThan(0.9);
    expect(observationHr(st)).toMatch(/^Power fell 12 W/);
  });
  it('colours each step by its heart-rate zone', () => {
    expect(hrZoneOf(tl[1], profile)).toBe(2);
  });
});

describe('a free ride', () => {
  const sens = (o: Partial<SensorSnapshot & { controllable?: boolean }>): SensorSnapshot & { controllable?: boolean } => ({ id: 'x', kind: 'trainer', name: 'T', status: 'connected', ...o });
  it('can start with any one number to record', () => {
    expect(chooseFreeMode([], {}).ready).toBe(false);
    expect(chooseFreeMode([sens({ kind: 'hr' })], { bpm: { value: 120, from: 'x', kind: 'hr' } }).ready).toBe(true);
    expect(chooseFreeMode([sens({ controllable: true })], { speedKmh: { value: 20, from: 'x', kind: 'trainer' } })).toMatchObject({ ready: true, control: true });
  });
  it('holds the watts the rider sets, and records with no steps and no "workout complete"', () => {
    const e = new RideEngine({ timeline: [], ftp: 240, basis: 'power', mode: 'erg', autoPause: true, guard: false }, 0);
    e.freeWatts = 160;
    const outs = [1, 2, 3].map((s) => e.tick(s * 1000, { watts: 150, cadence: 90 }));
    expect(outs.filter((o) => o.command).pop()?.command).toEqual({ erg: 160 });
    e.setFreeWatts(4000, 173);
    expect(e.commandNow(4000, 90)).toEqual({ erg: 175 });
    const later = Array.from({ length: 30 }, (_, i) => e.tick((5 + i) * 1000, { watts: 170, cadence: 90 }));
    expect(later.some((o) => o.note?.startsWith('Workout complete'))).toBe(false);
    expect(e.samples).toHaveLength(30);
    expect(e.samples.every((x) => x.s == null)).toBe(true);
  });
});
