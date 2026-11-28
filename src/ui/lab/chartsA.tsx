import { useMemo, useState } from 'preact/hooks';
import { addDays } from '../../engine/load';
import { CURVE_LABELS, CURVE_SECONDS, bestCurve, dailyLoad } from '../../engine/progress';
import { DURABILITY_MIN_RIDES, RECORD_EFFORTS, durability, records } from '../../engine/progressMore';
import { fitCp, FIT_SECONDS } from '../../engine/cpFit';
import { formZone, FORM_EDGES, FORM_ZONES } from '../../engine/formZones';
import { hasPowerHistory } from '../../engine/hrRecords';
import { periodBefore, PERIOD_LABEL } from '../../engine/lab';
import { RAMP_WISE, monthlyBests, weeklyGain } from '../../engine/labMore';
import { knownFtp } from '../../engine/known';
import { go } from '../router';
import { findWorkout } from '../store';
import { weekStart } from '../derived';
import { plannedTss, projectFitness } from '../week';
import { useWidth } from '../useWidth';
import { ChartShell, Kv, Legend, Pill, Scope, type Series } from './Scope';
import { C, FORM_C } from './look';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, dayN, dayTicks, longDay, median, plural, sample, sg, short } from './util';

const periodWords = (L: LabData) => (L.period === 'custom' ? 'these dates' : L.period === 'plan' ? 'this plan' : L.period === 'all' ? 'all your history' : `these ${PERIOD_LABEL[L.period]}`);
const formColor = (tsb: number) => FORM_C[FORM_ZONES.indexOf(formZone(tsb))];

// ---------- fitness, fatigue and form: three lanes on one span of days ----------

function fitnessIn(L: LabData) { return L.series.filter((f) => f.date >= L.from && f.date <= L.to); }

function FitnessPage({ L }: { L: LabData }) {
  const [at, setAt] = useState<number | null>(null);
  const s = fitnessIn(L);
  const load = useMemo(() => dailyLoad(L.rides), [L.rides]);
  const x = (d: string) => dayN(L.from, d);
  const first = s[0], last = s[s.length - 1];
  // What the calendar holds from tomorrow, carried forward from today's figures: shown only when the period ends today.
  const ahead = useMemo(() => {
    if (L.to !== L.t || !last) return { proj: [], tss: new Map<string, number>() };
    const span = dayN(L.from, L.to), far = addDays(L.t, Math.max(14, Math.min(84, Math.round(span * 0.3))));
    const lastPlanned = L.data.planned.filter((p) => p.date > L.t && (p.status === 'planned' || p.status === 'sent')).reduce((m, p) => (p.date > m ? p.date : m), '');
    if (!lastPlanned) return { proj: [], tss: new Map<string, number>() };
    const to = lastPlanned < far ? lastPlanned : far;
    const tss = new Map<string, number>();
    for (const p of L.data.planned) { if (p.date <= L.t || p.date > to || !(p.status === 'planned' || p.status === 'sent')) continue; const w = findWorkout(L.data.mine, p.workoutId); if (w) tss.set(p.date, (tss.get(p.date) ?? 0) + plannedTss(w)); }
    return { proj: projectFitness(last, L.data.planned, L.data.mine, to), tss };
  }, [L.data.planned, L.data.mine, L.to, L.t, last?.date, last?.ctl]);
  const proj = ahead.proj;
  const x1 = dayN(L.from, proj.length ? proj[proj.length - 1].date : L.to);
  const z = formZone(last.tsb);
  const all = [...s, ...proj];
  const f = at != null ? all.find((p) => x(p.date) === at) : last;
  const future = !!f && f.date > L.t;
  const fz = f ? formZone(f.tsb) : z;
  const day = f ? load.get(f.date) : undefined;
  const wk = f ? all.find((p) => p.date === addDays(f.date, -7)) ?? L.series.find((p) => p.date === addDays(f.date, -7)) : undefined;
  const peak = s.reduce((m, p) => (p.ctl > m.ctl ? p : m), s[0]), low = s.reduce((m, p) => (p.ctl < m.ctl ? p : m), s[0]);
  const ticks = dayTicks(L.from, addDays(L.from, x1));
  const gains = useMemo(() => weeklyGain(L.series, L.from, L.to, (d) => weekStart(d)), [L.series, L.from, L.to]);
  const lastGain = gains[gains.length - 1];
  const todayRule = proj.length ? [{ x: x(L.t), label: 'Today', color: C.white, dash: '2 3' }] : [];
  const join = (k: 'ctl' | 'atl' | 'tsb') => [[x(last.date), last[k]] as [number, number], ...proj.map((p) => [x(p.date), p[k]] as [number, number])];
  const top: Series[] = [
    { name: 'Training stress, each day', kind: 'bars', pts: s.map((p) => [x(p.date), Math.round(load.get(p.date)?.tss ?? 0)] as [number, number]), color: C.bar, axis: 1, barW: 0.7, opacity: 0.22 },
    ...(proj.length ? [{ name: 'Planned stress', kind: 'bars' as const, pts: proj.map((p) => [x(p.date), Math.round(ahead.tss.get(p.date) ?? 0)] as [number, number]), color: C.grey2, axis: 1 as const, barW: 0.7, opacity: 0.7 }] : []),
    { name: 'Fatigue', kind: 'line', pts: s.map((p) => [x(p.date), p.atl]), color: C.violet, width: 1.1 },
    { name: 'Fitness', kind: 'line', pts: s.map((p) => [x(p.date), p.ctl]), color: C.gold, width: 2.2, glow: true, area: 0.16 },
    ...(proj.length ? [{ name: 'Fatigue, if the plan is ridden', kind: 'line' as const, pts: join('atl'), color: C.violet, width: 1, dash: '3 4' }, { name: 'Fitness, if the plan is ridden', kind: 'line' as const, pts: join('ctl'), color: C.gold, width: 2, dash: '6 5' }] : []),
  ];
  const change = last.ctl - first.ctl;
  const tsbs = all.map((p) => p.tsb), fLo = Math.min(-32, ...tsbs) - 3, fHi = Math.max(14, ...tsbs) + 3;
  return (
    <ChartShell
      context={<>Fitness, fatigue and form · {periodWords(L)}</>}
      lead={<>Fitness is <b>{Math.round(last.ctl)}</b>, {Math.abs(change) < 1 ? 'level' : change > 0 ? `up ${Math.round(change)}` : `down ${Math.round(-change)}`} over {periodWords(L)}. Form is <b style={`color:${formColor(last.tsb)}`}>{sg(last.tsb)}, {z.name.toLowerCase()}</b>: {z.says}.</>}
      readout={f && <>
        <div class="lc-when">{future ? `${longDay(f.date)} · if the plan is ridden` : at == null ? 'Today' : longDay(f.date)}</div>
        <div class="lc-big">{Math.round(f.ctl)} <small>fitness</small></div>
        <Pill color={formColor(f.tsb)}>{fz.name} · form {sg(f.tsb)}</Pill>
        <Kv rows={[
          { name: 'Fitness', value: f.ctl.toFixed(1), color: C.gold },
          { name: 'Fatigue', value: f.atl.toFixed(1), color: C.violet },
          { name: 'Form', value: sg(f.tsb), color: formColor(f.tsb), kind: 'block' },
          { name: future ? 'Planned stress that day' : 'Training stress that day', value: `${Math.round(future ? ahead.tss.get(f.date) ?? 0 : day?.tss ?? 0)} TSS`, color: C.bar, kind: 'block' },
          { name: 'Fitness gained in the 7 days to it', value: wk ? sg(f.ctl - wk.ctl, 1) : '–' },
        ]} />
        {!future && (day?.names.length ? <p>{day.names.join(', ')}</p> : <p>Nothing recorded that day.</p>)}
        <hr /><p>Highest fitness in this period: {Math.round(peak.ctl)}, on {short(peak.date)}. Lowest: {Math.round(low.ctl)}, on {short(low.date)}.</p>
      </>}
      legend={<Legend items={[{ name: 'Fitness', color: C.gold }, { name: 'Fatigue', color: C.violet }, { name: 'Training stress each day (right-hand scale)', color: C.bar, kind: 'block' }, ...(proj.length ? [{ name: 'If the plan is ridden', color: C.gold, dash: '6 5' }] : []), ...FORM_ZONES.map((q, k) => ({ name: q.name, color: FORM_C[k], kind: 'block' as const })).reverse()]} />}
      how={<>Three lanes share one span of days. On top, the gold line is fitness, your average daily training stress over about six weeks; the thin violet line is fatigue, the same over one week; the faint bars are each day’s stress.{proj.length ? ' Right of “Today”, the dashed lines are where both go if the rides on your calendar are ridden as written.' : ''} In the middle, form is fitness less fatigue, coloured by the band it sits in. At the bottom, each bar is the fitness gained or lost in a week; the dashed line marks +{RAMP_WISE}, above which a week is building faster than is wise for long. Run a finger across any lane to read a day in all three.</>}
      plain={<>Fitness climbs when the weeks are steady and falls when they stop. Form below zero is normal while you are building; it is “too much” only when it stays under {FORM_EDGES.much}. A week that adds more than {RAMP_WISE} to fitness is a general sign of building faster than is wise for long.</>}
      tiles={[
        { name: 'Fitness', value: Math.round(last.ctl), note: `${Math.abs(change) < 1 ? 'level' : sg(change)} over ${periodWords(L)}`, color: C.gold },
        { name: 'Fatigue', value: Math.round(last.atl), note: 'the last week’s average daily stress', color: C.violet },
        { name: 'Form', value: sg(last.tsb), note: z.name, color: formColor(last.tsb) },
        ...(lastGain ? [{ name: 'Gained this week', value: sg(lastGain.gain, 1), note: lastGain.gain > RAMP_WISE ? `above +${RAMP_WISE}: more than is wise for long` : lastGain.gain < 0 ? 'fitness is falling' : 'a steady build', color: lastGain.gain > RAMP_WISE ? C.vo2 : lastGain.gain < 0 ? C.grey : C.good }] : []),
      ]}
      table={{ name: `Fitness fatigue form ${L.from} to ${L.to}`, head: ['Date', 'Fitness', 'Fatigue', 'Form', 'Stress (TSS)'], rows: s.map((p) => [p.date, p.ctl.toFixed(1), p.atl.toFixed(1), p.tsb.toFixed(1), Math.round(load.get(p.date)?.tss ?? 0)]).reverse() }}
      question={{ id: 'fitter', ask: 'Am I getting fitter?' }}
    >
      <Scope title="Fitness and fatigue" label="Fitness and fatigue, with each day’s training stress behind" x0={0} x1={x1} xTicks={ticks} series={top} y2Unit="TSS" yMin={0} y2Min={0} rules={todayRule}
        snap={all.map((p) => x(p.date))} at={at} onAt={setAt} onPick={(v) => { const d = addDays(L.from, v); if (load.get(d)?.names.length) go(`calendar?d=${d}`); }} />
      <Scope title="Form" label="Form, coloured by its named band" height={170} x0={0} x1={x1} xTicks={ticks} yMin={fLo} yMax={fHi}
        series={[{ name: 'Form', kind: 'line', pts: s.map((p) => [x(p.date), p.tsb]), color: C.white, width: 2.2, colorAt: (y) => formColor(y) }, ...(proj.length ? [{ name: 'Form, if the plan is ridden', kind: 'line' as const, pts: join('tsb'), color: C.grey, width: 1.6, dash: '5 4' }] : [])]}
        bands={[{ y0: fLo, y1: FORM_EDGES.much, color: FORM_C[0], label: 'Too much', opacity: 0.13 }, { y0: FORM_EDGES.much, y1: FORM_EDGES.building, color: FORM_C[1], label: 'Building', opacity: 0.11 }, { y0: FORM_EDGES.building, y1: FORM_EDGES.fresh, color: FORM_C[2], label: 'Balanced', opacity: 0.12 }, { y0: FORM_EDGES.fresh, y1: fHi, color: FORM_C[3], label: 'Fresh', opacity: 0.12 }]}
        rules={todayRule.map((r) => ({ ...r, label: undefined }))} snap={all.map((p) => x(p.date))} at={at} onAt={setAt} yFmt={(v) => sg(v)} />
      {gains.length > 1 && <Scope title="Fitness gained each week" label="Fitness gained or lost each week" height={140} x0={0} x1={x1} xTicks={ticks}
        series={[{ name: 'Gained in the week', kind: 'bars', pts: gains.map((g) => [x(g.start) + 3, g.gain] as [number, number]), color: C.good, barW: 5, opacity: 0.9, colorAt: (y) => (y > RAMP_WISE ? C.vo2 : y < 0 ? C.grey : C.good) }]}
        rules={[{ y: RAMP_WISE, color: C.vo2, dash: '3 4' }, { y: 0, color: C.grey2, dash: '0' }, ...todayRule.map((r) => ({ ...r, label: undefined }))]} yFmt={(v) => sg(v)} />}
    </ChartShell>
  );
}

export const fitnessChart: LabChart = {
  id: 'fitness', name: 'Fitness, fatigue and form', about: 'How much training you carry, and how fresh you are.', question: 'fitter', words: 'ctl atl tsb load pmc ramp projection plan',
  ready: (L) => {
    const withLoad = new Set(L.rides.filter((r) => (r.tss ?? 0) > 0).map((r) => r.date)).size;
    return withLoad >= 7 ? { state: 'ok' } : withLoad ? { state: 'some', so: `Your data so far: ${plural(withLoad, 'day')} of training. Fitness needs about a week to mean anything.` } : { state: 'none', why: 'Needs recorded activities' };
  },
  tile: (L) => {
    const s = fitnessIn(L), last = s[s.length - 1], ch = last && s[0] ? last.ctl - s[0].ctl : 0;
    const by = new Map(s.map((p) => [p.date, p]));
    return { mini: <Mini label="Your fitness and fatigue over this period" lines={[{ vals: sample((d) => by.get(d)?.atl, L.from, L.to), color: C.violet, width: 1 }, { vals: sample((d) => by.get(d)?.ctl, L.from, L.to), color: C.gold, area: true, width: 2 }]} />, figure: last ? `${Math.round(last.ctl)}` : undefined, label: last ? `fitness · ${Math.abs(ch) < 1 ? 'level' : ch > 0 ? `up ${Math.round(ch)}` : `down ${Math.round(-ch)}`} · form ${sg(last.tsb)}` : undefined };
  },
  Page: FitnessPage,
};

// ---------- the power curve ----------

const durWords = (s: number) => (s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : s < 3600 ? `${s / 60} minutes` : s === 3600 ? '1 hour' : `${s / 3600} hours`);
/** The kinds of effort along the curve, by length: general names, the same for every rider. */
const EFFORT_BANDS = [
  { x0: 1, x1: 15, label: 'Sprint', color: C.sprint }, { x0: 15, x1: 120, label: 'Short and hard', color: C.vo2 }, { x0: 120, x1: 480, label: 'VO2max', color: C.thr },
  { x0: 480, x1: 2400, label: 'Threshold', color: C.tempo }, { x0: 2400, x1: 7200, label: 'Endurance', color: C.end },
];
const CURVE_STOPS: Array<[number, string]> = [[1, C.sprint], [8, C.sprint], [45, C.vo2], [240, C.thr], [1100, C.tempo], [4200, C.end], [7200, C.end]];

function curveSets(L: LabData) {
  const withW = L.curves.filter((c) => c.w?.length);
  const pick = (a: string, b: string) => withW.filter((c) => c.date >= a && c.date <= b);
  const now = pick(L.from, L.to), pb = periodBefore(L.from, L.to), before = pick(pb.from, pb.to);
  const best = (cs: typeof withW) => (cs.length ? bestCurve(cs.map((c) => c.w)) : []);
  const when = CURVE_SECONDS.map((_, k) => { let m = 0, d = ''; for (const c of now) if ((c.w[k] ?? 0) > m) { m = c.w[k]; d = c.date; } return d; });
  return { now: best(now), before: best(before), all: best(withW), when, rides: now.length, total: withW.length };
}

/** How recently each best of the period was set: a cell under each length, gold when new, dim when old. */
function Recency({ when, to, from }: { when: string[]; to: string; from: string }) {
  const [ref, W] = useWidth<HTMLDivElement>(720);
  const padL = 46, pw = Math.max(10, W - padL - 12), span = Math.max(1, dayN(from, to));
  const X = (v: number) => padL + (Math.log(v) - Math.log(1)) / (Math.log(7200) - Math.log(1)) * pw;
  const cells = CURVE_SECONDS.map((sec, k) => ({ sec, k, d: when[k] })).filter((c) => c.d);
  return (
    <div ref={ref} class="sc">
      <svg width={W} height={46} viewBox={`0 0 ${W} 46`} role="img" aria-label="How recently each best was set">
        <text class="sc-title" x={padL} y={10}>How recently each best was set</text>
        {cells.map((c) => {
          const a = c.k ? Math.sqrt(CURVE_SECONDS[c.k - 1] * c.sec) : 1, b = c.k < CURVE_SECONDS.length - 1 ? Math.sqrt(c.sec * CURVE_SECONDS[c.k + 1]) : 7200;
          const age = dayN(c.d, to), fresh = 1 - Math.min(1, age / span), wk = Math.round(age / 7);
          const wide = X(b) - X(a);
          return <g key={c.sec}><rect x={X(a) + 1.5} width={Math.max(2, wide - 3)} y={16} height={24} rx="6" fill={C.gold} opacity={0.14 + 0.8 * fresh} /><title>{`${CURVE_LABELS[c.k]}: set ${short(c.d)}`}</title>
            {wide > 34 && <text class="sc-num" x={(X(a) + X(b)) / 2} y={32} text-anchor="middle" style={`fill:${fresh > 0.55 ? '#14100A' : 'var(--ink)'};font-weight:600`}>{wk < 1 ? 'this week' : `${wk} wk`}</text>}</g>;
        })}
      </svg>
    </div>
  );
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
  const sec = CURVE_SECONDS[k];
  const f = (v?: number) => (v && v > 0 ? (perKg && kg ? `${(v / kg).toFixed(2)} W/kg` : `${Math.round(v)} W`) : '–');
  const i20 = CURVE_SECONDS.indexOf(1200), i5s = CURVE_SECONDS.indexOf(5);
  const d20 = (c.now[i20] ?? 0) - (c.before[i20] ?? 0);
  const model = (s: number) => (fit?.ok ? fit.cp + fit.wPrime / s : 0);
  // Where this period sits furthest below the line its own best efforts fit: the length most worth testing.
  const short3 = fit?.ok ? FIT_SECONDS.map((s) => ({ s, now: c.now[CURVE_SECONDS.indexOf(s)] ?? 0, off: (c.now[CURVE_SECONDS.indexOf(s)] ?? 0) / model(s) - 1 })).filter((q) => q.now > 0 && q.off <= -0.03).sort((a, b) => a.off - b.off)[0] : undefined;
  const inModel = fit?.ok && sec >= 120 && sec <= 1800;
  const offAt = inModel && c.now[k] ? c.now[k] / model(sec) - 1 : undefined;
  const vsBefore = c.now[k] && c.before[k] ? c.now[k] / c.before[k] - 1 : undefined;
  const nowPts = pts(c.now);
  const lowest = Math.min(...[...nowPts, ...pts(c.before), ...pts(c.all)].map((q) => q[1]));
  const series: Series[] = [
    { name: 'All time', kind: 'line', pts: pts(c.all), color: C.grey2, width: 1.6, smooth: true },
    ...(c.before.length ? [{ name: 'The period before', kind: 'line' as const, pts: pts(c.before), color: C.grey, width: 1.6, smooth: true }] : []),
    ...(fit?.ok ? [{ name: 'What your best efforts predict', kind: 'line' as const, pts: [120, 180, 300, 450, 600, 900, 1200, 1800].map((s) => [s, model(s) / div] as [number, number]), color: C.white, width: 1.4, dash: '1 5', smooth: true }] : []),
    { name: 'This period', kind: 'line', pts: nowPts, color: C.gold, width: 3.5, smooth: true, glow: true, area: 0.16, stops: CURVE_STOPS },
  ];
  const ftp = knownFtp(L.profile);
  return (
    <ChartShell
      context={<>The power curve · {plural(c.rides, 'ride')} with power in {periodWords(L)}</>}
      lead={c.now[i20] ? <>Your best 20 minutes is <b>{Math.round(c.now[i20])} W</b>{c.before[i20] ? <>, {Math.abs(d20) < 1 ? 'the same as' : `${Math.round(Math.abs(d20))} W ${d20 > 0 ? 'above' : 'below'}`} the period before</> : null}{c.all[i20] > c.now[i20] ? <>. Your best ever is {Math.round(c.all[i20])} W</> : c.total > c.rides ? <>, your best on record</> : null}.{short3 ? <> Your {durWords(short3.s)} best sits below what your other efforts predict.</> : null}</>
        : <>The best power you held for every length of effort, from one second to two hours, across {plural(c.rides, 'ride')} in {periodWords(L)}.</>}
      readout={<>
        <div class="lc-when">Best {durWords(sec)}</div>
        <div class="lc-big">{f(c.now[k])}</div>
        {vsBefore != null && <Pill color={vsBefore >= 0 ? C.good : C.watch}>{Math.abs(vsBefore) < 0.0005 ? 'Level with the period before' : `${vsBefore >= 0 ? '▲' : '▼'} ${Math.abs(vsBefore * 100).toFixed(1)}% on the period before`}</Pill>}
        <Kv rows={[
          { name: 'The period before', value: f(c.before[k]), color: C.grey },
          { name: 'All time', value: f(c.all[k]), color: C.grey2 },
          ...(inModel ? [{ name: 'Predicted by your best efforts', value: f(model(sec)), color: C.white, dash: '1 4' }] : []),
          ...(offAt != null ? [{ name: 'Against that prediction', value: `${sg(offAt * 100, 1)}%` }] : []),
          { name: 'Set on', value: c.when[k] ? short(c.when[k]) : '–' },
          ...(ftp && c.now[k] ? [{ name: 'Against your FTP', value: `×${(c.now[k] / ftp).toFixed(2)}` }] : []),
        ]} />
        {offAt != null && offAt <= -0.03 && <p><b style={`color:${C.watch}`}>Worth testing.</b> This length sits below the line your other efforts fit, which usually means you have not gone all-out at it lately.</p>}
        {!fit?.ok && c.now.length > 0 && <p>No prediction line is drawn: this period’s best 2- to 30-minute efforts do not fit one, which usually means they were not all-out.</p>}
      </>}
      legend={<>
        <Legend items={[{ name: 'This period, coloured by the kind of effort', color: C.vo2 }, ...(c.before.length ? [{ name: 'The period before', color: C.grey }] : []), { name: 'All time', color: C.grey2 }, ...(fit?.ok ? [{ name: 'What your best 2- to 30-minute efforts predict', color: C.white, dash: '1 4' }] : [])]} />
        {kg > 0 && <div class="seg lc-seg" role="radiogroup" aria-label="Show power as"><button role="radio" aria-checked={!perKg} class={!perKg ? 'on' : ''} onClick={() => setPerKg(false)}>Watts</button><button role="radio" aria-checked={perKg} class={perKg ? 'on' : ''} onClick={() => setPerKg(true)}>Watts per kilo</button></div>}
      </>}
      how={<>Left to right is the length of an effort, from one second to two hours; both scales are squeezed so the short efforts have room. The height is the most power you held for that long. The coloured line is this period, its colour following the kind of effort named along the top; the grey lines are the period before and your whole history. The dotted line is what your best 2- to 30-minute efforts predict for the lengths between. The strip beneath shows how long ago each best was set. Run a finger across to read any length.</>}
      plain={<>Where the coloured line sits on the grey ones, this period holds your best on record. Where it dips under the dotted line, you have probably not gone all-out at that length lately. A dim cell in the strip is an old best: it may be out of date.{perKg ? ` Watts per kilo uses the weight in your settings, ${kg} kg.` : ''}</>}
      tiles={[
        ...(c.now[i5s] ? [{ name: 'Sprint · best 5 seconds', value: f(c.now[i5s]), note: c.when[i5s] ? `set ${short(c.when[i5s])}` : undefined, color: C.sprint }] : []),
        ...(fit?.ok ? [{ name: 'Critical power', value: f(fit.cp), note: 'what you could hold for a long time', color: C.tempo }, { name: 'Reserve above it', value: `${(fit.wPrime / 1000).toFixed(1)} kJ`, note: 'work you can do above critical power', color: C.vo2 }] : []),
        ...(ftp ? [{ name: 'Your FTP', value: f(ftp), note: 'as set in your profile', color: C.end }] : []),
      ]}
      table={{ name: `Power curve ${L.from} to ${L.to}`, head: ['Length', 'This period (W)', 'Set on', 'Period before (W)', 'All time (W)', ...(kg ? ['This period (W/kg)'] : [])], rows: CURVE_SECONDS.map((s, i) => [CURVE_LABELS[i], Math.round(c.now[i] ?? 0) || '', c.when[i], Math.round(c.before[i] ?? 0) || '', Math.round(c.all[i] ?? 0) || '', ...(kg ? [c.now[i] ? (c.now[i] / kg).toFixed(2) : ''] : [])]) }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <Scope label="Best power for every length of effort" xLog yLog x0={1} x1={7200} xTicks={[[1, '1 s'], [5, '5 s'], [15, '15 s'], [60, '1 min'], [300, '5 min'], [1200, '20 min'], [3600, '1 h'], [7200, '2 h']]} series={series} strip={EFFORT_BANDS}
        yUnit={perKg && kg ? 'W/kg' : 'W'} yMin={isFinite(lowest) ? lowest * 0.82 : undefined} snap={CURVE_SECONDS.filter((_, i) => (c.now[i] ?? 0) > 0)} at={at} onAt={(v) => { if (v != null) setAt(v); }} height={360}
        notes={short3 ? [{ x: short3.s, y: short3.now / div, text: 'Below what your other efforts predict', color: C.watch }] : []} />
      <Recency when={c.when} from={L.from} to={L.to} />
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
    return { mini: <Mini label="Your power curve for this period against all time" lines={[{ vals: log(c.all), color: C.grey2 }, { vals: log(c.now), color: C.gold, width: 2.4, rainbow: [C.sprint, C.vo2, C.thr, C.tempo, C.end], area: true }]} />, figure: c.now[i20] ? `${Math.round(c.now[i20])} W` : undefined, label: c.now[i20] ? 'best 20 minutes in this period' : 'no rides with power in this period' };
  },
  Page: PowerPage,
};

// ---------- records: six lengths, month by month ----------

function RecordsPage({ L }: { L: LabData }) {
  const curves = useMemo(() => L.curves.filter((c) => c.w?.length), [L.curves]);
  const rows = useMemo(() => records(curves, L.from, L.to, L.earliest), [curves, L.from, L.to, L.earliest]);
  const months = useMemo(() => {
    const first = curves.reduce((m, c) => (c.date < m ? c.date : m), L.t).slice(0, 7), out: string[] = [];
    let y = +L.t.slice(0, 4), m = +L.t.slice(5, 7);
    for (let k = 0; k < 36; k++) { const id = `${y}-${String(m).padStart(2, '0')}`; out.unshift(id); if (id <= first) break; m -= 1; if (!m) { m = 12; y -= 1; } }
    return out;
  }, [curves, L.t]);
  const lanes = useMemo(() => RECORD_EFFORTS.map((e) => ({ e, by: new Map(monthlyBests(curves, e.idx).map((b) => [b.month, b])) })), [curves]);
  const [at, setAt] = useState<{ row: number; month: string } | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>(820);
  const narrow = W < 560;
  const padL = 58, padR = narrow ? 8 : 250, padT = 22, rowH = 62, H = padT + rowH * lanes.length + 22;
  const pw = Math.max(10, W - padL - padR);
  const X = (k: number) => padL + (months.length > 1 ? k / (months.length - 1) : 0.5) * pw;
  const news = rows.filter((r) => r.isNew);
  const move = (e: PointerEvent) => {
    const box = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width * W, py = (e.clientY - box.top) / box.height * H;
    const row = Math.max(0, Math.min(lanes.length - 1, Math.floor((py - padT) / rowH)));
    const k = Math.max(0, Math.min(months.length - 1, Math.round((px - padL) / pw * (months.length - 1))));
    setAt({ row, month: months[k] });
  };
  const sel = at ?? { row: 4, month: months[months.length - 1] };
  const selLane = lanes[sel.row], selB = selLane.by.get(sel.month), selAll = rows[sel.row].all;
  const monthName = (m: string) => new Date(`${m}-15T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <ChartShell
      context={<>Records · six lengths of effort, month by month, over {months.length > 1 ? plural(months.length, 'month') : 'your history'}</>}
      lead={news.length ? <>You set <b>{plural(news.length, 'best')} on record</b> in {periodWords(L)}: {news.map((r) => r.label).join(', ')}.</> : <>No bests on record in {periodWords(L)}. The gold points show when each of your records was set.</>}
      readout={<>
        <div class="lc-when">{selLane.e.label} · {monthName(sel.month)}</div>
        <div class="lc-big">{selB ? `${Math.round(selB.best)} W` : '–'}</div>
        {selB && <Pill color={selB.record ? C.gold : selB.best >= selAll ? C.gold : C.grey}>{selB.record || selB.best >= selAll ? 'A record' : `${((1 - selB.best / selAll) * 100).toFixed(1)}% off your best`}</Pill>}
        <Kv rows={[{ name: 'Best ever', value: selAll ? `${selAll} W` : '–', color: C.white, dash: '1 4' }, { name: 'Best in this period', value: rows[sel.row].range ? `${rows[sel.row].range} W` : '–', color: C.gold, kind: 'dot' }, { name: 'Set on', value: selB ? short(selB.date) : '–' }]} />
        {selB ? <p><a href={`#/rides/${selB.id}`}>Open the ride that set it</a></p> : <p>No effort of this length that month.</p>}
      </>}
      legend={<Legend items={[{ name: 'Best of each month', color: C.grey, kind: 'dot' }, { name: 'A record when it was set', color: C.gold, kind: 'dot' }, { name: 'Your best ever', color: C.white, dash: '1 4' }]} />}
      how={<>One row for each length of effort; left to right is time, a point for the best of each month. A gold point is a month in which you beat everything before it. The dotted line across each row is your best ever at that length. Each row has its own scale, so read a row against its own dotted line and not against the row above.{narrow ? '' : ' The columns on the right give the figures.'}</>}
      plain={<>Gold points close to the right-hand edge mean you are setting records now. A row whose recent points sit well under its dotted line is a length you have been stronger at, or have not gone all-out at lately.</>}
      table={{ name: `Records ${L.from} to ${L.to}`, head: ['Length', 'This period (W)', 'Set on', `${L.to.slice(0, 4)} (W)`, 'All time (W)', 'New'], rows: rows.map((r) => [r.label, r.range || '', r.rangeDate ?? '', r.year || '', r.all || '', r.isNew ? 'yes' : '']) }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <div ref={ref} class="sc">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Your best at six lengths of effort, month by month" style="touch-action:pan-y" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setAt(null)}>
          {!narrow && <g class="sc-num"><text x={W - 170} y={12} text-anchor="end">Best ever</text><text x={W - 78} y={12} text-anchor="end">This period</text><text x={W - 4} y={12} text-anchor="end">Set</text></g>}
          {months.map((m, k) => m.endsWith('-01') || k === 0 ? <g key={m}><line class="sc-grid" x1={X(k)} x2={X(k)} y1={padT} y2={H - 20} /><text class="sc-num" x={X(k)} y={H - 6} text-anchor="middle">{m.endsWith('-01') ? m.slice(0, 4) : new Date(`${m}-15T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</text></g> : null)}
          {lanes.map((lane, r) => {
            const y0 = padT + r * rowH, vals = months.map((m) => lane.by.get(m)), have = vals.filter(Boolean) as Array<NonNullable<typeof vals[number]>>;
            const hi = Math.max(1, ...have.map((b) => b.best)), lo = Math.min(hi, ...have.map((b) => b.best));
            const Y = (v: number) => y0 + rowH - 12 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (rowH - 26);
            const line = vals.map((b, k) => (b ? [X(k), Y(b.best)] as [number, number] : null)).filter(Boolean) as Array<[number, number]>;
            const row = rows[r], off = row.all && row.range ? (1 - row.range / row.all) * 100 : undefined;
            return <g key={lane.e.label}>
              <line x1={padL} x2={padL + pw} y1={y0 + rowH} y2={y0 + rowH} stroke="var(--lc-edge)" />
              <text x={padL - 10} y={y0 + rowH / 2 + 4} text-anchor="end" style="fill:var(--ink);font:600 13px var(--font)">{lane.e.label}</text>
              {have.length > 0 && <line x1={padL} x2={padL + pw} y1={Y(hi)} y2={Y(hi)} stroke={C.white} stroke-width="1" stroke-dasharray="1 4" opacity="0.7" />}
              <path d={line.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')} fill="none" stroke={C.grey} stroke-width="1.2" opacity="0.8" />
              {vals.map((b, k) => b && <circle key={k} cx={X(k)} cy={Y(b.best)} r={b.record ? 4.6 : 2} fill={b.record ? C.gold : C.grey} filter={b.record ? 'drop-shadow(0 0 4px var(--lc-gold))' : undefined} />)}
              {sel.row === r && lane.by.get(sel.month) && <circle cx={X(months.indexOf(sel.month))} cy={Y(lane.by.get(sel.month)!.best)} r="5.5" fill="none" stroke={C.white} stroke-width="1.5" />}
              {!narrow && <g style="font:600 13px var(--font)"><text x={W - 170} y={y0 + rowH / 2 + 4} text-anchor="end" style="fill:var(--ink)">{row.all ? `${row.all} W` : '–'}</text>
                <text x={W - 78} y={y0 + rowH / 2 + 4} text-anchor="end" style={`fill:${row.isNew || off === 0 ? C.gold : 'var(--ink-2)'}`}>{off == null ? '–' : row.isNew || off < 0.05 ? 'a record' : `${off.toFixed(1)}% off`}</text>
                <text x={W - 4} y={y0 + rowH / 2 + 4} text-anchor="end" style="fill:var(--ink-3);font-weight:500;font-size:12px">{row.rangeDate ? short(row.rangeDate) : '–'}</text></g>}
            </g>;
          })}
          {at && <line class="sc-cross" x1={X(months.indexOf(at.month))} x2={X(months.indexOf(at.month))} y1={padT} y2={H - 20} />}
        </svg>
      </div>
    </ChartShell>
  );
}

export const recordsChart: LabChart = {
  id: 'records', name: 'Records', about: 'Your best at six lengths, month by month.', question: 'profile', words: 'peak power bests personal',
  ready: (L) => powerChart.ready(L),
  tile: (L) => {
    const rows = records(L.curves.filter((c) => c.w?.length), L.from, L.to, L.earliest);
    const n = rows.filter((r) => r.isNew).length;
    return { mini: <Mini label="This period’s best at six lengths, as a share of your best on record" bars={{ vals: rows.map((r) => (r.all ? r.range / r.all * 100 : 0)), colors: rows.map((r) => (r.isNew ? C.gold : C.grey2)) }} />, figure: `${n}`, label: `new ${n === 1 ? 'best' : 'bests'} on record in this period` };
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
      context={<>Durability · {periodWords(L)}</>}
      lead={held.length >= DURABILITY_MIN_RIDES ? <>Late in a ride you hold <b>{Math.round(mid)}%</b> of your fresh {len} power: the middle of {plural(held.length, 'ride')} in {periodWords(L)}.{d.fadeBefore != null && d.fade != null ? ` Best against best, the fade is ${d.fade}%; in the period before it was ${d.fadeBefore}%.` : ''}</>
        : <>Durability compares your best {len} effort late in a ride with your best before it. {held.length ? `There ${held.length === 1 ? 'is' : 'are'} ${plural(held.length, 'such ride')} in ${periodWords(L)}; a headline figure needs ${DURABILITY_MIN_RIDES}.` : `No ride in ${periodWords(L)} went that far with a ${len} effort on both sides.`}</>}
      readout={r ? <>
        <div class="lc-when">{longDay(r.date)}</div>
        <div class="lc-big">{Math.round(r.share)}% <small>held late</small></div>
        <Kv rows={[{ name: `Best ${len}, fresh`, value: `${r.before} W`, color: C.grey, kind: 'ring' }, { name: `Best ${len}, late`, value: `${r.after} W`, color: C.gold, kind: 'dot' }]} />
        {ride && <p><a href={`#/rides/${ride.id}`}>{ride.name}</a></p>}
      </> : <p>Nothing to read out yet.</p>}
      legend={<>
        <Legend items={[{ name: `Best ${len}, late in the ride`, color: C.gold, kind: 'dot' }, { name: 'Fresh, earlier the same ride', color: C.grey, kind: 'ring' }]} />
        <div class="seg lc-seg" role="radiogroup" aria-label="Length of effort"><button role="radio" aria-checked={effort === 300} class={effort === 300 ? 'on' : ''} onClick={() => setEffort(300)}>5 minutes</button><button role="radio" aria-checked={effort === 1200} class={effort === 1200 ? 'on' : ''} onClick={() => setEffort(1200)}>20 minutes</button></div>
      </>}
      how={<>Each ride that went long enough is a pair of points joined top to bottom: the ring is your best {len} power while fresh, the filled point your best after {kj ? `${kj} kJ of work, an hour’s worth at your FTP` : 'an hour’s worth of work at your FTP'}. The shorter the drop between them, the less you fade.</>}
      plain={<>A rider who holds nine-tenths or more of their fresh power late in a ride fades very little. This counts only rides where you made a hard {len} effort both early and late, so easy long rides do not appear.</>}
      table={{ name: `Durability ${len} ${L.from} to ${L.to}`, head: ['Date', 'Fresh (W)', 'Late (W)', 'Held (%)'], rows: held.map((h) => [h.date, h.before, h.after, h.share.toFixed(0)]).reverse() }}
      question={{ id: 'profile', ask: 'What am I good at, and what holds me back?' }}
    >
      <Scope label={`Best ${len} power fresh and late, ride by ride`} x0={0} x1={dayN(L.from, L.to)} xTicks={dayTicks(L.from, L.to)} yUnit="W"
        series={[
          ...held.map((h) => ({ name: '', kind: 'raw' as const, pts: [[x(h.date), h.before], [x(h.date), h.after]] as Array<[number, number]>, color: C.grey })),
          { name: 'Fresh', kind: 'dots', pts: held.map((h) => [x(h.date), h.before]), color: C.grey, hollow: true, width: 3.4 },
          { name: 'Late', kind: 'dots', pts: held.map((h) => [x(h.date), h.after]), color: C.gold, width: 4, colorAt: (y, xx) => { const h = held.find((q) => x(q.date) === xx); return h && h.share >= 90 ? C.good : C.gold; } },
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
    return { mini: <Mini label="Share of fresh power held late, ride by ride" bars={{ vals: shares, colors: shares.map((v) => (v >= 90 ? C.good : C.gold)) }} />, figure: shares.length ? `${Math.round(median(shares))}%` : undefined, label: shares.length ? `of fresh ${use.effort === 300 ? '5' : '20'}-minute power held late · ${plural(shares.length, 'ride')}` : 'no such rides in this period' };
  },
  Page: DurabilityPage,
};
