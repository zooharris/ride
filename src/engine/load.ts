import type { DayLoad, Fitness, Ride } from './types';

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
 * Heart-rate TSS for rides without power: the same formula with IF taken as
 * average HR over LTHR. Simple and continuous with power TSS near threshold;
 * it under-reads very short hard efforts, which is why those are power-only.
 */
export function hrTss(seconds: number, averageHr: number, lthr: number): number {
  if (!lthr || !averageHr || !seconds) return 0;
  const IF = averageHr / lthr;
  return Math.round((seconds * IF * IF) / 36);
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
 * yesterday's fitness minus yesterday's fatigue. Days with no training count as 0.
 */
export function fitnessSeries(loads: DayLoad[], from: string, to: string, start = { ctl: 0, atl: 0 }): Fitness[] {
  const byDate = new Map<string, number>();
  for (const l of loads) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.tss);
  const out: Fitness[] = [];
  let ctl = start.ctl;
  let atl = start.atl;
  for (const date of eachDay(from, to)) {
    const tsb = round1(ctl - atl);
    const tss = byDate.get(date) ?? 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    out.push({ date, ctl: round1(ctl), atl: round1(atl), tsb });
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

export function today(): string {
  return isoDate(new Date());
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
