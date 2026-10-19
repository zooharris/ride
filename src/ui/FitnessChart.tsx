import type { Fitness } from '../engine/types';
import { FORM_BANDS, LineChart } from './LineChart';

/** Fitness, fatigue and form over the last weeks, with the form bands shaded so the dashed line reads at a glance. */
export function FitnessChart({ series }: { series: Fitness[] }) {
  if (series.length < 2) return <div class="empty small">Fitness and fatigue draw here once rides are synced.</div>;
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <LineChart
      series={[
        { name: 'fitness', color: 'var(--z2)', values: series.map((f) => Math.round(f.ctl)), width: 2.2, explain: '42-day weighted average of daily training load' },
        { name: 'fatigue', color: 'var(--z5)', values: series.map((f) => Math.round(f.atl)), width: 1.3, explain: '7-day weighted average of daily training load' },
        { name: 'form', color: 'var(--ink-3)', values: series.map((f) => Math.round(f.tsb)), dash: '2 3', width: 1.2, explain: 'fitness minus fatigue; negative while building, positive when fresh' },
      ]}
      xLabels={series.map((f) => f.date)}
      xTick={(d, i) => (i === 0 || i === series.length - 1 || (i % 21 === 0 && i < series.length - 10)) ? fmt(d) : null}
      yTitle="training load points"
      bands={FORM_BANDS}
      height={150}
      readout={(i) => { const f = series[i]; return `${fmt(f.date)} · fitness ${Math.round(f.ctl)} · fatigue ${Math.round(f.atl)} · form ${f.tsb > 0 ? '+' : ''}${Math.round(f.tsb)}`; }}
    />
  );
}
