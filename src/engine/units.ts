import type { Profile } from './types';

/**
 * Distance and weight are two settings (12 Nov 2026): many riders mix them (British riders ride in miles and weigh
 * in kilograms). A rider set up before the split keeps what they had: imperial is miles and pounds, metric is
 * kilometres and kilograms. Temperature is in °F only for a rider in miles and pounds, as in the United States.
 */
export type DistUnits = 'mi' | 'km';
export type WeightUnits = 'lb' | 'kg';
type P = Partial<Pick<Profile, 'units' | 'distUnits' | 'weightUnits'>> | null | undefined;

export const distUnitsOf = (p: P): DistUnits => p?.distUnits ?? (p?.units === 'metric' ? 'km' : 'mi');
export const weightUnitsOf = (p: P): WeightUnits => p?.weightUnits ?? (p?.units === 'metric' ? 'kg' : 'lb');
/** Distance, speed, pace and climbing in miles, mph and feet. */
export const miles = (p: P): boolean => distUnitsOf(p) === 'mi';
/** Weight in pounds. */
export const pounds = (p: P): boolean => weightUnitsOf(p) === 'lb';
export const fahrenheit = (p: P): boolean => miles(p) && pounds(p);
/** The weight setting in the older words the strength and walk records use. */
export const weightSystem = (p: P): 'imperial' | 'metric' => (pounds(p) ? 'imperial' : 'metric');

/** The older single setting, kept in step for anything that still reads it: imperial only for miles and pounds. */
export const legacyUnits = (d: DistUnits, w: WeightUnits): Profile['units'] => (d === 'mi' && w === 'lb' ? 'imperial' : 'metric');

/**
 * A new rider's starting guess from the device's region: miles and pounds in the United States, Liberia and Myanmar;
 * miles and kilograms in the United Kingdom; kilometres and kilograms everywhere else, and when the region is unknown.
 */
export function unitsForRegion(region: string | undefined): { distUnits: DistUnits; weightUnits: WeightUnits } {
  const r = (region ?? '').toUpperCase();
  if (r === 'US' || r === 'LR' || r === 'MM') return { distUnits: 'mi', weightUnits: 'lb' };
  if (r === 'GB') return { distUnits: 'mi', weightUnits: 'kg' };
  return { distUnits: 'km', weightUnits: 'kg' };
}

/** The device's region, from its languages ("en-GB" → GB); undefined when none says. */
export function deviceRegion(langs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []): string | undefined {
  for (const l of langs) {
    try {
      const loc = new Intl.Locale(l);
      if (loc.region) return loc.region;
    } catch { /* not a language tag */ }
  }
  return undefined;
}

/** Words for the coach: "distance in miles, weight in kilograms". */
export const unitsWords = (p: P): string => `distance in ${miles(p) ? 'miles' : 'kilometres'}, weight in ${pounds(p) ? 'pounds' : 'kilograms'}`;

/**
 * Masters recovery for a new rider (12 Nov 2026): on from the age of 40, the usual start of the masters categories
 * in cycling; off for a younger rider, and off when no birth year is given. An existing rider's setting never changes.
 */
export const MASTERS_AGE = 40;
export function mastersFor(birthYear: number | undefined, today: string): boolean {
  if (!birthYear) return false;
  return Number(today.slice(0, 4)) - birthYear >= MASTERS_AGE;
}

/** The weight unit walk names and walk text use, set from the rider's setting when the profile loads (as the week's first day is). */
let PACK_UNIT: WeightUnits = 'lb';
export function setPackUnit(u: WeightUnits): void { PACK_UNIT = u; }
export function packUnit(): WeightUnits { return PACK_UNIT; }
const LB_PER_KG = 2.20462;
/** "15 lb" or "7 kg", in the rider's weight unit. */
export function packWords(kg: number, unit: WeightUnits = PACK_UNIT): string {
  return unit === 'kg' ? `${Math.round(kg)} kg` : `${Math.round(kg * LB_PER_KG)} lb`;
}
/**
 * A session's name for matching, whatever unit its pack was named in: "with a 15 lb pack" and "with a 7 kg pack" are
 * the same session, so a calendar entry made under an older name is still recognised.
 */
export function sessionKey(name: string): string {
  return name.replace(/(\d+(?:\.\d+)?)\s*(lb|kg)\b/g, (_m, n: string, u: string) => `${Math.round(u === 'lb' ? Number(n) / LB_PER_KG : Number(n))} kg`);
}
export const sameSessionName = (a: string, b: string): boolean => a === b || sessionKey(a) === sessionKey(b);
