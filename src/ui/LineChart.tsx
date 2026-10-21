import { useState } from 'preact/hooks';
import { useWidth } from './useWidth';

/**
 * A series; null leaves a gap (a projection that starts where the history ends, say).
 * `scale: 'own'` draws it on its own scale, fitted to the chart's height and kept out of
 * the shared axis, ticks and bands (a line in other units, read through the readout);
 * `ownFloor` pins the bottom of that scale (0 for sleep, so a steady night does not fill
 * the chart). `kind: 'bars'` draws a bar per day from the bottom of the plot, on its own
 * scale; bars from index `projectedFrom` on are dotted outlines (planned, not done).
 * `unit` and `format` shape its number in the readout; series sharing a `group` show
 * once there (the history and its projection meet at today).
 */
export interface ChartSeries {
  name: string; color: string; values: Array<number | null>; dash?: string; width?: number; explain?: string; dots?: boolean;
  scale?: 'shared' | 'own'; ownFloor?: number; kind?: 'line' | 'bars'; projectedFrom?: number;
  /** Own-scale series: the range is at least this wide, centred on the values (weight: a stable rider is a gentle line, not a jagged one). */
  ownMinSpan?: number;
  unit?: string; format?: (v: number) => string; group?: string; connectGaps?: boolean; opacity?: number; hideInLegend?: boolean;
  /** Own-scale series with the same key share one scale (a metric's daily dots and its 7-day line). */
  scaleKey?: string;
}
export interface ChartMarker { index: number; label: string; color?: string }
export interface ChartRefLine { value: number; label: string; color?: string }
export interface ChartBand { from: number; to: number; label: string; color: string; explain?: string }

/**
 * A labelled line chart over evenly spaced x positions (dates, usually), with
 * axis ticks, a y-axis title, reference lines, vertical markers and a hover
 * readout naming every series. Small on purpose: everything in the app that
 * draws a line over time uses it so the charts read the same way.
 */
export function LineChart({ series, xLabels, xTick, yTitle, refLines = [], markers = [], bands = [], height = 170, readout, suffix, fmtX, yMin, yMax }: {
  series: ChartSeries[];
  xLabels: string[];                 // one per x position (dates as YYYY-MM-DD)
  xTick?: (label: string, i: number) => string | null;   // what to print under the axis; null for nothing
  yTitle: string;
  refLines?: ChartRefLine[];
  markers?: ChartMarker[];
  bands?: ChartBand[];           // shaded horizontal bands with a label at the right edge
  height?: number;
  readout?: (i: number) => string;   // the hover text; defaults to every series' value with its unit
  suffix?: (i: number) => string;    // appended to the default readout (the day's session, say)
  fmtX?: (label: string) => string;  // how the default readout names the day
  yMin?: number;
  yMax?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth(480);
  const n = xLabels.length;
  if (n < 2) return <div class="empty small">Not enough data to draw.</div>;
  const H = height, padR = 10, padT = 12, padB = 22;
  let padL = 40;
  const shared = series.filter((s) => (s.scale ?? 'shared') === 'shared' && s.kind !== 'bars');
  const all = shared.flatMap((s) => s.values.filter((v): v is number => v != null)).concat(refLines.map((r) => r.value));
  if (!all.length) all.push(0, 1);
  const lo0 = yMin ?? Math.min(0, ...all);
  const hi00 = yMax ?? Math.max(...all);
  // Room below the lowest value too, so a line never runs along the bottom edge under a label.
  const lo = yMin ?? (lo0 < 0 ? lo0 - (hi00 - lo0) * 0.08 : lo0);
  const hi0 = yMax ?? Math.max(...all);
  const hi = hi0 === lo ? lo + 1 : hi0 + (hi0 - lo) * 0.08;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  // A series on its own scale: its own range over the values it has, 8% headroom each way.
  const yOf = (s: ChartSeries): ((v: number) => number) => {
    if ((s.scale ?? 'shared') === 'shared' && s.kind !== 'bars') return y;
    const vs = (s.scaleKey ? series.filter((o) => o.scaleKey === s.scaleKey) : [s]).flatMap((o) => o.values.filter((v): v is number => v != null));
    if (s.kind === 'bars') { const mx = Math.max(1, ...vs); const base = H - padB, top = (H - padT - padB) * 0.35; return (v: number) => base - (v / mx) * top; }
    let a = s.ownFloor ?? Math.min(...vs), b = Math.max(...vs);
    if (!isFinite(a) || !isFinite(b)) { a = 0; b = 1; }
    if (b === a) { a -= 1; b += 1; }
    if (s.ownMinSpan && b - a < s.ownMinSpan) { const mid = (a + b) / 2; a = mid - s.ownMinSpan / 2; b = mid + s.ownMinSpan / 2; }
    const pad = (b - a) * 0.08; a = s.ownFloor ?? a - pad; b += pad;
    return (v: number) => padT + (1 - (v - a) / (b - a)) * (H - padT - padB);
  };
  const path = (vals: Array<number | null>, yy = y, connect = false) => { let pen = false; return vals.map((v, i) => { if (v == null) { if (!connect) pen = false; return ''; } const c = `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${yy(v).toFixed(1)}`; pen = true; return c; }).join(' '); };
  const barW = Math.max(1.5, Math.min(5, ((W - padL - padR) / Math.max(1, n - 1)) * 0.7));
  // y ticks: 4 round steps
  const step = niceStep((hi - lo) / 4);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Math.round(v * 1000) / 1000);
  padL = Math.max(40, 24 + Math.max(...ticks.map((t) => fmtStep(t, step).length)) * 6);
  const xTicks0 = xLabels.map((l, i) => [i, xTick ? xTick(l, i) : (i % Math.ceil(n / 6) === 0 ? l : null)] as const).filter(([, t]) => t != null);
  // Drop tick labels that would sit on top of the one before (or the last one), whatever the caller asked for.
  const xTicks: typeof xTicks0 = [];
  for (const t of xTicks0) { const prev = xTicks[xTicks.length - 1]; if (prev && x(t[0]) - x(prev[0]) < 46) { if (t[0] === n - 1) xTicks[xTicks.length - 1] = t; continue; } xTicks.push(t); }
  const h = hover;
  return (
    <div class="chart" style="position:relative" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block;width:100%" aria-label={yTitle}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - padL) / (W - padL - padR)) * (n - 1)); setHover(Math.max(0, Math.min(n - 1, i))); }}
        onMouseLeave={() => setHover(null)}>
        {bands.map((b) => { const top = y(Math.min(hi, b.to)), bot = y(Math.max(lo, b.from)); if (bot <= top) return null; return <g key={b.label}><rect x={padL} y={top} width={W - padL - padR} height={bot - top} fill={b.color} fill-opacity="0.09"><title>{b.explain ?? b.label}</title></rect>{bot - top > 11 && <text x={W - padR - 3} y={bot - 3} fill={b.color} fill-opacity="0.9" font-size="10" text-anchor="end" stroke="var(--bg-2)" stroke-width="3" paint-order="stroke" stroke-linejoin="round">{b.label}</text>}</g>; })}
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" /><text x={padL - 5} y={y(t) + 3} fill="var(--ink-3)" font-size="10" text-anchor="end">{fmtStep(t, step)}</text></g>)}
        {xTicks.map(([i, t]) => <text key={i} x={x(i)} y={H - 6} fill="var(--ink-3)" font-size="10" text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{t}</text>)}
        <text transform={`translate(9 ${(H - padB) / 2 + padT}) rotate(-90)`} fill="var(--ink-3)" font-size="10" text-anchor="middle">{yTitle}</text>
        {refLines.map((r) => <g key={r.label}><line x1={padL} x2={W - padR} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? 'var(--accent)'} stroke-dasharray="4 4" /><text x={W - padR - 2} y={y(r.value) < padT + 12 ? y(r.value) + 11 : y(r.value) - 3} fill={r.color ?? 'var(--accent)'} font-size="10" text-anchor="end">{r.label}</text></g>)}
        {markers.map((m) => <g key={m.label}><line x1={x(m.index)} x2={x(m.index)} y1={padT} y2={H - padB} stroke={m.color ?? 'var(--line-2)'} stroke-dasharray="2 3" /><text x={x(m.index) + 3} y={padT + 2} fill={m.color ?? 'var(--ink-3)'} font-size="10">{m.label}</text></g>)}
        {series.map((s) => { const yy = yOf(s); return s.kind === 'bars'
          ? <g key={s.name}>{s.values.map((v, i) => { if (v == null || v <= 0) return null; const top = yy(v), proj = s.projectedFrom != null && i >= s.projectedFrom; return <rect key={i} x={x(i) - barW / 2} y={top} width={barW} height={Math.max(0.5, H - padB - top)} rx="1" fill={proj ? 'none' : s.color} fill-opacity={proj ? undefined : 0.16} stroke={proj ? s.color : undefined} stroke-opacity={proj ? 0.4 : undefined} stroke-dasharray={proj ? '2 2' : undefined} />; })}</g>
          : s.dots
          ? <g key={s.name}>{s.values.map((v, i) => v == null ? null : <circle key={i} cx={x(i)} cy={yy(v)} r="2.2" fill={s.color} fill-opacity={s.opacity ?? 0.55} />)}</g>
          : <path key={s.name} d={path(s.values, yy, s.connectGaps)} fill="none" stroke={s.color} stroke-width={s.width ?? 1.8} stroke-dasharray={s.dash} stroke-opacity={s.opacity} />; })}
        {h != null && <line x1={x(h)} x2={x(h)} y1={padT} y2={H - padB} stroke="var(--accent)" />}
        {h != null && series.map((s) => s.values[h] == null || s.kind === 'bars' ? null : <circle key={s.name} cx={x(h)} cy={yOf(s)(s.values[h] as number)} r="3" fill={s.color} />)}
      </svg>
      <div class="row wrap faint small chart-legend" style="gap:4px 14px;margin-top:4px">
        {series.filter((s) => !s.hideInLegend).map((s) => <span key={s.name} title={s.explain}>{s.kind === 'bars'
          ? <span style={`display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};opacity:.35;vertical-align:middle;margin-right:5px`} />
          : s.dots
          ? <span style={`color:${s.color}`}>•</span>
          : <svg width="22" height="8" style="display:inline-block;vertical-align:middle;margin-right:5px" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={s.color} stroke-width={Math.max(1.6, s.width ?? 1.8)} stroke-dasharray={s.dash} /></svg>}{s.name}</span>)}
      </div>
      {h != null && (
        <div class="panel small" style="position:absolute;top:6px;right:6px;padding:6px 10px;pointer-events:none;max-width:70%">
          {readout ? readout(h) : <><b>{fmtX ? fmtX(xLabels[h]) : xLabels[h]}</b>{readoutParts(series, h).map((t) => ` · ${t}`)}{suffix ? suffix(h) : ''}</>}
        </div>
      )}
    </div>
  );
}

/** Every series' value at one position, named and with its unit; a group (history and its projection) shows once. */
export function readoutParts(series: ChartSeries[], i: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of series) {
    const v = s.values[i];
    if (v == null) continue;
    const key = s.group ?? s.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${s.group ?? s.name} ${s.format ? s.format(v) : fmtTick(v)}${s.unit ? ` ${s.unit}` : ''}`);
  }
  return out;
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

/** A tick label with as many decimals as the step needs (0.05 steps show two). */
function fmtStep(v: number, step: number): string { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2; return v.toFixed(d); }
