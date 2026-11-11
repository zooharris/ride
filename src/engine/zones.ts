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
    low: i === 0 ? 0 : round5(fractions[i - 1]),
    high: i < 6 ? round5(fractions[i]) : Infinity,
  }));
}

/**
 * An absolute top is inclusive (a zone whose top is 116 bpm holds 116 and hands
 * 117 to the next), so as a fraction it sits half a unit above the number.
 */
function absFractions(tops: number[], threshold: number): number[] {
  return tops.map((t) => (t + 0.5) / threshold);
}

/**
 * The zone ladder a rider's settings describe, for one table. In percent mode
 * the shares are used as they are; in absolute mode the tops are divided by the
 * threshold. Anything missing or out of order falls back to the standard ladder,
 * so a half-filled table never produces nonsense.
 */
export function ladderFor(standard: Zone[], threshold: number, mode: ZoneMode | undefined, pcts: number[] | undefined, tops: number[] | undefined): Zone[] {
  if (mode === 'pct' && validTops(pcts)) return ladderFromFractions(standard, pcts.map((p) => p / 100));
  if (mode !== 'pct' && validTops(tops) && threshold > 0) return ladderFromFractions(standard, absFractions(tops, threshold));
  // the other representation, if that is the one that is filled in
  if (validTops(pcts)) return ladderFromFractions(standard, pcts.map((p) => p / 100));
  if (validTops(tops) && threshold > 0) return ladderFromFractions(standard, absFractions(tops, threshold));
  return standard;
}

/** The inclusive top of a zone in the threshold's unit: the last whole watt or beat that is still inside it. */
export function topOf(zone: Zone, threshold: number): number {
  return Math.floor(zone.high * threshold + 1e-6);
}

/** The zone tops of a ladder in the threshold's unit (watts or bpm), inclusive. */
export function ladderTops(zones: Zone[], threshold: number): number[] {
  return zones.slice(0, 6).map((z) => topOf(z, threshold));
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
  return zones.map((zone, i) => ({
    zone,
    low: i === 0 ? 0 : topOf(zones[i - 1], threshold) + 1,
    high: isFinite(zone.high) ? topOf(zone, threshold) : null,
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

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

// ---- breathing (Step 4, 3 Nov 2026) ------------------------------------------

/** The breathing zones' names: below and up to the first threshold, between the two, just above the second, and the top. */
export const BREATH_ZONE_NAMES = ['Easy', 'Endurance', 'Tempo', 'Above threshold', 'Max'] as const;

/** One breathing zone in litres a minute: low inclusive, high exclusive (Infinity for zone 5). */
export interface BreathZone { n: number; name: string; low: number; high: number }

/** Four tops that go up, every one positive. */
export function validBreathTops(tops?: number[]): tops is number[] {
  return !!tops && tops.length === 4 && tops.every((t, i) => t > 0 && (i === 0 || t > tops[i - 1]));
}

/** The standard breathing shares from the two thresholds (zone 2 top at VT1, zone 3 top at VT2), as whole percent of VT2. */
export function standardBreathPcts(vt1Ve: number, vt2Ve: number): number[] | undefined {
  if (!(vt1Ve > 0) || !(vt2Ve > vt1Ve)) return undefined;
  const r = vt1Ve / vt2Ve;
  const pcts = [Math.round(80 * r), Math.round(100 * r), 100, 115];
  return validBreathTops(pcts) ? pcts : undefined;
}

/**
 * The rider's breathing zones in L/min, or undefined when the second threshold
 * is not set. Percent mode multiplies the shares by VT2; absolute mode uses
 * the tops as they are; anything missing or out of order falls back to the
 * standard shares from the thresholds (never to the other mode's old table).
 */
/**
 * Breathing zone tops as shares of the second threshold when the rider's first threshold is not yet known: a
 * population default (five-zone shape, zone 2 ending at a typical first-to-second ratio), labelled provisional on
 * screen and replaced the moment the rider's own first threshold is found.
 */
export const PROVISIONAL_BREATH_PCTS = [60, 75, 100, 115];

export function breathZones(p: Pick<Profile, 'vt1Ve' | 'vt2Ve' | 'breathZoneMode' | 'breathZonePcts' | 'breathZoneTops'>): BreathZone[] | undefined {
  const vt2 = p.vt2Ve;
  if (!vt2 || vt2 <= 0) return undefined;
  let tops: number[] | undefined;
  if (p.breathZoneMode === 'abs' && validBreathTops(p.breathZoneTops)) tops = p.breathZoneTops;
  else if (p.breathZoneMode !== 'abs' && validBreathTops(p.breathZonePcts)) tops = p.breathZonePcts.map((x) => (x / 100) * vt2);
  else {
    const std = standardBreathPcts(p.vt1Ve ?? 0, vt2) ?? PROVISIONAL_BREATH_PCTS;
    tops = std.map((x) => (x / 100) * vt2);
  }
  return BREATH_ZONE_NAMES.map((name, i) => ({ n: i + 1, name, low: i === 0 ? 0 : Math.round(tops![i - 1] * 10) / 10, high: i < 4 ? Math.round(tops![i] * 10) / 10 : Infinity }));
}

/** The zone a ventilation falls in (1-5), or undefined with no table. */
export function breathZoneOf(ve: number, zones: BreathZone[] | undefined): number | undefined {
  if (!zones) return undefined;
  return zones.find((z) => ve >= z.low && ve < z.high)?.n ?? 5;
}

// ---- riding by breathing (Step 5, 11 Nov 2026) --------------------------------

/**
 * The anchor points that carry a share of FTP onto ventilation, from the rider's own two tables: the top of
 * power zone 1 meets the top of breathing zone 1, the top of power zone 2 (endurance) the top of breathing
 * zone 2 (the first threshold), FTP the top of breathing zone 3 (the second threshold), the top of power
 * zone 5 (VO2max) the top of breathing zone 4. Linear between them, so sweet spot sits higher in zone 3
 * than tempo. No fixed number: every point is one of the rider's own boundaries.
 */
function powerToBreathPoints(power: Zone[], breath: BreathZone[]): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0], [power[0].high, breath[0].high], [power[1].high, breath[1].high], [1, breath[2].high], [power[4].high, breath[3].high]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] <= pts[i - 1][0]) pts[i][0] = pts[i - 1][0] + 0.001;
    if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1];
  }
  return pts;
}

/** Ventilation (L/min) for a share of FTP. Above the top of power zone 5 it carries on at half the VO2max slope, into breathing zone 5. */
export function powerToVe(powerFraction: number, power: Zone[], breath: BreathZone[]): number {
  const pts = powerToBreathPoints(power, breath);
  for (let i = 1; i < pts.length; i++) {
    const [p0, v0] = pts[i - 1], [p1, v1] = pts[i];
    if (powerFraction <= p1) return Math.round((v0 + ((Math.max(0, powerFraction) - p0) / (p1 - p0)) * (v1 - v0)) * 10) / 10;
  }
  const [pa, va] = pts[pts.length - 2], [pb, vb] = pts[pts.length - 1];
  return Math.round((vb + (powerFraction - pb) * ((vb - va) / (pb - pa)) * 0.5) * 10) / 10;
}

/** The inverse: the share of FTP a ventilation corresponds to (for watts to start a step at, before anything is learned). */
export function veToPower(ve: number, power: Zone[], breath: BreathZone[]): number {
  const pts = powerToBreathPoints(power, breath);
  for (let i = 1; i < pts.length; i++) {
    const [p0, v0] = pts[i - 1], [p1, v1] = pts[i];
    if (ve <= v1) return Math.round((p0 + (v1 > v0 ? (ve - v0) / (v1 - v0) : 0) * (p1 - p0)) * 1000) / 1000;
  }
  const [pa, va] = pts[pts.length - 2], [pb, vb] = pts[pts.length - 1];
  return Math.round((pb + ((ve - vb) / ((vb - va) / (pb - pa))) * 2) * 1000) / 1000;
}

/** The rider's breathing zones are provisional: the first threshold is not yet known and the table is the population default. */
export function breathProvisional(p: Pick<Profile, 'vt1Ve' | 'vt2Ve' | 'breathZoneMode' | 'breathZonePcts' | 'breathZoneTops'>): boolean {
  if (!p.vt2Ve) return false;
  if (p.breathZoneMode === 'abs' && validBreathTops(p.breathZoneTops)) return false;
  if (p.breathZoneMode !== 'abs' && validBreathTops(p.breathZonePcts)) return false;
  return !standardBreathPcts(p.vt1Ve ?? 0, p.vt2Ve);
}

/** A step's breathing target: ventilation low and high (low 0 for a step with no floor), and as whole percent of the second threshold. */
export interface BreathTarget { lo: number; hi: number; loPct: number; hiPct: number; ceiling: boolean; zone: number }

export function breathTargetOf(lo: number, hi: number, noFloor: boolean, profile: Profile): BreathTarget | undefined {
  const zones = breathZones(profile);
  if (!zones || !profile.vt2Ve) return undefined;
  const power = ridePowerZones(profile);
  const vLo = noFloor ? 0 : powerToVe(lo, power, zones), vHi = powerToVe(hi, power, zones);
  const pct = (v: number) => Math.round((v / profile.vt2Ve!) * 100);
  const mid = noFloor ? vHi * 0.97 : (vLo + vHi) / 2;
  return { lo: vLo, hi: vHi, loPct: pct(vLo), hiPct: pct(vHi), ceiling: noFloor, zone: breathZoneOf(mid, zones) ?? 1 };
}

/** The words for a breathing target, share first: "78–92% · 31–37 L/min", "under 70% · 28 L/min", "85% · 34 L/min". */
export function breathTargetWords(t: BreathTarget): string {
  const L = (v: number) => Math.round(v);
  if (t.ceiling) return `under ${t.hiPct}% · ${L(t.hi)} L/min`;
  if (t.loPct === t.hiPct) return `${t.hiPct}% · ${L(t.hi)} L/min`;
  return `${t.loPct}–${t.hiPct}% · ${L(t.lo)}–${L(t.hi)} L/min`;
}
