import type { Profile, UnsureNumber } from './types';
import { pounds } from './units';

/**
 * Which of a rider's numbers are really theirs (13 Nov 2026). The first-run setup
 * no longer fills in made-up numbers: a number the rider doesn't know is left
 * unknown, or is the app's estimate, marked as one. An unknown number still has
 * a stand-in in the profile so the training maths keeps working, but the stand-in
 * is never shown and no target is built on it: screens ask these helpers first.
 */

export const NUMBER_WORDS: Record<UnsureNumber, string> = { ftp: 'FTP', lthr: 'threshold heart rate', maxHr: 'max heart rate', weightKg: 'weight' };

/** Not known at all: the stored figure is a stand-in. */
export const isUnknown = (p: Pick<Profile, 'unsure'> | null | undefined, k: UnsureNumber): boolean => !!p?.unsure?.[k] && !p.unsure[k]!.estimate;
/** The app's estimate, and what it was estimated from ("from your age"); undefined when the number is the rider's own or unknown. */
export const estimateOf = (p: Pick<Profile, 'unsure'> | null | undefined, k: UnsureNumber): string | undefined => p?.unsure?.[k]?.estimate;

/** The FTP when it can be shown and targets built on it; undefined when unknown. */
export const knownFtp = (p: Profile): number | undefined => (isUnknown(p, 'ftp') ? undefined : p.ftp);
/** The threshold heart rate when it can be shown and targets built on it; undefined when unknown. */
export const knownLthr = (p: Profile): number | undefined => (isUnknown(p, 'lthr') ? undefined : p.lthr);
export const knownMaxHr = (p: Profile): number | undefined => (isUnknown(p, 'maxHr') ? undefined : p.maxHr);
export const knownWeight = (p: Profile): number | undefined => (isUnknown(p, 'weightKg') ? undefined : p.weightKg);

/** Whether a ride's targets can be given in watts, in heart rate, both or neither. */
export function targetsAvailable(p: Profile): { watts: boolean; bpm: boolean } {
  return { watts: !isUnknown(p, 'ftp'), bpm: !isUnknown(p, 'lthr') };
}

/** Max heart rate from age (Tanaka: 208 − 0.7 × age), rounded. */
export const maxHrFromAge = (birthYear: number, todayIso: string): number => Math.round(208 - 0.7 * (Number(todayIso.slice(0, 4)) - birthYear));

/**
 * Stand-ins for numbers not known, used only so the maths has something to work with: never shown, never sent.
 * Built from what is known where possible, otherwise from broad population figures.
 */
export function standIns(p: Pick<Profile, 'ftp' | 'lthr' | 'maxHr' | 'weightKg' | 'unsure'>): Pick<Profile, 'ftp' | 'lthr' | 'maxHr' | 'weightKg'> {
  const weightKg = isUnknown(p, 'weightKg') ? 75 : p.weightKg;
  const maxHr = isUnknown(p, 'maxHr') ? (isUnknown(p, 'lthr') ? 180 : Math.round(p.lthr / 0.9)) : p.maxHr;
  const lthr = isUnknown(p, 'lthr') ? Math.round(maxHr * 0.9) : p.lthr;
  const ftp = isUnknown(p, 'ftp') ? Math.round((weightKg * 2.5) / 5) * 5 : p.ftp;
  return { ftp, lthr, maxHr, weightKg };
}

/**
 * After a change to the profile, the marks that no longer apply: a number that changed (the rider typed it, a test
 * set it, Intervals.icu supplied it) is the rider's own now, unless the change came with its own new mark (a new
 * estimate). Returns the profile to store and the numbers that just became the rider's own, for one plain notice.
 */
export function settleUnsure(before: Profile | undefined, after: Profile): { profile: Profile; settled: UnsureNumber[] } {
  if (!before?.unsure) return { profile: after, settled: [] };
  const unsure = { ...(after.unsure ?? {}) };
  for (const k of Object.keys(unsure) as UnsureNumber[]) {
    const changed = Math.round(before[k] ?? 0) !== Math.round(after[k] ?? 0);
    const sameMark = JSON.stringify(before.unsure[k]) === JSON.stringify(unsure[k]);
    if (changed && sameMark) delete unsure[k];
  }
  // Settled: marked before, not now (changed here, or the mark taken off by whoever made the change).
  const settled = (Object.keys(before.unsure) as UnsureNumber[]).filter((k) => !unsure[k]);
  const next: Profile = { ...after, unsure: Object.keys(unsure).length ? unsure : undefined };
  if (!next.unsure) delete next.unsure;
  return { profile: next, settled };
}

/** The profile without the marks on these numbers: they have come from somewhere that makes them the rider's own. */
export function markMine(p: Profile, ks: UnsureNumber[]): Profile {
  if (!p.unsure || !ks.some((k) => p.unsure![k])) return p;
  const unsure = { ...p.unsure };
  for (const k of ks) delete unsure[k];
  const next: Profile = { ...p, unsure: Object.keys(unsure).length ? unsure : undefined };
  if (!next.unsure) delete next.unsure;
  return next;
}

/** "Your FTP is now 231 W. Later sessions use it." */
export function settledText(p: Profile, settled: UnsureNumber[]): string | undefined {
  if (!settled.length) return undefined;
  const one = (k: UnsureNumber) => `${k === 'ftp' ? 'FTP' : NUMBER_WORDS[k]} is now ${k === 'weightKg' ? (pounds(p) ? `${Math.round(p.weightKg * 2.2046)} lb` : `${Math.round(p.weightKg)} kg`) : `${Math.round(p[k])} ${k === 'ftp' ? 'W' : 'bpm'}`}`;
  return `Your ${settled.map(one).join(', and your ')}. Sessions from now on use ${settled.length > 1 ? 'them' : 'it'}.`;
}

/**
 * What a new plan's first week should find (13 Nov 2026): the test that will measure a number the rider doesn't know,
 * by what they ride with. A power test (the Ramp, or the 20-minute test outdoors) when the FTP is unknown and they have
 * power; it reads the threshold heart rate too when they wear a strap. Otherwise the threshold heart-rate test when that
 * is unknown and they can read heart rate. Nothing to find, or nothing to find it with: said in `none`.
 */
export function numbersToFind(p: Profile): { basis: 'power' | 'hr'; why: string } | { none: string } | undefined {
  const ftp = isUnknown(p, 'ftp'), lthr = isUnknown(p, 'lthr');
  if (!ftp && !lthr) return undefined;
  if (ftp && p.hasPower) return { basis: 'power', why: `your FTP is not known yet${lthr && p.hasHr !== false ? ' (nor your threshold heart rate, which the same test finds if you wear a heart-rate strap)' : ''}, and this test finds it` };
  if (lthr && p.hasHr !== false) return { basis: 'hr', why: 'your threshold heart rate is not known yet, and this test finds it' };
  if (lthr) return { none: 'No test in week 1: your threshold heart rate is not known, and without a heart-rate strap or a power meter there is nothing to measure it with. Rides show zones and how each should feel.' };
  return undefined;
}
