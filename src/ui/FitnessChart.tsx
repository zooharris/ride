import type { Fitness } from '../engine/types';

/** Fitness, fatigue and form over the last weeks, as a quiet SVG line chart. */
export function FitnessChart({ series }: { series: Fitness[] }) {
  if (series.length < 2) return <div class="empty small">Fitness and fatigue draw here once rides are synced.</div>;
  const W = 400, H = 120, pad = 4;
  const max = Math.max(10, ...series.map((f) => Math.max(f.ctl, f.atl)));
  const min = Math.min(0, ...series.map((f) => f.tsb));
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (series.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const path = (k: 'ctl' | 'atl' | 'tsb') => series.map((f, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(f[k]).toFixed(1)}`).join(' ');
  const zero = y(0);
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} aria-label="Fitness chart">
        <line x1={pad} x2={W - pad} y1={zero} y2={zero} stroke="var(--line)" />
        <path d={path('tsb')} fill="none" stroke="var(--ink-3)" stroke-width="1" stroke-dasharray="2 3" />
        <path d={path('atl')} fill="none" stroke="var(--z5)" stroke-width="1.5" />
        <path d={path('ctl')} fill="none" stroke="var(--z2)" stroke-width="2.2" />
      </svg>
      <div class="row faint small" style="gap:14px;margin-top:6px">
        <span><span style="color:var(--z2)">—</span> fitness</span>
        <span><span style="color:var(--z5)">—</span> fatigue</span>
        <span><span style="color:var(--ink-3)">- -</span> form</span>
        <span style="margin-left:auto">{series.length} days</span>
      </div>
    </div>
  );
}
