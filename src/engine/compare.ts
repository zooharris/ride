import { addDays } from './load';
import type { Cadence, Values } from './measures';

/**
 * The sums behind the large Progress view's panels (12 Nov 2026, A5 and A6): pairing two measures day by day (or
 * week by week) with one slid against the other, how closely they move together, the two ends of the other
 * measure, and a range's low, high, average and change. All plain arithmetic on the rider's own numbers; the
 * thresholds are general and stated where they are used.
 */

export interface Pair { key: string; x: number; y: number }

/** Days (or weeks) needed where both measures have a value before anything is said about them together. */
export const MIN_PAIRED: Record<Cadence, number> = { day: 30, week: 12 };

/** The mean of a daily measure over each week, keyed by the week's first day. */
export function weekly(values: Values, weekStartOf: (d: string) => string): Values {
  const acc = new Map<string, { s: number; n: number }>();
  for (const [d, v] of values) { const w = weekStartOf(d); const a = acc.get(w) ?? { s: 0, n: 0 }; a.s += v; a.n++; acc.set(w, a); }
  return new Map([...acc].map(([w, a]) => [w, a.s / a.n]));
}

/**
 * The other measure as drawn after a slide of `slide` days (or weeks): positive moves it later, so each day of
 * the measure viewed is read against the other's value from `slide` days before.
 */
export function slid(values: Values, slide: number, cadence: Cadence): Values {
  if (!slide) return values;
  const step = cadence === 'week' ? 7 : 1;
  return new Map([...values].map(([k, v]) => [addDays(k, slide * step), v]));
}

/**
 * The viewed measure (y) and the other (x), slid by `slide` of its own steps, paired over [from, to]. Two daily
 * measures pair day by day; when either is weekly, both are taken by the week (a daily measure as its weekly mean).
 */
export function pairUp(view: Values, viewCad: Cadence, other: Values, otherCad: Cadence, slide: number, from: string, to: string, weekStartOf: (d: string) => string): { pairs: Pair[]; cadence: Cadence } {
  const cadence: Cadence = viewCad === 'week' || otherCad === 'week' ? 'week' : 'day';
  const y = cadence === 'week' && viewCad === 'day' ? weekly(view, weekStartOf) : view;
  // The slide is in the other measure's own steps (days for a daily one, weeks for a weekly one), applied before
  // a daily measure is taken by the week.
  const x1 = slid(other, slide, otherCad);
  const x = cadence === 'week' && otherCad === 'day' ? weekly(x1, weekStartOf) : x1;
  const lo = cadence === 'week' ? weekStartOf(from) : from;
  const pairs: Pair[] = [];
  for (const [k, yv] of y) {
    if (k < lo || k > to) continue;
    const xv = x.get(k);
    if (xv != null && isFinite(xv) && isFinite(yv)) pairs.push({ key: k, x: xv, y: yv });
  }
  pairs.sort((a, b) => a.key.localeCompare(b.key));
  return { pairs, cadence };
}

/** The ordinary (Pearson) correlation; undefined when either side does not vary. */
export function correlation(pairs: Pair[]): number | undefined {
  const n = pairs.length;
  if (n < 3) return undefined;
  let sx = 0, sy = 0;
  for (const p of pairs) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let cxy = 0, cxx = 0, cyy = 0;
  for (const p of pairs) { const dx = p.x - mx, dy = p.y - my; cxy += dx * dy; cxx += dx * dx; cyy += dy * dy; }
  if (cxx <= 0 || cyy <= 0) return undefined;
  return cxy / Math.sqrt(cxx * cyy);
}

/** The strength of a link in words (A6.3): boundaries at 0.2, 0.4 and 0.6. The number is never shown. */
export function linkWords(r: number | undefined): string {
  const a = Math.abs(r ?? 0);
  return a < 0.2 ? 'little or no link' : a < 0.4 ? 'a weak link' : a < 0.6 ? 'a moderate link' : 'a strong link';
}

/** A straight line through the dots (least squares), for the small chart. */
export function trendLine(pairs: Pair[]): { slope: number; intercept: number } | undefined {
  const n = pairs.length;
  if (n < 3) return undefined;
  const mx = pairs.reduce((a, p) => a + p.x, 0) / n, my = pairs.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pairs) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
  if (den <= 0) return undefined;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

export interface Ends { n: number; lowX: number; highX: number; lowY: number; highY: number; avgY: number }

/**
 * The viewed measure on the fifth of days where the other was lowest and the fifth where it was highest (A6.4),
 * and its average over every paired day. A tie at the boundary is broken by date, the earlier first.
 */
export function ends(pairs: Pair[]): Ends | undefined {
  if (pairs.length < 5) return undefined;
  const sorted = [...pairs].sort((a, b) => a.x - b.x || a.key.localeCompare(b.key));
  const n = Math.floor(sorted.length / 5);
  const mean = (xs: Pair[], k: 'x' | 'y') => xs.reduce((a, p) => a + p[k], 0) / xs.length;
  const low = sorted.slice(0, n), high = sorted.slice(-n);
  return { n, lowX: mean(low, 'x'), highX: mean(high, 'x'), lowY: mean(low, 'y'), highY: mean(high, 'y'), avgY: mean(sorted, 'y') };
}

export interface RangeSummary { n: number; low: number; high: number; avg: number; lowAt: string; highAt: string; change?: number }

/**
 * Low, high and average over a range, and the change from its start to its end: for a daily measure the
 * average of the first seven days with a value against the last seven (one morning is too noisy to compare); for
 * a weekly one, the first week against the last.
 */
export function summary(points: Array<[string, number]>, cadence: Cadence): RangeSummary | undefined {
  if (!points.length) return undefined;
  let low = points[0], high = points[0], s = 0;
  for (const p of points) { if (p[1] < low[1]) low = p; if (p[1] > high[1]) high = p; s += p[1]; }
  const k = cadence === 'week' ? 1 : 7;
  let change: number | undefined;
  if (points.length >= 2 * k) {
    const m = (xs: Array<[string, number]>) => xs.reduce((a, p) => a + p[1], 0) / xs.length;
    change = m(points.slice(-k)) - m(points.slice(0, k));
  }
  return { n: points.length, low: low[1], high: high[1], avg: s / points.length, lowAt: low[0], highAt: high[0], change };
}

/** A measure's average over [from, to], or undefined with no value in it. */
export function meanOver(values: Values, from: string, to: string): number | undefined {
  let s = 0, n = 0;
  for (const [k, v] of values) if (k >= from && k <= to) { s += v; n++; }
  return n ? s / n : undefined;
}

/** "the day before", "3 days after", "the week before": what a slide means, for the words beside it. */
export function slideWords(slide: number, cadence: Cadence): string {
  const unit = cadence === 'week' ? 'week' : 'day';
  if (!slide) return `the same ${unit}`;
  const n = Math.abs(slide);
  const when = slide > 0 ? 'before' : 'after';
  return n === 1 ? `the ${unit} ${when}` : `${n} ${unit}s ${when}`;
}
