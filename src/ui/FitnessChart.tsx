import type { Fitness } from '../engine/types';
import { addDays } from '../engine/load';
import { FORM_BANDS, LineChart, type ChartMarker } from './LineChart';
import { GLOSSARY } from './glossary';

export type RangeKey = '6w' | '3m' | '6m' | '1y' | 'all';
export const RANGE_DAYS: Record<RangeKey, number> = { '6w': 42, '3m': 91, '6m': 182, '1y': 365, all: 100000 };
const RANGE_LABEL: Record<RangeKey, string> = { '6w': '6 wk', '3m': '3 mo', '6m': '6 mo', '1y': '1 yr', all: 'All' };

/** The range picker every long-run chart shares. */
export function RangePicker({ value, onChange, keys = ['6w', '3m', '6m', '1y'] }: { value: RangeKey; onChange: (k: RangeKey) => void; keys?: RangeKey[] }) {
  return (
    <div class="seg range" role="radiogroup" aria-label="Time range">
      {keys.map((k) => <button key={k} role="radio" aria-checked={value === k} class={value === k ? 'on' : ''} onClick={() => onChange(k)}>{RANGE_LABEL[k]}</button>)}
    </div>
  );
}

/**
 * Fitness, fatigue and form over the chosen range, with the form bands shaded
 * so the dotted line reads at a glance, and (when the calendar has sessions
 * ahead) all three carried forward over them as dashed lines.
 */
export function FitnessChart({ series, projection = [], range = '3m', events = [], height = 170 }: {
  series: Fitness[];
  projection?: Fitness[];
  range?: RangeKey;
  events?: Array<{ date: string; label: string }>;
  height?: number;
}) {
  if (series.length < 2) return <div class="empty small">Fitness and fatigue draw here once activities are synced.</div>;
  const days = RANGE_DAYS[range];
  const hist = series.slice(-days);
  const proj = projection.slice(0, Math.max(14, Math.round(Math.min(days, hist.length) / 2.5)));
  const all = [...hist, ...proj];
  const n = hist.length;
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, hist.length > 200 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  const histOnly = (f: (x: Fitness) => number) => all.map((x, i) => (i < n ? Math.round(f(x)) : null));
  const projOnly = (f: (x: Fitness) => number) => all.map((x, i) => (i >= n - 1 && proj.length ? Math.round(f(x)) : null));
  const step = Math.ceil(all.length / 5);
  const markers: ChartMarker[] = [];
  if (proj.length) markers.push({ index: n - 1, label: 'today', color: 'var(--today)' });
  for (const e of events) { const i = all.findIndex((x) => x.date === e.date); if (i >= 0) markers.push({ index: i, label: e.label, color: 'var(--today)' }); }
  const first = all[0].date, last = all[all.length - 1].date;
  return (
    <LineChart
      series={[
        { name: 'fitness', color: 'var(--info)', values: histOnly((f) => f.ctl), width: 2.2, explain: GLOSSARY.fitness.short },
        { name: 'fatigue', color: 'var(--z5)', values: histOnly((f) => f.atl), width: 1.3, explain: GLOSSARY.fatigue.short },
        { name: 'form', color: 'var(--ink-3)', values: histOnly((f) => f.tsb), width: 1.2, explain: GLOSSARY.form.short },
        ...(proj.length ? [
          { name: 'fitness, as planned', color: 'var(--info)', values: projOnly((f) => f.ctl), dash: '6 4', width: 1.8, explain: 'fitness if every session on the calendar is done as planned' },
          { name: 'fatigue, as planned', color: 'var(--z5)', values: projOnly((f) => f.atl), dash: '6 4', width: 1.1, explain: 'fatigue if every session on the calendar is done as planned; form mirrors it' },
          { name: 'form, as planned', color: 'var(--ink-3)', values: projOnly((f) => f.tsb), dash: '3 3', width: 1.4, explain: 'form if every session on the calendar is done as planned' },
        ] : []),
      ]}
      xLabels={all.map((f) => f.date)}
      xTick={(d, i) => (i === 0 || i === all.length - 1 || (i % step === 0 && i < all.length - step / 2)) ? fmt(d) : null}
      yTitle="training load points"
      bands={FORM_BANDS}
      markers={markers}
      height={height}
      readout={(i) => { const f = all[i]; const future = i >= n; return `${fmt(f.date)}${future ? ' (planned)' : ''} · fitness ${Math.round(f.ctl)} · fatigue ${Math.round(f.atl)} · form ${f.tsb > 0 ? '+' : ''}${Math.round(f.tsb)}`; }}
      key={`${first}-${last}`}
    />
  );
}

/** Today minus a number of days, for "this week vs last" deltas. */
export function valueDaysAgo(series: Fitness[], days: number): Fitness | undefined {
  const last = series[series.length - 1];
  if (!last) return undefined;
  const d = addDays(last.date, -days);
  return series.find((f) => f.date === d);
}
