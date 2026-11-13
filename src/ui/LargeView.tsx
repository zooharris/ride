import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addDays, today } from '../engine/load';
import { fmtValue, inRange, MEASURE_GROUPS, type MeasureDef, type Measures, type Values } from '../engine/measures';
import { correlation, ends, linkWords, meanOver, MIN_PAIRED, pairUp, slid, slideWords, summary, trendLine, weekly, type Pair } from '../engine/compare';
import { fmtDate, weekStart } from './derived';
import { go, readQuery, replaceQuery } from './router';
import { getSetting, setSetting } from '../data/db';
import { deliver } from '../export/deliver';
import { safeName } from '../export/names';
import type { ProgressCoachState } from './ProgressCoach';
import { useWidth } from './useWidth';

/**
 * A Progress chart opened large (12 Nov 2026, large charts, Part A). One measure, with up to three others laid
 * over it, together on two scales or stacked in lanes; days marked; 
 * and panels that say in numbers what the rider is looking at. Everything here works with no AI connected; the
 * coach's panel is added only with one. The view's state lives in the address, so a day opened from it and Back
 * return to it exactly as it was left.
 */

export type LargeRange = '6w' | '3m' | '6m' | '1y' | 'all' | 'custom';
const RANGE_LABEL: Record<LargeRange, string> = { '6w': '6 wk', '3m': '3 mo', '6m': '6 mo', '1y': '1 yr', all: 'All', custom: 'Custom' };
const RANGE_N: Record<Exclude<LargeRange, 'all' | 'custom'>, number> = { '6w': 42, '3m': 91, '6m': 182, '1y': 365 };
export const URL_KEYS = ['big', 'lo', 'ls', 'lw', 'lm', 'lf', 'lt', 'lr', 'lc'];

/** The measures suggested first for the one being viewed (A3). */
const SUGGEST: Record<string, string[]> = {
  hrv: ['sleep', 'load', 'restingHr'],
  restingHr: ['load', 'sleep', 'hrv'],
  sleep: ['load', 'hrv', 'restingHr'],
  fitness: ['sleep', 'restingHr', 'hrv'], fatigue: ['sleep', 'restingHr', 'hrv'], form: ['sleep', 'restingHr', 'hrv'],
  weekLoad: ['hrv', 'restingHr', 'sleep'],
  weight: ['weekLoad', 'ftp'], wkg: ['weekLoad', 'ftp'],
  ef: ['fitness', 'weekLoad'], drift: ['fitness', 'weekLoad'],
  breath: ['fitness', 'weekLoad'],
};

/** Whether two measures may be laid over each other: never one with itself, nor two that are one thing summed differently. */
export function canPair(a: MeasureDef, b: MeasureDef): boolean {
  return a.id !== b.id && !(a.family && a.family === b.family);
}

/** Up to three suggestions for the measure viewed, with data in the range; else the three with the most days of data in it. */
export function suggestionsFor(m: Measures, id: string, from: string, to: string): string[] {
  const view = m.def(id);
  if (!view) return [];
  const has = (x: string) => { const d = m.def(x); return !!d && canPair(view, d) && m.count(x, from, to) >= 3; };
  const listed = SUGGEST[id];
  if (listed) return listed.filter(has).slice(0, 3);
  return m.defs.filter((d) => has(d.id)).map((d) => ({ id: d.id, n: m.count(d.id, from, to) })).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.id);
}

/** Colour and line style together (A3): each measure reads without relying on colour. */
/** The height of one chart: about a quarter of its width, within sensible limits; and of each lane when stacked. */
export const chartHeight = (width: number): number => Math.max(170, Math.min(250, Math.round(width / 4.5)));
export const LANE_H = 90;

export const COLORS = ['var(--info)', 'var(--aqua)', 'var(--z2)', 'var(--z3)'];
export const DASH = ['', '7 4', '2 3', '9 3 2 3'];

export interface LargeTarget {
  /** The measure opened. */
  id: string;
  /** The card it was opened from, for the coach's line. */
  card: string;
}

interface Props {
  measures: Measures;
  target: LargeTarget;
  /** The Progress page's range, which the view opens on. */
  pageFrom: string;
  pageTo: string;
  pageRange: LargeRange;
  rides: Array<{ id: string; date: string; name: string; sport: string }>;
  hardDays: Set<string>;
  testDays: string[];
  asideDays: string[];
  coach: ProgressCoachState;
  onClose: () => void;
}

interface View { over: string[]; slides: number[]; stacked: boolean; marks: string[]; from: string; to: string; rk: LargeRange; cmp: string[] }

const parseList = (s: string | null) => (s ? s.split(',').filter(Boolean) : []);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const short = (d: string) => fmtDate(d, { month: 'short', day: 'numeric' });
const longDay = (d: string) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function LargeView({ measures: M, target, pageFrom, pageTo, pageRange, rides, hardDays, testDays, asideDays, coach, onClose }: Props) {
  const view = M.def(target.id)!;
  const t = today();
  const q0 = useMemo(() => readQuery(), []);
  const fromUrl = q0.get('big') === target.id && q0.has('lr');
  const [v, setV] = useState<View>(() => {
    if (fromUrl) {
      const over = parseList(q0.get('lo')).filter((x) => M.def(x) && canPair(view, M.def(x)!)).slice(0, 3);
      return {
        over, slides: over.map(() => 0), stacked: q0.get('lw') === 's', marks: parseList(q0.get('lm')),
        from: q0.get('lf') ?? pageFrom, to: q0.get('lt') ?? pageTo, rk: (q0.get('lr') as LargeRange) ?? pageRange, cmp: parseList(q0.get('lc')),
      };
    }
    return { over: [], slides: [], stacked: false, marks: [], from: pageFrom, to: pageTo, rk: pageRange, cmp: [] };
  });
  // Remembered between visits: what was laid over this measure, and Together or Stacked.
  useEffect(() => {
    if (fromUrl) return;
    Promise.all([getSetting<Record<string, string[]>>('largeOver', {}), getSetting<string>('largeShow', 'together')]).then(([over, show]) => {
      const o = (over[target.id] ?? []).filter((x) => M.def(x) && canPair(view, M.def(x)!) && M.count(x) >= 3).slice(0, 3);
      setV((s) => ({ ...s, over: o, slides: o.map(() => 0), stacked: show === 'stacked' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The view in the address, so Back from a day opened here finds it as it was left.
  useEffect(() => {
    replaceQuery({ big: target.id, lo: v.over.join(','), lw: v.stacked ? 's' : undefined, lm: v.marks.join(','), lf: v.from, lt: v.to, lr: v.rk, lc: v.cmp.join(',') });
  }, [v, target.id]);
  const set = (p: Partial<View>) => setV((s) => ({ ...s, ...p }));
  const setOver = (over: string[]) => {
    // Sliding one measure against another was removed on 13 Nov 2026 (Todd's decision): every measure is read on its own day.
    setV((s) => ({ ...s, over, slides: over.map(() => 0) }));
    getSetting<Record<string, string[]>>('largeOver', {}).then((all) => setSetting('largeOver', { ...all, [target.id]: over }));
  };
  const setStacked = (stacked: boolean) => { set({ stacked }); setSetting('largeShow', stacked ? 'stacked' : 'together'); };
  // Together or Stacked is the rider's choice, however many measures are laid over (13 Nov 2026).
  const stacked = v.stacked;

  // Escape closes; focus moves into the view and back to what opened it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('.lv-close')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.lv-more-list')) { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    document.body.classList.add('lv-open');
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('lv-open'); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickRange = (rk: LargeRange) => {
    if (rk === 'custom') { set({ rk }); return; }
    const from = rk === 'all' ? M.start : addDays(t, -(RANGE_N[rk] - 1));
    set({ rk, from, to: t });
  };

  const defs = [view, ...v.over.map((id) => M.def(id)!)];
  const vals: Values[] = defs.map((d, i) => (i === 0 ? M.values(d.id) : slid(M.values(d.id), v.slides[i - 1] ?? 0, d.cadence)));
  const [pointer, setPointer] = useState<string | null>(null);
  const lastWith = useMemo(() => { const pts = inRange(vals[0], view.cadence === 'week' ? weekStart(v.from) : v.from, v.to); return pts.length ? pts[pts.length - 1][0] : v.to; }, [vals[0], v.from, v.to]);
  const at = pointer && pointer >= v.from && pointer <= v.to ? pointer : lastWith < v.from ? v.from : lastWith;

  const marks = [
    { k: 'hard', label: 'Hard days', days: [...hardDays] },
    { k: 'tests', label: 'Tests', days: testDays },
    { k: 'aside', label: 'Days set aside', days: asideDays },
  ].filter((m) => m.days.length > 0);
  const shownMarks = marks.filter((m) => v.marks.includes(m.k));

  const openDay = (d: string) => {
    const onDay = rides.filter((r) => r.date === d);
    if (defs.every((x) => x.cadence === 'week')) { go(`calendar?v=list&w=${weekStart(d)}`); return; }
    if (onDay.length === 1) go(`rides/${onDay[0].id}`);
    else if (onDay.length > 1) go(`calendar?d=${d}`);
  };

  const [wrap, wrapW] = useWidth<HTMLDivElement>(900);
  const phone = typeof window !== 'undefined' && window.innerWidth < 760;
  const download = () => {
    const cadWeek = defs.some((d) => d.cadence === 'week');
    const heads = defs.map((d, i) => `${d.name}${d.unit ? ` (${d.unit})` : ''}${i > 0 && v.slides[i - 1] ? `, ${slideWords(v.slides[i - 1], d.cadence)}` : ''}${cadWeek && d.cadence === 'day' ? ', weekly average' : ''}`);
    const cols = defs.map((d, i) => (cadWeek && d.cadence === 'day' ? weekly(vals[i], (x) => weekStart(x)) : vals[i]));
    const rows: string[] = [`${cadWeek ? 'Week starting' : 'Date'},${heads.map(csvCell).join(',')}`];
    const step = cadWeek ? 7 : 1;
    for (let d = cadWeek ? weekStart(v.from) : v.from; d <= v.to; d = addDays(d, step)) {
      const cells = cols.map((c, i) => { const x = c.get(d); return x == null ? '' : x.toFixed(Math.max(defs[i].digits, defs[i].id === 'sleep' ? 2 : 0)); });
      if (cells.some((c) => c !== '')) rows.push(`${d},${cells.join(',')}`);
    }
    void deliver([{ name: safeName(`${view.name} ${v.from} to ${v.to}`, 'csv'), data: rows.join('\r\n') + '\r\n', mime: 'text/csv' }]);
  };

  return (
    <div class="lv-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="lv" role="dialog" aria-modal="true" aria-labelledby="lv-title" ref={box}>
        <div class="lv-head">
          <div class="lv-title">
            <h2 id="lv-title">{view.name}</h2>
            <p class="small muted">{view.desc}</p>
          </div>
          <button class="btn sm lv-close" onClick={onClose} aria-label={`Close ${view.name}`}>Close</button>
        </div>
        <div class="lv-tools">
          <div class="seg range sm" role="group" aria-label="Range">
            {(['6w', '3m', '6m', '1y', 'all', 'custom'] as LargeRange[]).map((k) => <button key={k} class={v.rk === k ? 'on' : ''} aria-pressed={v.rk === k} onClick={() => pickRange(k)}>{RANGE_LABEL[k]}</button>)}
          </div>
          <button class="btn sm" onClick={download}>Download these numbers</button>
        </div>
        {v.rk === 'custom' && (
          <div class="lv-custom small">
            <label>From <input type="date" value={v.from} min={M.start} max={v.to} onChange={(e) => { const x = (e.target as HTMLInputElement).value; if (x && x <= v.to) set({ from: x }); }} /></label>
            <label>to <input type="date" value={v.to} min={v.from} max={t} onChange={(e) => { const x = (e.target as HTMLInputElement).value; if (x && x >= v.from) set({ to: x }); }} /></label>
          </div>
        )}
        <div class="lv-ctl">
          <LayOver M={M} view={view} over={v.over} from={v.from} to={v.to} onChange={setOver} />
          {marks.length > 0 && (
            <div class="lv-row" role="group" aria-label="Mark">
              <span class="lv-lab">Mark</span>
              {marks.map((m) => { const on = v.marks.includes(m.k); return <button key={m.k} class={`chip sm mk-${m.k}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ marks: on ? v.marks.filter((x) => x !== m.k) : [...v.marks, m.k] })}><i class={`mk-sw mk-${m.k}`} aria-hidden="true" />{m.label}</button>; })}
            </div>
          )}
          {v.over.length > 0 && (
            <div class="lv-row" role="group" aria-label="Show">
              <span class="lv-lab">Show</span>
              <div class="seg range sm">
                <button class={!stacked ? 'on' : ''} aria-pressed={!stacked} onClick={() => setStacked(false)}>Together</button>
                <button class={stacked ? 'on' : ''} aria-pressed={stacked} onClick={() => setStacked(true)}>Stacked</button>
              </div>
              {!stacked && v.over.length >= 2 && <span class="faint small">Each measure has its own scale, in its own colour.</span>}
            </div>
          )}
        </div>

        <div class="lv-main">
          <div class="lv-chartcol" ref={wrap}>
            <Reading defs={defs} vals={vals} at={at} rides={rides} normal={M.normal(view.id)?.get(at)} />
            <Chart defs={defs} vals={vals} M={M} from={v.from} to={v.to} stacked={stacked} width={Math.max(260, wrapW)} phone={phone}
              marks={shownMarks} at={at} setPointer={setPointer} openDay={openDay}
              cmp={v.cmp} onPan={(from, to) => set({ from, to, rk: 'custom' })} />
            {!phone && <Strip M={M} view={view} from={v.from} to={v.to} width={Math.max(260, wrapW)} onChange={(from, to) => set({ from, to, rk: 'custom' })} />}
            {phone && <p class="faint small" style="margin:4px 0 0">Drag the chart to move through time; pinch to zoom.</p>}
          </div>
          <Panels defs={defs} vals={vals} M={M} from={v.from} to={v.to} at={at} slides={v.slides} cmp={v.cmp} setCmp={(cmp) => set({ cmp })}
            coach={coach} card={target.card} />
        </div>
      </div>
    </div>
  );
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A measure's value on a chart day: its own day, or for a weekly measure the week the day falls in. */
function valueAt(def: MeasureDef, values: Values, d: string): number | undefined {
  return def.cadence === 'week' ? values.get(weekStart(d)) : values.get(d);
}

// ---------- laying over ----------

function LayOver({ M, view, over, from, to, onChange }: { M: Measures; view: MeasureDef; over: string[]; from: string; to: string; onChange: (o: string[]) => void }) {
  const [more, setMore] = useState(false);
  const sugg = suggestionsFor(M, view.id, from, to);
  const full = over.length >= 3;
  const toggle = (id: string) => onChange(over.includes(id) ? over.filter((x) => x !== id) : full ? over : [...over, id]);
  const list = M.available().filter((d) => canPair(view, d) && !sugg.includes(d.id));
  const hasBreath = M.count('breath') >= 3;
  const extra = over.filter((x) => !sugg.includes(x));
  const chip = (id: string) => {
    const d = M.def(id)!; const i = over.indexOf(id); const on = i >= 0;
    return <button key={id} class={`chip sm${on ? ' on' : ''}`} aria-pressed={on} disabled={!on && full} onClick={() => toggle(id)}>
      {on && <LineKey i={i + 1} />}{d.name}
    </button>;
  };
  return (
    <div class="lv-row" role="group" aria-label="Lay over it">
      <span class="lv-lab">Lay over it</span>
      {sugg.map(chip)}
      {extra.map(chip)}
      <div class="lv-more">
        <button class={`chip sm${more ? ' on' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>More…</button>
        {more && (
          <div class="lv-more-list panel" role="dialog" aria-label="More measures to lay over" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMore(false); } }}>
            {MEASURE_GROUPS.map((g) => {
              const items = list.filter((d) => d.group === g);
              if (!items.length) return null;
              return <div key={g} class="lv-grp"><div class="lv-grp-h">{g}</div>{items.map((d) => {
                const on = over.includes(d.id);
                return <label key={d.id} class={`lv-opt${!on && full ? ' off' : ''}`}><input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(d.id)} /> {d.name}</label>;
              })}</div>;
            })}
            <p class="faint small" style="margin:8px 0 0">
              Up to three at once. Not offered: {view.name.toLowerCase()} itself{view.family ? ', the same load summed another way' : ''}, measures you have no data for{hasBreath ? '' : ', and breathing, which needs rides with a breathing strap'}. Power curve, records and durability are not a value per day, so they cannot be laid over.
            </p>
            <button class="btn sm" style="margin-top:6px" onClick={() => setMore(false)}>Done</button>
          </div>
        )}
      </div>
      {full && <span class="faint small">Three at once is the most.</span>}
    </div>
  );
}

/** A small sample of a measure's colour and line style, for the chips, the reading line and the panels. */
export function LineKey({ i, bars }: { i: number; bars?: boolean }) {
  return (
    <svg class="lk" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
      {bars ? <rect x="5" y="1" width="12" height="8" fill={COLORS[i]} fill-opacity={i ? 0.35 : 0.8} stroke={COLORS[i]} stroke-dasharray={DASH[i]} />
        : <line x1="1" y1="5" x2="21" y2="5" stroke={COLORS[i]} stroke-width="2.4" stroke-dasharray={DASH[i]} />}
    </svg>
  );
}

// ---------- the reading line ----------

function Reading({ defs, vals, at, rides, normal }: { defs: MeasureDef[]; vals: Values[]; at: string; rides: Array<{ date: string; name: string }>; normal?: [number, number] }) {
  const onDay = rides.filter((r) => r.date === at);
  const weekOnly = defs.every((d) => d.cadence === 'week');
  return (
    <div class="lv-read small" aria-live="polite">
      <b>{weekOnly ? `Week of ${short(weekStart(at))}` : longDay(at)}</b>
      {defs.map((d, i) => <span key={d.id} class="pr-item"><LineKey i={i} bars={d.style === 'bars'} />{d.name} <b>{fmtValue(d, valueAt(d, vals[i], at))}</b></span>)}
      {normal && <span class="pr-item faint">your normal {fmtValue(defs[0], normal[0], false)}–{fmtValue(defs[0], normal[1])}</span>}
      {!weekOnly && onDay.length > 0 && <span class="pr-item faint">· {onDay.length === 1 ? onDay[0].name : `${onDay.length} activities`}</span>}
    </div>
  );
}

// ---------- the chart ----------

interface Mark { k: string; label: string; days: string[] }

function Chart({ defs, vals, M, from, to, stacked, width, phone, marks, at, setPointer, openDay, cmp, onPan }: {
  defs: MeasureDef[]; vals: Values[]; M: Measures; from: string; to: string; stacked: boolean; width: number; phone: boolean;
  marks: Mark[]; at: string; setPointer: (d: string | null) => void; openDay: (d: string) => void; cmp: string[]; onPan: (from: string, to: string) => void;
}) {
  const N = Math.max(1, daysBetween(from, to) + 1);
  const lanes = stacked ? defs.map((_, i) => [i]) : [defs.map((_, i) => i)];
  const together = !stacked && defs.length >= 2;
  // Together: the measure viewed has its scale on the left; each one laid over has its own column of numbers on the right.
  const col = phone ? 38 : 46;
  const padL = 46, padR = together ? col * (defs.length - 1) : 12, padT = 8, padB = 22, gap = 18;
  // A wide, low chart at a fixed height (13 Nov 2026): about a quarter as tall as it is wide; stacked lanes are short.
  const laneH = lanes.length > 1 ? LANE_H : chartHeight(width);
  const H = padT + padB + lanes.length * laneH + (lanes.length - 1) * gap;
  const W = width;
  const plotW = W - padL - padR;
  const dayW = plotW / N;
  const xOf = (d: string) => padL + (daysBetween(from, d) + 0.5) * dayW;
  const dayAt = (x: number) => { const k = Math.max(0, Math.min(N - 1, Math.floor((x - padL) / dayW))); return addDays(from, k); };
  const laneTop = (l: number) => padT + l * (laneH + gap);

  // Each measure's scale over what is drawn: its values in the range, its normal band, and the earlier periods asked for.
  const viewPts = inRange(vals[0], defs[0].cadence === 'week' ? weekStart(from) : from, to);
  const prevOff = N, yearOff = daysBetween(addDays(from, -365), from);
  const cmpPts = cmp.map((c) => {
    const off = c === 'prev' ? prevOff : yearOff;
    return { c, pts: inRange(vals[0], addDays(from, -off), addDays(to, -off)).map(([k, x]) => [addDays(k, off), x] as [string, number]) };
  }).filter((x) => x.pts.length > 1);
  const normal = M.normal(defs[0].id);
  const scales = defs.map((d, i) => {
    const pts = i === 0 ? viewPts : inRange(vals[i], d.cadence === 'week' ? weekStart(from) : from, to);
    let lo = Infinity, hi = -Infinity;
    for (const [, x] of pts) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (i === 0) {
      if (normal) for (const [k, b] of normal) if (k >= from && k <= to) { lo = Math.min(lo, b[0]); hi = Math.max(hi, b[1]); }
      for (const c of cmpPts) for (const [, x] of c.pts) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (d.style === 'bars') lo = Math.min(0, lo);
    if (hi === lo) { hi += 1; lo -= d.style === 'bars' ? 0 : 1; }
    const pad = (hi - lo) * 0.08;
    return { lo: d.style === 'bars' && lo >= 0 ? 0 : lo - pad, hi: hi + pad, pts };
  });
  const laneOf = (i: number) => (stacked ? i : 0);
  const yOf = (i: number, x: number) => { const s = scales[i]; const top = laneTop(laneOf(i)); return top + laneH - ((x - s.lo) / (s.hi - s.lo)) * laneH; };

  const path = (i: number, pts: Array<[string, number]>, maxGap: number) => {
    let s = '', prev: string | null = null;
    for (const [k, x] of pts) {
      const jump = prev == null || daysBetween(prev, k) > maxGap;
      s += `${jump ? 'M' : 'L'}${xOf(k).toFixed(1)},${yOf(i, x).toFixed(1)}`;
      prev = k;
    }
    return s;
  };
  const draw = (d: MeasureDef, i: number) => {
    const pts = scales[i].pts;
    const c = COLORS[i], dash = DASH[i];
    if (d.style === 'bars') {
      const span = d.cadence === 'week' ? 7 : 1;
      const bw = Math.max(1, span * dayW * (d.cadence === 'week' ? 0.78 : 0.7));
      const base = yOf(i, Math.max(scales[i].lo, 0));
      // A measure laid over is drawn as an outline over a light fill, so it reads apart from the measure viewed.
      return <g key={d.id}>{pts.map(([k, x]) => {
        const x0 = xOf(k) - dayW / 2 + (span * dayW - bw) / 2, y = yOf(i, x);
        return <rect key={k} x={x0} y={Math.min(y, base)} width={bw} height={Math.max(0.5, Math.abs(base - y))} fill={c} fill-opacity={i === 0 ? 0.75 : 0.22} stroke={i === 0 ? 'none' : c} stroke-width="1.2" stroke-dasharray={dash} />;
      })}</g>;
    }
    const gapDays = d.style === 'dots' ? 10 : 3;
    return <g key={d.id}>
      <path d={path(i, pts, gapDays)} fill="none" stroke={c} stroke-width={i === 0 ? 2.2 : 1.8} stroke-dasharray={dash} stroke-linejoin="round" opacity={d.style === 'dots' ? 0.8 : 1} />
      {d.style === 'dots' && N <= 400 && pts.map(([k, x]) => <circle key={k} cx={xOf(k)} cy={yOf(i, x)} r={N > 200 ? 1.6 : 2.4} fill={i === 0 ? c : 'var(--bg-2)'} stroke={c} stroke-width="1.2" />)}
    </g>;
  };

  const ticks = (i: number) => { const s = scales[i]; return [s.lo + (s.hi - s.lo) * 0.1, (s.lo + s.hi) / 2, s.hi - (s.hi - s.lo) * 0.1]; };
  const xTicks: string[] = [];
  const every = Math.max(1, Math.ceil(N / Math.max(2, Math.floor(plotW / 90))));
  for (let k = 0; k < N; k += every) xTicks.push(addDays(from, k));

  // Pointer, keyboard, a click to open, and (on a touch screen) drag to move through time and pinch to zoom.
  const svg = useRef<SVGSVGElement>(null);
  const touches = useRef(new Map<number, number>());
  const gesture = useRef<{ x0: number; from0: string; to0: string; dist0?: number; mid0?: number; moved: boolean } | null>(null);
  const lastTap = useRef<string | null>(null);
  const xIn = (e: PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, xIn(e));
    const xs = [...touches.current.values()];
    gesture.current = { x0: xs[0], from0: from, to0: to, dist0: xs.length === 2 ? Math.abs(xs[0] - xs[1]) : undefined, mid0: xs.length === 2 ? (xs[0] + xs[1]) / 2 : undefined, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const x = xIn(e);
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId) && gesture.current) {
      touches.current.set(e.pointerId, x);
      const g = gesture.current; const xs = [...touches.current.values()];
      const span0 = daysBetween(g.from0, g.to0) + 1;
      if (xs.length === 2 && g.dist0) {
        const scale = g.dist0 / Math.max(10, Math.abs(xs[0] - xs[1]));
        const span = Math.max(14, Math.min(daysBetween(M.start, today()) + 1, Math.round(span0 * scale)));
        const midDay = addDays(g.from0, Math.round(((g.mid0! - padL) / plotW) * span0));
        let f = addDays(midDay, -Math.round(span / 2));
        if (f < M.start) f = M.start;
        let tt = addDays(f, span - 1); if (tt > today()) { tt = today(); f = addDays(tt, -(span - 1)); }
        g.moved = true; onPan(f < M.start ? M.start : f, tt); return;
      }
      const dx = x - g.x0;
      if (Math.abs(dx) > 8 || g.moved) {
        g.moved = true;
        const shift = -Math.round(dx / (plotW / span0));
        let f = addDays(g.from0, shift), tt = addDays(g.to0, shift);
        if (f < M.start) { f = M.start; tt = addDays(f, span0 - 1); }
        if (tt > today()) { tt = today(); f = addDays(tt, -(span0 - 1)); }
        onPan(f, tt); return;
      }
    }
    if (e.pointerType !== 'touch') setPointer(dayAt(x));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    const g = gesture.current;
    touches.current.delete(e.pointerId);
    if (touches.current.size === 0) {
      if (g && !g.moved) {
        // A tap reads the day; a second tap on the same day opens it.
        const d = dayAt(xIn(e));
        if (lastTap.current === d) openDay(d); else { setPointer(d); lastTap.current = d; }
      }
      gesture.current = null;
    }
  };
  const onKey = (e: KeyboardEvent) => {
    const step = defs.every((d) => d.cadence === 'week') ? 7 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const n = addDays(at, e.key === 'ArrowLeft' ? -step : step); if (n >= from && n <= to) setPointer(n); }
    else if (e.key === 'Home') { e.preventDefault(); setPointer(from); }
    else if (e.key === 'End') { e.preventDefault(); setPointer(to); }
    else if (e.key === 'Enter') { e.preventDefault(); openDay(at); }
  };
  const label = `${defs[0].name}${defs.length > 1 ? ` with ${defs.slice(1).map((d) => d.name.toLowerCase()).join(', ')}` : ''}, ${short(from)} to ${short(to)}. Arrow keys move a day, Enter opens it.`;

  return (
    <svg ref={svg} class="lv-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} tabIndex={0} role="img" aria-label={label}
      onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={(e) => { if (e.pointerType !== 'touch') setPointer(null); }}
      onClick={(e) => { if ((e as unknown as PointerEvent).pointerType === 'touch') return; const r = svg.current!.getBoundingClientRect(); openDay(dayAt(((e.clientX - r.left) / r.width) * W)); }}
      onKeyDown={onKey} style="touch-action:pan-y;cursor:pointer">
      {lanes.map((ids, l) => {
        const top = laneTop(l);
        return <g key={l}>
          <rect x={padL} y={top} width={plotW} height={laneH} fill="none" stroke="var(--line)" />
          {/* marks run through every lane */}
          {marks.map((m) => m.days.filter((d) => d >= from && d <= to).map((d) => m.k === 'tests'
            ? <line key={m.k + d} x1={xOf(d)} x2={xOf(d)} y1={top} y2={top + laneH} stroke="var(--today)" stroke-width="1.6" stroke-dasharray="3 2" />
            : <rect key={m.k + d} class={`mk-band mk-${m.k}`} x={xOf(d) - dayW / 2} y={top} width={Math.max(1.5, dayW)} height={laneH} />))}
          {ids.map((i) => (stacked || i === 0) && ticks(i).map((tv, k) => <g key={`${i}-${k}`}>
            <line x1={padL} x2={padL + plotW} y1={yOf(i, tv)} y2={yOf(i, tv)} stroke="var(--line)" stroke-dasharray="2 4" />
            <text x={padL - 5} y={yOf(i, tv) + 3} text-anchor="end" font-size="10" fill={COLORS[i]}>{fmtValue(defs[i], tv, false)}</text>
          </g>))}
          {together && ids.filter((i) => i > 0).map((i) => ticks(i).map((tv, k) => <text key={`r${i}-${k}`} x={padL + plotW + 5 + (i - 1) * col} y={yOf(i, tv) + 3} font-size="10" fill={COLORS[i]}>{fmtValue(defs[i], tv, false)}</text>))}
          {stacked && <text x={padL + 6} y={top + 13} font-size="11" font-weight="600" fill={COLORS[ids[0]]}>{defs[ids[0]].name}{defs[ids[0]].unit ? ` (${defs[ids[0]].unit})` : ''}</text>}
          {/* the normal band, under the measure viewed */}
          {ids.includes(0) && normal && (() => {
            const ks = [...normal.keys()].filter((k) => k >= from && k <= to).sort();
            if (ks.length < 2) return null;
            const upper = ks.map((k, j) => `${j ? 'L' : 'M'}${xOf(k).toFixed(1)},${yOf(0, normal.get(k)![1]).toFixed(1)}`).join('');
            const lower = ks.slice().reverse().map((k) => `L${xOf(k).toFixed(1)},${yOf(0, normal.get(k)![0]).toFixed(1)}`).join('');
            return <g><path d={`${upper}${lower}Z`} fill={COLORS[0]} fill-opacity="0.1" /><text x={padL + 4} y={yOf(0, normal.get(ks[0])![0]) + 11} font-size="10" fill="var(--ink-3)">your normal</text></g>;
          })()}
          {ids.includes(0) && cmpPts.map((c) => <path key={c.c} d={path(0, c.pts, defs[0].style === 'dots' ? 10 : 8)} fill="none" stroke="var(--ink-3)" stroke-width="1.4" stroke-dasharray={c.c === 'prev' ? '5 3' : '1 3'} opacity="0.75" />)}
          {ids.map((i) => draw(defs[i], i))}
          {/* the pointer */}
          {at >= from && at <= to && <line x1={xOf(at)} x2={xOf(at)} y1={top} y2={top + laneH} stroke="var(--ink-2)" stroke-width="1" />}
          {ids.map((i) => { const x = valueAt(defs[i], vals[i], at); return x == null ? null : <circle key={`p${i}`} cx={defs[i].cadence === 'week' ? xOf(weekStart(at)) + 3 * dayW : xOf(at)} cy={yOf(i, x)} r="3.6" fill={COLORS[i]} stroke="var(--bg-2)" stroke-width="1.5" />; })}
        </g>;
      })}
      {xTicks.map((d) => <text key={d} x={xOf(d)} y={H - 6} text-anchor="middle" font-size="10" fill="var(--ink-3)">{N > 500 ? fmtDate(d, { month: 'short', year: '2-digit' }) : short(d)}</text>)}
    </svg>
  );
}

// ---------- the history strip ----------

function Strip({ M, view, from, to, width, onChange }: { M: Measures; view: MeasureDef; from: string; to: string; width: number; onChange: (from: string, to: string) => void }) {
  const t = today();
  const start = M.start;
  const N = Math.max(1, daysBetween(start, t) + 1);
  const H = 36, padL = 46, padR = 12, plotW = width - padL - padR;
  const xOf = (d: string) => padL + (daysBetween(start, d) / N) * plotW;
  // A week at a time is plenty at this size, and quick with years of history.
  const wk = view.cadence === 'week' ? M.values(view.id) : weekly(M.values(view.id), (d) => weekStart(d));
  const pts = [...wk].sort((a, b) => a[0].localeCompare(b[0]));
  let lo = Infinity, hi = -Infinity; for (const [, x] of pts) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (!isFinite(lo)) { lo = 0; hi = 1; } if (hi === lo) hi = lo + 1;
  const y = (x: number) => 4 + (H - 8) * (1 - (x - lo) / (hi - lo));
  const d = pts.map(([k, x], j) => `${j ? 'L' : 'M'}${xOf(k).toFixed(1)},${y(x).toFixed(1)}`).join('');
  const drag = useRef<{ mode: 'move' | 'lo' | 'hi'; x0: number; from0: string; to0: string } | null>(null);
  const dayOfDx = (dx: number) => Math.round((dx / plotW) * N);
  const svg = useRef<SVGSVGElement>(null);
  const xIn = (e: PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * width; };
  const down = (e: PointerEvent) => {
    const x = xIn(e), a = xOf(from), b = xOf(to);
    const mode = Math.abs(x - a) < 8 ? 'lo' : Math.abs(x - b) < 8 ? 'hi' : x > a && x < b ? 'move' : null;
    if (!mode) {
      // A press outside the window moves it there, keeping its length.
      const span = daysBetween(from, to);
      let f = addDays(start, Math.round(((x - padL) / plotW) * N) - Math.round(span / 2));
      if (f < start) f = start; let tt = addDays(f, span); if (tt > t) { tt = t; f = addDays(t, -span); }
      onChange(f < start ? start : f, tt); return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, x0: x, from0: from, to0: to };
  };
  const move = (e: PointerEvent) => {
    const g = drag.current; if (!g) return;
    const k = dayOfDx(xIn(e) - g.x0);
    if (g.mode === 'move') {
      const span = daysBetween(g.from0, g.to0);
      let f = addDays(g.from0, k); if (f < start) f = start;
      let tt = addDays(f, span); if (tt > t) { tt = t; f = addDays(t, -span); }
      onChange(f < start ? start : f, tt);
    } else if (g.mode === 'lo') { let f = addDays(g.from0, k); if (f < start) f = start; if (daysBetween(f, g.to0) >= 13) onChange(f, g.to0); }
    else { let tt = addDays(g.to0, k); if (tt > t) tt = t; if (daysBetween(g.from0, tt) >= 13) onChange(g.from0, tt); }
  };
  const keys = (e: KeyboardEvent) => {
    const span = daysBetween(from, to);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const k = (e.key === 'ArrowLeft' ? -1 : 1) * Math.max(7, Math.round(span / 10));
      let f = addDays(from, k); if (f < start) f = start; let tt = addDays(f, span); if (tt > t) { tt = t; f = addDays(t, -span); }
      onChange(f < start ? start : f, tt);
    }
  };
  return (
    <svg ref={svg} class="lv-strip" width={width} height={H} viewBox={`0 0 ${width} ${H}`} tabIndex={0} role="slider" aria-label="All your history: drag the window to move the range, pull its ends to zoom, or use the arrow keys"
      aria-valuetext={`${short(from)} to ${short(to)}`} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onKeyDown={keys}>
      <rect x={padL} y={1} width={plotW} height={H - 2} fill="var(--soft)" rx="3" />
      <path d={d} fill="none" stroke={COLORS[0]} stroke-width="1.2" opacity="0.8" />
      <rect class="lv-win" x={xOf(from)} y={1} width={Math.max(4, xOf(to) - xOf(from))} height={H - 2} rx="3" />
      <rect x={xOf(from) - 3} y={8} width={6} height={H - 16} rx="2" fill="var(--ink-2)" style="cursor:ew-resize" />
      <rect x={xOf(to) - 3} y={8} width={6} height={H - 16} rx="2" fill="var(--ink-2)" style="cursor:ew-resize" />
      <text x={2} y={H / 2 + 3} font-size="9" fill="var(--ink-3)">{fmtDate(start, { month: 'short', year: 'numeric' })}</text>
    </svg>
  );
}

// ---------- the panels ----------

function Panels({ defs, vals, M, from, to, at, slides, cmp, setCmp, coach, card }: {
  defs: MeasureDef[]; vals: Values[]; M: Measures; from: string; to: string; at: string; slides: number[]; cmp: string[]; setCmp: (c: string[]) => void;
  coach: ProgressCoachState; card: string;
}) {
  const view = defs[0];
  const [pairWith, setPairWith] = useState(0);
  const j = Math.max(0, Math.min(pairWith, defs.length - 2));
  const other = defs.length > 1 ? defs[j + 1] : undefined;
  const pr = useMemo(() => other ? pairUp(M.values(view.id), view.cadence, M.values(other.id), other.cadence, slides[j] ?? 0, from, to, (d) => weekStart(d)) : null,
    [view.id, other?.id, slides[j], from, to]);
  const sums = defs.map((d, i) => summary(inRange(vals[i], d.cadence === 'week' ? weekStart(from) : from, to), d.cadence));
  const N = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -N), prevTo = addDays(from, -1);
  const yFrom = addDays(from, -365), yTo = addDays(to, -365);
  const periods = defs.map((d, i) => ({ now: meanOver(vals[i], from, to), prev: meanOver(vals[i], prevFrom, prevTo), year: meanOver(vals[i], yFrom, yTo) }));
  const hasPrev = periods.some((p) => p.prev != null), hasYear = periods.some((p) => p.year != null);
  return (
    <div class="lv-panels">
      <section class="lv-p">
        <h3>Over this range</h3>
        <table class="lv-t small">
          <thead><tr><th /><th class="r">Low</th><th class="r">High</th><th class="r">Average</th><th class="r">Change</th></tr></thead>
          <tbody>{defs.map((d, i) => { const s = sums[i]; return <tr key={d.id}><td><LineKey i={i} bars={d.style === 'bars'} /> {d.name}</td>
            {s ? <><td class="r">{fmtValue(d, s.low, false)}</td><td class="r">{fmtValue(d, s.high, false)}</td><td class="r">{fmtValue(d, s.avg, false)}</td><td class="r">{s.change != null ? signed(d, s.change) : '–'}</td></> : <td class="r faint" colSpan={4}>no values</td>}
          </tr>; })}</tbody>
        </table>
        <p class="faint small lv-foot">Change compares the first {view.cadence === 'week' ? 'week' : 'seven days with a value'} of the range with the last.</p>
      </section>

      {other && pr && (
        <section class="lv-p">
          <h3>Do they move together?</h3>
          {defs.length > 2 && <div class="lv-row" style="margin-bottom:6px">{defs.slice(1).map((d, k) => <button key={d.id} class={`chip sm${k === j ? ' on' : ''}`} aria-pressed={k === j} onClick={() => setPairWith(k)}><LineKey i={k + 1} bars={d.style === 'bars'} />{d.name}</button>)}</div>}
          <Together view={view} other={other} pairs={pr.pairs} cadence={pr.cadence} slide={slides[j] ?? 0} oi={j + 1} />
        </section>
      )}

      {other && pr && (
        <section class="lv-p">
          <h3>What this shows</h3>
          <Shows view={view} other={other} pairs={pr.pairs} cadence={pr.cadence} slide={slides[j] ?? 0} />
        </section>
      )}

      {(hasPrev || hasYear) && (
        <section class="lv-p">
          <h3>Against another time</h3>
          <table class="lv-t small">
            <thead><tr><th /><th class="r">This range</th>{hasPrev && <th class="r">The range before</th>}{hasYear && <th class="r">A year ago</th>}</tr></thead>
            <tbody>{defs.map((d, i) => <tr key={d.id}><td><LineKey i={i} bars={d.style === 'bars'} /> {d.name}</td><td class="r">{fmtValue(d, periods[i].now, false)}</td>{hasPrev && <td class="r">{fmtValue(d, periods[i].prev, false)}</td>}{hasYear && <td class="r">{fmtValue(d, periods[i].year, false)}</td>}</tr>)}</tbody>
          </table>
          <p class="faint small lv-foot">Averages. The range before is the {N} days before this range; a year ago is the same dates a year earlier.</p>
          <div class="lv-row" style="margin-top:6px">
            {periods[0].prev != null && <button class={`chip sm${cmp.includes('prev') ? ' on' : ''}`} aria-pressed={cmp.includes('prev')} onClick={() => setCmp(cmp.includes('prev') ? cmp.filter((c) => c !== 'prev') : [...cmp, 'prev'])}>Draw the range before</button>}
            {periods[0].year != null && <button class={`chip sm${cmp.includes('year') ? ' on' : ''}`} aria-pressed={cmp.includes('year')} onClick={() => setCmp(cmp.includes('year') ? cmp.filter((c) => c !== 'year') : [...cmp, 'year'])}>Draw a year ago</button>}
          </div>
        </section>
      )}

      <CoachPanel coach={coach} card={card} defs={defs} from={from} to={to} slides={slides} sums={sums} pairs={pr} />
    </div>
  );
}

function signed(d: MeasureDef, v: number): string {
  if (d.id === 'sleep' && Math.abs(v) < 1) { const m = Math.round(Math.abs(v) * 60); return m === 0 ? '±0' : `${v > 0 ? '+' : '−'}${m} min`; }
  const s = fmtValue(d, Math.abs(v), false);
  const zero = Math.abs(v) < 0.5 * 10 ** -d.digits;
  return zero ? '±0' : `${v > 0 ? '+' : '−'}${s}`;
}

function Together({ view, other, pairs, cadence, slide, oi }: { view: MeasureDef; other: MeasureDef; pairs: Pair[]; cadence: 'day' | 'week'; slide: number; oi: number }) {
  const need = MIN_PAIRED[cadence];
  const unit = cadence === 'week' ? 'weeks' : 'days';
  const otherWords = `${other.word}${slide ? ` ${slideWords(slide, other.cadence)}` : ''}`;
  if (pairs.length < need) return <p class="small" style="margin:0">{pairs.length === 0 ? `No ${unit} in this range have both ${view.word} and ${otherWords}.` : `${pairs.length} ${pairs.length === 1 ? unit.slice(0, -1) : unit} in this range ${pairs.length === 1 ? 'has' : 'have'} both ${view.word} and ${otherWords}.`} {need} are needed before anything can be said about them together. A longer range may have enough.</p>;
  const r = correlation(pairs);
  const tl = trendLine(pairs);
  const W = 260, H = 150, pl = 34, pb = 20, pt = 6, pr = 8;
  let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
  for (const p of pairs) { xl = Math.min(xl, p.x); xh = Math.max(xh, p.x); yl = Math.min(yl, p.y); yh = Math.max(yh, p.y); }
  if (xh === xl) xh = xl + 1; if (yh === yl) yh = yl + 1;
  const X = (x: number) => pl + ((x - xl) / (xh - xl)) * (W - pl - pr), Y = (y: number) => pt + (1 - (y - yl) / (yh - yl)) * (H - pt - pb);
  const words = linkWords(r);
  const dir = r == null || Math.abs(r) < 0.2 ? '' : r > 0 ? `: when ${otherWords} is higher, ${view.word} tends to be higher too` : `: when ${otherWords} is higher, ${view.word} tends to be lower`;
  return (
    <>
      <p class="small" style="margin:0 0 6px">Over these {pairs.length} {unit}, {words} between {view.word} and {otherWords}{dir}.</p>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} class="lv-scatter" role="img" aria-label={`${pairs.length} ${unit}: ${view.word} against ${otherWords}, ${words}`}>
        <rect x={pl} y={pt} width={W - pl - pr} height={H - pt - pb} fill="none" stroke="var(--line)" />
        {pairs.map((p) => <circle key={p.key} cx={X(p.x)} cy={Y(p.y)} r="2.4" fill={COLORS[0]} fill-opacity="0.55" />)}
        {tl && <line x1={X(xl)} y1={Y(tl.slope * xl + tl.intercept)} x2={X(xh)} y2={Y(tl.slope * xh + tl.intercept)} stroke={COLORS[oi]} stroke-width="1.8" stroke-dasharray={DASH[oi]} />}
        <text x={pl} y={H - 5} font-size="9" fill="var(--ink-3)">{fmtValue(other, xl)}</text>
        <text x={W - pr} y={H - 5} font-size="9" text-anchor="end" fill="var(--ink-3)">{other.name} {fmtValue(other, xh)}</text>
        <text x={pl - 3} y={pt + 8} font-size="9" text-anchor="end" fill="var(--ink-3)">{fmtValue(view, yh, false)}</text>
        <text x={pl - 3} y={H - pb} font-size="9" text-anchor="end" fill="var(--ink-3)">{fmtValue(view, yl, false)}</text>
      </svg>
      <p class="faint small lv-foot">One dot a {cadence === 'week' ? 'week' : 'day'}: {view.word} up the side, {otherWords} along the bottom; the line runs through the middle of them.</p>
    </>
  );
}

/** The sentence in numbers for "What this shows" (A6.4). */
export function showsSentence(view: MeasureDef, other: MeasureDef, pairs: Pair[], cadence: 'day' | 'week', slide: number): string | null {
  const e = ends(pairs);
  if (!e || pairs.length < MIN_PAIRED[cadence]) return null;
  const v = (x: number) => fmtValue(view, x);
  const unitN = (n: number) => (cadence === 'week' ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days'));
  const s = slide;
  // How the days are named: the other measure's own words for its ends when it has them.
  const lowEnd = other.ends?.[0] ?? `${unitN(e.n)} of lowest ${other.word}`;
  const highEnd = other.ends?.[1] ?? `${unitN(e.n)} of highest ${other.word}`;
  const lead = s === 0 ? (other.id === 'sleep' ? 'After' : cadence === 'week' ? 'In' : 'On') : s > 0 ? `${s === 1 ? `The ${cadence === 'week' ? 'week' : 'day'}` : `${s} ${unitN(s)}`} after` : `${-s === 1 ? `The ${cadence === 'week' ? 'week' : 'day'}` : `${-s} ${unitN(-s)}`} before`;
  const your = (end: string) => (other.ends ? `your ${e.n} ${end}` : `the ${e.n} ${end}`);
  if (other.isLoad) return `${lead} ${your(highEnd)}, ${view.word} averaged ${v(e.highY)}. Over the range it averaged ${v(e.avgY)}.`;
  return `${lead} ${your(lowEnd)}, ${view.word} averaged ${v(e.lowY)}. ${lead} ${your(highEnd)} it averaged ${v(e.highY)}.`;
}

export const HONEST = 'Two lines moving together does not show that one causes the other: something else, such as illness, travel or a change of routine, can move both.';

function Shows({ view, other, pairs, cadence, slide }: { view: MeasureDef; other: MeasureDef; pairs: Pair[]; cadence: 'day' | 'week'; slide: number }) {
  const s = showsSentence(view, other, pairs, cadence, slide);
  const need = MIN_PAIRED[cadence];
  return (
    <>
      <p class="small" style="margin:0 0 6px">{s ?? `Too few ${cadence === 'week' ? 'weeks' : 'days'} have both to compare: ${pairs.length} of the ${need} needed.`}</p>
      <p class="faint small lv-foot" style="margin:0">{HONEST}</p>
    </>
  );
}

// ---------- the coach ----------

function CoachPanel({ coach, card, defs, from, to, slides, sums, pairs }: {
  coach: ProgressCoachState; card: string; defs: MeasureDef[]; from: string; to: string; slides: number[];
  sums: Array<ReturnType<typeof summary>>; pairs: { pairs: Pair[]; cadence: 'day' | 'week' } | null;
}) {
  const [q, setQ] = useState('');
  if (!coach.on) return null;
  const id = `large:${defs[0].id}`;
  const view = defs[0];
  const line = coach.status === 'idle' ? coach.written?.lines[card] : undefined;
  const busy = coach.cardBusy === id;
  const err = coach.cardError?.id === id ? coach.cardError.text : null;
  const a = coach.cardAnswers[id];
  const readout = [
    `${view.name} from ${from} to ${to}`,
    ...defs.map((d, i) => { const s = sums[i]; return s ? `${d.name}${i && slides[i - 1] ? ` (${slideWords(slides[i - 1], d.cadence)})` : ''}: low ${fmtValue(d, s.low)}, high ${fmtValue(d, s.high)}, average ${fmtValue(d, s.avg)}${s.change != null ? `, change ${signed(d, s.change)}` : ''}` : `${d.name}: no values`; }),
    pairs && defs[1] && pairs.pairs.length >= MIN_PAIRED[pairs.cadence] ? `${linkWords(correlation(pairs.pairs))} between ${view.word} and ${defs[1].word} over ${pairs.pairs.length} ${pairs.cadence === 'week' ? 'weeks' : 'days'}; ${showsSentence(view, defs[1], pairs.pairs, pairs.cadence, slides[0] ?? 0) ?? ''}` : '',
  ].filter(Boolean).join('; ');
  const extra = defs.length > 1 ? `laid over: ${defs.slice(1).map((d, i) => `${d.name}${slides[i] ? ` slid to ${slideWords(slides[i], d.cadence)}` : ''}`).join(', ')}` : 'nothing laid over';
  const ask = (text: string) => { if (!text.trim()) return; coach.askCard(id, text, { title: `${view.name}, opened large`, readout, extra }); setQ(''); };
  const ready = defs.length > 1
    ? [`What do ${view.word} and ${defs[1].word} tell me together?`, 'Is anything here worth acting on?']
    : [`What stands out in my ${view.word} here?`, 'Is anything here worth acting on?'];
  return (
    <section class="lv-p lv-coach" aria-live="polite">
      <h3><b class="coach-mark">Coach</b></h3>
      {line && <p class="small" style="margin:0 0 6px">{line}</p>}
      <div class="lv-row" style="margin-bottom:6px">{ready.map((r) => <button key={r} class="chip sm" disabled={busy} onClick={() => ask(r)}>{r}</button>)}</div>
      <div class="row" style="gap:6px">
        <input value={q} aria-label={`Ask the coach about ${view.name.toLowerCase()}`} placeholder="Ask about what is showing" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(q); }} style="flex:1;min-width:0" disabled={busy} />
        <button class={`btn sm${q.trim() ? ' primary' : ''}`} onClick={() => ask(q)} disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
      </div>
      {busy && <p class="small muted" style="margin:6px 0 0">The coach is reading this chart…</p>}
      {err && <p class="small" style="margin:6px 0 0;color:var(--bad)">No answer came: {err}</p>}
      {a && !busy && !err && <div class="coach-line small" style="margin-top:6px"><div class="faint" style="margin-bottom:2px">You asked: {a.q}</div><div>{a.a}</div></div>}
    </section>
  );
}
