import type { Basis, Profile } from './types';

export interface Zone {
  n: number;           // 1..7
  name: string;
  low: number;         // fraction of threshold, inclusive
  high: number;        // fraction of threshold, exclusive (Infinity for the top)
}

/** Coggan power zones as fractions of FTP: the standard ladder, and the fallback when a rider has set none. */
export const POWER_ZONES: Zone[] = [
  { n: 1, name: 'Recovery',      low: 0,    high: 0.55 },
  { n: 2, name: 'Endurance',     low: 0.55, high: 0.75 },
  { n: 3, name: 'Tempo',         low: 0.75, high: 0.90 },
  { n: 4, name: 'Threshold',     low: 0.90, high: 1.05 },
  { n: 5, name: 'VO2max',        low: 1.05, high: 1.20 },
  { n: 6, name: 'Anaerobic',     low: 1.20, high: 1.50 },
  { n: 7, name: 'Neuromuscular', low: 1.50, high: Infinity },
];

/**
 * The standard heart-rate ladder as fractions of threshold heart rate, after
 * Friel, collapsed to the same seven-zone ladder so a Zone 3 ride means the
 * same thing on either basis. It is the starting point; a rider's own zone
 * tops (set in Settings, kept in step with Intervals.icu) replace it. HR cannot
 * resolve Z6 and Z7 (the heart lags the legs), so those are mapped onto the
 * top of Z5 when a workout is rendered as HR.
 */
export const HR_ZONES: Zone[] = [
  { n: 1, name: 'Recovery',      low: 0,    high: 0.82 },
  { n: 2, name: 'Endurance',     low: 0.82, high: 0.89 },
  { n: 3, name: 'Tempo',         low: 0.89, high: 0.94 },
  { n: 4, name: 'Threshold',     low: 0.94, high: 1.00 },
  { n: 5, name: 'VO2max',        low: 1.00, high: 1.06 },
  { n: 6, name: 'Anaerobic',     low: 1.06, high: 1.10 },
  { n: 7, name: 'Neuromuscular', low: 1.10, high: Infinity },
];

/**
 * How a rider enters a zone table: as shares of the threshold (the zones then
 * move when the threshold changes) or as absolute numbers (they stay put).
 */
export type ZoneMode = 'pct' | 'abs';

/** The standard ladder's zone tops in whole percent of threshold. */
export function defaultZonePcts(basis: Basis): number[] {
  return (basis === 'power' ? POWER_ZONES : HR_ZONES).slice(0, 6).map((z) => Math.round(z.high * 100));
}

/** The standard ladder's zone tops in beats per minute for a threshold: the seed for a rider's own table. */
export function defaultHrZoneTops(lthr: number): number[] {
  return HR_ZONES.slice(0, 6).map((z) => Math.round(z.high * lthr));
}

/** Six tops that go up, every one positive. */
export function validTops(tops?: number[]): tops is number[] {
  if (!tops || tops.length !== 6) return false;
  for (let i = 0; i < 6; i++) if (!(tops[i] > 0) || (i > 0 && tops[i] <= tops[i - 1])) return false;
  return true;
}

/** A ladder from the tops of zones 1..6 as fractions of threshold (zone 7 open at the top). */
export function ladderFromFractions(standard: Zone[], fractions: number[]): Zone[] {
  return standard.map((z, i) => ({
    ...z,
    low: i === 0 ? 0 : round3(fractions[i - 1]),
    high: i < 6 ? round3(fractions[i]) : Infinity,
  }));
}

/**
 * The zone ladder a rider's settings describe, for one table. In percent mode
 * the shares are used as they are; in absolute mode the tops are divided by the
 * threshold. Anything missing or out of order falls back to the standard ladder,
 * so a half-filled table never produces nonsense.
 */
export function ladderFor(standard: Zone[], threshold: number, mode: ZoneMode | undefined, pcts: number[] | undefined, tops: number[] | undefined): Zone[] {
  if (mode === 'pct' && validTops(pcts)) return ladderFromFractions(standard, pcts.map((p) => p / 100));
  if (mode !== 'pct' && validTops(tops) && threshold > 0) return ladderFromFractions(standard, tops.map((t) => t / threshold));
  // the other representation, if that is the one that is filled in
  if (validTops(pcts)) return ladderFromFractions(standard, pcts.map((p) => p / 100));
  if (validTops(tops) && threshold > 0) return ladderFromFractions(standard, tops.map((t) => t / threshold));
  return standard;
}

/** The zone tops of a ladder in the threshold's unit (watts or bpm), rounded. */
export function ladderTops(zones: Zone[], threshold: number): number[] {
  return zones.slice(0, 6).map((z) => Math.round(z.high * threshold));
}

/** The zone tops of a ladder in whole percent of threshold. */
export function ladderPcts(zones: Zone[]): number[] {
  return zones.slice(0, 6).map((z) => Math.round(z.high * 100));
}

// ---- the rider's three tables ------------------------------------------------

type PowerFields = Pick<Profile, 'ftp' | 'powerZoneMode' | 'powerZonePcts' | 'powerZoneWatts'>;
type RideHrFields = Pick<Profile, 'lthr' | 'hrZoneMode' | 'hrZonePcts' | 'hrZoneTops'>;
type FootHrFields = Pick<Profile, 'lthr' | 'footLthr' | 'footHrZoneMode' | 'footHrZonePcts' | 'footHrZoneTops'>;

/** Power ladder for riding: the rider's own table over their FTP. */
export function ridePowerZones(p: PowerFields): Zone[] {
  return ladderFor(POWER_ZONES, p.ftp, p.powerZoneMode, p.powerZonePcts, p.powerZoneWatts);
}

/** Heart-rate ladder for riding: the rider's own table over their cycling threshold. */
export function rideHrZones(p: RideHrFields): Zone[] {
  return ladderFor(HR_ZONES, p.lthr, p.hrZoneMode, p.hrZonePcts, p.hrZoneTops);
}

/** Threshold heart rate on foot (runs and walks): its own number when set, else the bike's. */
export function footLthr(p: Pick<Profile, 'lthr' | 'footLthr'>): number {
  return p.footLthr && p.footLthr > 0 ? p.footLthr : p.lthr;
}

/** Heart-rate ladder on foot: the rider's foot table over their foot threshold. */
export function footHrZones(p: FootHrFields): Zone[] {
  return ladderFor(HR_ZONES, footLthr(p), p.footHrZoneMode, p.footHrZonePcts, p.footHrZoneTops);
}

/** Both ladders a ride is judged on. */
export interface Ladders { hr: Zone[]; power: Zone[] }
export function rideLadders(p: PowerFields & RideHrFields): Ladders {
  return { hr: rideHrZones(p), power: ridePowerZones(p) };
}

export function zonesFor(basis: Basis, hr: Zone[] = HR_ZONES, power: Zone[] = POWER_ZONES): Zone[] {
  return basis === 'power' ? power : hr;
}

/** Zone number (1..7) for an intensity expressed as a fraction of FTP, on the given ladder. */
export function powerZone(intensity: number, zones: Zone[] = POWER_ZONES): number {
  return zoneOf(zones, intensity);
}

/** Zone number (1..7) for a heart rate expressed as a fraction of threshold, on the given ladder. */
export function hrZone(intensity: number, zones: Zone[] = HR_ZONES): number {
  return zoneOf(zones, intensity);
}

function zoneOf(zones: Zone[], intensity: number): number {
  for (const z of zones) if (intensity < z.high) return z.n;
  return 7;
}

/**
 * Where an intensity sits on a ladder, as a continuous zone position: 2.0 is
 * the bottom of zone 2, 2.5 its middle, 3.0 its top (the bottom of zone 3).
 * The inverse turns a position back into a fraction of threshold. Positions are
 * how one band is carried between ladders (power to heart rate, and the foot
 * table's bands): the same place inside the same zone.
 */
export function zonePosition(fraction: number, zones: Zone[]): number {
  const z = zones.find((x) => fraction < x.high) ?? zones[6];
  const span = isFinite(z.high) ? z.high - z.low : 0.5;
  return z.n + Math.max(0, Math.min(1, (fraction - z.low) / span));
}

export function fractionAt(position: number, zones: Zone[]): number {
  const n = Math.max(1, Math.min(7, Math.floor(position)));
  const z = zones[n - 1];
  const t = Math.max(0, Math.min(1, position - n));
  const high = isFinite(z.high) ? z.high : z.low + 0.5;
  return round3(z.low + t * (high - z.low));
}

/**
 * Convert a power-fraction intensity into the equivalent HR fraction, by zone
 * position: 88% FTP sits 0.87 of the way through power Z3, so it becomes 0.87
 * of the way through HR Z3. This is how one workout renders correctly on either
 * basis. HR cannot resolve the top zones, so power Z6 and Z7 land just above
 * the top of HR Z5 and Z6.
 */
export function powerToHrFraction(powerFraction: number, hr: Zone[] = HR_ZONES, power: Zone[] = POWER_ZONES): number {
  const pz = power.find((z) => powerFraction < z.high) ?? power[6];
  const hz = hr[pz.n - 1];
  const cap = hr[5].high + 0.02;
  if (!isFinite(pz.high)) return Math.min(hz.low + 0.02, cap);
  const t = (powerFraction - pz.low) / (pz.high - pz.low);
  const hiHigh = isFinite(hz.high) ? hz.high : hz.low + 0.04;
  return round3(hz.low + t * (hiHigh - hz.low));
}

/**
 * The inverse, for scoring a ride by heart rate: a fraction of threshold heart
 * rate as the power fraction it costs. Piecewise linear through the zone
 * boundaries (on the standard ladders HR Z2 starts at 82% and power Z2 at 55%,
 * and so on), with threshold meeting threshold: an hour at LTHR costs what an
 * hour at FTP costs, whatever the rider's zone tops are.
 */
export function hrToPowerFraction(hrFraction: number, hr: Zone[] = HR_ZONES, power: Zone[] = POWER_ZONES): number {
  const pts = hrToPowerPoints(hr, power);
  const [hTop, pTop] = pts[pts.length - 1];
  if (hrFraction >= hTop) return round3(pTop + (hrFraction - hTop) * 2);
  for (let i = 1; i < pts.length; i++) {
    const [h0, p0] = pts[i - 1], [h1, p1] = pts[i];
    if (hrFraction < h1) return round3(p0 + ((hrFraction - h0) / (h1 - h0)) * (p1 - p0));
  }
  return 0;
}

function hrToPowerPoints(hr: Zone[], power: Zone[]): Array<[number, number]> {
  // Z1..Z3 tops meet the power tops; threshold meets threshold; Z5 and Z6 tops meet the power Z5 and Z6 tops.
  const pts: Array<[number, number]> = [[0, 0], [hr[0].high, power[0].high], [hr[1].high, power[1].high], [hr[2].high, power[2].high], [1, 1], [hr[4].high, power[4].high], [hr[5].high, power[5].high]];
  if (hr[3].high > 1) pts.push([hr[3].high, Math.max(1, power[3].high)]);
  pts.sort((a, b) => a[0] - b[0]);
  // keep the mapping monotonic whatever the rider's tops are
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
  return pts;
}

export interface ZoneRow { zone: Zone; low: number; high: number | null }

/** Absolute zone boundaries of a ladder for a threshold, in that threshold's unit. */
export function tableOf(zones: Zone[], threshold: number): ZoneRow[] {
  return zones.map((zone) => ({
    zone,
    low: Math.round(zone.low * threshold),
    high: isFinite(zone.high) ? Math.round(zone.high * threshold) - 1 : null,
  }));
}

/** Absolute zone boundaries for the profile, in watts or bpm (riding). */
export function zoneTable(profile: Profile, basis: Basis): ZoneRow[] {
  return basis === 'power' ? tableOf(ridePowerZones(profile), profile.ftp) : tableOf(rideHrZones(profile), profile.lthr);
}

/** Absolute heart-rate zone boundaries on foot, in bpm. */
export function footZoneTable(profile: Profile): ZoneRow[] {
  return tableOf(footHrZones(profile), footLthr(profile));
}

export function wattsFor(profile: Profile, intensity: number): number {
  return Math.round(intensity * profile.ftp);
}

export function bpmFor(profile: Profile, powerIntensity: number): number {
  return Math.round(powerToHrFraction(powerIntensity, rideHrZones(profile), ridePowerZones(profile)) * profile.lthr);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
