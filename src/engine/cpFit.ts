/**
 * The critical power fit (29 Oct, Step 2 rework). Best power for an effort of
 * t seconds = CP + W′ / t: a sustainable level (critical power, watts) plus a
 * reserve (W′, joules) spread over the effort. Written as work done
 * (power × seconds = CP × t + W′) it is a straight line, so the best pair is an
 * ordinary least-squares line through the rider's best efforts. Pure, tested.
 */

/** Effort lengths the fit uses: 2 to 30 minutes (shorter is mostly sprint, longer mostly fatigue). */
export const FIT_SECONDS = [120, 300, 600, 1200, 1800];
/** FTP sits a little under critical power. */
export const FTP_OF_CP = 0.95;
/** A believable reserve, joules. Outside it, the efforts weren't all-out or don't belong together. */
export const W_PRIME = { min: 6000, max: 40000 };
/** The fitted line must reproduce each effort within this share. */
export const FIT_TOLERANCE = 0.05;

export interface CpFit {
  /** Critical power, watts. */
  cp: number;
  /** Reserve, joules. */
  wPrime: number;
  ftp: number;
  /** Largest miss between an effort and the fitted line, as a share of the effort. */
  worstMiss: number;
  points: Array<{ seconds: number; watts: number; fitted: number }>;
  /** Whether the fit can be trusted; when not, why, in words. */
  ok: boolean;
  problem?: string;
}

/** Fit CP and W′ to best efforts. Needs at least three efforts spanning a five-fold range of lengths. */
export function fitCp(efforts: Array<{ seconds: number; watts: number }>): CpFit | undefined {
  const pts = efforts.filter((e) => e.watts > 0 && FIT_SECONDS.includes(e.seconds)).sort((a, b) => a.seconds - b.seconds);
  if (pts.length < 3 || pts[pts.length - 1].seconds / pts[0].seconds < 5) return undefined;
  const n = pts.length;
  const xs = pts.map((p) => p.seconds), ys = pts.map((p) => p.watts * p.seconds);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const cp = sxy / sxx;
  const wPrime = my - cp * mx;
  const points = pts.map((p) => ({ ...p, fitted: Math.round(cp + wPrime / p.seconds) }));
  const worstMiss = Math.max(...pts.map((p) => Math.abs(p.watts - (cp + wPrime / p.seconds)) / p.watts));
  let problem: string | undefined;
  if (!(cp > 0)) problem = 'the efforts give no sustainable level';
  else if (wPrime < W_PRIME.min) problem = 'the short efforts are barely above the long ones, so the short ones weren’t all-out';
  else if (wPrime > W_PRIME.max) problem = 'the long efforts are too low for the short ones, so the long ones weren’t all-out';
  else if (worstMiss > FIT_TOLERANCE) problem = 'the efforts don’t line up, so not all of them were all-out';
  return { cp: Math.round(cp), wPrime: Math.round(wPrime), ftp: Math.round(cp * FTP_OF_CP), worstMiss: Math.round(worstMiss * 1000) / 1000, points, ok: !problem, problem };
}
