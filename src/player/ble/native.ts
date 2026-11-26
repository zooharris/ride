/**
 * Bluetooth on iPhone and iPad (25 Nov 2026). Apple's web engine, which every iOS app's pages run in, has no
 * Bluetooth. The app's own side reaches the iPhone's Bluetooth (ios/App/App/SceneDelegate.swift), and this module
 * offers it to the pages in the same shape a browser on a computer does (Web Bluetooth), so the one player, the one
 * set of device boxes and the one module that speaks to trainers and sensors (ble/web.ts) serve every version.
 *
 * Only what the player uses is here: finding a device of a kind, finding one used before, connecting, reading,
 * writing, and listening. Nothing is specific to any maker's device.
 */
import { chooserBus, type BluetoothProblem, type FoundDevice } from './chooserBus';

/** The app's own side, as the iOS shell offers it. */
export interface NativeBluetooth {
  btState(): Promise<{ state: 'on' | 'off' | 'denied' | 'unsupported' | 'unknown' }>;
  btScan(o: { services: string[] }): Promise<void>;
  btStopScan(): Promise<void>;
  btKnown(o: { ids: string[] }): Promise<{ devices: Array<{ id: string; name?: string }> }>;
  btConnect(o: { id: string }): Promise<void>;
  btDisconnect(o: { id: string }): Promise<void>;
  btDiscover(o: { id: string; service: string }): Promise<{ characteristics: string[] }>;
  btRead(o: { id: string; service: string; characteristic: string }): Promise<{ data: string }>;
  btWrite(o: { id: string; service: string; characteristic: string; data: string; withResponse: boolean }): Promise<void>;
  btNotify(o: { id: string; service: string; characteristic: string; on: boolean }): Promise<void>;
  addListener(event: 'btFound', fn: (e: { devices: Array<{ id: string; name?: string; services?: string[] }> }) => void): unknown;
  addListener(event: 'btValue', fn: (e: { id: string; service: string; characteristic: string; data: string }) => void): unknown;
  addListener(event: 'btDisconnected', fn: (e: { id: string }) => void): unknown;
}

/** A service or characteristic by its full name in lower case, from a 16-bit number or any spelling of the name. */
export function fullUuid(u: number | string): string {
  if (typeof u === 'number') return `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
  const s = u.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

const b64 = (bytes: Uint8Array): string => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

interface Filter { services?: Array<number | string>; name?: string; namePrefix?: string }
/** Whether a device found matches what was asked for: any one filter, and within a filter everything it names. */
export function matches(d: { name?: string; services?: string[] }, filters: Filter[]): boolean {
  const has = new Set((d.services ?? []).map(fullUuid));
  return filters.some((f) => (f.services ?? []).every((s) => has.has(fullUuid(s)))
    && (f.name == null || d.name === f.name)
    && (f.namePrefix == null || (d.name ?? '').startsWith(f.namePrefix))
    && (!!f.services?.length || f.name != null || f.namePrefix != null));
}

const KNOWN_KEY = 'antogoBluetoothKnown';
const readKnown = (): FoundDevice[] => { try { return JSON.parse(localStorage.getItem(KNOWN_KEY) ?? '[]') as FoundDevice[]; } catch { return []; } };
const addKnown = (d: FoundDevice) => { try { localStorage.setItem(KNOWN_KEY, JSON.stringify([d, ...readKnown().filter((x) => x.id !== d.id)].slice(0, 40))); } catch { /* the device is asked for again next time */ } };

class NotFound extends Error { constructor(m: string) { super(m); this.name = 'NotFoundError'; } }

/** The Bluetooth a page sees, made from the app's own side. Returned so a test can drive it with a stand-in. */
export function makeBluetooth(side: NativeBluetooth): Bluetooth {
  const devices = new Map<string, NDevice>();
  const chars = new Map<string, NChar>();
  const key = (id: string, service: string, characteristic: string) => `${id}|${fullUuid(service)}|${fullUuid(characteristic)}`;

  class NChar extends EventTarget {
    value?: DataView;
    constructor(readonly service: NService, readonly uuid: string) { super(); }
    private get at() { return { id: this.service.device.id, service: this.service.uuid, characteristic: this.uuid }; }
    async startNotifications() { await side.btNotify({ ...this.at, on: true }); return this; }
    async stopNotifications() { await side.btNotify({ ...this.at, on: false }); return this; }
    async readValue() { const r = await side.btRead(this.at); const b = unb64(r.data); this.value = new DataView(b.buffer); return this.value; }
    async writeValueWithResponse(v: BufferSource) { await side.btWrite({ ...this.at, data: b64(bytesOf(v)), withResponse: true }); }
    async writeValueWithoutResponse(v: BufferSource) { await side.btWrite({ ...this.at, data: b64(bytesOf(v)), withResponse: false }); }
    async writeValue(v: BufferSource) { await this.writeValueWithResponse(v); }
  }
  class NService {
    constructor(readonly device: NDevice, readonly uuid: string, private readonly has: Set<string>) {}
    async getCharacteristic(c: number | string) {
      const uuid = fullUuid(c);
      if (!this.has.has(uuid)) throw new NotFound('This device has no such characteristic.');
      const k = key(this.device.id, this.uuid, uuid);
      let ch = chars.get(k);
      if (!ch || ch.service !== this) { ch = new NChar(this, uuid); chars.set(k, ch); }
      return ch;
    }
  }
  class NServer {
    connected = false;
    constructor(readonly device: NDevice) {}
    async connect() { await side.btConnect({ id: this.device.id }); this.connected = true; return this; }
    disconnect() { this.connected = false; void side.btDisconnect({ id: this.device.id }).catch(() => undefined); }
    async getPrimaryService(s: number | string) {
      const uuid = fullUuid(s);
      const r = await side.btDiscover({ id: this.device.id, service: uuid });
      return new NService(this.device, uuid, new Set(r.characteristics.map(fullUuid)));
    }
  }
  class NDevice extends EventTarget {
    readonly gatt: NServer;
    constructor(readonly id: string, readonly name: string | undefined) { super(); this.gatt = new NServer(this); }
  }
  const bytesOf = (v: BufferSource): Uint8Array => (v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  const deviceFor = (id: string, name?: string): NDevice => {
    let d = devices.get(id);
    if (!d || (name && d.name !== name)) { d = new NDevice(id, name ?? d?.name); devices.set(id, d); }
    return d;
  };

  side.addListener('btValue', (e) => {
    const ch = chars.get(key(e.id, e.service, e.characteristic));
    if (!ch) return;
    const b = unb64(e.data);
    ch.value = new DataView(b.buffer);
    ch.dispatchEvent(new Event('characteristicvaluechanged'));
  });
  side.addListener('btDisconnected', (e) => {
    const d = devices.get(e.id);
    if (!d) return;
    d.gatt.connected = false;
    // What was subscribed is gone with the link; the next connection subscribes afresh.
    for (const k of [...chars.keys()]) if (k.startsWith(`${e.id}|`)) chars.delete(k);
    d.dispatchEvent(new Event('gattserverdisconnected'));
  });

  let searching: { filters: Filter[]; seen: Map<string, { id: string; name?: string; services?: string[] }> } | undefined;
  side.addListener('btFound', (e) => {
    if (!searching) return;
    for (const d of e.devices) searching.seen.set(d.id, d);
    chooserBus.publish([...searching.seen.values()].filter((d) => matches(d, searching!.filters)).map((d) => ({ id: d.id, name: d.name ?? '' })));
  });

  /** Whether the iPhone's Bluetooth can be used, told to the rider when it cannot. */
  const ready = async (): Promise<boolean> => {
    const { state } = await side.btState();
    if (state === 'on') return true;
    chooserBus.problem((state === 'unknown' ? 'off' : state) as BluetoothProblem);
    return false;
  };

  const bluetooth = {
    async requestDevice(o: { filters?: Filter[]; optionalServices?: Array<number | string> }) {
      if (!(await ready())) throw new NotFound('Bluetooth is not available.');
      const filters = o.filters ?? [];
      searching = { filters, seen: new Map() };
      chooserBus.publish([]);
      // Devices the iPhone already holds a link to do not announce themselves: they are asked for by the services wanted.
      const services = [...new Set(filters.flatMap((f) => f.services ?? []).map(fullUuid))];
      try {
        const picked = new Promise<string>((resolve) => chooserBus.onPick(resolve));
        await side.btScan({ services });
        const id = await picked;
        if (!id) throw new NotFound('No device was chosen.');
        const d = searching.seen.get(id);
        addKnown({ id, name: d?.name ?? '' });
        return deviceFor(id, d?.name);
      } finally {
        chooserBus.onPick(undefined);
        searching = undefined;
        void side.btStopScan().catch(() => undefined);
      }
    },
    /** Devices chosen here before that the iPhone still knows: handed back without asking. */
    async getDevices() {
      const known = readKnown();
      if (!known.length) return [];
      const { state } = await side.btState();
      if (state !== 'on') return [];
      const r = await side.btKnown({ ids: known.map((k) => k.id) });
      return r.devices.map((d) => deviceFor(d.id, d.name || known.find((k) => k.id === d.id)?.name));
    },
  };
  return bluetooth as unknown as Bluetooth;
}

/** Put the iPhone's Bluetooth where the player looks for a browser's. Does nothing where the browser has its own. */
export function installNativeBluetooth(side: NativeBluetooth): void {
  if (typeof navigator === 'undefined' || ('bluetooth' in navigator && navigator.bluetooth)) return;
  Object.defineProperty(navigator, 'bluetooth', { value: makeBluetooth(side), configurable: true });
}
