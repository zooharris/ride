/**
 * Which connected sensor supplies each number, and the checks that turn raw
 * readings into plain warnings. Pure, so it is tested without Bluetooth.
 */

export type SensorKind = 'trainer' | 'power' | 'hr' | 'csc';
export type SensorStatus = 'connecting' | 'connected' | 'lost' | 'offline';

export interface Reading {
  watts?: number;
  cadence?: number;
  speedKmh?: number;
  bpm?: number;
  /** When this reading arrived, ms. */
  at: number;
}

export interface SensorSnapshot {
  id: string;
  kind: SensorKind;
  name: string;
  status: SensorStatus;
  simulated?: boolean;
  reading?: Reading;
}

export type Metric = 'watts' | 'cadence' | 'speedKmh' | 'bpm';

/** Most trustworthy source first. A power meter beats the trainer's own power; the trainer's speed beats a wheel sensor's (on rollers or a direct-drive trainer the trainer knows best). */
const PRIORITY: Record<Metric, SensorKind[]> = {
  watts: ['power', 'trainer'],
  cadence: ['power', 'csc', 'trainer'],
  speedKmh: ['trainer', 'csc'],
  bpm: ['hr', 'trainer'],
};

/** A reading older than this no longer counts as live. */
export const STALE_MS = 3000;

export interface Supplied { value: number; from: string; kind: SensorKind }

/**
 * The value of each number and the sensor it comes from. The rider's choice in
 * the device boxes comes first (`chosen`). Otherwise a sensor supplies a
 * number when it is connected, its reading is fresh and it reports that
 * number at all; the first such sensor in priority order wins. A zero is a
 * real value (stopped pedalling); an absent field is not.
 */
export function pickSources(sensors: SensorSnapshot[], now: number, chosen: Partial<Record<Metric, string>> = {}): Partial<Record<Metric, Supplied>> {
  const out: Partial<Record<Metric, Supplied>> = {};
  const live = (x: SensorSnapshot, m: Metric) => x.status === 'connected' && !!x.reading && now - x.reading.at <= STALE_MS && x.reading[m] != null;
  for (const m of Object.keys(PRIORITY) as Metric[]) {
    // The rider's choice for this number: none at all, or a particular device while it is supplying it.
    if (chosen[m] === 'none') continue;
    const pick = chosen[m] ? sensors.find((x) => x.id === chosen[m] && live(x, m)) : undefined;
    if (pick) { out[m] = { value: pick.reading![m]!, from: pick.id, kind: pick.kind }; continue; }
    for (const kind of PRIORITY[m]) {
      const s = sensors.find((x) => x.kind === kind && x.status === 'connected' && x.reading && now - x.reading.at <= STALE_MS && x.reading[m] != null);
      if (s) { out[m] = { value: s.reading![m]!, from: s.id, kind }; break; }
    }
  }
  return out;
}

/** The numbers one sensor is supplying right now, for its row's second line. */
export function suppliedBy(id: string, sources: Partial<Record<Metric, Supplied>>): Metric[] {
  return (Object.keys(sources) as Metric[]).filter((m) => sources[m]!.from === id);
}

export const METRIC_WORD: Record<Metric, string> = { watts: 'power', cadence: 'cadence', speedKmh: 'speed', bpm: 'heart rate' };

export const KIND_WORD: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart rate', csc: 'Speed or cadence sensor' };

/**
 * A KICKR ROLLR has no power meter of its own: it borrows the bike's, once the
 * two are linked in the Wahoo app. Unlinked, it reports speed but no power.
 * Pedalling (over 3 km/h) with no power for ten seconds means it is not linked.
 * `since` is when the condition began; the caller keeps it between readings.
 */
export function rollrCheck(name: string, r: Reading | undefined, since: number | undefined, now: number): { since?: number; warn: boolean } {
  if (!/rollr/i.test(name) || !r) return { warn: false };
  const pedalling = (r.speedKmh ?? 0) > 3;
  const noPower = !r.watts;
  if (!(pedalling && noPower)) return { warn: false };
  const start = since ?? now;
  return { since: start, warn: now - start >= 10_000 };
}

export const ROLLR_WARNING = "Your KICKR ROLLR isn't linked to a power meter. Pair it once in the Wahoo app (Power Meter Connect), then reconnect here.";
export const BUSY_WARNING = 'Another app (Zwift, Wahoo, TrainerRoad) is connected to your trainer. Close it and connect again.';
export const NO_CONTROL_WARNING = "This trainer doesn't accept control from the browser. It still supplies its numbers, and you can ride with your gears.";
