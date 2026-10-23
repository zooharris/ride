import { footLthr, rideLadders } from '../../engine/zones';
import type { HrNumbers } from '../../engine/mornings';
import type { Profile } from '../../engine/types';
/** The heart-rate numbers a day or a ride is judged by. */
function hrNumbers(p?: Profile | null): HrNumbers { return p ? { ladders: rideLadders(p), footLthr: footLthr(p) } : {}; }
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { PageHead } from '../PageHead';
import { CHART_CAPTION, DEFAULT_OVERLAYS, FitnessChart, OVERLAYS, RangePicker, RANGE_DAYS, type OverlayData, type OverlayKey, type RangeKey } from '../FitnessChart';
import { OverlayChips, parseOverlays } from '../OverlayChips';
import { askAboutChart, type ChartContext } from '../../coach/claude';
import { DAY_KIND_PHRASE, dayKind, morningsAfter, type MorningRow } from '../../engine/mornings';
import type { Fitness } from '../../engine/types';
import { LineChart } from '../LineChart';
import { BarChart } from '../BarChart';
import { db, getSetting, setSetting, type PowerCurve } from '../../data/db';
import { addDays, today } from '../../engine/load';
import { fitnessFromRides, fmtDate, weekStart } from '../derived';
import { lastPlannedDate, projectFitness, weekSummary } from '../week';
import { aerobicPoints, bestCurve, CURVE_LABELS, dailyLoad, ftpByDay, monthlyTotals, rollingDays, rollingMean, weekStreak, weeklyLoad, weeklyZones, wellnessDays } from '../../engine/progress';
import { buildPowerCurves } from '../powerCurves';
import { getActivePlan, type ActivePlan } from '../planService';
import type { Ride, SessionKind } from '../../engine/types';
import { ZONE_VAR } from '../Profile';
import { ZONE_KEY } from '../glossary';

const KINDS: Array<{ k: SessionKind; name: string; color: string }> = [
  { k: 'ride', name: 'Rides', color: 'var(--ride)' },
  { k: 'strength', name: 'Strength', color: 'var(--strength)' },
  { k: 'walk', name: 'Walks', color: 'var(--walk)' },
  { k: 'run', name: 'Runs', color: 'var(--run)' },
  { k: 'mobility', name: 'Mobility', color: 'var(--mobility)' },
];
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Progress: the long view. Every chart reads the activities and wellness
 * already synced; the range at the top applies to all of them and is
 * remembered.
 */
const RANGE_KEYS: RangeKey[] = ['6w', '3m', '6m', '1y', 'all'];

export function Progress({ data, params }: { data: AppData; params?: URLSearchParams }) {
  const profile = data.profile!;
  const t = today();
  // The chips and the range live in the URL (so Today can open this page with HRV on, and Back returns),
  // and are remembered on this device; the URL wins when it carries them.
  const urlOn = parseOverlays(params?.get('on'));
  const urlRange = RANGE_KEYS.find((k) => k === params?.get('r'));
  const [range, setRange] = useState<RangeKey>(urlRange ?? '3m');
  const [on, setOn] = useState<OverlayKey[]>(urlOn ?? DEFAULT_OVERLAYS);
  useEffect(() => {
    if (!urlRange) getSetting<RangeKey>('progressRange', '3m').then(setRange);
    if (!urlOn) getSetting<string>('progressOverlays', '').then((v) => { const k = parseOverlays(v); if (k) setOn(k); });
    // Opened with chips in the link (a readiness row, a fitness tile): bring the chart into view, after the shell's scroll to the top.
    if (urlOn) { const id = setTimeout(() => document.getElementById('fitness-card')?.scrollIntoView({ block: 'start' }), 80); return () => clearTimeout(id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writeUrl = (o: OverlayKey[], r: RangeKey) => history.replaceState(null, '', `${location.pathname}#/progress?on=${o.join(',')}&r=${r}`);
  const pick = (k: RangeKey) => { setRange(k); setSetting('progressRange', k); writeUrl(on, k); };
  const pickOn = (o: OverlayKey[]) => { setOn(o); setSetting('progressOverlays', o.join(',')); writeUrl(o, range); };
  const [active, setActive] = useState<ActivePlan | null>(null);
  useEffect(() => { getActivePlan().then(setActive); }, [data.planned.length]);

  const earliest = data.rides.length ? data.rides[data.rides.length - 1].date : addDays(t, -42);
  const from = range === 'all' ? earliest : addDays(t, -(RANGE_DAYS[range] - 1));
  const inRange = data.rides.filter((r) => r.date >= from && r.date <= t);
  const series = useMemo(() => fitnessFromRides(data.rides), [data.rides]);
  const last = series[series.length - 1];
  const projEnd = lastPlannedDate(data.planned, t);
  const projection = last && projEnd ? projectFitness(last, data.planned, data.mine, projEnd > addDays(t, 180) ? addDays(t, 180) : projEnd) : [];
  const events = active && active.goal.kind === 'event' ? [{ date: active.goalDate, label: 'event' }] : [];
  const imperial = profile.units === 'imperial';
  const overlayData: OverlayData = { rides: data.rides, wellness: data.wellness, planned: data.planned, mine: data.mine, lthr: profile.lthr, hr: hrNumbers(profile), imperial };
  const available = useMemo(() => overlayAvailability(data, from, t), [data, from, t]);

  if (!data.rides.length) {
    return (
      <div>
        <PageHead title="Progress" help="progress" />
        <div class="empty"><b>Nothing to chart yet.</b><p class="small muted">Connect Intervals.icu in Settings and press Sync on Today; the charts here fill in from your synced activities and wellness.</p></div>
      </div>
    );
  }

  return (
    <div>
      <PageHead eyebrow={`${inRange.length} activities in this range`} title="Progress" help="progress">
        <RangePicker value={range} onChange={pick} keys={['6w', '3m', '6m', '1y', 'all']} />
      </PageHead>

      {range !== 'all' && earliest > from && (
        <p class="small muted" style="margin:-8px 0 8px">Your synced history starts {fmtDate(earliest, { month: 'long', day: 'numeric', year: 'numeric' })}, so the charts start there. <a href="#/settings" style="color:var(--accent)">Load older history in Settings</a>.</p>
      )}

      <section class="section pcard" id="fitness-card">
        <div class="row between wrap" style="gap:8px;margin-bottom:6px"><h2>Fitness, fatigue and form</h2></div>
        <p class="small muted" style="margin:0 0 12px;max-width:72ch">Fitness is the 42-day weighted average of daily training load, fatigue the 7-day average, form the difference. Form mirrors fatigue because fitness moves slowly: a hard week pushes it down, a rest week lets it climb. Turn on anything below to lay it over the same days.</p>
        <div class="panel">
          <FitnessChart series={series} range={range} projection={projection} events={events} height={210} on={on.filter((k) => available[k])} data={overlayData} />
          <p class="faint small" style="margin:6px 0 0">{CHART_CAPTION}</p>
          <OverlayChips on={on} available={available} onChange={pickOn} />
        </div>
        <ChartCoach on={on.filter((k) => available[k])} range={range} from={from} to={t} series={series} data={data} />
      </section>

      <WeeklyLoadCard data={data} from={from} to={t} />

      <div class="pgrid">
        <ZonesCard rides={data.rides} from={from} to={t} />
        <PowerCurveCard rides={data.rides} from={from} ftp={profile.ftp} weightKg={profile.weightKg} />
      </div>

      <AerobicCard data={data} rides={inRange} />

      <WellnessCard data={data} from={from} to={t} />

      <MorningAfterCard data={data} from={from} to={t} />

      <ConsistencyCard rides={data.rides} />

      <TotalsCard rides={data.rides} imperial={imperial} />

      <WeightCard data={data} from={from} to={t} imperial={imperial} />
    </div>
  );
}

function Card({ title, explain, aside, children }: { title: string; explain?: string; aside?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return (
    <section class="section pcard">
      <div class="row between wrap" style="gap:8px;margin-bottom:6px"><h2>{title}</h2>{aside}</div>
      {explain && <p class="small muted" style="margin:0 0 12px;max-width:72ch">{explain}</p>}
      <div class="panel">{children}</div>
    </section>
  );
}

/** Weekly training load: done, stacked by kind, against what was planned (the dashed outline). */
function WeeklyLoadCard({ data, from, to }: { data: AppData; from: string; to: string }) {
  const weeks = weeklyLoad(data.rides, from, to, (d) => weekStart(d));
  const planned = weeks.map((w) => weekSummary(w.start, data.planned, data.rides, data.mine).plannedTss);
  const hasPlan = planned.some((p) => p > 0);
  return (
    <Card title="Weekly training load" explain={`Training load (TSS) done each week, by kind of session${hasPlan ? '; the dashed outline is what the calendar had planned for that week' : ''}.`}>
      <BarChart
        categories={weeks.map((w) => w.start)}
        series={KINDS.map((k) => ({ name: k.name, color: k.color, values: weeks.map((w) => Math.round(w.byKind[k.k])) }))}
        outline={hasPlan ? planned : undefined}
        outlineName="planned"
        xTick={(d, i) => (i === 0 || i === weeks.length - 1 || i % Math.ceil(weeks.length / 6) === 0) ? short(d) : null}
        yTitle="TSS a week"
        height={180}
        readout={(i) => { const w = weeks[i]; const parts = KINDS.filter((k) => w.byKind[k.k] > 0).map((k) => `${k.name.toLowerCase()} ${Math.round(w.byKind[k.k])}`); return `Week of ${short(w.start)} · done ${Math.round(w.total)}${parts.length ? ` (${parts.join(', ')})` : ''}${hasPlan ? ` · planned ${planned[i]}` : ''}`; }}
      />
    </Card>
  );
}

/** Ride time per zone by week, in hours or as shares. */
function ZonesCard({ rides, from, to }: { rides: Ride[]; from: string; to: string }) {
  const [share, setShare] = useState(false);
  const weeks = weeklyZones(rides, from, to, (d) => weekStart(d));
  const hours = (s: number) => Math.round((s / 3600) * 10) / 10;
  return (
    <Card title="Time in zone by week" explain="Ride time in each power zone (heart-rate zones for rides without power). Most of it in zones 1–2 with a little at 4 and above is the polarised pattern most riders do best on; a thick zone 3 is the 'grey zone'."
      aside={<div class="seg range"><button class={!share ? 'on' : ''} onClick={() => setShare(false)}>Hours</button><button class={share ? 'on' : ''} onClick={() => setShare(true)}>Share</button></div>}>
      <BarChart
        categories={weeks.map((w) => w.start)}
        series={ZONE_VAR.map((c, z) => ({ name: `Z${z + 1}`, color: c, values: weeks.map((w) => hours(w.seconds[z])) }))}
        normalise={share}
        xTick={(d, i) => (i === 0 || i === weeks.length - 1 || i % Math.ceil(weeks.length / 4) === 0) ? short(d) : null}
        yTitle={share ? 'share of ride time' : 'hours a week'}
        height={180}
        readout={(i) => { const w = weeks[i]; const tot = w.seconds.reduce((a, b) => a + b, 0) || 1; return `Week of ${short(w.start)} · ${w.seconds.map((s, z) => s > 0 ? `Z${z + 1} ${share ? `${Math.round((s / tot) * 100)}%` : `${hours(s)} h`}` : null).filter(Boolean).join(' · ') || 'no ride time'}`; }}
      />
      <p class="faint small" style="margin-top:6px">{ZONE_KEY}</p>
    </Card>
  );
}

/** Mean-maximal power from 1 s to 2 h: the best of the range against the best ever synced. */
function PowerCurveCard({ rides, from, ftp, weightKg }: { rides: Ride[]; from: string; ftp: number; weightKg: number }) {
  const [curves, setCurves] = useState<PowerCurve[]>([]);
  const [prog, setProg] = useState<{ done: number; total: number; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => db.powerCurves.toArray().then((c) => alive && setCurves(c));
    load();
    const stop = buildPowerCurves(rides, (p) => { if (!alive) return; setProg(p); if (p.done % 5 === 0 || p.done === p.total) load(); });
    return () => { alive = false; stop(); };
  }, [rides.length]);
  const withPower = curves.filter((c) => c.w.some((x) => x > 0));
  const range = bestCurve(withPower.filter((c) => c.date >= from).map((c) => c.w));
  const all = bestCurve(withPower.map((c) => c.w));
  const building = prog && prog.total > 0 && prog.done < prog.total && !prog.error;
  return (
    <Card title="Power curve" explain="Your best average power for each length of effort, from a 1-second sprint to two hours. The solid line is the best in the range above; the dashed line is the best of everything synced.">
      {withPower.length === 0 ? (
        <div class="empty small">{prog?.error ? `Could not build the curve: ${prog.error}` : building ? `Building the power curve: ${prog!.done} of ${prog!.total} rides read…` : 'Rides with a power meter draw here.'}</div>
      ) : (
        <>
          <LineChart
            series={[
              { name: 'this range', color: 'var(--accent)', values: range.map((v) => v || null), width: 2.2 },
              { name: 'all synced', color: 'var(--ink-3)', values: all.map((v) => v || null), dash: '4 3', width: 1.4 },
            ]}
            xLabels={CURVE_LABELS}
            xTick={(l) => l}
            yTitle="watts"
            refLines={[{ value: ftp, label: `FTP ${ftp}` }]}
            height={180}
            readout={(i) => `${CURVE_LABELS[i]} · this range ${range[i] || '–'} W${range[i] && weightKg ? ` (${(range[i] / weightKg).toFixed(2)} W/kg)` : ''} · all synced ${all[i] || '–'} W`}
          />
          {(building || prog?.error) && <p class="faint small" style="margin-top:6px">{prog?.error ? `Stopped: ${prog.error}` : `Still reading rides: ${prog!.done} of ${prog!.total}. The curve fills in as they arrive.`}</p>}
        </>
      )}
    </Card>
  );
}

/** Efficiency factor and heart-rate drift on steady rides of an hour or more, as two panels on one time axis. */
function AerobicCard({ data, rides }: { data: AppData; rides: Ride[] }) {
  const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
  const pts = aerobicPoints(rides, isEndurance, data.profile?.lthr, hrNumbers(data.profile).ladders?.hr);
  if (pts.length < 2) {
    return <Card title="Aerobic fitness" explain="Efficiency factor (normalized power per heartbeat) and heart-rate drift on steady rides of an hour or more."><div class="empty small">Two or more steady rides of an hour or longer in this range draw here: endurance rides with power and heart rate, at or under 78% of FTP (or zone 2 by heart rate), whose drift reading is believable.</div></Card>;
  }
  const labels = pts.map((p) => p.date);
  const tick = (d: string, i: number) => (i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 5) === 0) ? short(d) : null;
  return (
    <Card title="Aerobic fitness" explain="On steady rides of an hour or more: efficiency factor (normalized power per heartbeat) rising and heart-rate drift falling on the same kind of ride means the aerobic base is improving. Dots are single rides; the line is the average of the last five.">
      <div class="small" style="margin-bottom:2px"><b>Efficiency factor</b> <span class="faint">(watts per beat; higher is better)</span></div>
      <LineChart series={[{ name: 'ride', color: 'var(--info)', values: pts.map((p) => p.ef ?? null), dots: true }, { name: '5-ride average', color: 'var(--info)', values: rollingMean(pts.map((p) => p.ef), 5), width: 2 }]}
        xLabels={labels} xTick={tick} yTitle="watts per beat" height={130} yMin={Math.min(...pts.map((p) => p.ef ?? 99)) * 0.95}
        readout={(i) => `${short(pts[i].date)} · ${pts[i].name} · efficiency ${pts[i].ef?.toFixed(2) ?? '–'}`} />
      <div class="small" style="margin:12px 0 2px"><b>Heart-rate drift</b> <span class="faint">(% rise for the same power in the second half; under 5% is a solid base)</span></div>
      <LineChart series={[{ name: 'ride', color: 'var(--z5)', values: pts.map((p) => p.drift ?? null), dots: true }, { name: '5-ride average', color: 'var(--z5)', values: rollingMean(pts.map((p) => p.drift), 5), width: 2 }]}
        xLabels={labels} xTick={tick} yTitle="drift %" height={130} refLines={[{ value: 5, label: '5%', color: 'var(--ink-3)' }]}
        readout={(i) => `${short(pts[i].date)} · ${pts[i].name} · drift ${pts[i].drift?.toFixed(1) ?? '–'}%`} />
    </Card>
  );
}

/** HRV, resting heart rate and sleep: three panels on one time axis, each with its 7-day average. */
function WellnessCard({ data, from, to }: { data: AppData; from: string; to: string }) {
  const days = wellnessDays(data.wellness, from, to);
  if (!days.some((d) => d.w)) return <Card title="Wellness"><div class="empty small">HRV, resting heart rate and sleep draw here once Intervals.icu has wellness data from whatever records it.</div></Card>;
  const dates = days.map((d) => d.date);
  const tick = (d: string, i: number) => (i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 5) === 0) ? short(d) : null;
  const flagged = data.dayNotes.filter((n) => n.badWellness && n.date >= from && n.date <= to).length;
  const panel = (name: string, unit: string, color: string, vals: Array<number | null>, fmt: (v: number) => string, height = 110) => (
    <div style="margin-bottom:10px">
      <div class="small" style="margin-bottom:2px"><b>{name}</b> <span class="faint">({unit})</span></div>
      <LineChart series={[{ name: 'day', color, values: vals, dots: true }, { name: '7-day average', color, values: rollingDays(dates, vals, 7), width: 2 }]}
        xLabels={dates} xTick={tick} yTitle={unit} height={height} yMin={Math.min(...vals.filter((v): v is number => v != null)) * 0.9}
        readout={(i) => `${fmtDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' })} · ${vals[i] != null ? fmt(vals[i]!) : 'no reading'}${rollingDays(dates, vals, 7)[i] != null ? ` · 7-day ${fmt(rollingDays(dates, vals, 7)[i]!)}` : ''}`} />
    </div>
  );
  return (
    <Card title="Wellness" explain={`Morning readings with their 7-day average. Higher HRV and lower resting heart rate than your normal mean recovered.${flagged ? ` ${flagged} day${flagged > 1 ? 's' : ''} you marked as not real measurements ${flagged > 1 ? 'are' : 'is'} left out.` : ''}`}>
      {panel('Heart-rate variability', 'ms', 'var(--aqua)', days.map((d) => d.w?.hrv ?? null), (v) => `${Math.round(v)} ms`)}
      {panel('Resting heart rate', 'bpm', 'var(--z5)', days.map((d) => d.w?.restingHr ?? null), (v) => `${Math.round(v)} bpm`)}
      {panel('Sleep', 'hours', 'var(--info)', days.map((d) => (d.w?.sleepSeconds ? Math.round((d.w.sleepSeconds / 3600) * 10) / 10 : null)), (v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`)}
    </Card>
  );
}

/** A year of days as a grid, coloured by training load; with the active-week streak beside it. */
function ConsistencyCard({ rides }: { rides: Ride[] }) {
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const t = today();
  const end = addDays(weekStart(t), 6);
  const start = addDays(weekStart(t), -51 * 7);
  const load = dailyLoad(rides);
  const steps = [1, 40, 80, 130, 200];
  const level = (tss: number) => (tss <= 0 ? 0 : steps.filter((s) => tss >= s).length);
  const C = 12, G = 2;
  const cols = 52;
  const months: Array<{ i: number; label: string }> = [];
  for (let c = 0; c < cols; c++) { const d = addDays(start, c * 7); if (c === 0 || d.slice(8) <= '07') { if (months.length && c - months[months.length - 1].i < 3) months.pop(); months.push({ i: c, label: new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' }) }); } }
  const yearStart = `${t.slice(0, 4)}-01-01`;
  const activeDays = Array.from(load.keys()).filter((d) => d >= yearStart && d <= t).length;
  const streak = weekStreak(rides, t, (d) => weekStart(d));
  const W = 30 + cols * (C + G), H = 16 + 7 * (C + G);
  const dowLabel = (r: number) => new Date(addDays(start, r) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
  const hl = hover ? load.get(hover.date) : undefined;
  return (
    <Card title="Consistency" explain="Every day of the last year, darker for more training load. Gaps are rest days, or days nothing was recorded.">
      <div class="row wrap" style="gap:12px 28px;margin-bottom:12px">
        <div class="stat"><div class="v">{streak}</div><div class="l">week training streak</div></div>
        <div class="stat"><div class="v">{activeDays}</div><div class="l">active days so far this year</div></div>
      </div>
      <div style="overflow-x:auto;position:relative" onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block" role="img" aria-label="Training load by day over the last year">
          {months.map((m) => <text key={m.i} x={30 + m.i * (C + G)} y={10} font-size="9" fill="var(--ink-3)">{m.label}</text>)}
          {[1, 3, 5].map((r) => <text key={r} x={0} y={16 + r * (C + G) + 9} font-size="9" fill="var(--ink-3)">{dowLabel(r)}</text>)}
          {Array.from({ length: cols * 7 }, (_, k) => {
            const c = Math.floor(k / 7), r = k % 7;
            const d = addDays(start, c * 7 + r);
            if (d > end) return null;
            const e = load.get(d); const lv = level(e?.tss ?? 0);
            const future = d > t;
            return <rect key={d} x={30 + c * (C + G)} y={16 + r * (C + G)} width={C} height={C} rx="2"
              fill={lv ? 'var(--accent)' : 'var(--bg-3)'} fill-opacity={lv ? 0.2 + lv * 0.16 : future ? 0.35 : 1}
              stroke={d === t ? 'var(--today)' : 'none'} stroke-width="1.5"
              onMouseEnter={() => setHover({ date: d, x: 30 + c * (C + G), y: 16 + r * (C + G) })} />;
          })}
        </svg>
        {hover && (
          <div class="panel small" style={`position:absolute;top:${Math.max(0, hover.y - 44)}px;left:${Math.min(hover.x, W - 240)}px;padding:6px 10px;pointer-events:none;white-space:nowrap`}>
            <b>{fmtDate(hover.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b> · {hl ? `${Math.round(hl.tss)} TSS · ${hl.names.join(', ')}` : hover.date > t ? 'ahead' : 'rest'}
          </div>
        )}
      </div>
      <div class="row faint small" style="gap:6px;margin-top:8px;align-items:center">Less {[0, 1, 2, 3, 4, 5].map((l) => <span key={l} style={`display:inline-block;width:11px;height:11px;border-radius:2px;background:${l ? 'var(--accent)' : 'var(--bg-3)'};opacity:${l ? 0.2 + l * 0.16 : 1}`} />)} More</div>
    </Card>
  );
}

/** The last twelve months: hours, distance, climbing and sessions as four small bar charts. */
function TotalsCard({ rides, imperial }: { rides: Ride[]; imperial: boolean }) {
  const m = monthlyTotals(rides, today(), 12);
  const cats = m.map((x) => x.month);
  const lab = (mo: string) => new Date(mo + '-01T00:00:00').toLocaleDateString(undefined, { month: 'narrow' });
  const longLab = (mo: string) => new Date(mo + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const small = (title: string, unit: string, values: number[], f: (v: number) => string) => (
    <div>
      <div class="small" style="margin-bottom:2px"><b>{title}</b> <span class="faint">({unit})</span></div>
      <BarChart categories={cats} series={[{ name: title, color: 'var(--info)', values }]} xTick={(c) => lab(c)} yTitle={unit} height={120} partialLast
        readout={(i) => `${longLab(cats[i])}${i === cats.length - 1 ? ' (so far)' : ''} · ${f(values[i])}`} />
    </div>
  );
  return (
    <Card title="Totals by month" explain="Every activity, month by month over the last year; the current month is hatched because it is not over yet.">
      <div class="pgrid tight">
        {small('Hours', 'hours', m.map((x) => Math.round(x.hours * 10) / 10), (v) => `${v} h`)}
        {small('Distance', imperial ? 'miles' : 'km', m.map((x) => Math.round(imperial ? x.distanceM / 1609.344 : x.distanceM / 1000)), (v) => `${v} ${imperial ? 'mi' : 'km'}`)}
        {small('Climbing', imperial ? 'feet' : 'metres', m.map((x) => Math.round(imperial ? x.climbingM * 3.28084 : x.climbingM)), (v) => `${v.toLocaleString()} ${imperial ? 'ft' : 'm'}`)}
        {small('Sessions', 'count', m.map((x) => x.sessions), (v) => `${v} session${v === 1 ? '' : 's'}`)}
      </div>
      {(() => {
        // Runs on their own line: the charts above mix every kind, and a run's mile is not a ride's.
        const runs = rides.filter((r) => r.sport === 'run' && r.date.slice(0, 7) >= m[0].month);
        if (!runs.length) return null;
        const h = runs.reduce((t, r) => t + r.seconds, 0) / 3600, dm = runs.reduce((t, r) => t + (r.distanceM ?? 0), 0);
        return <p class="small" style="margin:10px 0 0"><b>Runs</b> in these twelve months: {runs.length} run{runs.length === 1 ? '' : 's'}, {h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h{dm ? `, ${Math.round(imperial ? dm / 1609.344 : dm / 1000)} ${imperial ? 'mi' : 'km'}` : ''}.</p>;
      })()}
    </Card>
  );
}

/** Body weight (7-day average) and FTP per kilo, as two panels on one time axis. */
function WeightCard({ data, from, to, imperial }: { data: AppData; from: string; to: string; imperial: boolean }) {
  const days = wellnessDays(data.wellness, from, to);
  if (!days.some((d) => d.w?.weightKg)) return null;
  const dates = days.map((d) => d.date);
  const kg = days.map((d) => d.w?.weightKg ?? null);
  const avg = rollingDays(dates, kg, 7);
  const ftp = ftpByDay(data.rides, from, to, data.profile!.ftp);
  const wkg = dates.map((_, i) => (avg[i] ? Math.round((ftp[i].ftp / avg[i]!) * 100) / 100 : null));
  const show = (v: number) => (imperial ? v * 2.20462 : v);
  const unit = imperial ? 'lb' : 'kg';
  const tick = (d: string, i: number) => (i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 5) === 0) ? short(d) : null;
  return (
    <Card title="Weight and power to weight" explain="Body weight from your wellness data, and FTP divided by it. FTP is the value on record each day (it changes when you or Intervals.icu update it).">
      <div class="small" style="margin-bottom:2px"><b>Weight</b> <span class="faint">({unit})</span></div>
      <LineChart series={[{ name: 'day', color: 'var(--aqua)', values: kg.map((v) => (v ? Math.round(show(v) * 10) / 10 : null)), dots: true }, { name: '7-day average', color: 'var(--aqua)', values: avg.map((v) => (v ? Math.round(show(v) * 10) / 10 : null)), width: 2 }]}
        xLabels={dates} xTick={tick} yTitle={unit} height={110} yMin={Math.min(...kg.filter((v): v is number => !!v).map(show)) - 2}
        readout={(i) => `${short(dates[i])} · ${kg[i] ? `${(Math.round(show(kg[i]!) * 10) / 10)} ${unit}` : 'no reading'}${avg[i] ? ` · 7-day ${Math.round(show(avg[i]!) * 10) / 10} ${unit}` : ''}`} />
      <div class="small" style="margin:12px 0 2px"><b>FTP per kilogram</b> <span class="faint">(W/kg)</span></div>
      <LineChart series={[{ name: 'W/kg', color: 'var(--accent)', values: wkg, width: 2 }]}
        xLabels={dates} xTick={tick} yTitle="W/kg" height={110} yMin={Math.min(...wkg.filter((v): v is number => v != null)) - 0.2}
        readout={(i) => `${short(dates[i])} · FTP ${ftp[i].ftp} W · ${wkg[i] ?? '–'} W/kg`} />
    </Card>
  );
}

/** Which overlays have at least three days of data in the range; fitness, fatigue and form always do. */
function overlayAvailability(data: AppData, from: string, to: string): Record<OverlayKey, boolean> {
  const rides = data.rides.filter((r) => r.date >= from && r.date <= to);
  const well = data.wellness.filter((w) => w.date >= from && w.date <= to);
  const days = (get: (w: AppData['wellness'][number]) => number | undefined) => well.filter((w) => (get(w) ?? 0) > 0).length;
  const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
  const pts = aerobicPoints(rides, isEndurance, data.profile?.lthr, hrNumbers(data.profile).ladders?.hr);
  return {
    fitness: true, fatigue: true, form: true,
    load: new Set(rides.filter((r) => (r.tss ?? 0) > 0).map((r) => r.date)).size >= 3,
    hrv: days((w) => w.hrv) >= 3, sleep: days((w) => w.sleepSeconds) >= 3, restinghr: days((w) => w.restingHr) >= 3, weight: days((w) => w.weightKg) >= 3,
    efficiency: pts.filter((p) => p.ef != null).length >= 3, drift: pts.filter((p) => p.drift != null).length >= 3,
  };
}

/** What the chart shows, in words, for the coach: one line per visible series, and the sessions in the range. */
function chartFacts(on: OverlayKey[], from: string, to: string, series: Fitness[], data: AppData): ChartContext {
  const lthr = data.profile?.lthr ?? 0;
  const imperial = data.profile?.units === 'imperial';
  const ridesOn = new Map<string, Ride[]>();
  for (const r of data.rides) { const l = ridesOn.get(r.date) ?? []; l.push(r); ridesOn.set(r.date, l); }
  const after = (d: string) => DAY_KIND_PHRASE[dayKind(ridesOn.get(addDays(d, -1)) ?? [], lthr, hrNumbers(data.profile))];
  const lines: string[] = [];
  const inRange = series.filter((f) => f.date >= from && f.date <= to);
  const fst = inRange[0], lst = inRange[inRange.length - 1];
  const fit = (label: string, get: (f: Fitness) => number) => { if (fst && lst) lines.push(`${label} (training load points): ${Math.round(get(fst))} on ${fst.date}, ${Math.round(get(lst))} today (${lst.date})`); };
  if (on.includes('fitness')) fit('Fitness', (f) => f.ctl);
  if (on.includes('fatigue')) fit('Fatigue', (f) => f.atl);
  if (on.includes('form')) fit('Form', (f) => f.tsb);
  const rides = data.rides.filter((r) => r.date >= from && r.date <= to);
  if (on.includes('load') && rides.length) {
    const load = dailyLoad(rides);
    const big = [...load.entries()].sort((a, b) => b[1].tss - a[1].tss)[0];
    lines.push(`Daily load (TSS): ${Math.round(rides.reduce((a, r) => a + (r.tss ?? 0), 0))} over the range; biggest day ${Math.round(big[1].tss)} on ${big[0]} (${big[1].names.join(', ')})`);
  }
  const wellness = data.wellness.filter((w) => w.date >= from && w.date <= to);
  const wl = (key: OverlayKey, label: string, unit: string, get: (w: AppData['wellness'][number]) => number | undefined, fmt: (v: number) => string) => {
    if (!on.includes(key)) return;
    const pts = wellness.map((w) => ({ d: w.date, v: get(w) })).filter((p): p is { d: string; v: number } => p.v != null && p.v > 0);
    if (!pts.length) return;
    const avg = rollingDays(pts.map((p) => p.d), pts.map((p) => p.v), 7);
    const lo = pts.reduce((m, p) => (p.v < m.v ? p : m)), hi = pts.reduce((m, p) => (p.v > m.v ? p : m));
    lines.push(`${label} (${unit}): 7-day average from ${fmt(avg[0] ?? pts[0].v)} to ${fmt(avg[avg.length - 1] ?? pts[pts.length - 1].v)}; lowest ${fmt(lo.v)} on ${lo.d} (${after(lo.d)}); highest ${fmt(hi.v)} on ${hi.d} (${after(hi.d)})`);
  };
  wl('hrv', 'HRV', 'ms', (w) => w.hrv, (v) => `${Math.round(v)}`);
  wl('sleep', 'Sleep', 'hours', (w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined), (v) => v.toFixed(1));
  wl('restinghr', 'Resting heart rate', 'bpm', (w) => w.restingHr, (v) => `${Math.round(v)}`);
  wl('weight', 'Weight', imperial ? 'lb' : 'kg', (w) => (w.weightKg ? (imperial ? w.weightKg * 2.20462 : w.weightKg) : undefined), (v) => v.toFixed(1));
  if (on.includes('efficiency') || on.includes('drift')) {
    const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
    const pts = aerobicPoints(rides, isEndurance, lthr, hrNumbers(data.profile).ladders?.hr);
    const ae = (key: OverlayKey, label: string, unit: string, get: (p: typeof pts[number]) => number | undefined) => {
      if (!on.includes(key)) return;
      const ps = pts.map((p) => ({ d: p.date, v: get(p) })).filter((p): p is { d: string; v: number } => p.v != null);
      if (!ps.length) return;
      const lo = ps.reduce((m, p) => (p.v < m.v ? p : m)), hi = ps.reduce((m, p) => (p.v > m.v ? p : m));
      lines.push(`${label} (${unit}, steady rides of an hour or more): first ${ps[0].v.toFixed(2)} on ${ps[0].d}, last ${ps[ps.length - 1].v.toFixed(2)} on ${ps[ps.length - 1].d}; lowest ${lo.v.toFixed(2)} on ${lo.d}; highest ${hi.v.toFixed(2)} on ${hi.d}; ${ps.length} rides`);
    };
    ae('efficiency', 'Efficiency factor', 'watts per heartbeat', (p) => p.ef);
    ae('drift', 'Heart-rate drift', '%', (p) => p.drift);
  }
  const sessions = [...rides].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60).map((r) => `${r.date} · ${r.sport} · ${Math.round(r.seconds / 60)} · ${r.tss ?? '?'}`);
  return { profile: data.profile!, date: to, from, to, lines, sessions };
}

interface ChartAnswer { q: string; a: string; at: string }

/**
 * "Ask the coach about this chart": shown only with a Claude key. The coach is
 * sent the lines on screen over this range, with the sessions. The last
 * question and answer for each set of lines and range are kept on this device.
 */
function ChartCoach({ on, range, from, to, series, data }: { on: OverlayKey[]; range: RangeKey; from: string; to: string; series: Fitness[]; data: AppData }) {
  const [key, setKey] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ChartAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `${on.join(',')}|${range}`;
  useEffect(() => { getSetting<string>('claudeKey', '').then(setKey); }, []);
  useEffect(() => { setError(null); getSetting<Record<string, ChartAnswer>>('chartChat', {}).then((m) => setAnswer(m[id] ?? null)); }, [id]);
  if (!key) return null;
  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true); setError(null);
    try {
      const a = await askAboutChart(key, chartFacts(on, from, to, series, data), q);
      const saved: ChartAnswer = { q, a, at: new Date().toISOString() };
      const all = await getSetting<Record<string, ChartAnswer>>('chartChat', {});
      await setSetting('chartChat', { ...all, [id]: saved });
      setAnswer(saved); setQuestion('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const names = OVERLAYS.filter((o) => on.includes(o.key)).map((o) => o.label.toLowerCase()).join(', ');
  return (
    <div style="margin-top:12px">
      <div class="row" style="gap:8px">
        <input value={question} aria-label="Ask the coach about this chart" placeholder="Ask the coach about this chart, e.g. does my HRV recover in time for the long ride?" onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} style="flex:1;min-width:0" disabled={busy} />
        <button class="btn primary" onClick={ask} disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
      </div>
      <p class="faint small" style="margin:6px 0 0">The coach is sent the lines on screen over this range, with your sessions. It answers here, under the chart.</p>
      {error && <p class="small" style="margin-top:10px;color:var(--bad)">No answer: {error}</p>}
      {answer && !error && (
        <div class="panel small" style="margin-top:10px;line-height:1.55">
          <div class="faint" style="margin-bottom:4px">About {names} · {answer.q}</div>
          <div><b>Coach:</b> {answer.a}</div>
        </div>
      )}
    </div>
  );
}

const KIND_ROW: Record<MorningRow['kind'], string> = { hard: 'Hard ride or run', long: 'Long ride', strength: 'Strength', run: 'Run', rest: 'Rest day' };

/** HRV, resting heart rate and sleep the morning after each kind of day, against the rider's normal for the range. */
function MorningAfterCard({ data, from, to }: { data: AppData; from: string; to: string }) {
  const rows = morningsAfter(data.rides, data.wellness, from, to, data.profile?.lthr ?? 0, hrNumbers(data.profile));
  const any = data.wellness.some((w) => w.date >= from && w.date <= to);
  // Rounded to what is shown before the sign and colour are chosen, so a difference that prints as 0 reads ±0.
  const cell = (v: number | undefined, n: number, better: (v: number) => boolean, fmt: (v: number) => string, digits = 1) => {
    if (v == null || n === 0) return <td class="r faint">–</td>;
    const thin = n < 6;
    const r = Math.round(v * 10 ** digits) / 10 ** digits;
    const colour = thin ? 'var(--ink-3)' : r === 0 ? 'var(--ink-2)' : better(r) ? 'var(--good)' : 'var(--bad)';
    return <td class="r num" style={`color:${colour}`} title={thin ? `thin evidence: ${n} mornings` : undefined}>{r > 0 ? '+' : r < 0 ? '−' : '±'}{fmt(Math.abs(r))}</td>;
  };
  return (
    <Card title="The morning after" explain="What HRV, resting heart rate and sleep look like on the mornings after each kind of day, against your normal for this range. The planner uses the same evidence when it spaces hard days.">
      <div class="mafter">
      {!any ? <div class="empty small">Draws once Intervals.icu has morning readings for this range.</div> : (
        <table class="mtable">
          <thead><tr><th>Day before</th><th class="r">HRV</th><th class="r">Resting HR</th><th class="r">Sleep</th></tr></thead>
          {rows.filter((r) => r.kind !== 'run' || r.n > 0).map((r) => (
            <tr key={r.kind}>
              <td>{KIND_ROW[r.kind]}<span class="mtable-n">{r.n} morning{r.n === 1 ? '' : 's'}</span></td>
              {cell(r.hrv, r.n, (v) => v > 0, (v) => `${v.toFixed(1)} ms`)}
              {cell(r.restingHr, r.n, (v) => v < 0, (v) => `${v.toFixed(1)} bpm`)}
              {cell(r.sleepSeconds != null ? r.sleepSeconds / 60 : undefined, r.n, (v) => v > 0, (v) => `${Math.round(v)} min`, 0)}
            </tr>
          ))}
        </table>
      )}
      <p class="faint small mtable-note">Green is better than your normal, red worse; grey rows rest on fewer than six mornings, so treat them as thin evidence. A hard ride is 40 minutes or more at 85% of FTP or above (or its heart-rate equivalent), a hard run 30 minutes or more at 85% of threshold heart rate; a long ride is 2½ hours or more; a rest day has nothing recorded. The run row appears once there are mornings after a run.</p>
      </div>
    </Card>
  );
}
