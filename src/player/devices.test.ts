import { describe, expect, it } from 'vitest';
import { cleanName, deviceBoxes, pillFor } from './devices';
import { pickSources, type SensorSnapshot } from './sources';

type S = SensorSnapshot & { controllable?: boolean; warning?: string };
const now = 1_000_000;
const rollr = (o: Partial<S> = {}): S => ({ id: 'rollr', kind: 'trainer', name: 'KICKR ROLLR 5A50', status: 'offline', ...o });
const pedals = (o: Partial<S> = {}): S => ({ id: 'ped', kind: 'power', name: 'SPEEDPLAY POWER F53E', status: 'offline', ...o });
const epix = (o: Partial<S> = {}): S => ({ id: 'epix', kind: 'hr', name: 'EPIX PRO -', status: 'offline', ...o });
const boxes = (ss: S[], basis?: 'power' | 'hr') => deviceBoxes(ss, pickSources(ss, now), basis);
const kinds = (d: ReturnType<typeof boxes>) => d.boxes.map((b) => `${b.kind}:${b.state}`);

describe('the device boxes', () => {
  it("Todd's setup, all remembered and waiting: three click-to-connect boxes and the cadence box, then the cadence box goes once the pedals report cadence", () => {
    const asleep = boxes([rollr(), pedals(), epix()], 'power');
    expect(kinds(asleep)).toEqual(['trainer:click', 'power:click', 'hr:click', 'csc:empty']);
    expect(asleep.more).toEqual([]);
    expect(pillFor(asleep, false).text).toBe('3 to connect');
    const awake = boxes([
      rollr({ status: 'connected', controllable: true, reading: { speedKmh: 26, watts: 210, at: now } }),
      pedals({ status: 'connected', reading: { watts: 212, cadence: 88, at: now } }),
      epix({ status: 'connected', reading: { bpm: 128, at: now } }),
    ], 'power');
    expect(kinds(awake)).toEqual(['trainer:connected', 'power:connected', 'hr:connected']);
    expect(awake.more).toEqual(['csc']);
    expect(awake.boxes[1].metrics).toEqual(['watts', 'cadence']);
    expect(awake.boxes[0].metrics).toEqual(['speedKmh']);
    expect(awake.boxes[0].unused).toBe('Watts from your power meter are used');
    expect(pillFor(awake, true)).toEqual({ ok: true, text: 'All set' });
  });

  it('a wheel-on trainer reporting speed only, no pedals: the cadence box says why', () => {
    const d = boxes([rollr({ status: 'connected', reading: { speedKmh: 25, watts: 180, at: now } })], 'hr');
    const csc = d.boxes.find((b) => b.kind === 'csc');
    expect(csc).toMatchObject({ state: 'empty', reason: "Your trainer doesn't report cadence" });
  });

  it('a heart-rate rider whose trainer reports power and cadence: no power box, no cadence box, one add box', () => {
    const d = boxes([rollr({ status: 'connected', reading: { speedKmh: 25, watts: 180, cadence: 85, at: now } }), epix({ status: 'connected', reading: { bpm: 120, at: now } })], 'hr');
    expect(kinds(d)).toEqual(['trainer:connected', 'hr:connected']);
    expect(d.more).toEqual(['power', 'csc']);
  });

  it('first time, a ride by power: four add boxes and nothing more', () => {
    const d = boxes([], 'power');
    expect(kinds(d)).toEqual(['trainer:empty', 'power:empty', 'hr:empty', 'csc:empty']);
    expect(d.boxes[1].reason).toBe('Nothing connected measures power');
    expect(d.more).toEqual([]);
    expect(pillFor(d, false).text).toBe('Nothing connected yet');
  });

  it('connected but the ride still lacks something: "Not ready yet"', () => {
    const d = boxes([rollr({ status: 'connected', controllable: true, reading: { speedKmh: 25, watts: 180, cadence: 85, at: now } })], 'hr');
    expect(pillFor(d, false).text).toBe('Not ready yet');
  });

  it('tidies the name a Garmin watch broadcasts', () => {
    expect(cleanName('EPIX PRO -')).toBe('EPIX PRO');
    expect(cleanName('KICKR ROLLR 5A50')).toBe('KICKR ROLLR 5A50');
  });
});
