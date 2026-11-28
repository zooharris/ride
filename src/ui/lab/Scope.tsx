import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useWidth } from '../useWidth';
import { deliver } from '../../export/deliver';
import { safeName } from '../../export/names';

/**
 * The Lab's plotting surface (27 Nov 2026), in the look of a measuring instrument: a ruled plot with tick marks and
 * units on both scales, fine lines, the raw signal faint behind the smoothed one, and a crosshair that reads out
 * the point under the finger. Every designed chart is drawn with it, so they all behave the same way.
 */
export interface Series {
  name: string;
  kind: 'line' | 'raw' | 'bars' | 'dots' | 'step';
  pts: Array<[number, number]>;
  color: string;
  /** A dash pattern, so two lines are told apart without colour. */
  dash?: string;
  /** 1 puts it on the right-hand scale. */
  axis?: 0 | 1;
  width?: number;
  /** Bar width in x units. */
  barW?: number;
  /** Dots drawn hollow (a second way to tell two sets of points apart). */
  hollow?: boolean;
}
export interface Stack { xs: number[]; barW: number; parts: Array<{ name: string; color: string; vals: number[] }> }
export interface Band { y0: number; y1: number; label?: string; color: string; axis?: 0 | 1 }
export interface Rule { y?: number; x?: number; label?: string; dash?: string; color?: string; axis?: 0 | 1 }

export interface ScopeProps {
  x0: number; x1: number;
  xTicks: Array<[number, string]>;
  /** Draw x on a log scale (effort length on the power curve). */
  xLog?: boolean;
  series?: Series[];
  stack?: Stack;
  bands?: Band[];
  rules?: Rule[];
  yUnit?: string; y2Unit?: string;
  yMin?: number; yMax?: number; y2Min?: number; y2Max?: number;
  yFmt?: (v: number) => string; y2Fmt?: (v: number) => string;
  height?: number;
  /** The x positions the crosshair snaps to. */
  snap?: number[];
  at?: number | null;
  onAt?: (x: number | null) => void;
  /** Pressing a point (a day opened, a week chosen). */
  onPick?: (x: number) => void;
  label: string;
  /** A span of x picked out (the weeks chosen on the time-in-zones chart). */
  mark?: [number, number];
}

/** Round tick steps: 1, 2, 2.5, 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(Math.round(v / step) * step);
  return out;
}
const plain = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')).replace(/^-/, '−');

export function Scope(p: ScopeProps) {
  const [ref, W] = useWidth<HTMLDivElement>(720);
  const H = p.height ?? Math.max(190, Math.min(300, Math.round(W / 3.4)));
  const series = p.series ?? [];
  const right = series.some((s) => s.axis === 1);
  const padL = 46, padR = right ? 46 : 12, padT = 16, padB = 26;
  const pw = Math.max(10, W - padL - padR), ph = H - padT - padB;
  const lx = (v: number) => (p.xLog ? Math.log(Math.max(v, 1e-9)) : v);
  const X = (v: number) => padL + (lx(v) - lx(p.x0)) / (lx(p.x1) - lx(p.x0) || 1) * pw;
  // Each scale covers what is drawn on it, opened out to round figures.
  const scale = (axis: 0 | 1) => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) if ((s.axis ?? 0) === axis) for (const [x, y] of s.pts) { if (x < p.x0 || x > p.x1) continue; if (y < lo) lo = y; if (y > hi) hi = y; }
    if (axis === 0 && p.stack) { lo = Math.min(lo, 0); p.stack.xs.forEach((_, k) => { const t = p.stack!.parts.reduce((a, q) => a + (q.vals[k] ?? 0), 0); if (t > hi) hi = t; }); }
    if (series.some((s) => (s.axis ?? 0) === axis && s.kind === 'bars')) lo = Math.min(lo, 0);
    for (const b of p.bands ?? []) if ((b.axis ?? 0) === axis) { lo = Math.min(lo, b.y0); hi = Math.max(hi, b.y1); }
    for (const r of p.rules ?? []) if (r.y != null && (r.axis ?? 0) === axis) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
    const min = axis ? p.y2Min : p.yMin, max = axis ? p.y2Max : p.yMax;
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi === lo) { hi += Math.abs(hi) * 0.1 || 1; lo -= Math.abs(lo) * 0.1 || 0; }
    const padY = (hi - lo) * 0.06;
    let a = min ?? (lo >= 0 && lo - padY < 0 ? 0 : lo - padY), b = max ?? hi + padY;
    const ticks = niceTicks(a, b, Math.max(2, Math.round(ph / 48)));
    if (min == null && ticks.length && ticks[0] - (ticks[1] - ticks[0] || 0) <= a && a < ticks[0] && a >= 0) a = Math.max(0, ticks[0] - (ticks[1] - ticks[0]));
    return { a, b, ticks: niceTicks(a, b, Math.max(2, Math.round(ph / 48))) };
  };
  const s0 = scale(0), s1 = right ? scale(1) : s0;
  const Y = (v: number, axis: 0 | 1 = 0) => { const s = axis ? s1 : s0; return padT + ph - (v - s.a) / (s.b - s.a || 1) * ph; };
  const fmt0 = p.yFmt ?? plain, fmt1 = p.y2Fmt ?? plain;
  const path = (pts: Array<[number, number]>, axis: 0 | 1, step?: boolean) => {
    let d = '', prev: [number, number] | null = null;
    for (const [x, y] of pts) {
      if (x < p.x0 || x > p.x1) { continue; }
      const px = X(x).toFixed(1), py = Y(y, axis).toFixed(1);
      d += prev ? (step ? `H${px}V${py}` : `L${px},${py}`) : `M${px},${py}`;
      prev = [x, y];
    }
    return d;
  };
  const move = (e: PointerEvent) => {
    if (!p.onAt) return;
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width * W;
    const f = Math.max(0, Math.min(1, (px - padL) / pw));
    const xv = p.xLog ? Math.exp(lx(p.x0) + f * (lx(p.x1) - lx(p.x0))) : p.x0 + f * (p.x1 - p.x0);
    if (!p.snap?.length) { p.onAt(xv); return; }
    let best = p.snap[0], bd = Infinity;
    for (const sx of p.snap) { const dd = Math.abs(lx(sx) - lx(xv)); if (dd < bd) { bd = dd; best = sx; } }
    p.onAt(best);
  };
  const at = p.at != null && p.at >= p.x0 && p.at <= p.x1 ? p.at : null;
  return (
    <div class="sc" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.label} style="touch-action:pan-y"
        onPointerMove={move} onPointerDown={move} onPointerLeave={() => p.onAt?.(null)} onClick={() => { if (at != null) p.onPick?.(at); }}>
        {/* the ruled plot */}
        {s0.ticks.map((v) => <g key={`y${v}`}><line class="sc-grid" x1={padL} x2={padL + pw} y1={Y(v)} y2={Y(v)} /><line class="sc-tick" x1={padL - 4} x2={padL} y1={Y(v)} y2={Y(v)} /><text class="sc-num" x={padL - 7} y={Y(v) + 3.5} text-anchor="end">{fmt0(v)}</text></g>)}
        {right && s1.ticks.map((v) => <g key={`r${v}`}><line class="sc-tick" x1={padL + pw} x2={padL + pw + 4} y1={Y(v, 1)} y2={Y(v, 1)} /><text class="sc-num" x={padL + pw + 7} y={Y(v, 1) + 3.5}>{fmt1(v)}</text></g>)}
        {p.xTicks.filter(([x]) => x >= p.x0 && x <= p.x1).map(([x, l]) => <g key={`x${x}`}><line class="sc-tick" x1={X(x)} x2={X(x)} y1={padT + ph} y2={padT + ph + 5} /><text class="sc-num" x={X(x)} y={H - 6} text-anchor="middle">{l}</text></g>)}
        <rect class="sc-frame" x={padL} y={padT} width={pw} height={ph} />
        {p.yUnit && <text class="sc-unit" x={padL - 7} y={10} text-anchor="end">{p.yUnit}</text>}
        {right && p.y2Unit && <text class="sc-unit" x={padL + pw + 7} y={10}>{p.y2Unit}</text>}
        {p.mark && <rect class="sc-mark" x={X(p.mark[0])} width={Math.max(2, X(p.mark[1]) - X(p.mark[0]))} y={padT} height={ph} />}
        {(p.bands ?? []).map((b, k) => <g key={`b${k}`}><rect x={padL} width={pw} y={Y(b.y1, b.axis)} height={Math.max(0, Y(b.y0, b.axis) - Y(b.y1, b.axis))} fill={b.color} opacity="0.1" />{b.label && <text class="sc-lab" x={padL + 6} y={Y(b.y1, b.axis) + 12}>{b.label}</text>}</g>)}
        {p.stack && p.stack.xs.map((x, k) => {
          let base = 0;
          const bw = Math.max(1.5, X(p.x0 + p.stack!.barW) - X(p.x0));
          return <g key={`s${x}`}>{p.stack!.parts.map((q, j) => { const v = q.vals[k] ?? 0; if (!(v > 0)) return null; const y1 = Y(base + v), y0 = Y(base); base += v; return <rect key={j} x={X(x) - bw / 2} width={bw} y={y1} height={Math.max(0.5, y0 - y1 - 0.6)} fill={q.color} opacity="0.86" />; })}</g>;
        })}
        {series.map((s, k) => {
          const ax = s.axis ?? 0;
          if (s.kind === 'bars') { const bw = Math.max(1.2, X(p.x0 + (s.barW ?? 1)) - X(p.x0)); return <g key={k}>{s.pts.filter(([x]) => x >= p.x0 && x <= p.x1).map(([x, y]) => <rect key={x} x={X(x) - bw / 2} width={bw} y={Math.min(Y(y, ax), Y(0, ax))} height={Math.max(0.5, Math.abs(Y(0, ax) - Y(y, ax)))} fill={s.color} opacity="0.8" />)}</g>; }
          if (s.kind === 'dots') return <g key={k}>{s.pts.filter(([x]) => x >= p.x0 && x <= p.x1).map(([x, y], j) => <circle key={j} cx={X(x)} cy={Y(y, ax)} r={s.width ?? 2.6} fill={s.hollow ? 'var(--bg-2)' : s.color} stroke={s.color} stroke-width={s.hollow ? 1.3 : 0} opacity={s.hollow ? 1 : 0.9} />)}</g>;
          return <path key={k} d={path(s.pts, ax, s.kind === 'step')} fill="none" stroke={s.color} stroke-width={s.kind === 'raw' ? 0.8 : s.width ?? 1.5} stroke-dasharray={s.dash} opacity={s.kind === 'raw' ? 0.45 : 1} stroke-linejoin="round" />;
        })}
        {(p.rules ?? []).map((r, k) => r.y != null
          ? <g key={`r${k}`}><line x1={padL} x2={padL + pw} y1={Y(r.y, r.axis)} y2={Y(r.y, r.axis)} stroke={r.color ?? 'var(--ink-2)'} stroke-width="1" stroke-dasharray={r.dash ?? '5 4'} />{r.label && <text class="sc-lab" x={padL + pw - 5} y={Y(r.y, r.axis) - 4} text-anchor="end">{r.label}</text>}</g>
          : r.x != null && r.x >= p.x0 && r.x <= p.x1 ? <g key={`r${k}`}><line x1={X(r.x)} x2={X(r.x)} y1={padT} y2={padT + ph} stroke={r.color ?? 'var(--ink-2)'} stroke-width="1" stroke-dasharray={r.dash ?? '2 3'} />{r.label && <text class="sc-lab" x={X(r.x) + (X(r.x) > padL + pw - 90 ? -4 : 4)} y={padT + 11} text-anchor={X(r.x) > padL + pw - 90 ? 'end' : 'start'}>{r.label}</text>}</g> : null)}
        {at != null && <line class="sc-cross" x1={X(at)} x2={X(at)} y1={padT} y2={padT + ph} />}
        {at != null && series.filter((s) => s.kind !== 'raw' && s.kind !== 'bars').map((s, k) => { const pt = s.pts.find(([x]) => x === at); return pt ? <circle key={k} cx={X(at)} cy={Y(pt[1], s.axis ?? 0)} r="3.4" fill="var(--bg-2)" stroke={s.color} stroke-width="1.6" /> : null; })}
      </svg>
    </div>
  );
}

/** A swatch for a legend or a readout: a line in its own dash, a block for bars, a ring for hollow dots. */
export function Key({ color, dash, kind = 'line' }: { color: string; dash?: string; kind?: 'line' | 'block' | 'dot' | 'ring' }) {
  if (kind === 'block') return <i class="sc-key" style={`background:${color}`} />;
  if (kind === 'dot' || kind === 'ring') return <i class="sc-key dot" style={kind === 'dot' ? `background:${color}` : `box-shadow:inset 0 0 0 1.5px ${color}`} />;
  return <svg class="sc-key line" width="20" height="8" aria-hidden="true"><line x1="0" x2="20" y1="4" y2="4" stroke={color} stroke-width="2" stroke-dasharray={dash} /></svg>;
}

export function Legend({ items }: { items: Array<{ name: string; color: string; dash?: string; kind?: 'line' | 'block' | 'dot' | 'ring' }> }) {
  return <div class="sc-legend">{items.map((i) => <span key={i.name}><Key {...i} />{i.name}</span>)}</div>;
}

/**
 * The frame every designed chart sits in: a sentence that leads, the plot with its readout beside it, how to read
 * it, what it says in plain words, the figures as a table that can be downloaded, and the way back up to the
 * question it bears on.
 */
export function ChartShell({ lead, children, readout, legend, how, plain: words, table, question, extra }: {
  lead: ComponentChildren; children: ComponentChildren; readout?: ComponentChildren; legend?: ComponentChildren;
  how: ComponentChildren; plain: ComponentChildren;
  table?: { name: string; head: string[]; rows: Array<Array<string | number>> };
  question?: { id: string; ask: string };
  extra?: ComponentChildren;
}) {
  return (
    <div class="lc">
      <p class="lc-lead">{lead}</p>
      <div class={`lc-body${readout ? '' : ' wide'}`}>
        <div class="lc-plot">{children}{legend}</div>
        {readout && <aside class="lc-read" aria-live="polite">{readout}</aside>}
      </div>
      <div class="lc-how"><b>How to read this</b><span>{how}</span><b>In plain words</b><span>{words}</span></div>
      {extra}
      {table && <Figures {...table} />}
      {question && <div class="lc-up"><a class="lb-jump" href={`#/insights/${question.id}`}>What does this mean? {question.ask}</a></div>}
    </div>
  );
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A chart's figures as a table, folded away until asked for, with a download. */
export function Figures({ name, head, rows }: { name: string; head: string[]; rows: Array<Array<string | number>> }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 24);
  const download = () => void deliver([{ name: safeName(name, 'csv'), data: [head, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\r\n') + '\r\n', mime: 'text/csv' }]);
  return (
    <div class="lc-figs">
      <div class="lc-figs-h">
        <button class="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the figures' : `The figures (${rows.length} row${rows.length === 1 ? '' : 's'})`}</button>
        <button class="btn sm" onClick={download} disabled={!rows.length}>Download the figures</button>
      </div>
      {open && (
        <div class="lc-tw">
          <table><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{shown.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
          {rows.length > shown.length && <button class="btn sm" style="margin:8px" onClick={() => setAll(true)}>Show all {rows.length} rows</button>}
        </div>
      )}
    </div>
  );
}

/** A readout's rows: a swatch, a name and its figure. */
export function Kv({ rows }: { rows: Array<{ name: ComponentChildren; value: ComponentChildren; color?: string; dash?: string; kind?: 'line' | 'block' | 'dot' | 'ring' }> }) {
  return <div class="lc-kv">{rows.map((r, k) => <div key={k}><span>{r.color && <Key color={r.color} dash={r.dash} kind={r.kind} />}{r.name}</span><b>{r.value}</b></div>)}</div>;
}
