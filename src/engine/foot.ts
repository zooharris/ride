import type { Profile, RunStep, WalkSpec } from './types';
import { HR_ZONES, footHrZones, footLthr, fractionAt, hrToPowerFraction, type Zone } from './zones';

/**
 * Heart-rate bands on foot, for walks and runs. A band is written as zone
 * positions on the rider's foot table, not as beats: 2.0 is the bottom of zone
 * 2, 2.5 its middle, 3.0 its top. "Zone 2" is [2, 3]; "upper zone 2 into lower
 * zone 3" is [2.5, 3.5]. The beats come from the rider's own foot table at the
 * moment the band is shown or sent, so a walk written once follows the table
 * if the table changes. A low end at or below 1 means no minimum: a stroll
 * counts.
 *
 * Older walks and runs were written as shares of max heart rate; those still
 * resolve, through the max, until they are edited.
 */
export interface FootBand { zoneLow: number; zoneHigh: number }

/** The bands a run step (or a walk preset) can use. */
export const FOOT_BANDS = [
  { key: 'walk',   label: 'Walk',   zoneLow: 0,   zoneHigh: 2.5, paceFrom: undefined, paceTo: undefined, blurb: 'no minimum: walking, a stroll counts' },
  { key: 'easy',   label: 'Easy',   zoneLow: 2,   zoneHigh: 3,   paceFrom: 60, paceTo: 90, blurb: 'zone 2: talk in full sentences' },
  { key: 'steady', label: 'Steady', zoneLow: 3,   zoneHigh: 4,   paceFrom: 30, paceTo: 60, blurb: 'zone 3: purposeful, short sentences' },
  { key: 'tempo',  label: 'Tempo',  zoneLow: 3.5, zoneHigh: 5,   paceFrom: 10, paceTo: 25, blurb: 'upper zone 3 to threshold' },
  { key: 'hard',   label: 'Hard',   zoneLow: 5,   zoneHigh: 6,   paceFrom: -15, paceTo: -5, blurb: 'zone 5: above threshold, a few minutes at most' },
] as const;
export type FootBandKey = typeof FOOT_BANDS[number]['key'];
export function footBand(key: FootBandKey) { return FOOT_BANDS.find((b) => b.key === key)!; }

/** Walk presets, as the builder and the planner offer them. */
export const WALK_PRESETS: Array<{ label: string; zoneLow: number; zoneHigh: number; blurb: string }> = [
  { label: 'Recovery', zoneLow: 0, zoneHigh: 2, blurb: 'no minimum: stroll, and slow down if the heart rate climbs out of zone 1' },
  { label: 'Zone 2', zoneLow: 2, zoneHigh: 3, blurb: 'talk in full sentences; the default' },
  { label: 'Brisk', zoneLow: 2.5, zoneHigh: 3.5, blurb: 'purposeful; upper zone 2 into lower zone 3' },
];

export const hasNoFloor = (b: FootBand) => b.zoneLow <= 1;

/** The band of a walk: its zones when it has them, else its old share-of-max target turned into zones through the rider's numbers. */
export function walkBand(w: WalkSpec, profile?: FootProfile): FootBand {
  if (w.zoneHigh != null) return { zoneLow: w.zoneLow ?? 0, zoneHigh: w.zoneHigh };
  return legacyBand(w.hrLow ?? 0.6, w.hrHigh ?? 0.7, profile);
}

/** The band of a run step, and of its recovery. */
export function stepBand(s: RunStep, profile?: FootProfile): FootBand {
  if (s.band) return footBand(s.band);
  return legacyBand(s.hrLow ?? 0.65, s.hrHigh ?? 0.75, profile);
}
export function recoveryBand(s: RunStep, profile?: FootProfile): FootBand {
  if (s.recoverBand) return footBand(s.recoverBand);
  if (s.recoverHigh != null) return legacyBand(s.recoverLow ?? 0, s.recoverHigh, profile);
  return footBand('easy');
}

/** The band key a run step is closest to (for the builder's select). */
export function bandKeyOf(b: FootBand): FootBandKey {
  let best: FootBandKey = 'easy', d = Infinity;
  for (const k of FOOT_BANDS) { const e = Math.abs(k.zoneLow - b.zoneLow) + Math.abs(k.zoneHigh - b.zoneHigh); if (e < d) { d = e; best = k.key; } }
  return best;
}

type FootProfile = Pick<Profile, 'lthr' | 'maxHr'> & Partial<Profile>;

/** The foot ladder and threshold to resolve a band with; the standard ladder when there is no rider. */
function ladderOf(profile?: FootProfile): { zones: Zone[]; lthr: number } {
  if (!profile) return { zones: HR_ZONES, lthr: 0 };
  return { zones: footHrZones(profile), lthr: footLthr(profile) };
}

/** An old share-of-max target as zone positions on the rider's foot table (or a fair guess without one). */
function legacyBand(hrLow: number, hrHigh: number, profile?: FootProfile): FootBand {
  const { zones, lthr } = ladderOf(profile);
  // Without a rider, take threshold as 92% of max, the rule the old estimate used.
  const toFrac = (f: number) => (lthr > 0 && profile?.maxHr ? (f * profile.maxHr) / lthr : f / 0.92);
  const pos = (frac: number) => { const z = zones.find((x) => frac < x.high) ?? zones[6]; const span = isFinite(z.high) ? z.high - z.low : 0.5; return z.n + Math.max(0, Math.min(1, (frac - z.low) / span)); };
  return { zoneLow: hrLow > 0 ? round2(pos(toFrac(hrLow))) : 0, zoneHigh: round2(pos(toFrac(hrHigh))) };
}

/** A band as fractions of the foot threshold: what Intervals.icu and the Garmin take. The low end is 0 for no minimum. */
export function bandFractions(b: FootBand, profile?: FootProfile): { low: number; high: number } {
  const { zones } = ladderOf(profile);
  return { low: hasNoFloor(b) ? 0 : fractionAt(b.zoneLow, zones), high: fractionAt(b.zoneHigh, zones) };
}

/** A band in whole beats per minute on the rider's foot table (first beat inside to last beat inside); undefined without a rider. */
export function bandBpm(b: FootBand, profile?: FootProfile): { low: number; high: number } | undefined {
  const { lthr } = ladderOf(profile);
  if (!lthr) return undefined;
  const f = bandFractions(b, profile);
  return { low: Math.ceil(f.low * lthr - 1e-6), high: Math.floor(f.high * lthr - 1e-6) };
}

/** "zone 2", "upper zone 2 into lower zone 3", "up to zone 1". */
export function bandZoneWords(b: FootBand): string {
  const from = (a: number) => (a % 1 === 0 ? `zone ${a}` : `upper zone ${Math.floor(a)}`);
  const to = (z: number) => (z % 1 === 0 ? `zone ${z - 1}` : `lower zone ${Math.floor(z)}`);
  if (hasNoFloor(b)) return `up to ${to(b.zoneHigh)}`.replace('up to zone', 'up to the top of zone');
  const a = from(b.zoneLow), z = to(b.zoneHigh);
  if (a === z) return a;
  if (a.startsWith('zone') && z.startsWith('zone')) return `zones ${b.zoneLow}–${Math.ceil(b.zoneHigh) - 1}`;
  return `${a} into ${z}`;
}

/** "zone 2 (121–135 bpm)" with a rider, "zone 2" without. */
export function bandWords(b: FootBand, profile?: FootProfile): string {
  const bpm = bandBpm(b, profile);
  const z = bandZoneWords(b);
  if (!bpm) return z;
  return `${z} (${hasNoFloor(b) ? `up to ${bpm.high}` : `${bpm.low}–${bpm.high}`} bpm)`;
}

/**
 * Training load an hour of a band costs, through the same heart-rate-to-power
 * mapping a recorded walk is scored with: the middle of the band as a share of
 * threshold, turned into a share of FTP, squared. No minimum counts as a
 * stroll low in zone 1.
 */
export function bandTssPerHour(b: FootBand): number {
  const mid = hasNoFloor(b) ? Math.min(fractionAt(b.zoneHigh, HR_ZONES), 0.68) : (fractionAt(b.zoneLow, HR_ZONES) + fractionAt(b.zoneHigh, HR_ZONES)) / 2;
  const intensity = hrToPowerFraction(mid);
  return intensity * intensity * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
