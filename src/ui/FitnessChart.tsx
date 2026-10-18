import { useState } from 'preact/hooks';
import type { Fitness } from '../engine/types';

/** Fitness, fatigue and form over the last weeks, as a quiet SVG line chart. */
export function FitnessChart({ series }: { series: Fitness[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length < 2) return <div class="empty small">Fitness and fatigue draw here once rides are synced.</div>;
  const W = 400, H = 120, pad = 4;
  const max = Math.max(10, ...series.map((f) => Math.max(f.ctl, f.atl)));
  const min = Math.min(0, ...series.map((f) => f.tsb));
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const path = (k: 'ctl' | 'atl' | 'tsb') => series.map((f, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(f[k]).toFixed(1)}`).join(' ');
  const zero = y(0);
  const h = hover != null ? series[hover] : null;
  const first = series[0].date, last = series[series.length - 1].date;
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div class="chart" style="position:relative">
      <svg viewBox={`0 0 ${W} ${H}`} aria-label="Fitness chart" onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (series.length - 1)); setHover(Math.max(0, Math.min(series.length - 1, i))); }} onMouseLeave={() => setHover(null)}>
        <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="var(--line)" />
        <text x={pad} y={zero - 3} fill="var(--ink-3)" font-size="9">0</text>
        <text x={pad} y={y(max) + 9} fill="var(--ink-3)" font-size="9">{Math.round(max)}</text>
        <path d={path('tsb')} fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3" />
        <path d={path('atl')} fill="none" stroke="var(--z5)" stroke-width="1.5" />
        <path d={path('ctl')} fill="none" stroke="var(--z2)" stroke-width="2.2" />
        {h && hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad} y2={H - pad} stroke="var(--accent)" stroke-width="1" />}
      </svg>
      <div class="row faint small" style="gap:14px;margin-top:4px">
        <span>{fmt(first)}</span><span style="margin-left:auto">{fmt(last)}</span>
      </div>
      <div class="row faint small" style="gap:14px;margin-top:4px">
        <span title="Fitness: a 42-day weighted average of daily training load. Higher means more trained."><span style="color:var(--z2)">—</span> fitness</span>
        <span title="Fatigue: a 7-day weighted average of daily training load. It rises fast after hard days and falls fast with rest."><span style="color:var(--z5)">—</span> fatigue</span>
        <span title="Form: fitness minus fatigue. Below zero while building; above zero when fresh."><span style="color:var(--ink-3)">- -</span> form</span>
        <span style="margin-left:auto">load points per day</span>
      </div>
      {h && (
        <div class="panel small" style="position:absolute;top:6px;right:6px;padding:6px 10px;pointer-events:none">
          <b>{fmt(h.date)}</b> · fitness {h.ctl.toFixed(0)} · fatigue {h.atl.toFixed(0)} · form {h.tsb > 0 ? '+' : ''}{h.tsb.toFixed(0)}
        </div>
      )}
    </div>
  );
}
