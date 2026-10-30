/**
 * Step 2b, Part B (30 Oct 2026): heart rate kept alongside power, per ride, for
 * the evidence behind Today's two FTP messages. Pure. Never shown on a screen.
 *  - hrAtPower: seconds and mean heart rate in the power bands 0.50-0.60 …
 *    1.10-1.20 of FTP (seven tenths; the brief said eight, the range holds seven), only where both are recorded and after minute 10; a band
 *    with under 3 minutes is dropped.
 *  - steadyAtHr: mean power while heart rate sits in 0.70-0.80 of threshold heart
 *    rate, after minute 10; absent under 15 minutes.
 */
/** The bands, as shares of FTP: 0.50-0.60, 0.60-0.70, … 1.10-1.20. */
export const BANDS: Array<[number, number]> = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1].map((lo) => [lo, Math.round((lo + 0.1) * 10) / 10]);
export const SKIP_SECONDS = 600;
export const BAND_FLOOR = 180;
export const STEADY_FLOOR = 900;
export const STEADY_BAND: [number, number] = [0.7, 0.8];

export interface HrAtPower { lo: number; hi: number; seconds: number; hr: number }
export interface SteadyAtHr { watts: number; seconds: number }

/** Seconds each sample stands for: up to the next sample, never more than 5 s (a pause is not riding). */
function each(time: number[], n: number, fn: (i: number, dt: number) => void): void {
  for (let i = 0; i < n; i++) {
    const dt = i + 1 < n ? Math.min(5, Math.max(0, time[i + 1] - time[i])) : 1;
    if (time[i] < SKIP_SECONDS || dt <= 0) continue;
    fn(i, dt);
  }
}

export function hrAtPower(time: number[], watts: number[] | undefined, hr: number[] | undefined, ftp: number): HrAtPower[] {
  if (!watts?.length || !hr?.length || ftp <= 0) return [];
  const n = Math.min(time.length, watts.length, hr.length);
  const sec = BANDS.map(() => 0), beats = BANDS.map(() => 0);
  each(time, n, (i, dt) => {
    const w = watts[i], h = hr[i];
    if (!(w > 0) || !(h > 0)) return;
    const f = w / ftp;
    const k = BANDS.findIndex(([lo, hi]) => f >= lo && f < hi);
    if (k < 0) return;
    sec[k] += dt; beats[k] += h * dt;
  });
  return BANDS.map(([lo, hi], k) => ({ lo, hi, seconds: Math.round(sec[k]), hr: sec[k] ? Math.round(beats[k] / sec[k]) : 0 })).filter((b) => b.seconds >= BAND_FLOOR);
}

export function steadyAtHr(time: number[], watts: number[] | undefined, hr: number[] | undefined, lthr: number): SteadyAtHr | undefined {
  if (!watts?.length || !hr?.length || lthr <= 0) return undefined;
  const n = Math.min(time.length, watts.length, hr.length);
  let sec = 0, work = 0;
  each(time, n, (i, dt) => {
    const w = watts[i], h = hr[i];
    if (!(h > 0) || w == null || w < 0) return;
    const f = h / lthr;
    if (f < STEADY_BAND[0] || f >= STEADY_BAND[1]) return;
    sec += dt; work += w * dt;
  });
  return sec >= STEADY_FLOOR ? { watts: Math.round(work / sec), seconds: Math.round(sec) } : undefined;
}

