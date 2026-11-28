import { useEffect, useMemo, useState } from 'preact/hooks';
import { addDays } from '../../engine/load';
import { inRange } from '../../engine/measures';
import { PERIOD_LABEL, readings } from '../../engine/lab';
import type { Ride } from '../../engine/types';
import type { StreamSet } from '../../data/db';
import { cachedRecording, corrected, recordingOf } from '../../sync/ownService';
import { fetchPowerStream } from '../../sync/intervals';
import { credentials } from '../../sync/syncService';
import { weekStart } from '../derived';
import { ZONE_VAR } from '../Profile';
import { go } from '../router';
import { ChartShell, Kv, Legend, Scope, type Series } from './Scope';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, dayN, dayTicks, hm, longDay, mean, plural, sg, short } from './util';

const INK = 'var(--ink)', MID = 'var(--ink-2)';
const periodWords = (L: LabData) => (L.period === 'custom' ? 'these dates' : L.period === 'plan' ? 'this plan' : L.period === 'all' ? 'all your history' : `these ${PERIOD_LABEL[L.period]}`);

// ---------- heart rate in full ----------

function hrWeeks(L: LabData) {
  const out = new Map<string, number[]>();
  for (let w = weekStart(L.from); w <= L.to; w = addDays(w, 7)) out.set(w, [0, 0, 0, 0, 0, 0, 0]);
  for (const r of L.rides) { if (r.date < L.from || r.date > L.to || !r.hrZoneSeconds?.length) continue; const row = out.get(weekStart(r.date)); if (row) r.hrZoneSeconds.forEach((s, z) => { row[Math.min(6, z)] += s ?? 0; }); }
  return [...out.entries()].map(([start, seconds]) => ({ start, seconds }));
}
/** The band of FTP most of the rider's rides have heart rate for: the one with the most rides in the period. */
function bestBand(L: LabData) {
  const count = new Map<string, number>();
  for (const c of L.curves) if (c.date >= L.from && c.date <= L.to) for (const b of c.hrAtPower ?? []) count.set(`${b.lo}-${b.hi}`, (count.get(`${b.lo}-${b.hi}`) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 3) return undefined;
  const [lo, hi] = top[0].split('-').map(Number);
  const pts = L.curves.filter((c) => c.date >= L.from && c.date <= L.to).map((c) => { const b = c.hrAtPower?.find((q) => q.lo === lo && q.hi === hi); return b ? { date: c.date, hr: b.hr, id: c.id } : null; }).filter((p): p is { date: string; hr: number; id: string } => !!p).sort((a, b) => a.date.localeCompare(b.date));
  return { lo, hi, pts };
}

function HeartPage({ L }: { L: LabData }) {
  const M = L.measures;
  const [at, setAt] = useState<number | null>(null);
  const weeks = useMemo(() => hrWeeks(L), [L.rides, L.from, L.to]);
  const nz = Math.max(1, ...L.rides.map((r) => r.hrZoneSeconds?.length ?? 0));
  const band = useMemo(() => bestBand(L), [L.curves, L.from, L.to]);
  const x = (d: string) => dayN(L.from, d);
  const ticks = dayTicks(L.from, L.to);
  const avg = inRange(M.values('avgHr'), L.from, L.to), peak = inRange(M.values('hr30'), L.from, L.to), mx = inRange(M.values('maxHr'), L.from, L.to);
  const top = peak.length ? peak : mx;
  const hi = top.reduce((m, p) => (p[1] > m[1] ? p : m), top[0] ?? ['', 0]);
  const tot = [0, 0, 0, 0, 0, 0, 0];
  for (const w of weeks) w.seconds.forEach((s, z) => { tot[z] += s; });
  const all = tot.reduce((a, b) => a + b, 0);
  const d = at != null ? addDays(L.from, at) : undefined;
  const wk = d ? weeks.find((w) => w.start === weekStart(d)) : undefined;
  const half = band && band.pts.length >= 6 ? Math.floor(band.pts.length / 2) : 0;
  const early = half ? mean(band!.pts.slice(0, half).map((p) => p.hr)) : 0, late = half ? mean(band!.pts.slice(half).map((p) => p.hr)) : 0;
  const rides = d ? L.rides.filter((r) => r.date === d && r.averageHr) : [];
  return (
    <ChartShell
      lead={all ? <>Over {periodWords(L)} your heart spent <b>{Math.round((tot[0] + tot[1]) / all * 100)}%</b> of its recorded time in zones 1 and 2{hi[1] ? <>, and reached <b>{Math.round(hi[1])} bpm</b>{peak.length ? ' for thirty seconds' : ''} on {short(hi[0])}</> : null}.{half ? ` At ${Math.round(band!.lo * 100)} to ${Math.round(band!.hi * 100)}% of FTP it averaged ${Math.round(early)} bpm in the first half of the period and ${Math.round(late)} in the second.` : ''}</>
        : <>Heart rate on your rides over {periodWords(L)}.</>}
      readout={d ? <>
        <div class="lc-when">{longDay(d)}</div>
        {rides.length ? <Kv rows={rides.flatMap((r) => [{ name: r.name, value: `${Math.round(r.averageHr!)} bpm avg` }, ...(r.maxHr ? [{ name: 'Highest', value: `${Math.round(r.maxHr)} bpm` }] : [])])} /> : <p>No ride with heart rate that day.</p>}
        {wk && <><hr /><div class="lc-when">Week of {short(wk.start)}</div><Kv rows={wk.seconds.slice(0, nz).map((s, z) => ({ name: `Heart-rate zone ${z + 1}`, value: s ? hm(s / 3600) : '–', color: ZONE_VAR[z], kind: 'block' as const })).reverse()} /></>}
      </> : <>
        <div class="lc-when">The whole period</div>
        <div class="lc-big">{hm(all / 3600)} <small>with heart rate</small></div>
        <Kv rows={tot.slice(0, nz).map((s, z) => ({ name: `Heart-rate zone ${z + 1}`, value: s ? `${hm(s / 3600)} · ${Math.round(s / Math.max(1, all) * 100)}%` : '–', color: ZONE_VAR[z], kind: 'block' as const })).reverse()} />
        <p>Run a finger across any plot to read a day and its week.</p>
      </>}
      how={<>The first plot stacks the hours your heart spent in each of your heart-rate zones, week by week, every activity with heart rate together. The second shows each ride: its average heart rate as a filled point and the highest it reached as a ring, against your threshold heart rate.{band ? ' The third shows what your heart did at one steady level of power, ride by ride.' : ''}</>}
      plain={<>{band ? 'If the points in the third plot drift down over the weeks, the same power is costing you fewer heartbeats, which is one of the plainest signs of aerobic fitness. ' : ''}Heart rate also rises with heat, a poor night, caffeine and illness, so a single high ride means little.</>}
      table={{ name: `Heart-rate zones by week ${L.from} to ${L.to}`, head: ['Week starting', ...Array.from({ length: nz }, (_, z) => `Zone ${z + 1} (h)`)], rows: weeks.map((w) => [w.start, ...w.seconds.slice(0, nz).map((s) => (s / 3600).toFixed(1))]).reverse() }}
      question={{ id: 'fitter', ask: 'Am I getting fitter?' }}
    >
      <div><h3 class="lc-sub">Hours in each heart-rate zone <em>by week</em></h3>
        <Scope label="Hours in each heart-rate zone, by week" height={210} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="h" yMin={0}
          stack={{ xs: weeks.map((w) => x(w.start) + 3), barW: 5, parts: Array.from({ length: nz }, (_, z) => ({ name: `Zone ${z + 1}`, color: ZONE_VAR[z], vals: weeks.map((w) => w.seconds[z] / 3600) })) }}
          snap={weeks.map((w) => Math.max(0, x(w.start) + 3))} at={at} onAt={setAt} />
        <Legend items={Array.from({ length: nz }, (_, z) => ({ name: `Zone ${z + 1}`, color: ZONE_VAR[z], kind: 'block' as const }))} /></div>
      <div><h3 class="lc-sub">Each ride <em>average, and the highest it reached</em></h3>
        <Scope label="Average and highest heart rate, ride by ride" height={190} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="bpm"
          series={[{ name: 'Highest', kind: 'dots', pts: top.map(([dd, v]) => [x(dd), v]), color: MID, hollow: true, width: 2.6 }, { name: 'Average', kind: 'dots', pts: avg.map(([dd, v]) => [x(dd), v]), color: INK, width: 2.4 }]}
          rules={L.profile.lthr ? [{ y: L.profile.lthr, label: `Threshold · ${L.profile.lthr} bpm` }] : []} snap={avg.map(([dd]) => x(dd))} at={at} onAt={setAt} onPick={(v) => { const r = L.rides.find((q) => q.date === addDays(L.from, v) && q.averageHr); if (r) go(`rides/${r.id}`); }} />
        <Legend items={[{ name: 'Average of the ride', color: INK, kind: 'dot' }, { name: peak.length ? 'Highest held for 30 seconds' : 'Highest reached', color: MID, kind: 'ring' }, { name: 'Your threshold heart rate', color: MID, dash: '5 4' }]} /></div>
      {band && <div><h3 class="lc-sub">Heart rate at {Math.round(band.lo * 100)} to {Math.round(band.hi * 100)}% of FTP <em>the level of power most of your rides have; after the first ten minutes</em></h3>
        <Scope label="Heart rate at one steady level of power, ride by ride" height={170} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="bpm"
          series={[{ name: 'Heart rate at that power', kind: 'dots', pts: band.pts.map((p) => [x(p.date), p.hr]), color: INK, width: 2.4 }]} snap={band.pts.map((p) => x(p.date))} at={at} onAt={setAt} /></div>}
    </ChartShell>
  );
}

export const heartChart: LabChart = {
  id: 'heart', name: 'Heart rate in full', about: 'Zones by week, every ride, and heart rate at steady power.', question: 'fitter', words: 'hr zones bpm lthr max efficiency',
  ready: (L) => {
    const n = L.rides.filter((r) => r.averageHr).length;
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'activity', 'activities')} with heart rate` } : { state: 'none', why: 'Needs a heart-rate strap or watch' };
  },
  tile: (L) => {
    const weeks = hrWeeks(L), n = Math.max(1, weeks.length), max = Math.max(1, ...weeks.map((w) => w.seconds.reduce((a, b) => a + b, 0)));
    const avg = inRange(L.measures.values('avgHr'), L.from, L.to);
    const has = weeks.some((w) => w.seconds.some((s) => s > 0));
    const W = 300, base = 55;
    return {
      mini: has ? <svg class="lb-spark" viewBox={`0 0 ${W} 64`} preserveAspectRatio="none" role="img" aria-label="Your hours in each heart-rate zone, week by week">
        <line class="lb-ax" x1="4" x2={W - 6} y1={base} y2={base} />
        {weeks.map((w, k) => { let y = base; const bw = (W - 10) / n; return <g key={k}>{w.seconds.map((s, z) => { const hh = s / max * (base - 6); y -= hh; return s > 0 ? <rect key={z} x={4 + k * bw + bw * 0.14} width={bw * 0.72} y={y} height={hh} fill={ZONE_VAR[z]} /> : null; })}</g>; })}
      </svg> : <Mini label="Your average heart rate, ride by ride" lines={[{ vals: avg.map((p) => p[1]), color: INK }]} />,
      figure: avg.length ? `${Math.round(mean(avg.map((p) => p[1])))} bpm` : undefined, label: avg.length ? `average across ${plural(avg.length, 'day')} with rides` : 'no rides with heart rate in this period',
    };
  },
  Page: HeartPage,
};

// ---------- breathing across the season ----------

function BreathPage({ L }: { L: LabData }) {
  const M = L.measures;
  const [at, setAt] = useState<number | null>(null);
  const x = (d: string) => dayN(L.from, d);
  const ticks = dayTicks(L.from, L.to);
  const get = (id: string) => inRange(M.values(id), L.from, L.to);
  const vt1 = get('vt1'), vt2 = get('vt2'), ve = get('veEndurance'), br = get('breath');
  const d = at != null ? addDays(L.from, at) : [...ve, ...br, ...vt1, ...vt2].map((p) => p[0]).sort().pop();
  const snaps = [...new Set([...ve, ...br, ...vt1, ...vt2].map((p) => x(p[0])))].sort((a, b) => a - b);
  const chg = (pts: Array<[string, number]>) => (pts.length >= 2 ? pts[pts.length - 1][1] - pts[0][1] : undefined);
  const val = (id: string) => (d ? M.values(id).get(d) : undefined);
  return (
    <ChartShell
      lead={vt1.length || vt2.length ? <>Your breathing thresholds, as your tests read them: {vt1.length ? <>the first at <b>{Math.round(vt1[vt1.length - 1][1])} W</b>{chg(vt1) ? ` (${sg(chg(vt1)!)} W in this period)` : ''}</> : null}{vt1.length && vt2.length ? ', ' : ''}{vt2.length ? <>the second at <b>{Math.round(vt2[vt2.length - 1][1])} W</b>{chg(vt2) ? ` (${sg(chg(vt2)!)} W)` : ''}</> : null}. These are measured from your breathing, not worked out from power.</>
        : ve.length ? <>At endurance power you breathed <b>{ve[ve.length - 1][1].toFixed(0)} litres a minute</b> on your newest ride with a sensor{chg(ve) != null ? `, ${Math.abs(chg(ve)!) < 1 ? 'the same as' : `${Math.abs(chg(ve)!).toFixed(0)} ${chg(ve)! < 0 ? 'fewer' : 'more'} than`} at the start of ${periodWords(L)}` : ''}.</> : <>Breathing on your rides over {periodWords(L)}.</>}
      readout={d ? <>
        <div class="lc-when">{longDay(d)}</div>
        <Kv rows={[
          { name: 'Air breathed at endurance power', value: val('veEndurance') != null ? `${val('veEndurance')!.toFixed(1)} L/min` : '–' },
          { name: 'Breaths a minute at endurance power', value: val('breath') != null ? val('breath')!.toFixed(1) : '–' },
          { name: 'First threshold', value: val('vt1') != null ? `${Math.round(val('vt1')!)} W` : '–' },
          { name: 'Second threshold', value: val('vt2') != null ? `${Math.round(val('vt2')!)} W` : '–' },
        ]} />
      </> : null}
      how={<>{vt1.length || vt2.length ? 'The first plot marks each test that read your breathing thresholds: the power where breathing first quickens, and the power where it runs away. ' : ''}The {vt1.length || vt2.length ? 'second' : 'first'} plot is one point for each ride with a breathing sensor: the air you breathed each minute while riding at 55 to 75% of FTP, and beneath it how many breaths a minute that took.</>}
      plain={<>Thresholds moving up mean you can ride harder before breathing becomes the limit. Less air for the same endurance power, over weeks, is a sign of a growing aerobic base. A ride needs five minutes at endurance power to give a point.</>}
      table={{ name: `Breathing ${L.from} to ${L.to}`, head: ['Date', 'Air at endurance power (L/min)', 'Breaths a minute', 'First threshold (W)', 'Second threshold (W)'], rows: snaps.map((k) => { const dd = addDays(L.from, k); const v = (id: string, n = 1) => M.values(id).get(dd)?.toFixed(n) ?? ''; return [dd, v('veEndurance'), v('breath'), v('vt1', 0), v('vt2', 0)]; }).reverse() }}
      question={{ id: 'fitter', ask: 'Am I getting fitter?' }}
    >
      {(vt1.length > 0 || vt2.length > 0) && <div><h3 class="lc-sub">Both thresholds <em>each test that read them</em></h3>
        <Scope label="Breathing thresholds, each test" height={190} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="W"
          series={[{ name: 'Second', kind: 'step', pts: vt2.map(([dd, v]) => [x(dd), v]), color: MID, dash: '5 3', width: 1.2 }, { name: 'First', kind: 'step', pts: vt1.map(([dd, v]) => [x(dd), v]), color: INK, width: 1.4 },
            { name: 'Second', kind: 'dots', pts: vt2.map(([dd, v]) => [x(dd), v]), color: MID, hollow: true, width: 3 }, { name: 'First', kind: 'dots', pts: vt1.map(([dd, v]) => [x(dd), v]), color: INK, width: 3 }]} snap={snaps} at={at} onAt={setAt} />
        <Legend items={[{ name: 'First threshold', color: INK, kind: 'dot' }, { name: 'Second threshold', color: MID, kind: 'ring' }]} /></div>}
      {ve.length > 0 && <div><h3 class="lc-sub">Air breathed at endurance power <em>each ride with a sensor</em></h3>
        <Scope label="Air breathed each minute at endurance power, ride by ride" height={180} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="L/min" series={[{ name: 'Air breathed', kind: 'dots', pts: ve.map(([dd, v]) => [x(dd), v]), color: INK, width: 2.6 }]} snap={snaps} at={at} onAt={setAt} /></div>}
      {br.length > 0 && <div><h3 class="lc-sub">Breaths a minute at endurance power</h3>
        <Scope label="Breaths a minute at endurance power, ride by ride" height={150} x0={0} x1={dayN(L.from, L.to)} xTicks={ticks} yUnit="br/min" series={[{ name: 'Breaths a minute', kind: 'dots', pts: br.map(([dd, v]) => [x(dd), v]), color: INK, width: 2.6 }]} snap={snaps} at={at} onAt={setAt} /></div>}
    </ChartShell>
  );
}

const breathCount = (L: LabData) => readings(L.measures, 'veEndurance') + readings(L.measures, 'breath') / 2 + readings(L.measures, 'vt1') + readings(L.measures, 'vt2');
export const breathChart: LabChart = {
  id: 'breathing', name: 'Breathing across the season', about: 'Both thresholds, and the air you breathe at endurance power.', question: 'fitter', words: 'ventilation vt1 vt2 breaths sensor strap',
  ready: (L) => {
    const n = Math.floor(breathCount(L));
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'reading')} from rides with a breathing sensor` } : { state: 'none', why: 'Needs a breathing sensor' };
  },
  tile: (L) => {
    const M = L.measures, ve = inRange(M.values('veEndurance'), L.from, L.to), v1 = inRange(M.values('vt1'), L.from, L.to);
    return { mini: <Mini label="Air breathed at endurance power, ride by ride" lines={[{ vals: (ve.length ? ve : v1).map((p) => p[1]), color: INK }]} />,
      figure: v1.length ? `${Math.round(v1[v1.length - 1][1])} W` : ve.length ? `${ve[ve.length - 1][1].toFixed(0)} L/min` : undefined, label: v1.length ? 'first breathing threshold' : ve.length ? 'air breathed at endurance power' : 'nothing in this period' };
  },
  Page: BreathPage,
};

// ---------- how you pedal ----------

function pedalRides(L: LabData) { return L.rides.filter((r) => r.sport === 'ride' && r.date >= L.from && r.date <= L.to && (r.averageCadence ?? 0) > 0); }

function PedalPage({ L }: { L: LabData }) {
  const rides = useMemo(() => pedalRides(L), [L.rides, L.from, L.to]);
  const power = rides.filter((r) => (r.averagePower ?? 0) > 0);
  const useP = power.length >= 3;
  const xs = useP ? power : rides.filter((r) => (r.averageSpeedMs ?? 0) > 0);
  const k = L.imperial ? 2.236936 : 3.6;
  const xv = (r: Ride) => (useP ? r.averagePower! : r.averageSpeedMs! * k);
  const [at, setAt] = useState<number | null>(null);
  const [atDay, setAtDay] = useState<number | null>(null);
  const lo = Math.min(...xs.map(xv)), hi = Math.max(...xs.map(xv));
  const pad = (hi - lo) * 0.08 || 5;
  const r = at != null ? xs.find((q) => xv(q) === at) : atDay != null ? rides.find((q) => dayN(L.from, q.date) === atDay) : rides[rides.length - 1];
  const cad = mean(rides.map((q) => q.averageCadence!));
  const coast = rides.filter((q) => (q.coastingSeconds ?? 0) > 0 && q.seconds > 0);
  const x = (d: string) => dayN(L.from, d);
  // Whether cadence rises with power across the rides: the least-squares slope, per 100 W.
  const slope = useMemo(() => { if (!useP || xs.length < 5) return undefined; const mx = mean(xs.map(xv)), my = mean(xs.map((q) => q.averageCadence!)); let a = 0, b = 0; for (const q of xs) { a += (xv(q) - mx) * (q.averageCadence! - my); b += (xv(q) - mx) ** 2; } return b > 0 ? a / b * 100 : undefined; }, [xs.length, useP]);
  const unit = useP ? 'W' : L.imperial ? 'mph' : 'km/h';
  return (
    <ChartShell
      lead={<>Across {plural(rides.length, 'ride')} in {periodWords(L)} you pedalled at <b>{Math.round(cad)} rpm</b> on average{slope != null ? <>, {Math.abs(slope) < 1 ? 'much the same whether a ride was easy or hard' : `about ${Math.abs(slope).toFixed(0)} rpm ${slope > 0 ? 'faster' : 'slower'} for each 100 W harder a ride was`}</> : null}{coast.length ? <> and coasted for {Math.round(mean(coast.map((q) => q.coastingSeconds! / q.seconds * 100)))}% of your riding time</> : null}.</>}
      readout={r ? <>
        <div class="lc-when">{longDay(r.date)}</div>
        <div class="lc-big">{Math.round(r.averageCadence!)} <small>rpm</small></div>
        <Kv rows={[...(r.averagePower ? [{ name: 'Average power', value: `${Math.round(r.averagePower)} W` }] : []), ...(r.averageSpeedMs ? [{ name: 'Average speed', value: `${(r.averageSpeedMs * k).toFixed(1)} ${L.imperial ? 'mph' : 'km/h'}` }] : []), ...(r.coastingSeconds && r.seconds ? [{ name: 'Coasting', value: `${Math.round(r.coastingSeconds / r.seconds * 100)}% of the ride` }] : [])]} />
        <p><a href={`#/rides/${r.id}`}>{r.name}</a></p>
      </> : null}
      how={<>In the first plot each point is a whole ride: how hard it was on average, left to right, against how fast you pedalled, bottom to top. The second plot is the same rides in date order. Run a finger across to read a ride; press to open it.</>}
      plain={<>Most riders spin a little faster as the effort rises. Points low and to the right are hard rides ground out at a slow cadence; high and to the left, easy rides spun quickly. This uses each ride’s averages. Where the time falls inside one ride is on that ride’s own page.</>}
      table={{ name: `Pedalling ${L.from} to ${L.to}`, head: ['Date', 'Ride', 'Cadence (rpm)', 'Average power (W)', `Average speed (${L.imperial ? 'mph' : 'km/h'})`, 'Coasting (%)'], rows: rides.map((q) => [q.date, q.name, Math.round(q.averageCadence!), q.averagePower ? Math.round(q.averagePower) : '', q.averageSpeedMs ? (q.averageSpeedMs * k).toFixed(1) : '', q.coastingSeconds && q.seconds ? Math.round(q.coastingSeconds / q.seconds * 100) : '']).reverse() }}
    >
      {xs.length >= 3 && <div><h3 class="lc-sub">Cadence against {useP ? 'power' : 'speed'} <em>each point a whole ride</em></h3>
        <Scope label={`Average cadence against average ${useP ? 'power' : 'speed'}, each ride a point`} height={260} x0={lo - pad} x1={hi + pad} xTicks={Array.from({ length: 6 }, (_, i) => { const v = lo + (hi - lo) * i / 5; return [v, `${useP ? Math.round(v) : v.toFixed(1)} ${unit}`] as [number, string]; })} yUnit="rpm"
          series={[{ name: 'Each ride', kind: 'dots', pts: xs.map((q) => [xv(q), q.averageCadence!]), color: INK, width: 3 }]} rules={[{ y: cad, label: `Your average · ${Math.round(cad)} rpm` }]}
          snap={xs.map(xv)} at={at} onAt={(v) => { setAt(v); if (v != null) setAtDay(null); }} onPick={() => { if (r) go(`rides/${r.id}`); }} /></div>}
      <div><h3 class="lc-sub">Cadence, ride by ride</h3>
        <Scope label="Average cadence, ride by ride" height={160} x0={0} x1={dayN(L.from, L.to)} xTicks={dayTicks(L.from, L.to)} yUnit="rpm" series={[{ name: 'Cadence', kind: 'dots', pts: rides.map((q) => [x(q.date), q.averageCadence!]), color: INK, width: 2.4 }]}
          snap={rides.map((q) => x(q.date))} at={atDay} onAt={(v) => { setAtDay(v); if (v != null) setAt(null); }} /></div>
      <Legend items={[{ name: 'A ride', color: INK, kind: 'dot' }, { name: 'Your average cadence', color: MID, dash: '5 4' }]} />
    </ChartShell>
  );
}

export const pedalChart: LabChart = {
  id: 'pedal', name: 'How you pedal', about: 'Cadence against effort, each ride a point.', words: 'cadence rpm coasting spin',
  ready: (L) => {
    const n = L.rides.filter((r) => r.sport === 'ride' && (r.averageCadence ?? 0) > 0).length;
    return n >= 3 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'ride')} with cadence` } : { state: 'none', why: 'Needs a cadence sensor' };
  },
  tile: (L) => {
    const rides = pedalRides(L);
    return { mini: <Mini label="Your average cadence, ride by ride" lines={[{ vals: rides.map((r) => r.averageCadence!), color: INK }]} />, figure: rides.length ? `${Math.round(mean(rides.map((r) => r.averageCadence!)))} rpm` : undefined, label: rides.length ? `average across ${plural(rides.length, 'ride')}` : 'no rides with cadence in this period' };
  },
  Page: PedalPage,
};

// ---------- two rides compared ----------

/** A recording averaged into half-minutes, so two rides can be laid over each other and read. */
function halfMinutes(s: StreamSet): Array<{ t: number; w?: number; hr?: number }> {
  const out: Array<{ t: number; w?: number; hr?: number }> = [];
  const n = s.time.length; if (!n) return out;
  const t0 = s.time[0];
  let k = 0;
  for (let b = 0; k < n; b++) {
    let sw = 0, nw = 0, sh = 0, nh = 0;
    while (k < n && s.time[k] - t0 < (b + 1) * 30) { const w = s.watts?.[k], h = s.heartrate?.[k]; if (w != null && isFinite(w)) { sw += w; nw++; } if (h != null && h > 30) { sh += h; nh++; } k++; }
    if (nw || nh) out.push({ t: b * 0.5, w: nw ? sw / nw : undefined, hr: nh ? sh / nh : undefined });
  }
  return out;
}

/** The pair offered first: the newest ride in the period that has an earlier ride of the same name, and the earliest such. */
function defaultPair(rides: Ride[]): [string, string] | undefined {
  const by = new Map<string, Ride[]>();
  for (const r of rides) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  const groups = [...by.values()].filter((g) => g.length >= 2).map((g) => g.sort((a, b) => a.date.localeCompare(b.date)));
  if (!groups.length) return rides.length >= 2 ? [rides[rides.length - 2].id, rides[rides.length - 1].id] : undefined;
  const g = groups.sort((a, b) => b[b.length - 1].date.localeCompare(a[a.length - 1].date))[0];
  return [g[0].id, g[g.length - 1].id];
}
const compareRides = (L: LabData) => L.rides.filter((r) => r.sport === 'ride' && r.date >= L.from && r.date <= L.to && (r.averageHr || r.averagePower)).sort((a, b) => a.date.localeCompare(b.date));

function ComparePage({ L }: { L: LabData }) {
  const rides = useMemo(() => compareRides(L), [L.rides, L.from, L.to]);
  const first = useMemo(() => defaultPair(rides), [rides]);
  const [ids, setIds] = useState<[string, string] | undefined>(first);
  useEffect(() => { setIds(first); }, [first?.[0], first?.[1]]);
  const [recs, setRecs] = useState<Record<string, ReturnType<typeof halfMinutes> | null>>({});
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    for (const id of ids ?? []) {
      if (id in recs) continue;
      void (async () => {
        // From this device first (the cache, then the kept file); only then, for a rider who has connected one, from the data service.
        let s: StreamSet | undefined = (await cachedRecording(id)) ?? (await recordingOf(id));
        if (!s) { try { const c = await credentials(); if (c) { const f = await fetchPowerStream(c, id); if (f.time?.length) s = await corrected(id, { id, ...f } as StreamSet); } } catch { /* said below: no recording to draw */ } }
        if (alive) setRecs((cur) => ({ ...cur, [id]: s ? halfMinutes(s) : null }));
      })();
    }
    return () => { alive = false; };
  }, [ids?.[0], ids?.[1]]);
  if (!ids) return <div class="lb-panel"><p class="lb-lead" style="margin:0">Two rides with power or heart rate in {periodWords(L)} are needed to compare.</p></div>;
  const [a, b] = ids.map((id) => rides.find((r) => r.id === id) ?? L.rides.find((r) => r.id === id));
  const ra = recs[ids[0]], rb = recs[ids[1]];
  const end = Math.max(1, ...(ra ?? []).map((p) => p.t), ...(rb ?? []).map((p) => p.t));
  const ticks: Array<[number, string]> = Array.from({ length: Math.floor(end / (end > 120 ? 30 : end > 50 ? 10 : 5)) + 1 }, (_, i) => { const v = i * (end > 120 ? 30 : end > 50 ? 10 : 5); return [v, `${v} min`]; });
  const ser = (rec: typeof ra, key: 'w' | 'hr', color: string, dash?: string): Series => ({ name: key, kind: 'line', pts: (rec ?? []).filter((p) => p[key] != null).map((p) => [p.t, p[key]!]), color, dash, width: dash ? 1.2 : 1.6 });
  const hasW = [ra, rb].some((r) => r?.some((p) => p.w != null)), hasHr = [ra, rb].some((r) => r?.some((p) => p.hr != null));
  const pick = (which: 0 | 1) => (
    <label class="lc-pick">{which ? 'against' : 'Compare'} <select value={ids[which]} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setIds(which ? [ids[0], v] : [v, ids[1]]); }}>
      {[...rides].reverse().map((r) => <option key={r.id} value={r.id}>{short(r.date)} · {r.name}</option>)}</select></label>
  );
  const pa = at != null ? ra?.find((p) => p.t === at) : undefined, pb = at != null ? rb?.find((p) => p.t === at) : undefined;
  const dW = a?.averagePower && b?.averagePower ? b.averagePower - a.averagePower : undefined, dH = a?.averageHr && b?.averageHr ? b.averageHr - a.averageHr : undefined;
  const loading = ra === undefined || rb === undefined, missing = ra === null || rb === null;
  return (
    <ChartShell
      lead={a && b ? <>{a.name === b.name ? <>The same ride, <b>{a.name}</b>, {plural(Math.abs(dayN(a.date, b.date)), 'day')} apart</> : <>{a.name} on {short(a.date)} against {b.name} on {short(b.date)}</>}{dW != null ? <>: average power {Math.abs(dW) < 1.5 ? 'the same' : `${Math.round(Math.abs(dW))} W ${dW > 0 ? 'higher' : 'lower'}`} the second time</> : null}{dH != null ? <>{dW != null ? ', ' : ': '}average heart rate <b>{Math.abs(dH) < 1 ? 'the same' : `${Math.round(Math.abs(dH))} beats ${dH > 0 ? 'higher' : 'lower'}`}</b></> : null}.</> : <>Choose two rides.</>}
      readout={<>
        <div class="lc-when">{at != null ? `${at} minutes in` : 'The whole of each ride'}</div>
        <Kv rows={[
          { name: a ? `${short(a.date)}` : 'First', value: at != null ? `${pa?.w != null ? `${Math.round(pa.w)} W` : '–'} · ${pa?.hr != null ? `${Math.round(pa.hr)} bpm` : '–'}` : `${a?.averagePower ? `${Math.round(a.averagePower)} W` : '–'} · ${a?.averageHr ? `${Math.round(a.averageHr)} bpm` : '–'}`, color: MID, dash: '5 3' },
          { name: b ? `${short(b.date)}` : 'Second', value: at != null ? `${pb?.w != null ? `${Math.round(pb.w)} W` : '–'} · ${pb?.hr != null ? `${Math.round(pb.hr)} bpm` : '–'}` : `${b?.averagePower ? `${Math.round(b.averagePower)} W` : '–'} · ${b?.averageHr ? `${Math.round(b.averageHr)} bpm` : '–'}`, color: INK },
        ]} />
        {a && <p><a href={`#/rides/${a.id}`}>Open {short(a.date)}</a>{b && <> · <a href={`#/rides/${b.id}`}>Open {short(b.date)}</a></>}</p>}
        {loading && <p>Reading the two recordings…</p>}
        {missing && <p>A ride here has no recording that could be read, so only its totals can be compared.</p>}
      </>}
      legend={<><Legend items={[{ name: a ? `${short(a.date)} · ${a.name}` : 'First', color: MID, dash: '5 3' }, { name: b ? `${short(b.date)} · ${b.name}` : 'Second', color: INK }]} /><div class="lc-picks">{pick(0)}{pick(1)}</div></>}
      how={<>Two rides laid over each other from their starts, averaged over each half-minute so they can be read. The dashed line is the earlier ride chosen, the solid line the later. Power is above, heart rate below. Run a finger across to read both at any minute.</>}
      plain={<>When the power lines sit together and the solid heart-rate line sits under the dashed one, the same work cost your heart less the second time. That is fitness you can see. It is a fair comparison only for rides done the same way: the same workout, indoors, is best.</>}
      question={{ id: 'fitter', ask: 'Am I getting fitter?' }}
    >
      {hasW && <div><h3 class="lc-sub">Power <em>half-minute averages</em></h3><Scope label="Power through the two rides" height={200} x0={0} x1={end} xTicks={ticks} yUnit="W" yMin={0} series={[ser(ra, 'w', MID, '5 3'), ser(rb, 'w', INK)]} snap={(rb ?? ra ?? []).map((p) => p.t)} at={at} onAt={setAt} /></div>}
      {hasHr && <div><h3 class="lc-sub">Heart rate <em>half-minute averages</em></h3><Scope label="Heart rate through the two rides" height={200} x0={0} x1={end} xTicks={ticks} yUnit="bpm" series={[ser(ra, 'hr', MID, '5 3'), ser(rb, 'hr', INK)]} snap={(rb ?? ra ?? []).map((p) => p.t)} at={at} onAt={setAt} /></div>}
      {!hasW && !hasHr && !loading && <p class="lb-note">Neither ride has a recording that could be read.</p>}
    </ChartShell>
  );
}

export const compareChart: LabChart = {
  id: 'compare', name: 'Two rides compared', about: 'One ride laid over another: power and heart rate.', question: 'fitter', words: 'same workout overlay against earlier',
  ready: (L) => {
    const n = L.rides.filter((r) => r.sport === 'ride' && (r.averageHr || r.averagePower)).length;
    return n >= 2 ? { state: 'ok' } : n ? { state: 'some', so: 'Your data so far: 1 of the 2 rides a comparison needs' } : { state: 'none', why: 'Needs two rides with power or heart rate' };
  },
  tile: (L) => {
    const rides = compareRides(L), pair = defaultPair(rides);
    const a = pair && rides.find((r) => r.id === pair[0]), b = pair && rides.find((r) => r.id === pair[1]);
    const same = rides.filter((r) => a && r.name === (b ?? a).name);
    const dH = a?.averageHr && b?.averageHr ? b.averageHr - a.averageHr : undefined;
    return { mini: <Mini label={same.length ? `Average heart rate each time you rode ${same[0].name}` : 'Nothing to compare in this period'} lines={[{ vals: same.map((r) => r.averageHr ?? null), color: INK }]} />,
      figure: dH != null ? `${sg(dH)} bpm` : undefined, label: a && b ? (a.name === b.name ? `${a.name}: ${short(a.date)} against ${short(b.date)}` : `${short(a.date)} against ${short(b.date)}`) : 'fewer than two rides in this period' };
  },
  Page: ComparePage,
};

