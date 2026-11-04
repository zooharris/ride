/**
 * Which connected sensor supplies each number, and the checks that turn raw
 * readings into plain warnings. Pure, so it is tested without Bluetooth.
 */

export type SensorKind = 'trainer' | 'power' | 'hr' | 'csc' | 'breath';
export type SensorStatus = 'connecting' | 'connected' | 'lost' | 'offline';

export interface Reading {
  watts?: number;
  cadence?: number;
  speedKmh?: number;
  bpm?: number;
  /** Breathing strap (Step 3, 30 Oct): ventilation L/min, breaths a minute, breath size L. */
  ve?: number;
  br?: number;
  tv?: number;
  /** Inhale time over exhale time. */
  ie?: number;
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

export type Metric = 'watts' | 'cadence' | 'speedKmh' | 'bpm' | 've' | 'br' | 'tv' | 'ie';

/** Most trustworthy source first. A power meter beats the trainer's own power; the trainer's speed beats a wheel sensor's (on rollers or a direct-drive trainer the trainer knows best). */
const PRIORITY: Record<Metric, SensorKind[]> = {
  watts: ['power', 'trainer'],
  cadence: ['power', 'csc', 'trainer'],
  speedKmh: ['trainer', 'csc'],
  bpm: ['hr', 'trainer'],
  ve: ['breath'],
  br: ['breath'],
  tv: ['breath'],
  ie: ['breath'],
};

export const BREATH_METRICS: Metric[] = ['ve', 'br', 'tv', 'ie'];

/** A reading older than this no longer counts as live. */
export const STALE_MS = 3000;
/** Breathing comes once a breath (every 2-4 s), so a pause in it is not a lost sensor. */
export const BREATH_STALE_MS = 15_000;
export const staleFor = (m: Metric) => (BREATH_METRICS.includes(m) ? BREATH_STALE_MS : STALE_MS);
/** A connected strap with no breath for this long shows "no breathing is arriving". */
export const BREATH_QUIET_MS = 30_000;

/** A breathing strap connected but silent for 30 seconds: the one state with a diagnostic. */
export function breathQuiet(s: Pick<SensorSnapshot, 'kind' | 'status' | 'reading'> & { connectedAt?: number }, now: number): boolean {
  if (s.kind !== 'breath' || s.status !== 'connected') return false;
  const since = s.reading?.ve != null ? s.reading.at : s.connectedAt;
  return since != null && now - since >= BREATH_QUIET_MS;
}

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
  const live = (x: SensorSnapshot, m: Metric) => x.status === 'connected' && !!x.reading && now - x.reading.at <= staleFor(m) && x.reading[m] != null;
  for (const m of Object.keys(PRIORITY) as Metric[]) {
    // The rider's choice for this number: none at all, or a particular device while it is supplying it. The breathing box chooses all three of its numbers.
    const ch = chosen[m] ?? (m === 'br' || m === 'tv' || m === 'ie' ? chosen.ve : undefined);
    if (ch === 'none') continue;
    const pick = ch ? sensors.find((x) => x.id === ch && live(x, m)) : undefined;
    if (pick) { out[m] = { value: pick.reading![m]!, from: pick.id, kind: pick.kind }; continue; }
    for (const kind of PRIORITY[m]) {
      const s = sensors.find((x) => x.kind === kind && live(x, m));
      if (s) { out[m] = { value: s.reading![m]!, from: s.id, kind }; break; }
    }
  }
  return out;
}

/** The numbers one sensor is supplying right now, for its row's second line. */
export function suppliedBy(id: string, sources: Partial<Record<Metric, Supplied>>): Metric[] {
  return (Object.keys(sources) as Metric[]).filter((m) => sources[m]!.from === id);
}

export const METRIC_WORD: Record<Metric, string> = { watts: 'power', cadence: 'cadence', speedKmh: 'speed', bpm: 'heart rate', ve: 'ventilation', br: 'breathing rate', tv: 'breath size', ie: 'inhale to exhale' };

export const KIND_WORD: Record<SensorKind, string> = { trainer: 'Smart trainer', power: 'Power meter', hr: 'Heart rate', csc: 'Speed or cadence sensor', breath: 'Breathing strap' };

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
