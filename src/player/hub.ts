/**
 * The sensors connected on this computer, live. One of each kind at a time
 * (a second trainer replaces the first). Real devices are remembered in a
 * local-only setting so the next ride can reconnect them; simulated ones
 * appear only while practice mode is on in Settings.
 */
import { getSetting, setSetting } from '../data/db';
import { attach, chooseDevice, knownDevice, type Driver } from './ble/web';
import { cmdSetTargetPower, cmdSimulation, cmdStart, type Range } from './ble/parse';
import { BUSY_WARNING, NO_CONTROL_WARNING, ROLLR_WARNING, rollrCheck, type Metric, type Reading, type SensorKind, type SensorSnapshot, type SensorStatus } from './sources';
import { SimRider, type RiderNumbers } from './sim';
import { reportsOf } from './devices';

export interface SensorState extends SensorSnapshot {
  warning?: string;
  /** Trainers: the player holds control and can set resistance. */
  controllable?: boolean;
  powerRange?: Range;
  rollrSince?: number;
}

/**
 * A device this computer has used. Each device once (by id), with the service it
 * connects through (`kind`), when it was last used, and the numbers it has been
 * seen to report, so each box can offer only the devices that can fill it.
 */
export interface SavedDevice { id: string; name: string; kind: SensorKind; lastUsed?: string; reports?: Metric[] }

/** Local-only settings (see LOCAL_ONLY in devicesync.ts): devices belong to one computer. */
export const DEVICES_KEY = 'playerDevices';
export const SIM_KEY = 'playerSim';
/** Which device the rider chose for each number (or 'none'): local, like the devices. */
export const SLOTS_KEY = 'playerSlots';
export type Slots = Partial<Record<Metric, string>>;

let sensors: SensorState[] = [];
const drivers = new Map<string, Driver>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function emitNow(): void { clearTimeout(flushTimer); flushTimer = undefined; listeners.forEach((l) => l()); }
/** Readings arrive several times a second; the screen redraws at most four times a second. */
function emitSoon(): void { if (!flushTimer) flushTimer = setTimeout(emitNow, 250); }

export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getSensors(): SensorState[] { return sensors; }

function update(id: string, patch: Partial<SensorState>, soon = false): void {
  sensors = sensors.map((s) => (s.id === id ? { ...s, ...patch } : s));
  if (soon) emitSoon(); else emitNow();
}

function onReading(id: string, r: Omit<Reading, 'at'>): void {
  const s = sensors.find((x) => x.id === id);
  if (!s) return;
  const reading: Reading = { ...r, at: Date.now() };
  if (!s.simulated) learn(id, r);
  const patch: Partial<SensorState> = { reading };
  if (s.kind === 'trainer') {
    const c = rollrCheck(s.name, reading, s.rollrSince, reading.at);
    patch.rollrSince = c.since;
    if (c.warn) patch.warning = ROLLR_WARNING;
    else if (s.warning === ROLLR_WARNING) patch.warning = undefined;
  }
  update(id, patch, true);
}

let savedCache: SavedDevice[] | undefined;
async function saved(): Promise<SavedDevice[]> {
  savedCache ??= migrateSaved(await getSetting<SavedDevice[]>(DEVICES_KEY, []));
  return savedCache;
}
async function writeSaved(list: SavedDevice[]): Promise<void> { savedCache = list; await setSetting(DEVICES_KEY, list); emitNow(); }

/** A device's way in: a trainer before a power meter before a heart-rate monitor before a speed/cadence sensor. */
const RANK: Record<SensorKind, number> = { trainer: 0, power: 1, hr: 2, csc: 3 };

/** Remember a device, once by id, keeping what was learned about it; never forgets others of its kind. */
async function remember(d: SavedDevice): Promise<void> {
  const list = await saved();
  const old = list.find((x) => x.id === d.id);
  const kind = old && RANK[old.kind] < RANK[d.kind] ? old.kind : d.kind;
  await writeSaved([...list.filter((x) => x.id !== d.id), { ...old, ...d, kind, reports: old?.reports ?? d.reports }]);
}

/**
 * Before 28 Oct the list held one device per kind, and a device added under a
 * second kind replaced its first entry (a KICKR ROLLR picked as a speed sensor
 * stopped being the trainer). A Wahoo KICKR is a trainer whatever it was filed as.
 */
export function migrateSaved(list: SavedDevice[]): SavedDevice[] {
  const byId = new Map<string, SavedDevice>();
  for (const d of list) {
    const kind: SensorKind = /\bKICKR\b/i.test(d.name) ? 'trainer' : d.kind;
    const old = byId.get(d.id);
    byId.set(d.id, old && RANK[old.kind] <= RANK[kind] ? old : { ...d, kind });
  }
  return [...byId.values()];
}

/** Learn what a device reports (once per number), so the boxes offer it where it can help. */
const learned = new Map<string, Set<Metric>>();
function learn(id: string, r: Omit<Reading, 'at'>): void {
  const seen = learned.get(id) ?? new Set<Metric>();
  const fresh = (['watts', 'cadence', 'speedKmh', 'bpm'] as Metric[]).filter((m) => r[m] != null && !seen.has(m));
  if (!fresh.length) return;
  fresh.forEach((m) => seen.add(m));
  learned.set(id, seen);
  void saved().then((list) => {
    const d = list.find((x) => x.id === id);
    if (!d) return;
    const reports = [...new Set([...(d.reports ?? []), ...seen])];
    if (reports.length !== (d.reports ?? []).length) void writeSaved(list.map((x) => (x.id === id ? { ...x, reports } : x)));
  });
}

async function touch(id: string): Promise<void> {
  const list = await saved();
  const today = new Date().toISOString().slice(0, 10);
  if (list.some((x) => x.id === id && x.lastUsed !== today)) await writeSaved(list.map((x) => (x.id === id ? { ...x, lastUsed: today } : x)));
}

// ── Which device fills each box ──────────────────────────────────────────────

let slots: Slots = {};
let slotsLoaded = false;
export async function loadSlots(): Promise<Slots> { if (!slotsLoaded) { slots = await getSetting<Slots>(SLOTS_KEY, {}); slotsLoaded = true; } return slots; }
export function getSlots(): Slots { return slots; }
/** The rider's choice for one number: a device id, 'none', or undefined to let the app pick. */
export async function setSlot(m: Metric, id: string | undefined): Promise<void> {
  await loadSlots();
  slots = { ...slots, [m]: id };
  if (id === undefined) delete slots[m];
  await setSetting(SLOTS_KEY, slots);
  emitNow();
}

function drop(id: string): void {
  drivers.get(id)?.dispose();
  drivers.delete(id);
  sensors = sensors.filter((s) => s.id !== id);
}

function start(device: BluetoothDevice, kind: SensorKind): void {
  const id = device.id;
  // One trainer, one power meter, one heart-rate monitor at a time; separate speed and cadence sensors can both be connected.
  for (const s of sensors.filter((x) => x.id === id || (x.kind === kind && kind !== 'csc'))) drop(s.id);
  sensors = [...sensors, { id, kind, name: device.name || KIND_FALLBACK[kind], status: 'connecting' }];
  emitNow();
  drivers.set(id, attach(device, kind, {
    reading: (r) => onReading(id, r),
    status: (status: SensorStatus) => { update(id, status === 'connected' ? { status } : { status, reading: undefined }); if (status === 'connected') void touch(id); },
    control: (c) => {
      update(id, {
        controllable: c.controllable,
        powerRange: c.powerRange,
        warning: c.controllable ? undefined : c.busy ? BUSY_WARNING : NO_CONTROL_WARNING,
      });
      if (c.controllable) controlListeners.forEach((l) => l());
    },
  }));
}

const controlListeners = new Set<() => void>();
/**
 * Called each time a trainer (re)gains control: on first connecting and after
 * every dropout. A ride in progress uses it to give the trainer its target back,
 * since a trainer that lost the link has forgotten it.
 */
export function onTrainerControl(fn: () => void): () => void { controlListeners.add(fn); return () => { controlListeners.delete(fn); }; }

const KIND_FALLBACK: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart-rate monitor', csc: 'Speed/cadence sensor' };

/**
 * Opens the browser's list of devices nearby of one kind (call from a click)
 * and connects what is picked. Returns its id. A device already connected some
 * other way (a ROLLR picked again as a speed sensor) is not connected twice.
 */
export async function addSensor(kind: SensorKind): Promise<string | undefined> {
  let device: BluetoothDevice;
  try { device = await chooseDevice(kind); } catch { return undefined; }
  if (sensors.some((s) => s.id === device.id && s.status !== 'offline')) return device.id;
  await remember({ id: device.id, name: device.name || KIND_FALLBACK[kind], kind });
  start(device, kind);
  return device.id;
}

/**
 * Connect a device this computer has used before. Where the browser hands it
 * back without asking, at once; where it does not (Chrome on a Mac), its list
 * opens narrowed to that one device, to confirm. Call from a click.
 */
export async function connectSaved(id: string): Promise<boolean> {
  const d = (await saved()).find((x) => x.id === id);
  if (!d) return false;
  if (sensors.some((s) => s.id === id && s.status !== 'offline')) return true;
  let device = await knownDevice(id);
  if (!device) { try { device = await chooseDevice(d.kind, d.name); } catch { return false; } }
  start(device, d.kind);
  return true;
}

/**
 * At the ride screen's opening: where the browser can reach remembered devices
 * without asking, reconnect the ones in use (each box's chosen device, else the
 * one used most recently for it, and the last trainer). Where it cannot,
 * nothing happens until the rider picks them.
 */
export async function restoreSaved(): Promise<void> {
  const list = await saved();
  const s = await loadSlots();
  const latest = (fits: (d: SavedDevice) => boolean) => list.filter(fits).sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''))[0]?.id;
  const want = new Set<string>();
  const t = latest((d) => d.kind === 'trainer'); if (t) want.add(t);
  for (const m of ['watts', 'bpm', 'cadence', 'speedKmh'] as Metric[]) {
    const id = s[m] && s[m] !== 'none' ? s[m] : latest((d) => reportsOf(d).includes(m));
    if (id) want.add(id);
  }
  for (const id of want) {
    const d = list.find((x) => x.id === id);
    if (!d || sensors.some((x) => x.id === id)) continue;
    const device = await knownDevice(id);
    if (device) start(device, d.kind);
  }
}

/** Disconnect a device for now (it stays remembered). */
export function disconnect(id: string): void { const s = sensors.find((x) => x.id === id); drop(id); if (s?.simulated) stopSimIfIdle(); emitNow(); }

/** Disconnect and forget a sensor on this computer. */
export async function forget(id: string): Promise<void> {
  const s = sensors.find((x) => x.id === id);
  drop(id);
  if (s?.simulated) stopSimIfIdle();
  await writeSaved((await saved()).filter((d) => d.id !== id));
  if (Object.values(slots).includes(id)) { slots = Object.fromEntries(Object.entries(slots).filter(([, v]) => v !== id)); await setSetting(SLOTS_KEY, slots); }
  emitNow();
}

/** Every remembered device, for Settings and the device boxes (whether or not connected now). */
export async function savedDevices(): Promise<SavedDevice[]> { return saved(); }
/** The remembered devices as last loaded (load them once with savedDevices()). */
export function knownNow(): SavedDevice[] { return savedCache ?? []; }

// ── Simulated sensors (practice mode) ───────────────────────────────────────

let rider: SimRider | undefined;
let simTimer: ReturnType<typeof setInterval> | undefined;

export function setRiderNumbers(p: RiderNumbers): void {
  if (rider) rider.setNumbers(p); else rider = new SimRider(p);
}

const SIM_NAME: Record<SensorKind, string> = { trainer: 'Simulated trainer', power: 'Simulated power meter', hr: 'Simulated heart rate', csc: 'Simulated cadence sensor' };

export function addSimulated(kind: SensorKind): void {
  const id = `sim-${kind}`;
  for (const s of sensors.filter((x) => x.kind === kind)) drop(s.id);
  sensors = [...sensors, { id, kind, name: SIM_NAME[kind], status: 'connected', simulated: true, controllable: kind === 'trainer' ? true : undefined, powerRange: kind === 'trainer' ? { min: 0, max: 2000, step: 1 } : undefined }];
  rider ??= new SimRider({ ftp: 220, lthr: 160, restingHr: 55, maxHr: 180 });
  simTimer ??= setInterval(simTick, 1000);
  emitNow();
}

function simTick(): void {
  if (!rider) return;
  const r = rider.tick(1);
  const at = Date.now();
  sensors = sensors.map((s) => {
    if (!s.simulated) return s;
    const reading: Reading = s.kind === 'trainer' ? { watts: r.watts, cadence: r.cadence, speedKmh: r.speedKmh, at }
      : s.kind === 'power' ? { watts: r.watts, cadence: r.cadence, at }
      : s.kind === 'hr' ? { bpm: r.bpm, at }
      : { cadence: r.cadence, speedKmh: r.speedKmh, at };
    return { ...s, reading };
  });
  emitNow();
}

function stopSimIfIdle(): void {
  if (sensors.some((s) => s.simulated)) return;
  clearInterval(simTimer);
  simTimer = undefined;
}

/** Practice mode turned off: the simulated sensors go. */
export function removeSimulated(): void {
  for (const s of sensors.filter((x) => x.simulated)) drop(s.id);
  stopSimIfIdle();
  emitNow();
}

// ── Controlling the trainer ─────────────────────────────────────────────────

/** What the trainer is asked to do: hold watts (ERG), or ride like a road of a gradient (resistance, free ride). */
export type TrainerCommand = { erg: number } | { grade: number };

let queue: Promise<unknown> = Promise.resolve();
let started = false;

/** The trainer that will take commands, if any. */
export function controlledTrainer(): SensorState | undefined {
  return sensors.find((s) => s.kind === 'trainer' && s.status === 'connected' && s.controllable);
}

/**
 * Send a command to the controlled trainer. Commands go one at a time (the
 * control point answers each before the next); a simulated trainer follows at
 * once. The first command of a ride is preceded by Start.
 */
export function commandTrainer(cmd: TrainerCommand): void {
  const t = controlledTrainer();
  if (!t) return;
  if (t.simulated) {
    if (rider) rider.target = 'erg' in cmd ? cmd.erg : 130 + cmd.grade * 18;
    return;
  }
  const d = drivers.get(t.id);
  if (!d?.command) return;
  let watts = 'erg' in cmd ? cmd.erg : 0;
  if ('erg' in cmd && t.powerRange) watts = Math.max(t.powerRange.min, Math.min(t.powerRange.max, watts));
  const bytes = 'erg' in cmd ? cmdSetTargetPower(watts) : cmdSimulation(cmd.grade);
  queue = queue.then(async () => {
    try {
      if (!started) { await d.command!(cmdStart()); started = true; }
      await d.command!(bytes);
    } catch { /* a dropped trainer: the next command, after it reconnects, carries the target again */ }
  });
}

/** A new ride starts the trainer again with its first command. */
export function resetTrainerSession(): void { started = false; }
