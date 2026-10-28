import { describe, expect, it } from 'vitest';
import {
  cmdRequestControl, cmdSetTargetPower, cmdStop, crankRate, cscWheelRate, parseControlResponse, parseCsc, parseCyclingPower,
  parseHeartRate, parseIndoorBikeData, parsePowerRange, parseResistanceRange, WHEEL_M,
} from './ble/parse';
import { pickSources, rollrCheck, suppliedBy, type SensorSnapshot } from './sources';
import { nextHr, SimRider, simSpeedKmh, steadyHr } from './sim';

const dv = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

describe('Indoor Bike Data', () => {
  it('reads speed, cadence and power (the usual trainer packet)', () => {
    // flags: speed present (bit 0 clear), cadence (bit 2), power (bit 6)
    const flags = (1 << 2) | (1 << 6);
    const d = parseIndoorBikeData(dv(...u16(flags), ...u16(2856), ...u16(184), ...u16(212)));
    expect(d).toEqual({ speedKmh: 28.56, cadence: 92, watts: 212 });
  });

  it('skips fields it does not use and finds heart rate and elapsed time after them', () => {
    // speed, avg speed, cadence, avg cadence, distance, resistance, power, avg power, energy, HR, MET, elapsed
    const flags = 0b1111_1111_1110; // bits 1..11; bit 0 clear = speed present
    const bytes = [
      ...u16(flags), ...u16(3000), ...u16(2900), ...u16(180), ...u16(176),
      0x10, 0x27, 0x00, // distance 10000 m
      ...u16(25), ...u16(250), ...u16(240),
      ...u16(120), ...u16(600), 10, // energy
      142, 50, ...u16(1800),
    ];
    const d = parseIndoorBikeData(dv(...bytes));
    expect(d).toEqual({ speedKmh: 30, cadence: 90, distanceM: 10000, resistance: 25, watts: 250, bpm: 142, elapsedS: 1800 });
  });

  it('has no speed when "more data" is set (a split packet)', () => {
    const d = parseIndoorBikeData(dv(...u16(1 | (1 << 6)), ...u16(180)));
    expect(d).toEqual({ watts: 180 });
  });

  it('reads negative power as negative (signed)', () => {
    const d = parseIndoorBikeData(dv(...u16(1 << 6), ...u16(1000), ...u16(0xfff6)));
    expect(d.watts).toBe(-10);
  });
});

describe('control point', () => {
  it('builds the commands', () => {
    expect([...cmdRequestControl()]).toEqual([0x00]);
    expect([...cmdSetTargetPower(221)]).toEqual([0x05, 221, 0]);
    expect([...cmdSetTargetPower(300)]).toEqual([0x05, 0x2c, 0x01]);
    expect([...cmdStop(true)]).toEqual([0x08, 2]);
  });
  it('reads answers', () => {
    expect(parseControlResponse(dv(0x80, 0x00, 0x01))).toEqual({ request: 0, result: 1, ok: true });
    expect(parseControlResponse(dv(0x80, 0x00, 0x05))).toEqual({ request: 0, result: 5, ok: false });
    expect(parseControlResponse(dv(0x05, 0x00))).toBeNull();
  });
  it('reads the supported ranges', () => {
    expect(parsePowerRange(dv(...u16(0), ...u16(2000), ...u16(1)))).toEqual({ min: 0, max: 2000, step: 1 });
    expect(parseResistanceRange(dv(...u16(0), ...u16(1000), ...u16(10)))).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe('Cycling Power', () => {
  it('reads power alone', () => {
    expect(parseCyclingPower(dv(...u16(0), ...u16(245)))).toEqual({ watts: 245 });
  });
  it('reads crank data after the balance and torque fields', () => {
    const flags = 1 | (1 << 2) | (1 << 5);
    const m = parseCyclingPower(dv(...u16(flags), ...u16(230), 100, ...u16(5000), ...u16(1234), ...u16(40000)));
    expect(m).toEqual({ watts: 230, crank: { revs: 1234, time: 40000 } });
  });
  it('reads wheel then crank data', () => {
    const flags = (1 << 4) | (1 << 5);
    const m = parseCyclingPower(dv(...u16(flags), ...u16(200), ...u32(70000), ...u16(2048), ...u16(10), ...u16(1024)));
    expect(m).toEqual({ watts: 200, wheel: { revs: 70000, time: 2048 }, crank: { revs: 10, time: 1024 } });
  });
});

describe('Heart Rate', () => {
  it('reads 8-bit and 16-bit values', () => {
    expect(parseHeartRate(dv(0x00, 146))).toBe(146);
    expect(parseHeartRate(dv(0x01, ...u16(146)))).toBe(146);
  });
});

describe('Speed and Cadence', () => {
  it('reads wheel and crank data', () => {
    expect(parseCsc(dv(0x03, ...u32(500), ...u16(2048), ...u16(77), ...u16(5120)))).toEqual({ wheel: { revs: 500, time: 2048 }, crank: { revs: 77, time: 5120 } });
    expect(parseCsc(dv(0x02, ...u16(77), ...u16(5120)))).toEqual({ crank: { revs: 77, time: 5120 } });
  });
});

describe('revolutions to rates', () => {
  it('gives cadence from crank counts', () => {
    const c = crankRate();
    expect(c.update(100, 0, 0)).toBe(0);
    // 3 revolutions in 2 seconds (2048 ticks of 1/1024 s) = 90 rpm
    expect(c.update(103, 2048, 2000) * 60).toBeCloseTo(90);
  });
  it('survives the 16-bit roll-over of counts and times', () => {
    const c = crankRate();
    c.update(65535, 65000, 0);
    // 2 revolutions; time wraps from 65000 to 1048 = 1584 ticks
    expect(c.update(1, 1048, 1500) * 60).toBeCloseTo(2 / (1584 / 1024) * 60);
  });
  it('holds the rate between events and drops to zero after three seconds without one', () => {
    const c = crankRate();
    c.update(0, 0, 0);
    c.update(2, 1365, 1300);
    const r = c.update(2, 1365, 2000);
    expect(r * 60).toBeCloseTo(2 / (1365 / 1024) * 60);
    expect(c.update(2, 1365, 4500)).toBe(0);
  });
  it('gives speed from wheel counts', () => {
    const w = cscWheelRate();
    w.update(0, 0, 0);
    // 4 revolutions in one second on a 2.105 m wheel = 30.3 km/h
    expect(w.update(4, 1024, 1000) * WHEEL_M * 3.6).toBeCloseTo(30.31, 1);
  });
});

describe('which sensor supplies each number', () => {
  const now = 10_000;
  const trainer: SensorSnapshot = { id: 't', kind: 'trainer', name: 'KICKR ROLLR', status: 'connected', reading: { watts: 210, cadence: 90, speedKmh: 30, at: now - 500 } };
  const pm: SensorSnapshot = { id: 'p', kind: 'power', name: 'Power', status: 'connected', reading: { watts: 215, cadence: 91, at: now - 200 } };
  const hr: SensorSnapshot = { id: 'h', kind: 'hr', name: 'Epix', status: 'connected', reading: { bpm: 140, at: now - 100 } };

  it('prefers the power meter for power and cadence, the trainer for speed', () => {
    const s = pickSources([trainer, pm, hr], now);
    expect(s.watts).toEqual({ value: 215, from: 'p', kind: 'power' });
    expect(s.cadence?.from).toBe('p');
    expect(s.speedKmh?.from).toBe('t');
    expect(s.bpm?.from).toBe('h');
    expect(suppliedBy('t', s)).toEqual(['speedKmh']);
  });
  it('falls back to the trainer when the power meter goes quiet or drops', () => {
    expect(pickSources([trainer, { ...pm, reading: { watts: 215, at: now - 4000 } }], now).watts?.from).toBe('t');
    expect(pickSources([trainer, { ...pm, status: 'lost' }], now).watts?.from).toBe('t');
  });
  it('counts a zero as a real value', () => {
    expect(pickSources([{ ...pm, reading: { watts: 0, cadence: 0, at: now } }], now).watts?.value).toBe(0);
  });
});

describe('the KICKR ROLLR check', () => {
  it('warns after ten seconds of pedalling with no power, and only for a ROLLR', () => {
    let st = rollrCheck('KICKR ROLLR 1234', { speedKmh: 25, at: 0 }, undefined, 0);
    expect(st).toEqual({ since: 0, warn: false });
    st = rollrCheck('KICKR ROLLR 1234', { speedKmh: 25, watts: 0, at: 10_000 }, st.since, 10_000);
    expect(st.warn).toBe(true);
    expect(rollrCheck('KICKR CORE', { speedKmh: 25, at: 0 }, 0, 20_000).warn).toBe(false);
  });
  it('clears when power arrives or the rider stops', () => {
    expect(rollrCheck('ROLLR', { speedKmh: 25, watts: 180, at: 20_000 }, 0, 20_000)).toEqual({ warn: false });
    expect(rollrCheck('ROLLR', { speedKmh: 0, at: 20_000 }, 0, 20_000)).toEqual({ warn: false });
  });
});

describe('the simulated rider', () => {
  const p = { ftp: 240, lthr: 160, restingHr: 55, maxHr: 180 };
  it('settles heart rate where the power puts it, slowly', () => {
    expect(steadyHr(240, p)).toBeCloseTo(160);
    let hr = 70;
    for (let s = 0; s < 30; s++) hr = nextHr(hr, 168, p, 1, 0);
    expect(hr).toBeLessThan(steadyHr(168, p) - 15); // half a minute in: still well short
    for (let s = 0; s < 300; s++) hr = nextHr(hr, 168, p, 1, 0);
    expect(hr).toBeCloseTo(steadyHr(168, p), 0);
  });
  it('rides at the target power with a little noise', () => {
    const r = new SimRider(p);
    r.target = 200;
    let last = { watts: 0, speedKmh: 0, cadence: 0, bpm: 0 };
    for (let s = 0; s < 20; s++) last = r.tick(1);
    expect(last.watts).toBeGreaterThan(185);
    expect(last.watts).toBeLessThan(215);
    expect(last.speedKmh).toBeCloseTo(simSpeedKmh(last.watts), 1);
    expect(last.cadence).toBeGreaterThan(80);
  });
});

import { chooseMode } from './mode';

describe('choosing how the ride is played', () => {
  const now = 1000;
  const trainer = (controllable: boolean): SensorSnapshot & { controllable?: boolean } => ({ id: 't', kind: 'trainer', name: 'T', status: 'connected', controllable, reading: { watts: 150, speedKmh: 25, at: now } });
  const strap: SensorSnapshot = { id: 'h', kind: 'hr', name: 'H', status: 'connected', reading: { bpm: 120, at: now } };
  const run = (basis: 'power' | 'hr', sensors: (SensorSnapshot & { controllable?: boolean })[], allowsHr = true) => chooseMode(basis, sensors, pickSources(sensors, now), allowsHr);

  it('follows the table in the spec', () => {
    expect(run('power', [trainer(true)]).mode).toBe('erg');
    expect(run('power', [trainer(false)]).mode).toBe('power-self');
    expect(run('hr', [trainer(true), strap]).mode).toBe('hr-trainer');
    expect(run('hr', [strap]).mode).toBe('hr-self');
    expect(run('hr', [trainer(false), strap]).mode).toBe('hr-self');
  });
  it('says what is missing', () => {
    expect(run('power', [strap]).mode).toBeUndefined();
    expect(run('power', [strap]).suggestHr).toBe(true);
    expect(run('power', [strap], false)).toMatchObject({ needsPower: true });
    expect(run('power', [], false).needsPower).toBe(true);
    expect(run('power', [strap], false).mode).toBeUndefined();
    expect(run('hr', [trainer(true)]).mode).toBeUndefined();
    expect(run('power', []).says).toMatch(/Connect a heart-rate monitor or a power source/);
    expect(run('power', [], false).says).toMatch(/needs a power meter/);
  });
});

import { hrAlternatives } from './alternatives';
import { LIBRARY } from '../library/workouts';
import { workoutStats } from '../engine/workout';

describe('heart-rate alternatives to a power-only workout', () => {
  it('offers three rides that allow heart rate, close in length', () => {
    const vo2 = LIBRARY.find((w) => w.kind === 'ride' && !w.bases.includes('hr'))!;
    const alts = hrAlternatives(vo2, LIBRARY);
    expect(alts).toHaveLength(3);
    for (const a of alts) {
      expect(a.bases).toContain('hr');
      expect(Math.abs(workoutStats(a.blocks).seconds - workoutStats(vo2.blocks).seconds)).toBeLessThanOrEqual(30 * 60);
    }
  });
});
