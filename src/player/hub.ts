/**
 * The sensors connected on this computer, live. One of each kind at a time
 * (a second trainer replaces the first). Real devices are remembered in a
 * local-only setting so the next ride can reconnect them; simulated ones
 * appear only while practice mode is on in Settings.
 */
import { getSetting, setSetting } from '../data/db';
import { attach, chooseDevice, knownDevice, type Driver } from './ble/web';
import { cmdSetTargetPower, cmdSimulation, cmdStart, type Range } from './ble/parse';
import { BUSY_WARNING, NO_CONTROL_WARNING, ROLLR_WARNING, rollrCheck, type Reading, type SensorKind, type SensorSnapshot, type SensorStatus } from './sources';
import { SimRider, type RiderNumbers } from './sim';

export interface SensorState extends SensorSnapshot {
  warning?: string;
  /** Trainers: the player holds control and can set resistance. */
  controllable?: boolean;
  powerRange?: Range;
  rollrSince?: number;
}

export interface SavedDevice { id: string; name: string; kind: SensorKind }

/** Local-only settings (see LOCAL_ONLY in devicesync.ts): devices belong to one computer. */
export const DEVICES_KEY = 'playerDevices';
export const SIM_KEY = 'playerSim';

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
  const patch: Partial<SensorState> = { reading };
  if (s.kind === 'trainer') {
    const c = rollrCheck(s.name, reading, s.rollrSince, reading.at);
    patch.rollrSince = c.since;
    if (c.warn) patch.warning = ROLLR_WARNING;
    else if (s.warning === ROLLR_WARNING) patch.warning = undefined;
  }
  update(id, patch, true);
}

async function saved(): Promise<SavedDevice[]> { return getSetting<SavedDevice[]>(DEVICES_KEY, []); }
async function remember(d: SavedDevice): Promise<void> {
  const list = (await saved()).filter((x) => x.kind !== d.kind && x.id !== d.id);
  await setSetting(DEVICES_KEY, [...list, d]);
}

function drop(id: string): void {
  drivers.get(id)?.dispose();
  drivers.delete(id);
  sensors = sensors.filter((s) => s.id !== id);
}

function start(device: BluetoothDevice, kind: SensorKind): void {
  const id = device.id;
  for (const s of sensors.filter((x) => x.kind === kind || x.id === id)) drop(s.id);
  sensors = [...sensors, { id, kind, name: device.name || KIND_FALLBACK[kind], status: 'connecting' }];
  emitNow();
  drivers.set(id, attach(device, kind, {
    reading: (r) => onReading(id, r),
    status: (status: SensorStatus) => update(id, status === 'connected' ? { status } : { status, reading: undefined }),
    control: (c) => update(id, {
      controllable: c.controllable,
      powerRange: c.powerRange,
      warning: c.controllable ? undefined : c.busy ? BUSY_WARNING : NO_CONTROL_WARNING,
    }),
  }));
}

const KIND_FALLBACK: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart-rate monitor', csc: 'Speed/cadence sensor' };

/** Opens the browser's chooser for one kind of sensor (call from a click) and connects what is picked. */
export async function addSensor(kind: SensorKind): Promise<'added' | 'cancelled'> {
  let device: BluetoothDevice;
  try { device = await chooseDevice(kind); } catch { return 'cancelled'; }
  await remember({ id: device.id, name: device.name || KIND_FALLBACK[kind], kind });
  start(device, kind);
  return 'added';
}

/**
 * Brings back the sensors this computer has used before. Where the browser can
 * reach a remembered device without asking, it reconnects on its own; where it
 * cannot, the row waits with a Connect button (one click opens the chooser).
 */
export async function restoreSaved(): Promise<void> {
  for (const d of await saved()) {
    if (sensors.some((s) => s.id === d.id || s.kind === d.kind)) continue;
    const device = await knownDevice(d.id);
    if (device) start(device, d.kind);
    else { sensors = [...sensors, { id: d.id, kind: d.kind, name: d.name, status: 'offline' }]; emitNow(); }
  }
}

/** Connect a remembered sensor that could not reconnect by itself. Call from a click. */
export async function reconnect(id: string): Promise<void> {
  const s = sensors.find((x) => x.id === id);
  if (!s) return;
  const device = await knownDevice(id);
  if (device) { start(device, s.kind); return; }
  await addSensor(s.kind);
}

/** Disconnect and forget a sensor on this computer. */
export async function forget(id: string): Promise<void> {
  const s = sensors.find((x) => x.id === id);
  drop(id);
  if (s?.simulated) stopSimIfIdle();
  await setSetting(DEVICES_KEY, (await saved()).filter((d) => d.id !== id));
  emitNow();
}

/** Every remembered device, for Settings (whether or not connected now). */
export async function savedDevices(): Promise<SavedDevice[]> { return saved(); }

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
