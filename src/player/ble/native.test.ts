import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fullUuid, makeBluetooth, matches, type NativeBluetooth } from './native';
import { chooserBus, type BluetoothProblem, type FoundDevice } from './chooserBus';
import { attach, chooseDevice, knownDevice } from './web';
import { CHAR, SERVICE } from './gatt';
import { cmdRequestControl } from './parse';
import type { Reading, SensorStatus } from '../sources';

/**
 * Bluetooth on iPhone and iPad (25 Nov 2026): the app's own side, stood in for here by a made-up smart trainer and a
 * made-up heart-rate strap, driven through the very module that speaks to devices in a browser (ble/web.ts). Apple's
 * simulator has no Bluetooth, so this is where the iPhone's path is checked before a real device meets it.
 */
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const FTMS = fullUuid(SERVICE.ftms), HRS = fullUuid(SERVICE.heartRate);
const BIKE = fullUuid(CHAR.indoorBikeData), CP = fullUuid(CHAR.controlPoint), RANGE = fullUuid(CHAR.supportedPowerRange), HRM = fullUuid(CHAR.heartRateMeasurement);

function standIn(state: 'on' | 'off' | 'denied' = 'on') {
  const listeners: Record<string, Array<(e: never) => void>> = {};
  const emit = (event: string, e: unknown) => (listeners[event] ?? []).forEach((fn) => fn(e as never));
  const log: string[] = [];
  const notifying = new Set<string>();
  const connected = new Set<string>();
  const side: NativeBluetooth = {
    btState: async () => ({ state }),
    btScan: async ({ services }) => {
      log.push(`scan ${services.join(',')}`);
      setTimeout(() => emit('btFound', { devices: [{ id: 'T1', name: 'Made-up Trainer', services: [FTMS] }, { id: 'H1', name: 'Made-up Strap', services: ['180D'] }, { id: 'X1', name: 'Headphones', services: [] }] }), 1);
    },
    btStopScan: async () => { log.push('stop scan'); },
    btKnown: async ({ ids }) => ({ devices: ids.filter((id) => id === 'T1' || id === 'H1').map((id) => ({ id, name: id === 'T1' ? 'Made-up Trainer' : 'Made-up Strap' })) }),
    btConnect: async ({ id }) => { connected.add(id); log.push(`connect ${id}`); },
    btDisconnect: async ({ id }) => { connected.delete(id); log.push(`disconnect ${id}`); setTimeout(() => emit('btDisconnected', { id }), 1); },
    btDiscover: async ({ id, service }) => {
      if (id === 'T1' && service === FTMS) return { characteristics: ['2AD2', '2AD9', '2AD8'] };
      if (id === 'H1' && service === HRS) return { characteristics: ['2A37'] };
      throw new Error('This device has no such service.');
    },
    btRead: async ({ characteristic }) => {
      if (characteristic === RANGE) return { data: b64([0, 0, 0xd0, 0x07, 1, 0]) };   // 0 to 2000 W in steps of 1
      throw new Error('not readable');
    },
    btWrite: async ({ id, service, characteristic, data, withResponse }) => {
      const bytes = [...atob(data)].map((c) => c.charCodeAt(0));
      log.push(`write ${characteristic === CP ? 'control' : characteristic} ${bytes.join(' ')}${withResponse ? '' : ' (no reply asked)'}`);
      // A trainer answers every control-point command: 0x80, the command, 1 for done.
      if (characteristic === CP) setTimeout(() => emit('btValue', { id, service, characteristic, data: b64([0x80, bytes[0], 0x01]) }), 1);
    },
    btNotify: async ({ id, characteristic, on }) => { if (on) notifying.add(`${id}|${characteristic}`); else notifying.delete(`${id}|${characteristic}`); },
    addListener: ((event: string, fn: (e: never) => void) => { (listeners[event] ??= []).push(fn); }) as NativeBluetooth['addListener'],
  };
  return { side, emit, log, notifying, connected };
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
afterEach(() => { chooserBus.watch(() => undefined); chooserBus.watchProblems(() => undefined); });
const use = (side: NativeBluetooth) => Object.defineProperty(globalThis.navigator ?? ((globalThis as { navigator?: unknown }).navigator = {}), 'bluetooth', { value: makeBluetooth(side), configurable: true });
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); expect(ok()).toBe(true); };

describe('service and characteristic names', () => {
  it('are compared in one full form, whatever spelling a device or the app uses', () => {
    expect(fullUuid(0x1826)).toBe('00001826-0000-1000-8000-00805f9b34fb');
    expect(fullUuid('180D')).toBe('0000180d-0000-1000-8000-00805f9b34fb');
    expect(fullUuid('40B50000-30B5-11E5-A151-FEFF819CDC90')).toBe('40b50000-30b5-11e5-a151-feff819cdc90');
  });
  it('a device is listed for a box only when it offers what the box needs, or carries the name asked for', () => {
    expect(matches({ name: 'A', services: ['1826'] }, [{ services: [0x1826] }])).toBe(true);
    expect(matches({ name: 'A', services: ['180D'] }, [{ services: [0x1826] }])).toBe(false);
    expect(matches({ name: 'TYME-1234', services: [] }, [{ services: ['40b50000-30b5-11e5-a151-feff819cdc90'] }, { namePrefix: 'TYME-' }])).toBe(true);
    expect(matches({ name: 'Other', services: ['1826'] }, [{ services: [0x1826], name: 'Mine' }])).toBe(false);
    expect(matches({ name: 'Anything', services: [] }, [{}])).toBe(false);
  });
});

describe('a smart trainer and a heart-rate strap, through the iPhone’s Bluetooth', () => {
  it('the list shows only devices the box can use; the one picked is connected, read, and taken control of', async () => {
    const t = standIn();
    use(t.side);
    const lists: FoundDevice[][] = [];
    chooserBus.watch((l) => lists.push(l));
    const choosing = chooseDevice('trainer');
    await until(() => lists.some((l) => l.length > 0));
    expect(lists.at(-1)).toEqual([{ id: 'T1', name: 'Made-up Trainer' }]);
    expect(chooserBus.pick('T1')).toBe(true);
    const device = await choosing;
    expect(device.name).toBe('Made-up Trainer');
    expect(t.log).toContain('stop scan');

    const readings: Array<Omit<Reading, 'at'>> = [];
    const statuses: SensorStatus[] = [];
    let control: { controllable: boolean; powerRange?: { max: number } } | undefined;
    const driver = attach(device, 'trainer', { reading: (r) => readings.push(r), status: (s) => statuses.push(s), control: (c) => { control = c; } });
    await until(() => statuses.includes('connected'));
    expect(control?.controllable).toBe(true);
    expect(control?.powerRange?.max).toBe(2000);
    expect(t.log).toContain(`write control ${[...cmdRequestControl()].join(' ')}`);

    // The trainer reports: 30 km/h, 90 rpm, 200 W.
    t.emit('btValue', { id: 'T1', service: FTMS, characteristic: BIKE, data: b64([0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xc8, 0x00]) });
    await until(() => readings.length > 0);
    expect(readings[0]).toMatchObject({ watts: 200, cadence: 90 });
    expect(readings[0].speedKmh).toBeCloseTo(30, 1);

    // A target is set and the trainer's answer comes back to the player.
    const answer = await driver.command!(Uint8Array.from([0x05, 0xfa, 0x00]));   // 250 W
    expect(answer?.ok).toBe(true);

    // The link drops: the player hears of it and reaches for the trainer again by itself.
    t.emit('btDisconnected', { id: 'T1' });
    await until(() => statuses.includes('lost'));
    driver.dispose();
  });

  it('a heart-rate strap: beats arrive as they are sent', async () => {
    const t = standIn();
    use(t.side);
    chooserBus.watch(() => undefined);
    const choosing = chooseDevice('hr');
    await new Promise((r) => setTimeout(r, 10));
    chooserBus.pick('H1');
    const device = await choosing;
    const readings: Array<Omit<Reading, 'at'>> = [];
    const statuses: SensorStatus[] = [];
    const driver = attach(device, 'hr', { reading: (r) => readings.push(r), status: (s) => statuses.push(s) });
    await until(() => statuses.includes('connected'));
    expect(t.notifying.has(`H1|${HRM}`)).toBe(true);
    t.emit('btValue', { id: 'H1', service: HRS, characteristic: HRM, data: b64([0x00, 142]) });
    await until(() => readings.length > 0);
    expect(readings[0].bpm).toBe(142);
    driver.dispose();
  });

  it('closing the list chooses nothing, and the search stops', async () => {
    const t = standIn();
    use(t.side);
    const choosing = chooseDevice('trainer');
    await new Promise((r) => setTimeout(r, 10));
    chooserBus.pick('');
    await expect(choosing).rejects.toThrow();
    expect(t.log).toContain('stop scan');
  });

  it('a device chosen before is found again without asking', async () => {
    const t = standIn();
    use(t.side);
    const choosing = chooseDevice('trainer');
    await new Promise((r) => setTimeout(r, 10));
    chooserBus.pick('T1');
    await choosing;
    expect((await knownDevice('T1'))?.name).toBe('Made-up Trainer');
    expect(await knownDevice('never-seen')).toBeUndefined();
  });

  it('Bluetooth turned off, or not allowed for the app: said to the rider, and nothing is searched for', async () => {
    for (const state of ['off', 'denied'] as const) {
      const t = standIn(state);
      use(t.side);
      const said: BluetoothProblem[] = [];
      chooserBus.watchProblems((p) => said.push(p));
      await expect(chooseDevice('trainer')).rejects.toThrow();
      expect(said).toEqual([state]);
      expect(t.log).toEqual([]);
    }
  });
});
