import { useMemo, useState } from 'preact/hooks';
import { addDays } from '../../engine/load';
import { CURVE_LABELS, CURVE_SECONDS, bestCurve, dailyLoad } from '../../engine/progress';
import { DURABILITY_MIN_RIDES, durability, records } from '../../engine/progressMore';
import { fitCp, FIT_SECONDS } from '../../engine/cpFit';
import { formZone, FORM_ZONES } from '../../engine/formZones';
import { hasPowerHistory } from '../../engine/hrRecords';
import { periodBefore, PERIOD_LABEL } from '../../engine/lab';
import { knownFtp } from '../../engine/known';
import { go } from '../router';
import { ChartShell, Kv, Legend, Scope, type Series } from './Scope';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, dayN, dayTicks, longDay, median, plural, sample, sg, short } from './util';

// The instrument look: ink in three weights and one accent. Lines are told apart by weight and dash, never by colour alone;
// zone colours are kept for zones.
const INK = 'var(--ink)', ACC = 'var(--accent)', INFO = 'var(--ink)', AQUA = 'var(--ink-2)', DIM = 'var(--ink-3)', FAINT = 'var(--line-2)';
const periodWords = (L: LabData) => (L.period === 'custom' ? 'these dates' : L.period === 'plan' ? 'this plan' : L.period === 'all' ? 'all your history' : `these ${PERIOD_LABEL[L.period]}`);

// ---------- fitness, fatigue and form ----------

function fitnessIn(L: LabData) { return L.series.filter((f) => f.date >= L.from && f.date <= L.to); }

function FitnessPage({ L }: { L: LabData }) {
  const [at, setAt] = useState<number | null>(null);
  const s = fitnessIn(L);
  const load = useMemo(() => dailyLoad(L.rides), [L.rides]);
  const x = (d: string) => dayN(L.from, d);
  const first = s[0], last = s[s.length - 1];
  const z = formZone(last.tsb);
  const f = at != null ? s.find((p) => x(p.date) === at) : last;
  const fz = f ? formZone(f.tsb) : z;
  const day = f ? load.get(f.date) : undefined;
  const wk = f ? L.series.find((p) => p.date === addDays(f.date, -7)) : undefined;
  const peak = s.reduce((m, p) => (p.ctl > m.ctl ? p : m), s[0]);
  const ticks = dayTicks(L.from, L.to);
  const top: Series[] = [
    { name: 'Training load, each day', kind: 'bars', pts: s.map((p) => [x(p.date), Math.round(load.get(p.date)?.tss ?? 0)] as [number, number]), color: FAINT, axis: 1, barW: 0.7 },
    { name: 'Fatigue', kind: 'line', pts: s.map((p) => [x(p.date), p.atl]), color: ACC, dash: '5 3', width: 1.2 },
    { name: 'Fitness', kind: 'line', pts: s.map((p) => [x(p.date), p.ctl]), color: INK, width: 1.9 },
  ];
  const change = last.ctl - first.ctl;
  return (
    <ChartShell
      lead={<>Your fitness is <b>{Math.round(last.ctl)}</b>, {Math.abs(change) < 1 ? 'level' : change > 0 ? `up ${Math.round(change)}` : `down ${Math.round(-change)}`} over {periodWords(L)}. Form today is <b>{sg(last.tsb)}</b>: {z.name.toLowerCase()}, which means {z.says}.</>}
      readout={f && <>
        <div class="lc-when">{at == null ? 'Today' : longDay(f.date)}</div>
        <div class="lc-big">{Math.round(f.ctl)} <small>fitness</small></div>
        <Kv rows={[
          { name: 'Fatigue', value: Math.round(f.atl), color: ACC, dash: '5 3' },
          { name: 'Form', value: `${sg(f.tsb)} · ${fz.name}` },
          { name: 'Load that day', value: `${Math.round(day?.tss ?? 0)} TSS`, color: FAINT, kind: 'block' },
          { name: 'Fitness in the week to it', value: wk ? sg(f.ctl - wk.ctl, 1) : '–' },
        ]} />
        {day?.names.length ? <p>{day.names.join(', ')}</p> : <p>Nothing recorded that day.</p>}
        <hr /><p>Highest fitness in this period: {Math.round(peak.ctl)}, on {short(peak.date)}.</p>
      </>}
      legend={<Legend items={[{ name: 'Fitness', color: INK }, { name: 'Fatigue', color: ACC, dash: '5 3' }, { name: 'Load each day (right-hand scale)', color: FAINT, kind: 'block' }]} />}
      how={<>The upper plot is how much training you carry. The solid line, fitness, is your average daily training load over about six weeks; the dashed line, fatigue, is the same over one week; the bars behind are each day’s load. The lower plot is form, fitness less fatigue, against four named zones. Run a finger across either to read any day.</>}
      plain={<>Fitness climbs when the weeks are steady and falls when they stop. Form below zero is normal while you are building; it is “too much” only when it stays under {FORM_ZONES[0].hi}. The zone edges are the ones your readiness score already uses.</>}
      table={{ name: `Fitness fatigue form ${L.from} to ${L.to}`, head: ['Date', 'Fitness', 'Fatigue', 'Form', 'Load (TSS)'], rows: s.map((p) => [p.date, p.ctl.toFixed(1), p.atl.toFixed(1), p.tsb.toFixed(1), Math.round(load.get(p.date)?.tss ?? 0)]).reverse() }}
      question={{ id: 'fitter', ask: 'Am I getting fitter?' }}
    >
      <Scope label="Fitness and fatigue, with each day’s training load behind" x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} series={top} y2Unit="TSS" yMin={0} y2Min={0}
        snap={s.map((p) => x(p.date))} at={at} onAt={setAt} onPick={(v) => { const d = addDays(L.from, v); if (load.get(d)?.names.length) go(`calendar?d=${d}`); }} />
      <Scope label="Form, against its named zones" height={150} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks}
        series={[{ name: 'Form', kind: 'line', pts: s.map((p) => [x(p.date), p.tsb]), color: INFO, width: 1.5 }]}
        bands={[{ y0: Math.min(-40, ...s.map((p) => p.tsb)), y1: -25, color: 'var(--bad)', label: 'Too much' }, { y0: -25, y1: -10, color: 'var(--warn)', label: 'Building' }, { y0: -10, y1: 5, color: 'var(--info)', label: 'Balanced' }, { y0: 5, y1: Math.max(20, ...s.map((p) => p.tsb)), color: 'var(--good)', label: 'Fresh' }]}
        snap={s.map((p) => x(p.date))} at={at} onAt={setAt} yFmt={(v) => sg(v)} />
    </ChartShell>
  );
}

export const fitnessChart: LabChart = {
  id: 'fitness', name: 'Fitness, fatigue and form', about: 'How much training you carry, and how fresh you are.', question: 'fitter', words: 'ctl atl tsb load pmc',
  ready: (L) => {
    const withLoad = new Set(L.rides.filter((r) => (r.tss ?? 0) > 0).map((r) => r.date)).size;
    return withLoad >= 7 ? { state: 'ok' } : withLoad ? { state: 'some', so: `Your data so far: ${plural(withLoad, 'day')} of training. Fitness needs about a week to mean anything.` } : { state: 'none', why: 'Needs recorded activities' };
  },
  tile: (L) => {
    const s = fitnessIn(L), last = s[s.length - 1], ch = last && s[0] ? last.ctl - s[0].ctl : 0;
    const by = new Map(s.map((p) => [p.date, p]));
    return { mini: <Mini label="Your fitness and fatigue over this period" lines={[{ vals: sample((d) => by.get(d)?.atl, L.from, L.to), color: ACC, dash: '4 3' }, { vals: sample((d) => by.get(d)?.ctl, L.from, L.to), color: INK }]} />, figure: last ? `${Math.round(last.ctl)}` : undefined, label: last ? `fitness · ${Math.abs(ch) < 1 ? 'level' : ch > 0 ? `up ${Math.round(ch)}` : `down ${Math.round(-ch)}`} · form ${sg(last.tsb)}` : undefined };
  },
  Page: FitnessPage,
};

// ---------- the power curve ----------

const durWords = (s: number) => (s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : s < 3600 ? `${s / 60} minutes` : s === 3600 ? '1 hour' : `${s / 3600} hours`);

function curveSets(L: LabData) {
  const withW = L.curves.filter((c) => c.w?.length);
  const pick = (a: string, b: string) => withW.filter((c) => c.date >= a && c.date <= b);
  const now = pick(L.from, L.to), pb = periodBefore(L.from, L.to), before = pick(pb.from, pb.to);
  const best = (cs: typeof withW) => (cs.length ? bestCurve(cs.map((c) => c.w)) : []);
  const when = CURVE_SECONDS.map((_, k) => { let m = 0, d = ''; for (const c of now) if ((c.w[k] ?? 0) > m) { m = c.w[k]; d = c.date; } return d; });
  return { now: best(now), before: best(before), all: best(withW), when, rides: now.length, total: withW.length };
}

function PowerPage({ L }: { L: LabData }) {
  const [at, setAt] = useState<number | null>(null);
  const kg = L.profile.weightKg > 0 ? L.profile.weightKg : 0;
  const [perKg, setPerKg] = useState(false);
  const c = useMemo(() => curveSets(L), [L.curves, L.from, L.to]);
  const div = perKg && kg ? kg : 1;
  const pts = (w: number[]) => CURVE_SECONDS.map((s, k) => [s, (w[k] ?? 0) / div] as [number, number]).filter((p) => p[1] > 0);
  const fit = useMemo(() => fitCp(FIT_SECONDS.map((s) => ({ seconds: s, watts: c.now[CURVE_SECONDS.indexOf(s)] ?? 0 })).filter((e) => e.watts > 0)), [c.now]);
  const k = at != null ? CURVE_SECONDS.indexOf(at) : CURVE_SECONDS.indexOf(1200);
  const f = (v?: number) => (v && v > 0 ? (perKg && kg ? `${(v / kg).toFixed(2)} W/kg` : `${Math.round(v)} W`) : '–');
  const i20 = CURVE_SECONDS.indexOf(1200);
  const d20 = (c.now[i20] ?? 0) - (c.before[i20] ?? 0);
  const series: Series[] = [
    { name: 'All time', kind: 'line', pts: pts(c.all), color: DIM, dash: '2 3', width: 1.2 },
    ...(c.before.length ? [{ name: 'The period before', kind: 'line' as const, pts: pts(c.before), color: AQUA, dash: '6 4', width: 1.2 }] : []),
    ...(fit?.ok ? [{ name: 'The line your 2- to 30-minute efforts fit', kind: 'line' as const, pts: [120, 180, 300, 600, 900, 1200, 1800].map((s) => [s, (fit.cp + fit.wPrime / s) / div] as [number, number]), color: ACC, width: 1 }] : []),
    { name: 'This period', kind: 'line', pts: pts(c.now), color: INK, width: 2 },
    { name: 'This period, each length', kind: 'dots', pts: pts(c.now), color: INK, width: 2.4 },
  ];
  const ftp = knownFtp(L.profile);
  return (
    <ChartShell
      lead={c.now[i20] ? <>Your best 20 minutes in {periodWords(L)} is <b>{Math.round(c.now[i20])} W</b>{c.before[i20] ? <>, {Math.abs(d20) < 1 ? 'the same as' : `${Math.round(Math.abs(d20))} W ${d20 > 0 ? 'above' : 'below'}`} the period before</> : null}{c.all[i20] > c.now[i20] ? <>. Your best ever is {Math.round(c.all[i20])} W</> : c.total > c.rides ? <>, your best on record</> : null}.</>
        : <>The best power you held for every length of effort, from one second to two hours, across {plural(c.rides, 'ride')} in {periodWords(L)}.</>}
      readout={<>
        <div class="lc-when">Best {durWords(CURVE_SECONDS[k])}</div>
        <div class="lc-big">{f(c.now[k])}</div>
        <Kv rows={[
          { name: 'Set on', value: c.when[k] ? short(c.when[k]) : '–' },
          { name: 'The period before', value: f(c.before[k]), color: AQUA, dash: '6 4' },
          { name: 'All time', value: f(c.all[k]), color: DIM, dash: '2 3' },
          ...(ftp && c.now[k] ? [{ name: 'Against your FTP', value: `×${(c.now[k] / ftp).toFixed(2)}` }] : []),
        ]} />
        {fit?.ok && <><hr /><Kv rows={[{ name: 'Critical power', value: `${Math.round(fit.cp)} W`, color: ACC }, { name: 'Reserve above it', value: `${(fit.wPrime / 1000).toFixed(1)} kJ` }]} /><p>Fitted to this period’s best 2 to 30 minutes.</p></>}
        {!fit?.ok && c.now.length > 0 && <><hr /><p>No critical-power line is drawn: this period’s best 2- to 30-minute efforts do not fit one, which usually means they were not all-out.</p></>}
      </>}
      legend={<>
        <Legend items={[{ name: 'This period', color: INK }, ...(c.before.length ? [{ name: 'The period before', color: AQUA, dash: '6 4' }] : []), { name: 'All time', color: DIM, dash: '2 3' }, ...(fit?.ok ? [{ name: 'Critical-power line', color: ACC }] : [])]} />
        {kg > 0 && <div class="seg lc-seg" role="radiogroup" aria-label="Show power as"><button role="radio" aria-checked={!perKg} class={!perKg ? 'on' : ''} onClick={() => setPerKg(false)}>Watts</button><button role="radio" aria-checked={perKg} class={perKg ? 'on' : ''} onClick={() => setPerKg(true)}>Watts per kilo</button></div>}
      </>}
      how={<>Left to right is the length of an effort, from one second to two hours; the scale is squeezed so the short efforts have room. The height is the most power you held for that long. The solid line is this period; the dashed lines are the period before and your whole history. Run a finger across to read any length.</>}
      plain={<>Where the solid line sits on the dotted one, this period holds your best on record. Where it sits below, you have been stronger before at that length, or have not gone all-out at it lately.{perKg ? ` Watts per kilo uses the weight in your settings, ${kg} kg.` : ''}</>}
      table={{ name: `Power curve ${L.from} to ${L.to}`, head: ['Length', 'This period (W)', 'Set on', 'Period before (W)', 'All time (W)', ...(kg ? ['This period (W/kg)'] : [])], rows: CURVE_SECONDS.map((s, i) => [CURVE_LABELS[i], Math.round(c.now[i] ?? 0) || '', c.when[i], Math.round(c.before[i] ?? 0) || '', Math.round(c.all[i] ?? 0) || '', ...(kg ? [c.now[i] ? (c.now[i] / kg).toFixed(2) : ''] : [])]) }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <Scope label="Best power for every length of effort" xLog x0={1} x1={7200} xTicks={[[1, '1 s'], [5, '5 s'], [15, '15 s'], [60, '1 min'], [300, '5 min'], [1200, '20 min'], [3600, '1 h'], [7200, '2 h']]} series={series}
        yUnit={perKg && kg ? 'W/kg' : 'W'} yMin={0} snap={CURVE_SECONDS.filter((_, i) => (c.now[i] ?? 0) > 0)} at={at} onAt={(v) => { if (v != null) setAt(v); }} height={300} />
    </ChartShell>
  );
}

export const powerChart: LabChart = {
  id: 'power', name: 'The power curve', about: 'Your best power for every length of effort.', question: 'profile', words: 'mmp best efforts critical power watts per kilo',
  ready: (L) => {
    if (!hasPowerHistory(L.rides)) return { state: 'none', why: 'Needs a power meter' };
    const n = L.curves.filter((c) => c.w?.some((v) => v > 0)).length;
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'ride')} with power` } : { state: 'none', why: L.building ? 'Your rides are still being read' : 'Needs rides with a power meter' };
  },
  tile: (L) => {
    const c = curveSets(L), i20 = CURVE_SECONDS.indexOf(1200);
    const log = (w: number[]) => CURVE_SECONDS.map((_, i) => (w[i] > 0 ? Math.log(w[i]) : null));
    return { mini: <Mini label="Your power curve for this period against all time" lines={[{ vals: log(c.all), color: DIM, dash: '2 3' }, { vals: log(c.now), color: INK }]} />, figure: c.now[i20] ? `${Math.round(c.now[i20])} W` : undefined, label: c.now[i20] ? 'best 20 minutes in this period' : 'no rides with power in this period' };
  },
  Page: PowerPage,
};

// ---------- records ----------

function RecordsPage({ L }: { L: LabData }) {
  const rows = useMemo(() => records(L.curves.filter((c) => c.w?.length), L.from, L.to, L.earliest), [L.curves, L.from, L.to, L.earliest]);
  const news = rows.filter((r) => r.isNew);
  const year = L.to.slice(0, 4);
  return (
    <ChartShell
      lead={news.length ? <>You set <b>{plural(news.length, 'best')} on record</b> in {periodWords(L)}: {news.map((r) => r.label).join(', ')}.</> : <>No bests on record were set in {periodWords(L)}. The bars show how close this period came at each length.</>}
      how={<>One row for each length of effort. The bar is this period’s best as a share of your best on record, which is the full width. The tick on each row is the best of {year}. Press a row to open the ride that set it.</>}
      plain={<>A full bar means this period holds your record at that length; “New” marks one set inside the period. A short bar is not a loss of fitness by itself: it may only mean you have not gone all-out at that length lately.</>}
      table={{ name: `Records ${L.from} to ${L.to}`, head: ['Length', 'This period (W)', 'Set on', `${year} (W)`, 'All time (W)', 'New'], rows: rows.map((r) => [r.label, r.range || '', r.rangeDate ?? '', r.year || '', r.all || '', r.isNew ? 'yes' : '']) }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <div class="lc-recs" role="table" aria-label="Records at six lengths of effort">
        {rows.map((r) => (
          <a key={r.label} class="lc-rec" role="row" href={r.rangeRide ? `#/rides/${r.rangeRide}` : undefined}>
            <span class="lc-rec-l">{r.label}</span>
            <span class="lc-rec-bar" aria-hidden="true">
              <i style={`width:${r.all ? Math.round(r.range / r.all * 100) : 0}%`} />
              {r.all > 0 && r.year > 0 && <u style={`left:${Math.min(100, r.year / r.all * 100)}%`} />}
            </span>
            <span class="lc-rec-v"><b>{r.range ? `${r.range} W` : '–'}</b>{r.isNew && <em>New</em>}<small>{r.rangeDate ? short(r.rangeDate) : 'no effort in this period'} · {year}: {r.year || '–'} · all time: {r.all || '–'}</small></span>
          </a>
        ))}
      </div>
    </ChartShell>
  );
}

export const recordsChart: LabChart = {
  id: 'records', name: 'Records', about: 'Your best at six lengths: this period, this year, all time.', question: 'profile', words: 'peak power bests personal',
  ready: (L) => powerChart.ready(L),
  tile: (L) => {
    const rows = records(L.curves.filter((c) => c.w?.length), L.from, L.to, L.earliest);
    const n = rows.filter((r) => r.isNew).length;
    return { mini: <Mini label="This period’s best at six lengths, as a share of your best on record" bars={{ vals: rows.map((r) => (r.all ? r.range / r.all * 100 : 0)), colors: rows.map((r) => (r.isNew ? 'var(--accent)' : 'var(--ink-3)')) }} />, figure: `${n}`, label: `new ${n === 1 ? 'best' : 'bests'} on record in this period` };
  },
  Page: RecordsPage,
};

// ---------- durability ----------

function DurabilityPage({ L }: { L: LabData }) {
  const [at, setAt] = useState<number | null>(null);
  const [effort, setEffort] = useState<300 | 1200>(1200);
  const pb = periodBefore(L.from, L.to);
  const d = useMemo(() => durability(L.curves, L.from, L.to, effort, pb.from), [L.curves, L.from, L.to, effort]);
  const x = (day: string) => dayN(L.from, day);
  const held = d.rides.map((r) => ({ ...r, share: r.after / r.before * 100 }));
  const mid = held.length ? median(held.map((r) => r.share)) : 0;
  const r = at != null ? held.find((h) => x(h.date) === at) : held[held.length - 1];
  const ride = r ? L.rides.find((q) => q.id === r.id) : undefined;
  const len = effort === 300 ? '5-minute' : '20-minute';
  const kj = L.profile.ftp > 0 ? Math.round(L.profile.ftp * 3.6) : 0;
  return (
    <ChartShell
      lead={held.length >= DURABILITY_MIN_RIDES ? <>Late in a ride you hold <b>{Math.round(mid)}%</b> of your fresh {len} power: the middle of {plural(held.length, 'ride')} in {periodWords(L)}.{d.fadeBefore != null && d.fade != null ? ` Best against best, the fade is ${d.fade}%; in the period before it was ${d.fadeBefore}%.` : ''}</>
        : <>Durability compares your best {len} effort late in a ride with your best before it. {held.length ? `There ${held.length === 1 ? 'is' : 'are'} ${plural(held.length, 'such ride')} in ${periodWords(L)}; a headline figure needs ${DURABILITY_MIN_RIDES}.` : `No ride in ${periodWords(L)} went that far with a ${len} effort on both sides.`}</>}
      readout={r ? <>
        <div class="lc-when">{longDay(r.date)}</div>
        <div class="lc-big">{Math.round(r.share)}% <small>held late</small></div>
        <Kv rows={[{ name: `Best ${len}, fresh`, value: `${r.before} W`, color: DIM, kind: 'ring' }, { name: `Best ${len}, late`, value: `${r.after} W`, color: INK, kind: 'dot' }]} />
        {ride && <p><a href={`#/rides/${ride.id}`}>{ride.name}</a></p>}
      </> : <p>Nothing to read out yet.</p>}
      legend={<>
        <Legend items={[{ name: `Best ${len}, late in the ride`, color: INK, kind: 'dot' }, { name: 'Fresh, earlier the same ride', color: DIM, kind: 'ring' }]} />
        <div class="seg lc-seg" role="radiogroup" aria-label="Length of effort"><button role="radio" aria-checked={effort === 300} class={effort === 300 ? 'on' : ''} onClick={() => setEffort(300)}>5 minutes</button><button role="radio" aria-checked={effort === 1200} class={effort === 1200 ? 'on' : ''} onClick={() => setEffort(1200)}>20 minutes</button></div>
      </>}
      how={<>Each ride that went long enough is a pair of points joined top to bottom: the ring is your best {len} power while fresh, the filled point your best after {kj ? `${kj} kJ of work, an hour’s worth at your FTP` : 'an hour’s worth of work at your FTP'}. The shorter the drop between them, the less you fade.</>}
      plain={<>A rider who holds nine-tenths or more of their fresh power late in a ride fades very little. This counts only rides where you made a hard {len} effort both early and late, so easy long rides do not appear.</>}
      table={{ name: `Durability ${len} ${L.from} to ${L.to}`, head: ['Date', 'Fresh (W)', 'Late (W)', 'Held (%)'], rows: held.map((h) => [h.date, h.before, h.after, h.share.toFixed(0)]).reverse() }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <Scope label={`Best ${len} power fresh and late, ride by ride`} x0={0} x1={dayN(L.from, L.to)} xTicks={dayTicks(L.from, L.to)} yUnit="W"
        series={[
          ...held.map((h) => ({ name: '', kind: 'raw' as const, pts: [[x(h.date), h.before], [x(h.date), h.after]] as Array<[number, number]>, color: INK })),
          { name: 'Fresh', kind: 'dots', pts: held.map((h) => [x(h.date), h.before]), color: DIM, hollow: true, width: 3.4 },
          { name: 'Late', kind: 'dots', pts: held.map((h) => [x(h.date), h.after]), color: INK, width: 3.4 },
        ]}
        snap={held.map((h) => x(h.date))} at={at} onAt={(v) => { if (v != null) setAt(v); }} onPick={() => { if (r) go(`rides/${r.id}`); }} />
    </ChartShell>
  );
}

export const durabilityChart: LabChart = {
  id: 'durability', name: 'Durability', about: 'How well your power holds late in a ride.', question: 'profile', words: 'fatigue resistance fade late stamina',
  ready: (L) => {
    if (!hasPowerHistory(L.rides)) return { state: 'none', why: 'Needs a power meter' };
    const n = L.curves.filter((c) => (c.late?.a20 && c.late?.b20) || (c.late?.a5 && c.late?.b5)).length;
    return n >= DURABILITY_MIN_RIDES ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${n} of ${DURABILITY_MIN_RIDES} long rides with a hard effort early and late` } : { state: 'none', why: L.building ? 'Your rides are still being read' : 'Needs long rides with a hard effort early and late' };
  },
  tile: (L) => {
    const d = durability(L.curves, L.from, L.to, 1200), d5 = durability(L.curves, L.from, L.to, 300);
    const use = d.rides.length >= d5.rides.length ? d : d5;
    const shares = use.rides.map((r) => r.after / r.before * 100);
    return { mini: <Mini label="Share of fresh power held late, ride by ride" bars={{ vals: shares, color: 'var(--ink-2)' }} />, figure: shares.length ? `${Math.round(median(shares))}%` : undefined, label: shares.length ? `of fresh ${use.effort === 300 ? '5' : '20'}-minute power held late · ${plural(shares.length, 'ride')}` : 'no such rides in this period' };
  },
  Page: DurabilityPage,
};
