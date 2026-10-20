import type { AppData } from '../store';
import { findWorkout } from '../store';
import { clock } from '../../engine/workout';
import { distance, elevation, fmtDate, weekStart } from '../derived';
import { scoreRide } from '../../engine/compliance';
import type { Ride } from '../../engine/types';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, STREAMS_VERSION, type StreamSet } from '../../data/db';
import { credentials } from '../../sync/syncService';
import { fetchStreams } from '../../sync/intervals';
import { analyseRide, type Analysis } from '../../engine/analysis';
import { ActivityCharts, resample } from '../ActivityCharts';
import { RouteMap } from '../RouteMap';
import { KIND_COLOR, KIND_LABEL, KindDot } from './Plan';
import { MonthGrid, monthOf, shiftMonth } from '../MonthGrid';
import { getSetting, setSetting } from '../../data/db';
import { addDays, today } from '../../engine/load';
import { Empty, PageHead, Skeleton } from '../PageHead';
import { LapsTable, PowerDistribution, ZoneBars } from '../RideCharts';
import { ZONE_VAR } from '../Profile';
import { KindStack } from '../Glance';
import { hoursLabel, type WeekSummary } from '../week';

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
            <a class={`month-item done k-${r.sport}`} key={r.id} href={`#/rides/${r.id}`} title={`${r.name} · ${r.tss ?? '–'} TSS`} style={`--c:${KIND_COLOR[r.sport]}`}><span class="mi-name">{r.name}</span></a>
          ))} />
      )}
      {view === 'list' && <div class="actlist">
        {groupByWeek(data.rides).map(({ start, rides }) => {
          const secs = rides.reduce((a, r) => a + r.seconds, 0);
          const tss = rides.reduce((a, r) => a + (r.tss ?? 0), 0);
          return (
            <section key={start} class="actweek">
              <div class="aw-head">
                <h2>{fmtDate(start, { month: 'short', day: 'numeric' })} – {fmtDate(addDays(start, 6), { month: 'short', day: 'numeric' })}</h2>
                <div class="wb-stats small muted">
                  <span>{rides.length} {rides.length === 1 ? 'activity' : 'activities'}</span>
                  <span><b class="num">{hoursLabel(secs / 60)}</b></span>
                  <span><b class="num">{Math.round(tss)}</b> TSS</span>
                  <KindStack week={doneOnly(rides)} width={110} />
                </div>
              </div>
              <div class="stack" style="gap:6px">
                {rides.map((r) => {
                  const p = data.planned.find((x) => x.activityId === r.id);
                  const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
                  const c = w && w.kind === 'ride' ? scoreRide(w, r) : undefined;
                  const zones = r.powerZoneSeconds?.length ? r.powerZoneSeconds : r.hrZoneSeconds;
                  return (
                    <a class="cal-item act" key={r.id} href={`#/rides/${r.id}`} style={c ? `--edge:${verdictColor(c.verdict)}` : ''}>
                      <KindDot kind={r.sport === 'other' ? 'ride' : r.sport} big />
                      <div class="t">
                        <b>{r.name}{r.sport !== 'ride' ? <span class="faint" style="font-weight:400"> · {KIND_LABEL[r.sport]}</span> : null}</b>
                        <span>{fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {clock(r.seconds)}{r.distanceM ? ` · ${distance(r.distanceM, profile)}` : ''}{mph(r.averageSpeedMs) && r.sport === 'ride' ? ` · ${mph(r.averageSpeedMs)}` : ''}</span>
                      </div>
                      {zones && zones.some((z) => z > 0) && <ZoneStrip seconds={zones} power={!!r.powerZoneSeconds?.length} />}
                      <div class="act-load">
                        <div class="num" style="font-size:18px;line-height:22px">{r.tss ?? '–'}<span class="faint small" style="font-weight:400"> TSS</span></div>
                        {c && <div class="small" style="color:var(--ink-2)"><span class="sw-dot" style={`background:${verdictColor(c.verdict)}`} /> {verdictLabel(c.verdict)}</div>}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
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
  // Planned targets for both charts: the ride's own basis as analysed, the other converted (watts to the matching heart rate, and back).
  const targets = streams && w && w.kind === 'ride' ? {
    watts: streams.watts?.length ? (basis === 'power' ? analysis : analyseRide(w, profile, 'power', streams.time, streams.watts, streams.heartrate)) : undefined,
    hr: streams.heartrate?.length ? (basis === 'hr' ? analysis : analyseRide(w, profile, 'hr', streams.time, streams.watts, streams.heartrate)) : undefined,
  } : undefined;
  const samples = useMemo(() => (streams ? resample(streams, 700) : []), [streams]);
  const hasRoute = samples.filter((x) => typeof x.lat === 'number' && typeof x.lng === 'number').length > 1;
  const [hover, setHover] = useState<number | null>(null);
  const tempF = r.averageTempC != null ? (profile.units === 'imperial' ? `${Math.round(r.averageTempC * 1.8 + 32)}°F` : `${Math.round(r.averageTempC)}°C`) : undefined;
  const items = activityNumbers(r, profile, tempF);
  const isRide = r.sport === 'ride';
  const noun = KIND_NOUN[r.sport];
  const plannedSecs = w && !isRide ? (w.minutes ?? 0) * 60 : 0;
  return (
    <div>
      <PageHead back={{ label: 'Activities', href: '#/rides' }} title={r.name} eyebrow={`${fmtDate(r.date)}${r.sport !== 'ride' ? ` · ${KIND_LABEL[r.sport]} · ${r.type}` : ''}`} />
      {w && !isRide && p?.status === 'completed' && (
        <div class="panel" style="margin-top:14px;border-color:var(--good)">
          <b style="color:var(--good)">Done</b> <span class="muted">against <a href={`#/workout/${w.id}?from=rides&ride=${r.id}&date=${p.date}`}>{w.name}</a></span>
          <p class="muted small" style="margin-top:4px">{clock(r.seconds)} recorded{plannedSecs ? ` against ${Math.round(plannedSecs / 60)} min planned` : ''}{r.tss != null ? `, training load ${r.tss} TSS` : ''}{w.estimatedTss != null ? ` (about ${w.estimatedTss} planned)` : ''}.</p>
        </div>
      )}
      {c && w && (
        <div class="panel" style={`margin-top:14px;border-color:${verdictColor(c.verdict)}`}>
          <b style={`color:${verdictColor(c.verdict)}`}>{verdictLabel(c.verdict)}</b> <span class="muted">against <a href={`#/workout/${w.id}?from=rides&ride=${r.id}&date=${p!.date}`}>{w.name}</a></span>
          <p class="muted small" style="margin-top:4px">{c.reason}{analysis ? ` ${analysis.summary}` : ''}</p>
        </div>
      )}

      {streams === undefined && <section class="section" aria-busy="true"><div class="stack" style="gap:10px"><Skeleton h={12} w={160} /><Skeleton h={320} r={12} /><Skeleton h={140} r={12} /></div></section>}
      {streams === null && <section class="section"><div class="empty small">{streamErr ? `Could not load the recording: ${streamErr}` : 'Connect Intervals.icu to see the recording: the route, and power, heart rate, cadence, speed and elevation through the activity.'}</div></section>}
      {streams && samples.length > 1 && (
        <>
          <section class="section">
            <h2>The recording</h2>
            <p class="faint small" style="margin:4px 0 10px">{hasRoute ? 'The orange marker on the map follows the charts; moving along the route, or tapping it, moves the charts. Green dot: start. Red: finish. ' : ''}{targets ? 'Shaded bands are the planned targets for each step.' : r.sport === 'ride' ? 'Rides done from a plan also show the planned targets as shaded bands.' : ''}</p>
            <div class={`rec-layout${hasRoute ? ' with-map' : ''}`}>
              {hasRoute && <div class="rec-map"><RouteMap samples={samples} hover={hover} onHover={setHover} height="100%" /></div>}
              <div class="rec-charts"><ActivityCharts samples={samples} targets={targets} profile={profile} hover={hover} onHover={setHover} kind={r.sport} /></div>
            </div>
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
      {((isRide && r.powerZoneSeconds?.length) || r.hrZoneSeconds?.length) && (
        <section class="section">
          <h2>Time in zone</h2>
          <p class="faint small" style="margin:4px 0 10px">How the {noun}'s time was spread across your {isRide ? 'zones' : 'heart-rate zones'}{isRide && r.powerZoneSeconds?.length && r.hrZoneSeconds?.length ? ', by power and by heart rate. Heart rate lags power, so short efforts show more in the power zones' : ''}.</p>
          <div class="panel zonepair">
            {isRide && r.powerZoneSeconds?.length ? <ZoneBars title="Power zones" seconds={r.powerZoneSeconds} /> : null}
            {r.hrZoneSeconds?.length ? <ZoneBars title="Heart-rate zones" seconds={r.hrZoneSeconds} /> : null}
          </div>
        </section>
      )}
      {isRide && streams?.watts?.length ? (
        <section class="section">
          <h2>Power distribution</h2>
          <p class="faint small" style="margin:4px 0 10px">Minutes spent in each 25-watt band, coloured by zone. A steady endurance ride is one tall hump; intervals show two.</p>
          <div class="panel"><PowerDistribution streams={streams} ftp={r.ftpAtRide ?? profile.ftp} /></div>
        </section>
      ) : null}
      {streams?.intervals?.length ? (
        <section class="section">
          <h2>{r.sport === 'strength' || r.sport === 'mobility' ? 'Sets and rests' : isRide ? 'Laps and intervals' : 'Laps'}</h2>
          <p class="faint small" style="margin:4px 0 10px">{r.sport === 'strength' ? 'Each set ended on the lap button; rests were timed. In order, with heart rate.' : r.sport === 'mobility' ? 'Each stretch or hold as the watch split it, in order.' : isRide ? 'The laps you pressed and the efforts Intervals.icu found, in order.' : 'The laps the watch recorded, in order.'}</p>
          <div class="panel" style="overflow-x:auto"><LapsTable intervals={streams.intervals} ftp={r.ftpAtRide ?? profile.ftp} lthr={profile.lthr} heartRateOnly={!isRide} /></div>
        </section>
      ) : null}
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

/** Activities by week, newest week first, each week's activities newest first. */
function groupByWeek(rides: Ride[]): Array<{ start: string; rides: Ride[] }> {
  const out: Array<{ start: string; rides: Ride[] }> = [];
  for (const r of rides) {
    const ws = weekStart(r.date);
    const g = out.find((x) => x.start === ws);
    if (g) g.rides.push(r); else out.push({ start: ws, rides: [r] });
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

/** A week of activities in the shape the kind bar reads (everything done, nothing outstanding). */
function doneOnly(rides: Ride[]): WeekSummary {
  const byKind = { ride: { done: 0, planned: 0 }, strength: { done: 0, planned: 0 }, walk: { done: 0, planned: 0 }, mobility: { done: 0, planned: 0 }, other: { done: 0, planned: 0 } };
  for (const r of rides) { byKind[r.sport ?? 'ride'].done += r.tss ?? 0; byKind[r.sport ?? 'ride'].planned += r.tss ?? 0; }
  return { start: '', days: [], plannedTss: 0, doneTss: 0, plannedMinutes: 0, doneMinutes: 0, sessionsPlanned: 0, sessionsDone: 0, byKind };
}

/** A small bar of an activity's time in each zone. */
function ZoneStrip({ seconds, power }: { seconds: number[]; power: boolean }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const title = `Time in ${power ? 'power' : 'heart-rate'} zones: ` + seconds.map((s, i) => (s / total >= 0.01 ? `Z${i + 1} ${Math.round((s / total) * 100)}%` : null)).filter(Boolean).join(', ');
  return (
    <span class="zonestrip" title={title} role="img" aria-label={title}>
      {seconds.map((s, i) => s > 0 ? <span key={i} style={`flex:${s};background:${ZONE_VAR[Math.min(i, 6)]}`} /> : null)}
    </span>
  );
}

const KIND_NOUN: Record<Ride['sport'], string> = { ride: 'ride', walk: 'walk', strength: 'session', mobility: 'session', other: 'activity' };

/** Pace for a walk or run, as minutes per mile or kilometre. */
function pace(speedMs: number | undefined, profile: { units?: string }): string | undefined {
  if (!speedMs || speedMs <= 0) return undefined;
  const secs = Math.round((profile.units === 'imperial' ? 1609.344 : 1000) / speedMs);
  return `${clock(secs)} per ${profile.units === 'imperial' ? 'mile' : 'km'}`;
}

/**
 * The numbers worth showing for the kind of activity it was. A ride gets
 * power, cadence and intensity; a walk gets distance, pace and heart rate; a
 * strength or mobility session gets its time, load and heart rate. Nothing
 * that only means something on a bike is shown for anything else.
 */
function activityNumbers(r: Ride, profile: NonNullable<AppData['profile']>, tempF?: string): Array<[string, string | number | undefined, string?]> {
  const hr: Array<[string, string | number | undefined, string?]> = [
    ['Average heart rate', r.averageHr ? `${Math.round(r.averageHr)} bpm` : undefined, `Over the whole ${KIND_NOUN[r.sport]}`],
    ['Max heart rate', r.maxHr ? `${Math.round(r.maxHr)} bpm` : undefined],
  ];
  if (r.sport === 'ride') return [
    ['Moving time', clock(r.seconds), 'Time pedalling, stops excluded'],
    ['Elapsed time', r.elapsedSeconds && r.elapsedSeconds - r.seconds >= 60 ? clock(r.elapsedSeconds) : undefined, 'Start to finish, stops included'],
    ['Distance', distance(r.distanceM, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much the ride cost you. An hour flat out at FTP is 100'],
    ['Normalized power', r.normalizedPower ? `${r.normalizedPower} W` : undefined, 'What the ride felt like in steady watts; surges count more than coasting'],
    ['Average power', r.averagePower ? `${r.averagePower} W` : undefined, 'Plain average over the whole ride, coasting included'],
    ['Intensity factor', r.intensityFactor?.toFixed(2), 'Normalized power over FTP. 0.70 is endurance, 1.00 is threshold'],
    ...hr,
    ['Average cadence', r.averageCadence ? `${Math.round(r.averageCadence)} rpm` : undefined, 'Over the whole ride, while pedalling'],
    ['Efficiency factor', r.efficiencyFactor?.toFixed(2), 'Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving'],
    ['Heart-rate drift', r.decoupling != null ? `${r.decoupling.toFixed(1)}%` : undefined, 'How much HR rose for the same power in the second half. Under 5% on a long ride is a sign of good aerobic base'],
    ['Average temperature', tempF],
    ['FTP used for this ride', r.ftpAtRide ? `${r.ftpAtRide} W` : undefined, 'The FTP on record the day you rode; TSS and intensity are relative to it'],
  ];
  if (r.sport === 'walk') return [
    ['Time', clock(r.seconds), 'Start to finish. A watch on a still arm (a treadmill, a phone in hand) can think you stopped, so its "moving time" is not used for walks'],
    ['Moving time, as the watch judged it', r.movingSeconds && r.seconds - r.movingSeconds >= 120 ? clock(r.movingSeconds) : undefined, 'Shown only when it differs; not used for anything'],
    ['Distance', distance(r.distanceM, profile)],
    ['Average pace', pace(r.averageSpeedMs, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much the walk cost you, from heart rate and time. An hour flat out at threshold is 100; an easy walk is a small fraction of that'],
    ...hr,
    ['Average temperature', tempF],
  ];
  if (r.sport === 'strength' || r.sport === 'mobility') return [
    ['Time', clock(r.seconds), 'From start to finish of the recording, rests included'],
    ['Training load (TSS)', r.tss, r.sport === 'strength' ? 'How much the session cost you, estimated from heart rate and time. Lifting loads the muscles more than the heart shows, so treat this as a floor' : 'How much the session cost you, from heart rate and time; mobility is meant to cost very little'],
    ...hr,
  ];
  return [
    ['Time', clock(r.seconds)],
    ['Distance', distance(r.distanceM, profile)],
    ['Average pace', pace(r.averageSpeedMs, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much it cost you, from heart rate and time'],
    ...hr,
    ['Average temperature', tempF],
  ];
}
