import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PanelDef, Sample } from './ActivityCharts';
import { chartHeight, COLORS, DASH, HONEST, LANE_H, LineKey } from './LargeView';
import { correlation, linkWords, trendLine, type Pair } from '../engine/compare';
import { getSetting, setSetting } from '../data/db';
import { deliver } from '../export/deliver';
import { safeName } from '../export/names';
import { useWidth } from './useWidth';

/**
 * One chart of a recording opened large (13 Nov 2026), on the pattern of the large Progress charts: the measure
 * clicked, with up to three of the recording's other measures laid over it, together (each on its own scale) or
 * stacked in lanes; a pointer that reads every measure at that moment; a strip to look at one part of the
 * activity; and panels that give each measure's low, high and average over that part and say how closely two of
 * them move together. Everything is worked out from the recording itself.
 */

/** A measure of the recording: the chart's own, plus the breathing rate when there is one. */
export interface Channel { key: string; title: string; unit: string; get: (p: Sample) => number | undefined; digits: number }

export function channelsOf(panels: PanelDef[], samples: Sample[]): Channel[] {
  const out: Channel[] = panels.map((p) => ({ key: p.key, title: p.key === 've' ? 'Ventilation' : p.title, unit: p.unit, get: p.get, digits: p.key === 'speed' || p.key === 'pace' ? 1 : 0 }));
  if (samples.some((s) => s.br != null)) out.push({ key: 'br', title: 'Breathing rate', unit: 'breaths/min', get: (p) => p.br, digits: 0 });
  return out;
}

const fmt = (c: Channel, v: number | undefined) => (v == null || !isFinite(v) ? '–' : `${c.digits ? v.toFixed(c.digits) : Math.round(v)} ${c.unit}`);
const num = (c: Channel, v: number) => (c.digits ? v.toFixed(c.digits) : `${Math.round(v)}`);
/** Samples needed where both measures have a value before anything is said about them together. */
export const MIN_SAMPLES = 30;

/** Low, high and average of a measure over part of the recording. */
export function partSummary(samples: Sample[], get: (p: Sample) => number | undefined, lo: number, hi: number): { low: number; high: number; avg: number; n: number } | undefined {
  let low = Infinity, high = -Infinity, s = 0, n = 0;
  for (let i = lo; i <= hi && i < samples.length; i++) { const v = get(samples[i]); if (v == null || !isFinite(v)) continue; if (v < low) low = v; if (v > high) high = v; s += v; n++; }
  return n ? { low, high, avg: s / n, n } : undefined;
}

export function ActivityLarge({ name, samples, panels, open, xOf, fmtX, byDistance, onClose }: {
  name: string; samples: Sample[]; panels: PanelDef[]; open: string; xOf: (p: Sample) => number; fmtX: (v: number) => string; byDistance: boolean; onClose: () => void;
}) {
  const channels = useMemo(() => channelsOf(panels, samples), [panels, samples]);
  const view = channels.find((c) => c.key === open) ?? channels[0];
  const others = channels.filter((c) => c.key !== view.key);
  const [over, setOver0] = useState<string[]>([]);
  const [stacked, setStacked0] = useState(false);
  useEffect(() => {
    void Promise.all([getSetting<Record<string, string[]>>('activityOver', {}), getSetting<string>('largeShow', 'together')]).then(([o, show]) => {
      setOver0((o[view.key] ?? []).filter((k) => others.some((c) => c.key === k)).slice(0, 3));
      setStacked0(show === 'stacked');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.key]);
  const setOver = (o: string[]) => { setOver0(o); void getSetting<Record<string, string[]>>('activityOver', {}).then((all) => setSetting('activityOver', { ...all, [view.key]: o })); };
  const setStacked = (b: boolean) => { setStacked0(b); void setSetting('largeShow', b ? 'stacked' : 'together'); };
  const full = over.length >= 3;
  const toggle = (k: string) => setOver(over.includes(k) ? over.filter((x) => x !== k) : full ? over : [...over, k]);
  const defs = [view, ...over.map((k) => channels.find((c) => c.key === k)!).filter(Boolean)];

  // The part of the activity being looked at, as sample numbers.
  const last = samples.length - 1;
  const [win, setWin] = useState<[number, number]>([0, last]);
  const [lo, hi] = [Math.max(0, Math.min(win[0], last)), Math.max(0, Math.min(win[1], last))];
  const [at0, setAt] = useState<number | null>(null);
  const at = at0 != null && at0 >= lo && at0 <= hi ? at0 : hi;

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('.lv-close')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    document.body.classList.add('lv-open');
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('lv-open'); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [wrap, wrapW] = useWidth<HTMLDivElement>(900);
  const phone = typeof window !== 'undefined' && window.innerWidth < 760;
  const W = Math.max(260, wrapW);
  const together = !stacked && defs.length >= 2;
  const col = phone ? 38 : 46;
  const padL = 46, padR = together ? col * (defs.length - 1) : 12, padT = 8, padB = 22, gap = 18;
  const lanes = stacked ? defs.map((_, i) => [i]) : [defs.map((_, i) => i)];
  const laneH = lanes.length > 1 ? LANE_H : chartHeight(W);
  const H = padT + padB + lanes.length * laneH + (lanes.length - 1) * gap;
  const plotW = W - padL - padR;
  const x0 = xOf(samples[lo]), x1 = Math.max(x0 + 1e-9, xOf(samples[hi]));
  const X = (i: number) => padL + ((xOf(samples[i]) - x0) / (x1 - x0)) * plotW;
  const sums = defs.map((d) => partSummary(samples, d.get, lo, hi));
  const scale = (i: number) => { const s = sums[i]; if (!s) return { a: 0, b: 1 }; const pad = (s.high - s.low || 1) * 0.08; return { a: defs[i].key === 'watts' ? 0 : s.low - pad, b: s.high + pad }; };
  const scales = defs.map((_, i) => scale(i));
  const laneTop = (l: number) => padT + l * (laneH + gap);
  const Y = (i: number, v: number) => { const s = scales[i]; return laneTop(stacked ? i : 0) + laneH - ((v - s.a) / (s.b - s.a)) * laneH; };
  const path = (i: number) => { let d = '', prev = false; for (let k = lo; k <= hi; k++) { const v = defs[i].get(samples[k]); if (v == null || !isFinite(v)) { prev = false; continue; } d += `${prev ? 'L' : 'M'}${X(k).toFixed(1)},${Y(i, v).toFixed(1)}`; prev = true; } return d; };
  const ticks = (i: number) => { const s = scales[i]; return [s.a + (s.b - s.a) * 0.1, (s.a + s.b) / 2, s.b - (s.b - s.a) * 0.1]; };
  const svg = useRef<SVGSVGElement>(null);
  const pick = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const xv = x0 + (((clientX - r.left) / r.width) * W - padL) / plotW * (x1 - x0);
    let best = lo; for (let k = lo; k <= hi; k++) if (Math.abs(xOf(samples[k]) - xv) < Math.abs(xOf(samples[best]) - xv)) best = k;
    setAt(best);
  };

  // Two measures against each other, over the part shown.
  const [pairWith, setPairWith] = useState(0);
  const j = Math.max(0, Math.min(pairWith, defs.length - 2));
  const other = defs.length > 1 ? defs[j + 1] : undefined;
  const pairs: Pair[] = useMemo(() => {
    if (!other) return [];
    const out: Pair[] = [];
    for (let k = lo; k <= hi; k++) { const y = view.get(samples[k]), x = other.get(samples[k]); if (y != null && x != null && isFinite(x) && isFinite(y)) out.push({ key: String(k), x, y }); }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other?.key, view.key, lo, hi, samples]);

  const download = () => {
    const rows = [`${byDistance ? 'Distance' : 'Time'},${defs.map((d) => `${d.title} (${d.unit})`).join(',')}`];
    for (let k = lo; k <= hi; k++) { const cells = defs.map((d) => { const v = d.get(samples[k]); return v == null || !isFinite(v) ? '' : num(d, v); }); if (cells.some((c) => c)) rows.push(`${fmtX(xOf(samples[k]))},${cells.join(',')}`); }
    void deliver([{ name: safeName(`${name} ${view.title}`, 'csv'), data: rows.join('\r\n') + '\r\n', mime: 'text/csv' }]);
  };
  const whole = lo === 0 && hi === last;

  return (
    <div class="lv-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="lv" role="dialog" aria-modal="true" aria-labelledby="al-title" ref={box}>
        <div class="lv-head">
          <div class="lv-title"><h2 id="al-title">{view.title}</h2><p class="small muted">{name}</p></div>
          <button class="btn sm lv-close" onClick={onClose} aria-label={`Close ${view.title}`}>Close</button>
        </div>
        <div class="lv-tools">
          <span class="small muted">{whole ? 'The whole activity' : `${fmtX(x0)} to ${fmtX(x1)}`}</span>
          {!whole && <button class="btn sm" onClick={() => setWin([0, last])}>Show the whole activity</button>}
          <button class="btn sm" onClick={download}>Download these numbers</button>
        </div>
        <div class="lv-ctl">
          {others.length > 0 && (
            <div class="lv-row" role="group" aria-label="Lay over it">
              <span class="lv-lab">Lay over it</span>
              {others.map((c) => { const i = over.indexOf(c.key); const on = i >= 0; return <button key={c.key} class={`chip sm${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && full} onClick={() => toggle(c.key)}>{on && <LineKey i={i + 1} />}{c.title}</button>; })}
              {full && <span class="faint small">Three at once is the most.</span>}
            </div>
          )}
          {over.length > 0 && (
            <div class="lv-row" role="group" aria-label="Show">
              <span class="lv-lab">Show</span>
              <div class="seg range sm">
                <button class={!stacked ? 'on' : ''} aria-pressed={!stacked} onClick={() => setStacked(false)}>Together</button>
                <button class={stacked ? 'on' : ''} aria-pressed={stacked} onClick={() => setStacked(true)}>Stacked</button>
              </div>
              {!stacked && <span class="faint small">Each measure has its own scale, in its own colour.</span>}
            </div>
          )}
        </div>
        <div class="lv-main">
          <div class="lv-chartcol" ref={wrap}>
            <div class="lv-read small" aria-live="polite">
              <b>{fmtX(xOf(samples[at]))}</b>
              {defs.map((d, i) => <span key={d.key} class="pr-item"><LineKey i={i} />{d.title} <b>{fmt(d, d.get(samples[at]))}</b></span>)}
            </div>
            <svg ref={svg} class="lv-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} tabIndex={0} role="img" style="touch-action:pan-y"
              aria-label={`${view.title}${defs.length > 1 ? ` with ${defs.slice(1).map((d) => d.title.toLowerCase()).join(', ')}` : ''}. Arrow keys move the pointer.`}
              onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)}
              onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAt(Math.max(lo, Math.min(hi, at + (e.key === 'ArrowLeft' ? -1 : 1)))); } }}>
              {lanes.map((ids, l) => (
                <g key={l}>
                  <rect x={padL} y={laneTop(l)} width={plotW} height={laneH} fill="none" stroke="var(--line)" />
                  {ids.filter((i) => stacked || i === 0).map((i) => ticks(i).map((tv, k) => <g key={`${i}-${k}`}>
                    <line x1={padL} x2={padL + plotW} y1={Y(i, tv)} y2={Y(i, tv)} stroke="var(--line)" stroke-dasharray="2 4" />
                    <text x={padL - 5} y={Y(i, tv) + 3} text-anchor="end" font-size="10" fill={COLORS[i]}>{num(defs[i], tv)}</text>
                  </g>))}
                  {together && ids.filter((i) => i > 0).map((i) => ticks(i).map((tv, k) => <text key={`r${i}-${k}`} x={padL + plotW + 5 + (i - 1) * col} y={Y(i, tv) + 3} font-size="10" fill={COLORS[i]}>{num(defs[i], tv)}</text>))}
                  {stacked && <text x={padL + 6} y={laneTop(l) + 13} font-size="11" font-weight="600" fill={COLORS[ids[0]]}>{defs[ids[0]].title} ({defs[ids[0]].unit})</text>}
                  {ids.map((i) => <path key={defs[i].key} d={path(i)} fill="none" stroke={COLORS[i]} stroke-width={i === 0 ? 2 : 1.6} stroke-dasharray={DASH[i]} stroke-linejoin="round" />)}
                  <line x1={X(at)} x2={X(at)} y1={laneTop(l)} y2={laneTop(l) + laneH} stroke="var(--ink-2)" />
                  {ids.map((i) => { const v = defs[i].get(samples[at]); return v == null || !isFinite(v) ? null : <circle key={`p${i}`} cx={X(at)} cy={Y(i, v)} r="3.6" fill={COLORS[i]} stroke="var(--bg-2)" stroke-width="1.5" />; })}
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => <text key={f} x={padL + f * plotW} y={H - 6} text-anchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} font-size="10" fill="var(--ink-3)">{fmtX(x0 + f * (x1 - x0))}</text>)}
            </svg>
            <PartStrip samples={samples} get={view.get} lo={lo} hi={hi} width={W} onChange={(a, b) => setWin([a, b])} />
            <p class="faint small" style="margin:0">The strip is the whole activity. Drag its window to move along it; pull the window's ends to look at one part.</p>
          </div>
          <div class="lv-panels">
            <section class="lv-p">
              <h3>{whole ? 'Over the whole activity' : 'Over this part'}</h3>
              <table class="lv-t small">
                <thead><tr><th /><th class="r">Low</th><th class="r">High</th><th class="r">Average</th></tr></thead>
                <tbody>{defs.map((d, i) => { const s = sums[i]; return <tr key={d.key}><td><LineKey i={i} /> {d.title} <span class="faint">({d.unit})</span></td>{s ? <><td class="r">{num(d, s.low)}</td><td class="r">{num(d, s.high)}</td><td class="r">{num(d, s.avg)}</td></> : <td class="r faint" colSpan={3}>no values</td>}</tr>; })}</tbody>
              </table>
            </section>
            {other && (
              <section class="lv-p">
                <h3>Do they move together?</h3>
                {defs.length > 2 && <div class="lv-row" style="margin-bottom:6px">{defs.slice(1).map((d, k) => <button key={d.key} class={`chip sm${k === j ? ' on' : ''}`} aria-pressed={k === j} onClick={() => setPairWith(k)}><LineKey i={k + 1} />{d.title}</button>)}</div>}
                <Scatter view={view} other={other} pairs={pairs} oi={j + 1} />
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Scatter({ view, other, pairs, oi }: { view: Channel; other: Channel; pairs: Pair[]; oi: number }) {
  const a = view.title.toLowerCase(), b = other.title.toLowerCase();
  if (pairs.length < MIN_SAMPLES) return <p class="small" style="margin:0">Too little of this part has both {a} and {b} to say anything about them together.</p>;
  const r = correlation(pairs), tl = trendLine(pairs);
  const W = 260, H = 150, pl = 34, pb = 20, pt = 6, pr = 8;
  let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
  for (const p of pairs) { xl = Math.min(xl, p.x); xh = Math.max(xh, p.x); yl = Math.min(yl, p.y); yh = Math.max(yh, p.y); }
  if (xh === xl) xh = xl + 1; if (yh === yl) yh = yl + 1;
  const X = (x: number) => pl + ((x - xl) / (xh - xl)) * (W - pl - pr), Y = (y: number) => pt + (1 - (y - yl) / (yh - yl)) * (H - pt - pb);
  const words = linkWords(r);
  const dir = r == null || Math.abs(r) < 0.2 ? '' : r > 0 ? `: when ${b} is higher, ${a} tends to be higher too` : `: when ${b} is higher, ${a} tends to be lower`;
  return (
    <>
      <p class="small" style="margin:0 0 6px">Moment by moment, {words} between {a} and {b}{dir}.</p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} class="lv-scatter" role="img" aria-label={`${a} against ${b}: ${words}`}>
        <rect x={pl} y={pt} width={W - pl - pr} height={H - pt - pb} fill="none" stroke="var(--line)" />
        {pairs.map((p) => <circle key={p.key} cx={X(p.x)} cy={Y(p.y)} r="2" fill={COLORS[0]} fill-opacity="0.45" />)}
        {tl && <line x1={X(xl)} y1={Y(tl.slope * xl + tl.intercept)} x2={X(xh)} y2={Y(tl.slope * xh + tl.intercept)} stroke={COLORS[oi]} stroke-width="1.8" stroke-dasharray={DASH[oi]} />}
        <text x={pl} y={H - 5} font-size="9" fill="var(--ink-3)">{fmt(other, xl)}</text>
        <text x={W - pr} y={H - 5} font-size="9" text-anchor="end" fill="var(--ink-3)">{other.title} {fmt(other, xh)}</text>
        <text x={pl - 3} y={pt + 8} font-size="9" text-anchor="end" fill="var(--ink-3)">{num(view, yh)}</text>
        <text x={pl - 3} y={H - pb} font-size="9" text-anchor="end" fill="var(--ink-3)">{num(view, yl)}</text>
      </svg>
      <p class="faint small lv-foot">One dot for each moment of the recording. Some measures answer late (heart rate follows power by a minute or so), which weakens the link shown. {HONEST}</p>
    </>
  );
}

/** The whole activity in miniature, with a window over the part the chart shows. */
function PartStrip({ samples, get, lo, hi, width, onChange }: { samples: Sample[]; get: (p: Sample) => number | undefined; lo: number; hi: number; width: number; onChange: (lo: number, hi: number) => void }) {
  const last = samples.length - 1;
  const H = 36, padL = 46, padR = 12, plotW = width - padL - padR;
  const X = (i: number) => padL + (i / Math.max(1, last)) * plotW;
  let a = Infinity, b = -Infinity; for (const s of samples) { const v = get(s); if (v != null && isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); } }
  if (!isFinite(a)) { a = 0; b = 1; } if (b === a) b = a + 1;
  let d = '', prev = false;
  samples.forEach((s, i) => { const v = get(s); if (v == null || !isFinite(v)) { prev = false; return; } d += `${prev ? 'L' : 'M'}${X(i).toFixed(1)},${(4 + (H - 8) * (1 - (v - a) / (b - a))).toFixed(1)}`; prev = true; });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'move' | 'lo' | 'hi'; i0: number; lo0: number; hi0: number } | null>(null);
  const MIN = Math.min(last, 10);
  const iAt = (e: PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return Math.round(((((e.clientX - r.left) / r.width) * width - padL) / plotW) * last); };
  const down = (e: PointerEvent) => {
    const i = iAt(e), near = Math.max(2, Math.round(last * 0.015));
    const mode = Math.abs(i - lo) <= near ? 'lo' : Math.abs(i - hi) <= near ? 'hi' : i > lo && i < hi ? 'move' : null;
    if (!mode) { const span = hi - lo; let f = Math.max(0, Math.min(last - span, i - Math.round(span / 2))); onChange(f, f + span); return; }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, i0: i, lo0: lo, hi0: hi };
  };
  const move = (e: PointerEvent) => {
    const g = drag.current; if (!g) return;
    const k = iAt(e) - g.i0;
    if (g.mode === 'move') { const span = g.hi0 - g.lo0; const f = Math.max(0, Math.min(last - span, g.lo0 + k)); onChange(f, f + span); }
    else if (g.mode === 'lo') onChange(Math.max(0, Math.min(g.hi0 - MIN, g.lo0 + k)), g.hi0);
    else onChange(g.lo0, Math.min(last, Math.max(g.lo0 + MIN, g.hi0 + k)));
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const span = hi - lo, k = (e.key === 'ArrowLeft' ? -1 : 1) * Math.max(1, Math.round(span / 10));
    const f = Math.max(0, Math.min(last - span, lo + k)); onChange(f, f + span);
  };
  return (
    <svg ref={svg} class="lv-strip" width={width} height={H} viewBox={`0 0 ${width} ${H}`} tabIndex={0} role="slider" aria-label="The whole activity: drag the window to move along it, pull its ends to look at one part, or use the arrow keys"
      aria-valuetext={`from ${Math.round((lo / Math.max(1, last)) * 100)}% to ${Math.round((hi / Math.max(1, last)) * 100)}% of the activity`} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onKeyDown={keys}>
      <rect x={padL} y={1} width={plotW} height={H - 2} fill="var(--soft)" rx="3" />
      <path d={d} fill="none" stroke={COLORS[0]} stroke-width="1.2" opacity="0.8" />
      <rect class="lv-win" x={X(lo)} y={1} width={Math.max(4, X(hi) - X(lo))} height={H - 2} rx="3" />
      <rect x={X(lo) - 3} y={8} width={6} height={H - 16} rx="2" fill="var(--ink-2)" style="cursor:ew-resize" />
      <rect x={X(hi) - 3} y={8} width={6} height={H - 16} rx="2" fill="var(--ink-2)" style="cursor:ew-resize" />
    </svg>
  );
}
