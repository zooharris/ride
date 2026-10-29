import { useState } from 'preact/hooks';
import { useWidth } from './useWidth';

export interface BarSeries { name: string; color: string; values: number[] }

/**
 * Bars over evenly spaced categories (weeks, months, power bands), stacked
 * when there is more than one series, in the same visual language as
 * LineChart: labelled axes, recessive grid, a hover readout naming every value,
 * a legend when there is more than one series. `outline` draws a hollow bar
 * behind each stack (planned load behind done load); `barColor` colours bars
 * one by one (a histogram coloured by zone); `markers` mark a position on the
 * category axis (FTP on a power histogram).
 */
export function BarChart({ categories, series, outline, outlineName = 'planned', barColor, xTick, yTitle, yFormat = fmt, height = 170, readout, markers = [], normalise = false, partialLast = false }: {
  categories: string[];
  series: BarSeries[];
  outline?: number[];
  outlineName?: string;
  barColor?: (i: number) => string;
  xTick?: (label: string, i: number) => string | null;
  yTitle: string;
  yFormat?: (v: number) => string;
  height?: number;
  readout?: (i: number) => string;
  markers?: Array<{ at: number; label: string; color?: string }>;   // `at` in category units (0 = first bar's left edge)
  normalise?: boolean;              // each stack drawn as shares of 100%
  partialLast?: boolean;            // the last category is still in progress (this month): drawn hatched
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth(480);
  const n = categories.length;
  if (!n) return <div class="empty small">Nothing to draw yet.</div>;
  const H = height, padR = 8, padT = 12, padB = 22;
  const totals = categories.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const top0 = normalise ? 100 : Math.max(1, ...totals, ...(outline ?? []));
  const step = niceStep(top0 / 4);
  const top = normalise ? 100 : Math.ceil((top0 * 1.04) / step) * step;
  const tickVals: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += normalise ? 25 : step) tickVals.push(v);
  const padL = Math.max(40, 24 + Math.max(...tickVals.map((t) => (normalise ? `${t}%` : yFormat(t)).length)) * 6);
  const cw = (W - padL - padR) / n;
  const gap = Math.max(1, Math.min(4, cw * 0.22));
  const bw = Math.max(1, cw - gap);
  const x = (i: number) => padL + i * cw + gap / 2;
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += normalise ? 25 : step) ticks.push(v);
  const xt0 = categories.map((c, i) => [i, xTick ? xTick(c, i) : (i % Math.ceil(n / 6) === 0 ? c : null)] as const).filter(([, t]) => t != null);
  const minGap = Math.max(18, ...xt0.map(([, t]) => String(t).length * 6 + 8));
  const xt: typeof xt0 = [];
  for (const t of xt0) { const prev = xt[xt.length - 1]; if (prev && (t[0] - prev[0]) * cw < minGap) { if (t[0] === n - 1) xt[xt.length - 1] = t; continue; } xt.push(t); }
  const h = hover;
  const pid = `hatch-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div class="chart" style="position:relative" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block;width:100%" role="img" aria-label={yTitle}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.floor((px - padL) / cw); setHover(i >= 0 && i < n ? i : null); }}
        onMouseLeave={() => setHover(null)}>
        <defs><pattern id={pid} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="4" fill="var(--bg-2)" fill-opacity="0.55" /></pattern></defs>
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" stroke-dasharray="2 4" /><text x={padL - 5} y={y(t) + 3} fill="var(--ink-3)" font-size="10" text-anchor="end">{normalise ? `${t}%` : yFormat(t)}</text></g>)}
        <text transform={`translate(9 ${(H - padB) / 2 + padT}) rotate(-90)`} fill="var(--ink-3)" font-size="10" text-anchor="middle">{yTitle}</text>
        {h != null && <rect x={padL + h * cw} y={padT} width={cw} height={H - padT - padB} fill="var(--ink)" fill-opacity="0.05" />}
        {outline && outline.map((v, i) => v > 0 ? <rect key={`o${i}`} x={x(i) + 0.5} y={y(v) + 0.5} width={Math.max(0, bw - 1)} height={Math.max(0, H - padB - y(v) - 0.5)} rx="2" fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 2" /> : null)}
        {categories.map((_, i) => {
          let acc = 0;
          const tot = totals[i] || 1;
          const segs = series.map((s, k) => {
            const raw = s.values[i] || 0;
            if (raw <= 0) return null;
            const v = normalise ? (raw / tot) * 100 : raw;
            const y0 = y(acc), y1 = y(acc + v);
            acc += v;
            const hgt = Math.max(0, y0 - y1 - (k > 0 ? 1 : 0));   // a hairline gap between stacked segments
            return <rect key={k} x={x(i)} y={y1} width={bw} height={hgt} rx={bw > 6 ? 2 : 0} fill={barColor ? barColor(i) : s.color} fill-opacity={h == null || h === i ? 1 : 0.8} />;
          });
          return <g key={i}>{segs}{partialLast && i === n - 1 && acc > 0 && <rect x={x(i)} y={y(acc)} width={bw} height={H - padB - y(acc)} fill={`url(#${pid})`} />}</g>;
        })}
        {markers.map((m) => { const mx = padL + m.at * cw; return <g key={m.label}><line x1={mx} x2={mx} y1={padT} y2={H - padB} stroke={m.color ?? 'var(--accent)'} stroke-dasharray="3 3" /><text x={mx + 3} y={padT + 9} font-size="10" fill={m.color ?? 'var(--accent)'}>{m.label}</text></g>; })}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="var(--line-2)" />
        {xt.map(([i, t]) => <text key={i} x={x(i) + bw / 2} y={H - 7} fill="var(--ink-3)" font-size="10" text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{t}</text>)}
      </svg>
      {(series.length > 1 || outline) && (
        <div class="row wrap faint small" style="gap:4px 14px;margin-top:4px">
          {series.map((s) => <span key={s.name}><span class="sw-dot" style={`background:${s.color}`} /> {s.name}</span>)}
          {outline && <span><span class="sw-dot" style="background:none;outline:1px dashed var(--ink-3);outline-offset:-1px" /> {outlineName}</span>}
        </div>
      )}
      {h != null && (
        <div class="panel small" style="position:absolute;top:0;right:0;padding:6px 10px;pointer-events:none;max-width:78%">
          {readout ? readout(h) : <><b>{categories[h]}</b>{series.map((s) => ` · ${s.name} ${fmt(s.values[h] || 0)}`)}</>}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}
function fmt(v: number): string { return Math.abs(v) >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString(); }
