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
import { BREATH_BULK, BREATH_CMD, BREATH_DATA, BREATH_NAMES, BREATH_SERVICE, breathTimestamp, motionClock, parseBreathPacket, parseStrapReply, STRAP, tagOf, type StrapCommand, type StrapReply } from './breath';

export const bluetoothAvailable = (): boolean => typeof navigator !== 'undefined' && 'bluetooth' in navigator && !!navigator.bluetooth;

/** Remembering a device across visits needs getDevices(), which not every Chrome has switched on. */
export const canRemember = (): boolean => bluetoothAvailable() && typeof navigator.bluetooth.getDevices === 'function';

const PRIMARY: Record<SensorKind, BluetoothServiceUUID> = { trainer: SERVICE.ftms, power: SERVICE.cyclingPower, hr: SERVICE.heartRate, csc: SERVICE.csc, breath: BREATH_SERVICE };

/**
 * Opens the browser's chooser, showing only devices that offer this kind's
 * service (and, with a name, only that device). A breathing strap is also
 * found by its name, in case it does not advertise its service. Must run from a click.
 */
export async function chooseDevice(kind: SensorKind, name?: string): Promise<BluetoothDevice> {
  const filters: BluetoothLEScanFilter[] = name
    // With a name, the list shows only that device: confirming one used before.
    ? [kind === 'breath' ? { name } : { services: [PRIMARY[kind]], name }]
    : kind === 'breath' ? [{ services: [BREATH_SERVICE] }, ...BREATH_NAMES.map((namePrefix) => ({ namePrefix }))]
    : [{ services: [PRIMARY[kind]] }];
  return navigator.bluetooth.requestDevice({
    filters,
    optionalServices: [SERVICE.ftms, SERVICE.cyclingPower, SERVICE.heartRate, SERVICE.csc, SERVICE.battery, BREATH_SERVICE],
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
  /** Breathing straps: every packet as it came, for Copy details ('cmd' for the command characteristic). */
  raw?(bytes: Uint8Array, from?: 'cmd'): void;
  /** Breathing straps: battery, percent. */
  battery?(pct: number): void;
  /** Breathing straps: a reply or beacon on the command characteristic (4 Nov). */
  strap?(r: StrapReply): void;
  /** Breathing straps: a motion frame's clock (a clock that stops advancing is a stalled sensor). */
  motion?(clock: number): void;
}

/** A breathing strap's command channel (4 Nov 2026): what the Tymewear app sends, and the ways back from a stall. */
export interface StrapControl {
  /** Write one command and wait (up to 3 s) for its reply; null when there was none or the write failed. */
  send(cmd: StrapCommand): Promise<StrapReply | null>;
  /** Turn the notifications off and on again. */
  resubscribe(): Promise<void>;
  /** Drop the connection and connect again; resolves once connected (or after 20 s). */
  reconnect(): Promise<boolean>;
}

export interface Driver {
  /** Trainers only, once control is held: write a control-point command and wait for its answer. */
  command?(bytes: Uint8Array): Promise<ControlResponse | null>;
  /** Breathing straps only. */
  strap?: StrapControl;
  dispose(): void;
}

const RETRY_MS = 5000;

export function attach(device: BluetoothDevice, kind: SensorKind, ev: DriverEvents): Driver {
  let disposed = false;
  let everConnected = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let control: BluetoothRemoteGATTCharacteristic | undefined;
  let pending: { resolve: (r: ControlResponse | null) => void; op: number } | undefined;
  // Breathing straps: the command characteristic, the subscribed ones (for re-subscribing), and replies awaited by tag.
  let strapCmd: BluetoothRemoteGATTCharacteristic | undefined;
  let strapChars: BluetoothRemoteGATTCharacteristic[] = [];
  const awaiting = new Map<number, (r: StrapReply | null) => void>();
  let connectedWaiters: Array<(ok: boolean) => void> = [];
  const crank = crankRate();
  const wheel = kind === 'csc' ? cscWheelRate() : cpsWheelRate();

  const onValue = (fn: (v: DataView) => void) => (e: Event) => {
    const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (v) { try { fn(v); } catch { /* a malformed packet is skipped */ } }
  };

  const listen = async (svc: BluetoothRemoteGATTService, char: BluetoothCharacteristicUUID, fn: (v: DataView) => void) => {
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
    } else if (kind === 'breath') {
      const svc = await server.getPrimaryService(BREATH_SERVICE);
      strapChars = [];
      awaiting.clear();
      // 4 Nov 2026: subscribe as the Tymewear app does: commands first, then the live data, then the stored-session channel.
      try {
        strapCmd = await listen(svc, BREATH_CMD, (v) => {
          const bytes = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
          ev.raw?.(bytes, 'cmd');
          const r = parseStrapReply(bytes);
          if (!r) return;
          ev.strap?.(r);
          if (r.type === 'reply') { const w = awaiting.get(r.tag); if (w) { awaiting.delete(r.tag); w(r); } }
        });
        strapChars.push(strapCmd);
      } catch { strapCmd = undefined; /* an older strap without it still streams */ }
      let prev: number | undefined;
      strapChars.push(await listen(svc, BREATH_DATA, (v) => {
        const bytes = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
        ev.raw?.(bytes);
        const m = motionClock(bytes);
        if (m != null) ev.motion?.(m);
        const b = parseBreathPacket(bytes, prev);
        const ts = breathTimestamp(bytes);
        if (ts != null) prev = ts;
        if (b) ev.reading({ ve: Math.round(b.ventilation * 10) / 10, br: Math.round(b.rate * 10) / 10, tv: Math.round(b.size * 100) / 100, ie: Math.round(b.ieRatio * 100) / 100 });
      }));
      try { strapChars.push(await listen(svc, BREATH_BULK, () => undefined)); } catch { /* optional */ }
      try {
        const bat = await server.getPrimaryService(SERVICE.battery);
        const level = await bat.getCharacteristic(CHAR.batteryLevel);
        ev.battery?.((await level.readValue()).getUint8(0));
        level.addEventListener('characteristicvaluechanged', onValue((v) => ev.battery?.(v.getUint8(0))));
        await level.startNotifications().catch(() => undefined);
      } catch { /* battery is optional */ }
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
    const ws = connectedWaiters; connectedWaiters = [];
    ws.forEach((w) => w(true));
  };

  const sendStrap = async (name: StrapCommand): Promise<StrapReply | null> => {
    if (!strapCmd) return null;
    const bytes = Uint8Array.from(STRAP[name]);
    const tag = tagOf(bytes);
    const answer = new Promise<StrapReply | null>((resolve) => {
      awaiting.set(tag, resolve);
      setTimeout(() => { if (awaiting.get(tag) === resolve) { awaiting.delete(tag); resolve(null); } }, 3000);
    });
    try { await write(strapCmd, bytes); } catch { awaiting.delete(tag); return null; }
    return answer;
  };
  const strap: StrapControl = {
    send: sendStrap,
    async resubscribe() {
      for (const c of strapChars) {
        try { await c.stopNotifications(); } catch { /* already off */ }
        try { await c.startNotifications(); } catch { /* the next step reconnects */ }
      }
    },
    reconnect() {
      return new Promise<boolean>((resolve) => {
        connectedWaiters.push(resolve);
        setTimeout(() => { connectedWaiters = connectedWaiters.filter((w) => w !== resolve); resolve(false); }, 20_000);
        try { device.gatt?.disconnect(); } catch { /* already gone */ }
        // gattserverdisconnected does not always fire for a disconnect we asked for: connect again ourselves.
        clearTimeout(retry);
        retry = setTimeout(tryConnect, 1000);
      });
    },
  };

  let connecting = false;
  const tryConnect = async () => {
    // One attempt at a time: a reconnect we asked for and the disconnect event can both schedule one.
    if (disposed || connecting) return;
    connecting = true;
    try { await connect(); } catch {
      if (disposed) return;
      // Never reached yet: switched off or asleep. Reached before: dropped out. Either way, keep trying quietly.
      ev.status(everConnected ? 'lost' : 'offline');
      retry = setTimeout(tryConnect, RETRY_MS);
    } finally { connecting = false; }
  };

  const onDisconnect = () => {
    if (disposed) return;
    control = undefined;
    strapCmd = undefined;
    ev.status('lost');
    clearTimeout(retry);
    retry = setTimeout(tryConnect, RETRY_MS);
  };
  device.addEventListener('gattserverdisconnected', onDisconnect);
  void tryConnect();

  return {
    command: kind === 'trainer' ? command : undefined,
    strap: kind === 'breath' ? strap : undefined,
    dispose() {
      disposed = true;
      clearTimeout(retry);
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      try { device.gatt?.disconnect(); } catch { /* already gone */ }
    },
  };
}
