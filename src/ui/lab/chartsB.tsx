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
import { go } from '../router';
import { useWidth } from '../useWidth';
import { hrNumbers } from '../screens/Progress';
import { ChartShell, Kv, Legend, Pill, Scope, type Series } from './Scope';
import { C, HZC, KIND_C, KIND_NAME, ZC, type Kind } from './look';
import { KIND_MINUTES, dayKindName, sessionKind } from '../../engine/labMore';
import type { Ride } from '../../engine/types';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, dayN, dayTicks, hm, longDay, plural, sample, sg, short } from './util';

const periodWords = (L: LabData) => (L.period === 'custom' ? 'these dates' : L.period === 'plan' ? 'this plan' : L.period === 'all' ? 'all your history' : `these ${PERIOD_LABEL[L.period]}`);
const ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Sprint'];

// ---------- time in zones: every week above, the chosen weeks against the plan below ----------

function zoneWeeks(L: LabData) { return weeklyZones(L.rides, weekStart(L.from), L.to, (d) => weekStart(d)); }

const KINDS5 = [
  { name: 'Endurance', zones: [0, 1], color: C.end }, { name: 'Tempo, sweet spot', zones: [2], color: C.tempo }, { name: 'Threshold', zones: [3], color: C.thr },
  { name: 'VO2max', zones: [4], color: C.vo2 }, { name: 'Sprint', zones: [5, 6], color: C.sprint },
];
/** Points of difference between what was ridden and what was asked that are worth a headline. A stated general rule. */
const SHARE_GAP = 2.5;

function ZonesPage({ L }: { L: LabData }) {
  const weeks = useMemo(() => zoneWeeks(L), [L.rides, L.from, L.to]);
  const power = hasPowerHistory(L.rides);
  const ladder = power ? ridePowerZones(L.profile) : rideHrZones(L.profile);
  const nz = Math.min(7, ladder.length);
  const zc = nz > 5 ? ZC : HZC;
  const [at, setAt] = useState<number | null>(null);
  const [end, setEnd] = useState<number>(weeks.length - 1);
  const [span, setSpan] = useState<1 | 4 | 8>(4);
  const last = Math.min(end, weeks.length - 1), first = Math.max(0, last - span + 1);
  const chosen = weeks.slice(first, last + 1);
  const [ref, W] = useWidth<HTMLDivElement>(720);
  const top = (z: number) => (isFinite(ladder[z].high) ? ladder[z].high : ladder[z].low + (power ? 0.3 : 0.08));
  const lo0 = power ? 0.3 : Math.max(0.5, ladder[0].high - 0.15), hiAll = top(nz - 1);
  const side = W >= 620 ? 120 : 0;
  const padL = 104, padR = 10 + side, padT = 30, padB = 24, H = 340, pw = Math.max(10, W - padL - padR), ph = H - padT - padB;
  const Y = (f: number) => padT + ph - (Math.max(lo0, Math.min(hiAll, f)) - lo0) / (hiAll - lo0) * ph;
  const cw = pw / Math.max(1, weeks.length);
  const max = Math.max(1, ...weeks.flatMap((w) => w.seconds.slice(0, nz)));
  const w = at != null ? weeks[at] : undefined;
  const sum = (ws: typeof weeks) => { const t = [0, 0, 0, 0, 0, 0, 0]; for (const x of ws) x.seconds.forEach((s, z) => { t[z] += s; }); return t; };
  const done = sum(chosen), doneAll = done.reduce((a, b) => a + b, 0);
  // What the calendar asked for in the chosen weeks: each planned ride's steps, sorted into the same zones.
  const planned = useMemo(() => {
    const t = [0, 0, 0, 0, 0, 0, 0, 0];
    if (!chosen.length) return t;
    const a = chosen[0].start, b = addDays(chosen[chosen.length - 1].start, 6);
    const held = new Set<string>();
    for (const p of L.data.planned) {
      const d = p.plannedFor ?? p.date;
      if (d < a || d > b) continue;
      const wk = findWorkout(L.data.mine, p.workoutId);
      if (!wk || wk.kind !== 'ride') continue;
      held.add(weekStart(d));
      workoutStats(wk.blocks).zoneSeconds.forEach((s, z) => { t[Math.min(nz - 1, z)] += s; });
    }
    t[7] = held.size;
    return t;
  }, [L.data.planned, L.data.mine, first, last, weeks.length]);
  const plannedWeeks = planned[7];
  const plannedAll = planned.slice(0, 7).reduce((a, b) => a + b, 0);
  const mix = zoneMix(weeks);
  const sideMax = Math.max(1, ...done.slice(0, nz));
  const h1 = (s: number) => (s / 3600).toFixed(1);
  const ftp = knownFtp(L.profile);
  const kinds = (nz > 5 ? KINDS5 : KINDS5.slice(0, 4).map((k, i) => ({ ...k, zones: i === 0 ? [0, 1] : [i + 1] }))).map((k) => {
    const you = k.zones.reduce((a, z) => a + (done[z] ?? 0), 0), plan = k.zones.reduce((a, z) => a + (planned[z] ?? 0), 0);
    return { ...k, you, plan, youPct: doneAll ? you / doneAll * 100 : 0, planPct: plannedAll ? plan / plannedAll * 100 : 0 };
  });
  const gap = plannedAll && doneAll && plannedWeeks >= chosen.length ? [...kinds].sort((p, q) => Math.abs(q.youPct - q.planPct) - Math.abs(p.youPct - p.planPct))[0] : undefined;
  const gapPts = gap ? gap.youPct - gap.planPct : 0;
  const shareMax = Math.max(1, ...kinds.flatMap((k) => [k.youPct, k.planPct]));
  const move = (e: PointerEvent) => { const box = (e.currentTarget as SVGElement).getBoundingClientRect(); const k = Math.floor(((e.clientX - box.left) / box.width * W - padL) / cw); setAt(k >= 0 && k < weeks.length ? k : null); };
  const chosenLabel = chosen.length ? `${plural(chosen.length, 'week')} · ${short(chosen[0].start)} to ${short(addDays(chosen[chosen.length - 1].start, 6))}` : '';
  return (
    <ChartShell
      context={<>Time in zones · every week of {periodWords(L)}, and the chosen weeks against your calendar</>}
      lead={gap && Math.abs(gapPts) >= SHARE_GAP ? <>{gapPts < 0 ? 'Less' : 'More'} {gap.name.toLowerCase()} work than your calendar asked: <b style={`color:${gap.color}`}>{Math.abs(gapPts).toFixed(1)} points {gapPts < 0 ? 'short' : 'over'}</b> in the chosen weeks.</>
        : mix ? <><b style={`color:${C.end}`}>{mix.easy}%</b> of your riding was easy, {mix.mid}% in zone 3 and <b style={`color:${C.vo2}`}>{mix.hard}%</b> at zone 4 and above, on {mix.hoursPerWeek} hours a week.{mix.polarised ? ' That is a polarised mix: mostly easy, some hard, little in between.' : ''}</> : <>No riding time in zones in {periodWords(L)}.</>}
      readout={w ? <>
        <div class="lc-when">Week of {short(w.start)}</div>
        <div class="lc-big">{hm(w.seconds.reduce((a, b) => a + b, 0) / 3600)} <small>in zones</small></div>
        <Kv rows={w.seconds.slice(0, nz).map((s, z) => ({ name: `Zone ${z + 1} · ${ZONE_NAMES[z]}`, value: s ? hm(s / 3600) : '–', color: zc[z], kind: 'block' as const })).reverse()} />
        <p>Press the week to measure it against the plan below.</p>
      </> : <>
        <div class="lc-when">{chosenLabel || 'No weeks'}</div>
        <div class="lc-big">{hm(doneAll / 3600)} <small>in zones</small></div>
        <Kv rows={done.slice(0, nz).map((s, z) => ({ name: `Zone ${z + 1} · ${ZONE_NAMES[z]}`, value: s ? `${hm(s / 3600)} · ${Math.round(s / Math.max(1, doneAll) * 100)}%` : '–', color: zc[z], kind: 'block' as const })).reverse()} />
        <p>Run a finger across the weeks to read any one.</p>
      </>}
      how={<>Each column is a week and each row a zone, drawn as tall as the zone is wide, with the hardest at the top. The brighter a cell, the more time that week in that zone. The solid lines are your threshold{power && ftp ? ` (${ftp} W)` : ''} and the top of your endurance zone. Press a week to choose it; the weeks outlined in gold are the ones measured{side ? ', summed in the bars at the right,' : ''} and set against your calendar below.</>}
      plain={<>Fitness is built mostly in the lower rows, with a little time in the upper ones. Bright cells in the middle rows week after week mean a lot of riding that is neither easy nor hard. {power ? 'Rides with a power meter are sorted by power; a ride without one is sorted by heart rate.' : 'Your rides are sorted by heart rate, as none has power.'}</>}
      table={{ name: `Time in zones by week ${L.from} to ${L.to}`, head: ['Week starting', ...Array.from({ length: nz }, (_, z) => `Zone ${z + 1} (h)`), 'All (h)'], rows: weeks.map((x) => [x.start, ...x.seconds.slice(0, nz).map(h1), h1(x.seconds.reduce((a, b) => a + b, 0))]).reverse() }}
      question={{ id: L.plan ? 'plan' : 'mix', ask: L.plan ? 'Am I following my plan, and is it working?' : 'Am I doing the right mix of training?' }}
      extra={
        <div class="lc-deep lc-vs">
          <div class="lc-zhead">
            <h3 class="lc-sub">The chosen weeks <em>{chosenLabel}{plannedAll ? `, against what your calendar asked for${plannedWeeks < chosen.length ? ` (it held rides in ${plannedWeeks} of these ${chosen.length} weeks, so compare the shares, not the hours)` : ''}` : ''}</em></h3>
            <div class="seg lc-seg" role="radiogroup" aria-label="How many weeks to measure">{([1, 4, 8] as const).map((n) => <button key={n} role="radio" aria-checked={span === n} class={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n === 1 ? 'That week' : `${n} weeks to it`}</button>)}</div>
          </div>
          <div class="lc-vsrows" role="table" aria-label="The chosen weeks by kind of work, against the plan">
            <div class="lc-vsrow head" role="row"><span /><span /><b>You</b>{plannedAll > 0 && <><b>Plan</b><b>Difference</b></>}</div>
            {kinds.map((k) => { const diff = k.youPct - k.planPct, far = plannedAll > 0 && Math.abs(diff) >= SHARE_GAP; return (
              <div key={k.name} class="lc-vsrow" role="row">
                <span class="lc-vsname"><i class="sc-key" style={`background:${k.color}`} />{k.name}</span>
                <span class="lc-vsbar" aria-hidden="true">
                  {plannedAll > 0 && <s style={`left:${Math.min(k.youPct, k.planPct) / shareMax * 100}%;width:${Math.abs(diff) / shareMax * 100}%;background:${far ? C.vo2 : 'var(--lc-grey2)'}`} />}
                  <i style={`width:${k.youPct / shareMax * 100}%;background:${k.color}`} /><em style={`left:${k.youPct / shareMax * 100}%;background:${k.color}`} />
                  {plannedAll > 0 && <u style={`left:${k.planPct / shareMax * 100}%`} />}
                </span>
                <b>{k.youPct.toFixed(0)}% <small>{h1(k.you)} h</small></b>
                {plannedAll > 0 && <><b class="plan">{k.planPct.toFixed(0)}% <small>{h1(k.plan)} h</small></b><b style={far ? `color:${C.vo2}` : ''}>{sg(diff, 1)} <small>points</small></b></>}
              </div>); })}
          </div>
          {plannedAll > 0
            ? <Legend items={[{ name: 'The share you rode', color: C.end, kind: 'dot' }, { name: 'The share your calendar asked for (white tick)', color: C.white, kind: 'block' }, { name: `${SHARE_GAP} points apart or more`, color: C.vo2 }]} />
            : <p class="lb-note" style="margin:4px 0 0">Nothing was on your calendar for these weeks, so there is no plan to measure against.</p>}
        </div>
      }
    >
      <div ref={ref} class="sc">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Riding time in each zone, week by week" style="touch-action:pan-y" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setAt(null)} onClick={() => { if (at != null) setEnd(at); }}>
          {Array.from({ length: nz }, (_, z) => {
            const y1 = Y(top(z)), y0 = Y(z === 0 ? lo0 : ladder[z].low);
            return <g key={z}>
              <rect x={6} y={(y0 + y1) / 2 - 5} width="10" height="10" rx="2.5" fill={zc[z]} />
              <text class="sc-num" x={22} y={(y0 + y1) / 2 + 3.5} style="fill:var(--ink-2)">Z{z + 1} {ZONE_NAMES[z]}</text>
              {weeks.map((wk, k) => { const s = wk.seconds[z] ?? 0, inside = k >= first && k <= last; return <rect key={k} x={padL + k * cw + 0.8} width={Math.max(1, cw - 1.6)} y={y1 + 0.8} height={Math.max(1, y0 - y1 - 1.6)} rx={Math.min(3, cw / 5)} fill={s > 0 ? zc[z] : 'var(--lc-card)'} opacity={(s > 0 ? 0.16 + 0.84 * Math.sqrt(s / max) : 0.6) * (inside ? 1 : 0.38)} />; })}
              {side > 0 && <g><rect x={padL + pw + 12} y={(y0 + y1) / 2 - 5} width={Math.max(1, done[z] / sideMax * (side - 54))} height="10" rx="3" fill={zc[z]} /><text class="sc-num" x={padL + pw + 16 + done[z] / sideMax * (side - 54)} y={(y0 + y1) / 2 + 3.5}>{done[z] ? `${h1(done[z])} h` : ''}</text></g>}
            </g>;
          })}
          {side > 0 && <text class="sc-title" x={padL + pw + 12} y={padT - 12}>These weeks</text>}
          <line x1={padL} x2={padL + pw} y1={Y(1)} y2={Y(1)} stroke={C.white} stroke-width="1.4" />
          <text class="sc-lab" x={padL + 5} y={Y(1) - 4} style="fill:var(--ink);font-weight:600">{power ? `FTP${ftp ? ` · ${ftp} W` : ''}` : `Threshold${L.profile.lthr ? ` · ${L.profile.lthr} bpm` : ''}`}</text>
          {nz > 2 && <><line x1={padL} x2={padL + pw} y1={Y(top(1))} y2={Y(top(1))} stroke={C.white} stroke-width="1" opacity="0.7" /><text class="sc-lab" x={padL + 5} y={Y(top(1)) - 4}>Top of endurance</text></>}
          <rect x={padL + first * cw} width={Math.max(2, (last - first + 1) * cw)} y={padT - 3} height={ph + 6} rx="5" fill="none" stroke={C.gold} stroke-width="1.8" />
          <text class="sc-lab" x={Math.min(padL + pw - 4, padL + (last + 1) * cw)} y={padT - 9} text-anchor="end" style={`fill:${C.gold};font-weight:600`}>{chosenLabel}</text>
          {weeks.map((wk, k) => k % Math.max(1, Math.ceil(weeks.length / Math.max(3, Math.floor(pw / 62)))) === 0 && <text key={k} class="sc-num" x={padL + (k + 0.5) * cw} y={H - 6} text-anchor="middle">{short(wk.start)}</text>)}
          {at != null && <rect x={padL + at * cw} width={cw} y={padT} height={ph} fill="none" stroke={C.white} stroke-width="1" />}
        </svg>
      </div>
      <Legend items={[{ name: 'Brighter means more time that week', color: C.end, kind: 'block' }, { name: 'Your threshold', color: C.white }, { name: 'The weeks chosen', color: C.gold, kind: 'ring' }]} />
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
        {weeks.map((w, k) => { let y = base; const bw = (W - 10) / n; return <g key={k}>{w.seconds.map((s, z) => { const hh = s / max * (base - 6); y -= hh; return s > 0 ? <rect key={z} x={4 + k * bw + bw * 0.14} width={bw * 0.72} y={y} height={hh} fill={ZC[z]} /> : null; })}</g>; })}
      </svg>,
      figure: mix ? `${mix.easy}%` : undefined, label: mix ? `easy · ${mix.mid}% zone 3 · ${mix.hard}% zone 4 and up` : 'no riding in this period',
    };
  },
  Page: ZonesPage,
};

// ---------- the year in days ----------

interface YearDay { date: string; tss: number; names: string[]; rides: Ride[]; kind?: Kind; seconds: number }
function yearDays(L: LabData) {
  const by = new Map<string, Ride[]>();
  for (const r of L.rides) { if (r.notTraining) continue; const l = by.get(r.date) ?? []; l.push(r); by.set(r.date, l); }
  const start = weekStart(addDays(L.t, -364));
  const days: YearDay[] = [];
  for (let d = start; d <= L.t; d = addDays(d, 1)) { const l = by.get(d) ?? []; days.push({ date: d, tss: l.reduce((a, r) => a + (r.tss ?? 0), 0), names: l.map((r) => r.name), rides: l, kind: dayKindName(l), seconds: l.reduce((a, r) => a + r.seconds, 0) }); }
  return { days, start };
}
/** Four levels of a day's load, against the rider's own days: the quarters of their training days' loads. */
function levels(tss: number[]): number[] {
  const s = tss.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
  return [q(0.25), q(0.5), q(0.75)];
}
const levelOf = (v: number, lv: number[]) => (v <= 0 ? 0 : v <= lv[0] ? 1 : v <= lv[1] ? 2 : v <= lv[2] ? 3 : 4);
const LEVEL_O = [0, 0.38, 0.58, 0.8, 1];
const KIND_ORDER: Kind[] = ['recovery', 'endurance', 'tempo', 'threshold', 'vo2', 'sprint', 'run', 'strength', 'walk', 'mobility', 'other'];
const dayFill = (x: YearDay, lv: number[], by: 'kind' | 'load') => {
  const l = x.names.length ? Math.max(1, levelOf(x.tss, lv)) : 0;
  if (!l) return { fill: 'var(--lc-card)', opacity: 1, stroke: 'var(--lc-edge)' };
  return { fill: by === 'kind' ? KIND_C[x.kind ?? 'other'] : C.gold, opacity: LEVEL_O[l], stroke: 'none' };
};

function YearPage({ L }: { L: LabData }) {
  const { days, start } = useMemo(() => yearDays(L), [L.rides, L.t]);
  const lv = useMemo(() => levels(days.map((d) => d.tss)), [days]);
  const [at, setAt] = useState<string | null>(null);
  const [by, setBy] = useState<'kind' | 'load'>('kind');
  const [ref, W] = useWidth<HTMLDivElement>(900);
  const cols = Math.ceil(days.length / 7);
  const padL = 30, padT = 18, cell = Math.max(8, Math.min(18, (W - padL - 4) / cols)), gridH = cell * 7, barsT = padT + gridH + 26, barsH = 84, H = barsT + barsH + 8;
  const d = days.find((x) => x.date === (at ?? L.t));
  const active = days.filter((x) => x.date >= addDays(L.t, -364) && x.names.length).length;
  const streak = weekStreak(L.rides, L.t, (x) => weekStart(x));
  const byWeek = new Map<string, number>();
  for (const x of days) if (x.names.length) byWeek.set(weekStart(x.date), (byWeek.get(weekStart(x.date)) ?? 0) + 1);
  let bestRun = 0, run = 0;
  for (let w = start; w <= L.t; w = addDays(w, 7)) { if (byWeek.get(w)) { run++; bestRun = Math.max(bestRun, run); } else run = 0; }
  // Hours in each week, by the kind of each session.
  const weeks = useMemo(() => Array.from({ length: cols }, (_, c) => { const h: Partial<Record<Kind, number>> = {}; for (const x of days.slice(c * 7, c * 7 + 7)) for (const r of x.rides) { const k = sessionKind(r); h[k] = (h[k] ?? 0) + r.seconds / 3600; } return h; }), [days, cols]);
  const weekTotal = (h: Partial<Record<Kind, number>>) => Object.values(h).reduce((a, b) => a + (b ?? 0), 0);
  const maxWeek = Math.max(1, ...weeks.map(weekTotal));
  const used = KIND_ORDER.filter((k) => days.some((x) => x.kind === k) || weeks.some((h) => h[k]));
  const dayNames = ['Mon', 'Wed', 'Fri'];
  const dow = (date: string) => dayN(start, date) % 7;
  const dWeek = d ? weeks[Math.floor(dayN(start, d.date) / 7)] : undefined;
  const power = d?.rides.filter((r) => r.averagePower).sort((p, q) => q.seconds - p.seconds)[0];
  const work = d ? d.rides.reduce((a, r) => a + (r.averagePower ? r.averagePower * (r.movingSeconds ?? r.seconds) / 1000 : 0), 0) : 0;
  const common = used.map((k) => ({ k, n: days.filter((x) => x.kind === k).length })).sort((p, q) => q.n - p.n)[0];
  return (
    <ChartShell
      context={<>The year in days · the 365 days to today</>}
      lead={<>You trained on <b>{active}</b> of the last 365 days, and have gone <b>{plural(streak, 'week')}</b> in a row without a blank one.{common ? <> Most of your days were <b style={`color:${KIND_C[common.k]}`}>{KIND_NAME[common.k].toLowerCase()}</b>.</> : null}</>}
      readout={d ? <>
        <div class="lc-when">{longDay(d.date)}{at == null ? ' · today' : ''}</div>
        <div class="lc-big" style="font-size:22px;line-height:1.2">{d.names.length ? d.names[0] : 'A blank day'}</div>
        {d.kind && <Pill color={KIND_C[d.kind]}>{KIND_NAME[d.kind]}</Pill>}
        {d.names.length > 1 && <p>Also: {d.names.slice(1).join(', ')}</p>}
        {d.names.length > 0 && <Kv rows={[
          { name: 'Time', value: hm(d.seconds / 3600) },
          { name: 'Training stress', value: `${Math.round(d.tss)} TSS` },
          ...(work > 0 ? [{ name: 'Work', value: `${Math.round(work).toLocaleString()} kJ` }] : []),
          ...(power ? [{ name: 'Average power', value: `${Math.round(power.averagePower!)} W` }] : []),
          ...(dWeek ? [{ name: 'That week', value: hm(weekTotal(dWeek)) }] : []),
          { name: 'Against your own training days', value: ['–', 'Among your lightest quarter', 'Lighter than most', 'Heavier than most', 'Among your heaviest quarter'][levelOf(d.tss, lv)] },
        ]} />}
        {d.names.length > 0 && <p><a href={`#/calendar?d=${d.date}`}>Open the day</a></p>}
      </> : null}
      legend={<div class="lc-chips">
        <div class="seg lc-seg" style="margin:0" role="radiogroup" aria-label="Colour the days by"><button role="radio" aria-checked={by === 'kind'} class={by === 'kind' ? 'on' : ''} onClick={() => setBy('kind')}>Colour by kind</button><button role="radio" aria-checked={by === 'load'} class={by === 'load' ? 'on' : ''} onClick={() => setBy('load')}>Colour by load</button></div>
        {by === 'kind' ? <Legend items={used.map((k) => ({ name: KIND_NAME[k], color: KIND_C[k], kind: 'block' as const }))} />
          : <div class="sc-legend" style="margin:0"><span>Lightest</span>{[1, 2, 3, 4].map((k) => <i key={k} class="sc-key" style={`background:${C.gold};opacity:${LEVEL_O[k]}`} />)}<span>Heaviest quarter of your days</span></div>}
      </div>}
      how={<>Each small square is a day; each column a week, with the newest on the right. The colour is the kind of training that day, and the brighter the square, the heavier the day against your own training days. Beneath, each bar is that week’s hours, split by kind. A ride is named for the hardest work it held a real amount of: {KIND_MINUTES.sprint} minutes above VO2max, {KIND_MINUTES.vo2} at VO2max, {KIND_MINUTES.threshold} at threshold or {KIND_MINUTES.tempo} at tempo; otherwise endurance, or recovery when short and easy. Run a finger over a square to read the day; press it to open it.</>}
      plain={<>Look for columns with no colour at all (weeks off) and for runs of bright squares with no dim ones between (little recovery). A steady scatter, mostly blue with a few warmer squares each week, is what consistent training looks like.</>}
      table={{ name: `The year in days to ${L.t}`, head: ['Date', 'Kind', 'Stress (TSS)', 'Hours', 'Activities'], rows: days.filter((x) => x.names.length).map((x) => [x.date, KIND_NAME[x.kind ?? 'other'], Math.round(x.tss), (x.seconds / 3600).toFixed(2), x.names.join('; ')]).reverse() }}
      question={{ id: 'enough', ask: 'Am I riding enough, and regularly?' }}
    >
      <div ref={ref} class="sc">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each of the last 365 days, coloured by the kind of training, with each week’s hours beneath">
          {dayNames.map((n, k) => <text key={n} class="sc-num" x={padL - 6} y={padT + (k * 2 + 0.75) * cell} text-anchor="end">{n}</text>)}
          {days.map((x, i) => {
            const c = Math.floor(i / 7), r = weekStart(start) === start ? dow(x.date) : i % 7;
            const first = x.date.slice(8) === '01', f = dayFill(x, lv, by);
            return <g key={x.date}>
              {first && <text class="sc-num" x={padL + c * cell} y={11}>{new Date(x.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' })}</text>}
              <rect class={`lc-yd${x.date >= L.from && x.date <= L.to ? ' in' : ''}`} x={padL + c * cell + 1} y={padT + r * cell + 1} width={cell - 2} height={cell - 2} rx={Math.min(3.5, cell / 4)} fill={f.fill} opacity={f.opacity} stroke={x.date === (at ?? '') ? 'var(--ink)' : f.stroke} stroke-width={x.date === (at ?? '') ? 1.6 : 1}
                onPointerEnter={() => setAt(x.date)} onClick={() => { if (x.names.length) go(`calendar?d=${x.date}`); }}><title>{`${short(x.date)}: ${x.names.length ? `${KIND_NAME[x.kind ?? 'other']}, ${Math.round(x.tss)} TSS` : 'nothing recorded'}`}</title></rect>
            </g>;
          })}
          <text class="sc-title" x={padL} y={barsT - 8}>Hours each week, by kind</text>
          <line x1={padL} x2={padL + cols * cell} y1={barsT + barsH} y2={barsT + barsH} stroke="var(--lc-edge)" />
          {weeks.map((h, c) => { let y = barsT + barsH; return <g key={c}>{KIND_ORDER.map((k) => { const v = h[k] ?? 0; if (!v) return null; const hh = v / maxWeek * (barsH - 4); y -= hh; return <rect key={k} x={padL + c * cell + 1.5} width={Math.max(1, cell - 3)} y={y} height={Math.max(0.6, hh - 0.6)} rx="1.5" fill={KIND_C[k]} opacity="0.92" />; })}</g>; })}
          <text class="sc-num" x={padL - 6} y={barsT + 8} text-anchor="end">{Math.round(maxWeek)} h</text>
        </svg>
      </div>
    </ChartShell>
  );
}

export const yearChart: LabChart = {
  id: 'year', name: 'The year in days', about: 'Every day of the last year, coloured by the kind of training.', question: 'enough', words: 'calendar consistency streak training log heatmap',
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
        {days.map((x, i) => { const f = dayFill(x, lv, 'kind'); return <rect key={x.date} x={5 + Math.floor(i / 7) * cw} y={2 + (i % 7) * 8.6} width={Math.max(1, cw - 0.8)} height="7.6" rx="1" fill={f.fill} opacity={f.opacity} />; })}
      </svg>,
      figure: plural(streak, 'week'), label: 'in a row without a blank one',
    };
  },
  Page: YearPage,
};

// ---------- recovery ----------

const NIGHT: Array<{ id: 'hrv' | 'restingHr' | 'sleep'; lower?: boolean }> = [{ id: 'hrv' }, { id: 'restingHr', lower: true }, { id: 'sleep' }];
const NIGHT_C = { hrv: C.cyan, restingHr: C.sprint, sleep: C.sleep };

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
  const stress = useMemo(() => dailyLoad(L.rides), [L.rides]);
  const outside = day ? have.filter((n) => { const v = M.values(n.id).get(day), r = M.normal(n.id)?.get(day); return v != null && !!r && (n.lower ? v > r[1] : v < r[0]); }) : [];
  const judged = day ? have.filter((n) => M.values(n.id).get(day) != null && M.normal(n.id)?.get(day)).length : 0;
  const leadBits = day ? have.map((n) => { const def = M.def(n.id)!, v = M.values(n.id).get(day); return v == null ? null : `${def.word} ${fmtValue(def, v)}, ${where(n.id, day)}`; }).filter(Boolean) : [];
  return (
    <ChartShell
      lead={leadBits.length ? <>{day === L.t ? 'This morning' : `On ${short(day!)}, your newest morning`}: {leadBits.join('; ')}.</> : <>Your overnight readings over {periodWords(L)}.</>}
      readout={day ? <>
        <div class="lc-when">{longDay(day)}</div>
        {judged > 0 && <Pill color={outside.length === 0 ? C.good : outside.length === 1 ? C.gold : C.watch}>{outside.length === 0 ? 'Inside your normal range' : outside.length === 1 ? 'One reading outside your normal' : `${outside.length} readings outside your normal`}</Pill>}
        <Kv rows={[...have.map((n) => { const def = M.def(n.id)!, v = M.values(n.id).get(day), nb = M.normal(n.id)?.get(day); return { name: def.name, value: v == null ? '–' : fmtValue(def, v) + (nb ? ` · normal ${fmtValue(def, nb[0], false)} to ${fmtValue(def, nb[1])}` : ''), color: NIGHT_C[n.id], kind: 'dot' as const }; }),
          { name: 'Training stress that day', value: `${Math.round(stress.get(day)?.tss ?? 0)} TSS`, color: C.gold, kind: 'block' as const }, { name: 'The day before', value: `${Math.round(stress.get(addDays(day, -1))?.tss ?? 0)} TSS` }]} />
        {have.map((n) => { const wv = where(n.id, day); return wv ? <p key={n.id}>{M.def(n.id)!.name}: {wv}.</p> : null; })}
      </> : null}
      context={<>Recovery · your mornings over {periodWords(L)}, against your own normal</>}
      legend={<Legend items={[{ name: 'Each morning', color: C.cyan, kind: 'dot' }, { name: 'Outside your normal, the wrong way', color: C.watch, kind: 'dot' }, { name: '7-day average', color: C.cyan }, { name: 'Your normal range (the 28 mornings before)', color: C.cyan, kind: 'block' }, { name: 'Training stress', color: C.gold, kind: 'block' }]} />}
      how={<>One lane for each overnight reading you have, with your training underneath. A point is a morning; the line is the average of the seven days to it; the shaded band is your own normal range, worked out from the 28 mornings before each day. A larger orange point is a morning outside that range in the direction that usually means strain. The gold bars at the foot are each day’s training stress, so cause sits under effect. Run a finger across to read a morning in every lane at once.</>}
      plain={<>Points inside the shaded band are ordinary mornings for you. Heart-rate variability under the range, or resting heart rate over it, for two or three mornings running is the usual sign of fatigue, illness or poor sleep. The range needs seven mornings before it is drawn.</>}
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
        const col = NIGHT_C[n.id];
        const bad = (d: string, v: number) => { const r = nb?.get(d); return !!r && (n.lower ? v > r[1] : v < r[0]); };
        const lastP = pts[pts.length - 1];
        const series: Series[] = n.id === 'sleep'
          ? [{ name: def.name, kind: 'bars', pts: pts.map(([d, v]) => [x(d), v]), color: col, barW: 0.72, opacity: 0.85, colorAt: (v, xx) => (bad(addDays(L.from, xx), v) ? C.watch : col) }]
          : [
            { name: def.name, kind: 'dots', pts: pts.map(([d, v]) => [x(d), v]), color: col, opacity: 0.75, colorAt: (v, xx) => (bad(addDays(L.from, xx), v) ? C.watch : col), sizeAt: (v, xx) => (bad(addDays(L.from, xx), v) ? 3.6 : 2.1) },
            { name: '7-day average', kind: 'line', pts: pts.map(([d], k) => [x(d), avg[k] ?? pts[k][1]]), color: col, width: 2.2, smooth: true, glow: true },
          ];
        return <Scope key={n.id} title={`${def.name} · ${n.lower ? 'lower is usually better' : 'higher is usually better'}${lastP ? ` · ${fmtValue(def, lastP[1])}` : ''}`} label={`${def.name}, each morning, with your normal range`} height={180} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} series={series} yUnit={def.unit}
          ribbons={[{ pts: band.map(([d, b]) => [x(d), b[0], b[1]] as [number, number, number]), color: col, opacity: 0.13 }]} yMin={n.id === 'sleep' ? 0 : undefined} rules={n.id === 'sleep' ? [{ y: 7, label: '7 hours', color: C.grey }] : []} snap={snaps} at={at} onAt={setAt} />;
      })}
      <Scope title="Training stress each day · cause under effect" label="Training stress each day" height={120} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="TSS" yMin={0}
        series={[{ name: 'Training stress', kind: 'bars', pts: [...stress].filter(([d]) => d >= L.from && d <= L.to).map(([d, v]) => [x(d), Math.round(v.tss)] as [number, number]), color: C.gold, barW: 0.72, opacity: 0.85 }]} snap={snaps} at={at} onAt={setAt} />
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
    return { mini: <Mini label={`Your ${def.word} each morning, with your normal range`} lines={[{ vals: sample((d) => nb?.get(d)?.[0], L.from, L.to), color: C.grey2, dash: '3 3' }, { vals: sample((d) => nb?.get(d)?.[1], L.from, L.to), color: C.grey2, dash: '3 3' }, { vals: sample((d) => by.get(d), L.from, L.to, 90), color: NIGHT_C[id], width: 1.8 }]} />,
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
          { name: '7-day average', value: M.values('weight7').get(d) != null ? `${M.values('weight7').get(d)!.toFixed(1)} ${unit}` : '–', color: C.purple },
          ...(goal ? [{ name: 'Goal', value: `${goal.toFixed(1)} ${unit}`, color: C.good, kind: 'block' as const }] : []),
          ...(wkg.length ? [{ name: 'Power to weight', value: M.values('wkg').get(d) != null ? `${M.values('wkg').get(d)!.toFixed(2)} W/kg` : '–', color: C.gold }] : []),
          ...(fat.length ? [{ name: 'Body fat', value: M.values('bodyFat').get(d) != null ? `${M.values('bodyFat').get(d)!.toFixed(1)}%` : '–', color: C.cyan, kind: 'dot' as const }] : []),
        ]} />
      </> : null}
      context={<>Weight and power to weight · {periodWords(L)}</>}
      legend={<Legend items={[{ name: 'Each weighing', color: C.grey, kind: 'dot' }, { name: '7-day average', color: C.purple }, ...(goal ? [{ name: 'Your goal', color: C.good, kind: 'block' as const }] : []), ...(wkg.length >= 2 ? [{ name: 'Power to weight', color: C.gold }] : []), ...(fat.length >= 2 ? [{ name: 'Body fat', color: C.cyan, kind: 'dot' as const }] : [])]} />}
      how={<>Each point is a weighing; the line is the average of the weighings in the seven days to it, which is the figure to follow.{goal ? ' The green band is your goal.' : ''}{wkg.length ? ' The plot beneath is your FTP divided by that average weight.' : ''}</>}
      plain={<>Weight wanders by a kilo or more from one morning to the next with food, water and salt, so a single weighing means little. The line moving steadily one way over several weeks is a real change.</>}
      table={{ name: `Weight ${L.from} to ${L.to}`, head: ['Date', `Weight (${unit})`, `7-day average (${unit})`, ...(wkg.length ? ['Power to weight (W/kg)'] : []), ...(fat.length ? ['Body fat (%)'] : [])], rows: w.map(([dd, v]) => [dd, v.toFixed(1), M.values('weight7').get(dd)?.toFixed(1) ?? '', ...(wkg.length ? [M.values('wkg').get(dd)?.toFixed(2) ?? ''] : []), ...(fat.length ? [M.values('bodyFat').get(dd)?.toFixed(1) ?? ''] : [])]).reverse() }}
      question={{ id: goalKg ? 'goal' : 'health', ask: goalKg ? 'Am I on course for my goal?' : 'Is my health improving?' }}
    >
      <Scope label="Weight: each weighing and the 7-day average" x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit={unit} height={230}
        title="Weight" series={[{ name: 'Each weighing', kind: 'dots', pts: w.map(([dd, v]) => [x(dd), v]), color: C.grey, width: 2.2, opacity: 0.8 }, { name: '7-day average', kind: 'line', pts: w7.map(([dd, v]) => [x(dd), v]), color: C.purple, width: 2.6, smooth: true, glow: true, area: 0.12 }]}
        bands={goal ? [{ y0: goal - (unit === 'lb' ? 1 : 0.5), y1: goal + (unit === 'lb' ? 1 : 0.5), color: C.good, opacity: 0.2, label: `Goal · ${goal.toFixed(1)} ${unit}` }] : []} yMin={Math.min(...w.map((q) => q[1]), goal ?? Infinity) - 1} snap={snaps} at={at} onAt={setAt} />
      {wkg.length >= 2 && <Scope title="Power to weight · FTP over your 7-day average weight" label="Power to weight over time" height={160} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="W/kg" series={[{ name: 'Power to weight', kind: 'line', pts: wkg.map(([dd, v]) => [x(dd), v]), color: C.gold, width: 2.2, glow: true }]} snap={snaps} at={at} onAt={setAt} yFmt={(v) => v.toFixed(2)} />}
      {fat.length >= 2 && <Scope title="Body fat · as your scale sends it" label="Body fat over time" height={150} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="%" series={[{ name: 'Body fat', kind: 'dots', pts: fat.map(([dd, v]) => [x(dd), v]), color: C.cyan, width: 2.4 }]} snap={snaps} at={at} onAt={setAt} />}
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
    return { mini: <Mini label="Your 7-day average weight over this period" lines={[{ vals: sample((d) => { cur = by.get(d) ?? cur; return cur; }, L.from, L.to, 80), color: C.purple, width: 2, area: true }]} />, figure: last ? `${last[1].toFixed(1)} ${unit}` : undefined, label: last ? `7-day average · ${Math.abs(ch) < 0.05 ? 'unchanged' : `${ch < 0 ? 'down' : 'up'} ${Math.abs(ch).toFixed(1)}`} in this period` : 'no weighings in this period' };
  },
  Page: WeightPage,
};
