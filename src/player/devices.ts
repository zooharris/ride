/**
 * The before-the-ride screen's device boxes (Todd, 28 Oct): a box for the
 * smart trainer and one for each number the ride measures (power, heart rate,
 * cadence, speed), each chosen separately. Clicking a box lists the devices
 * that can fill it: the one connected now, those this computer has used before
 * (with when), a way to find another nearby, and "None for this ride". One
 * device can fill several boxes (pedals give power and cadence). Pure, so the
 * rules are tested.
 */
import type { Metric, SensorKind, SensorSnapshot, Supplied } from './sources';

/** The boxes: the trainer, one per number, and (Step 3, 30 Oct) the breathing strap, filed under its ventilation. */
export type Slot = 'trainer' | 'watts' | 'bpm' | 'cadence' | 'speedKmh' | 've';
export const SLOTS: Slot[] = ['trainer', 'watts', 'bpm', 'cadence', 'speedKmh', 've'];

type Sensor = SensorSnapshot & { controllable?: boolean; warning?: string; battery?: number; connectedAt?: number };
export interface Known { id: string; name: string; kind: SensorKind; lastUsed?: string; reports?: Metric[] }

export interface SlotView {
  slot: Slot;
  /** connected: filled now; waiting: its device is connecting or reconnecting; off: the rider chose none; empty: nothing yet. */
  state: 'connected' | 'waiting' | 'off' | 'empty';
  /** The device filling it (or on its way). */
  device?: Sensor;
  value?: number;
  /** For an empty box: the device used for it most recently, as a reminder. */
  lastUsed?: string;
}

export interface Option {
  id: string;
  name: string;
  kind: SensorKind;
  /** Connected now (it shows its live reading) or used before (it shows when). */
  connected: boolean;
  selected: boolean;
  lastUsed?: string;
  simulated?: boolean;
}

/** A device's name for display: Garmin broadcasts "EPIX PRO -". */
export function cleanName(name: string): string {
  return name.replace(/[\s\-–—_·:]+$/u, '').trim() || name.trim();
}

/** What a remembered device can supply: what it has been seen to report, else what its kind usually does. */
export function reportsOf(d: Pick<Known, 'kind' | 'reports'>): Metric[] {
  if (d.reports?.length) return d.reports;
  return d.kind === 'trainer' ? ['speedKmh', 'watts'] : d.kind === 'power' ? ['watts', 'cadence'] : d.kind === 'hr' ? ['bpm'] : d.kind === 'breath' ? ['ve', 'br', 'tv', 'ie'] : ['cadence', 'speedKmh'];
}

/** Which kind of device the browser's list shows when finding one for a box. */
export const FIND_KIND: Record<Slot, SensorKind> = { trainer: 'trainer', watts: 'power', bpm: 'hr', cadence: 'csc', speedKmh: 'csc', ve: 'breath' };

const canFill = (slot: Slot, kind: SensorKind, reports: Metric[]) => (slot === 'trainer' ? kind === 'trainer' : reports.includes(slot));
const byRecent = (a: Known, b: Known) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '');

export function slotView(slot: Slot, sensors: Sensor[], known: Known[], sources: Partial<Record<Metric, Supplied>>, chosen: Partial<Record<Metric, string>>): SlotView {
  if (slot === 'trainer') {
    const t = sensors.find((s) => s.kind === 'trainer');
    if (t?.status === 'connected') return { slot, state: 'connected', device: t };
    if (t) return { slot, state: 'waiting', device: t };
    return { slot, state: 'empty', lastUsed: known.filter((d) => d.kind === 'trainer').sort(byRecent)[0]?.name };
  }
  const src = sources[slot];
  if (src) return { slot, state: 'connected', device: sensors.find((s) => s.id === src.from), value: src.value };
  if (chosen[slot] === 'none') return { slot, state: 'off' };
  // A strap is connected between breaths too, and while no breathing arrives at all (its box says so).
  if (slot === 've') {
    const strap = sensors.find((s) => s.kind === 'breath' && s.status === 'connected' && (!chosen.ve || chosen.ve === s.id));
    if (strap) return { slot, state: 'connected', device: strap };
  }
  const on = (s: Sensor) => s.id === chosen[slot] || (!chosen[slot] && canFill(slot, s.kind, reportsOf(known.find((k) => k.id === s.id) ?? s)));
  const coming = sensors.find((s) => s.status !== 'connected' && s.status !== 'offline' && on(s));
  if (coming) return { slot, state: 'waiting', device: coming };
  return { slot, state: 'empty', lastUsed: known.filter((d) => canFill(slot, d.kind, reportsOf(d))).sort(byRecent)[0]?.name };
}

/**
 * The list a box opens: devices connected now that can fill it, then devices
 * used before that can, most recent first. A device connected now and also
 * remembered appears once.
 */
export function optionsFor(slot: Slot, sensors: Sensor[], known: Known[], sources: Partial<Record<Metric, Supplied>>): Option[] {
  const live = sensors.filter((s) => s.status !== 'offline').filter((s) => {
    if (slot === 'trainer') return s.kind === 'trainer';
    const k = known.find((d) => d.id === s.id);
    return s.reading?.[slot] != null || canFill(slot, s.kind, reportsOf(k ?? s));
  });
  const selectedId = slot === 'trainer' ? sensors.find((s) => s.kind === 'trainer' && s.status === 'connected')?.id : sources[slot]?.from;
  const now: Option[] = live.map((s) => ({ id: s.id, name: cleanName(s.name), kind: s.kind, connected: true, selected: s.id === selectedId, simulated: s.simulated, lastUsed: known.find((d) => d.id === s.id)?.lastUsed }));
  const before: Option[] = known
    .filter((d) => !live.some((s) => s.id === d.id) && canFill(slot, d.kind, reportsOf(d)))
    .sort(byRecent)
    .map((d) => ({ id: d.id, name: cleanName(d.name), kind: d.kind, connected: false, selected: false, lastUsed: d.lastUsed }));
  return [...now, ...before];
}

/** The label at the top: tied to whether the ride can start. */
export function pillFor(sensors: Sensor[], ready: boolean): { ok: boolean; text: string } {
  if (ready) return { ok: true, text: 'All set' };
  if (!sensors.some((s) => s.status === 'connected')) return { ok: false, text: 'Nothing connected yet' };
  return { ok: false, text: 'Not ready yet' };
}

export const SLOT_CAPTION: Record<Slot, string> = { trainer: 'Smart trainer', watts: 'Power', bpm: 'Heart rate', cadence: 'Cadence', speedKmh: 'Speed', ve: 'Breathing strap' };
export const KIND_NOUN: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart-rate monitor', csc: 'Speed or cadence sensor', breath: 'Breathing strap' };
export const FIND_WORDS: Record<Slot, string> = {
  trainer: 'Find a smart trainer nearby…',
  watts: 'Find a power meter nearby…',
  bpm: 'Find another heart-rate monitor nearby…',
  cadence: 'Find a cadence sensor nearby…',
  speedKmh: 'Find a speed sensor nearby…',
  ve: 'Find a breathing strap nearby…',
};
/** The one line some lists carry: what makes the device appear. */
export const WAKE: Partial<Record<Slot, string>> = {
  bpm: 'Wake it first: put the strap on, or turn on Broadcast heart rate on your watch.',
  ve: 'Put the strap on and close the Tymewear app first: the strap connects to one app at a time.',
};
/** The breathing box, empty: it is never needed. */
export const BREATH_OPTIONAL = 'Optional. A Tymewear VitalPro; close the Tymewear app first.';
export const BREATH_QUIET = 'Connected, but no breathing is arriving. Check the strap is snug and that the Tymewear app is closed.';
