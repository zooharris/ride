import type { AppData } from '../store';
import { findWorkout } from '../store';
import { clock } from '../../engine/workout';
import { distance, elevation, fmtDate } from '../derived';
import { scoreRide } from '../../engine/compliance';
import { ZONE_VAR } from '../Profile';
import type { Ride } from '../../engine/types';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, STREAMS_VERSION, type StreamSet } from '../../data/db';
import { credentials } from '../../sync/syncService';
import { fetchStreams } from '../../sync/intervals';
import { analyseRide, type Analysis } from '../../engine/analysis';
import { ActivityCharts, resample } from '../ActivityCharts';
import { RouteMap } from '../RouteMap';
import { KIND_COLOR, KIND_LABEL } from './Plan';
import { MonthGrid, monthOf, shiftMonth } from '../MonthGrid';
import { getSetting, setSetting } from '../../data/db';
import { today } from '../../engine/load';
import { Empty, PageHead, Skeleton } from '../PageHead';

export function Rides({ data, id }: { data: AppData; id?: string }) {
  const profile = data.profile!;
  if (id) {
    const r = data.rides.find((x) => x.id === id);
    if (!r) return <Empty title="That activity is not synced." action={<a class="btn sm" href="#/rides">All activities</a>}>It may have been deleted on Intervals.icu, or this device has not synced since it was recorded.</Empty>;
    return <RideDetail ride={r} data={data} />;
  }
  if (data.rides.length === 0) {
    return (
      <div>
        <PageHead title="Activities" />
        <Empty title="No activities yet."><span>Connect Intervals.icu in Settings, then press Sync on Today. Your last 120 days of activities arrive on the first sync.</span></Empty>
      </div>
    );
  }
  const mph = (ms?: number) => ms ? (profile.units === 'imperial' ? `${(ms * 2.237).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`) : '';
  return <RideList data={data} mph={mph} />;
}

function RideList({ data, mph }: { data: AppData; mph: (ms?: number) => string }) {
  const profile = data.profile!;
  const [view, setView] = useState<'list' | 'month'>('list');
  const [month, setMonth] = useState(monthOf(today()));
  useEffect(() => { getSetting<'list' | 'month'>('ridesView', 'list').then(setView); }, []);
  const pickView = (v: 'list' | 'month') => { setView(v); setSetting('ridesView', v); };
  return (
    <div>
      <PageHead eyebrow={`${data.rides.length} synced`} title="Activities">
        <div class="seg"><button class={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>List</button><button class={view === 'month' ? 'on' : ''} onClick={() => pickView('month')}>Calendar</button></div>
      </PageHead>
      {view === 'month' && (
        <MonthGrid month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onToday={() => setMonth(monthOf(today()))}
          render={(d) => data.rides.filter((r) => r.date === d).map((r) => (
            <a class="month-item done" key={r.id} href={`#/rides/${r.id}`} title={`${r.name} · ${r.tss ?? '–'} TSS`}><span class="sw" style={`background:${KIND_COLOR[r.sport]}`} /><span>{r.name}</span></a>
          ))} />
      )}
      {view === 'list' && <div class="stack">
        {data.rides.map((r) => {
          const p = data.planned.find((x) => x.activityId === r.id);
          const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
          const c = w && w.kind === 'ride' ? scoreRide(w, r) : undefined;
          return (
            <a class="cal-item" key={r.id} href={`#/rides/${r.id}`}>
              <div class="t">
                <b>{r.name}{r.sport !== 'ride' ? <span class="faint" style="font-weight:400"> · {KIND_LABEL[r.sport]}</span> : null}</b>
                <span>{fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {clock(r.seconds)} · {distance(r.distanceM, profile)}{mph(r.averageSpeedMs) ? ` · ${mph(r.averageSpeedMs)}` : ''}</span>
              </div>
              <div style="text-align:right">
                <div class="num" style="font-size:18px">{r.tss ?? '–'}<span class="faint small" style="font-weight:400"> TSS</span></div>
                {c && <span class="pill" style={`border-color:${verdictColor(c.verdict)};color:${verdictColor(c.verdict)}`}>{verdictLabel(c.verdict)}</span>}
              </div>
            </a>
          );
        })}
      </div>}
    </div>
  );
}

function RideDetail({ ride: r, data }: { ride: Ride; data: AppData }) {
  const profile = data.profile!;
  const p = data.planned.find((x) => x.activityId === r.id);
  const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
  const c = w && w.kind === 'ride' ? scoreRide(w, r) : undefined;
  const [streams, setStreams] = useState<StreamSet | null | undefined>(undefined);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const basis: 'power' | 'hr' = r.normalizedPower ? 'power' : 'hr';

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await db.streams.get(r.id);
      if (cached && cached.v === STREAMS_VERSION) { if (alive) setStreams(cached); return; }
      const cred = await credentials();
      if (!cred) { if (alive) setStreams(cached ?? null); return; }
      try {
        const st = await fetchStreams(cred, r.id);
        const set: StreamSet = { id: r.id, v: STREAMS_VERSION, ...st };
        await db.streams.put(set);
        if (alive) setStreams(set);
      } catch (e) {
        if (alive) { setStreams(null); setStreamErr((e as Error).message); }
      }
    })();
    return () => { alive = false; };
  }, [r.id]);

  const analysis: Analysis | undefined = streams && w && w.kind === 'ride' ? analyseRide(w, profile, basis, streams.time, streams.watts, streams.heartrate) : undefined;
  const samples = useMemo(() => (streams ? resample(streams, 700) : []), [streams]);
  const hasRoute = samples.filter((x) => typeof x.lat === 'number' && typeof x.lng === 'number').length > 1;
  const [hover, setHover] = useState<number | null>(null);
  const tempF = r.averageTempC != null ? (profile.units === 'imperial' ? `${Math.round(r.averageTempC * 1.8 + 32)}°F` : `${Math.round(r.averageTempC)}°C`) : undefined;
  const items: Array<[string, string | number | undefined, string?]> = [
    ['Moving time', clock(r.seconds), 'Time pedalling, stops excluded'],
    ['Distance', distance(r.distanceM, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much the ride cost you. An hour flat out at FTP is 100'],
    ['Normalized power', r.normalizedPower ? `${r.normalizedPower} W` : undefined, 'What the ride felt like in steady watts; surges count more than coasting'],
    ['Average power', r.averagePower ? `${r.averagePower} W` : undefined, 'Plain average over the whole ride, coasting included'],
    ['Intensity factor', r.intensityFactor?.toFixed(2), 'Normalized power over FTP. 0.70 is endurance, 1.00 is threshold'],
    ['Average heart rate', r.averageHr ? `${Math.round(r.averageHr)} bpm` : undefined, 'Over the whole ride'],
    ['Max heart rate', r.maxHr ? `${Math.round(r.maxHr)} bpm` : undefined],
    ['Average cadence', r.averageCadence ? `${Math.round(r.averageCadence)} rpm` : undefined, 'Over the whole ride, while pedalling'],
    ['Efficiency factor', r.efficiencyFactor?.toFixed(2), 'Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving'],
    ['Heart-rate drift', r.decoupling != null ? `${r.decoupling.toFixed(1)}%` : undefined, 'How much HR rose for the same power in the second half. Under 5% on a long ride is a sign of good aerobic base'],
    ['Average temperature', tempF],
    ['FTP used for this ride', r.ftpAtRide ? `${r.ftpAtRide} W` : undefined, 'The FTP on record the day you rode; TSS and intensity are relative to it'],
  ];
  const zones = r.powerZoneSeconds ?? r.hrZoneSeconds;
  const zTotal = zones?.reduce((a, b) => a + b, 0) || 1;
  return (
    <div>
      <a href="#/rides" class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Rides</a>
      <p class="muted small">{fmtDate(r.date)}</p>
      <h1>{r.name}</h1>
      {r.sport !== 'ride' && <p class="muted small" style="margin-top:4px">{KIND_LABEL[r.sport]} · {r.type}</p>}
      {c && w && (
        <div class="panel" style={`margin-top:14px;border-color:${verdictColor(c.verdict)}`}>
          <b style={`color:${verdictColor(c.verdict)}`}>{verdictLabel(c.verdict)}</b> <span class="muted">against {w.name}</span>
          <p class="muted small" style="margin-top:4px">{c.reason}{analysis ? ` ${analysis.summary}` : ''}</p>
        </div>
      )}

      {streams === undefined && <section class="section" aria-busy="true"><div class="stack" style="gap:10px"><Skeleton h={12} w={160} /><Skeleton h={320} r={12} /><Skeleton h={140} r={12} /></div></section>}
      {streams === null && <section class="section"><div class="empty small">{streamErr ? `Could not load the recording: ${streamErr}` : 'Connect Intervals.icu to see the recording: the route, and power, heart rate, cadence, speed and elevation through the activity.'}</div></section>}
      {streams && samples.length > 1 && (
        <>
          {hasRoute && (
            <section class="section">
              <h2>Route</h2>
              <p class="faint small" style="margin:4px 0 8px">Green dot: start. Red: finish. The amber marker follows the charts below; moving the mouse along the route, or tapping it, moves the charts.</p>
              <RouteMap samples={samples} hover={hover} onHover={setHover} />
            </section>
          )}
          <section class="section">
            <h2>The recording</h2>
            <p class="faint small" style="margin:4px 0 8px">{analysis ? 'Shaded bands on the first chart are the planned targets for each step.' : r.sport === 'ride' ? 'Rides done from a plan also show the planned targets as shaded bands.' : ''}</p>
            <ActivityCharts samples={samples} analysis={analysis} profile={profile} hover={hover} onHover={setHover} />
          </section>
        </>
      )}

      {analysis && analysis.steps.some((s) => s.work) && (
        <section class="section">
          <h2>Intervals against plan</h2>
          <table class="steps" style="margin-top:8px">
            <tr><td colSpan={2} class="faint small">Step</td><td class="r faint small">Target</td><td class="r faint small">Ridden</td></tr>
            {analysis.steps.filter((s) => s.work).map((s) => (
              <tr key={s.index}>
                <td><span class="z" style={`background:${s.hit ? 'var(--good)' : (s.actual ?? 0) < s.targetLow ? 'var(--warn)' : 'var(--z5)'}`} /></td>
                <td>{s.label}<div class="faint small">{clock(s.endSec - s.startSec)}{s.actualHr ? ` · HR ${s.actualHr}` : ''}</div></td>
                <td class="r num">{s.targetLow}{s.targetHigh !== s.targetLow ? `–${s.targetHigh}` : ''}</td>
                <td class="r num" style={`color:${s.hit ? 'var(--good)' : 'var(--ink)'}`}>{s.actual ?? '–'}</td>
              </tr>
            ))}
          </table>
          <p class="faint small" style="margin-top:8px">Green: on target. Amber: under. Orange: over. Compared by laying the plan along elapsed time, so a long pause mid-ride shifts the windows; pressing lap on the computer keeps them aligned.</p>
        </section>
      )}
      {zones && (
        <section class="section">
          <h2>Time in zone</h2>
          <p class="faint small" style="margin-bottom:8px">Share of the ride spent in each {r.powerZoneSeconds ? 'power' : 'heart-rate'} zone.</p>
          <div style="display:flex;height:14px;border-radius:4px;overflow:hidden;gap:2px">
            {zones.map((s, i) => s > 0 && <div key={i} style={`flex:${s};background:${ZONE_VAR[Math.min(i, 6)]}`} title={`Z${i + 1}: ${clock(s)}`} />)}
          </div>
          <div class="row wrap faint small" style="margin-top:6px;gap:10px">
            {zones.map((s, i) => s / zTotal > 0.03 && <span key={i}><span style={`color:${ZONE_VAR[Math.min(i, 6)]}`}>■</span> Z{i + 1} {Math.round((s / zTotal) * 100)}%</span>)}
          </div>
        </section>
      )}
      <section class="section">
        <h2>Numbers</h2>
        <table class="steps">
          {items.filter(([, v]) => v !== undefined && v !== '').map(([k, v, hint]) => (
            <tr key={k}>
              <td colSpan={2}>{k}{hint && <div class="faint small" style="font-weight:400;line-height:1.35;margin-top:2px">{hint}</div>}</td>
              <td class="r num" colSpan={2}>{v}</td>
            </tr>
          ))}
        </table>
      </section>
    </div>
  );
}

function verdictColor(v: string): string {
  return { nailed: 'var(--good)', done: 'var(--z2)', partial: 'var(--warn)', overcooked: 'var(--z5)', missed: 'var(--bad)' }[v] ?? 'var(--ink-3)';
}
function verdictLabel(v: string): string {
  return { nailed: 'Nailed it', done: 'Done', partial: 'Partial', overcooked: 'Over-cooked', missed: 'Missed' }[v] ?? v;
}
