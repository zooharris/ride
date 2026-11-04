/**
 * Step 4 (3 Nov 2026): the two breathing thresholds from a Ramp Test ridden
 * with a breathing strap, and the zones they suggest. Pure.
 *
 * On a ramp, ventilation (litres of air a minute) climbs in a straight line
 * with power at first, then turns more steeply upward twice: at the first
 * ventilatory threshold (VT1, close to the first lactate threshold, LT1: the
 * top of all-day endurance riding) and at the second (VT2, close to the second
 * lactate threshold, LT2: the threshold an hour's hard riding sits just under).
 * Only a blood test measures lactate; these are the standard stand-ins.
 *
 * Method: the ramp is cut into 15-second pieces; each piece's ventilation is
 * set against the power ridden around 30 seconds earlier (averaged over a
 * minute, so the ramp's one-minute stairs read as the steady rise they are;
 * breathing answers the legs a little late), and three straight lines, joined end to end, are fitted through the points, each
 * steeper than the one before. The two bends are VT1 and VT2. Heart rate and
 * breathing rate are read at the same moments. A bend that is barely a bend is
 * not reported; a test that stopped before the second bend says so.
 */
import { breathingOf } from './breathFreeze';
import { standardBreathPcts } from './zones';

/** Seconds in each piece of the ramp. */
export const BIN_SECONDS = 15;
/** Ventilation is set against the power this many seconds earlier. */
export const LAG_SECONDS = 30;
/** Fewest pieces with breathing for any answer (five minutes of ramp). */
export const MIN_BINS = 20;
/** Fewest pieces in each of the three lines. */
export const MIN_SEGMENT = 4;
/** Each line must be at least this much steeper than the one before for its bend to count. */
export const MIN_BEND = 1.1;
/** A bend this sharp or sharper is clear; between MIN_BEND and this it is less certain. */
export const CLEAR_BEND = 1.25;
/**
 * Review (4 Nov 2026): which threshold a bend is cannot be told from its place
 * on the ramp alone (a ramp that stopped early puts the first threshold where
 * the second usually sits). The heart rate at the bend decides: the second
 * threshold sits at this share of the rider's highest heart rate (the setting
 * or the test's own peak, whichever is higher) or above; the first sits below.
 */
export const VT2_HR_SHARE = 0.86;
/** A bend counts as clear when the three sub-sample fits put it within this share of the top power of the full fit. */
export const STEADY_TOL = 0.08;
/** Where on the ramp each threshold can sit, as shares of the highest power ridden. */
export const VT1_RANGE: [number, number] = [0.4, 0.85];
export const VT2_RANGE: [number, number] = [0.6, 0.98];
/** With no heart rate, the second threshold sits at this share of FTP or above. */
export const VT2_FTP_SHARE = 0.9;

export interface VtPoint {
  /** Power at the threshold, watts. */
  watts: number;
  /** Heart rate there, bpm. */
  hr?: number;
  /** Ventilation there, litres a minute. */
  ve: number;
  /** Breathing rate there, breaths a minute. */
  br?: number;
  /** clear: a sharp bend that the data agree on; unsure: a gentle or unsteady one (a repeat test would firm it up). */
  certainty: 'clear' | 'unsure';
}

export interface BreathTest {
  vt1?: VtPoint;
  vt2?: VtPoint;
  /** The highest 30-second ventilation of the test, litres a minute. */
  peakVe?: number;
  /** The highest 30-second breathing rate of the test. */
  peakBr?: number;
  /** Why a threshold is missing, when one is. */
  missing?: 'no-breathing' | 'patchy' | 'too-short' | 'no-vt1' | 'no-vt2' | 'none';
}

interface Bin { t: number; w: number; ve: number; hr?: number; br?: number }

const ok = (v: number | undefined | null): v is number => typeof v === 'number' && isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Mean of a series over [a, b) seconds, readings that aren't numbers left out. */
function windowMean(time: number[], xs: number[] | undefined, a: number, b: number, positive = false): { value?: number; count: number } {
  if (!xs) return { count: 0 };
  const vals: number[] = [];
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (t < a) continue;
    if (t >= b) break;
    const v = xs[i];
    if (ok(v) && (!positive || v > 0)) vals.push(v);
  }
  return { value: mean(vals), count: vals.length };
}

/**
 * Weighted least squares for y on the given columns (an intercept is the first,
 * all ones); undefined when the columns are degenerate. Ventilation's
 * breath-to-breath swings grow with ventilation, so each point is weighted by
 * one over its square: every point counts by its relative miss, and the noisy
 * top of the ramp cannot drown the gentler first bend.
 */
function ols(cols: number[][], ys: number[]): { coef: number[]; sse: number } | undefined {
  const k = cols.length, n = ys.length;
  const wt = ys.map((y) => 1 / Math.max(1, y) ** 2);
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) { let s = 0; for (let i = 0; i < n; i++) s += wt[i] * cols[r][i] * cols[c][i]; A[r][c] = s; }
    let s = 0; for (let i = 0; i < n; i++) s += wt[i] * cols[r][i] * ys[i]; A[r][k] = s;
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return undefined;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q <= k; q++) A[r][q] -= f * A[c][q]; }
  }
  const coef = A.map((row, r) => row[k] / row[r]);
  let sse = 0;
  for (let i = 0; i < n; i++) { let y = 0; for (let r = 0; r < k; r++) y += coef[r] * cols[r][i]; sse += wt[i] * (ys[i] - y) ** 2; }
  return { coef, sse };
}

/** Where the bends are: the power at each (watts) and how many times steeper the line gets there. */
export interface Bends { x1?: number; x2?: number; ratio1?: number; ratio2?: number }

/**
 * The best fit of ys against xs by straight lines joined end to end (no jumps),
 * each at least MIN_BEND times steeper than the one before: three lines (two
 * bends) when the second bend earns its place, otherwise two (one bend).
 * Bends are tried at each point, with at least MIN_SEGMENT points on every
 * line. Exported for the tests.
 */
export function findBends(xs: number[], ys: number[]): Bends {
  const n = xs.length;
  if (n < 2 * MIN_SEGMENT) return {};
  const ones = xs.map(() => 1);
  const hinge = (k: number) => xs.map((x) => Math.max(0, x - xs[k]));
  const top = Math.max(...xs);
  // The two thresholds sit well apart on any ramp (VT1 is typically 70-80% of VT2's power): the middle line spans at least an eighth of the highest power.
  const minMiddle = top / 8;
  // Review (4 Nov 2026): bends are looked for only where a threshold can sit (the first at 40-85% of the top power, the second at 60-98%),
  // so the settling-in after the warm-up or a wobble near the top cannot take a real bend's place.
  const firstOk = (x: number) => x >= VT1_RANGE[0] * top && x <= VT1_RANGE[1] * top;
  const secondOk = (x: number) => x >= VT2_RANGE[0] * top && x <= VT2_RANGE[1] * top;
  let best3: { sse: number; i: number; j: number; r1: number; r2: number } | undefined;
  let best2: { sse: number; i: number; r: number } | undefined;
  for (let i = MIN_SEGMENT; i <= n - MIN_SEGMENT; i++) {
    if (!firstOk(xs[i]) && !secondOk(xs[i])) continue;
    const hi = hinge(i);
    const two = ols([ones, xs, hi], ys);
    if (two) {
      const [, b, c] = two.coef;
      const r = (b + c) / b;
      if (b > 0 && r >= MIN_BEND && (!best2 || two.sse < best2.sse)) best2 = { sse: two.sse, i, r };
    }
    if (!firstOk(xs[i])) continue;
    for (let j = i + MIN_SEGMENT; j <= n - MIN_SEGMENT; j++) {
      if (xs[j] - xs[i] < minMiddle || !secondOk(xs[j])) continue;
      const three = ols([ones, xs, hi, hinge(j)], ys);
      if (!three) continue;
      const [, b, c, d] = three.coef;
      const r1 = (b + c) / b, r2 = (b + c + d) / (b + c);
      if (!(b > 0) || !(b + c > 0) || r1 < MIN_BEND || r2 < MIN_BEND) continue;
      if (!best3 || three.sse < best3.sse) best3 = { sse: three.sse, i, j, r1, r2 };
    }
  }
  // Two bends only when the second earns its place: it removes at least a sixth of the one-bend error.
  if (best3 && (!best2 || best3.sse <= best2.sse * (5 / 6))) return { x1: xs[best3.i], x2: xs[best3.j], ratio1: best3.r1, ratio2: best3.r2 };
  if (best2) return { x1: xs[best2.i], ratio1: best2.r };
  return {};
}

/**
 * The breathing thresholds of a ramp from one-second streams. `from` and `to`
 * are the ramp's first and last seconds (the warm-up and cool-down are left
 * out). Undefined when the ride has no breathing at all.
 */
export function breathThresholds(o: { time: number[]; watts?: number[]; hr?: number[]; ve?: number[]; br?: number[]; from: number; to: number; ftp?: number; maxHr?: number }): BreathTest | undefined {
  if (!o.ve?.some((v) => ok(v) && v > 0)) return undefined;
  if (!o.watts?.length) return { missing: 'no-breathing' };
  const s = breathingOf({ time: o.time, ve: o.ve, br: o.br });
  const time = o.time;
  const bins: Bin[] = [];
  let tried = 0;
  // Breathing is read only up to the ramp's end: once the cool-down starts it falls, and pairing it with the last
  // half-minute's power would bend the top of the line down.
  for (let a = o.from + LAG_SECONDS; a + BIN_SECONDS <= o.to; a += BIN_SECONDS) {
    tried++;
    const ve = windowMean(time, s.ve, a, a + BIN_SECONDS, true);
    // A minute of power around the moment 30 seconds earlier: smooths the ramp's one-minute stairs into the rise breathing follows.
    const mid = a + BIN_SECONDS / 2 - LAG_SECONDS;
    const w = windowMean(time, o.watts, mid - 30, Math.min(mid + 30, o.to), true);
    if (!ok(ve.value) || ve.count < BIN_SECONDS / 2 || !ok(w.value)) continue;
    const hr = windowMean(time, o.hr, a, a + BIN_SECONDS, true).value;
    const br = windowMean(time, s.br, a, a + BIN_SECONDS, true).value;
    bins.push({ t: a, w: w.value, ve: ve.value, hr, br });
  }
  const peak = peaks(time, s.ve, s.br, o.from, o.to + 60);
  const peakHr = peakOf(time, o.hr, o.from, o.to + 60);
  if (tried < MIN_BINS) return { ...peak, missing: 'too-short' };
  if (bins.length < MIN_BINS) return { ...peak, missing: 'patchy' };
  if (bins.length < tried * 0.7) return { ...peak, missing: 'patchy' };

  // Breath-to-breath swings are large; a 45-second running mean steadies the line the bends are read from.
  const smooth = bins.map((_, k) => mean(bins.slice(Math.max(0, k - 1), k + 2).map((b) => b.ve))!);
  const xs = bins.map((b) => b.w);
  const bends = findBends(xs, smooth);
  const top = Math.max(...xs);
  // Steadiness (review, 4 Nov 2026): fitted again on every third piece, unsmoothed (three samples that share no readings, so
  // their agreement means something), a well-defined bend lands within 8% of the top power of where it did on each of them.
  // On simulated ramps with breath-by-breath noise this makes "clear" rare but right; the two-half check on the smoothed
  // line it replaces called a bend clear when it was 30-40 W out about a third of the time.
  const raw = bins.map((b) => b.ve);
  const subs = [0, 1, 2].map((h) => findBends(xs.filter((_, k) => k % 3 === h), raw.filter((_, k) => k % 3 === h)));
  const steady = (x: number) => subs.every((sb) => [sb.x1, sb.x2].some((y) => y != null && Math.abs(y - x) <= top * STEADY_TOL));
  // A threshold's heart rate, ventilation and breathing rate: read from the pieces either side of the bend's power.
  // A bend read across a hole in the strap's readings (no piece for more than two pieces' time, close to the bend) is not certain.
  const gapped = (watts: number) => {
    const near = bins.filter((b) => Math.abs(b.w - watts) <= top * 0.1);
    return near.some((b, k) => k > 0 && b.t - near[k - 1].t > 2 * BIN_SECONDS);
  };
  const at = (watts: number, ratio: number): VtPoint => {
    const k = Math.max(1, bins.findIndex((b) => b.w >= watts));
    const pair = [bins[k - 1], bins[k]].filter(Boolean);
    const hrs = pair.map((b) => b.hr).filter(ok), brs = pair.map((b) => b.br).filter(ok);
    return {
      watts: Math.round(watts),
      hr: hrs.length ? Math.round(mean(hrs)!) : undefined,
      ve: Math.round(mean(pair.map((_, q) => smooth[k - 1 + q]))! * 10) / 10,
      br: brs.length ? Math.round(mean(brs)!) : undefined,
      certainty: ratio >= CLEAR_BEND && steady(watts) && !gapped(watts) ? 'clear' : 'unsure',
    };
  };
  // Where on the ramp each threshold can plausibly sit, as shares of the highest power ridden.
  const vt1Ok = (p: VtPoint) => p.watts >= top * VT1_RANGE[0] && p.watts <= top * VT1_RANGE[1];
  const vt2Ok = (p: VtPoint) => p.watts >= top * VT2_RANGE[0] && p.watts <= top * VT2_RANGE[1];
  // Is this bend the second threshold? By heart rate against the rider's highest (the setting or this test's peak,
  // whichever is higher), else by power against FTP; undefined when there is nothing to judge by.
  const hrRef = Math.max(o.maxHr ?? 0, peakHr ?? 0);
  const looksVt2 = (p: VtPoint): boolean | undefined =>
    p.hr != null && hrRef > 0 ? p.hr >= VT2_HR_SHARE * hrRef
      : o.ftp && o.ftp > 0 ? p.watts >= VT2_FTP_SHARE * o.ftp
      : undefined;
  const unsure = (p: VtPoint): VtPoint => ({ ...p, certainty: 'unsure' });
  let vt1: VtPoint | undefined, vt2: VtPoint | undefined;
  if (bends.x1 != null && bends.x2 != null) {
    const a = at(bends.x1, bends.ratio1!), b = at(bends.x2, bends.ratio2!);
    const bIs2 = looksVt2(b);
    if (bIs2 === false) {
      // The upper bend is only the first threshold (the ramp stopped before the second): the lower one is the settling-in after
      // the warm-up, or the first threshold itself with the upper one noise. Too little ramp above it to be sure either way.
      if (vt1Ok(b)) vt1 = unsure(b);
    } else if (looksVt2(a) === true) {
      // Both bends sit at threshold heart rate: the lower is the second threshold, the upper noise above it.
      if (vt2Ok(a)) vt2 = a;
    } else {
      if (vt1Ok(a)) vt1 = a;
      if (vt2Ok(b)) vt2 = b;
    }
  } else if (bends.x1 != null) {
    const a = at(bends.x1, bends.ratio1!);
    const is2 = looksVt2(a);
    if (is2 === true) { if (vt2Ok(a)) vt2 = a; else if (vt1Ok(a)) vt1 = a; }
    else if (is2 === false) { if (vt1Ok(a)) vt1 = a; }
    // Nothing to judge by: the upper part of the ramp makes it the second threshold, the lower the first, and neither is certain.
    else if (a.watts >= top * 0.7 && vt2Ok(a)) vt2 = unsure(a);
    else if (vt1Ok(a)) vt1 = unsure(a);
  }
  if (vt1 && vt2 && vt2.watts <= vt1.watts) vt2 = undefined;
  const missing = vt1 && vt2 ? undefined : !vt1 && !vt2 ? 'none' : !vt1 ? 'no-vt1' : 'no-vt2';
  return { vt1, vt2, ...peak, missing };
}

/** The highest 30-second mean of a series in [from, to), at least 15 readings in the half-minute. */
function peakOf(time: number[], xs: number[] | undefined, from: number, to: number): number | undefined {
  let top: number | undefined;
  for (let a = from; a + 30 <= to; a += 5) {
    const m = windowMean(time, xs, a, a + 30, true);
    if (ok(m.value) && m.count >= 15 && (top == null || m.value > top)) top = m.value;
  }
  return top;
}

/** The highest 30-second ventilation and breathing rate in [from, to). */
function peaks(time: number[], ve: number[] | undefined, br: number[] | undefined, from: number, to: number): Pick<BreathTest, 'peakVe' | 'peakBr'> {
  const v = peakOf(time, ve, from, to), b = peakOf(time, br, from, to);
  return { peakVe: v != null ? Math.round(v) : undefined, peakBr: b != null ? Math.round(b) : undefined };
}

// ── Zones from a test ──────────────────────────────────────────────────────

export interface TestZones {
  /** Power zone 1-6 tops, watts. */
  powerTops?: number[];
  /** Heart-rate zone 1-6 tops, bpm. */
  hrTops?: number[];
  /** Breathing: the two thresholds and zone 1-4 tops as % of VT2. */
  vt1Ve?: number;
  vt2Ve?: number;
  breathPcts?: number[];
}

const rising = (xs: number[]) => xs.every((x, i) => x > 0 && (i === 0 || x > xs[i - 1]));

/**
 * The zone tables a test suggests, anchored on its thresholds:
 * power and heart rate zone 2 top at VT1, zone 3 top half-way to VT2, zone 4
 * top at VT2, zone 1 top below VT1 in the standard proportion; zones 5 and 6,
 * which a breathing test cannot see, keep the rider's own shares of the
 * threshold (the new FTP, or the heart rate at VT2), heart rate kept below max.
 * A table that cannot be built in rising order is left out.
 */
export function zonesFromTest(bt: BreathTest | undefined, o: { ftp?: number; lthr?: number; maxHr?: number; powerPcts: number[]; hrPcts: number[] }): TestZones {
  const out: TestZones = {};
  const vt1 = bt?.vt1, vt2 = bt?.vt2;
  if (!vt1 || !vt2) return out;
  const ftp = o.ftp && o.ftp > 0 ? o.ftp : vt2.watts;
  // Zone 1's top sits below VT1 in the rider's own proportion of zone 1 to zone 2 (the standard ladders give 0.73 for power, 0.92 for heart rate).
  const share = (pcts: number[], fallback: number) => (pcts[0] > 0 && pcts[1] > pcts[0] ? pcts[0] / pcts[1] : fallback);
  const p = [Math.round(vt1.watts * share(o.powerPcts, 0.73)), vt1.watts, Math.round((vt1.watts + vt2.watts) / 2), vt2.watts, Math.round(ftp * o.powerPcts[4] / 100), Math.round(ftp * o.powerPcts[5] / 100)];
  if (p[4] <= p[3]) p[4] = Math.round(p[3] * 1.12);
  if (p[5] <= p[4]) p[5] = Math.round(p[4] * 1.25);
  if (rising(p)) out.powerTops = p;
  if (vt1.hr && vt2.hr && vt2.hr > vt1.hr) {
    const lthr = vt2.hr;
    const h = [Math.round(vt1.hr * share(o.hrPcts, 0.92)), vt1.hr, Math.round((vt1.hr + vt2.hr) / 2), vt2.hr, Math.round(lthr * o.hrPcts[4] / 100), Math.round(lthr * o.hrPcts[5] / 100)];
    const cap = o.maxHr && o.maxHr > 0 ? o.maxHr - 1 : Infinity;
    h[4] = Math.min(h[4], cap - 1);
    h[5] = Math.min(h[5], cap);
    if (h[4] <= h[3]) h[4] = h[3] + 1;
    if (h[5] <= h[4]) h[5] = h[4] + 1;
    if (rising(h) && h[5] <= cap) out.hrTops = h;
  }
  const bp = standardBreathPcts(vt1.ve, vt2.ve);
  if (bp) { out.vt1Ve = vt1.ve; out.vt2Ve = vt2.ve; out.breathPcts = bp; }
  return out;
}
