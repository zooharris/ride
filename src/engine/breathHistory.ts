/**
 * Step 2c, Part B (7 Nov 2026): Antogo's own read of the rider's breathing
 * across ordinary rides with the strap. Pure. No AI.
 *
 * Why: a strap that compresses breath size (Todd's VitalPro) shows the second
 * breathing threshold on a ramp through breathing rate, but not the first,
 * which lives mostly in breath size. Steady riding at many efforts, gathered
 * over weeks, shows the shape a ramp cannot.
 *
 * How: each ride with a strap keeps the medians of ventilation, breathing rate,
 * breath size and heart rate in 5%-of-FTP bands (breathAtPower). Here the bands
 * of the last 12 weeks are laid on today's FTP (by watts, so an FTP change
 * between rides is honoured), joined across rides, and read for bends with the
 * same method as the ramp (findBends): ventilation leading, breathing rate as
 * second witness, breath size's peak as a third witness for the first threshold.
 * The first threshold is offered to the rider; a bend near FTP only checks the
 * test's second threshold, never replaces it. When there is too little, it says
 * exactly how many more minutes, at which watts, would be enough to look.
 */
import { addDays } from './load';
import { FINE_BANDS, NORMAL_DAYS, type BreathAtPower } from './breathOffset';
import { CLEAR_BEND, findBends, FLAT_BR_RISE, FLAT_VE_RISE } from './breathThresholds';

/** A band counts with this much riding over at least two rides, or ONE_RIDE_SECONDS from one. */
export const HISTORY_BAND_SECONDS = 480;
export const ONE_RIDE_SECONDS = 900;
/** The first threshold is looked for across these shares of FTP (bands whose middle lies inside), and reported only inside VT1_SHARE. */
export const VT1_LOOK: [number, number] = [0.5, 1.0];
export const VT1_SHARE: [number, number] = [0.55, 0.85];
/** The test's second threshold is checked across these shares, and a bend reported only inside VT2_SHARE. */
export const VT2_LOOK: [number, number] = [0.7, 1.15];
export const VT2_SHARE: [number, number] = [0.9, 1.1];
/** Fewest bands each side of a bend: a band curve has few points. */
export const HISTORY_MIN_SEGMENT = 3;

export interface HistoryRide { date: string; breathAtPower?: BreathAtPower[]; breathOffset?: number; ftpAtBuild?: number }

export interface HistoryBand {
  /** Shares of today's FTP, and the middle in watts. */
  lo: number; hi: number; watts: number;
  seconds: number; rides: number;
  /** Seconds-weighted medians across rides; ventilation and breath size corrected for each day's strap offset. */
  ve: number; br?: number; tv?: number; hr?: number;
  /** Counts toward the read (enough riding). */
  enough: boolean;
}

export interface HistoryVt1 { watts: number; hr?: number; ve: number; br?: number; certainty: 'clear' | 'unsure'; readBy: 've' | 'br' }

export interface BreathHistory {
  /** Rides with breathing in the window, and minutes of breathing in the bands. */
  rides: number; minutes: number;
  bands: HistoryBand[];
  vt1?: HistoryVt1;
  /** Where breath size stopped rising, watts (a witness for the first threshold). */
  tvPeakWatts?: number;
  /** A bend near FTP in the rides: a check on the test's second threshold, watts. */
  vt2Check?: number;
  /** Why there is no first threshold yet, in plain words, with what would be enough. */
  notYet?: string;
}

const ok = (v: number | undefined): v is number => typeof v === 'number' && isFinite(v);

function weightedMedian(pairs: Array<{ v: number; w: number }>): number | undefined {
  const xs = pairs.filter((p) => p.w > 0 && ok(p.v)).sort((a, b) => a.v - b.v);
  const total = xs.reduce((s, p) => s + p.w, 0);
  if (!total) return undefined;
  let acc = 0;
  for (const p of xs) { acc += p.w; if (acc >= total / 2) return p.v; }
  return xs[xs.length - 1].v;
}

/** The bands of today's FTP, joined across rides. */
export function historyBands(rides: HistoryRide[], ftp: number, today: string): { bands: HistoryBand[]; rides: number; minutes: number } {
  const from = addDays(today, -NORMAL_DAYS);
  const used = rides.filter((r) => r.date >= from && r.date <= today && r.breathAtPower?.length);
  const acc = FINE_BANDS.map(() => ({ s: 0, rides: new Set<string>(), perRide: [] as number[], ve: [] as Array<{ v: number; w: number }>, br: [] as Array<{ v: number; w: number }>, tv: [] as Array<{ v: number; w: number }>, hr: [] as Array<{ v: number; w: number }> }));
  let total = 0;
  used.forEach((r, ri) => {
    const rf = r.ftpAtBuild && r.ftpAtBuild > 0 ? r.ftpAtBuild : ftp;
    const off = r.breathOffset && r.breathOffset > 0 ? r.breathOffset : 1;
    for (const b of r.breathAtPower!) {
      // The band's middle in watts as ridden, laid on today's FTP.
      const share = (((b.lo + b.hi) / 2) * rf) / ftp;
      const k = FINE_BANDS.findIndex(([lo, hi]) => share >= lo && share < hi);
      if (k < 0) continue;
      const a = acc[k];
      a.s += b.seconds; total += b.seconds;
      a.rides.add(`${ri}`);
      a.perRide.push(b.seconds);
      a.ve.push({ v: b.ve / off, w: b.seconds });
      if (ok(b.br)) a.br.push({ v: b.br, w: b.seconds });
      if (ok(b.tv)) a.tv.push({ v: b.tv / off, w: b.seconds });
      if (ok(b.hr)) a.hr.push({ v: b.hr, w: b.seconds });
    }
  });
  const bands: HistoryBand[] = [];
  FINE_BANDS.forEach(([lo, hi], k) => {
    const a = acc[k];
    const ve = weightedMedian(a.ve);
    if (ve == null) return;
    const enough = (a.rides.size >= 2 && a.s >= HISTORY_BAND_SECONDS) || Math.max(0, ...a.perRide) >= ONE_RIDE_SECONDS;
    const br = weightedMedian(a.br), tv = weightedMedian(a.tv), hr = weightedMedian(a.hr);
    bands.push({ lo, hi, watts: Math.round(((lo + hi) / 2) * ftp), seconds: Math.round(a.s), rides: a.rides.size, ve: Math.round(ve * 10) / 10, ...(br != null ? { br: Math.round(br * 10) / 10 } : {}), ...(tv != null ? { tv: Math.round(tv * 100) / 100 } : {}), ...(hr != null ? { hr: Math.round(hr) } : {}), enough });
  });
  return { bands, rides: used.length, minutes: Math.round(total / 60) };
}

const mid = (b: { lo: number; hi: number }) => (b.lo + b.hi) / 2;
const inShare = (b: { lo: number; hi: number }, [a, z]: [number, number]) => mid(b) >= a && mid(b) <= z;

/** A curve barely rising from its first quarter to its last (the strap not following), as on the ramp. */
function flatRise(ys: number[], share: number): boolean {
  if (ys.length < 4) return true;
  const q = Math.max(1, Math.floor(ys.length / 4));
  const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return m(ys.slice(-q)) / m(ys.slice(0, q)) - 1 < share;
}

/** Antogo's read of the rider's breathing history. */
export function breathHistory(rides: HistoryRide[], ftp: number, today: string): BreathHistory {
  const { bands, rides: n, minutes } = historyBands(rides, ftp, today);
  const out: BreathHistory = { rides: n, minutes, bands };
  if (ftp <= 0) return out;
  const look = bands.filter((b) => b.enough && inShare(b, VT1_LOOK));

  // The first threshold.
  if (look.length >= 2 * HISTORY_MIN_SEGMENT + 1) {
    const xs = look.map((b) => b.watts);
    const ve = look.map((b) => b.ve);
    const hasBr = look.every((b) => ok(b.br));
    const br = hasBr ? look.map((b) => b.br!) : undefined;
    const opts = { oneBend: true, minSegment: HISTORY_MIN_SEGMENT };
    const veFlat = flatRise(ve, FLAT_VE_RISE / 2);
    const byVe = veFlat ? {} : findBends(xs, ve, opts);
    const byBr = br ? findBends(xs, br, { ...opts, flatStart: true }) : {};
    // Breath size: where it stops rising (its highest band), when it rose at all.
    const tvs = look.map((b) => b.tv);
    if (tvs.every(ok)) {
      const k = tvs.indexOf(Math.max(...(tvs as number[])));
      if (k > 0 && k < look.length - 1) out.tvPeakWatts = look[k].watts;
    }
    const lead = byVe.x1 != null ? { b: byVe, by: 've' as const } : byBr.x1 != null ? { b: byBr, by: 'br' as const } : undefined;
    const step = 0.05 * ftp;
    if (lead && lead.b.x1 != null) {
      const w = lead.b.x1;
      const share = w / ftp;
      if (share >= VT1_SHARE[0] && share <= VT1_SHARE[1]) {
        const other = lead.by === 've' ? byBr.x1 : byVe.x1;
        const agrees = (other != null && Math.abs(other - w) <= step * 1.01) || (out.tvPeakWatts != null && Math.abs(out.tvPeakWatts - w) <= step * 1.01);
        const near = look.reduce((a, b) => (Math.abs(b.watts - w) < Math.abs(a.watts - w) ? b : a));
        out.vt1 = { watts: Math.round(w), hr: near.hr, ve: near.ve, br: near.br != null ? Math.round(near.br) : undefined, certainty: (lead.b.ratio1 ?? 0) >= CLEAR_BEND && agrees ? 'clear' : 'unsure', readBy: lead.by };
      }
    }
    if (!out.vt1) {
      const brFlat = !br || flatRise(br, FLAT_BR_RISE / 2);
      out.notYet = veFlat && brFlat
        ? 'Your breathing barely changes with effort across your rides with the strap, so there is no first threshold to read. Check the strap sits snug.'
        : 'Your rides with the strap don’t show a clear first threshold yet. More easy and steady riding with it will firm it up.';
    }
  }
  if (!out.vt1 && !out.notYet) out.notYet = needsSentence(bands, ftp);

  // The check on the test's second threshold.
  const up = bands.filter((b) => b.enough && inShare(b, VT2_LOOK));
  if (up.length >= 2 * HISTORY_MIN_SEGMENT + 1 && up.every((b) => ok(b.br))) {
    const xs = up.map((b) => b.watts);
    const byBr = findBends(xs, up.map((b) => b.br!), { oneBend: true, flatStart: true, minSegment: HISTORY_MIN_SEGMENT });
    const byVe = findBends(xs, up.map((b) => b.ve), { oneBend: true, minSegment: HISTORY_MIN_SEGMENT });
    const w = byVe.x1 ?? byBr.x1;
    if (w != null && w / ftp >= VT2_SHARE[0] && w / ftp <= VT2_SHARE[1]) out.vt2Check = Math.round(w);
  }
  return out;
}

/**
 * What would be enough to look for the first threshold, in the rider's watts: the bands between 50% and 95% of FTP
 * that are short, with the minutes each still needs, neighbouring short bands joined into one range.
 */
export function needsSentence(bands: HistoryBand[], ftp: number): string {
  const wanted = FINE_BANDS.filter(([lo, hi]) => (lo + hi) / 2 >= VT1_LOOK[0] && (lo + hi) / 2 < 0.95);
  const short: Array<{ lo: number; hi: number; min: number; anotherDay: boolean }> = [];
  for (const [lo, hi] of wanted) {
    const b = bands.find((x) => x.lo === lo && x.hi === hi);
    if (b?.enough) continue;
    const s = b?.seconds ?? 0;
    const min = Math.max(1, Math.ceil((HISTORY_BAND_SECONDS - s) / 60));
    short.push({ lo, hi, min: s >= HISTORY_BAND_SECONDS ? 0 : min, anotherDay: s >= HISTORY_BAND_SECONDS });
  }
  if (!short.length) return 'Your rides with the strap don’t show a clear first threshold yet. More easy and steady riding with it will firm it up.';
  // Join neighbours.
  const runs: Array<{ lo: number; hi: number; min: number; anotherDay: boolean }> = [];
  for (const x of short) {
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.hi - x.lo) < 1e-6 && last.anotherDay === x.anotherDay) { last.hi = x.hi; last.min += x.min; }
    else runs.push({ ...x });
  }
  const w = (s: number) => Math.round(s * ftp);
  const parts = runs.map((r, i) => r.anotherDay
    ? `riding between ${w(r.lo)} and ${w(r.hi)} W on another day`
    : `${r.min} ${i === 0 ? 'more minutes of riding with the strap' : 'more'} between ${w(r.lo)} and ${w(r.hi)} W`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Not enough breathing data yet: ${list} would be enough to look.`;
}
