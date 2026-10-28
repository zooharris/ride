import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Profile, Workout } from '../engine/types';
import { buildTimeline, ergWatts, stepAt, targetBand, totalSeconds } from './timeline';
import { guardStep, type GuardState } from './erg';
import { normalizedPower, observation, stepStats, totals } from './summary';
import { encodeFit, fitCrc } from './fit';
import type { Recording, Sample } from './types';

const profile: Profile = { name: 'T', ftp: 240, lthr: 160, maxHr: 180, restingHr: 55, weightKg: 77, basis: 'power', masters: true, units: 'imperial', rideDays: [], hoursPerWeek: 8 };
const workout: Workout = {
  id: 'w', name: 'Ashburn', kind: 'ride', family: 'sweetspot', source: 'mine', bases: ['power', 'hr'], phases: ['any'], setting: 'any', purpose: '',
  blocks: [
    { kind: 'step', seconds: 600, intensity: 0.5, intensityHigh: 0.65, label: 'Warm up' },
    { kind: 'repeat', times: 3, label: 'Sweet spot', steps: [{ kind: 'step', seconds: 720, intensity: 0.92 }, { kind: 'step', seconds: 360, intensity: 0.5 }] },
    { kind: 'step', seconds: 300, intensity: 0.5, noFloor: true, intensityHigh: 0.55, label: 'Cool down' },
  ],
} as unknown as Workout;

describe('the timeline', () => {
  const tl = buildTimeline(workout, profile);
  it('unrolls repeats in order with their times and names', () => {
    expect(tl.map((s) => s.name)).toEqual(['Warm up', 'Sweet spot', 'Recovery', 'Sweet spot', 'Recovery', 'Sweet spot', 'Recovery', 'Cool down']);
    expect(tl[1]).toMatchObject({ start: 600, end: 1320, setNote: 'set 1 of 3', work: true });
    expect(tl[2].work).toBe(false);
    expect(totalSeconds(tl)).toBe(600 + 3 * 1080 + 300);
    expect(stepAt(tl, 1320)?.index).toBe(2);
    expect(stepAt(tl, totalSeconds(tl))).toBeUndefined();
  });
  it('gives ERG watts: the middle of a range, the expected effort of a no-minimum step, scaled', () => {
    expect(ergWatts(tl[0], 240)).toBe(138); // 57.5% of 240
    expect(ergWatts(tl[1], 240)).toBe(221);
    expect(ergWatts(tl[1], 240, 1.05)).toBe(232);
    expect(ergWatts(tl[7], 240)).toBe(120);
  });
  it('gives the band around the target', () => {
    expect(targetBand(tl[1], 'power', profile)).toMatchObject({ low: 210, high: 232, mid: 221, text: '221 W' });
    expect(targetBand(tl[0], 'power', profile)).toMatchObject({ low: 120, high: 156, text: '120–156 W' });
    expect(targetBand(tl[7], 'power', profile).low).toBe(0);
  });
});

describe('the ERG cadence guard', () => {
  it('eases to half after three seconds under 50 rpm, and ramps back over five seconds once over 70', () => {
    let st: GuardState = { eased: false };
    let r = guardStep(st, 45, 0); st = r.state; expect(r.factor).toBe(1);
    r = guardStep(st, 40, 2000); st = r.state; expect(r.factor).toBe(1);
    r = guardStep(st, 40, 3000); st = r.state; expect(r).toMatchObject({ factor: 0.5, justEased: true });
    r = guardStep(st, 65, 4000); st = r.state; expect(r.factor).toBe(0.5);
    r = guardStep(st, 80, 5000); st = r.state; expect(r.factor).toBe(0.5);
    r = guardStep(st, 85, 7500); st = r.state; expect(r.factor).toBeCloseTo(0.75);
    r = guardStep(st, 85, 10_100); st = r.state; expect(r.factor).toBe(1);
  });
  it('forgets a dip shorter than three seconds', () => {
    let st: GuardState = { eased: false };
    st = guardStep(st, 40, 0).state;
    st = guardStep(st, 90, 2000).state;
    expect(guardStep(st, 40, 4000).factor).toBe(1);
  });
});

const ride = (n: number, watts: (i: number) => number, hr: (i: number) => number, step?: (i: number) => number): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i, w: watts(i), hr: hr(i), cad: 90, spd: 30, d: i * 8.33, s: step?.(i) }));

describe('the ride totals', () => {
  it('normalized power equals average power for a steady ride and is higher for a variable one', () => {
    expect(normalizedPower(Array(600).fill(200))).toBeCloseTo(200);
    const variable = Array.from({ length: 1200 }, (_, i) => (Math.floor(i / 60) % 2 ? 300 : 100));
    expect(normalizedPower(variable)!).toBeGreaterThan(220);
  });
  it('an hour at FTP is 100 TSS', () => {
    const t = totals(ride(3600, () => 240, () => 150), 240, 160);
    expect(t).toMatchObject({ seconds: 3600, avgPower: 240, np: 240, tss: 100, kj: 864, avgHr: 150, maxHr: 150, avgCadence: 90 });
    expect(t.distanceM).toBeCloseTo(3599 * 8.33);
  });
  it('falls back to heart-rate load without power', () => {
    const s = ride(3600, () => 0, () => 150).map(({ w: _w, ...rest }) => rest);
    const t = totals(s, 240, 160);
    expect(t.avgPower).toBeUndefined();
    expect(t.tss).toBeGreaterThan(40);
  });
});

describe('step stats and the observation', () => {
  const tl = buildTimeline(workout, profile);
  const band = (s: (typeof tl)[number]) => targetBand(s, 'power', profile);
  const at = (i: number) => stepAt(tl, i)!.index;
  it('reads each step and how much of it was on target', () => {
    const samples = ride(totalSeconds(tl), (i) => ergWatts(stepAt(tl, i)!, 240), (i) => 120 + Math.min(40, i / 60), at);
    const st = stepStats(samples, tl, band);
    expect(st[1]).toMatchObject({ seconds: 720, avgPower: 221, onTarget: 1 });
    const o = observation(st)!;
    expect(o).toMatch(/^Heart rate rose \d+ bpm from the first effort to the last at the same power/);
  });
  it('says nothing with fewer than two finished efforts', () => {
    const samples = ride(1500, () => 221, () => 140, at);
    expect(observation(stepStats(samples, tl, band))).toBeUndefined();
  });
});

describe('the ride file', () => {
  const samples = ride(1800, (i) => (i < 600 ? 140 : 221), (i) => 110 + Math.floor(i / 30));
  const rec: Recording = {
    id: 'r1', status: 'finished', startedAt: '2026-10-27T18:00:00', startMs: Date.UTC(2026, 9, 27, 22, 0, 0), date: '2026-10-27',
    name: 'Ashburn', basis: 'power', ftp: 240, lthr: 160, samples, timerSeconds: 1800, distanceM: samples[1799].d!, savedMs: 0,
    laps: [{ start: 0, end: 600, step: 0 }, { start: 600, end: 1800, step: 1 }],
    events: [{ t: 0, type: 'start' }],
  };
  const t = totals(samples, 240, 160);
  const bytes = encodeFit(rec, t);

  it('is a valid FIT file that Garmin\'s own reader accepts', () => {
    const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
    expect(decoder.isFIT()).toBe(true);
    expect(decoder.checkIntegrity()).toBe(true);
    const { messages, errors } = decoder.read();
    expect(errors).toEqual([]);
    expect(messages.fileIdMesgs![0]).toMatchObject({ type: 'activity', manufacturer: 'development', productName: 'VeloIQ' });
    expect(messages.recordMesgs!).toHaveLength(1800);
    expect(messages.recordMesgs![700]).toMatchObject({ power: 221, cadence: 90 });
    expect(messages.lapMesgs!).toHaveLength(2);
    expect(messages.lapMesgs![1].avgPower).toBe(221);
    const s = messages.sessionMesgs![0];
    expect(s).toMatchObject({ sport: 'cycling', subSport: 'indoorCycling', avgPower: t.avgPower, normalizedPower: t.np, numLaps: 2, thresholdPower: 240 });
    expect(s.totalTimerTime).toBe(1800);
    expect(s.trainingStressScore).toBeCloseTo(t.tss);
    expect(messages.activityMesgs![0].numSessions).toBe(1);
  });
  it('checks its own CRC', () => {
    expect(fitCrc(bytes)).toBe(0);
  });
});

import { RideEngine, type Live } from './engine';

describe('the ride engine', () => {
  const tl = buildTimeline(workout, profile);
  const make = (o: Partial<ConstructorParameters<typeof RideEngine>[0]> = {}) => new RideEngine({ timeline: tl, ftp: 240, basis: 'power', mode: 'erg', autoPause: true, guard: true, ...o }, 0);
  const pedal = { watts: 200, cadence: 90, speedKmh: 30, bpm: 140 };
  /** Run the engine for n seconds from second `from`, returning everything it said. */
  const run = (e: RideEngine, from: number, n: number, live: Live = pedal) => Array.from({ length: n }, (_, i) => e.tick((from + i) * 1000, live));

  it('counts down three seconds, then rides the first step in ERG', () => {
    const e = make();
    const outs = run(e, 1, 3);
    expect(outs.map((o) => o.beep)).toEqual(['count', 'count', 'go']);
    expect(e.phase).toBe('riding');
    const o = e.tick(4000, pedal);
    expect(e.samples).toHaveLength(1);
    expect(e.samples[0]).toMatchObject({ w: 200, hr: 140, tgt: 138, s: 0 });
    expect(outs[2].command ?? o.command).toBeDefined();
  });

  it('moves to the next step on time, beeping the last three seconds, and sends the new target once', () => {
    const e = make();
    run(e, 1, 3);
    const outs = run(e, 4, 600);
    expect(outs.slice(597, 600).map((o) => o.beep)).toEqual(['count', 'count', 'count']);
    const change = e.tick(604_000, pedal);
    expect(change.beep).toBe('go');
    // The new target goes to the trainer as the step begins (at the end of the step's last second).
    expect(outs[599].command).toEqual({ erg: 221 });
    expect(change.command).toBeUndefined();
    expect(e.laps).toHaveLength(1);
    expect(e.laps[0]).toMatchObject({ start: 4, end: 604, step: 0 });
  });

  it('scales the target with workout intensity', () => {
    const e = make();
    run(e, 1, 3);
    e.setScale(4000, 1.1);
    expect(e.tick(4000, pedal).command).toEqual({ erg: 152 });
  });

  it('skips to the next step', () => {
    const e = make();
    run(e, 1, 3);
    run(e, 4, 10);
    e.skip(14_000);
    expect(e.step?.name).toBe('Sweet spot');
  });

  it('pauses by itself after ten seconds without pedalling, lets the trainer go, and carries on when pedalling starts', () => {
    const e = make();
    run(e, 1, 3);
    run(e, 4, 20);
    const still = run(e, 24, 10, { bpm: 120, cadence: 0, watts: 0, speedKmh: 0 });
    expect(e.phase).toBe('paused');
    expect(still[9].command).toEqual({ grade: 0 });
    const timer = e.timer;
    run(e, 34, 30, { bpm: 110, cadence: 0, watts: 0, speedKmh: 0 });
    expect(e.timer).toBe(timer);
    e.tick(64_000, pedal);
    expect(e.phase).toBe('riding');
    expect(e.events.map((x) => x.type)).toEqual(['start', 'pause', 'resume']);
  });

  it('eases ERG when cadence collapses, but not when there is no cadence reading', () => {
    const e = make();
    run(e, 1, 3);
    run(e, 4, 2);
    const slow = run(e, 6, 5, { ...pedal, cadence: 35 });
    expect(slow.map((o) => o.command).filter(Boolean).pop()).toEqual({ erg: 69 });
    const e2 = make();
    const none = [...run(e2, 1, 3), ...run(e2, 4, 10, { watts: 150, speedKmh: 25 })];
    expect(none.map((o) => o.command).filter(Boolean)).toEqual([{ grade: 0 }, { erg: 138 }]);
  });

  it('finishes the workout and keeps riding, then ends', () => {
    const short = buildTimeline({ ...workout, blocks: [{ kind: 'step', seconds: 20, intensity: 0.6, label: 'Spin' }] } as Workout, profile);
    const e = new RideEngine({ timeline: short, ftp: 240, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
    run(e, 1, 3);
    const outs = run(e, 4, 30);
    expect(outs.some((o) => o.note?.startsWith('Workout complete'))).toBe(true);
    expect(e.samples).toHaveLength(30);
    expect(e.finish(40_000)).toEqual({ grade: 0 });
    expect(e.laps.map((l) => [l.start, l.end, l.step])).toEqual([[4, 24, 0], [24, 34, undefined]]);
  });

  it('in resistance and free ride, rides a road of a gradient', () => {
    const e = make({ mode: 'resistance' });
    e.setLevel(4);
    run(e, 1, 3);
    expect(e.tick(4000, pedal).command).toBeUndefined();
    e.setMode(5000, 'free');
    expect(e.tick(5000, pedal).command).toEqual({ grade: 0 });
  });
});

import { bandOf, ewma, settle, type Settled } from './smooth';

describe('the calm power marker', () => {
  it('follows a jittery ride far more steadily than the raw numbers', () => {
    let m: number | undefined;
    const raw = Array.from({ length: 60 }, (_, i) => 220 + (i % 2 ? 12 : -12));
    const out = raw.map((w) => (m = ewma(m, w)));
    const swing = (xs: number[]) => Math.max(...xs.slice(30)) - Math.min(...xs.slice(30));
    expect(swing(raw)).toBe(24);
    expect(swing(out)).toBeLessThan(6);
  });
  it('still shows a real change within a few seconds', () => {
    let m: number | undefined = 220;
    for (let i = 0; i < 5; i++) m = ewma(m, 180);
    expect(m).toBeLessThan(195);
  });
  it('changes the label only after three seconds on the new side', () => {
    let s: Settled = { count: 0 };
    s = settle(s, bandOf(220, 210, 232));
    expect(s.state).toBe('on');
    s = settle(s, 'under'); s = settle(s, 'on'); s = settle(s, 'under'); s = settle(s, 'under');
    expect(s.state).toBe('on');
    s = settle(s, 'under');
    expect(s.state).toBe('under');
  });
});
