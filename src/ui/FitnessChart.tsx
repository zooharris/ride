import type { HrNumbers } from '../engine/mornings';
import type { Fitness, PlannedWorkout, Ride, Wellness, Workout } from '../engine/types';
import { addDays } from '../engine/load';
import { aerobicPoints, dailyLoad, rollingDays, rollingMean } from '../engine/progress';
import { DAY_KIND_PHRASE, dayKind } from '../engine/mornings';
import { FORM_BANDS, LineChart, type ChartMarker, type ChartSeries } from './LineChart';
import { findWorkout } from './store';
import { plannedTss } from './week';
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

/** The caption under the fitness chart, on Progress and on Today. */
export const CHART_CAPTION = 'Fitness, fatigue and form share the left axis. Each other line is drawn on its own scale, as a shape; hover or touch the chart to read its number for any day. Dashed lines carry fitness, fatigue, form and planned load forward over your calendar.';

/** Everything that can be laid over the fitness chart, in the order the chips show them. */
export type OverlayKey = 'fitness' | 'fatigue' | 'form' | 'load' | 'hrv' | 'sleep' | 'restinghr' | 'weight' | 'efficiency' | 'drift';
export const OVERLAYS: Array<{ key: OverlayKey; label: string; color: string; bars?: boolean; dotted?: boolean }> = [
  { key: 'fitness', label: 'Fitness', color: 'var(--info)' },
  { key: 'fatigue', label: 'Fatigue', color: 'var(--z5)' },
  { key: 'form', label: 'Form', color: 'var(--ink-3)' },
  { key: 'load', label: 'Daily load', color: 'var(--ride)', bars: true },
  { key: 'hrv', label: 'HRV', color: 'var(--aqua)' },
  { key: 'sleep', label: 'Sleep', color: 'var(--info)', dotted: true },
  { key: 'restinghr', label: 'Resting HR', color: 'var(--z6)' },
  { key: 'weight', label: 'Weight', color: 'var(--z7)' },
  { key: 'efficiency', label: 'Efficiency', color: 'var(--z3)' },
  { key: 'drift', label: 'Drift', color: 'var(--z4)' },
];
export const DEFAULT_OVERLAYS: OverlayKey[] = ['fitness', 'fatigue', 'form', 'load'];

/** What the chart needs to draw anything beyond fitness, fatigue and form. */
export interface OverlayData {
  rides: Ride[];
  wellness: Wellness[];          // trusted wellness: days the rider set aside are gaps
  planned: PlannedWorkout[];
  mine: Workout[];
  lthr: number;
  hr?: HrNumbers;
  imperial: boolean;
}

export const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const dur = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };

/**
 * Fitness, fatigue and form over the chosen range, with the form bands shaded
 * so the dotted line reads at a glance, and (when the calendar has sessions
 * ahead) all three carried forward over them as dashed lines. With `data`, any
 * of the overlays in `on` is laid over the same days: daily load as bars (the
 * calendar's planned load beyond today as dotted outlines), wellness and the
 * aerobic numbers each on its own scale, read through the readout, which also
 * names the day's sessions and what kind of morning it was.
 */
export function FitnessChart({ series, projection = [], range = '3m', events = [], height = 170, on = ['fitness', 'fatigue', 'form'], data }: {
  series: Fitness[];
  projection?: Fitness[];
  range?: RangeKey;
  events?: Array<{ date: string; label: string }>;
  height?: number;
  on?: OverlayKey[];
  data?: OverlayData;
}) {
  if (series.length < 2) return <div class="empty small">Fitness and fatigue draw here once activities are synced.</div>;
  const days = RANGE_DAYS[range];
  const hist = series.slice(-days);
  const proj = projection.slice(0, Math.max(14, Math.round(Math.min(days, hist.length) / 2.5)));
  const all = [...hist, ...proj];
  const dates = all.map((f) => f.date);
  const n = hist.length;
  const has = (k: OverlayKey) => on.includes(k);
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, hist.length > 200 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const histOnly = (f: (x: Fitness) => number) => all.map((x, i) => (i < n ? Math.round(f(x)) : null));
  const projOnly = (f: (x: Fitness) => number) => all.map((x, i) => (i >= n - 1 && proj.length ? Math.round(f(x)) : null));
  const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
  const step = Math.ceil(all.length / 5);
  const markers: ChartMarker[] = [];
  if (proj.length) markers.push({ index: n - 1, label: 'today', color: 'var(--today)' });
  for (const e of events) { const i = all.findIndex((x) => x.date === e.date); if (i >= 0) markers.push({ index: i, label: e.label, color: 'var(--today)' }); }
  const first = all[0].date, last = all[all.length - 1].date;

  const lines: ChartSeries[] = [];
  if (has('fitness')) lines.push({ name: 'fitness', group: 'fitness', color: 'var(--info)', values: histOnly((f) => f.ctl), width: 2.2, explain: GLOSSARY.fitness.short });
  if (has('fatigue')) lines.push({ name: 'fatigue', group: 'fatigue', color: 'var(--z5)', values: histOnly((f) => f.atl), width: 1.3, explain: GLOSSARY.fatigue.short });
  if (has('form')) lines.push({ name: 'form', group: 'form', color: 'var(--ink-3)', values: histOnly((f) => f.tsb), width: 1.2, explain: GLOSSARY.form.short, format: signed });
  if (proj.length) {
    if (has('fitness')) lines.push({ name: 'fitness, as planned', group: 'fitness', color: 'var(--info)', values: projOnly((f) => f.ctl), dash: '6 4', width: 1.8, explain: 'fitness if every session on the calendar is done as planned' });
    if (has('fatigue')) lines.push({ name: 'fatigue, as planned', group: 'fatigue', color: 'var(--z5)', values: projOnly((f) => f.atl), dash: '6 4', width: 1.1, explain: 'fatigue if every session on the calendar is done as planned; form mirrors it' });
    if (has('form')) lines.push({ name: 'form, as planned', group: 'form', color: 'var(--ink-3)', values: projOnly((f) => f.tsb), dash: '3 3', width: 1.4, explain: 'form if every session on the calendar is done as planned', format: signed });
  }

  if (data) {
    // Daily load: done to today, the calendar's planned load beyond it.
    if (has('load')) {
      const done = dailyLoad(data.rides);
      const plannedOn = new Map<string, number>();
      for (const p of data.planned) {
        if (p.date <= dates[n - 1] || (p.status !== 'planned' && p.status !== 'sent')) continue;
        const w = findWorkout(data.mine, p.workoutId);
        if (w) plannedOn.set(p.date, (plannedOn.get(p.date) ?? 0) + plannedTss(w));
      }
      lines.push({ name: 'daily load', color: 'var(--ride)', kind: 'bars', projectedFrom: n, unit: 'TSS', explain: 'Training load done each day; beyond today, what the calendar plans',
        values: dates.map((d, i) => { const v = i < n ? done.get(d)?.tss : plannedOn.get(d); return v ? Math.round(v) : null; }) });
    }
    // Wellness: each morning faint, the 7-day average bold, on one scale of its own; stops at today.
    const byDate = new Map(data.wellness.map((w) => [w.date, w]));
    const histDates = dates.slice(0, n);
    const wellnessPair = (key: OverlayKey, label: string, color: string, get: (w: Wellness) => number | undefined, unit: string, extra: Partial<ChartSeries> = {}) => {
      const day = histDates.map((d) => { const w = byDate.get(d); const v = w ? get(w) : undefined; return v != null && v > 0 ? v : null; });
      const avg = rollingDays(histDates, day, 7);
      const pad = (xs: Array<number | null>) => [...xs, ...Array(all.length - n).fill(null)];
      lines.push({ name: `${label}, each morning`, group: label, color, values: pad(day), dots: true, opacity: 0.35, scale: 'own', scaleKey: key, unit, hideInLegend: true, ...extra });
      lines.push({ name: `${label}, 7-day average`, group: `${label} 7-day`, color, values: pad(avg.map((v) => (v == null ? null : Math.round(v * 10) / 10))), width: 2.2, scale: 'own', scaleKey: key, unit, connectGaps: false, ...extra });
    };
    if (has('hrv')) wellnessPair('hrv', 'HRV', 'var(--aqua)', (w) => w.hrv, 'ms', { format: (v) => `${Math.round(v)}` });
    if (has('sleep')) wellnessPair('sleep', 'sleep', 'var(--info)', (w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined), '', { format: hm, ownFloor: 0, dash: '1 3', width: 2 });
    if (has('restinghr')) wellnessPair('restinghr', 'resting HR', 'var(--z6)', (w) => w.restingHr, 'bpm', { format: (v) => `${Math.round(v)}` });
    if (has('weight')) wellnessPair('weight', 'weight', 'var(--z7)', (w) => (w.weightKg ? (data.imperial ? w.weightKg * 2.20462 : w.weightKg) : undefined), data.imperial ? 'lb' : 'kg', { format: (v) => v.toFixed(1), ownMinSpan: data.imperial ? 6 : 3 });
    // Efficiency and drift: steady rides only, as dots, with the 5-ride average as a line once there are three.
    if (has('efficiency') || has('drift')) {
      const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
      const pts = aerobicPoints(data.rides.filter((r) => r.date >= first && r.date <= dates[n - 1]), isEndurance, data.lthr, data.hr?.zones);
      const place = (vals: Array<number | null | undefined>) => { const out: Array<number | null> = Array(all.length).fill(null); pts.forEach((p, k) => { const i = dates.indexOf(p.date); const v = vals[k]; if (i >= 0 && i < n && v != null) out[i] = Math.round(v * 100) / 100; }); return out; };
      const aero = (key: OverlayKey, label: string, color: string, get: (p: typeof pts[number]) => number | undefined, unit: string, format: (v: number) => string) => {
        const raw = pts.map(get);
        lines.push({ name: label, group: label, color, values: place(raw), dots: true, opacity: 0.6, scale: 'own', scaleKey: key, unit, format });
        if (raw.filter((v) => v != null).length >= 3) lines.push({ name: `${label}, 5-ride average`, group: `${label} average`, color, values: place(rollingMean(raw, 5)), width: 2, scale: 'own', scaleKey: key, unit, format, connectGaps: true });
      };
      if (has('efficiency')) aero('efficiency', 'efficiency', 'var(--z3)', (p) => p.ef, 'W/beat', (v) => v.toFixed(2));
      if (has('drift')) aero('drift', 'drift', 'var(--z4)', (p) => p.drift, '%', (v) => v.toFixed(1));
    }
  }

  // The day's sessions and what kind of morning it was, after the numbers; "planned" beyond today.
  const ridesOn = new Map<string, Ride[]>();
  for (const r of data?.rides ?? []) { const l = ridesOn.get(r.date) ?? []; l.push(r); ridesOn.set(r.date, l); }
  const suffix = (i: number) => {
    if (i >= n) return ' · planned';
    if (!data) return '';
    const d = dates[i];
    const today = (ridesOn.get(d) ?? []).map((r) => `${r.name}, ${dur(r.seconds)}`).join('; ');
    return `${today ? ` · ${today}` : ''} · ${DAY_KIND_PHRASE[dayKind(ridesOn.get(addDays(d, -1)) ?? [], data.lthr, data.hr)]}`;
  };

  return (
    <LineChart
      series={lines}
      xLabels={dates}
      xTick={(d, i) => (i === 0 || i === all.length - 1 || (i % step === 0 && i < all.length - step / 2)) ? fmt(d) : null}
      yTitle="training load points"
      bands={has('form') ? FORM_BANDS : []}
      markers={markers}
      height={height}
      fmtX={fmtDay}
      suffix={suffix}
      key={`${first}-${last}-${on.join(',')}`}
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
