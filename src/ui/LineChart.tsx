import { useState } from 'preact/hooks';

export interface ChartSeries { name: string; color: string; values: number[]; dash?: string; width?: number; explain?: string }
export interface ChartMarker { index: number; label: string; color?: string }
export interface ChartRefLine { value: number; label: string; color?: string }
export interface ChartBand { from: number; to: number; label: string; color: string; explain?: string }

/**
 * A labelled line chart over evenly spaced x positions (dates, usually), with
 * axis ticks, a y-axis title, reference lines, vertical markers and a hover
 * readout naming every series. Small on purpose: everything in the app that
 * draws a line over time uses it so the charts read the same way.
 */
export function LineChart({ series, xLabels, xTick, yTitle, refLines = [], markers = [], bands = [], height = 170, readout, yMin, yMax }: {
  series: ChartSeries[];
  xLabels: string[];                 // one per x position (dates as YYYY-MM-DD)
  xTick?: (label: string, i: number) => string | null;   // what to print under the axis; null for nothing
  yTitle: string;
  refLines?: ChartRefLine[];
  markers?: ChartMarker[];
  bands?: ChartBand[];           // shaded horizontal bands with a label at the right edge
  height?: number;
  readout?: (i: number) => string;   // the hover text; defaults to series values
  yMin?: number;
  yMax?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  if (n < 2) return <div class="empty small">Not enough data to draw.</div>;
  const W = 480, H = height, padL = 36, padR = 10, padT = 10, padB = 22;
  const all = series.flatMap((s) => s.values).concat(refLines.map((r) => r.value));
  const lo = yMin ?? Math.min(0, ...all);
  const hi0 = yMax ?? Math.max(...all);
  const hi = hi0 === lo ? lo + 1 : hi0 + (hi0 - lo) * 0.08;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  // y ticks: 4 round steps
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const xTicks = xLabels.map((l, i) => [i, xTick ? xTick(l, i) : (i % Math.ceil(n / 6) === 0 ? l : null)] as const).filter(([, t]) => t != null);
  const h = hover;
  return (
    <div class="chart" style="position:relative">
      <svg viewBox={`0 0 ${W} ${H}`} style="display:block;width:100%" aria-label={yTitle}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}
        onMouseLeave={() => setHover(null)}>
        {bands.map((b) => { const top = y(Math.min(hi, b.to)), bot = y(Math.max(lo, b.from)); if (bot <= top) return null; return <g key={b.label}><rect x={padL} y={top} width={W - padL - padR} height={bot - top} fill={b.color} fill-opacity="0.09"><title>{b.explain ?? b.label}</title></rect>{bot - top > 11 && <text x={W - padR - 3} y={bot - 3} fill={b.color} fill-opacity="0.9" font-size="8" text-anchor="end">{b.label}</text>}</g>; })}
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={padL - 5} y={y(t) + 3} fill="var(--ink-3)" font-size="9" text-anchor="end">{fmtTick(t)}</text></g>)}
        {xTicks.map(([i, t]) => <text key={i} x={x(i)} y={H - 6} fill="var(--ink-3)" font-size="9" text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{t}</text>)}
        <text transform={`translate(9 ${(H - padB) / 2 + padT}) rotate(-90)`} fill="var(--ink-3)" font-size="9" text-anchor="middle">{yTitle}</text>
        {refLines.map((r) => <g key={r.label}><line x1={padL} x2={W - padR} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? 'var(--accent)'} stroke-dasharray="4 4" /><text x={W - padR - 2} y={y(r.value) < padT + 12 ? y(r.value) + 11 : y(r.value) - 3} fill={r.color ?? 'var(--accent)'} font-size="9" text-anchor="end">{r.label}</text></g>)}
        {markers.map((m) => <g key={m.label}><line x1={x(m.index)} x2={x(m.index)} y1={padT} y2={H - padB} stroke={m.color ?? 'var(--line-2)'} stroke-dasharray="2 3" /><text x={x(m.index) + 3} y={H - padB - 4} fill={m.color ?? 'var(--ink-3)'} font-size="9">{m.label}</text></g>)}
        {series.map((s) => <path key={s.name} d={path(s.values)} fill="none" stroke={s.color} stroke-width={s.width ?? 1.8} stroke-dasharray={s.dash} />)}
        {h != null && <line x1={x(h)} x2={x(h)} y1={padT} y2={H - padB} stroke="var(--accent)" />}
        {h != null && series.map((s) => <circle key={s.name} cx={x(h)} cy={y(s.values[h])} r="3" fill={s.color} />)}
      </svg>
      <div class="row wrap faint small" style="gap:14px;margin-top:4px">
        {series.map((s) => <span key={s.name} title={s.explain}><span style={`color:${s.color}`}>{s.dash ? '- -' : '—'}</span> {s.name}</span>)}
      </div>
      {h != null && (
        <div class="panel small" style="position:absolute;top:6px;right:6px;padding:6px 10px;pointer-events:none;max-width:70%">
          {readout ? readout(h) : <><b>{xLabels[h]}</b>{series.map((s) => ` · ${s.name} ${fmtTick(s.values[h])}`)}</>}
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
function fmtTick(v: number): string { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(0) : (Math.round(v * 10) / 10).toString(); }

/** The form bands coaches use: where fitness-minus-fatigue sits tells you what the body is doing. */
export const FORM_BANDS: ChartBand[] = [
  { from: 5, to: 25, label: 'fresh', color: 'var(--good)', explain: 'Form +5 to +25: fresh. Where you want to be on an event day; staying here for long means fitness is slipping.' },
  { from: -10, to: 5, label: 'neutral', color: 'var(--ink-3)', explain: 'Form −10 to +5: neutral. Recovery weeks and easy stretches land here.' },
  { from: -30, to: -10, label: 'building', color: 'var(--info)', explain: 'Form −30 to −10: building. Fatigue above fitness is how fitness rises; this is the productive zone.' },
  { from: -60, to: -30, label: 'overreaching', color: 'var(--bad)', explain: 'Form below −30: overreaching. Fine for a few days at the end of a big block; a rest week is due.' },
];
