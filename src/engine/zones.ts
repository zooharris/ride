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
 * The standard heart-rate ladder as fractions of threshold heart rate, after
 * Friel, collapsed to the same seven-zone ladder so a Zone 3 ride means the
 * same thing on either basis. It is the starting point; a rider's own zone
 * tops (set in Settings, kept in step with Intervals.icu) replace it through
 * `hrLadder`. HR cannot resolve Z6 and Z7 (the heart lags the legs), so those
 * are mapped onto the top of Z5 when a workout is rendered as HR.
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

/** The standard ladder's zone tops in beats per minute for a threshold: the seed for a rider's own table. */
export function defaultHrZoneTops(lthr: number): number[] {
  return HR_ZONES.slice(0, 6).map((z) => Math.round(z.high * lthr));
}

/**
 * A heart-rate ladder from a rider's own zone tops (the top of Z1..Z6 in bpm;
 * Z7 runs to max). Tops that are missing, too few, or not increasing fall back
 * to the standard ladder, so a half-filled table never produces nonsense.
 */
export function hrLadder(lthr: number, tops?: number[]): Zone[] {
  if (!validTops(tops) || !(lthr > 0)) return HR_ZONES;
  return HR_ZONES.map((z, i) => ({
    ...z,
    low: i === 0 ? 0 : round3(tops![i - 1] / lthr),
    high: i < 6 ? round3(tops![i] / lthr) : Infinity,
  }));
}

export function validTops(tops?: number[]): tops is number[] {
  if (!tops || tops.length !== 6) return false;
  for (let i = 0; i < 6; i++) if (!(tops[i] > 0) || (i > 0 && tops[i] <= tops[i - 1])) return false;
  return true;
}

/** Heart-rate ladder for riding: the rider's own tops over their cycling threshold. */
export function rideHrZones(profile: Pick<Profile, 'lthr' | 'hrZoneTops'>): Zone[] {
  return hrLadder(profile.lthr, profile.hrZoneTops);
}

/** Threshold heart rate on foot (runs and walks): its own number when set, else the bike's. */
export function footLthr(profile: Pick<Profile, 'lthr' | 'footLthr'>): number {
  return profile.footLthr && profile.footLthr > 0 ? profile.footLthr : profile.lthr;
}

/** Heart-rate ladder on foot: the rider's foot tops over their foot threshold. */
export function footHrZones(profile: Pick<Profile, 'lthr' | 'footLthr' | 'footHrZoneTops'>): Zone[] {
  return hrLadder(footLthr(profile), profile.footHrZoneTops);
}

export function zonesFor(basis: Basis, hr: Zone[] = HR_ZONES): Zone[] {
  return basis === 'power' ? POWER_ZONES : hr;
}

/** Zone number (1..7) for an intensity expressed as a fraction of FTP. */
export function powerZone(intensity: number): number {
  return zoneOf(POWER_ZONES, intensity);
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
 * Convert a power-fraction intensity into the equivalent HR fraction, by zone
 * position. 88% FTP sits 0.87 of the way through power Z3, so it becomes 0.87 of
 * the way through HR Z3. This is how one workout renders correctly on either basis.
 */
export function powerToHrFraction(powerFraction: number, zones: Zone[] = HR_ZONES): number {
  const pz = POWER_ZONES.find((z) => powerFraction < z.high) ?? POWER_ZONES[6];
  const hz = zones[pz.n - 1];
  const cap = zones[5].high + 0.02;
  if (!isFinite(pz.high)) return Math.min(hz.low + 0.02, cap);
  const t = (powerFraction - pz.low) / (pz.high - pz.low);
  const hiHigh = isFinite(hz.high) ? hz.high : hz.low + 0.04;
  return round3(hz.low + t * (hiHigh - hz.low));
}

/**
 * The inverse, for scoring a ride by heart rate: a fraction of threshold heart
 * rate as the power fraction it costs. Piecewise linear through the zone
 * boundaries (on the standard ladder HR Z2 starts at 82% and power Z2 at 55%,
 * and so on), with threshold meeting threshold: an hour at LTHR costs what an
 * hour at FTP costs, whatever the rider's zone tops are.
 */
export function hrToPowerFraction(hrFraction: number, zones: Zone[] = HR_ZONES): number {
  const pts = hrToPowerPoints(zones);
  const [hTop, pTop] = pts[pts.length - 1];
  if (hrFraction >= hTop) return round3(pTop + (hrFraction - hTop) * 2);
  for (let i = 1; i < pts.length; i++) {
    const [h0, p0] = pts[i - 1], [h1, p1] = pts[i];
    if (hrFraction < h1) return round3(p0 + ((hrFraction - h0) / (h1 - h0)) * (p1 - p0));
  }
  return 0;
}

function hrToPowerPoints(zones: Zone[]): Array<[number, number]> {
  // Z1..Z3 tops meet the power tops; threshold meets threshold; Z5 and Z6 tops meet 120% and 150%.
  const pts: Array<[number, number]> = [[0, 0], [zones[0].high, 0.55], [zones[1].high, 0.75], [zones[2].high, 0.90], [1, 1], [zones[4].high, 1.20], [zones[5].high, 1.50]];
  if (zones[3].high > 1) pts.push([zones[3].high, 1.05]);
  pts.sort((a, b) => a[0] - b[0]);
  // keep the mapping monotonic whatever the rider's tops are
  for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
  return pts;
}

/** Absolute zone boundaries for the profile, in watts or bpm (riding). */
export function zoneTable(profile: Profile, basis: Basis): Array<{ zone: Zone; low: number; high: number | null }> {
  const threshold = basis === 'power' ? profile.ftp : profile.lthr;
  return zonesFor(basis, rideHrZones(profile)).map((zone) => ({
    zone,
    low: Math.round(zone.low * threshold),
    high: isFinite(zone.high) ? Math.round(zone.high * threshold) - 1 : null,
  }));
}

/** Absolute heart-rate zone boundaries on foot, in bpm. */
export function footZoneTable(profile: Profile): Array<{ zone: Zone; low: number; high: number | null }> {
  const threshold = footLthr(profile);
  return footHrZones(profile).map((zone) => ({
    zone,
    low: Math.round(zone.low * threshold),
    high: isFinite(zone.high) ? Math.round(zone.high * threshold) - 1 : null,
  }));
}

export function wattsFor(profile: Profile, intensity: number): number {
  return Math.round(intensity * profile.ftp);
}

export function bpmFor(profile: Profile, powerIntensity: number): number {
  return Math.round(powerToHrFraction(powerIntensity, rideHrZones(profile)) * profile.lthr);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
