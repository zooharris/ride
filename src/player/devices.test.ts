import { describe, expect, it } from 'vitest';
import { cleanName, optionsFor, pillFor, slotView, type Known } from './devices';
import { migrateSaved } from './hub';
import { pickSources, type SensorSnapshot } from './sources';

type S = SensorSnapshot & { controllable?: boolean; warning?: string };
const now = 1_000_000;
const known: Known[] = [
  { id: 'rollr', name: 'KICKR ROLLR 5A50', kind: 'trainer', lastUsed: '2026-10-28', reports: ['speedKmh', 'watts'] },
  { id: 'ped', name: 'SPEEDPLAY POWER F53E', kind: 'power', lastUsed: '2026-10-28', reports: ['watts', 'cadence'] },
  { id: 'epix', name: 'EPIX PRO -', kind: 'hr', lastUsed: '2026-10-28', reports: ['bpm'] },
  { id: 'hrm', name: 'HRM-Pro+', kind: 'hr', lastUsed: '2026-10-12' },
  { id: 'rpm', name: 'Wahoo RPM cadence', kind: 'csc', lastUsed: '2026-09-02', reports: ['cadence'] },
];
const on = (id: string, kind: S['kind'], reading: Omit<NonNullable<S['reading']>, 'at'>, o: Partial<S> = {}): S => ({ id, kind, name: known.find((k) => k.id === id)?.name ?? id, status: 'connected', reading: { ...reading, at: now }, ...o });

describe('the device boxes', () => {
  it('opening the ride with nothing connected: every box empty, reminding which device was used last', () => {
    const v = (slot: Parameters<typeof slotView>[0]) => slotView(slot, [], known, {}, {});
    expect(v('trainer')).toMatchObject({ state: 'empty', lastUsed: 'KICKR ROLLR 5A50' });
    expect(v('bpm')).toMatchObject({ state: 'empty', lastUsed: 'EPIX PRO -' });
    expect(v('cadence')).toMatchObject({ state: 'empty', lastUsed: 'SPEEDPLAY POWER F53E' });
    expect(v('speedKmh')).toMatchObject({ state: 'empty', lastUsed: 'KICKR ROLLR 5A50' });
    expect(pillFor([], false).text).toBe('Nothing connected yet');
  });

  it('the heart-rate list offers every heart-rate monitor used before, most recent first, not just the last one', () => {
    expect(optionsFor('bpm', [], known, {}).map((o) => o.name)).toEqual(['EPIX PRO', 'HRM-Pro+']);
  });

  it('the cadence list offers only devices that report cadence: the pedals and the cadence sensor, never the ROLLR', () => {
    const ids = optionsFor('cadence', [], known, {}).map((o) => o.id);
    expect(ids).toEqual(['ped', 'rpm']);
  });

  it('connected: pedals fill power and cadence, the ROLLR speed; the connected device comes first and is selected', () => {
    const sensors = [on('rollr', 'trainer', { speedKmh: 26, watts: 210 }, { controllable: true }), on('ped', 'power', { watts: 212, cadence: 88 }), on('epix', 'hr', { bpm: 128 })];
    const src = pickSources(sensors, now);
    expect(slotView('watts', sensors, known, src, {})).toMatchObject({ state: 'connected', value: 212, device: { id: 'ped' } });
    expect(slotView('cadence', sensors, known, src, {})).toMatchObject({ state: 'connected', value: 88, device: { id: 'ped' } });
    expect(slotView('speedKmh', sensors, known, src, {})).toMatchObject({ state: 'connected', device: { id: 'rollr' } });
    const cad = optionsFor('cadence', sensors, known, src);
    expect(cad[0]).toMatchObject({ id: 'ped', connected: true, selected: true });
    expect(cad.map((o) => o.id)).not.toContain('rollr');
    expect(pillFor(sensors, true)).toEqual({ ok: true, text: 'All set' });
  });

  it("the rider's choice wins: a separate cadence sensor over the pedals, or none at all", () => {
    const sensors = [on('ped', 'power', { watts: 212, cadence: 88 }), on('rpm', 'csc', { cadence: 90 })];
    expect(pickSources(sensors, now, { cadence: 'rpm' }).cadence?.from).toBe('rpm');
    expect(pickSources(sensors, now).cadence?.from).toBe('ped');
    const off = pickSources(sensors, now, { cadence: 'none' });
    expect(off.cadence).toBeUndefined();
    expect(slotView('cadence', sensors, known, off, { cadence: 'none' }).state).toBe('off');
  });

  it('a ROLLR once filed as a speed sensor is a trainer again, and each device is remembered once', () => {
    const fixed = migrateSaved([
      { id: 'ped', name: 'SPEEDPLAY POWER F53E', kind: 'power' },
      { id: 'epix', name: 'EPIX PRO -', kind: 'hr' },
      { id: 'rollr', name: 'KICKR ROLLR 5A50', kind: 'csc' },
    ]);
    expect(fixed.find((d) => d.id === 'rollr')?.kind).toBe('trainer');
    expect(fixed).toHaveLength(3);
  });

  it('tidies the name a Garmin watch broadcasts', () => {
    expect(cleanName('EPIX PRO -')).toBe('EPIX PRO');
  });
});
