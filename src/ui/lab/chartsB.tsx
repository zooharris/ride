import { useMemo, useState } from 'preact/hooks';
import { addDays } from '../../engine/load';
import { dailyLoad, rollingDays, weekStreak, weeklyZones } from '../../engine/progress';
import { zoneMix } from '../../engine/progressMore';
import { morningsAfter } from '../../engine/mornings';
import { workoutStats } from '../../engine/workout';
import { rideHrZones, ridePowerZones } from '../../engine/zones';
import { hasPowerHistory } from '../../engine/hrRecords';
import { knownFtp } from '../../engine/known';
import { fmtValue, inRange } from '../../engine/measures';
import { PERIOD_LABEL, readings } from '../../engine/lab';
import { findWorkout } from '../store';
import { weekStart } from '../derived';
import { ZONE_VAR } from '../Profile';
import { go } from '../router';
import { useWidth } from '../useWidth';
import { hrNumbers } from '../screens/Progress';
import { ChartShell, Kv, Legend, Scope, type Series } from './Scope';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, dayN, dayTicks, hm, longDay, plural, sample, sg, short } from './util';

const INK = 'var(--ink)', ACC = 'var(--accent)', MID = 'var(--ink-2)', DIM = 'var(--ink-3)';
const periodWords = (L: LabData) => (L.period === 'custom' ? 'these dates' : L.period === 'plan' ? 'this plan' : L.period === 'all' ? 'all your history' : `these ${PERIOD_LABEL[L.period]}`);
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Sprint'];

// ---------- time in zones: every week above, the chosen weeks against the plan below ----------

function zoneWeeks(L: LabData) { return weeklyZones(L.rides, weekStart(L.from), L.to, (d) => weekStart(d)); }

function ZonesPage({ L }: { L: LabData }) {
  const weeks = useMemo(() => zoneWeeks(L), [L.rides, L.from, L.to]);
  const power = hasPowerHistory(L.rides);
  const ladder = power ? ridePowerZones(L.profile) : rideHrZones(L.profile);
  const nz = Math.min(7, ladder.length);
  const [at, setAt] = useState<number | null>(null);
  const [end, setEnd] = useState<number>(weeks.length - 1);
  const [span, setSpan] = useState<1 | 4 | 8>(4);
  const last = Math.min(end, weeks.length - 1), first = Math.max(0, last - span + 1);
  const chosen = weeks.slice(first, last + 1);
  const [ref, W] = useWidth<HTMLDivElement>(720);
  // The rows: one for each zone, as tall as the zone is wide (in share of threshold), so thresholds sit where they belong.
  const top = (z: number) => (isFinite(ladder[z].high) ? ladder[z].high : ladder[z].low + (power ? 0.3 : 0.08));
  const lo0 = power ? 0.3 : Math.max(0.5, ladder[0].high - 0.15), hiAll = top(nz - 1);
  const padL = 96, padR = 10, padT = 14, padB = 24, H = 300, pw = Math.max(10, W - padL - padR), ph = H - padT - padB;
  const Y = (f: number) => padT + ph - (Math.max(lo0, Math.min(hiAll, f)) - lo0) / (hiAll - lo0) * ph;
  const cw = pw / Math.max(1, weeks.length);
  const max = Math.max(1, ...weeks.flatMap((w) => w.seconds.slice(0, nz)));
  const w = at != null ? weeks[at] : undefined;
  const sum = (ws: typeof weeks) => { const t = [0, 0, 0, 0, 0, 0, 0]; for (const x of ws) x.seconds.forEach((s, z) => { t[z] += s; }); return t; };
  const done = sum(chosen), doneAll = done.reduce((a, b) => a + b, 0);
  // What the calendar asked for in the chosen weeks: each planned ride's steps, sorted into the same zones.
  const planned = useMemo(() => {
    const t = [0, 0, 0, 0, 0, 0, 0];
    if (!chosen.length) return t;
    const a = chosen[0].start, b = addDays(chosen[chosen.length - 1].start, 6);
    for (const p of L.data.planned) {
      const d = p.plannedFor ?? p.date;
      if (d < a || d > b) continue;
      const wk = findWorkout(L.data.mine, p.workoutId);
      if (!wk || wk.kind !== 'ride') continue;
      workoutStats(wk.blocks).zoneSeconds.forEach((s, z) => { t[Math.min(nz - 1, z)] += s; });
    }
    return t;
  }, [L.data.planned, L.data.mine, first, last, weeks.length]);
  const plannedAll = planned.reduce((a, b) => a + b, 0);
  const mix = zoneMix(weeks);
  const barMax = Math.max(1, ...done.slice(0, nz), ...planned.slice(0, nz));
  const h1 = (s: number) => (s / 3600).toFixed(1);
  const ftp = knownFtp(L.profile);
  const move = (e: PointerEvent) => { const box = (e.currentTarget as SVGElement).getBoundingClientRect(); const k = Math.floor(((e.clientX - box.left) / box.width * W - padL) / cw); setAt(k >= 0 && k < weeks.length ? k : null); };
  return (
    <ChartShell
      lead={mix ? <>Over {periodWords(L)}, <b>{mix.easy}%</b> of your riding was easy (zones 1 and 2), {mix.mid}% in zone 3 and <b>{mix.hard}%</b> at zone 4 and above, on {mix.hoursPerWeek} hours a week.{mix.polarised ? ' That is a polarised mix: mostly easy, some hard, little in between.' : ''}</> : <>No riding time in zones in {periodWords(L)}.</>}
      readout={w ? <>
        <div class="lc-when">Week of {short(w.start)}</div>
        <div class="lc-big">{hm(w.seconds.reduce((a, b) => a + b, 0) / 3600)} <small>in zones</small></div>
        <Kv rows={w.seconds.slice(0, nz).map((s, z) => ({ name: `Zone ${z + 1} · ${ZONE_NAMES[z]}`, value: s ? hm(s / 3600) : '–', color: ZONE_VAR[z], kind: 'block' as const })).reverse()} />
        <p>Press the week to measure it against the plan below.</p>
      </> : <>
        <div class="lc-when">{chosen.length ? `${plural(chosen.length, 'week')} chosen, to the week of ${short(chosen[chosen.length - 1].start)}` : 'No weeks'}</div>
        <div class="lc-big">{hm(doneAll / 3600)} <small>in zones</small></div>
        <Kv rows={done.slice(0, nz).map((s, z) => ({ name: `Zone ${z + 1} · ${ZONE_NAMES[z]}`, value: s ? `${hm(s / 3600)} · ${Math.round(s / Math.max(1, doneAll) * 100)}%` : '–', color: ZONE_VAR[z], kind: 'block' as const })).reverse()} />
        <p>Run a finger across the weeks to read any one.</p>
      </>}
      how={<>Above, each column is a week and each row a zone, drawn as tall as the zone is wide, with the hardest at the top. The stronger a cell, the more time that week in that zone; the line through the chart is your threshold{power && ftp ? ` (${ftp} W)` : ''}. Press a week to choose it. Below, the chosen weeks are measured zone by zone: the solid bar is what you rode, the outline what your calendar asked for.</>}
      plain={<>Fitness is built mostly in the lower rows, with a little time in the upper ones. Strong cells in the middle rows week after week mean a lot of riding that is neither easy nor hard. {power ? 'Rides with a power meter are sorted by power; a ride without one is sorted by heart rate.' : 'Your rides are sorted by heart rate, as none has power.'}</>}
      table={{ name: `Time in zones by week ${L.from} to ${L.to}`, head: ['Week starting', ...Array.from({ length: nz }, (_, z) => `Zone ${z + 1} (h)`), 'All (h)'], rows: weeks.map((x) => [x.start, ...x.seconds.slice(0, nz).map(h1), h1(x.seconds.reduce((a, b) => a + b, 0))]).reverse() }}
      question={{ id: L.plan ? 'plan' : 'mix', ask: L.plan ? 'Am I following my plan, and is it working?' : 'Am I doing the right mix of training?' }}
      extra={
        <div class="lc-body wide">
          <div class="lc-plot">
            <div class="lc-zhead">
              <h3 class="lc-sub">The chosen weeks <em>{chosen.length ? `${short(chosen[0].start)} to ${short(addDays(chosen[chosen.length - 1].start, 6))}` : ''}{plannedAll ? ', against what your calendar asked for' : ''}</em></h3>
              <div class="seg lc-seg" role="radiogroup" aria-label="How many weeks to measure">{([1, 4, 8] as const).map((n) => <button key={n} role="radio" aria-checked={span === n} class={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n === 1 ? 'That week' : `${n} weeks to it`}</button>)}</div>
            </div>
            <div class="lc-zrows">
              {Array.from({ length: nz }, (_, k) => nz - 1 - k).map((z) => (
                <div key={z} class="lc-zrow">
                  <span><i class="sc-key" style={`background:${ZONE_VAR[z]}`} />Zone {z + 1} <small>{ZONE_NAMES[z]}</small></span>
                  <span class="lc-zbar" aria-hidden="true">
                    <i style={`width:${done[z] / barMax * 100}%;background:${ZONE_VAR[z]}`} />
                    {plannedAll > 0 && <u style={`width:${planned[z] / barMax * 100}%`} />}
                  </span>
                  <b>{done[z] ? hm(done[z] / 3600) : '–'}</b>
                  {plannedAll > 0 && <em>{planned[z] ? `asked ${hm(planned[z] / 3600)}` : 'none asked'}</em>}
                </div>
              ))}
            </div>
            {plannedAll > 0
              ? <Legend items={[{ name: 'Ridden', color: MID, kind: 'block' }, { name: 'Asked for by your calendar (outline)', color: INK, kind: 'ring' }]} />
              : <p class="lb-note" style="margin:4px 0 0">Nothing was on your calendar for these weeks, so there is no plan to measure against.</p>}
          </div>
        </div>
      }
    >
      <div ref={ref} class="sc">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Riding time in each zone, week by week" style="touch-action:pan-y" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setAt(null)} onClick={() => { if (at != null) setEnd(at); }}>
          {Array.from({ length: nz }, (_, z) => {
            const y1 = Y(top(z)), y0 = Y(z === 0 ? lo0 : ladder[z].low);
            return <g key={z}>
              <line class="sc-grid" x1={padL} x2={padL + pw} y1={y1} y2={y1} />
              <text class="sc-num" x={padL - 8} y={(y0 + y1) / 2 + 3.5} text-anchor="end">Z{z + 1} {ZONE_NAMES[z]}</text>
              {weeks.map((wk, k) => { const s = wk.seconds[z] ?? 0; return s > 0 ? <rect key={k} x={padL + k * cw + 0.6} width={Math.max(1, cw - 1.2)} y={y1 + 0.6} height={Math.max(1, y0 - y1 - 1.2)} fill={ZONE_VAR[z]} opacity={0.14 + 0.86 * Math.sqrt(s / max)} /> : null; })}
            </g>;
          })}
          <rect class="sc-frame" x={padL} y={padT} width={pw} height={ph} />
          <rect class="sc-mark" x={padL + first * cw} width={Math.max(2, (last - first + 1) * cw)} y={padT - 4} height={ph + 8} style="fill:none" />
          <line x1={padL} x2={padL + pw} y1={Y(1)} y2={Y(1)} stroke={INK} stroke-width="1" stroke-dasharray="5 4" />
          <text class="sc-lab" x={padL + pw - 5} y={Y(1) - 4} text-anchor="end">Threshold{power && ftp ? ` · ${ftp} W` : L.profile.lthr ? ` · ${L.profile.lthr} bpm` : ''}</text>
          {weeks.map((wk, k) => (weeks.length <= 16 || k % Math.ceil(weeks.length / 12) === 0) && <text key={k} class="sc-num" x={padL + (k + 0.5) * cw} y={H - 6} text-anchor="middle">{short(wk.start)}</text>)}
          {at != null && <rect x={padL + at * cw} width={cw} y={padT} height={ph} fill="none" stroke={INK} stroke-width="1" />}
        </svg>
      </div>
      <Legend items={[{ name: 'Stronger means more time that week', color: MID, kind: 'block' }, { name: 'Your threshold', color: INK, dash: '5 4' }, { name: 'The weeks chosen (outlined)', color: ACC, kind: 'ring' }]} />
    </ChartShell>
  );
}

export const zonesChart: LabChart = {
  id: 'zones', name: 'Time in zones', about: 'Every week by zone, and the chosen weeks against the plan.', question: 'mix', words: 'intensity distribution polarised sweet spot plan',
  ready: (L) => {
    const n = L.rides.filter((r) => r.sport === 'ride' && (r.powerZoneSeconds?.length || r.hrZoneSeconds?.length)).length;
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'ride')} with time in zones` } : { state: 'none', why: 'Needs rides with power or heart rate' };
  },
  tile: (L) => {
    const weeks = zoneWeeks(L), mix = zoneMix(weeks);
    const W = 300, h = 64, base = 55, n = Math.max(1, weeks.length), max = Math.max(1, ...weeks.map((w) => w.seconds.reduce((a, b) => a + b, 0)));
    return {
      mini: <svg class="lb-spark" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label="Your riding time in each zone, week by week">
        <line class="lb-ax" x1="4" x2={W - 6} y1={base} y2={base} />
        {weeks.map((w, k) => { let y = base; const bw = (W - 10) / n; return <g key={k}>{w.seconds.map((s, z) => { const hh = s / max * (base - 6); y -= hh; return s > 0 ? <rect key={z} x={4 + k * bw + bw * 0.14} width={bw * 0.72} y={y} height={hh} fill={ZONE_VAR[z]} /> : null; })}</g>; })}
      </svg>,
      figure: mix ? `${mix.easy}%` : undefined, label: mix ? `easy · ${mix.mid}% zone 3 · ${mix.hard}% zone 4 and up` : 'no riding in this period',
    };
  },
  Page: ZonesPage,
};

// ---------- the year in days ----------

function yearDays(L: LabData) {
  const load = dailyLoad(L.rides);
  const start = weekStart(addDays(L.t, -364));
  const days: Array<{ date: string; tss: number; names: string[] }> = [];
  for (let d = start; d <= L.t; d = addDays(d, 1)) days.push({ date: d, tss: load.get(d)?.tss ?? 0, names: load.get(d)?.names ?? [] });
  return { days, start };
}
/** Four levels of a day's load, against the rider's own days: the quarters of their training days' loads. */
function levels(tss: number[]): number[] {
  const s = tss.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
  return [q(0.25), q(0.5), q(0.75)];
}
const levelOf = (v: number, lv: number[]) => (v <= 0 ? 0 : v <= lv[0] ? 1 : v <= lv[1] ? 2 : v <= lv[2] ? 3 : 4);

function YearPage({ L }: { L: LabData }) {
  const { days, start } = useMemo(() => yearDays(L), [L.rides, L.t]);
  const lv = useMemo(() => levels(days.map((d) => d.tss)), [days]);
  const [at, setAt] = useState<string | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const cols = Math.ceil(days.length / 7);
  const padL = 30, padT = 18, cell = Math.max(8, Math.min(18, (W - padL - 4) / cols)), H = padT + cell * 7 + 6;
  const d = days.find((x) => x.date === (at ?? L.t));
  const active = days.filter((x) => x.date >= addDays(L.t, -364) && (x.tss > 0 || x.names.length)).length;
  const streak = weekStreak(L.rides, L.t, (x) => weekStart(x));
  const byWeek = new Map<string, number>();
  for (const x of days) if (x.names.length) byWeek.set(weekStart(x.date), (byWeek.get(weekStart(x.date)) ?? 0) + 1);
  let bestRun = 0, run = 0;
  for (let w = start; w <= L.t; w = addDays(w, 7)) { if (byWeek.get(w)) { run++; bestRun = Math.max(bestRun, run); } else run = 0; }
  const dayNames = ['Mon', 'Wed', 'Fri'];
  const dow = (date: string) => dayN(start, date) % 7;
  return (
    <ChartShell
      lead={<>You trained on <b>{active}</b> of the last 365 days, and have gone <b>{plural(streak, 'week')}</b> in a row without a blank one. Your longest such run in that time is {plural(bestRun, 'week')}.</>}
      readout={d ? <>
        <div class="lc-when">{longDay(d.date)}{at == null ? ' · today' : ''}</div>
        <div class="lc-big">{Math.round(d.tss)} <small>TSS</small></div>
        <p>{d.names.length ? d.names.join(', ') : 'Nothing recorded.'}</p>
        <Kv rows={[{ name: 'Against your own training days', value: ['A blank day', 'Among your lightest quarter', 'Lighter than most', 'Heavier than most', 'Among your heaviest quarter'][levelOf(d.tss, lv)] }]} />
        {d.names.length > 0 && <p><a href={`#/calendar?d=${d.date}`}>Open the day</a></p>}
      </> : null}
      legend={<div class="sc-legend"><span>Blank</span>{[0, 1, 2, 3, 4].map((k) => <i key={k} class={`lc-day l${k}`} style="display:inline-block;width:12px;height:12px" />)}<span>Heaviest quarter of your days</span><span>· the outlined stretch is the period chosen above</span></div>}
      how={<>Each small square is a day; each column a week, with the newest on the right. The stronger the square, the heavier the day’s training load, measured against your own training days: the four strengths are the four quarters of them. Run a finger over a square to read the day; press it to open it.</>}
      plain={<>Look for columns with no squares at all (weeks off) and for runs of strong squares with no light ones between (little recovery). A steady scatter of light and strong squares, week after week, is what consistent training looks like.</>}
      table={{ name: `The year in days to ${L.t}`, head: ['Date', 'Load (TSS)', 'Activities'], rows: days.filter((x) => x.names.length).map((x) => [x.date, Math.round(x.tss), x.names.join('; ')]).reverse() }}
      question={{ id: 'enough', ask: 'Am I riding enough, and regularly?' }}
    >
      <div ref={ref} class="sc">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Training load on each of the last 365 days">
          {dayNames.map((n, k) => <text key={n} class="sc-num" x={padL - 6} y={padT + (k * 2 + 0.75) * cell} text-anchor="end">{n}</text>)}
          {days.map((x, i) => {
            const c = Math.floor(i / 7), r = weekStart(start) === start ? dow(x.date) : i % 7;
            const first = x.date.slice(8) === '01';
            return <g key={x.date}>
              {first && <text class="sc-num" x={padL + c * cell} y={11}>{new Date(x.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' })}</text>}
              <rect class={`lc-day l${levelOf(x.tss, lv)}${x.date >= L.from && x.date <= L.to ? ' in' : ''}${x.date === (at ?? '') ? ' at' : ''}`} x={padL + c * cell + 1} y={padT + r * cell + 1} width={cell - 2} height={cell - 2} rx="1.5"
                onPointerEnter={() => setAt(x.date)} onClick={() => { if (x.names.length) go(`calendar?d=${x.date}`); }}><title>{`${short(x.date)}: ${Math.round(x.tss)} TSS`}</title></rect>
            </g>;
          })}
        </svg>
      </div>
    </ChartShell>
  );
}

export const yearChart: LabChart = {
  id: 'year', name: 'The year in days', about: 'Every day of the last year at a glance.', question: 'enough', words: 'calendar consistency streak training log heatmap',
  ready: (L) => {
    const n = new Set(L.rides.map((r) => r.date)).size;
    return n >= 7 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'day')} of training` } : { state: 'none', why: 'Needs recorded activities' };
  },
  tile: (L) => {
    const { days } = yearDays(L), lv = levels(days.map((d) => d.tss));
    const cols = Math.ceil(days.length / 7), cw = 290 / cols;
    const streak = weekStreak(L.rides, L.t, (x) => weekStart(x));
    return {
      mini: <svg class="lb-spark" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="Your last 365 days, a square for each">
        {days.map((x, i) => <rect key={x.date} class={`lc-day l${levelOf(x.tss, lv)}`} x={5 + Math.floor(i / 7) * cw} y={2 + (i % 7) * 8.6} width={Math.max(1, cw - 0.8)} height="7.6" />)}
      </svg>,
      figure: plural(streak, 'week'), label: 'in a row without a blank one',
    };
  },
  Page: YearPage,
};

// ---------- recovery ----------

const NIGHT: Array<{ id: 'hrv' | 'restingHr' | 'sleep'; lower?: boolean }> = [{ id: 'hrv' }, { id: 'restingHr', lower: true }, { id: 'sleep' }];

function RecoveryPage({ L }: { L: LabData }) {
  const M = L.measures;
  const [at, setAt] = useState<number | null>(null);
  const have = NIGHT.filter((n) => readings(M, n.id) >= 3);
  const x = (d: string) => dayN(L.from, d);
  const ticks = dayTicks(L.from, L.to);
  const atDay = at != null ? addDays(L.from, at) : undefined;
  const lastDay = have.map((n) => inRange(M.values(n.id), L.from, L.to).pop()?.[0] ?? '').sort().pop();
  const day = atDay ?? lastDay;
  const where = (id: string, d: string) => { const v = M.values(id).get(d), n = M.normal(id)?.get(d); return v == null ? undefined : !n ? 'no normal yet' : v < n[0] ? 'below your normal range' : v > n[1] ? 'above your normal range' : 'inside your normal range'; };
  const rows = useMemo(() => morningsAfter(L.rides, L.data.wellness, L.from, L.to, L.profile.lthr ?? 0, hrNumbers(L.profile)).filter((r) => r.n >= 3), [L.rides, L.data.wellness, L.from, L.to, L.profile]);
  const KIND: Record<string, string> = { hard: 'A hard ride or run', long: 'A long ride', strength: 'Strength', run: 'A run', rest: 'A rest day' };
  const snaps = [...new Set(have.flatMap((n) => inRange(M.values(n.id), L.from, L.to).map(([d]) => x(d))))].sort((a, b) => a - b);
  const leadBits = day ? have.map((n) => { const def = M.def(n.id)!, v = M.values(n.id).get(day); return v == null ? null : `${def.word} ${fmtValue(def, v)}, ${where(n.id, day)}`; }).filter(Boolean) : [];
  return (
    <ChartShell
      lead={leadBits.length ? <>{day === L.t ? 'This morning' : `On ${short(day!)}, your newest morning`}: {leadBits.join('; ')}.</> : <>Your overnight readings over {periodWords(L)}.</>}
      readout={day ? <>
        <div class="lc-when">{longDay(day)}</div>
        <Kv rows={have.map((n) => { const def = M.def(n.id)!, v = M.values(n.id).get(day), nb = M.normal(n.id)?.get(day); return { name: def.name, value: v == null ? '–' : fmtValue(def, v) + (nb ? ` · normal ${fmtValue(def, nb[0], false)} to ${fmtValue(def, nb[1])}` : '') }; })} />
        {have.map((n) => { const wv = where(n.id, day); return wv ? <p key={n.id}>{M.def(n.id)!.name}: {wv}.</p> : null; })}
      </> : null}
      legend={<Legend items={[{ name: 'Each morning', color: INK, kind: 'dot' }, { name: '7-day average', color: INK }, { name: 'Your normal range (the 28 mornings before)', color: DIM, dash: '3 3' }]} />}
      how={<>One plot for each overnight reading you have. A point is a morning; the solid line is the average of the seven days to it; the two dashed lines are the edges of your own normal range, worked out from the 28 mornings before each day. Run a finger across to read a morning in all of them at once.</>}
      plain={<>Points inside the dashed lines are ordinary mornings for you. Heart-rate variability under the range, or resting heart rate over it, for two or three mornings running is the usual sign of fatigue, illness or poor sleep. The range needs seven mornings before it is drawn.</>}
      table={{ name: `Recovery ${L.from} to ${L.to}`, head: ['Date', ...have.map((n) => `${M.def(n.id)!.name}${M.def(n.id)!.unit ? ` (${M.def(n.id)!.unit})` : ''}`)], rows: snaps.map((k) => { const d = addDays(L.from, k); return [d, ...have.map((n) => { const v = M.values(n.id).get(d); return v == null ? '' : v.toFixed(M.def(n.id)!.digits); })]; }).reverse() }}
      question={{ id: 'ready', ask: 'Am I ready to train hard today?' }}
      extra={rows.length > 0 && (
        <div class="lc-body wide"><div class="lc-plot">
          <h3 class="lc-sub">The morning after <em>each reading against your average morning in this period; kinds of day with three mornings or more</em></h3>
          <div class="lc-tw" style="margin:0"><table>
            <thead><tr><th>The day before</th><th>Mornings</th>{have.map((n) => <th key={n.id}>{M.def(n.id)!.name}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.kind}><td>{KIND[r.kind]}</td><td>{r.n}</td>
              {have.map((n) => { const v = n.id === 'hrv' ? r.hrv : n.id === 'restingHr' ? r.restingHr : r.sleepSeconds != null ? r.sleepSeconds / 60 : undefined; return <td key={n.id}>{v == null ? '–' : n.id === 'sleep' ? `${sg(v)} min` : `${sg(v, 1)} ${M.def(n.id)!.unit}`}</td>; })}</tr>)}</tbody>
          </table></div>
        </div></div>
      )}
    >
      {have.map((n) => {
        const def = M.def(n.id)!, pts = inRange(M.values(n.id), L.from, L.to);
        const avg = rollingDays(pts.map((p) => p[0]), pts.map((p) => p[1]), 7);
        const nb = M.normal(n.id);
        const band = pts.map(([d]) => [d, nb?.get(d)] as const).filter((b): b is readonly [string, [number, number]] => !!b[1]);
        const series: Series[] = [
          { name: 'Normal, low', kind: 'line', pts: band.map(([d, b]) => [x(d), b[0]]), color: DIM, dash: '3 3', width: 1 },
          { name: 'Normal, high', kind: 'line', pts: band.map(([d, b]) => [x(d), b[1]]), color: DIM, dash: '3 3', width: 1 },
          { name: def.name, kind: 'dots', pts: pts.map(([d, v]) => [x(d), v]), color: MID, width: 1.8 },
          { name: '7-day average', kind: 'line', pts: pts.map(([d], k) => [x(d), avg[k] ?? pts[k][1]]), color: INK, width: 1.7 },
        ];
        return <div key={n.id}><h3 class="lc-sub">{def.name} <em>{n.lower ? 'lower is usually better' : 'higher is usually better'}</em></h3>
          <Scope label={`${def.name}, each morning, with your normal range`} height={170} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} series={series} yUnit={def.unit} snap={snaps} at={at} onAt={setAt} /></div>;
      })}
    </ChartShell>
  );
}

export const recoveryChart: LabChart = {
  id: 'recovery', name: 'Recovery', about: 'Your mornings against your own normal range.', question: 'ready', words: 'hrv resting heart rate sleep overnight wellness readiness',
  ready: (L) => {
    const n = Math.max(...NIGHT.map((x) => readings(L.measures, x.id)));
    return n >= 7 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${n} of 7 mornings` } : { state: 'none', why: 'Needs overnight readings from a watch or ring' };
  },
  tile: (L) => {
    const M = L.measures, id = NIGHT.map((n) => n.id).find((i) => readings(M, i) >= 3) ?? 'hrv', def = M.def(id)!;
    const pts = inRange(M.values(id), L.from, L.to), by = new Map(pts), nb = M.normal(id);
    const lastP = pts[pts.length - 1];
    const n = lastP ? nb?.get(lastP[0]) : undefined;
    return { mini: <Mini label={`Your ${def.word} each morning, with your normal range`} lines={[{ vals: sample((d) => nb?.get(d)?.[0], L.from, L.to), color: DIM, dash: '3 3' }, { vals: sample((d) => nb?.get(d)?.[1], L.from, L.to), color: DIM, dash: '3 3' }, { vals: sample((d) => by.get(d), L.from, L.to, 90), color: INK }]} />,
      figure: lastP ? fmtValue(def, lastP[1]) : undefined, label: lastP ? `${def.word} · ${!n ? 'no normal range yet' : lastP[1] < n[0] ? 'below your normal range' : lastP[1] > n[1] ? 'above your normal range' : 'inside your normal range'}` : 'no mornings in this period' };
  },
  Page: RecoveryPage,
};

// ---------- weight and power to weight ----------

function WeightPage({ L }: { L: LabData }) {
  const M = L.measures;
  const [at, setAt] = useState<number | null>(null);
  const def = M.def('weight')!, unit = def.unit;
  const x = (d: string) => dayN(L.from, d);
  const w = inRange(M.values('weight'), L.from, L.to), w7 = inRange(M.values('weight7'), L.from, L.to);
  const wkg = inRange(M.values('wkg'), L.from, L.to), fat = inRange(M.values('bodyFat'), L.from, L.to);
  const goalKg = L.plan?.goal.kind === 'weight' ? L.plan.goal.targetKg : undefined;
  const goal = goalKg ? (unit === 'lb' ? goalKg * 2.20462 : goalKg) : undefined;
  const ticks = dayTicks(L.from, L.to);
  const lastA = w7[w7.length - 1], firstA = w7[0];
  const d = at != null ? addDays(L.from, at) : lastA?.[0];
  const ch = lastA && firstA ? lastA[1] - firstA[1] : 0;
  const snaps = w.map(([dd]) => x(dd));
  return (
    <ChartShell
      lead={lastA ? <>Your weight is <b>{lastA[1].toFixed(1)} {unit}</b> on the 7-day average, {Math.abs(ch) < 0.05 ? 'unchanged' : `${ch < 0 ? 'down' : 'up'} ${Math.abs(ch).toFixed(1)} ${unit}`} over {periodWords(L)}.{goal ? ` Your goal is ${goal.toFixed(1)} ${unit}${L.plan ? ` by ${short(L.plan.goalDate)}` : ''}.` : ''}</> : <>No weighings in {periodWords(L)}.</>}
      readout={d ? <>
        <div class="lc-when">{longDay(d)}</div>
        <div class="lc-big">{M.values('weight').get(d) != null ? fmtValue(def, M.values('weight').get(d)) : '–'}</div>
        <Kv rows={[
          { name: '7-day average', value: M.values('weight7').get(d) != null ? `${M.values('weight7').get(d)!.toFixed(1)} ${unit}` : '–', color: INK },
          ...(goal ? [{ name: 'Goal', value: `${goal.toFixed(1)} ${unit}`, color: ACC, dash: '5 4' }] : []),
          ...(wkg.length ? [{ name: 'Power to weight', value: M.values('wkg').get(d) != null ? `${M.values('wkg').get(d)!.toFixed(2)} W/kg` : '–' }] : []),
          ...(fat.length ? [{ name: 'Body fat', value: M.values('bodyFat').get(d) != null ? `${M.values('bodyFat').get(d)!.toFixed(1)}%` : '–' }] : []),
        ]} />
      </> : null}
      legend={<Legend items={[{ name: 'Each weighing', color: MID, kind: 'dot' }, { name: '7-day average', color: INK }, ...(goal ? [{ name: 'Your goal', color: ACC, dash: '5 4' }] : [])]} />}
      how={<>Each point is a weighing; the line is the average of the weighings in the seven days to it, which is the figure to follow.{goal ? ' The dashed line is your goal.' : ''}{wkg.length ? ' The plot beneath is your FTP divided by that average weight.' : ''}</>}
      plain={<>Weight wanders by a kilo or more from one morning to the next with food, water and salt, so a single weighing means little. The line moving steadily one way over several weeks is a real change.</>}
      table={{ name: `Weight ${L.from} to ${L.to}`, head: ['Date', `Weight (${unit})`, `7-day average (${unit})`, ...(wkg.length ? ['Power to weight (W/kg)'] : []), ...(fat.length ? ['Body fat (%)'] : [])], rows: w.map(([dd, v]) => [dd, v.toFixed(1), M.values('weight7').get(dd)?.toFixed(1) ?? '', ...(wkg.length ? [M.values('wkg').get(dd)?.toFixed(2) ?? ''] : []), ...(fat.length ? [M.values('bodyFat').get(dd)?.toFixed(1) ?? ''] : [])]).reverse() }}
      question={{ id: goalKg ? 'goal' : 'health', ask: goalKg ? 'Am I on course for my goal?' : 'Is my health improving?' }}
    >
      <Scope label="Weight: each weighing and the 7-day average" x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit={unit} height={230}
        series={[{ name: 'Each weighing', kind: 'dots', pts: w.map(([dd, v]) => [x(dd), v]), color: MID, width: 2 }, { name: '7-day average', kind: 'line', pts: w7.map(([dd, v]) => [x(dd), v]), color: INK, width: 1.8 }]}
        rules={goal ? [{ y: goal, label: `Goal · ${goal.toFixed(1)} ${unit}`, color: ACC }] : []} snap={snaps} at={at} onAt={setAt} />
      {wkg.length >= 2 && <div><h3 class="lc-sub">Power to weight <em>FTP over your 7-day average weight</em></h3>
        <Scope label="Power to weight over time" height={150} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="W/kg" series={[{ name: 'Power to weight', kind: 'step', pts: wkg.map(([dd, v]) => [x(dd), v]), color: INK, width: 1.5 }]} snap={snaps} at={at} onAt={setAt} yFmt={(v) => v.toFixed(2)} /></div>}
      {fat.length >= 2 && <div><h3 class="lc-sub">Body fat <em>as your scale sends it</em></h3>
        <Scope label="Body fat over time" height={150} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="%" series={[{ name: 'Body fat', kind: 'dots', pts: fat.map(([dd, v]) => [x(dd), v]), color: MID, width: 2 }]} snap={snaps} at={at} onAt={setAt} /></div>}
    </ChartShell>
  );
}

export const weightChart: LabChart = {
  id: 'weight', name: 'Weight and power to weight', about: 'Each weighing, the 7-day average, and your goal.', question: 'health', words: 'body fat kilos pounds w/kg scale',
  ready: (L) => {
    const n = readings(L.measures, 'weight');
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'weighing')}` } : { state: 'none', why: 'Needs weighings from scales or typed in' };
  },
  tile: (L) => {
    const M = L.measures, by = M.values('weight7'), w7 = inRange(by, L.from, L.to), last = w7[w7.length - 1], unit = M.def('weight')!.unit;
    const ch = last && w7[0] ? last[1] - w7[0][1] : 0;
    let cur: number | undefined;
    return { mini: <Mini label="Your 7-day average weight over this period" lines={[{ vals: sample((d) => { cur = by.get(d) ?? cur; return cur; }, L.from, L.to, 80), color: INK }]} />, figure: last ? `${last[1].toFixed(1)} ${unit}` : undefined, label: last ? `7-day average · ${Math.abs(ch) < 0.05 ? 'unchanged' : `${ch < 0 ? 'down' : 'up'} ${Math.abs(ch).toFixed(1)}`} in this period` : 'no weighings in this period' };
  },
  Page: WeightPage,
};
