import type { Ride, Wellness } from './types';
import { addDays, rideIntensity } from './load';
import type { Zone } from './zones';

/** The rider's heart-rate numbers a day is judged by: the bike ladder for rides, the foot threshold for runs. */
export interface HrNumbers { zones?: Zone[]; footLthr?: number }

/**
 * What kind of training day a date was, for "the morning after": a long ride
 * (2½ hours or more), a hard ride (40 minutes or more at 85% of FTP or above,
 * by power or its heart-rate equivalent), strength, a rest day (nothing
 * recorded), or something else (a walk, mobility). A day that is both hard and
 * long counts as long; a ride outranks strength the same day. The same day
 * matching as the plan assessment's recovery evidence (the morning is the day
 * after), so this card and the planner read the rider the same way.
 */
export type DayKind = 'long' | 'hard' | 'strength' | 'run' | 'rest' | 'other';

export function dayKind(onDay: Ride[], lthr: number, hr: HrNumbers = {}): DayKind {
  if (!onDay.length) return 'rest';
  const rides = onDay.filter((r) => r.sport === 'ride');
  if (rides.some((r) => r.seconds >= 9000)) return 'long';
  if (rides.some((r) => r.seconds >= 2400 && (rideIntensity(r, lthr, hr.zones) ?? 0) >= 0.85)) return 'hard';
  // A run of 30 minutes or more at 85% of threshold heart rate or above is a hard day like a hard ride.
  if (onDay.some((r) => r.sport === 'run' && r.seconds >= 1800 && (hr.footLthr || lthr) > 0 && (r.averageHr ?? 0) / (hr.footLthr || lthr) >= 0.85)) return 'hard';
  if (onDay.some((r) => r.sport === 'strength')) return 'strength';
  if (onDay.some((r) => r.sport === 'run')) return 'run';
  return 'other';
}

export const DAY_KIND_PHRASE: Record<DayKind, string> = {
  long: 'the morning after a long ride', hard: 'the morning after a hard ride', strength: 'the morning after strength',
  run: 'the morning after a run', rest: 'the morning after a rest day', other: 'the morning after an easy day',
};

export interface MorningRow { kind: Exclude<DayKind, 'other'>; n: number; hrv?: number; restingHr?: number; sleepSeconds?: number }

/**
 * For mornings in [from, to]: after each kind of day, the mean difference of
 * the morning's HRV, resting heart rate and sleep from the rider's normal over
 * the same range (the mean of every morning in it), and how many mornings that
 * is. Pass trusted wellness only (days the rider set aside are already out).
 * A metric with no readings after that kind of day is undefined.
 */
export function morningsAfter(rides: Ride[], wellness: Wellness[], from: string, to: string, lthr = 0, hr: HrNumbers = {}): MorningRow[] {
  const byDate = new Map<string, Ride[]>();
  for (const r of rides) { const l = byDate.get(r.date) ?? []; l.push(r); byDate.set(r.date, l); }
  const mornings = wellness.filter((w) => w.date >= from && w.date <= to);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const pick = (w: Wellness, k: 'hrv' | 'restingHr' | 'sleepSeconds') => { const v = w[k]; return typeof v === 'number' && v > 0 ? v : undefined; };
  const normal = {
    hrv: mean(mornings.map((w) => pick(w, 'hrv')).filter((v): v is number => v != null)),
    restingHr: mean(mornings.map((w) => pick(w, 'restingHr')).filter((v): v is number => v != null)),
    sleepSeconds: mean(mornings.map((w) => pick(w, 'sleepSeconds')).filter((v): v is number => v != null)),
  };
  const kinds: Array<MorningRow['kind']> = ['hard', 'long', 'strength', 'run', 'rest'];
  return kinds.map((kind) => {
    const after = mornings.filter((w) => dayKind(byDate.get(addDays(w.date, -1)) ?? [], lthr, hr) === kind);
    const diff = (k: 'hrv' | 'restingHr' | 'sleepSeconds') => {
      const base = normal[k];
      if (base == null) return undefined;
      return mean(after.map((w) => pick(w, k)).filter((v): v is number => v != null).map((v) => v - base));
    };
    return { kind, n: after.length, hrv: diff('hrv'), restingHr: diff('restingHr'), sleepSeconds: diff('sleepSeconds') };
  });
}
