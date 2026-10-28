/**
 * The one module that touches the browser's Bluetooth (Web Bluetooth, in
 * Chrome and Edge on a computer). It opens the browser's device chooser for a
 * kind of sensor, connects, listens, keeps reconnecting when a sensor drops,
 * and for a smart trainer takes control so the player can set its resistance.
 */
import { CHAR, SERVICE } from './gatt';
import {
  cmdRequestControl, crankRate, cscWheelRate, cpsWheelRate, parseControlResponse, parseCsc, parseCyclingPower,
  parseHeartRate, parseIndoorBikeData, parsePowerRange, WHEEL_M, type ControlResponse, type Range,
} from './parse';
import type { Reading, SensorKind, SensorStatus } from '../sources';

export const bluetoothAvailable = (): boolean => typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!navigator.bluetooth;

/** Remembering a device across visits needs getDevices(), which not every Chrome has switched on. */
export const canRemember = (): boolean => bluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function';

const PRIMARY: Record<SensorKind, number> = { trainer: SERVICE.ftms, power: SERVICE.cyclingPower, hr: SERVICE.heartRate, csc: SERVICE.csc };

/** Opens the browser's chooser, showing only devices that offer this kind's service. Must run from a click. */
export async function chooseDevice(kind: SensorKind): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [PRIMARY[kind]] }],
    optionalServices: [SERVICE.ftms, SERVICE.cyclingPower, SERVICE.heartRate, SERVICE.csc],
  });
}

/** A device the browser already has permission for, by id; undefined if it does not know it (or cannot say). */
export async function knownDevice(id: string): Promise<BluetoothDevice | undefined> {
  if (!canRemember()) return undefined;
  try { return (await navigator.bluetooth.getDevices()).find((d) => d.id === id); } catch { return undefined; }
}

export interface DriverEvents {
  reading(r: Omit<Reading, 'at'>): void;
  status(s: SensorStatus): void;
  /** Trainers only: whether the player has control, and why not. */
  control?(c: { controllable: boolean; busy?: boolean; powerRange?: Range }): void;
}

export interface Driver {
  /** Trainers only, once control is held: write a control-point command and wait for its answer. */
  command?(bytes: Uint8Array): Promise<ControlResponse | null>;
  dispose(): void;
}

const RETRY_MS = 5000;

export function attach(device: BluetoothDevice, kind: SensorKind, ev: DriverEvents): Driver {
  let disposed = false;
  let everConnected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let control: BluetoothRemoteGATTCharacteristic | undefined;
  let pending: { resolve: (r: ControlResponse | null) => void; op: number } | undefined;
  const crank = crankRate();
  const wheel = kind === 'csc' ? cscWheelRate() : cpsWheelRate();

  const onValue = (fn: (v: DataView) => void) => (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (v) { try { fn(v); } catch { /* a malformed packet is skipped */ } }
  };

  const listen = async (svc: BluetoothRemoteGATTService, char: number, fn: (v: DataView) => void) => {
    const c = await svc.getCharacteristic(char);
    c.addEventListener('characteristicvaluechanged', onValue(fn));
    await c.startNotifications();
    return c;
  };

  const write = async (c: BluetoothRemoteGATTCharacteristic, bytes: Uint8Array) => {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (c.writeValueWithResponse) await c.writeValueWithResponse(buf); else await c.writeValue(buf);
  };

  const command = async (bytes: Uint8Array): Promise<ControlResponse | null> => {
    if (!control) return null;
    const answer = new Promise<ControlResponse | null>((resolve) => {
      pending = { resolve, op: bytes[0] };
      setTimeout(() => { if (pending?.resolve === resolve) { pending = undefined; resolve(null); } }, 3000);
    });
    await write(control, bytes);
    return answer;
  };

  const connect = async () => {
    ev.status('connecting');
    const server = await device.gatt!.connect();
    if (kind === 'trainer') {
      const svc = await server.getPrimaryService(SERVICE.ftms);
      await listen(svc, CHAR.indoorBikeData, (v) => {
        const d = parseIndoorBikeData(v);
        ev.reading({ watts: d.watts, cadence: d.cadence, speedKmh: d.speedKmh, bpm: d.bpm || undefined });
      });
      let powerRange: Range | undefined;
      try { powerRange = parsePowerRange(await (await svc.getCharacteristic(CHAR.supportedPowerRange)).readValue()); } catch { /* optional */ }
      try {
        control = await listen(svc, CHAR.controlPoint, (v) => {
          const r = parseControlResponse(v);
          if (r && pending && r.request === pending.op) { const p = pending; pending = undefined; p.resolve(r); }
        });
        const r = await command(cmdRequestControl());
        ev.control?.({ controllable: !!r?.ok, busy: !r?.ok, powerRange });
      } catch {
        // No control point, or the write was refused: usually another app holds the trainer.
        control = undefined;
        ev.control?.({ controllable: false, busy: true, powerRange });
      }
    } else if (kind === 'power') {
      const svc = await server.getPrimaryService(SERVICE.cyclingPower);
      await listen(svc, CHAR.cyclingPowerMeasurement, (v) => {
        const m = parseCyclingPower(v);
        const now = Date.now();
        const cadence = m.crank ? Math.round(crank.update(m.crank.revs, m.crank.time, now) * 60) : undefined;
        const speedKmh = m.wheel ? wheel.update(m.wheel.revs, m.wheel.time, now) * WHEEL_M * 3.6 : undefined;
        ev.reading({ watts: m.watts, cadence, speedKmh });
      });
    } else if (kind === 'hr') {
      const svc = await server.getPrimaryService(SERVICE.heartRate);
      await listen(svc, CHAR.heartRateMeasurement, (v) => ev.reading({ bpm: parseHeartRate(v) }));
    } else {
      const svc = await server.getPrimaryService(SERVICE.csc);
      await listen(svc, CHAR.cscMeasurement, (v) => {
        const m = parseCsc(v);
        const now = Date.now();
        ev.reading({
          cadence: m.crank ? Math.round(crank.update(m.crank.revs, m.crank.time, now) * 60) : undefined,
          speedKmh: m.wheel ? wheel.update(m.wheel.revs, m.wheel.time, now) * WHEEL_M * 3.6 : undefined,
        });
      });
    }
    everConnected = true;
    ev.status('connected');
  };

  const tryConnect = async () => {
    if (disposed) return;
    try { await connect(); } catch {
      if (disposed) return;
      // Never reached yet: switched off or asleep. Reached before: dropped out. Either way, keep trying quietly.
      ev.status(everConnected ? 'lost' : 'offline');
      retry = setTimeout(tryConnect, RETRY_MS);
    }
  };

  const onDisconnect = () => {
    if (disposed) return;
    control = undefined;
    ev.status('lost');
    clearTimeout(retry);
    retry = setTimeout(tryConnect, RETRY_MS);
  };
  device.addEventListener('gattserverdisconnected', onDisconnect);
  void tryConnect();

  return {
    command: kind === 'trainer' ? command : undefined,
    dispose() {
      disposed = true;
      clearTimeout(retry);
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      try { device.gatt?.disconnect(); } catch { /* already gone */ }
    },
  };
}
