import type { MeasureDef, Values } from '../../engine/measures';
import { inRange } from '../../engine/measures';

const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/**
 * A measure in miniature, in the Lab's instrument look: a ruled frame with tick marks, and on it only what the rider
 * has recorded. A line joins the readings when there are enough to make one; fewer are drawn as the points they are;
 * none leaves the frame empty. Nothing is ever sketched in.
 */
export function Spark({ def, values, from, to, w = 300, h = 64, label }: { def: Pick<MeasureDef, 'style' | 'cadence' | 'name'>; values: Values; from: string; to: string; w?: number; h?: number; label?: string }) {
  const pts = inRange(values, from, to);
  const span = Math.max(1, days(from, to));
  const padL = 4, padR = 6, padT = 6, padB = 9;
  const x = (d: string) => padL + (days(from, d) + (def.cadence === 'week' ? 3 : 0)) / (span + (def.cadence === 'week' ? 6 : 0)) * (w - padL - padR);
  let lo = Infinity, hi = -Infinity;
  for (const [, v] of pts) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (def.style === 'bars') lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const y0 = def.style === 'bars' ? lo : lo - pad, y1 = hi + pad;
  const y = (v: number) => h - padB - (v - y0) / (y1 - y0 || 1) * (h - padT - padB);
  const base = h - padB;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => padL + f * (w - padL - padR));
  const barW = Math.max(1.5, Math.min(14, (w - padL - padR) / Math.max(1, span / (def.cadence === 'week' ? 7 : 1)) * 0.7));
  const joined = def.style === 'line' && pts.length >= 3;
  // A point that keeps its shape however the frame is stretched: a stroke of no length with round ends.
  const dot = (d: string, v: number, cls: string) => <path key={d} class={cls} d={`M${x(d).toFixed(1)},${y(v).toFixed(1)}h0`} vector-effect="non-scaling-stroke" />;
  const path = pts.map(([d, v], k) => `${k ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg class="lb-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label ?? (pts.length ? `${def.name}: ${pts.length} reading${pts.length === 1 ? '' : 's'} in this period` : `${def.name}: nothing in this period`)}>
      <line class="lb-ax" x1={padL} x2={w - padR} y1={base} y2={base} />
      {ticks.map((tx) => <line key={tx} class="lb-ax" x1={tx} x2={tx} y1={base} y2={base + 4} />)}
      <line class="lb-grid" x1={padL} x2={w - padR} y1={padT + (base - padT) / 2} y2={padT + (base - padT) / 2} />
      {def.style === 'bars' && pts.map(([d, v]) => v > 0 && <rect key={d} class="lb-bar" x={x(d) - barW / 2} width={barW} y={y(v)} height={Math.max(0.5, base - y(v))} />)}
      {joined && <path class="lb-line" d={path} vector-effect="non-scaling-stroke" />}
      {def.style !== 'bars' && !joined && pts.map(([d, v]) => dot(d, v, pts.length > 40 ? 'lb-dot sm' : 'lb-dot'))}
      {joined && last && dot(last[0], last[1], 'lb-now')}
    </svg>
  );
}

/** The frame alone, for a chart the rider has nothing for yet. */
export function EmptyFrame({ w = 300, h = 64, label }: { w?: number; h?: number; label: string }) {
  const padL = 4, padR = 6, base = h - 9;
  return (
    <svg class="lb-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line class="lb-ax" x1={padL} x2={w - padR} y1={base} y2={base} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const tx = padL + f * (w - padL - padR); return <line key={f} class="lb-ax" x1={tx} x2={tx} y1={base} y2={base + 4} />; })}
      <line class="lb-grid" x1={padL} x2={w - padR} y1={6 + (base - 6) / 2} y2={6 + (base - 6) / 2} />
    </svg>
  );
}
