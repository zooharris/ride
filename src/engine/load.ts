import type { DayLoad, Fitness, Ride } from './types';
import { hrToPowerFraction } from './zones';

/**
 * Training Stress Score from power: (seconds × NP × IF) / (FTP × 3600) × 100,
 * which simplifies to seconds × IF² / 36.
 */
export function powerTss(seconds: number, normalizedPower: number, ftp: number): number {
  if (!ftp || !normalizedPower || !seconds) return 0;
  const IF = normalizedPower / ftp;
  return Math.round((seconds * IF * IF) / 36);
}

/**
 * Heart-rate TSS for activities without power: the power formula with the
 * intensity taken from average heart rate, mapped zone by zone onto the power
 * scale (88% of threshold heart rate is a zone 2 ride, so it costs what 72% of
 * FTP costs, not what 88% would). Heart rate lags the legs, so this under-reads
 * very short hard efforts, which is why those are power-only.
 */
export function hrTss(seconds: number, averageHr: number, lthr: number): number {
  if (!lthr || !averageHr || !seconds) return 0;
  const IF = hrIntensity(averageHr, lthr);
  return Math.round((seconds * IF * IF) / 36);
}

/** The power-equivalent intensity of an average heart rate (a fraction of FTP). */
export function hrIntensity(averageHr: number, lthr: number): number {
  return hrToPowerFraction(averageHr / lthr);
}

/**
 * The intensity of a ride as a fraction of FTP: the recorded intensity factor
 * when there is one (power), else the heart-rate equivalent, else unknown.
 */
export function rideIntensity(r: Pick<Ride, 'intensityFactor' | 'averageHr'>, lthr: number): number | undefined {
  if (r.intensityFactor != null) return r.intensityFactor;
  if (r.averageHr && lthr) return hrIntensity(r.averageHr, lthr);
  return undefined;
}

/**
 * A ride with neither power nor heart rate still cost something. About the
 * load of an easy endurance hour (45 an hour), marked as an estimate by the
 * caller. Only the duration speaks, so nothing finer is pretended.
 */
export const ESTIMATED_RIDE_TSS_PER_HOUR = 45;
export function estimatedRideTss(seconds: number): number {
  return Math.round((seconds / 3600) * ESTIMATED_RIDE_TSS_PER_HOUR);
}

/**
 * A "ride" averaging over 16 m/s (about 36 mph) with no power is a car, a
 * train, or a watch left recording; it must not count as training.
 */
export function looksLikeADrive(r: Pick<Ride, 'type' | 'averageSpeedMs' | 'normalizedPower' | 'sport'>): boolean {
  return r.sport === 'ride' && !/Virtual/.test(r.type ?? '') && !r.normalizedPower && (r.averageSpeedMs ?? 0) > 16;
}

/** Load for a strength session from duration and RPE (1..10). */
export function strengthTss(seconds: number, rpe: number): number {
  // An hour at RPE 7 ≈ 50 TSS-equivalent; scales with RPE².
  return Math.round((seconds / 3600) * (rpe * rpe) * (50 / 49));
}

/** Pick the right TSS for a ride given the profile numbers in force that day. */
export function rideTss(ride: Pick<Ride, 'seconds' | 'normalizedPower' | 'averageHr' | 'ftpAtRide'>, ftp: number, lthr: number): number {
  if (ride.normalizedPower) return powerTss(ride.seconds, ride.normalizedPower, ride.ftpAtRide || ftp);
  if (ride.averageHr) return hrTss(ride.seconds, ride.averageHr, lthr);
  return 0;
}

/**
 * The performance-management model. Fitness (CTL) is a 42-day exponentially
 * weighted average of daily load; fatigue (ATL) a 7-day one; form (TSB) is
 * fitness minus fatigue, of the same day, so the three numbers shown together
 * always add up (the classic convention takes yesterday's, which reads as a
 * sum that is one day off). Days with no training count as 0.
 */
export function fitnessSeries(loads: DayLoad[], from: string, to: string, start = { ctl: 0, atl: 0 }): Fitness[] {
  const byDate = new Map<string, number>();
  for (const l of loads) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.tss);
  const out: Fitness[] = [];
  let ctl = start.ctl;
  let atl = start.atl;
  for (const date of eachDay(from, to)) {
    const tss = byDate.get(date) ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date, ctl: round1(ctl), atl: round1(atl), tsb: round1(ctl - atl) });
  }
  return out;
}

export function* eachDay(from: string, to: string): Generator<string> {
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) {
    yield isoDate(d);
    d.setDate(d.getDate() + 1);
  }
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/**
 * Where a fitness series should start: the earliest activity on record, but no
 * more than two years back and never less than 120 days (fitness needs about
 * that long to settle from zero). Every screen starts from the same day, so the
 * fitness number agrees everywhere.
 */
export function historyStart(dates: string[], to: string): string {
  const floor = addDays(to, -730), ceil = addDays(to, -120);
  let earliest = ceil;
  for (const d of dates) if (d < earliest && d >= floor) earliest = d;
  return earliest;
}

export function today(): string {
  return isoDate(new Date());
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
