import { describe, expect, it } from 'vitest';
import { breathThresholds, findBends, zonesFromTest } from './breathThresholds';
import { breathZones, standardBreathPcts } from './zones';

/** A seeded random walk, so the tests are the same every run. */
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

/**
 * A synthetic Ramp Test: 5 minutes' warm-up at 120 W, then 20 W a minute from
 * 140 W until `lastW`, then a cool-down. Ventilation bends at vt1 and vt2 watts,
 * following power with a short delay; heart rate rises with power.
 */
function ramp(o: { vt1: number; vt2: number; lastW: number; noise?: number; seed?: number; noBreath?: [number, number] } ) {
  const r = rng(o.seed ?? 7);
  const time: number[] = [], watts: number[] = [], hr: number[] = [], ve: number[] = [], br: number[] = [];
  const steps = Math.round((o.lastW - 140) / 20) + 1;
  const rampFrom = 300, rampTo = 300 + steps * 60;
  const powerAt = (t: number) => (t < rampFrom ? 120 : t < rampTo ? 140 + Math.floor((t - rampFrom) / 60) * 20 : 100);
  const veOf = (w: number) => 15 + 0.15 * w + 0.25 * Math.max(0, w - o.vt1) + 0.7 * Math.max(0, w - o.vt2);
  let veNow = veOf(120), hrNow = 110;
  for (let t = 0; t < rampTo + 300; t++) {
    const w = powerAt(t);
    veNow += (veOf(w) - veNow) / 20;
    hrNow += (100 + 0.25 * w - hrNow) / 30;
    time.push(t);
    watts.push(w + (r() - 0.5) * 6);
    hr.push(Math.round(hrNow));
    const gap = o.noBreath && t >= o.noBreath[0] && t < o.noBreath[1];
    ve.push(gap ? NaN : veNow * (1 + (r() - 0.5) * (o.noise ?? 0.06)));
    br.push(gap ? NaN : 18 + veNow / 6);
  }
  return { time, watts, hr, ve, br, from: rampFrom, to: rampTo };
}

describe('breathing thresholds from a ramp', () => {
  it('finds both bends close to where they are', () => {
    const r = breathThresholds(ramp({ vt1: 200, vt2: 290, lastW: 360 }))!;
    expect(r.vt1).toBeDefined();
    expect(r.vt2).toBeDefined();
    expect(Math.abs(r.vt1!.watts - 200)).toBeLessThanOrEqual(25);
    expect(Math.abs(r.vt2!.watts - 290)).toBeLessThanOrEqual(25);
    expect(r.vt2!.hr!).toBeGreaterThan(r.vt1!.hr!);
    expect(r.vt2!.ve).toBeGreaterThan(r.vt1!.ve);
    expect(r.missing).toBeUndefined();
    expect(r.peakVe).toBeGreaterThan(r.vt2!.ve);
  });

  it('holds up with noisier breathing and other seeds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = breathThresholds(ramp({ vt1: 180, vt2: 260, lastW: 340, noise: 0.12, seed }))!;
      expect(r.vt2, `seed ${seed}`).toBeDefined();
      expect(Math.abs(r.vt2!.watts - 260), `seed ${seed}`).toBeLessThanOrEqual(30);
      if (r.vt1) expect(Math.abs(r.vt1.watts - 180), `seed ${seed}`).toBeLessThanOrEqual(30);
    }
  });

  it('copes with breath-by-breath readings, each held until the next breath, and big breath-to-breath swings', () => {
    for (const seed of [11, 12, 13]) {
      const x = ramp({ vt1: 190, vt2: 280, lastW: 360, noise: 0.35, seed });
      // Hold each reading for three seconds, as the strap sends one per breath.
      const held = x.ve.map((_, i) => x.ve[i - (i % 3)]);
      const r = breathThresholds({ ...x, ve: held })!;
      expect(r.vt2, `seed ${seed}`).toBeDefined();
      expect(Math.abs(r.vt2!.watts - 280), `seed ${seed}`).toBeLessThanOrEqual(30);
      if (r.vt1) expect(Math.abs(r.vt1.watts - 190), `seed ${seed}`).toBeLessThanOrEqual(35);
    }
  });

  it('says the second threshold did not show when the test stopped before it', () => {
    const r = breathThresholds(ramp({ vt1: 200, vt2: 400, lastW: 320 }))!;
    expect(r.vt2).toBeUndefined();
    expect(['no-vt2', 'none']).toContain(r.missing);
  });

  it('does not call the first threshold the second when the ramp stopped early (review, 4 Nov 2026)', () => {
    // VT1 at 190, VT2 at 270; the ramp stops at 260, so the only bend is VT1. Its heart rate (about 148 of a max of 185)
    // is below threshold heart rate, so it is the first threshold, and the second is reported missing.
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = breathThresholds({ ...ramp({ vt1: 190, vt2: 270, lastW: 260, seed }), ftp: 250, maxHr: 185 })!;
      expect(r.vt2, `seed ${seed}`).toBeUndefined();
      if (r.vt1) expect(Math.abs(r.vt1.watts - 190), `seed ${seed}`).toBeLessThanOrEqual(35);
      expect(['no-vt2', 'none'], `seed ${seed}`).toContain(r.missing);
    }
  });

  it('still finds the second threshold, by heart rate, on a full ramp', () => {
    for (const seed of [1, 2, 3]) {
      const r = breathThresholds({ ...ramp({ vt1: 190, vt2: 270, lastW: 350, seed }), ftp: 250, maxHr: 185 })!;
      expect(r.vt2, `seed ${seed}`).toBeDefined();
      expect(Math.abs(r.vt2!.watts - 270), `seed ${seed}`).toBeLessThanOrEqual(30);
    }
  });

  it('marks a bend less certain when the strap had a hole beside it', () => {
    const r = breathThresholds(ramp({ vt1: 200, vt2: 290, lastW: 360, noBreath: [560, 620] }))!;
    // The hole (ramp seconds 260-320, about 220-240 W) sits just above VT1.
    if (r.vt1 && Math.abs(r.vt1.watts - 200) <= 36) expect(r.vt1.certainty).toBe('unsure');
  });

  it('says the readings were patchy when the strap dropped out', () => {
    const r = breathThresholds(ramp({ vt1: 200, vt2: 290, lastW: 360, noBreath: [500, 900] }))!;
    expect(r.missing).toBe('patchy');
    expect(r.vt1).toBeUndefined();
  });

  it('says too short for a very short ramp', () => {
    const r = breathThresholds(ramp({ vt1: 150, vt2: 170, lastW: 200 }))!;
    expect(r.missing).toBe('too-short');
  });

  it('is undefined with no breathing at all', () => {
    const x = ramp({ vt1: 200, vt2: 290, lastW: 360 });
    expect(breathThresholds({ ...x, ve: x.ve.map(() => NaN) })).toBeUndefined();
  });

  it('finds no bend in a straight line', () => {
    const xs = Array.from({ length: 40 }, (_, i) => 100 + i * 5);
    expect(findBends(xs, xs.map((x) => 10 + 0.3 * x))).toEqual({});
  });
});

describe('zones from a test', () => {
  const bt = { vt1: { watts: 200, hr: 130, ve: 55, certainty: 'clear' as const }, vt2: { watts: 280, hr: 155, ve: 95, certainty: 'clear' as const } };
  it('anchors zone 2 at VT1 and zone 4 at VT2, keeping the rider’s upper shares', () => {
    const z = zonesFromTest(bt, { ftp: 270, maxHr: 175, powerPcts: [55, 75, 90, 105, 120, 150], hrPcts: [82, 89, 94, 100, 106, 110] });
    expect(z.powerTops).toEqual([147, 200, 240, 280, 324, 405]);
    expect(z.hrTops![1]).toBe(130);
    expect(z.hrTops![3]).toBe(155);
    expect(z.hrTops![5]).toBeLessThan(175);
    expect(z.vt2Ve).toBe(95);
    expect(z.breathPcts).toEqual([46, 58, 100, 115]);
  });
  it('builds nothing without both thresholds', () => {
    expect(zonesFromTest({ vt1: bt.vt1 }, { ftp: 270, powerPcts: [55, 75, 90, 105, 120, 150], hrPcts: [82, 89, 94, 100, 106, 110] })).toEqual({});
  });
  it('breathing shares need VT2 above VT1', () => {
    expect(standardBreathPcts(90, 60)).toBeUndefined();
  });
  it('the breathing table: shares of VT2, litres a minute, or the standard shares', () => {
    expect(breathZones({})).toBeUndefined();
    const std = breathZones({ vt1Ve: 55, vt2Ve: 95 })!;
    expect(std.map((z) => z.high)).toEqual([43.7, 55.1, 95, 109.2, Infinity]);
    expect(breathZones({ vt1Ve: 55, vt2Ve: 100, breathZoneMode: 'pct', breathZonePcts: [40, 55, 100, 120] })!.map((z) => z.high)).toEqual([40, 55, 100, 120, Infinity]);
    expect(breathZones({ vt2Ve: 100, breathZoneMode: 'abs', breathZoneTops: [30, 50, 90, 110] })![2]).toMatchObject({ low: 50, high: 90, name: 'Tempo' });
  });
});
