/**
 * The before-the-ride screen's device boxes (brief of 28 Oct): one box per
 * kind of device, shown when the rider has one or the ride lacks what it
 * gives. Trainer and heart rate always; a power meter when one is known or the
 * ride is by power and nothing measures power; a speed or cadence sensor when
 * one is known or nothing reports cadence (a trainer gives speed, but cadence
 * depends on the gear). The rest fold into one "Add another device" box. Pure,
 * so the rules are tested.
 */
import type { Metric, SensorKind, SensorSnapshot, SensorStatus, Supplied } from './sources';
import { suppliedBy } from './sources';

export type BoxState = 'empty' | 'click' | 'connecting' | 'lost' | 'connected';

export interface DeviceBox {
  kind: SensorKind;
  state: BoxState;
  sensor?: SensorSnapshot & { controllable?: boolean; warning?: string };
  /** For an empty box: why it is there. */
  reason?: string;
  /** For a connected box: the numbers this device is supplying to the ride now. */
  metrics: Metric[];
  /** A number the device reports that the ride takes from elsewhere. */
  unused?: string;
}

export interface DeviceBoxes {
  boxes: DeviceBox[];
  /** Kinds with no box of their own, offered by the one "Add another device" box. */
  more: SensorKind[];
  /** Remembered devices waiting for a click to connect. */
  waiting: number;
  connected: number;
}

const STATE: Record<SensorStatus, BoxState> = { offline: 'click', connecting: 'connecting', lost: 'lost', connected: 'connected' };

/** A device's name for display: Garmin broadcasts "EPIX PRO -". */
export function cleanName(name: string): string {
  return name.replace(/[\s\-–—_·:]+$/u, '').trim() || name.trim();
}

export function deviceBoxes(
  sensors: (SensorSnapshot & { controllable?: boolean; warning?: string })[],
  sources: Partial<Record<Metric, Supplied>>,
  basis?: 'power' | 'hr',
): DeviceBoxes {
  const of = (k: SensorKind) => sensors.find((s) => s.kind === k);
  const trainer = of('trainer');
  const trainerOn = trainer?.status === 'connected';
  const show: Record<SensorKind, boolean> = {
    trainer: true,
    hr: true,
    power: !!of('power') || (basis === 'power' && !sources.watts),
    csc: !!of('csc') || !sources.cadence,
  };
  const box = (kind: SensorKind): DeviceBox => {
    const s = of(kind);
    if (!s) {
      const reason = kind === 'trainer' ? 'It holds each target for you'
        : kind === 'hr' ? 'A strap, or your watch broadcasting heart rate'
        : kind === 'power' ? (basis === 'power' && !sources.watts ? 'Nothing connected measures power' : 'Optional if your trainer measures power')
        : trainerOn && !sources.cadence ? "Your trainer doesn't report cadence" : 'Optional: for cadence, if nothing else reports it';
      return { kind, state: 'empty', reason, metrics: [] };
    }
    const state = STATE[s.status];
    const metrics = state === 'connected' ? suppliedBy(s.id, sources) : [];
    let unused: string | undefined;
    if (state === 'connected' && s.reading?.watts != null && sources.watts && sources.watts.from !== s.id) unused = "Watts from your power meter are used";
    return { kind, state, sensor: s, metrics, unused };
  };
  const order: SensorKind[] = ['trainer', 'power', 'hr', 'csc'];
  const boxes = order.filter((k) => show[k]).map(box);
  return {
    boxes,
    more: order.filter((k) => !show[k]),
    waiting: boxes.filter((b) => b.state === 'click').length,
    connected: sensors.filter((s) => s.status === 'connected').length,
  };
}

/** The pill over the boxes: tied to whether the ride can start. */
export function pillFor(d: DeviceBoxes, ready: boolean): { ok: boolean; text: string } {
  if (ready) return { ok: true, text: 'All set' };
  if (d.waiting) return { ok: false, text: `${d.waiting} to connect` };
  if (!d.connected) return { ok: false, text: 'Nothing connected yet' };
  return { ok: false, text: 'Not ready yet' };
}

/** What waking a device takes, for the boxes waiting on it. */
export const WAKE: Record<SensorKind, string> = {
  trainer: 'Wake it first: pedal a few strokes',
  power: 'Wake it first: pedal a few strokes',
  csc: 'Wake it first: pedal a few strokes',
  hr: 'Turn on Broadcast heart rate on your watch, or put the strap on',
};

export const KIND_CAPTION: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart rate', csc: 'Speed or cadence sensor' };
export const KIND_NOUN: Record<SensorKind, string> = { trainer: 'smart trainer', power: 'power meter', hr: 'heart-rate monitor', csc: 'speed or cadence sensor' };
export const ADD_TITLE: Record<SensorKind, string> = { trainer: 'Add your smart trainer', power: 'Add a power meter', hr: 'Add heart rate', csc: 'Add a cadence sensor' };
