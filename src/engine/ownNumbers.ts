import type { Ride } from './types';
import type { Zone } from './zones';
import { powerZone } from './zones';

/**
 * Stage 1 (22 Nov 2026): Antogo works out an activity's numbers from its own recording, for every rider and every
 * activity that has one, however it arrived. The methods are the field's standard ones, said here so they can be
 * checked: normalized power from a 30-second rolling average to the fourth power; intensity as normalized power over
 * the FTP of the day; heart-rate drift as power per heartbeat in the second half against the first; efficiency as
 * normalized power per heartbeat; work as power times time. Pauses (gaps of more than 5 seconds) are not counted;
 * coasting (zero power) is, as a ride's real cost.
 */
export const OWN_VERSION = 1;

/** The numbers Antogo works out. Only those the recording can give are present. */
export type OwnNumbers = Partial<Pick<Ride,
  'normalizedPower' | 'averagePower' | 'intensityFactor' | 'variabilityIndex' | 'workKj' | 'workAboveFtpKj' | 'averageHr' | 'maxHr' |
  'efficiencyFactor' | 'decoupling' | 'averageCadence' | 'coastingSeconds' | 'maxSpeedMs' | 'powerZoneSeconds' | 'hrZoneSeconds' |
  'sweetSpotSeconds' | 'calories' | 'carbsUsedG' | 'averageTempC' | 'elevationM' | 'elevationLossM'>> & { carbsEstimated?: boolean };

export interface OwnInput {
  time: number[];
  watts?: Array<number | null>; heartrate?: Array<number | null>; cadence?: Array<number | null>; velocity?: Array<number | null>;
  altitude?: Array<number | null>; temp?: Array<number | null>;
}
export interface OwnContext {
  sport: Ride['sport'];
  /** FTP of the day of the activity (0 when not known). */
  ftp: number;
  /** Threshold heart rate for this kind of activity (0 when not known). */
  lthr: number;
  powerZones: Zone[];
  hrZones: Zone[];
  /** What the activity already says, so a figure only it can give is not replaced by a weaker estimate. */
  has: Pick<Ride, 'calories' | 'carbsUsedG' | 'elevationM' | 'elevationLossM'>;
}

const ok = (x: number | null | undefined): x is number => x != null && isFinite(x);
/** Longest gap that still counts as riding, seconds; longer is a pause. */
export const PAUSE_S = 5;

/** The recording on a one-second grid, with gaps of more than 5 seconds left as pauses. */
export function perSecond(time: number[], v: Array<number | null> | undefined): Array<number | undefined> {
  if (!v?.length || time.length < 2) return [];
  const t0 = time[0];
  const span = Math.round(time[time.length - 1] - t0);
  const out: Array<number | undefined> = new Array(span + 1).fill(undefined);
  for (let i = 0; i < time.length; i++) {
    const x = v[i];
    if (!ok(x)) continue;
    const at = Math.round(time[i] - t0);
    out[at] = x;
    // Fill forward over short gaps (smart recording), never over a pause.
    const next = i + 1 < time.length ? Math.round(time[i + 1] - t0) : at + 1;
    if (next - at > 1 && next - at <= PAUSE_S) for (let k = at + 1; k < next; k++) out[k] = x;
  }
  return out;
}

const mean = (xs: Array<number | undefined>) => { let s = 0, n = 0; for (const x of xs) if (x != null) { s += x; n++; } return n ? s / n : undefined; };

/** Normalized power: the fourth-power mean of the 30-second rolling average, from the 30th second on. */
export function normalizedPower(w: Array<number | undefined>): number | undefined {
  let sum = 0, n = 0, win = 0, cnt = 0, q4 = 0, k = 0;
  const buf: Array<number | undefined> = [];
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    buf.push(x); if (x != null) { win += x; cnt++; }
    if (buf.length > 30) { const y = buf.shift(); if (y != null) { win -= y; cnt--; } }
    if (buf.length === 30 && cnt >= 15 && x != null) { const r = win / cnt; q4 += r ** 4; k++; }
    if (x != null) { sum += x; n++; }
  }
  void sum; void n;
  return k ? (q4 / k) ** 0.25 : undefined;
}

export function ownNumbers(s: OwnInput, ctx: OwnContext): OwnNumbers {
  const out: OwnNumbers = {};
  const W = perSecond(s.time, s.watts), H = perSecond(s.time, s.heartrate), C = perSecond(s.time, s.cadence), V = perSecond(s.time, s.velocity);
  const hasW = W.some((x) => x != null && x > 0), hasH = H.some((x) => x != null && x > 0);
  const ride = ctx.sport === 'ride';
  if (hasW && ride) {
    const np = normalizedPower(W);
    const avg = mean(W);
    if (np) out.normalizedPower = Math.round(np);
    if (avg != null) out.averagePower = Math.round(avg);
    if (np && ctx.ftp) out.intensityFactor = Math.round((np / ctx.ftp) * 100) / 100;
    if (np && avg) out.variabilityIndex = Math.round((np / avg) * 100) / 100;
    let work = 0, above = 0;
    for (const x of W) if (x != null) { work += x; if (ctx.ftp && x > ctx.ftp) above += x - ctx.ftp; }
    out.workKj = Math.round(work / 100) / 10;
    if (ctx.ftp) out.workAboveFtpKj = Math.round(above / 100) / 10;
    if (ctx.ftp) {
      out.powerZoneSeconds = zoneSeconds(W, ctx.ftp, ctx.powerZones);
      let ss = 0; for (const x of W) if (x != null && x >= 0.84 * ctx.ftp && x < 0.97 * ctx.ftp) ss++;
      out.sweetSpotSeconds = ss;
    }
    // Energy burned: pedalling is about a quarter efficient, so kilojoules of work come out at about the same number of kilocalories.
    out.calories = Math.round(work / 1000);
    if (!ctx.has.carbsUsedG && ctx.ftp && np) {
      // Carbohydrate's share of the energy rises with intensity: a fifth at an easy pace, nearly all of it at threshold.
      const share = Math.max(0.2, Math.min(0.95, 0.2 + 1.5 * (np / ctx.ftp - 0.5)));
      out.carbsUsedG = Math.round(((work / 1000) * share) / 4);
      out.carbsEstimated = true;
    }
  }
  if (hasH) {
    const avg = mean(H.map((x) => (x != null && x > 0 ? x : undefined)));
    if (avg != null) out.averageHr = Math.round(avg);
    let mx = 0; for (const x of H) if (x != null && x > mx) mx = x;
    if (mx) out.maxHr = Math.round(mx);
    if (ctx.lthr) out.hrZoneSeconds = zoneSeconds(H, ctx.lthr, ctx.hrZones);
    if (hasW && ride && out.normalizedPower && avg) out.efficiencyFactor = Math.round((out.normalizedPower / avg) * 100) / 100;
    if (hasW && ride) {
      // Power per heartbeat in each half of the time ridden: the drift is how much the second half falls behind.
      const idx = W.map((x, i) => (x != null && H[i] != null && H[i]! > 0 ? i : -1)).filter((i) => i >= 0);
      if (idx.length >= 1200) {
        const half = Math.floor(idx.length / 2);
        const ratio = (ix: number[]) => { let p = 0, h = 0; for (const i of ix) { p += W[i]!; h += H[i]!; } return h ? p / h : 0; };
        const a = ratio(idx.slice(0, half)), b = ratio(idx.slice(half));
        if (a > 0) out.decoupling = Math.round(((a - b) / a) * 1000) / 10;
      }
    }
  }
  if (C.some((x) => x != null && x > 0)) {
    const pedal = C.filter((x): x is number => x != null && x > 0);
    out.averageCadence = Math.round(pedal.reduce((a, b) => a + b, 0) / pedal.length);
    if (ride) {
      let coast = 0;
      for (let i = 0; i < C.length; i++) if (C[i] === 0 && (V[i] == null ? W[i] === 0 || W[i] == null : V[i]! > 1)) coast++;
      out.coastingSeconds = coast;
    }
  }
  if (V.some((x) => x != null && x > 0)) {
    // Top speed over 3 seconds, so a single bad GPS fix is not a record.
    let best = 0;
    for (let i = 2; i < V.length; i++) { if (V[i] == null || V[i - 1] == null || V[i - 2] == null) continue; const m = (V[i]! + V[i - 1]! + V[i - 2]!) / 3; if (m > best) best = m; }
    if (best) out.maxSpeedMs = Math.round(best * 100) / 100;
  }
  const T = (s.temp ?? []).filter(ok);
  if (T.length) out.averageTempC = Math.round((T.reduce((a, b) => a + b, 0) / T.length) * 10) / 10;
  // Height gained and lost, only when the activity doesn't already have the device's own figure.
  if (s.altitude?.some(ok) && (ctx.has.elevationM == null || ctx.has.elevationLossM == null)) {
    const alt = s.altitude.filter(ok);
    if (ctx.has.elevationM == null) out.elevationM = Math.round(climbOf(alt));
    if (ctx.has.elevationLossM == null) out.elevationLossM = Math.round(climbOf(alt.map((x) => -x)));
  }
  return out;
}

/** Seconds in each zone, the ladder's fractions times the threshold. */
function zoneSeconds(v: Array<number | undefined>, threshold: number, zones: Zone[]): number[] {
  const out = zones.map(() => 0);
  for (const x of v) { if (x == null) continue; out[Math.min(out.length, Math.max(1, powerZone(x / threshold, zones))) - 1]++; }
  return out;
}

/** Height gained, counting a rise once it passes a metre, so the altitude's noise is not climbing. */
export function climbOf(alt: number[]): number {
  let total = 0, base: number | undefined, top: number | undefined;
  for (const x of alt) {
    if (base == null) { base = x; top = x; continue; }
    if (x > top!) top = x;
    if (top! - x >= 1 || x < base) { if (top! - base >= 1) total += top! - base; base = x; top = x; }
  }
  if (base != null && top != null && top - base >= 1) total += top - base;
  return total;
}

/** An activity with Antogo's numbers laid over what it came with. Fields Antogo can't work out are kept as they came. */
export function withOwn(r: Ride, own: OwnNumbers | undefined): Ride {
  if (!own) return r;
  const { carbsEstimated: _c, ...nums } = own;
  return { ...r, ...nums, ...(own.carbsEstimated ? { carbsEstimated: true } : {}), ownNumbers: true } as Ride;
}
