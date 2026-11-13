import type { FootBand } from './foot';

/**
 * Each rider's own walk training-load rate (12 Nov 2026). A planned walk with no power is counted at a rate per hour
 * for its heart-rate band. The starting figure (engine/foot bandTssPerHour) was taken from one rider's walks; from
 * the fifth walk with heart rate in a band, the rider's own rate is used for that band instead: the load their
 * heart rate gave, per hour, averaged over their walks in it. The table is the rider's data, kept with their
 * settings (so it travels to their other devices and goes into Back up everything). Walks already on the calendar
 * keep the load they were given; the rate applies to the next walk planned.
 */

export const WALK_RATES_KEY = 'walkRates';
/** Walks with heart rate needed in a band before the rider's own rate replaces the starting figure. */
export const MIN_WALKS = 5;

export type WalkRates = Record<string, { perHour: number; n: number }>;

/** A band's key in the table: its zone range, as the walk spec states it. */
export const bandKey = (b: Pick<FootBand, 'zoneLow' | 'zoneHigh'>): string => `${Math.round((b.zoneLow ?? 0) * 100)}-${Math.round(b.zoneHigh * 100)}`;

/** The table from the rider's recorded walks that were scored by heart rate: each with its band, length and load. */
export function learnWalkRates(walks: Array<{ band: Pick<FootBand, 'zoneLow' | 'zoneHigh'>; seconds: number; tss: number }>): WalkRates {
  const acc = new Map<string, { tss: number; hours: number; n: number }>();
  for (const w of walks) {
    if (!(w.seconds >= 600) || !(w.tss > 0)) continue;
    const k = bandKey(w.band);
    const a = acc.get(k) ?? { tss: 0, hours: 0, n: 0 };
    a.tss += w.tss; a.hours += w.seconds / 3600; a.n++;
    acc.set(k, a);
  }
  const out: WalkRates = {};
  for (const [k, a] of acc) out[k] = { perHour: Math.round((a.tss / a.hours) * 10) / 10, n: a.n };
  return out;
}

let RATES: WalkRates = {};
export function setWalkRates(r: WalkRates | undefined): void { RATES = r ?? {}; }

/** The rider's own rate for a band once there are enough walks in it; undefined before, when the starting figure stands. */
export function ownWalkRate(b: Pick<FootBand, 'zoneLow' | 'zoneHigh'>, rates: WalkRates = RATES): number | undefined {
  const r = rates[bandKey(b)];
  return r && r.n >= MIN_WALKS ? r.perHour : undefined;
}
