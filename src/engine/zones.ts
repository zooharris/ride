import type { Basis, Profile } from './types';

export interface Zone {
  n: number;           // 1..7
  name: string;
  low: number;         // fraction of threshold, inclusive
  high: number;        // fraction of threshold, exclusive (Infinity for the top)
}

/** Coggan power zones as fractions of FTP. */
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
 * Heart-rate zones as fractions of LTHR, after Friel, collapsed to the same
 * seven-zone ladder so a Zone 3 ride means the same thing on either basis.
 * HR cannot resolve Z6 and Z7 (the heart lags the legs), so those are
 * mapped onto the top of Z5 when a workout is rendered as HR.
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

export function zonesFor(basis: Basis): Zone[] {
  return basis === 'power' ? POWER_ZONES : HR_ZONES;
}

/** Zone number (1..7) for an intensity expressed as a fraction of FTP. */
export function powerZone(intensity: number): number {
  return zoneOf(POWER_ZONES, intensity);
}

export function hrZone(intensity: number): number {
  return zoneOf(HR_ZONES, intensity);
}

function zoneOf(zones: Zone[], intensity: number): number {
  for (const z of zones) if (intensity < z.high) return z.n;
  return 7;
}

/**
 * Convert a power-fraction intensity into the equivalent HR fraction, by zone
 * position. 88% FTP sits 0.87 of the way through power Z3, so it becomes 0.87 of
 * the way through HR Z3. This is how one workout renders correctly on either basis.
 */
export function powerToHrFraction(powerFraction: number): number {
  const pz = POWER_ZONES.find((z) => powerFraction < z.high) ?? POWER_ZONES[6];
  const hz = HR_ZONES[pz.n - 1];
  if (!isFinite(pz.high)) return Math.min(hz.low + 0.02, 1.12);
  const t = (powerFraction - pz.low) / (pz.high - pz.low);
  const hiHigh = isFinite(hz.high) ? hz.high : hz.low + 0.04;
  return round3(hz.low + t * (hiHigh - hz.low));
}

/**
 * The inverse, for scoring a ride by heart rate: a fraction of threshold heart
 * rate as the power fraction it costs. Piecewise linear through the zone
 * boundaries (HR Z2 starts at 82% and power Z2 at 55%, and so on), with
 * threshold meeting threshold: 88% of LTHR is a zone 2 ride, about 72% of
 * FTP; an hour at LTHR costs what an hour at FTP costs.
 */
const HR_TO_POWER: Array<[number, number]> = [[0, 0], [0.82, 0.55], [0.89, 0.75], [0.94, 0.90], [1.00, 1.00], [1.06, 1.20], [1.10, 1.50]];
export function hrToPowerFraction(hrFraction: number): number {
  const pts = HR_TO_POWER;
  if (hrFraction >= pts[pts.length - 1][0]) return round3(1.5 + (hrFraction - 1.10) * 2);
  for (let i = 1; i < pts.length; i++) {
    const [h0, p0] = pts[i - 1], [h1, p1] = pts[i];
    if (hrFraction < h1) return round3(p0 + ((hrFraction - h0) / (h1 - h0)) * (p1 - p0));
  }
  return 0;
}

/** Absolute zone boundaries for the profile, in watts or bpm. */
export function zoneTable(profile: Profile, basis: Basis): Array<{ zone: Zone; low: number; high: number | null }> {
  const threshold = basis === 'power' ? profile.ftp : profile.lthr;
  return zonesFor(basis).map((zone) => ({
    zone,
    low: Math.round(zone.low * threshold),
    high: isFinite(zone.high) ? Math.round(zone.high * threshold) - 1 : null,
  }));
}

export function wattsFor(profile: Profile, intensity: number): number {
  return Math.round(intensity * profile.ftp);
}

export function bpmFor(profile: Profile, powerIntensity: number): number {
  return Math.round(powerToHrFraction(powerIntensity) * profile.lthr);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
