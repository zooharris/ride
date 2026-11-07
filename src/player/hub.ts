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
import { isTymeHrName, packetLine, statusWords, type StrapCommand, type StrapReply, type StrapStatus } from './ble/breath';

export interface SensorState extends SensorSnapshot {
  warning?: string;
  /** Trainers: the player holds control and can set resistance. */
  controllable?: boolean;
  powerRange?: Range;
  rollrSince?: number;
  /** When it last became connected, ms: a breathing strap silent for 30 s after this says so. */
  connectedAt?: number;
  /** Breathing straps: battery, percent. */
  battery?: number;
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
  if (r.ve != null) strapState(id).lastBreathAt = reading.at;
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
const RANK: Record<SensorKind, number> = { trainer: 0, power: 1, hr: 2, csc: 3, breath: 4 };

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
 *
 * A Tymewear VitalPro is two Bluetooth devices: "TymeHR …", its heart-rate
 * sensor, and "TYME-…", its breathing sensor. Each connects on its own and
 * fills its own box. On 4 Nov an update wrongly filed the TymeHR as a breathing
 * strap, so picking it dropped the real one; it is a heart-rate monitor.
 */
export function migrateSaved(list: SavedDevice[]): SavedDevice[] {
  const byId = new Map<string, SavedDevice>();
  for (const d of list) {
    const kind: SensorKind = /\bKICKR\b/i.test(d.name) ? 'trainer' : isTymeHrName(d.name) ? 'hr' : d.kind;
    const old = byId.get(d.id);
    byId.set(d.id, old && RANK[old.kind] <= RANK[kind] ? old : { ...d, kind });
  }
  return [...byId.values()];
}

/** Learn what a device reports (once per number), so the boxes offer it where it can help. */
const learned = new Map<string, Set<Metric>>();
function learn(id: string, r: Omit<Reading, 'at'>): void {
  const seen = learned.get(id) ?? new Set<Metric>();
  const fresh = (['watts', 'cadence', 'speedKmh', 'bpm', 've', 'br', 'tv', 'ie'] as Metric[]).filter((m) => r[m] != null && !seen.has(m));
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
    status: (status: SensorStatus) => {
      update(id, status === 'connected' ? { status, connectedAt: Date.now() } : { status, reading: undefined });
      if (status === 'connected') { void touch(id); if (kind === 'breath') void strapConnected(id); }
    },
    raw: (bytes, from) => { if (from === 'cmd') return; const list = rawPackets.get(id) ?? []; list.push(packetLine(bytes)); if (list.length > 20) list.shift(); rawPackets.set(id, list); },
    battery: (pct) => update(id, { battery: pct }, true),
    strap: (r) => onStrapReply(id, r),
    motion: (clock) => onMotion(id, clock),
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

/** A breathing strap's last 20 packets as they came, for Copy details. */
const rawPackets = new Map<string, string[]>();

/** What Copy details puts on the clipboard: the strap's name, what its command channel last said, its health, the commands sent, and its last 20 packets. */
export function breathDetails(id: string, commands?: string[]): string {
  const s = sensors.find((x) => x.id === id);
  const list = rawPackets.get(id) ?? [];
  const st = strapState(id);
  const now = Date.now();
  const ago = (t?: number) => (t == null ? 'never' : `${Math.round((now - t) / 1000)} s ago`);
  return [
    `Breathing strap: ${s?.name ?? 'unknown'}`,
    `Status: ${s?.status ?? 'gone'}${s?.battery != null ? `, battery ${s.battery}%` : ''}`,
    `Strap status: ${st.status ? statusWords(st.status) : 'not yet asked'}`,
    `Minute beacon: ${st.beacon != null ? `#${st.beacon}, ${ago(st.beaconAt)}` : 'none yet'}`,
    `Last breath: ${ago(st.lastBreathAt)}. Motion clock: ${st.clock == null ? 'no motion frames' : `${st.clock}, last advanced ${ago(st.clockAt)}`}`,
    ...(st.lastWake ? [`Last wake: ${st.lastWake}`] : []),
    `Commands (newest last): ${(commands ?? st.log).length ? '' : 'none'}`,
    ...(commands ?? st.log),
    `Packets received: ${list.length ? `the last ${list.length}` : 'none'}`,
    ...list,
  ].join('\n');
}

// ── The breathing strap's commands and its recovery (4 Nov 2026) ─────────────
//
// From Todd's capture of the Tymewear app: the app starts a session on the strap when an activity starts, stops it
// and empties the strap's stored sessions when it ends. Antogo now does the same, and when a strap that has been
// breathing goes quiet, or its motion clock freezes (the 4 Nov stall), it climbs a ladder of remedies until breaths
// return. See "Antogo — brief: the strap's commands, and a self-healing connection (4 Nov)".

interface StrapState {
  status?: StrapStatus;
  beacon?: number; beaconAt?: number;
  lastBreathAt?: number;
  /** The motion frames' clock, when one last arrived, and when the clock last moved. */
  clock?: number; motionAt?: number; clockAt?: number;
  log: string[];
  waking?: boolean;
  lastWake?: string;
}
const straps = new Map<string, StrapState>();
function strapState(id: string): StrapState { let s = straps.get(id); if (!s) { s = { log: [] }; straps.set(id, s); } return s; }
function strapLog(id: string, line: string): void {
  const st = strapState(id);
  const stamped = `${new Date().toTimeString().slice(0, 8)} ${line}`;
  st.log.push(stamped);
  if (st.log.length > 30) st.log.shift();
  // The ride's whole log, from its start until the strap's stop sequence has finished (diagnostics brief, Part A, 7 Nov 2026).
  if (rideLogging) { const r = rideLogs.get(id) ?? []; r.push(stamped); rideLogs.set(id, r); }
}

/**
 * Diagnostics brief, Part A (7 Nov 2026): each strap's commands for the whole ride, so its details can be saved
 * with the recording when the ride ends (Copy details exists only while the player is open).
 */
const rideLogs = new Map<string, string[]>();
let rideLogging = false;
/** Breathing straps connected at any point in the ride (simulated ones too). */
const rideStraps = new Set<string>();
/** Command lines kept per strap in the saved details: the first 10 and the last 50. */
export const STRAP_LOG_HEAD = 10;
export const STRAP_LOG_TAIL = 50;
/** The saved details are cut to this many characters. */
export const STRAP_DETAILS_MAX = 4096;

/** Lines of a ride's log as saved: all of them, or the first and last with a count of those left out. */
export function trimRideLog(lines: string[]): string[] {
  if (lines.length <= STRAP_LOG_HEAD + STRAP_LOG_TAIL) return lines;
  return [...lines.slice(0, STRAP_LOG_HEAD), `  … ${lines.length - STRAP_LOG_HEAD - STRAP_LOG_TAIL} lines left out …`, ...lines.slice(-STRAP_LOG_TAIL)];
}

/** The details of every breathing strap used in the ride just ended, as Copy details gives them with the ride's whole command log; undefined with none. */
export function strapRideDetails(): string | undefined {
  for (const s of sensors) if (s.kind === 'breath' && s.status === 'connected') rideStraps.add(s.id);
  const ids = [...rideStraps];
  if (!ids.length) return undefined;
  const text = ids.map((id) => {
    const sim = sensors.find((x) => x.id === id)?.simulated;
    return breathDetails(id, trimRideLog(rideLogs.get(id) ?? [])) + (sim ? '\n(Simulated strap: no commands are sent to it.)' : '');
  }).join('\n\n');
  return text.length > STRAP_DETAILS_MAX ? `${text.slice(0, STRAP_DETAILS_MAX - 30)}\n… cut to fit …` : text;
}

function onStrapReply(id: string, r: StrapReply): void {
  const st = strapState(id);
  if (r.type === 'beacon') { st.beacon = r.counter; st.beaconAt = Date.now(); return; }
  if (r.status) st.status = r.status;
  strapLog(id, `← reply 0x${r.tag.toString(16).padStart(2, '0')}${r.status ? `: ${statusWords(r.status)}` : ''}${r.sessions ? `: ${r.sessions.length} stored session${r.sessions.length === 1 ? '' : 's'}` : ''}`);
}

function onMotion(id: string, clock: number): void {
  const st = strapState(id);
  const now = Date.now();
  if (st.clock !== clock) st.clockAt = now;
  st.clock = clock;
  st.motionAt = now;
}

/** A ride is under way: a strap that connects (or reconnects) has a session started on it. */
let strapRide = false;

async function send(id: string, cmd: StrapCommand): Promise<StrapReply | null> {
  const d = drivers.get(id)?.strap;
  if (!d) return null;
  strapLog(id, `→ ${cmd}`);
  const r = await d.send(cmd);
  if (!r) strapLog(id, `  (no reply to ${cmd})`);
  return r;
}

/** The Tymewear app's start sequence: status, start, status, apply, status. */
async function startSequence(id: string): Promise<void> {
  for (const c of ['status', 'start', 'status', 'apply', 'status'] as StrapCommand[]) await send(id, c);
}

/** The Tymewear app's stop sequence, then the strap's stored sessions erased (not fetched: Antogo has its own recording). */
async function stopSequence(id: string): Promise<void> {
  for (const c of ['status', 'stop', 'apply', 'status'] as StrapCommand[]) await send(id, c);
  const listed = await send(id, 'list');
  if (listed?.type === 'reply' && listed.sessions?.length) {
    await send(id, 'erase');
    const again = await send(id, 'list');
    // Once only: a strap that keeps its sessions is left alone and Copy details says so.
    if (again?.type === 'reply' && again.sessions?.length) strapLog(id, `  ${again.sessions.length} stored session(s) remain after erase; left alone`);
  }
  await send(id, 'status');
}

async function strapConnected(id: string): Promise<void> {
  if (rideLogging) rideStraps.add(id);
  strapLog(id, 'connected');
  await send(id, 'status');
  if (strapRide) await startSequence(id);
}

const realStraps = () => sensors.filter((s) => s.kind === 'breath' && s.status === 'connected' && !s.simulated);

/** A ride starts: a session is started on every connected strap, and on any strap that connects during the ride. */
export async function strapRideStart(): Promise<void> {
  strapRide = true;
  rideLogs.clear();
  rideStraps.clear();
  rideLogging = true;
  for (const s of sensors) if (s.kind === 'breath' && s.status === 'connected') rideStraps.add(s.id);
  for (const s of realStraps()) await startSequence(s.id);
}

/** A ride ends: the session is stopped and the strap's stored sessions erased. Resolves once every stop sequence has finished. */
export async function strapRideEnd(): Promise<void> {
  strapRide = false;
  try { for (const s of realStraps()) await stopSequence(s.id); } finally { rideLogging = false; }
}

/** A stall: 20 s without a breath from a strap that has breathed, or motion frames arriving with a clock frozen for 10 s. */
export const STALL_NO_BREATH_MS = 20_000;
export const STALL_FROZEN_CLOCK_MS = 10_000;
/** Each step of the ladder is given this long for breaths to return. */
export const WAKE_STEP_MS = 15_000;

/** Pure: is this strap stalled? `since` is when breathing was last expected (the last breath, or the ride's start). */
export function strapStalled(st: Pick<StrapState, 'lastBreathAt' | 'clock' | 'motionAt' | 'clockAt'>, now: number): boolean {
  const noBreath = st.lastBreathAt != null && now - st.lastBreathAt >= STALL_NO_BREATH_MS;
  const frozen = st.motionAt != null && now - st.motionAt < 5000 && st.clockAt != null && now - st.clockAt >= STALL_FROZEN_CLOCK_MS;
  return noBreath || frozen;
}

/** Whether the strap supplying breathing is stalled now (simulated straps by their readings alone). */
export function strapStalledNow(id: string, now = Date.now()): boolean {
  return strapStalled(strapState(id), now);
}

export type WakeStep = 'start' | 'stop-start' | 'resubscribe' | 'reconnect';
export const WAKE_WORDS: Record<WakeStep, string> = { start: 'session started again', 'stop-start': 'session stopped and started', resubscribe: 'notifications turned off and on', reconnect: 'disconnected and connected again' };

/**
 * The ladder: (a) the start sequence; (b) stop then start; (c) re-enable the notifications; (d) disconnect and
 * reconnect, then (a) again. Each step gets 15 s for breaths to return; it stops at the first that brings them back.
 * Returns the step that worked, or undefined when none did. One ladder at a time per strap.
 */
export async function wakeStrap(id: string, onStep?: (step: WakeStep) => void, stepMs = WAKE_STEP_MS): Promise<WakeStep | undefined> {
  const st = strapState(id);
  const d = drivers.get(id)?.strap;
  if (!d || st.waking) return undefined;
  st.waking = true;
  try {
    const breathedSince = (t: number) => (st.lastBreathAt ?? 0) > t;
    const wait = async (t0: number) => { const until = t0 + stepMs; while (Date.now() < until) { if (breathedSince(t0)) return true; await new Promise((r) => setTimeout(r, 500)); } return breathedSince(t0); };
    const steps: Array<[WakeStep, () => Promise<unknown>]> = [
      ['start', () => startSequence(id)],
      ['stop-start', async () => { await stopSequence(id); await startSequence(id); }],
      ['resubscribe', () => d.resubscribe()],
      // During a ride a reconnected strap has its session started as it connects; outside one, it is started here.
      ['reconnect', async () => { await d.reconnect(); if (!strapRide) await startSequence(id); }],
    ];
    for (const [step, run] of steps) {
      onStep?.(step);
      strapLog(id, `wake: ${WAKE_WORDS[step]}`);
      const t0 = Date.now();
      try { await run(); } catch { /* the next step tries harder */ }
      if (await wait(t0)) { st.lastWake = `${new Date().toTimeString().slice(0, 8)}, breathing back after: ${WAKE_WORDS[step]}`; strapLog(id, `wake: breathing back`); return step; }
    }
    st.lastWake = `${new Date().toTimeString().slice(0, 8)}, nothing brought breathing back`;
    return undefined;
  } finally { st.waking = false; }
}

/** Whether a ladder is running on this strap. */
export const strapWaking = (id: string): boolean => !!straps.get(id)?.waking;

const controlListeners = new Set<() => void>();
/**
 * Called each time a trainer (re)gains control: on first connecting and after
 * every dropout. A ride in progress uses it to give the trainer its target back,
 * since a trainer that lost the link has forgotten it.
 */
export function onTrainerControl(fn: () => void): () => void { controlListeners.add(fn); return () => { controlListeners.delete(fn); }; }

const KIND_FALLBACK: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart-rate monitor', csc: 'Speed/cadence sensor', breath: 'Breathing strap' };

/**
 * Opens the browser's list of devices nearby of one kind (call from a click)
 * and connects what is picked. Returns its id. A device already connected some
 * other way (a ROLLR picked again as a speed sensor) is not connected twice.
 */
export async function addSensor(kind: SensorKind): Promise<string | undefined> {
  let device: BluetoothDevice;
  try { device = await chooseDevice(kind); } catch { return undefined; }
  if (kind === 'breath' && isTymeHrName(device.name)) kind = 'hr';
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
  for (const m of ['watts', 'bpm', 'cadence', 'speedKmh', 've'] as Metric[]) {
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

const SIM_NAME: Record<SensorKind, string> = { trainer: 'Simulated trainer', power: 'Simulated power meter', hr: 'Simulated heart rate', csc: 'Simulated cadence sensor', breath: 'Simulated breathing strap' };

export function addSimulated(kind: SensorKind): void {
  const id = `sim-${kind}`;
  for (const s of sensors.filter((x) => x.kind === kind)) drop(s.id);
  sensors = [...sensors, { id, kind, name: SIM_NAME[kind], status: 'connected', simulated: true, connectedAt: Date.now(), controllable: kind === 'trainer' ? true : undefined, powerRange: kind === 'trainer' ? { min: 0, max: 2000, step: 1 } : undefined }];
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
    // A strap the screenshots and checks have silenced (no breath arriving): its last reading stays as it was.
    if (s.kind === 'breath' && (globalThis as { __antogoQuietStrap?: boolean }).__antogoQuietStrap) return s;
    const reading: Reading = s.kind === 'trainer' ? { watts: r.watts, cadence: r.cadence, speedKmh: r.speedKmh, at }
      : s.kind === 'power' ? { watts: r.watts, cadence: r.cadence, at }
      : s.kind === 'hr' ? { bpm: r.bpm, at }
      : s.kind === 'breath' ? (strapState(s.id).lastBreathAt = at, { ve: r.ve, br: r.br, tv: r.tv, ie: r.ie, at })
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
