import { addDays } from '../../engine/load';
import { fmtDate } from '../derived';

export const dayN = (from: string, d: string) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
export const short = (d: string) => fmtDate(d, { month: 'short', day: 'numeric' });
export const longDay = (d: string) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const mean = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
export const median = (l: number[]) => { const s = [...l].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
/** A signed figure with a real minus sign. */
export const sg = (v: number, digits = 0) => { const r = Math.round(v * 10 ** digits) / 10 ** digits; return r > 0 ? `+${r.toFixed(digits)}` : r < 0 ? `−${Math.abs(r).toFixed(digits)}` : '0'; };
export const hm = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Tick marks for a span of days: weeks for a short span, months for a longer one, quarters beyond two years. */
export function dayTicks(from: string, to: string): Array<[number, string]> {
  const n = dayN(from, to);
  const out: Array<[number, string]> = [];
  if (n <= 45) { for (let d = from; d <= to; d = addDays(d, 7)) out.push([dayN(from, d), short(d)]); return out; }
  const step = n > 800 ? 3 : n > 420 ? 2 : 1;
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  for (;;) {
    m += 1; if (m > 12) { m = 1; y += 1; }
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d > to) break;
    if ((m - 1) % step === 0) out.push([dayN(from, d), fmtDate(d, m === 1 || out.length === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' })]);
  }
  return out;
}

/** A small chart for a tile: lines and bars from plain arrays, drawn in the instrument look. Only what is passed is drawn. */
export function Mini({ lines = [], bars, label, h = 64 }: { lines?: Array<{ vals: Array<number | null>; color?: string; dash?: string }>; bars?: { vals: number[]; color?: string; colors?: string[] }; label: string; h?: number }) {
  const W = 300, padL = 4, padR = 6, padT = 6, base = h - 9;
  const all = [...lines.flatMap((l) => l.vals.filter((v): v is number => v != null)), ...(bars ? [0, ...bars.vals] : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!all.length) { lo = 0; hi = 1; }
  const pad = bars ? 0 : (hi - lo) * 0.12 || 1;
  const y = (v: number) => base - (v - (lo - pad)) / ((hi + pad * (bars ? 0 : 1) + (bars ? (hi - lo) * 0.08 : 0)) - (lo - pad) || 1) * (base - padT);
  const n = Math.max(lines[0]?.vals.length ?? 0, bars?.vals.length ?? 0);
  const x = (i: number, len: number) => padL + (len > 1 ? i / (len - 1) : 0.5) * (W - padL - padR);
  const bw = bars ? Math.max(1.5, (W - padL - padR) / bars.vals.length * 0.72) : 0;
  return (
    <svg class="lb-spark" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line class="lb-ax" x1={padL} x2={W - padR} y1={base} y2={base} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const tx = padL + f * (W - padL - padR); return <line key={f} class="lb-ax" x1={tx} x2={tx} y1={base} y2={base + 4} />; })}
      <line class="lb-grid" x1={padL} x2={W - padR} y1={padT + (base - padT) / 2} y2={padT + (base - padT) / 2} />
      {bars && bars.vals.map((v, i) => v > 0 && <rect key={i} x={padL + (i + 0.5) / bars.vals.length * (W - padL - padR) - bw / 2} width={bw} y={y(v)} height={Math.max(0.5, base - y(v))} fill={bars.colors?.[i] ?? bars.color ?? 'var(--accent)'} opacity="0.78" />)}
      {lines.map((l, k) => {
        let d = '', pen = false;
        l.vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i, l.vals.length).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
        return <path key={k} d={d} fill="none" stroke={l.color ?? 'var(--accent)'} stroke-width="1.4" stroke-dasharray={l.dash} stroke-linejoin="round" vector-effect="non-scaling-stroke" />;
      })}
      {n > 0 && null}
    </svg>
  );
}

/** Evenly spaced samples of a day-keyed map across a period, for a tile's miniature. */
export function sample(get: (d: string) => number | undefined, from: string, to: string, n = 60): Array<number | null> {
  const span = Math.max(1, dayN(from, to));
  const k = Math.min(n, span + 1);
  return Array.from({ length: k }, (_, i) => get(addDays(from, Math.round(i / Math.max(1, k - 1) * span))) ?? null);
}
