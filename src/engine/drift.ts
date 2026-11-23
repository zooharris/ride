/**
 * Heart-rate drift, by one rule everywhere (22 Nov 2026): on an activity's page, in what the coach reads and on
 * Progress. Power per heartbeat in the first half of the steady riding against the second half, in percent; positive
 * when heart rate rose for the same power. The warm-up (the first ten minutes) is skipped, only seconds with both
 * pedalling (power above zero) and heart rate count, and there must be half an hour of them.
 */
export const DRIFT_SKIP = 600;
export const DRIFT_STEADY_MIN = 1800;

/** Seconds each reading stands for: the gap to the next, at most 5 (a longer gap is a stop, not riding). */
function dts(time: number[], n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i + 1 < n ? Math.min(5, Math.max(0, time[i + 1] - time[i])) : 1;
  return out;
}

export function hrDrift(time: number[], watts: Array<number | null | undefined> | undefined, hr: Array<number | null | undefined> | undefined): number | undefined {
  if (!watts?.length || !hr?.length) return undefined;
  const n = Math.min(time.length, watts.length, hr.length);
  const d = dts(time, n);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (time[i] >= DRIFT_SKIP && d[i] > 0 && (watts[i] ?? 0) > 0 && (hr[i] ?? 0) > 0) idx.push(i);
  const total = idx.reduce((t, i) => t + d[i], 0);
  if (total < DRIFT_STEADY_MIN) return undefined;
  let acc = 0, p1 = 0, h1 = 0, p2 = 0, h2 = 0;
  for (const i of idx) {
    const first = acc < total / 2; acc += d[i];
    if (first) { p1 += watts[i]! * d[i]; h1 += hr[i]! * d[i]; } else { p2 += watts[i]! * d[i]; h2 += hr[i]! * d[i]; }
  }
  if (!h1 || !h2 || !p1) return undefined;
  const ef1 = p1 / h1, ef2 = p2 / h2;
  return Math.round(((ef1 - ef2) / ef1) * 1000) / 10;
}
