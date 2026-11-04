/**
 * Part A (4 Nov 2026): was a Ramp Test all-out, and did it go past the second
 * breathing threshold? One judgement per ramp, made by weighing several
 * witnesses rather than by one cut-off (the 86%-of-max-heart-rate rule it
 * replaces turned on fractions of a beat). Each witness is weak alone; together
 * they are reliable. The witness lines are kept for the coach, never shown to
 * the rider. Pure.
 */

export type Verdict3 = 'yes' | 'probably' | 'no';

export interface RampJudgement {
  allOut?: Verdict3;
  pastVt2?: Verdict3;
  /** One plain line per witness that spoke, for the coach. */
  lines: string[];
}

export interface RampJudgeInput {
  /** One-second series; NaN or undefined where there is no reading. */
  time: number[];
  watts?: Array<number | undefined>;
  hr?: Array<number | undefined>;
  /** Ventilation with placeholder readings already removed. */
  ve?: Array<number | undefined>;
  /** The ramp's first and last seconds. */
  from: number;
  to: number;
  /** Peak power of the ramp (last full step plus the share of the unfinished one), watts. */
  peakWatts?: number;
  stepWatts?: number;
  endedBy?: 'rider' | 'auto';
  /** The rider's settings. */
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  /** The highest 30-second heart rate seen in the rider's activities of the last 12 months. */
  learnedMaxHr?: number;
  /** FTP from the critical-power fit of recent riding, only when that fit passed its own check. */
  cpFtp?: number;
}

const ok = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** The highest mean of `secs` seconds of readings in [from, to), at least two thirds of them present. */
export function bestMean(time: number[], xs: Array<number | undefined> | undefined, from: number, to: number, secs = 30): number | undefined {
  if (!xs) return undefined;
  let top: number | undefined;
  const win: number[] = [];
  let sum = 0;
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    if (t < from) continue;
    if (t >= to) break;
    const v = xs[i];
    win.push(ok(v) ? v : NaN);
    if (ok(v)) sum += v;
    if (win.length > secs) { const out = win.shift()!; if (ok(out)) sum -= out; }
    if (win.length === secs) {
      const n = win.filter(ok).length;
      if (n >= (secs * 2) / 3) { const m = sum / n; if (top == null || m > top) top = m; }
    }
  }
  return top;
}

/** Mean of readings in [a, b). */
function meanIn(time: number[], xs: Array<number | undefined> | undefined, a: number, b: number): number | undefined {
  if (!xs) return undefined;
  let s = 0, n = 0;
  for (let i = 0; i < time.length; i++) { const t = time[i]; if (t < a) continue; if (t >= b) break; const v = xs[i]; if (ok(v)) { s += v; n++; } }
  return n ? s / n : undefined;
}

interface Vote { name: string; weight: number; allOut?: number; past?: number; line: string }

const verdict = (score: number): Verdict3 => (score >= 0.5 ? 'yes' : score >= 0.15 ? 'probably' : 'no');

export function judgeRamp(o: RampJudgeInput): RampJudgement {
  const votes: Vote[] = [];
  const { time } = o;
  const peakHr = bestMean(time, o.hr, o.from, o.to + 30);
  const hrRef = Math.max(o.maxHr ?? 0, o.learnedMaxHr ?? 0);
  const top = o.peakWatts ?? bestMean(time, o.watts, o.from, o.to, 60);

  // 1. Peak heart rate against the highest ever seen (strong). Only when there is a reference beyond the test itself.
  if (peakHr != null && hrRef > 0) {
    const r = peakHr / hrRef;
    const s = r >= 0.97 ? 1 : r >= 0.93 ? 0.5 : r < 0.9 ? -1 : 0;
    votes.push({ name: 'peak heart rate', weight: 3, allOut: s, past: s, line: `Peak 30-second heart rate ${Math.round(peakHr)} bpm against the highest known ${Math.round(hrRef)} bpm (${Math.round(r * 100)}%).` });
  }

  // 2. How far the ramp went past the power at which heart rate reached the threshold setting (moderate).
  if (o.lthr && o.lthr > 0 && o.hr && o.watts && top != null) {
    let crossAt: number | undefined;
    for (let a = o.from; a + 30 <= o.to; a += 5) {
      const h = meanIn(time, o.hr, a, a + 30);
      if (h != null && h >= o.lthr) { crossAt = a + 30; break; }
    }
    if (crossAt == null) {
      votes.push({ name: 'threshold heart rate', weight: 2, past: -1, line: `Heart rate never reached the threshold setting (${o.lthr} bpm) during the ramp.` });
    } else {
      const w = meanIn(time, o.watts, crossAt - 60, crossAt);
      if (w != null) {
        const step = o.stepWatts && o.stepWatts > 0 ? o.stepWatts : 20;
        const steps = (top - w) / step;
        const s = steps >= 2 ? 1 : steps >= 1 ? 0.5 : steps < 0.5 ? -0.5 : 0;
        votes.push({ name: 'threshold heart rate', weight: 2, past: s, line: `Heart rate reached the threshold setting (${o.lthr} bpm) at about ${Math.round(w)} W; the ramp went on to ${Math.round(top)} W, ${steps.toFixed(1)} steps further.` });
      }
    }
  }

  // 3. Top power against FTP, and against the critical-power estimate when trustworthy (moderate).
  const ref = o.cpFtp && o.cpFtp > 0 ? Math.max(o.cpFtp, o.ftp ?? 0) : o.ftp;
  if (top != null && ref && ref > 0) {
    const r = top / ref;
    const s = r >= 1.25 ? 1 : r >= 1.1 ? 0.5 : r < 1.0 ? -1 : 0;
    votes.push({ name: 'top power', weight: 2, allOut: s, past: s, line: `Top power ${Math.round(top)} W is ${r.toFixed(2)} times ${o.cpFtp && o.cpFtp >= (o.ftp ?? 0) ? 'the FTP the recent riding shows' : 'the FTP on record'} (${Math.round(ref)} W); a full ramp usually ends at 1.25 to 1.45 times FTP.` });
  }

  // 4. Breathing still climbing steeply in the last two minutes of readings (weak; silent when the readings stop early).
  if (o.ve) {
    let lastVe: number | undefined;
    for (let i = time.length - 1; i >= 0; i--) if (time[i] < o.to && time[i] >= o.from && ok(o.ve[i])) { lastVe = time[i]; break; }
    if (lastVe != null && o.to - lastVe <= 60 && o.to - o.from >= 360) {
      const span = o.to - o.from;
      const early = slope(time, o.watts, o.ve, o.from + 60, o.from + span / 2);
      const late = slope(time, o.watts, o.ve, Math.max(o.from, o.to - 120), o.to);
      if (early != null && late != null && early > 0) {
        const r = late / early;
        const s = r >= 1.5 ? 1 : 0;
        votes.push({ name: 'breathing', weight: 1, allOut: s, past: s, line: `Breathing rose ${r.toFixed(1)} times as steeply per watt in the last two minutes as in the first half of the ramp.` });
      }
    }
  }

  // 5. How it ended (weak).
  if (o.endedBy) {
    const r = peakHr != null && hrRef > 0 ? peakHr / hrRef : undefined;
    if (o.endedBy === 'auto') votes.push({ name: 'ending', weight: 1, allOut: 1, past: 0.5, line: 'The ramp ended by itself when the power fell away.' });
    else if (r != null && r >= 0.95) votes.push({ name: 'ending', weight: 1, allOut: 0.5, line: 'The rider stopped the ramp with heart rate near its highest.' });
    else if (r != null && r < 0.9) votes.push({ name: 'ending', weight: 1, allOut: -1, line: 'The rider stopped the ramp with heart rate well short of its highest.' });
    else votes.push({ name: 'ending', weight: 1, line: 'The rider stopped the ramp.' });
  }

  const score = (key: 'allOut' | 'past') => {
    const vs = votes.filter((v) => v[key] != null);
    const w = vs.reduce((a, v) => a + v.weight, 0);
    // A single weak witness is not a judgement.
    if (w < 2) return undefined;
    return vs.reduce((a, v) => a + v.weight * v[key]!, 0) / w;
  };
  const a = score('allOut'), p = score('past');
  return { allOut: a != null ? verdict(a) : undefined, pastVt2: p != null ? verdict(p) : undefined, lines: votes.map((v) => v.line) };
}

/** Least-squares slope of y on x over [a, b). */
function slope(time: number[], xs: Array<number | undefined> | undefined, ys: Array<number | undefined>, a: number, b: number): number | undefined {
  if (!xs) return undefined;
  const px: number[] = [], py: number[] = [];
  for (let i = 0; i < time.length; i++) { const t = time[i]; if (t < a) continue; if (t >= b) break; if (ok(xs[i]) && ok(ys[i])) { px.push(xs[i]!); py.push(ys[i]!); } }
  if (px.length < 30) return undefined;
  const mx = px.reduce((s, v) => s + v, 0) / px.length, my = py.reduce((s, v) => s + v, 0) / py.length;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < px.length; i++) { sxx += (px[i] - mx) ** 2; sxy += (px[i] - mx) * (py[i] - my); }
  return sxx > 0 ? sxy / sxx : undefined;
}
