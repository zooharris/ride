/**
 * The breathing strap's day-to-day offset (Step 3 Part 2, 2A, 31 Oct 2026).
 * How tight the strap sits shifts its reading a few percent from day to day.
 * Antogo learns the rider's normal ventilation at each effort from their rides,
 * and, early in a ride, how far today's reading sits from it, so that later
 * steps (breathing zones, riding by breathing) can correct before judging.
 * Nothing here is shown on a screen. Pure.
 *
 * Breathing reaches these functions through breathingOf (breathFreeze), so a
 * frozen stretch is never learned from.
 */
import { BANDS, SKIP_SECONDS } from './hrPower';
import { addDays } from './load';
import { isPlaceholder } from './breathThresholds';

/** A band needs this much riding in one ride to count. */
export const VE_BAND_FLOOR = 180;
/** The normal is learned from the last 12 weeks. */
export const NORMAL_DAYS = 84;
/** A band of the normal is used for today's offset only with this much riding behind it. */
export const NORMAL_BAND_SECONDS = 600;
/** Today's offset: steady riding after the first 4 minutes, 6 minutes of it. */
export const OFFSET_SKIP = 240;
export const OFFSET_SECONDS = 360;
export const OFFSET_CLAMP: [number, number] = [0.85, 1.15];

export interface VeAtPower { lo: number; hi: number; seconds: number; ve: number }
/** Step 2c (7 Nov 2026): one fine band's breathing on one ride (medians, seconds-weighted); shares of the FTP the ride was read against. */
export interface BreathAtPower { lo: number; hi: number; seconds: number; ve: number; br?: number; tv?: number; hr?: number }

/** Step 2c: the fine bands, 5% of FTP wide from 45% to 115% (14). */
export const FINE_BANDS: Array<[number, number]> = Array.from({ length: 14 }, (_, k) => [Math.round((0.45 + k * 0.05) * 100) / 100, Math.round((0.5 + k * 0.05) * 100) / 100]);
/** Step 2c: a fine band needs this much riding in one ride to count. */
export const FINE_BAND_FLOOR = 120;
/** A second counts toward a band only once power has sat in that band this long (breathing lags the legs; the ramp read uses the same lag). */
export const STEADY_SECONDS = 30;

/**
 * Step 2c (7 Nov 2026): median ventilation, breathing rate, breath size and heart rate in each 5% band of FTP,
 * after the first 10 minutes, the strap's placeholder readings left out. Breathing reaches here through
 * breathingOf, so frozen stretches are already cut. Ventilation and breath size are as the strap read them (the
 * day's offset is applied when the history is read); breathing rate needs none.
 */
export function breathAtPower(time: number[], watts: number[] | undefined, ve: number[] | undefined, br: number[] | undefined, tv: number[] | undefined, hr: number[] | undefined, ftp: number): BreathAtPower[] {
  if (!watts?.length || !ve?.length || ftp <= 0) return [];
  const n = Math.min(time.length, watts.length, ve.length);
  const per = FINE_BANDS.map(() => ({ ve: [] as Array<{ v: number; w: number }>, br: [] as Array<{ v: number; w: number }>, tv: [] as Array<{ v: number; w: number }>, hr: [] as Array<{ v: number; w: number }>, s: 0 }));
  // Steady state only: the band power has been in, and since when.
  let inBand = -1, since = 0;
  for (let i = 0; i < n; i++) {
    const w = watts[i];
    const k = w > 0 ? FINE_BANDS.findIndex(([lo, hi]) => w / ftp >= lo && w / ftp < hi) : -1;
    if (k !== inBand) { inBand = k; since = time[i]; }
    if (time[i] < SKIP_SECONDS || k < 0 || time[i] - since < STEADY_SECONDS) continue;
    const v = ve[i], dt = dtAt(time, i, n);
    if (!ok(v) || v <= 0 || dt <= 0) continue;
    if (isPlaceholder(v, br?.[i], tv?.[i])) continue;
    const b = per[k];
    b.s += dt;
    b.ve.push({ v, w: dt });
    const r = br?.[i], t = tv?.[i], h = hr?.[i];
    if (ok(r) && r > 0) b.br.push({ v: r, w: dt });
    if (ok(t) && t > 0) b.tv.push({ v: t, w: dt });
    if (ok(h) && h > 0) b.hr.push({ v: h, w: dt });
  }
  const r1 = (x: number | undefined) => (x != null ? Math.round(x * 10) / 10 : undefined);
  const r2 = (x: number | undefined) => (x != null ? Math.round(x * 100) / 100 : undefined);
  const out: BreathAtPower[] = [];
  FINE_BANDS.forEach(([lo, hi], k) => {
    const b = per[k];
    if (b.s < FINE_BAND_FLOOR) return;
    const veM = weightedMedian(b.ve);
    if (veM == null) return;
    const brM = weightedMedian(b.br), tvM = weightedMedian(b.tv), hrM = weightedMedian(b.hr);
    out.push({ lo, hi, seconds: Math.round(b.s), ve: r1(veM)!, ...(brM != null ? { br: r1(brM) } : {}), ...(tvM != null ? { tv: r2(tvM) } : {}), ...(hrM != null ? { hr: Math.round(hrM) } : {}) });
  });
  return out;
}
export interface BreathNormal { ftp: number; bands: Array<{ lo: number; hi: number; ve: number; seconds: number }>; rides: number; updated: string }

const ok = (v: number | undefined): v is number => typeof v === 'number' && isFinite(v);

/** Seconds a sample stands for: to the next, at most 5 (a pause is not riding). */
const dtAt = (time: number[], i: number, n: number) => (i + 1 < n ? Math.min(5, Math.max(0, time[i + 1] - time[i])) : 1);

function weightedMedian(pairs: Array<{ v: number; w: number }>): number | undefined {
  const xs = pairs.filter((p) => p.w > 0 && ok(p.v)).sort((a, b) => a.v - b.v);
  const total = xs.reduce((s, p) => s + p.w, 0);
  if (!total) return undefined;
  let acc = 0;
  for (const p of xs) { acc += p.w; if (acc >= total / 2) return p.v; }
  return xs[xs.length - 1].v;
}

/** One ride: median ventilation in each power band (shares of FTP), after minute 10; a band under 3 minutes is dropped. */
export function veAtPower(time: number[], watts: number[] | undefined, ve: number[] | undefined, ftp: number): VeAtPower[] {
  if (!watts?.length || !ve?.length || ftp <= 0) return [];
  const n = Math.min(time.length, watts.length, ve.length);
  const per = BANDS.map(() => [] as Array<{ v: number; w: number }>);
  for (let i = 0; i < n; i++) {
    if (time[i] < SKIP_SECONDS) continue;
    const w = watts[i], v = ve[i], dt = dtAt(time, i, n);
    if (!(w > 0) || !ok(v) || v <= 0 || dt <= 0) continue;
    const k = BANDS.findIndex(([lo, hi]) => w / ftp >= lo && w / ftp < hi);
    if (k >= 0) per[k].push({ v, w: dt });
  }
  return BANDS.map(([lo, hi], k) => {
    const seconds = per[k].reduce((s, p) => s + p.w, 0);
    const m = weightedMedian(per[k]);
    return { lo, hi, seconds: Math.round(seconds), ve: m != null ? Math.round(m * 10) / 10 : 0 };
  }).filter((b) => b.seconds >= VE_BAND_FLOOR);
}

/**
 * The rider's normal: for each band, the median of the rides' band medians
 * over the last 12 weeks, weighted by the seconds each ride spent there.
 * Undefined when no ride has breathing.
 */
export function learnNormal(records: Array<{ date: string; veAtPower?: VeAtPower[] }>, ftp: number, today: string): BreathNormal | undefined {
  const from = addDays(today, -NORMAL_DAYS);
  const recent = records.filter((r) => r.date >= from && r.date <= today && r.veAtPower?.length);
  if (!recent.length) return undefined;
  const bands = BANDS.map(([lo, hi]) => {
    const pairs = recent.flatMap((r) => r.veAtPower!.filter((b) => b.lo === lo).map((b) => ({ v: b.ve, w: b.seconds })));
    const ve = weightedMedian(pairs);
    return { lo, hi, ve: ve ?? 0, seconds: pairs.reduce((s, p) => s + p.w, 0) };
  }).filter((b) => b.seconds > 0);
  return { ftp, bands, rides: recent.length, updated: today };
}

/**
 * Today's offset: once the ride has 6 minutes of steady riding after the first
 * 4 (power within ±10% of its 2-minute average) in bands the normal covers
 * with 10 minutes or more, the median of measured ÷ normal over those
 * seconds, clamped to 0.85–1.15. Undefined with less.
 */
export function todayOffset(time: number[], watts: number[] | undefined, ve: number[] | undefined, normal: BreathNormal | undefined, ftp: number): number | undefined {
  if (!normal || !watts?.length || !ve?.length || ftp <= 0) return undefined;
  const usable = normal.bands.filter((b) => b.seconds >= NORMAL_BAND_SECONDS && b.ve > 0);
  if (!usable.length) return undefined;
  const n = Math.min(time.length, watts.length, ve.length);
  // A 2-minute trailing mean of power, kept as a running window.
  let lo = 0, sum = 0, count = 0, have = 0;
  const ratios: Array<{ v: number; w: number }> = [];
  for (let i = 0; i < n; i++) {
    const w = watts[i];
    if (ok(w)) { sum += w; count++; }
    while (time[i] - time[lo] > 120) { if (ok(watts[lo])) { sum -= watts[lo]; count--; } lo++; }
    if (time[i] < OFFSET_SKIP || !count) continue;
    const avg = sum / count;
    const v = ve[i];
    if (!(w > 0) || !ok(v) || v <= 0 || Math.abs(w - avg) > avg * 0.1) continue;
    const band = usable.find((b) => w / ftp >= b.lo && w / ftp < b.hi);
    if (!band) continue;
    const dt = dtAt(time, i, n);
    ratios.push({ v: v / band.ve, w: dt });
    have += dt;
    if (have >= OFFSET_SECONDS) break;
  }
  if (have < OFFSET_SECONDS) return undefined;
  const m = weightedMedian(ratios)!;
  return Math.round(Math.min(OFFSET_CLAMP[1], Math.max(OFFSET_CLAMP[0], m)) * 1000) / 1000;
}
