import { replaceQuery } from '../router';
import { coachConfig } from '../coachConfig';
import type { CoachConfig } from '../../coach/llm';
import { useWidth } from '../useWidth';
import { footLthr, rideLadders, ridePowerZones, zonePosition } from '../../engine/zones';
import type { HrNumbers } from '../../engine/mornings';
import type { Profile } from '../../engine/types';
/** The heart-rate numbers a day or a ride is judged by. */
function hrNumbers(p?: Profile | null): HrNumbers { return p ? { ladders: rideLadders(p), footLthr: footLthr(p) } : {}; }
import { createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { PageHead } from '../PageHead';
import { CHART_CAPTION, DEFAULT_OVERLAYS, FitnessChart, OVERLAYS, RangePicker, RANGE_DAYS, type OverlayData, type OverlayKey, type RangeKey } from '../FitnessChart';
import { OverlayChips, parseOverlays } from '../OverlayChips';
import { askAboutChart, type ChartContext } from '../../coach/claude';
import { DAY_KIND_PHRASE, dayKind, morningsAfter, type MorningRow } from '../../engine/mornings';
import type { Fitness, PlannedWorkout, Wellness } from '../../engine/types';
import { LineChart } from '../LineChart';
import { BarChart } from '../BarChart';
import { db, getSetting, setSetting, type PowerCurve } from '../../data/db';
import { addDays, today } from '../../engine/load';
import { fitnessFromRides, fmtDate, readinessSeries, weekStart } from '../derived';
import { lastPlannedDate, plannedTss, projectFitness, weekSummary } from '../week';
import { aerobicPoints, bestCurve, CURVE_LABELS, dailyLoad, ftpByDay, monthlyTotals, rollingDays, rollingMean, weekStarts, weekStreak, weeklyLoad, weeklyZones, wellnessDays } from '../../engine/progress';
import {
  BODY_GROUPS, BODY_GROUP_LABEL, BALANCE_MIN_SESSIONS, DURABILITY_MIN_RIDES, durability, enduranceBreathRate, fitnessOnDay, ftpGoal, helpful, lateKj, planDone, ramp,
  records, sampleDays, sessionsPerWeek, sevenDayLoad, strengthBalance, valueOn, weekMean, zoneMix, type Durability,
} from '../../engine/progressMore';
import { breathHistory } from '../../engine/breathHistory';
import { buildPowerCurves, curveContext } from '../powerCurves';
import { getActivePlan, type ActivePlan } from '../planService';
import type { Ride, SessionKind } from '../../engine/types';
import { ZONE_VAR } from '../Profile';
import { ZONE_KEY } from '../glossary';
import { LIBRARY } from '../../library/workouts';
import { EXERCISES } from '../../library/strength';
import { resultFromStreams, testResultKey, type TestResult } from '../../player/tests';
import { go } from '../router';
import { ProgressCoach, CardCoachLine, useProgressCoach, type ProgressCoachState } from '../ProgressCoach';
import { Measures } from '../../engine/measures';
import { LargeView, URL_KEYS, type LargeRange, type LargeTarget } from '../LargeView';

const KINDS: Array<{ k: SessionKind; name: string; color: string }> = [
  { k: 'ride', name: 'Rides', color: 'var(--ride)' },
  { k: 'strength', name: 'Strength', color: 'var(--strength)' },
  { k: 'walk', name: 'Walks', color: 'var(--walk)' },
  { k: 'run', name: 'Runs', color: 'var(--run)' },
  { k: 'mobility', name: 'Mobility', color: 'var(--mobility)' },
];
const KIND_COLOR: Record<string, string> = { ride: 'var(--ride)', strength: 'var(--strength)', walk: 'var(--walk)', run: 'var(--run)', mobility: 'var(--mobility)', other: 'var(--ink-3)' };
const KIND_NAME: Record<string, string> = { strength: 'Strength', mobility: 'Mobility', walk: 'Walks', run: 'Runs' };
const short = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** A signed number with a real minus sign; ±0 for none. */
const sg = (v: number, digits = 0) => { const r = Math.round(v * 10 ** digits) / 10 ** digits; return r > 0 ? `+${r.toFixed(digits)}` : r < 0 ? `−${Math.abs(r).toFixed(digits)}` : '±0'; };
const hm = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const PATTERN_OF = new Map(EXERCISES.map((e) => [e.name, e.pattern as string]));

/**
 * Progress: the long view (rebuilt 11 Nov 2026 to hold more, never less). A ticker of the numbers that
 * matter, every card the page had with a line of computed numbers above its chart, and the new cards:
 * Key numbers, Records, Durability, Whole body, Breathing, and the goal. Every number is worked out here;
 * the coach (when the rider has connected an AI) adds its words on top and nothing depends on it.
 * The range at the top applies to every card and is remembered.
 */
const RANGE_KEYS: RangeKey[] = ['6w', '3m', '6m', '1y', 'all'];

/** Which card's explanation is open: one at a time. */
const InfoCtx = createContext<{ open: string | null; set: (id: string | null) => void }>({ open: null, set: () => {} });

/**
 * Opening a card large (12 Nov 2026, large charts A1). `open` takes a measure (the large view) or `card:<id>` (the
 * card itself, larger); `has` says whether a measure has anything to draw; `inBig` is true inside the larger card.
 */
interface BigApi { open: (t: LargeTarget) => void; has: (measure: string) => boolean; inBig: boolean }
const BigCtx = createContext<BigApi>({ open: () => {}, has: () => false, inBig: false });

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
  const writeUrl = (o: OverlayKey[], r: RangeKey) => replaceQuery({ on: o.join(','), r });
  const pick = (k: RangeKey) => { setRange(k); setSetting('progressRange', k); writeUrl(on, k); };
  const pickOn = (o: OverlayKey[]) => { setOn(o); setSetting('progressOverlays', o.join(',')); writeUrl(o, range); };
  const [active, setActive] = useState<ActivePlan | null>(null);
  useEffect(() => { getActivePlan().then(setActive); }, [data.planned.length]);
  const [openInfo, setOpenInfo] = useState<string | null>(null);

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
  const curvesState = useCurves(data);
  const tests = useTests(data);
  const facts = useMemo(() => pageFacts({ data, from, to: t, range, series, curves: curvesState.curves, tests, plan: active, earliest }),
    [data, from, t, range, series, curvesState.curves, tests, active, earliest]);
  const coach: ProgressCoachState = useProgressCoach({ data, range, from, to: t, facts });

  // Everything the large view can draw, worked out once for the data on hand.
  const measures = useMemo(() => new Measures({
    rides: data.rides, wellness: data.wellness, series, profile, today: t, weekStartOf: (d) => weekStart(d),
    breath: curvesState.curves.filter((c) => c.breathAtPower?.length),
    isEndurance: (r) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; },
    hrZones: hrNumbers(profile).ladders?.hr,
    weightUnit: profile.units === 'imperial' ? 'lb' : 'kg', distUnit: profile.units === 'imperial' ? 'mi' : 'km',
    readiness: () => new Map(readinessSeries(data.wellness, series, data.rides, data.wellness.reduce((m, w) => (!m || w.date < m ? w.date : m), t), t).map((x) => [x.date, x.score])),
  }), [data.rides, data.wellness, series, profile, t, curvesState.curves.length, data.planned, data.mine]);
  const hardDays = useMemo(() => {
    const by = new Map<string, Ride[]>();
    for (const r of data.rides) { const l = by.get(r.date) ?? []; l.push(r); by.set(r.date, l); }
    const out = new Set<string>();
    for (const [d, l] of by) if (dayKind(l, profile.lthr ?? 0, hrNumbers(profile)) === 'hard') out.add(d);
    return out;
  }, [data.rides, profile]);
  // Which card or measure is open large: in the address, so Back from a day opened there returns to it.
  const [big, setBig] = useState<LargeTarget | null>(() => { const id = params?.get('big'); return id ? { id, card: params?.get('bc') ?? id } : null; });
  const openBig = (tg: LargeTarget) => { replaceQuery({ big: tg.id, bc: tg.card }, URL_KEYS); setBig(tg); };
  const closeBig = () => { replaceQuery({}, [...URL_KEYS, 'bc']); setBig(null); };
  const bigApi: BigApi = { open: openBig, has: (m) => measures.count(m) >= 2, inBig: false };

  const [grid, gridW] = useWidth<HTMLDivElement>(960);
  const cols = gridW >= 900 ? 3 : gridW >= 600 ? 2 : 1;

  if (!data.rides.length) {
    return (
      <div>
        <PageHead title="Progress" help="progress" />
        <div class="empty"><b>Nothing to chart yet.</b><p class="small muted">Connect Intervals.icu in Settings and press Sync on Today; the charts here fill in from your synced activities and wellness.</p></div>
      </div>
    );
  }

  const cards: GridItem[] = [
    { id: 'fitness', el: (wide) => <FitnessCard key="fitness" data={data} series={series} projection={projection} events={events} range={range} on={on} available={available} overlayData={overlayData} pickOn={pickOn} from={from} to={t} coach={coach} /> },
    { id: 'key', el: (wide) => <KeyCard key="key" rows={facts.key} coach={coach} /> },
    { id: 'load', el: (wide) => <WeeklyLoadCard key="load" data={data} from={from} to={t} readout={facts.readouts.load} coach={coach} /> },
    { id: 'zones', el: (wide) => <ZonesCard key="zones" rides={data.rides} from={from} to={t} readout={facts.readouts.zones} coach={coach} /> },
    { id: 'power', el: (wide) => <PowerCurveCard key="power" curvesState={curvesState} from={from} to={t} range={range} ftp={profile.ftp} weightKg={profile.weightKg} readout={facts.readouts.power} coach={coach} /> },
    { id: 'records', el: (wide) => <RecordsCard key="records" rows={facts.records} building={curvesState.building} readout={facts.readouts.records} coach={coach} /> },
    { id: 'durability', el: (wide) => <DurabilityCard key="durability" curves={curvesState.curves} from={from} to={t} range={range} ftp={profile.ftp} building={curvesState.building} coach={coach} /> },
    { id: 'aerobic', el: (wide) => <AerobicCard key="aerobic" wide={wide} data={data} rides={inRange} readout={facts.readouts.aerobic} coach={coach} /> },
    { id: 'wellness', el: (wide) => <WellnessCard key="wellness" wide={wide} data={data} from={from} to={t} readout={facts.readouts.wellness} coach={coach} /> },
    { id: 'morning', el: (wide) => <MorningAfterCard key="morning" data={data} from={from} to={t} readout={facts.readouts.morning} coach={coach} /> },
    { id: 'consistency', el: (wide) => <ConsistencyCard key="consistency" rides={data.rides} from={from} to={t} readout={facts.readouts.consistency} coach={coach} /> },
    { id: 'totals', el: (wide) => <TotalsCard key="totals" wide={wide} rides={data.rides} imperial={imperial} readout={facts.readouts.totals} coach={coach} /> },
  ];
  if (facts.hasWeight) cards.push({ id: 'weight', el: (wide) => <WeightCard key="weight" wide={wide} data={data} from={from} to={t} imperial={imperial} readout={facts.readouts.weight} coach={coach} /> });
  cards.push({ id: 'tests', el: (wide) => <TestsCard key="tests" data={data} tests={tests} from={from} to={t} plan={active} series={series} readout={facts.readouts.tests} coach={coach} /> });
  if (facts.hasBody) cards.push({ id: 'body', el: (wide) => <BodyCard key="body" data={data} from={from} to={t} readout={facts.readouts.body} coach={coach} /> });
  if (facts.hasBreathing) cards.push({ id: 'breathing', el: (wide) => <BreathingCard key="breathing" data={data} curves={curvesState.curves} tests={tests} from={from} to={t} readout={facts.readouts.breathing} coach={coach} /> });
  const topCards = cards.filter((c) => c.id === 'fitness' || c.id === 'key');
  const rest = cards.filter((c) => c.id !== 'fitness' && c.id !== 'key');
  // Each card's real height, measured once it is drawn, so the columns come out level. Measured again only when
  // the cards themselves change (the range, the columns, the coach's lines arriving), never while you type in one.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const measureKey = `${cols}|${rest.map((c) => c.id).join(',')}|${range}|${coach.on}|${coach.status}|${coach.written?.at ?? ''}|${curvesState.curves.length}|${tests.length}`;
  useLayoutEffect(() => {
    const box = grid.current?.querySelector('.pcols');
    if (!box) return;
    // Read with the levelling switched off, so what is measured is each card's own height.
    box.classList.add('measuring');
    const next: Record<string, number> = {};
    let changed = false;
    for (const c of rest) { const el = document.getElementById(`${c.id}-card`); if (!el) continue; next[c.id] = el.offsetHeight; if (Math.abs((heights[c.id] ?? 0) - next[c.id]) > 10) changed = true; }
    box.classList.remove('measuring');
    if (changed) setHeights(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey]);
  const columns = columnsFor(rest.map((c) => c.id), cols, heights);
  const byId = new Map(rest.map((c) => [c.id, c]));

  return (
    <InfoCtx.Provider value={{ open: openInfo, set: setOpenInfo }}>
    <BigCtx.Provider value={bigApi}>
      <div class="progress">
        <PageHead eyebrow={`${inRange.length} activities in this range`} title="Progress" help="progress">
          <RangePicker value={range} onChange={pick} keys={['6w', '3m', '6m', '1y', 'all']} />
        </PageHead>

        {range !== 'all' && earliest > from && (
          <p class="small muted" style="margin:-8px 0 8px">Your synced history starts {fmtDate(earliest, { month: 'long', day: 'numeric', year: 'numeric' })}, so the charts start there. <a href="#/settings" style="color:var(--accent)">Load older history in Settings</a>.</p>
        )}

        <Ticker cells={facts.ticker} />
        <ProgressCoach coach={coach} />

        <div class={`pwrap cols-${cols}`} ref={grid}>
          <div class="ptop">{topCards.map((c) => <div key={c.id} class={`pg-cell top-${c.id}`}>{c.el(false)}</div>)}</div>
          <div class="pcols">
            {columns.map((col, i) => <div key={i} class="pcol">{col.map((id) => <div key={id} class="pg-cell">{byId.get(id)!.el(false)}</div>)}</div>)}
          </div>
        </div>
      </div>
      {big && (big.id.startsWith('card:')
        ? (() => { const c = cards.find((x) => x.id === big.id.slice(5)); return c ? <BigCard title={CARD_TITLES[c.id] ?? ''} onClose={closeBig}><BigCtx.Provider value={{ ...bigApi, inBig: true }}>{c.el(true)}</BigCtx.Provider></BigCard> : null; })()
        : measures.def(big.id) ? <LargeView measures={measures} target={big} pageFrom={from} pageTo={t} pageRange={range as LargeRange} rides={data.rides}
            hardDays={hardDays} testDays={tests.map((x) => x.date)} asideDays={data.dayNotes.filter((n) => n.badWellness).map((n) => n.date)} coach={coach} onClose={closeBig} /> : null)}
    </BigCtx.Provider>
    </InfoCtx.Provider>
  );
}

// ---------- layout ----------

interface GridItem { id: string; el: (wide: boolean) => preact.JSX.Element }

/** Roughly how tall each card is before it has been measured (px), so the first drawing is already close. */
const CARD_HEIGHT: Record<string, number> = {
  load: 330, zones: 330, power: 340, records: 300, durability: 300, aerobic: 400, wellness: 380, morning: 270,
  consistency: 310, totals: 400, weight: 400, tests: 380, body: 380, breathing: 420,
};

/**
 * Which column each card goes in (11 Nov 2026, third pass). Cards keep their own proportions: the page no longer
 * forces a row of cards to one height. The cards are dealt in reading order, each to whichever column is shortest
 * so far; then cards are moved or exchanged between the tallest and shortest columns for as long as that brings
 * the columns closer to level (the first card of each column stays, so the page always opens the same way). What
 * little difference is left is shared out among the cards of the shorter columns, a few pixels each, so every
 * column ends on the same line and nothing hangs below the others.
 */
export function columnsFor(ids: string[], cols: number, heights: Record<string, number> = {}): string[][] {
  const n = Math.max(1, cols);
  const hOf = (id: string) => (heights[id] ?? CARD_HEIGHT[id] ?? 340) + 14;
  const out: string[][] = Array.from({ length: n }, () => []);
  const tall = out.map(() => 0);
  for (const id of ids) {
    let k = 0;
    for (let i = 1; i < n; i++) if (tall[i] < tall[k] - 1) k = i;
    out[k].push(id); tall[k] += hOf(id);
  }
  if (n > 1 && ids.length > n) {
    // Every way of dealing the remaining cards is tried (there are few enough), and the most level one kept.
    // The first card of each column stays where the plain deal put it, so the page always opens the same way.
    const fixed = out.map((c) => c[0]);
    const free = ids.filter((id) => !fixed.includes(id));
    const hs = free.map(hOf);
    const base = fixed.map(hOf);
    const total = base.reduce((x, y) => x + y, 0) + hs.reduce((x, y) => x + y, 0);
    const cap = total / n;
    let bestSpread = Infinity, bestPick: number[] = [];
    const pick: number[] = new Array(free.length).fill(0);
    const sums = [...base];
    const walk = (i: number) => {
      if (bestSpread < 6) return;
      if (i === free.length) {
        const spread = Math.max(...sums) - Math.min(...sums);
        if (spread < bestSpread) { bestSpread = spread; bestPick = [...pick]; }
        return;
      }
      for (let k = 0; k < n; k++) {
        // A column already far over its share cannot be part of a better answer.
        if (sums[k] + hs[i] > cap + bestSpread) continue;
        sums[k] += hs[i]; pick[i] = k;
        walk(i + 1);
        sums[k] -= hs[i];
      }
    };
    // Start from the plain deal's answer, so the search only ever improves on it.
    bestSpread = Math.max(...tall) - Math.min(...tall);
    bestPick = free.map((id) => out.findIndex((c) => c.includes(id)));
    walk(0);
    const next: string[][] = fixed.map((id) => [id]);
    free.forEach((id, i) => next[bestPick[i]].push(id));
    for (const col of next) col.sort((p, q) => ids.indexOf(p) - ids.indexOf(q));
    return next;
  }
  return out;
}

// ---------- the shared card ----------

function PCard({ id, title, explain, readout, aside, children, coach, foot, big }: {
  id: string; title: string; explain?: preact.ComponentChildren; readout?: preact.ComponentChildren; aside?: preact.ComponentChildren;
  children: preact.ComponentChildren; coach?: ProgressCoachState; foot?: preact.ComponentChildren;
  /** What the open-large button opens: a measure, or `card:<id>` for the card itself, larger. */
  big?: string;
}) {
  const info = useContext(InfoCtx);
  const bigApi = useContext(BigCtx);
  const canBig = !!big && !bigApi.inBig && (big.startsWith('card:') || bigApi.has(big));
  const open = info.open === id;
  const pop = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { info.set(null); btn.current?.focus(); } };
    const click = (e: MouseEvent) => { const el = e.target as Node; if (pop.current?.contains(el) || btn.current?.contains(el)) return; info.set(null); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, [open]);
  const asking = coach?.asking === id;
  return (
    <section class="pc" id={`${id}-card`}>
      <div class="pc-head">
        <h2>{title}</h2>
        {explain && <button ref={btn} class="pc-i" aria-label={`What ${title.toLowerCase()} shows`} aria-expanded={open} aria-controls={`${id}-explain`} onClick={() => info.set(open ? null : id)}>i</button>}
        {aside && <div class="pc-aside">{aside}</div>}
        {canBig && <button class="pc-big" aria-label={`Open ${title.toLowerCase()} large`} title="Open large" onClick={() => bigApi.open({ id: big!, card: id })}><BigIcon /></button>}
      </div>
      {open && explain && <div class="pc-pop small" id={`${id}-explain`} role="note" ref={pop}>{explain}</div>}
      <div class="panel pc-body">
        {readout && <div class="pc-read">{readout}</div>}
        {children}
        {foot}
        {coach && <CardCoachLine coach={coach} id={id} asking={asking} />}
      </div>
    </section>
  );
}

/**
 * A chart at its standard height, which grows by the few pixels its column needs to end level with the others
 * (and, for the fitness chart, to match Key numbers beside it). What a card asks for is always its standard height.
 */
function Fill({ initial = 170, children }: { initial?: number; min?: number; stretch?: boolean; children: (h: number) => preact.ComponentChildren }) {
  // Inside a card opened larger, its chart is drawn at nearly twice its standard height.
  const inBig = useContext(BigCtx).inBig;
  return <Stretch initial={inBig ? Math.round(initial * 1.8) : initial}>{children}</Stretch>;
}

/** The open-large mark: four arrows out of a box. */
function BigIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5h4v4M12.5 1.5 8 6M5.5 12.5h-4v-4M1.5 12.5 6 8" /></svg>;
}

/** A chart on a card that opens the card large when clicked (only where a click on the chart opens nothing else). */
function Opens({ target, card, children }: { target: string; card: string; children: preact.ComponentChildren }) {
  const b = useContext(BigCtx);
  if (b.inBig || !(target.startsWith('card:') || b.has(target))) return <>{children}</>;
  return <div class="pc-opens" onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, label')) return; b.open({ id: target, card }); }}>{children}</div>;
}

const CARD_TITLES: Record<string, string> = { power: 'Power curve', records: 'Records', durability: 'Durability', hrrecords: 'Records' };

/** A card that opens larger but has nothing to lay over it (power curve, Records, Durability): the card itself, in a wide panel. */
function BigCard({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('.lv-close')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', key);
    document.body.classList.add('lv-open');
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('lv-open'); opener?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div class="lv-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="lv lv-card" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div class="lv-head"><div class="lv-title"><h2>{title}</h2></div><div class="lv-head-ctl"><button class="btn sm lv-close" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>Close</button></div></div>
        <div class="lv-cardbody">{children}</div>
      </div>
    </div>
  );
}

function Stretch({ initial, children }: { initial: number; children: (h: number) => preact.ComponentChildren }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(initial);
  // Read through refs, so the resize watcher (set up once) never works from an earlier render's numbers:
  // a card's standard height changes when it goes from one column to two.
  const now = useRef({ h, initial });
  now.current = { h, initial };
  const tries = useRef(0), lastSize = useRef('');
  const adjust = useRef(() => {});
  adjust.current = () => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const { h: cur, initial: std } = now.current;
    // Everything in the chart that is not the plot itself (its legend, a panel's title).
    const extra = Math.max(0, i.offsetHeight - cur);
    o.style.minHeight = `${std + extra}px`;
    const size = `${o.clientWidth}x${o.clientHeight}x${std}`;
    if (size !== lastSize.current) { lastSize.current = size; tries.current = 0; }
    const want = Math.max(std, Math.round(o.clientHeight - extra));
    if (Math.abs(want - cur) > 2 && tries.current < 8) { tries.current++; setH(want); }
  };
  useLayoutEffect(() => adjust.current());
  useEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const ro = new ResizeObserver(() => adjust.current());
    ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return <div class="pfill" ref={outer}><div class="pfill-in" ref={inner}>{children(h)}</div></div>;
}

/** A table or grid in a card: it takes the card's remaining height, and a table spreads its rows over it. */
function Rest({ children }: { children: preact.ComponentChildren }) {
  return <div class="prest">{children}</div>;
}

// ---------- ticker ----------

interface Cell { label: string; value: string; change?: string; good?: boolean; card: string }

function Ticker({ cells }: { cells: Cell[] }) {
  if (!cells.length) return null;
  return (
    <div class="ticker" role="list" aria-label="The numbers that matter">
      {cells.map((c) => (
        <button key={c.label} role="listitem" class="tk" onClick={() => document.getElementById(`${c.card}-card`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label={`${c.label} ${c.value}${c.change ? `, ${c.change}` : ''}: go to its card`}>
          <span class="tk-l">{c.label}</span>
          <span class="tk-v">{c.value}{c.change && <span class={`tk-c${c.good ? ' good' : ''}`}> {c.change}</span>}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- the page's numbers, in one place (the cards' readouts and what the coach is sent) ----------

export interface KeyRow { key: string; label: string; now: string; was: string; change: string; good?: boolean; trend: Array<number | null>; card: string }
export interface PageFacts {
  ticker: Cell[];
  key: KeyRow[];
  readouts: Record<string, string>;
  records: ReturnType<typeof records>;
  hasWeight: boolean; hasBody: boolean; hasBreathing: boolean;
  /** For the coach: the range in words, the goal, and the plan's phase. */
  context: string[];
}

function pageFacts({ data, from, to, range, series, curves, tests, plan, earliest }: {
  data: AppData; from: string; to: string; range: RangeKey; series: Fitness[]; curves: PowerCurve[]; tests: TestEntry[]; plan: ActivePlan | null; earliest: string;
}): PageFacts {
  const profile = data.profile!;
  const imperial = profile.units === 'imperial';
  const ago = addDays(to, -28);
  const rides = data.rides.filter((r) => r.date >= from && r.date <= to);
  const readouts: Record<string, string> = {};
  const ticker: Cell[] = [];
  const key: KeyRow[] = [];
  const kgShow = (v: number) => (imperial ? v * 2.20462 : v);
  const kgUnit = imperial ? 'lb' : 'kg';

  // fitness, fatigue, form
  const f0 = fitnessOnDay(series, from), f1 = fitnessOnDay(series, to), fA = fitnessOnDay(series, ago);
  const inR = series.filter((f) => f.date >= from && f.date <= to);
  if (f1) {
    const ch = f0 ? f1.ctl - f0.ctl : 0;
    ticker.push({ label: 'Fitness', value: `${Math.round(f1.ctl)}`, change: f0 ? sg(ch) : undefined, good: helpful('fitness', Math.round(ch)), card: 'fitness' });
    ticker.push({ label: 'Fatigue', value: `${Math.round(f1.atl)}`, change: f0 ? sg(f1.atl - f0.atl) : undefined, card: 'fitness' });
    ticker.push({ label: 'Form', value: sg(f1.tsb), card: 'fitness' });
    const lo = inR.length ? Math.min(...inR.map((f) => f.ctl)) : f1.ctl, hi = inR.length ? Math.max(...inR.map((f) => f.ctl)) : f1.ctl;
    readouts.fitness = `Fitness ${Math.round(f1.ctl)}${f0 ? ` (${sg(f1.ctl - f0.ctl)} over the range)` : ''}, fatigue ${Math.round(f1.atl)}, form ${sg(f1.tsb)}; fitness lowest ${Math.round(lo)}, highest ${Math.round(hi)} in the range`;
  }

  // FTP and W/kg
  const ftpDays = ftpByDay(data.rides, from < ago ? from : ago, to, profile.ftp);
  const ftpAt = (d: string) => valueOn(ftpDays, d, (x) => x.ftp);
  const ftp0 = ftpAt(from) ?? profile.ftp;
  ticker.push({ label: 'FTP', value: `${profile.ftp} W`, change: ftp0 !== profile.ftp ? sg(profile.ftp - ftp0) : undefined, good: helpful('ftp', profile.ftp - ftp0), card: 'tests' });
  const wNow = weekMean(data.wellness, to, (w) => w.weightKg) ?? valueOn(data.wellness, to, (w) => w.weightKg);
  const w0 = weekMean(data.wellness, from, (w) => w.weightKg) ?? valueOn(data.wellness, from, (w) => w.weightKg);
  const wkgNow = wNow ? profile.ftp / wNow : undefined;
  const wkg0 = w0 ? ftp0 / w0 : undefined;
  if (wkgNow) ticker.push({ label: 'W/kg', value: wkgNow.toFixed(2), change: wkg0 ? sg(wkgNow - wkg0, 2) : undefined, good: wkg0 ? helpful('wkg', Math.round((wkgNow - wkg0) * 100)) : undefined, card: 'weight' });

  // this week, weeks in a row, plan done
  const ws = weekStart(to);
  const week = weekSummary(ws, data.planned, data.rides, data.mine);
  ticker.push({ label: 'This week', value: `${week.doneTss}`, change: week.plannedTss > 0 ? `of ${week.plannedTss}` : 'TSS', card: 'load' });
  const streak = weekStreak(data.rides, to, (d) => weekStart(d));
  ticker.push({ label: 'Weeks in a row', value: `${streak}`, card: 'consistency' });
  const entries = data.planned.filter((p) => p.date >= from && p.date <= to).map((p) => {
    const w = findWorkout(data.mine, p.workoutId);
    const rec = p.activityId ? data.rides.find((r) => r.id === p.activityId) : undefined;
    return { date: p.date, status: p.status, plannedTss: w ? plannedTss(w) : 0, doneTss: rec?.tss };
  });
  const pd = planDone(entries, from, to);
  if (pd.share != null) ticker.push({ label: 'Plan done', value: `${pd.share}%`, card: 'load' });

  // weekly load readout
  const weeks = weeklyLoad(data.rides, from, to, (d) => weekStart(d));
  const whole = weeks.filter((w) => addDays(w.start, 6) < to && w.start >= earliest).map((w) => w.total);
  const rp = ramp(whole);
  const big = weeks.reduce((m, w) => (w.total > (m?.total ?? -1) ? w : m), weeks[0]);
  readouts.load = [
    `this week ${week.doneTss}${week.plannedTss > 0 ? ` of ${week.plannedTss} planned` : ''}`,
    pd.share != null ? `done vs planned ${pd.share}%` : '',
    rp != null ? `ramp ${sg(rp)} TSS a week over the last six weeks` : '',
    big ? `biggest week ${Math.round(big.total)} (week of ${short(big.start)})` : '',
  ].filter(Boolean).join(' · ');

  // zones
  const mix = zoneMix(weeklyZones(data.rides, from, to, (d) => weekStart(d)));
  readouts.zones = mix ? `zones 1–2 ${mix.easy}% · zone 3 ${mix.mid}% · zone 4 and up ${mix.hard}% · ${mix.hoursPerWeek} h riding a week${mix.polarised ? ' · polarised' : ''}` : 'no ride time in this range';

  // power and records
  const withPower = curves.filter((c) => c.w.some((x) => x > 0));
  const best = bestCurve(withPower.filter((c) => c.date >= from && c.date <= to).map((c) => c.w));
  const at = (lbl: string) => best[CURVE_LABELS.indexOf(lbl)];
  readouts.power = withPower.length ? `best in this range: 5 s ${at('5s') || '–'} · 1 min ${at('1m') || '–'} · 5 min ${at('5m') || '–'} · 20 min ${at('20m') || '–'} · 1 h ${at('60m') || '–'} W` : '';
  const recs = records(withPower, from, to, earliest);
  const news = recs.filter((r) => r.isNew);
  readouts.records = news.length ? `${news.length} new all-time best${news.length > 1 ? 's' : ''} in this range (${news.map((r) => r.label).join(', ')})` : withPower.length ? 'no new all-time bests in this range' : '';

  // durability (for the coach; the card works its own out for the chosen effort)
  const prevFrom = range === 'all' ? undefined : addDays(from, -RANGE_DAYS[range]);
  const dur = durability(curves, from, to, 300, prevFrom);
  readouts.durability = durabilityWords(dur, lateKj(profile.ftp));

  // aerobic
  const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
  const pts = aerobicPoints(data.rides.filter((r) => r.date <= to), isEndurance, profile.lthr, hrNumbers(profile).ladders?.hr);
  const ptsIn = pts.filter((p) => p.date >= from);
  const avgTo = (d: string, get: (p: typeof pts[number]) => number | undefined) => { const xs = pts.filter((p) => p.date <= d).map(get).filter((v): v is number => v != null).slice(-5); return xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined; };
  const efNow = avgTo(to, (p) => p.ef), efFrom = avgTo(from, (p) => p.ef), drNow = avgTo(to, (p) => p.drift), drFrom = avgTo(from, (p) => p.drift);
  readouts.aerobic = ptsIn.length ? [`${ptsIn.length} steady ride${ptsIn.length === 1 ? '' : 's'}`, efNow != null ? `efficiency ${efNow.toFixed(2)}${efFrom != null ? ` (${sg(efNow - efFrom, 2)})` : ''}` : '', drNow != null ? `drift ${drNow.toFixed(1)}%${drFrom != null ? ` (was ${drFrom.toFixed(1)}%)` : ''}`.replace(/-/g, '−') : ''].filter(Boolean).join(' · ') : '';

  // wellness
  const wm = (d: string, get: (w: Wellness) => number | undefined) => weekMean(data.wellness, d, get);
  const hrvN = wm(to, (w) => w.hrv), hrv0 = wm(from, (w) => w.hrv), rhrN = wm(to, (w) => w.restingHr), rhr0 = wm(from, (w) => w.restingHr);
  const slN = wm(to, (w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined)), sl0 = wm(from, (w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined));
  readouts.wellness = [hrvN != null ? `HRV ${Math.round(hrvN)} ms${hrv0 != null ? ` (${sg(hrvN - hrv0)})` : ''}` : '', rhrN != null ? `resting HR ${Math.round(rhrN)} bpm${rhr0 != null ? ` (${sg(rhrN - rhr0)})` : ''}` : '', slN != null ? `sleep ${hm(slN)} a night${sl0 != null ? ` (${sg((slN - sl0) * 60)} min)` : ''}` : ''].filter(Boolean).join(' · ') + (hrvN != null || rhrN != null || slN != null ? ' · 7-day averages, change over the range' : '');

  // morning after
  const mornings = data.wellness.filter((w) => w.date >= from && w.date <= to).length;
  const mRows = morningsAfter(data.rides, data.wellness, from, to, profile.lthr ?? 0, hrNumbers(profile)).filter((r) => r.n > 0);
  readouts.morning = mornings ? `against your normal over ${mornings} mornings in this range: ${mRows.map((r) => `after ${KIND_ROW[r.kind].toLowerCase()} (${r.n} mornings) HRV ${r.hrv != null ? sg(r.hrv, 1) : '–'} ms, resting HR ${r.restingHr != null ? sg(r.restingHr, 1) : '–'}, sleep ${r.sleepSeconds != null ? sg(r.sleepSeconds / 60) : '–'} min`).join('; ')}` : '';

  // consistency
  const load = dailyLoad(data.rides);
  const heatFrom = from;
  let trained = 0, daysIn = 0;
  for (let d = heatFrom; d <= to; d = addDays(d, 1)) { daysIn++; if (load.has(d)) trained++; }
  const longest = rides.reduce((m, r) => (r.seconds > (m?.seconds ?? 0) ? r : m), undefined as Ride | undefined);
  readouts.consistency = `${streak} week${streak === 1 ? '' : 's'} in a row with training · trained ${trained} of ${daysIn} days in this range${longest ? ` · longest ${hm(longest.seconds / 3600)} (${short(longest.date)})` : ''}`;

  // totals: this calendar year so far
  const year = to.slice(0, 4);
  const yr = data.rides.filter((r) => r.date.slice(0, 4) === year);
  const yH = yr.reduce((a, r) => a + r.seconds, 0) / 3600, yD = yr.reduce((a, r) => a + (r.distanceM ?? 0), 0), yC = yr.reduce((a, r) => a + (r.elevationM ?? 0), 0);
  readouts.totals = `${year} so far: ${Math.round(yH)} h · ${Math.round(imperial ? yD / 1609.344 : yD / 1000).toLocaleString()} ${imperial ? 'mi' : 'km'} · ${Math.round(imperial ? yC * 3.28084 : yC).toLocaleString()} ${imperial ? 'ft' : 'm'} climbed · ${yr.length} sessions`;

  // weight
  const hasWeight = data.wellness.some((w) => w.date >= from && w.date <= to && w.weightKg);
  if (hasWeight && wNow) readouts.weight = `weight ${kgShow(wNow).toFixed(1)} ${kgUnit}${w0 ? ` (${sg(kgShow(wNow - w0), 1)})` : ''}${wkgNow ? ` · ${wkgNow.toFixed(2)} W/kg${wkg0 ? ` (${sg(wkgNow - wkg0, 2)})` : ''}` : ''} · 7-day averages`;

  // tests and goal
  const testsIn = tests.filter((x) => x.date >= from && x.date <= to).length;
  readouts.tests = `FTP ${profile.ftp} W${profile.ftpSetOn ? ` since ${short(profile.ftpSetOn)}` : ''} · ${testsIn} test${testsIn === 1 ? '' : 's'} in this range`;
  const context: string[] = [];
  if (plan) {
    const g = plan.goal;
    context.push(`Plan: ${plan.name}, ${short(plan.start)} to ${short(plan.goalDate)}.`);
    if (g.kind === 'ftp') {
      const fg = ftpGoal(ftpDays, to, profile.ftp, g.targetWatts, plan.goalDate);
      const words = `target FTP ${g.targetWatts} W by ${short(plan.goalDate)} · ${fg.needed} W still needed in ${fg.daysLeft} days${fg.neededPerWeek != null ? ` (${fg.neededPerWeek} W a week)` : ''}${fg.ownPerWeek != null ? ` · your last 12 weeks: ${sg(fg.ownPerWeek, 1)} W a week` : ''}${fg.verdict ? ` · ${fg.verdict}` : ''}`;
      readouts.testsGoal = words;
      context.push(`Goal: ${words}.`);
    } else if (g.kind === 'event') {
      const days = Math.max(0, Math.round((Date.parse(g.date) - Date.parse(to)) / 864e5));
      readouts.tests += ` · ${days} days to ${g.name || 'the event'}`;
      context.push(`Goal: the event ${g.name || ''} on ${short(g.date)}, ${days} days away.`);
    } else if (g.kind === 'endurance') {
      context.push(`Goal: ${g.targetHours} hours of riding a week by ${short(plan.goalDate)}.`);
      readouts.tests += ` · target ${g.targetHours} h a week`;
    } else if (g.kind === 'weight' && g.targetKg) {
      context.push(`Goal: weight ${kgShow(g.targetKg).toFixed(1)} ${kgUnit} by ${short(plan.goalDate)}.`);
      readouts.tests += ` · target weight ${kgShow(g.targetKg).toFixed(1)} ${kgUnit}`;
    } else if (g.kind === 'vo2max') context.push(`Goal: VO2max, by ${short(plan.goalDate)}.`);
  } else context.push('No plan with a goal.');

  // whole body
  const bodyItems = [...data.rides.filter((r) => r.date >= from && r.date <= to).map((r) => ({ date: r.date, kind: r.sport })),
    ...data.planned.filter((p) => p.date >= from && p.date <= to && p.status === 'completed' && !p.activityId).map((p) => ({ date: p.date, kind: (findWorkout(data.mine, p.workoutId)?.kind ?? 'other') as SessionKind }))];
  const bw = sessionsPerWeek(bodyItems, weekStarts(from, to, (d) => weekStart(d)));
  const hasBody = bw.kinds.length > 0;
  if (hasBody) {
    const bal = balanceOf(data, from, to);
    readouts.body = `${bw.kinds.map((k) => `${KIND_NAME[k].toLowerCase()} ${bw.average[k]} a week`).join(' · ')}${bal.enough ? ` · strength ${bal.balanced ? 'balanced' : `light on ${BODY_GROUP_LABEL[bal.smallest!]}`}` : ''}`;
  }

  // breathing
  const breathCurves = curves.filter((c) => c.breathAtPower?.length);
  const breathTests = tests.filter((x) => x.result?.breath?.vt1 || x.result?.breath?.vt2);
  const hasBreathing = breathCurves.length > 0 || breathTests.length > 0 || !!profile.vt1Ve;
  if (hasBreathing) readouts.breathing = breathingWords(data, breathCurves, breathTests, from, to);

  // key numbers: now, four weeks ago, change, trend over the range
  const trendN = 14;
  const row = (k: string, label: string, card: string, now: number | undefined, was: number | undefined, fmt: (v: number) => string, diff: (v: number) => string, trend: (d: string) => number | undefined, goodScale = 1) => {
    if (now == null) return;
    // Four weeks ago is before the synced history began: there is nothing to compare with.
    if (ago < earliest) was = undefined;
    const ch = was != null ? now - was : undefined;
    key.push({ key: k, label, card, now: fmt(now), was: was != null ? fmt(was) : '–', change: ch != null ? diff(ch) : '–', good: ch != null ? helpful(k, Math.round(ch * goodScale)) : undefined, trend: sampleDays(from, to, trendN, (d) => (d < earliest ? undefined : trend(d))) });
  };
  const fit = (d: string) => fitnessOnDay(series, d);
  row('fitness', 'Fitness', 'fitness', f1?.ctl, fA?.ctl, (v) => `${Math.round(v)}`, (v) => sg(v), (d) => fit(d)?.ctl);
  row('fatigue', 'Fatigue', 'fitness', f1?.atl, fA?.atl, (v) => `${Math.round(v)}`, (v) => sg(v), (d) => fit(d)?.atl);
  row('form', 'Form', 'fitness', f1?.tsb, fA?.tsb, (v) => sg(v), (v) => sg(v), (d) => fit(d)?.tsb);
  row('ftp', 'FTP', 'tests', profile.ftp, ftpAt(ago), (v) => `${Math.round(v)} W`, (v) => sg(v), (d) => ftpAt(d));
  const wkgAt = (d: string) => { const f = ftpAt(d), w = weekMean(data.wellness, d, (x) => x.weightKg); return f && w ? f / w : undefined; };
  row('wkg', 'W/kg', 'weight', wkgNow, wkgAt(ago), (v) => v.toFixed(2), (v) => sg(v, 2), wkgAt, 100);
  row('load', '7-day load', 'load', sevenDayLoad(data.rides, to), sevenDayLoad(data.rides, ago), (v) => `${Math.round(v)}`, (v) => sg(v), (d) => sevenDayLoad(data.rides, d));
  row('hrv', 'HRV', 'wellness', hrvN, wm(ago, (w) => w.hrv), (v) => `${Math.round(v)} ms`, (v) => sg(v), (d) => wm(d, (w) => w.hrv));
  row('rhr', 'Resting HR', 'wellness', rhrN, wm(ago, (w) => w.restingHr), (v) => `${Math.round(v)}`, (v) => sg(v), (d) => wm(d, (w) => w.restingHr));
  const slp = (d: string) => wm(d, (w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined));
  row('sleep', 'Sleep', 'wellness', slN, slp(ago), (v) => hm(v), (v) => `${sg(v * 60)} min`, slp, 60);
  const wt = (d: string) => wm(d, (w) => w.weightKg);
  row('weight', 'Weight', 'weight', wNow, wt(ago), (v) => `${kgShow(v).toFixed(1)} ${kgUnit}`, (v) => sg(kgShow(v), 1), wt);
  // More daily data (11 Nov 2026): only when the watch or ring sends it. Never coloured: the app makes no claim about them.
  const spo = (d: string) => wm(d, (w) => w.spO2), stp = (d: string) => wm(d, (w) => w.steps), bf = (d: string) => wm(d, (w) => w.bodyFatPct);
  const vo = (d: string) => valueOn(data.wellness, d, (w) => w.vo2max);
  row('spo2', 'Blood oxygen', 'wellness', spo(to), spo(ago), (v) => `${Math.round(v)}%`, (v) => sg(v), spo);
  row('steps', 'Steps a day', 'wellness', stp(to), stp(ago), (v) => Math.round(v).toLocaleString(), (v) => sg(v), stp);
  row('vo2watch', "VO2max, your device's", 'tests', vo(to), vo(ago), (v) => v.toFixed(1), (v) => sg(v, 1), vo);
  row('bodyfat', 'Body fat', 'weight', bf(to), bf(ago), (v) => `${v.toFixed(1)}%`, (v) => sg(v, 1), bf);
  row('ef', 'Efficiency', 'aerobic', efNow, avgTo(ago, (p) => p.ef), (v) => v.toFixed(2), (v) => sg(v, 2), (d) => avgTo(d, (p) => p.ef), 100);
  row('drift', 'HR drift', 'aerobic', drNow, avgTo(ago, (p) => p.drift), (v) => `${v.toFixed(1)}%`, (v) => sg(v, 1), (d) => avgTo(d, (p) => p.drift), 10);

  context.unshift(`Range shown: ${short(from)} to ${short(to)} (${range === 'all' ? 'all history' : range}).`);
  return { ticker, key, readouts, records: recs, hasWeight, hasBody, hasBreathing, context };
}

function durabilityWords(d: Durability, kj: number): string {
  const eff = d.effort === 300 ? '5-minute' : '20-minute';
  if (!d.enough) return `${d.rides.length} ride${d.rides.length === 1 ? '' : 's'} in this range went past ${kj} kJ with a ${eff} effort to spare on both sides; ${DURABILITY_MIN_RIDES} are needed`;
  return `late = after ${kj} kJ (an hour at FTP) · best ${eff} before ${d.before} W, after ${d.after} W · fade ${d.fade}%${d.fadeBefore != null ? ` (was ${d.fadeBefore}%)` : ''} · ${d.rides.length} rides`;
}

/** Strength sessions done in the range that the app can match to a Library or own session, and those it cannot. */
function balanceOf(data: AppData, from: string, to: string) {
  const matched: Array<{ patterns: string[] }> = [];
  const linked = new Set<string>();
  for (const p of data.planned) {
    if (p.date < from || p.date > to || p.status !== 'completed') continue;
    const w = findWorkout(data.mine, p.workoutId);
    if (!w || w.kind !== 'strength' || !w.exercises?.length) continue;
    if (p.activityId) linked.add(p.activityId);
    matched.push({ patterns: w.exercises.map((e) => PATTERN_OF.get(e.name) ?? '') });
  }
  const unmatched = data.rides.filter((r) => r.date >= from && r.date <= to && r.sport === 'strength' && !linked.has(r.id)).length;
  return strengthBalance(matched, unmatched);
}

/** The breathing thresholds from tests: the latest on or before a day. */
function testThresholds(tests: TestEntry[], d: string): { vt1?: number; vt2?: number; date?: string } {
  const t = tests.filter((x) => x.date <= d && (x.result?.breath?.vt1 || x.result?.breath?.vt2)).sort((a, b) => b.date.localeCompare(a.date))[0];
  return t ? { vt1: t.result!.breath!.vt1?.watts, vt2: t.result!.breath!.vt2?.watts, date: t.date } : {};
}

function breathingWords(data: AppData, curves: PowerCurve[], tests: TestEntry[], from: string, to: string): string {
  const now = testThresholds(tests, to), was = testThresholds(tests, addDays(from, -1));
  const hist = breathHistory(curves, data.profile!.ftp, to);
  const rates = curves.filter((c) => c.date >= from && c.date <= to).map((c) => enduranceBreathRate(c.breathAtPower)).filter((v): v is number => v != null);
  const parts = [
    now.vt1 ? `first threshold ${now.vt1} W${was.vt1 && was.vt1 !== now.vt1 ? ` (was ${was.vt1})` : ''} from the ${short(now.date!)} test` : '',
    now.vt2 ? `second ${now.vt2} W${was.vt2 && was.vt2 !== now.vt2 ? ` (was ${was.vt2})` : ''}` : '',
    hist.vt1 ? `ordinary rides read the first threshold at ${hist.vt1.watts} W` : '',
    rates.length ? `${rates[rates.length - 1]} breaths a minute at endurance power on the latest ride (${rates.length} rides)` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'breathing recorded, not yet enough for thresholds';
}

// ---------- the cards ----------

const FITNESS_EXPLAIN = 'Fitness is the 42-day weighted average of daily training load, fatigue the 7-day average, form the difference. Form mirrors fatigue because fitness moves slowly: a hard week pushes it down, a rest week lets it climb. Turn on anything below to lay it over the same days.';

function FitnessCard({ data, series, projection, events, range, on, available, overlayData, pickOn, from, to, coach }: {
  data: AppData; series: Fitness[]; projection: Fitness[]; events: Array<{ date: string; label: string }>; range: RangeKey; on: OverlayKey[]; available: Record<OverlayKey, boolean>;
  overlayData: OverlayData; pickOn: (o: OverlayKey[]) => void; from: string; to: string; coach: ProgressCoachState;
}) {
  const [day, setDay] = useState<string | null>(null);
  const shown = on.filter((k) => available[k]);
  const d = day && day <= to ? day : to;
  const f = fitnessOnDay(series, d);
  const w = data.wellness.find((x) => x.date === d);
  const load = dailyLoad(data.rides).get(d)?.tss;
  const inR = series.filter((x) => x.date >= from && x.date <= to);
  const lo = inR.length ? Math.min(...inR.map((x) => x.ctl)) : undefined, hi = inR.length ? Math.max(...inR.map((x) => x.ctl)) : undefined;
  const first = inR[0], lastF = inR[inR.length - 1];
  const val = (k: OverlayKey): string | null => {
    switch (k) {
      case 'fitness': return f ? `${Math.round(f.ctl)}` : null;
      case 'fatigue': return f ? `${Math.round(f.atl)}` : null;
      case 'form': return f ? sg(f.tsb) : null;
      case 'load': return load != null ? `${Math.round(load)} TSS` : '0';
      case 'hrv': return w?.hrv ? `${Math.round(w.hrv)} ms` : '–';
      case 'sleep': return w?.sleepSeconds ? hm(w.sleepSeconds / 3600) : '–';
      case 'restinghr': return w?.restingHr ? `${Math.round(w.restingHr)} bpm` : '–';
      case 'weight': return w?.weightKg ? `${(data.profile?.units === 'imperial' ? w.weightKg * 2.20462 : w.weightKg).toFixed(1)}` : '–';
      default: return null;
    }
  };
  const label = (k: OverlayKey) => OVERLAYS.find((o) => o.key === k)!;
  return (
    <PCard id="fitness" title="Fitness, fatigue and form" coach={coach} big="fitness"
      explain={<><p style="margin:0 0 8px">{FITNESS_EXPLAIN}</p><p style="margin:0">{CHART_CAPTION}</p></>}
      readout={<>
        <b>{day && day !== to ? fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Today'}</b>
        {shown.map((k) => { const v = val(k); return v == null ? null : <span key={k} class="pr-item"><span class="sw-dot" style={`background:${label(k).color}`} />{label(k).label} <b>{v}</b></span>; })}
        {lo != null && hi != null && <span class="pr-item faint">fitness low <b>{Math.round(lo)}</b> · high <b>{Math.round(hi)}</b>{first && lastF ? <> · <b class={lastF.ctl - first.ctl >= 1 ? 'good-t' : ''}>{sg(lastF.ctl - first.ctl)}</b> over the range</> : null}</span>}
      </>}>
      <Opens target="fitness" card="fitness"><Fill initial={240} stretch>{(h) => <FitnessChart series={series} range={range} projection={projection} events={events} height={h} on={shown} data={overlayData} onHover={setDay} />}</Fill></Opens>
      <OverlayChips on={on} available={available} onChange={pickOn} />
      <ChartCoach on={shown} range={range} from={from} to={to} series={series} data={data} coachState={coach} />
    </PCard>
  );
}

function KeyCard({ rows, coach }: { rows: KeyRow[]; coach: ProgressCoachState }) {
  const spark = (vs: Array<number | null>) => {
    const xs = vs.filter((v): v is number => v != null);
    if (xs.length < 2) return '';
    const lo = Math.min(...xs), hi = Math.max(...xs), span = hi - lo || 1;
    return vs.map((v, i) => (v == null ? null : `${(2 + (i * 52) / (vs.length - 1)).toFixed(1)},${(14 - ((v - lo) / span) * 12).toFixed(1)}`)).filter(Boolean).join(' ');
  };
  return (
    <PCard id="key" title="Key numbers" coach={coach}
      explain="Each number now, four weeks ago and the change, with its trend over the range shown. A change is green only when it moved the way training is meant to move it: fitness, FTP, watts per kilo, HRV, sleep and efficiency up; resting heart rate and drift down. Fatigue, form, load and weight are never coloured. HRV, resting heart rate, sleep and weight are 7-day averages; efficiency and drift the average of the last five steady rides. Tap a row to open that measure large.">
      <div class="kn" style={`--kn-rows:${Math.ceil(rows.length / 2) + 1}`}>
        <div class="kn-h"><span>Metric</span><span>Now</span><span>4 wk ago</span><span>Change</span><span>Trend</span></div>
        {rows.slice(0, Math.ceil(rows.length / 2)).map((r) => <KeyRowEl key={r.key} r={r} spark={spark} />)}
        <div class="kn-h second" aria-hidden="true"><span>Metric</span><span>Now</span><span>4 wk ago</span><span>Change</span><span>Trend</span></div>
        {rows.slice(Math.ceil(rows.length / 2)).map((r) => <KeyRowEl key={r.key} r={r} spark={spark} />)}
      </div>
    </PCard>
  );
}

/** The measure each Key numbers row opens large. */
const KEY_MEASURE: Record<string, string> = {
  fitness: 'fitness', fatigue: 'fatigue', form: 'form', ftp: 'ftp', wkg: 'wkg', load: 'weekLoad', hrv: 'hrv', rhr: 'restingHr', sleep: 'sleep',
  weight: 'weight', spo2: 'spo2', steps: 'steps', vo2watch: 'vo2watch', bodyfat: 'bodyFat', ef: 'ef', drift: 'drift',
};

function KeyRowEl({ r, spark }: { r: KeyRow; spark: (vs: Array<number | null>) => string }) {
  const b = useContext(BigCtx);
  const m = KEY_MEASURE[r.key];
  const opens = !!m && b.has(m) && !b.inBig;
  return (
          <button class="kn-r" onClick={() => (opens ? b.open({ id: m, card: 'key' }) : document.getElementById(`${r.card}-card`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))} aria-label={`${r.label}: ${r.now} now, ${r.was} four weeks ago, change ${r.change}. ${opens ? 'Open it large.' : 'Go to its card.'}`}>
            <span class="kn-m">{r.label}</span><span class="kn-n">{r.now}</span><span class="kn-w">{r.was}</span><span class={`kn-c${r.good === true ? ' good' : ''}`}>{r.change}</span>
            <span class="kn-t"><svg width="56" height="16" viewBox="0 0 56 16" aria-hidden="true"><polyline points={spark(r.trend)} fill="none" stroke={r.good === true ? 'var(--good)' : 'var(--info)'} stroke-width="1.6" stroke-linejoin="round" /></svg></span>
          </button>
  );
}

/** Weekly training load: done, stacked by kind, against what was planned (the dashed outline). */
function WeeklyLoadCard({ data, from, to, readout, coach }: { data: AppData; from: string; to: string; readout: string; coach: ProgressCoachState }) {
  const weeks = weeklyLoad(data.rides, from, to, (d) => weekStart(d));
  const planned = weeks.map((w) => weekSummary(w.start, data.planned, data.rides, data.mine).plannedTss);
  const hasPlan = planned.some((p) => p > 0);
  const [vsPlan, setVsPlan] = useState(true);
  coach.setExtra('load', hasPlan && vsPlan ? 'the planned load outlined behind each week' : 'load done only');
  return (
    <PCard id="load" title="Weekly training load" coach={coach} readout={readout} big="weekLoad"
      explain={`Training load (TSS) done each week, by kind of session${hasPlan ? '; the dashed outline is what the calendar had planned for that week' : ''}. Done vs planned counts each planned session done at its recorded load, and a missed one as nothing. The ramp is how much the weekly load has changed, on average, from week to week over the last six whole weeks. Tap a week to open it on the Calendar.`}
      aside={hasPlan ? <button class={`chip sm${vsPlan ? ' on' : ''}`} aria-pressed={vsPlan} onClick={() => setVsPlan(!vsPlan)}>vs planned</button> : undefined}>
      <Fill initial={180}>{(h) => <BarChart
        categories={weeks.map((w) => w.start)}
        series={KINDS.map((k) => ({ name: k.name, color: k.color, values: weeks.map((w) => Math.round(w.byKind[k.k])) }))}
        outline={hasPlan && vsPlan ? planned : undefined}
        outlineName="planned"
        xTick={(d, i) => (i === 0 || i === weeks.length - 1 || i % Math.ceil(weeks.length / 6) === 0) ? short(d) : null}
        yTitle="TSS a week"
        height={h}
        readout={(i) => { const w = weeks[i]; const parts = KINDS.filter((k) => w.byKind[k.k] > 0).map((k) => `${k.name.toLowerCase()} ${Math.round(w.byKind[k.k])}`); return `Week of ${short(w.start)} · done ${Math.round(w.total)}${parts.length ? ` (${parts.join(', ')})` : ''}${hasPlan ? ` · planned ${planned[i]}` : ''}`; }}
        onPick={(i) => go(`calendar?v=list&w=${weeks[i].start}`)} pickLabel={() => 'open the week'}
      />}</Fill>
    </PCard>
  );
}

/** Ride time per zone by week, in hours or as shares. */
function ZonesCard({ rides, from, to, readout, coach }: { rides: Ride[]; from: string; to: string; readout: string; coach: ProgressCoachState }) {
  const [share, setShare] = useState(false);
  coach.setExtra('zones', share ? 'shown as shares of each week' : 'shown in hours');
  const weeks = weeklyZones(rides, from, to, (d) => weekStart(d));
  const hours = (s: number) => Math.round((s / 3600) * 10) / 10;
  return (
    <PCard id="zones" title="Time in zone by week" coach={coach} readout={readout} big="zoneHard"
      explain={<><p style="margin:0 0 8px">Ride time in each power zone (heart-rate zones for rides without power). Most of it in zones 1–2 with a little at 4 and above is the polarised pattern most riders do best on; a thick zone 3 is the 'grey zone'. The card says polarised when at least three quarters of the time is in zones 1–2, at least 5% is at zone 4 and above, and zone 3 has less time than zone 4 and above. Tap a week to open it on the Calendar.</p><p style="margin:0">{ZONE_KEY}</p></>}
      aside={<div class="seg range sm"><button class={!share ? 'on' : ''} onClick={() => setShare(false)}>Hours</button><button class={share ? 'on' : ''} onClick={() => setShare(true)}>Share</button></div>}>
      <Fill initial={180}>{(h) => <BarChart
        categories={weeks.map((w) => w.start)}
        series={ZONE_VAR.map((c, z) => ({ name: `Z${z + 1}`, color: c, values: weeks.map((w) => hours(w.seconds[z])) }))}
        normalise={share}
        xTick={(d, i) => (i === 0 || i === weeks.length - 1 || i % Math.ceil(weeks.length / 4) === 0) ? short(d) : null}
        yTitle={share ? 'share of ride time' : 'hours a week'}
        height={h}
        readout={(i) => { const w = weeks[i]; const tot = w.seconds.reduce((a, b) => a + b, 0) || 1; return `Week of ${short(w.start)} · ${w.seconds.map((s, z) => s > 0 ? `Z${z + 1} ${share ? `${Math.round((s / tot) * 100)}%` : `${hours(s)} h`}` : null).filter(Boolean).join(' · ') || 'no ride time'}`; }}
        onPick={(i) => go(`calendar?v=list&w=${weeks[i].start}`)} pickLabel={() => 'open the week'}
      />}</Fill>
    </PCard>
  );
}

/** Every ride's power curve, read once and kept: shared by the power curve, Records, Durability and Breathing. */
interface CurvesState { curves: PowerCurve[]; building: boolean; prog: { done: number; total: number; error?: string } | null }
function useCurves(data: AppData): CurvesState {
  const [curves, setCurves] = useState<PowerCurve[]>([]);
  const [prog, setProg] = useState<{ done: number; total: number; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => db.powerCurves.toArray().then((c) => alive && setCurves(c));
    load();
    const stop = buildPowerCurves(data.rides, (p) => { if (!alive) return; setProg(p); if (p.done % 5 === 0 || p.done === p.total) load(); }, curveContext(data.profile, data.planned, (id) => findWorkout(data.mine, id)));
    return () => { alive = false; stop(); };
  }, [data.rides.length]);
  const building = !!prog && prog.total > 0 && prog.done < prog.total && !prog.error;
  return { curves, building, prog };
}

/** Mean-maximal power from 1 s to 2 h: the best of the range against the chosen comparison. */
function PowerCurveCard({ curvesState, from, to, range, ftp, weightKg, readout, coach }: { curvesState: CurvesState; from: string; to: string; range: RangeKey; ftp: number; weightKg: number; readout: string; coach: ProgressCoachState }) {
  const [cmp, setCmp] = useState<'before' | 'year' | 'all'>('all');
  const { curves, building, prog } = curvesState;
  const withPower = curves.filter((c) => c.w.some((x) => x > 0));
  const best = bestCurve(withPower.filter((c) => c.date >= from && c.date <= to).map((c) => c.w));
  const prevFrom = range === 'all' ? undefined : addDays(from, -RANGE_DAYS[range]);
  const yearStart = `${to.slice(0, 4)}-01-01`;
  const other = cmp === 'all' ? bestCurve(withPower.map((c) => c.w))
    : cmp === 'year' ? bestCurve(withPower.filter((c) => c.date >= yearStart && c.date <= to).map((c) => c.w))
    : prevFrom ? bestCurve(withPower.filter((c) => c.date >= prevFrom && c.date < from).map((c) => c.w)) : CURVE_LABELS.map(() => 0);
  const otherName = cmp === 'all' ? 'all-time best' : cmp === 'year' ? `${to.slice(0, 4)} best` : 'the range before';
  coach.setExtra('power', `compared with ${otherName}: ${CURVE_LABELS.map((l, i) => `${l} ${best[i] || '–'} vs ${other[i] || '–'} W`).join(', ')}`);
  const opts: Array<['before' | 'year' | 'all', string]> = [...(prevFrom ? [['before', 'range before'] as ['before', string]] : []), ['year', 'this year'], ['all', 'all-time']];
  return (
    <PCard id="power" title="Power curve" coach={coach} readout={readout || undefined} big={withPower.length ? 'card:power' : undefined}
      explain={`Your best average power for each length of effort, from a 1-second sprint to two hours. The solid line is the best in the range above; the dashed line is what you compare it with: the range of the same length before it, this calendar year's best, or the best of everything synced.`}
      foot={withPower.length ? <div class="pc-ctl"><span class="faint small">compare with</span>{opts.map(([k, l]) => <button key={k} class={`chip sm${cmp === k ? ' on' : ''}`} aria-pressed={cmp === k} onClick={() => setCmp(k)}>{l}</button>)}</div> : undefined}>
      {withPower.length === 0 ? (
        <div class="empty small">{prog?.error ? `Could not build the curve: ${prog.error}` : building ? `Building the power curve: ${prog!.done} of ${prog!.total} rides read…` : 'Rides with a power meter draw here.'}</div>
      ) : (
        <>
          <Opens target="card:power" card="power"><Fill initial={180}>{(h) => <LineChart
            series={[
              { name: 'this range', color: 'var(--accent)', values: best.map((v) => v || null), width: 2.2 },
              { name: otherName, color: 'var(--ink-3)', values: other.map((v) => v || null), dash: '4 3', width: 1.4 },
            ]}
            xLabels={CURVE_LABELS}
            xTick={(l) => l}
            yTitle="watts"
            refLines={[{ value: ftp, label: `FTP ${ftp}` }]}
            height={h}
            readout={(i) => `${CURVE_LABELS[i]} · this range ${best[i] || '–'} W${best[i] && weightKg ? ` (${(best[i] / weightKg).toFixed(2)} W/kg)` : ''} · ${otherName} ${other[i] || '–'} W`}
          />}</Fill></Opens>
          {(building || prog?.error) && <p class="faint small" style="margin-top:6px">{prog?.error ? `Stopped: ${prog.error}` : `Still reading rides: ${prog!.done} of ${prog!.total}. The curve fills in as they arrive.`}</p>}
        </>
      )}
    </PCard>
  );
}

function RecordsCard({ rows, building, readout, coach }: { rows: ReturnType<typeof records>; building: boolean; readout: string; coach: ProgressCoachState }) {
  const has = rows.some((r) => r.all > 0);
  return (
    <PCard id="records" title="Records" coach={coach} readout={readout || undefined} big={has ? 'card:records' : undefined}
      explain="Your best average power for standard efforts: in the range shown, this calendar year, and all-time, with the date the range's best was set. A best is marked new when it equals your all-time best and was set inside the range. Tap a row to open the ride that set it.">
      {!has ? <div class="empty small">{building ? 'Reading your rides for their best efforts…' : 'Rides with a power meter set records here.'}</div> : (
        <Rest>
          <table class="rtable">
            <thead><tr><th>Effort</th><th class="r">This range</th><th class="r">This year</th><th class="r">All-time</th><th class="r">Set</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.label} class={r.rangeRide ? 'pick' : ''} tabIndex={r.rangeRide ? 0 : undefined} onClick={() => r.rangeRide && go(`rides/${r.rangeRide}`)} onKeyDown={(e) => { if (r.rangeRide && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(`rides/${r.rangeRide}`); } }}>
                <td>{r.label}</td>
                <td class={`r num${r.isNew ? ' good-t' : ''}`}>{r.range || '–'}{r.isNew && <span class="new-tag">new</span>}</td>
                <td class="r">{r.year || '–'}</td>
                <td class="r">{r.all || '–'}</td>
                <td class="r faint">{r.rangeDate ? `${short(r.rangeDate)} ›` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </Rest>
      )}
    </PCard>
  );
}

function DurabilityCard({ curves, from, to, range, ftp, building, coach }: { curves: PowerCurve[]; from: string; to: string; range: RangeKey; ftp: number; building: boolean; coach: ProgressCoachState }) {
  const [effort, setEffort] = useState<300 | 1200>(300);
  const prevFrom = range === 'all' ? undefined : addDays(from, -RANGE_DAYS[range]);
  const d = durability(curves, from, to, effort, prevFrom);
  const kj = lateKj(ftp);
  const shown = d.rides.slice(-8);
  const eff = effort === 300 ? '5-minute' : '20-minute';
  coach.setExtra('durability', `the ${eff} effort: ${durabilityWords(d, kj)}`);
  return (
    <PCard id="durability" title="Durability" coach={coach} big={shown.length ? 'card:durability' : undefined}
      readout={d.enough ? <>after <b>{kj} kJ</b> · best {eff} before <b>{d.before} W</b>, after <b>{d.after} W</b> · fade <b class={d.fadeBefore != null && d.fade! < d.fadeBefore ? 'good-t' : ''}>{d.fade}%</b>{d.fadeBefore != null ? ` (was ${d.fadeBefore}%)` : ''}</> : undefined}
      explain={`How well your power holds late in a ride. Late begins once a ride has done the work of one hour at your FTP: for you that is ${kj} kJ. The card compares your best ${eff} power before that point with your best after it, across the range; the fade is the drop as a share of the first. The chart shows the last eight rides that went past the point with the effort to spare on both sides: the dashed outline before, the bar after. This compares the efforts you actually rode: if you never push late in a ride, the fade looks larger than it is. Tap a ride to open it.`}
      aside={<div class="seg range sm"><button class={effort === 300 ? 'on' : ''} onClick={() => setEffort(300)}>5 min</button><button class={effort === 1200 ? 'on' : ''} onClick={() => setEffort(1200)}>20 min</button></div>}>
      {!d.enough && <p class="small muted" style="margin:0 0 8px">{building ? 'Reading your rides for late efforts… ' : ''}{d.rides.length} ride{d.rides.length === 1 ? '' : 's'} in this range went past {kj} kJ with a {eff} effort to spare on both sides. {DURABILITY_MIN_RIDES} are needed for the comparison: a long ride with a hard {effort === 300 ? 'five' : 'twenty'} minutes in its first hour and again near its end counts.</p>}
      {shown.length > 0 && <Fill initial={170}>{(h) => <BarChart
        categories={shown.map((r) => r.date)}
        series={[{ name: 'after', color: 'var(--info)', values: shown.map((r) => r.after) }]}
        outline={shown.map((r) => r.before)} outlineName="before"
        xTick={(c, i) => (i === 0 || i === shown.length - 1 || shown.length <= 4) ? short(c) : null}
        yTitle="watts" height={h}
        readout={(i) => `${short(shown[i].date)} · ${eff} before ${shown[i].before} W · after ${shown[i].after} W · fade ${Math.round(((shown[i].before - shown[i].after) / shown[i].before) * 1000) / 10}%`}
        onPick={(i) => go(`rides/${shown[i].id}`)} pickLabel={() => 'open the ride'}
      />}</Fill>}
    </PCard>
  );
}

/** Efficiency factor and heart-rate drift on steady rides of an hour or more, as two panels on one time axis. */
function AerobicCard({ data, rides, readout, coach, wide }: { data: AppData; rides: Ride[]; readout: string; coach: ProgressCoachState; wide?: boolean }) {
  const isEndurance = (r: Ride) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; };
  const pts = aerobicPoints(rides, isEndurance, data.profile?.lthr, hrNumbers(data.profile).ladders?.hr);
  const explain = 'On steady rides of an hour or more: efficiency factor (normalized power per heartbeat) rising and heart-rate drift falling on the same kind of ride means the aerobic base is improving. Dots are single rides; the line is the average of the last five. Tap a ride to open it.';
  if (pts.length < 2) {
    return <PCard id="aerobic" title="Aerobic fitness" coach={coach} explain="Efficiency factor (normalized power per heartbeat) and heart-rate drift on steady rides of an hour or more."><div class="empty small">Two or more steady rides of an hour or longer in this range draw here: endurance rides with power and heart rate, at or under 78% of FTP (or zone 2 by heart rate), whose drift reading is believable.</div></PCard>;
  }
  const labels = pts.map((p) => p.date);
  const tick = (d: string, i: number) => (i === 0 || i === pts.length - 1 || i % Math.ceil(pts.length / 4) === 0) ? short(d) : null;
  const idOf = (i: number) => rides.find((r) => r.date === pts[i].date && r.name === pts[i].name)?.id;
  return (
    <PCard id="aerobic" title="Aerobic fitness" coach={coach} readout={readout} explain={explain} big="ef">
      <Fill initial={236}>{(h) => {
        const each = wide ? Math.max(90, h - 50) : Math.max(64, Math.round((h - 44) / 2));
        return (<div class={wide ? 'pmulti two' : undefined}><div>
          <div class="small" style="margin-bottom:2px"><b>Efficiency factor</b> <span class="faint">(watts per beat; higher is better)</span></div>
          <LineChart series={[{ name: 'ride', color: 'var(--info)', values: pts.map((p) => p.ef ?? null), dots: true }, { name: '5-ride average', color: 'var(--info)', values: rollingMean(pts.map((p) => p.ef), 5), width: 2 }]}
            xLabels={labels} xTick={tick} yTitle="watts per beat" height={each} yMin={Math.min(...pts.map((p) => p.ef ?? 99)) * 0.95}
            readout={(i) => `${short(pts[i].date)} · ${pts[i].name} · efficiency ${pts[i].ef?.toFixed(2) ?? '–'}`} onPick={(i) => { const id = idOf(i); if (id) go(`rides/${id}`); }} pickLabel={(i) => (idOf(i) ? 'open the ride' : null)} />
          </div><div>
          <div class="small" style={wide ? 'margin-bottom:2px' : 'margin:6px 0 2px'}><b>Heart-rate drift</b> <span class="faint">(% rise for the same power in the second half; under 5% is a solid base)</span></div>
          <LineChart series={[{ name: 'ride', color: 'var(--z5)', values: pts.map((p) => p.drift ?? null), dots: true }, { name: '5-ride average', color: 'var(--z5)', values: rollingMean(pts.map((p) => p.drift), 5), width: 2 }]}
            xLabels={labels} xTick={tick} yTitle="drift %" height={each} refLines={[{ value: 5, label: '5%', color: 'var(--ink-3)' }]}
            readout={(i) => `${short(pts[i].date)} · ${pts[i].name} · drift ${pts[i].drift?.toFixed(1) ?? '–'}%`} onPick={(i) => { const id = idOf(i); if (id) go(`rides/${id}`); }} pickLabel={(i) => (idOf(i) ? 'open the ride' : null)} />
        </div></div>);
      }}</Fill>
    </PCard>
  );
}

/** HRV, resting heart rate and sleep: three panels on one time axis, each with its 7-day average. */
function WellnessCard({ data, from, to, readout, coach, wide }: { data: AppData; from: string; to: string; readout: string; coach: ProgressCoachState; wide?: boolean }) {
  const days = wellnessDays(data.wellness, from, to);
  if (!days.some((d) => d.w)) return <PCard id="wellness" title="Wellness" coach={coach}><div class="empty small">HRV, resting heart rate and sleep draw here once Intervals.icu has wellness data from whatever records it.</div></PCard>;
  const dates = days.map((d) => d.date);
  const tick = (d: string, i: number) => (i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 4) === 0) ? short(d) : null;
  const flagged = data.dayNotes.filter((n) => n.badWellness && n.date >= from && n.date <= to).length;
  const panel = (name: string, unit: string, color: string, vals: Array<number | null>, fmt: (v: number) => string, height: number, measure: string) => (
    <Opens key={measure} target={measure} card="wellness"><div style="margin-bottom:4px;min-width:0">
      <div class="small" style="margin-bottom:1px"><b>{name}</b> <span class="faint">({unit})</span></div>
      <LineChart series={[{ name: 'day', color, values: vals, dots: true, hideInLegend: true }, { name: '7-day average', color, values: rollingDays(dates, vals, 7), width: 2, hideInLegend: true }]}
        xLabels={dates} xTick={tick} yTitle={unit} height={height} yMin={Math.min(...vals.filter((v): v is number => v != null)) * 0.9}
        readout={(i) => `${fmtDate(dates[i], { weekday: 'short', month: 'short', day: 'numeric' })} · ${vals[i] != null ? fmt(vals[i]!) : 'no reading'}${rollingDays(dates, vals, 7)[i] != null ? ` · 7-day ${fmt(rollingDays(dates, vals, 7)[i]!)}` : ''}`} />
    </div></Opens>
  );
  const firstWith = ['hrv', 'restingHr', 'sleep'].find((k, i) => days.some((d) => (i === 0 ? d.w?.hrv : i === 1 ? d.w?.restingHr : d.w?.sleepSeconds))) ?? 'hrv';
  return (
    <PCard id="wellness" title="Wellness" coach={coach} readout={readout || undefined} big={firstWith}
      explain={`Morning readings: dots are single mornings, the line is the 7-day average. Higher HRV and lower resting heart rate than your normal mean recovered.${flagged ? ` ${flagged} day${flagged > 1 ? 's' : ''} you marked as not real measurements ${flagged > 1 ? 'are' : 'is'} left out.` : ''}`}>
      <Fill initial={270}>{(h) => {
        // Side by side when the card has two columns to itself; stacked otherwise.
        const each = wide ? Math.max(90, h - 24) : Math.round((h - 72) / 3);
        return (<div class={wide ? 'pmulti three' : undefined}>
          {panel('Heart-rate variability', 'ms', 'var(--aqua)', days.map((d) => d.w?.hrv ?? null), (v) => `${Math.round(v)} ms`, each, 'hrv')}
          {panel('Resting heart rate', 'bpm', 'var(--z5)', days.map((d) => d.w?.restingHr ?? null), (v) => `${Math.round(v)} bpm`, each, 'restingHr')}
          {panel('Sleep', 'hours', 'var(--info)', days.map((d) => (d.w?.sleepSeconds ? Math.round((d.w.sleepSeconds / 3600) * 10) / 10 : null)), (v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, each, 'sleep')}
        </div>);
      }}</Fill>
    </PCard>
  );
}

/** A year of days as a grid, coloured by training load; with the week streak and the range's numbers beside it. */
function ConsistencyCard({ rides, from, to, readout, coach }: { rides: Ride[]; from: string; to: string; readout: string; coach: ProgressCoachState }) {
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const [box, boxW] = useWidth(758);
  const t = today();
  const end = addDays(weekStart(t), 6);
  const load = dailyLoad(rides);
  const steps = [1, 40, 80, 130, 200];
  const level = (tss: number) => (tss <= 0 ? 0 : steps.filter((s) => tss >= s).length);
  const C = 12, G = 2;
  // A year of weeks where there is room; on a phone, the most recent weeks that fit.
  const cols = Math.max(8, Math.min(52, Math.floor((boxW - 30) / (C + G))));
  const start = addDays(weekStart(t), -(cols - 1) * 7);
  const months: Array<{ i: number; label: string }> = [];
  for (let c = 0; c < cols; c++) { const d = addDays(start, c * 7); if (c === 0 || d.slice(8) <= '07') { if (months.length && c - months[months.length - 1].i < 3) months.pop(); months.push({ i: c, label: new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short' }) }); } }
  const yearStart = `${t.slice(0, 4)}-01-01`;
  const activeDays = Array.from(load.keys()).filter((d) => d >= yearStart && d <= t).length;
  const streak = weekStreak(rides, t, (d) => weekStart(d));
  const W = 30 + cols * (C + G), H = 16 + 7 * (C + G);
  const dowLabel = (r: number) => new Date(addDays(start, r) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
  const hl = hover ? load.get(hover.date) : undefined;
  let trained = 0, daysIn = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { daysIn++; if (load.has(d)) trained++; }
  const inR = rides.filter((r) => r.date >= from && r.date <= to);
  const longest = inR.reduce((m, r) => (r.seconds > (m?.seconds ?? 0) ? r : m), undefined as Ride | undefined);
  const weeks = weeklyLoad(rides, from, to, (d) => weekStart(d));
  const big = weeks.reduce((m, w) => (w.total > (m?.total ?? -1) ? w : m), weeks[0]);
  return (
    <PCard id="consistency" title="Consistency" coach={coach} readout={readout}
      explain={`Every day of the last ${cols >= 52 ? 'year' : `${cols} weeks`}, darker for more training load. Gaps are rest days, or days nothing was recorded. Weeks in a row counts weeks with any training up to this one; it is not broken by rest days, so resting never costs you the streak. The boxes count the range shown. Tap a day to open its week on the Calendar.`}>
      <div class="stat-boxes">
        <div class="sbox"><div class="l">Weeks in a row</div><div class="v">{streak}</div></div>
        <div class="sbox"><div class="l">Days trained</div><div class="v">{trained} <span class="faint" style="font-weight:500">of {daysIn}</span></div></div>
        <div class="sbox"><div class="l">Longest</div><div class="v">{longest ? hm(longest.seconds / 3600) : '–'}</div></div>
        <div class="sbox"><div class="l">Biggest week</div><div class="v">{big ? Math.round(big.total) : '–'}</div></div>
      </div>
      <Rest>
          <div ref={box} style="position:relative;margin:auto 0" onMouseLeave={() => setHover(null)}>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style="display:block;cursor:pointer" role="img" aria-label="Training load by day over the last year">
              {months.map((m) => <text key={m.i} x={30 + m.i * (C + G)} y={10} font-size="9" fill="var(--ink-3)">{m.label}</text>)}
              {[1, 3, 5].map((r) => <text key={r} x={0} y={16 + r * (C + G) + 9} font-size="9" fill="var(--ink-3)">{dowLabel(r)}</text>)}
              {Array.from({ length: cols * 7 }, (_, k) => {
                const c = Math.floor(k / 7), r = k % 7;
                const d = addDays(start, c * 7 + r);
                if (d > end) return null;
                const e = load.get(d); const lv = level(e?.tss ?? 0);
                const future = d > t;
                return <rect key={d} x={30 + c * (C + G)} y={16 + r * (C + G)} width={C} height={C} rx="2"
                  fill={lv ? 'var(--accent)' : 'var(--soft)'} fill-opacity={lv ? 0.2 + lv * 0.16 : future ? 0.35 : 1}
                  stroke={d === t ? 'var(--today)' : 'none'} stroke-width="1.5"
                  onMouseEnter={() => setHover({ date: d, x: 30 + c * (C + G), y: 16 + r * (C + G) })}
                  onClick={() => go(`calendar?v=list&w=${weekStart(d)}`)} />;
              })}
            </svg>
            {hover && (
              <div class="panel small" style={`position:absolute;top:${Math.max(0, hover.y - 44)}px;left:${Math.max(0, Math.min(hover.x, W - 240))}px;padding:6px 10px;pointer-events:none;white-space:nowrap;z-index:2`}>
                <b>{fmtDate(hover.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b> · {hl ? `${Math.round(hl.tss)} TSS · ${hl.names.join(', ')}` : hover.date > t ? 'ahead' : 'rest'}
              </div>
            )}
          </div>
          <div class="row faint small" style="gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">Less {[0, 1, 2, 3, 4, 5].map((l) => <span key={l} style={`display:inline-block;width:11px;height:11px;border-radius:2px;background:${l ? 'var(--accent)' : 'var(--soft)'};opacity:${l ? 0.2 + l * 0.16 : 1}`} />)} More <span style="margin-left:auto">{activeDays} active days so far this year</span></div>
      </Rest>
    </PCard>
  );
}

/** The last twelve months: hours, distance, climbing and sessions as four small bar charts, with last year's beside when asked. */
function TotalsCard({ rides, imperial, readout, coach, wide }: { rides: Ride[]; imperial: boolean; readout: string; coach: ProgressCoachState; wide?: boolean }) {
  const [vsLast, setVsLast] = useState(false);
  coach.setExtra('totals', vsLast ? 'the same months a year before outlined' : 'the last twelve months');
  const m24 = monthlyTotals(rides, today(), 24);
  const m = m24.slice(12), prev = m24.slice(0, 12);
  const hasPrev = prev.some((x) => x.sessions > 0);
  const cats = m.map((x) => x.month);
  const lab = (mo: string) => new Date(mo + '-01T00:00:00').toLocaleDateString(undefined, { month: 'narrow' });
  const longLab = (mo: string) => new Date(mo + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const small = (title: string, unit: string, get: (x: typeof m[number]) => number, f: (v: number) => string, h: number) => {
    const values = m.map(get), before = prev.map(get);
    const bi = values.indexOf(Math.max(...values));
    return (
      <div>
        <div class="small" style="margin-bottom:1px;display:flex;justify-content:space-between;gap:6px"><span><b>{title}</b> <span class="faint">({unit})</span></span><span class="faint">best {lab(cats[bi])}{new Date(cats[bi] + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' }).slice(1)}, {f(values[bi])}</span></div>
        <BarChart categories={cats} series={[{ name: title, color: 'var(--info)', values }]} outline={vsLast && hasPrev ? before : undefined} outlineName="a year before" xTick={(c) => lab(c)} yTitle={unit} height={h} partialLast
          readout={(i) => `${longLab(cats[i])}${i === cats.length - 1 ? ' (so far)' : ''} · ${f(values[i])}${vsLast && hasPrev ? ` · a year before ${f(before[i])}` : ''}`} />
      </div>
    );
  };
  return (
    <PCard id="totals" title="Totals by month" coach={coach} readout={readout} big="weekHours"
      explain={`Every activity, month by month over the last year; the current month is hatched because it is not over yet.${hasPrev ? ' "vs last year" outlines the same month a year before behind each bar.' : ''}`}
      aside={hasPrev ? <button class={`chip sm${vsLast ? ' on' : ''}`} aria-pressed={vsLast} onClick={() => setVsLast(!vsLast)}>vs last year</button> : undefined}>
      <Opens target="weekHours" card="totals"><Fill initial={260}>{(h) => {
        // Four across when the card has two columns to itself; two by two otherwise.
        const each = wide ? Math.max(90, h - 22) : Math.max(70, Math.round((h - 60) / 2));
        return (
          <div class={wide ? 'pmulti four' : 'pmulti two'}>
            {small('Hours', 'hours', (x) => Math.round(x.hours * 10) / 10, (v) => `${v} h`, each)}
            {small('Distance', imperial ? 'miles' : 'km', (x) => Math.round(imperial ? x.distanceM / 1609.344 : x.distanceM / 1000), (v) => `${v.toLocaleString()} ${imperial ? 'mi' : 'km'}`, each)}
            {small('Climbing', imperial ? 'feet' : 'metres', (x) => Math.round(imperial ? x.climbingM * 3.28084 : x.climbingM), (v) => `${v.toLocaleString()} ${imperial ? 'ft' : 'm'}`, each)}
            {small('Sessions', 'count', (x) => x.sessions, (v) => `${v}`, each)}
          </div>
        );
      }}</Fill></Opens>
      {(() => {
        // Runs on their own line: the charts above mix every kind, and a run's mile is not a ride's.
        const runs = rides.filter((r) => r.sport === 'run' && r.date.slice(0, 7) >= m[0].month);
        if (!runs.length) return null;
        const h = runs.reduce((t, r) => t + r.seconds, 0) / 3600, dm = runs.reduce((t, r) => t + (r.distanceM ?? 0), 0);
        return <p class="small" style="margin:6px 0 0"><b>Runs</b> in these twelve months: {runs.length} run{runs.length === 1 ? '' : 's'}, {h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h{dm ? `, ${Math.round(imperial ? dm / 1609.344 : dm / 1000)} ${imperial ? 'mi' : 'km'}` : ''}.</p>;
      })()}
    </PCard>
  );
}

/** Body weight (7-day average) and FTP per kilo, as two panels on one time axis. */
function WeightCard({ data, from, to, imperial, readout, coach, wide }: { data: AppData; from: string; to: string; imperial: boolean; readout?: string; coach: ProgressCoachState; wide?: boolean }) {
  const days = wellnessDays(data.wellness, from, to);
  if (!days.some((d) => d.w?.weightKg)) return null;
  const dates = days.map((d) => d.date);
  const kg = days.map((d) => d.w?.weightKg ?? null);
  const avg = rollingDays(dates, kg, 7);
  const ftp = ftpByDay(data.rides, from, to, data.profile!.ftp);
  const wkg = dates.map((_, i) => (avg[i] ? Math.round((ftp[i].ftp / avg[i]!) * 100) / 100 : null));
  const show = (v: number) => (imperial ? v * 2.20462 : v);
  const unit = imperial ? 'lb' : 'kg';
  const tick = (d: string, i: number) => (i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 4) === 0) ? short(d) : null;
  return (
    <PCard id="weight" title="Weight and power to weight" coach={coach} readout={readout} big="weight"
      explain="Body weight from your wellness data, and FTP divided by it. FTP is the value on record each day (it changes when you or Intervals.icu update it). Weight changes are never marked good or bad.">
      <Fill initial={236}>{(h) => {
        const each = wide ? Math.max(90, h - 50) : Math.max(60, Math.round((h - 44) / 2));
        return (<div class={wide ? 'pmulti two' : undefined}><Opens target="weight" card="weight"><div>
          <div class="small" style="margin-bottom:1px"><b>Weight</b> <span class="faint">({unit})</span></div>
          <LineChart series={[{ name: 'day', color: 'var(--aqua)', values: kg.map((v) => (v ? Math.round(show(v) * 10) / 10 : null)), dots: true }, { name: '7-day average', color: 'var(--aqua)', values: avg.map((v) => (v ? Math.round(show(v) * 10) / 10 : null)), width: 2 }]}
            xLabels={dates} xTick={tick} yTitle={unit} height={each} yMin={Math.min(...kg.filter((v): v is number => !!v).map(show)) - 2}
            readout={(i) => `${short(dates[i])} · ${kg[i] ? `${(Math.round(show(kg[i]!) * 10) / 10)} ${unit}` : 'no reading'}${avg[i] ? ` · 7-day ${Math.round(show(avg[i]!) * 10) / 10} ${unit}` : ''}`} />
          </div></Opens><Opens target="wkg" card="weight"><div>
          <div class="small" style={wide ? 'margin-bottom:1px' : 'margin:6px 0 1px'}><b>FTP per kilogram</b> <span class="faint">(W/kg)</span></div>
          <LineChart series={[{ name: 'W/kg', color: 'var(--accent)', values: wkg, width: 2 }]}
            xLabels={dates} xTick={tick} yTitle="W/kg" height={each} yMin={Math.min(...wkg.filter((v): v is number => v != null)) - 0.2}
            readout={(i) => `${short(dates[i])} · FTP ${ftp[i].ftp} W · ${wkg[i] ?? '–'} W/kg`} />
        </div></Opens></div>);
      }}</Fill>
    </PCard>
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
    readiness: readinessSeries(data.wellness, fitnessFromRides(data.rides), data.rides, from, to).length >= 3,
    hrv: days((w) => w.hrv) >= 3, sleep: days((w) => w.sleepSeconds) >= 3, restinghr: days((w) => w.restingHr) >= 3, weight: days((w) => w.weightKg) >= 3,
    efficiency: pts.filter((p) => p.ef != null).length >= 3, drift: pts.filter((p) => p.drift != null).length >= 3,
  };
}

/** What the chart shows, in words, for the coach: one line per visible series, and the sessions in the range. */
export function chartFacts(on: OverlayKey[], from: string, to: string, series: Fitness[], data: AppData): ChartContext {
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
  if (on.includes('readiness')) {
    const rs = readinessSeries(data.wellness, series, data.rides, from, to);
    if (rs.length) {
      const lo = rs.reduce((m, p) => (p.score < m.score ? p : m)), hi = rs.reduce((m, p) => (p.score > m.score ? p : m));
      const count = (b: string) => rs.filter((r) => r.band === b).length;
      lines.push(`Readiness (0–100; Ready 65+, Ease off 50–64, Keep it easy 35–49, Rest under 35; worked out on today's calibration for every day): ${rs[0].score} on ${rs[0].date}, ${rs[rs.length - 1].score} on ${rs[rs.length - 1].date}; lowest ${lo.score} on ${lo.date} (${after(lo.date)}); highest ${hi.score} on ${hi.date}; ${count('go')} Ready days, ${count('ease')} Ease off, ${count('easy')} Keep it easy, ${count('rest')} Rest`);
    }
  }
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
 * The fitness chart's own question (as before 11 Nov): shown only with an AI connected, and only while
 * the card's "Ask the coach" is open. The coach is sent the lines on screen over this range, with the
 * sessions. The last question and answer for each set of lines and range are kept on this device.
 */
function ChartCoach({ on, range, from, to, series, data, coachState }: { on: OverlayKey[]; range: RangeKey; from: string; to: string; series: Fitness[]; data: AppData; coachState: ProgressCoachState }) {
  const [key, setKey] = useState<CoachConfig | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ChartAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `${on.join(',')}|${range}`;
  useEffect(() => { void coachConfig().then(setKey); }, []);
  useEffect(() => { setError(null); getSetting<Record<string, ChartAnswer>>('chartChat', {}).then((m) => setAnswer(m[id] ?? null)); }, [id]);
  if (!key || coachState.asking !== 'fitness') return null;
  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true); setError(null);
    try {
      const a = await askAboutChart(key!, chartFacts(on, from, to, series, data), q);
      const saved: ChartAnswer = { q, a, at: new Date().toISOString() };
      const all = await getSetting<Record<string, ChartAnswer>>('chartChat', {});
      await setSetting('chartChat', { ...all, [id]: saved });
      setAnswer(saved); setQuestion('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const names = OVERLAYS.filter((o) => on.includes(o.key)).map((o) => o.label.toLowerCase()).join(', ');
  return (
    <div class="card-ask">
      <div class="row" style="gap:8px">
        <input value={question} aria-label="Ask the coach about this chart" placeholder="Ask about this chart, e.g. does my HRV recover in time for the long ride?" onInput={(e) => setQuestion((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }} style="flex:1;min-width:0" disabled={busy} />
        <button class="btn primary sm" onClick={ask} disabled={busy || !question.trim()}>{busy ? 'Asking…' : 'Ask'}</button>
        <button class="btn quiet sm" onClick={() => coachState.setAsking(null)}>Close</button>
      </div>
      <p class="faint small" style="margin:4px 0 0">The coach is sent the lines on screen over this range, with your sessions. It answers here, under the chart.</p>
      {busy && <p class="small muted" style="margin:6px 0 0">The coach is reading the chart…</p>}
      {error && <p class="small" style="margin-top:6px;color:var(--bad)">No answer came: {error}</p>}
      {answer && !error && (
        <div class="coach-line small" style="margin-top:6px">
          <div class="faint" style="margin-bottom:2px">About {names} · {answer.q}</div>
          <div><b class="coach-mark">Coach</b> {answer.a}</div>
        </div>
      )}
    </div>
  );
}

const KIND_ROW: Record<MorningRow['kind'], string> = { hard: 'Hard ride or run', long: 'Long ride', strength: 'Strength', run: 'Run', rest: 'Rest day' };

/** The rider's day-to-day spread of each morning reading over the range (a standard deviation). */
function morningSpread(wellness: Wellness[], from: string, to: string) {
  const sd = (xs: number[]) => { if (xs.length < 3) return undefined; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
  const ms = wellness.filter((w) => w.date >= from && w.date <= to);
  const get = (k: 'hrv' | 'restingHr' | 'sleepSeconds') => ms.map((w) => w[k]).filter((v): v is number => typeof v === 'number' && v > 0);
  return { hrv: sd(get('hrv')), restingHr: sd(get('restingHr')), sleepSeconds: sd(get('sleepSeconds')) };
}

/** HRV, resting heart rate and sleep the morning after each kind of day, against the rider's normal for the range. */
function MorningAfterCard({ data, from, to, readout, coach }: { data: AppData; from: string; to: string; readout: string; coach: ProgressCoachState }) {
  const rows = morningsAfter(data.rides, data.wellness, from, to, data.profile?.lthr ?? 0, hrNumbers(data.profile));
  const spread = morningSpread(data.wellness, from, to);
  const any = data.wellness.some((w) => w.date >= from && w.date <= to);
  // Tinted only when the row's difference is beyond what day-to-day variation alone would give that many mornings
  // (twice the spread divided by the square root of the count); rounded first, so a difference that prints as 0 reads ±0.
  const cell = (v: number | undefined, n: number, sd: number | undefined, better: (v: number) => boolean, fmt: (v: number) => string, digits = 1) => {
    if (v == null || n === 0) return <td class="r faint">–</td>;
    const thin = n < 6;
    const r = Math.round(v * 10 ** digits) / 10 ** digits;
    const beyond = !thin && sd != null && Math.abs(v) > (2 * sd) / Math.sqrt(n);
    const cls = thin ? 'thin' : r !== 0 && beyond ? (better(r) ? 'better' : 'worse') : '';
    return <td class={`r num mcell ${cls}`} title={thin ? `thin evidence: ${n} mornings` : beyond ? undefined : 'within your normal day-to-day variation'}>{r > 0 ? '+' : r < 0 ? '−' : '±'}{fmt(Math.abs(r))}</td>;
  };
  return (
    <PCard id="morning" title="The morning after" coach={coach} readout={readout ? readout.split(':')[0] : undefined}
      explain={<><p style="margin:0 0 8px">What HRV, resting heart rate and sleep look like on the mornings after each kind of day, against your normal for this range. The planner uses the same evidence when it spaces hard days.</p><p style="margin:0">A cell is green or red only when the difference is bigger than your normal day-to-day variation would give over that many mornings; grey otherwise. Rows resting on fewer than six mornings are thin evidence and stay grey. A hard ride is 40 minutes or more at 85% of FTP or above (or its heart-rate equivalent), a hard run 30 minutes or more at 85% of threshold heart rate; a long ride is 2½ hours or more; a rest day has nothing recorded. The run row appears once there are mornings after a run.</p></>}>
      {!any ? <div class="empty small">Draws once Intervals.icu has morning readings for this range.</div> : (
        <Rest>
          <table class="mtable mtable2">
            <thead><tr><th>Day before</th><th class="r">HRV</th><th class="r">Rest HR</th><th class="r">Sleep</th><th class="r">n</th></tr></thead>
            <tbody>{rows.filter((r) => r.kind !== 'run' || r.n > 0).map((r) => (
              <tr key={r.kind}>
                <td>{KIND_ROW[r.kind]}</td>
                {cell(r.hrv, r.n, spread.hrv, (v) => v > 0, (v) => `${v.toFixed(1)} ms`)}
                {cell(r.restingHr, r.n, spread.restingHr, (v) => v < 0, (v) => `${v.toFixed(1)}`)}
                {cell(r.sleepSeconds != null ? r.sleepSeconds / 60 : undefined, r.n, spread.sleepSeconds != null ? spread.sleepSeconds / 60 : undefined, (v) => v > 0, (v) => `${Math.round(v)} min`, 0)}
                <td class="r faint">{r.n}</td>
              </tr>
            ))}</tbody>
          </table>
        </Rest>
      )}
    </PCard>
  );
}

interface TestEntry { key: string; date: string; kind: 'ramp' | '20min'; result?: TestResult; rideId?: string }

/**
 * Every fitness test: rides matched to a test on the calendar or named like one,
 * and tests the player recorded on this computer that are not uploaded yet.
 * Results come from the player's recording when it is here, else from the
 * ride's streams if this device has opened it (opening it fills them in).
 */
function useTests(data: AppData): TestEntry[] {
  const [out, setOut] = useState<TestEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const recs = await db.recordings.filter((r) => !!r.test && r.status !== 'discarded').toArray();
      const byRide = new Map(recs.filter((r) => r.activityId).map((r) => [r.activityId!, r]));
      const kept = new Map((await db.settings.where('key').startsWith(testResultKey('')).toArray()).map((s) => [s.key.slice(testResultKey('').length), s.value as TestResult]));
      const kindOf = (r: Ride): TestEntry['kind'] | undefined => {
        const p = data.planned.find((x) => x.activityId === r.id);
        const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
        return w?.test ?? (r.sport === 'ride' ? LIBRARY.find((x) => x.test && x.name === r.name)?.test : undefined);
      };
      const list: TestEntry[] = [];
      for (const r of data.rides) {
        const kind = kindOf(r);
        if (!kind) continue;
        let result = kept.get(r.id) ?? byRide.get(r.id)?.test;
        if (!result) { const st = await db.streams.get(r.id); if (st) result = resultFromStreams(kind, st.watts, st.heartrate, data.profile?.weightKg, st.time); }
        list.push({ key: r.id, date: r.date, kind, result, rideId: r.id });
      }
      for (const rec of recs) if (!rec.activityId || !data.rides.some((x) => x.id === rec.activityId)) list.push({ key: rec.id, date: rec.date, kind: rec.test!.kind, result: rec.test });
      list.sort((a, b) => b.date.localeCompare(a.date));
      if (alive) setOut(list);
    })();
    return () => { alive = false; };
  }, [data.rides, data.planned]);
  return out;
}

/**
 * FTP on record over the range, with each test's FTP estimate as a dot, every test as a row, and, when the
 * active plan has a goal, the goal: an FTP target drawn with the line of what is needed (never a forecast),
 * an event's days to go and the fitness projection carried to it, weekly hours against an hours target,
 * weight against a weight target, or VO2max estimates over time.
 */
function TestsCard({ data, tests, from, to, plan, series, readout, coach }: { data: AppData; tests: TestEntry[]; from: string; to: string; plan: ActivePlan | null; series: Fitness[]; readout: string; coach: ProgressCoachState }) {
  const profile = data.profile!;
  const label = (k: TestEntry['kind']) => (k === 'ramp' ? 'Ramp test' : '20-minute test');
  const vo2 = (r?: TestResult) => (r?.vo2maxMlKgMin != null ? `${r.vo2maxMlKgMin}` : r?.vo2maxLmin != null ? `${r.vo2maxLmin} L/min` : '—');
  const g = plan && plan.goalDate >= to ? plan.goal : undefined;
  const title = g && g.kind !== 'general' ? 'Tests and goal' : 'Tests';
  const ftp = ftpByDay(data.rides, from, to, profile.ftp);
  const onDay = new Map(tests.filter((x) => x.date >= from && x.date <= to && x.result?.ftpEstimate != null).map((x) => [x.date, x]));
  const ftpGoalOn = g?.kind === 'ftp' ? g : undefined;
  // An FTP goal: the days run on to the goal date, with the target and the line of what is needed from today.
  const ahead: string[] = [];
  if (ftpGoalOn) for (let d = addDays(to, 1); d <= plan!.goalDate; d = addDays(d, 7)) ahead.push(d);
  if (ftpGoalOn && ahead[ahead.length - 1] !== plan!.goalDate) ahead.push(plan!.goalDate);
  const dates = [...ftp.map((d) => d.date), ...ahead];
  const n = ftp.length;
  const need = ftpGoalOn ? dates.map((d, i) => (i < n - 1 ? null : Math.round(profile.ftp + (ftpGoalOn.targetWatts - profile.ftp) * Math.max(0, Math.min(1, (Date.parse(d) - Date.parse(to)) / Math.max(1, Date.parse(plan!.goalDate) - Date.parse(to))))))) : [];
  const fg = ftpGoalOn ? ftpGoal(ftp, to, profile.ftp, ftpGoalOn.targetWatts, plan!.goalDate) : undefined;
  const tick = (d: string, i: number) => (i === 0 || i === dates.length - 1 || i % Math.ceil(dates.length / 4) === 0) ? short(d) : null;
  const vals = [...ftp.map((d) => d.ftp), ...[...onDay.values()].map((x) => x.result!.ftpEstimate!), ...(ftpGoalOn ? [ftpGoalOn.targetWatts] : [])];
  const showChart = onDay.size > 0 || !!ftpGoalOn || new Set(ftp.map((d) => d.ftp)).size > 1;
  const goalExtra = (() => {
    if (!g || !plan) return null;
    if (g.kind === 'event') {
      const days = Math.max(0, Math.round((Date.parse(g.date) - Date.parse(to)) / 864e5));
      const proj = series.length ? projectFitness(series[series.length - 1], data.planned, data.mine, g.date) : [];
      return { words: `${days} days to ${g.name || 'the event'} (${short(g.date)})`, chart: proj.length > 1 ? (h: number) => <LineChart series={[{ name: 'fitness, as planned', color: 'var(--info)', values: proj.map((p) => Math.round(p.ctl)), dash: '6 4', width: 2 }, { name: 'form, as planned', color: 'var(--ink-3)', values: proj.map((p) => Math.round(p.tsb)), dash: '3 3', width: 1.4 }]} xLabels={proj.map((p) => p.date)} xTick={(d, i) => (i === 0 || i === proj.length - 1) ? short(d) : null} yTitle="points" height={h} markers={[{ index: proj.length - 1, label: 'event', color: 'var(--today)' }]} /> : null };
    }
    if (g.kind === 'endurance') {
      const weeks = weekStarts(from, to, (d) => weekStart(d)).map((w) => ({ w, h: data.rides.filter((r) => r.sport === 'ride' && r.date >= w && r.date <= addDays(w, 6)).reduce((a, r) => a + r.seconds, 0) / 3600 }));
      return { words: `target ${g.targetHours} h of riding a week · last whole week ${weeks.length > 1 ? Math.round(weeks[weeks.length - 2].h * 10) / 10 : '–'} h`, chart: (h: number) => <LineChart series={[{ name: 'hours a week', color: 'var(--ride)', values: weeks.map((x) => Math.round(x.h * 10) / 10), width: 2 }]} xLabels={weeks.map((x) => x.w)} xTick={(d, i) => (i === 0 || i === weeks.length - 1) ? short(d) : null} yTitle="hours" height={h} refLines={[{ value: g.targetHours, label: `target ${g.targetHours} h`, color: 'var(--today)' }]} onPick={(i) => go(`calendar?v=list&w=${weeks[i].w}`)} pickLabel={() => 'open the week'} /> };
    }
    if (g.kind === 'weight' && g.targetKg) {
      const imperial = profile.units === 'imperial';
      const show = (v: number) => Math.round((imperial ? v * 2.20462 : v) * 10) / 10;
      const ws = wellnessDays(data.wellness, from, to);
      const avg = rollingDays(ws.map((d) => d.date), ws.map((d) => d.w?.weightKg ?? null), 7);
      return { words: `target weight ${show(g.targetKg)} ${imperial ? 'lb' : 'kg'} by ${short(plan.goalDate)}`, chart: (h: number) => <LineChart series={[{ name: 'weight, 7-day', color: 'var(--z7)', values: avg.map((v) => (v ? show(v) : null)), width: 2 }]} xLabels={ws.map((d) => d.date)} xTick={(d, i) => (i === 0 || i === ws.length - 1) ? short(d) : null} yTitle={imperial ? 'lb' : 'kg'} height={h} refLines={[{ value: show(g.targetKg!), label: 'target', color: 'var(--today)' }]} /> };
    }
    if (g.kind === 'vo2max') {
      const pts = tests.filter((x) => x.result?.vo2maxMlKgMin != null).sort((a, b) => a.date.localeCompare(b.date));
      return { words: pts.length ? `VO2max estimate ${pts[pts.length - 1].result!.vo2maxMlKgMin} ml/kg/min (${short(pts[pts.length - 1].date)})` : 'ride a Ramp Test for a VO2max estimate', chart: pts.length > 1 ? (h: number) => <LineChart series={[{ name: 'VO2max estimate', color: 'var(--z7)', values: pts.map((x) => x.result!.vo2maxMlKgMin!), dots: true, width: 2 }]} xLabels={pts.map((x) => x.date)} xTick={(d, i) => (i === 0 || i === pts.length - 1) ? short(d) : null} yTitle="ml/kg/min" height={h} onPick={(i) => { const r = pts[i].rideId; if (r) go(`rides/${r}`); }} pickLabel={(i) => (pts[i].rideId ? 'open the test' : null)} /> : null };
    }
    return null;
  })();
  return (
    <PCard id="tests" title={title} coach={coach} big="ftp"
      readout={<>{readout}</>}
      explain={<><p style="margin:0 0 8px">Your FTP on record over this range, with each test's FTP estimate as a dot, and every test you've ridden (with its breathing thresholds when you wore a breathing strap). Open one to update your FTP or zones from it.</p>{ftpGoalOn && <p style="margin:0">The goal: your target as a line, and from today a dashed line to the target on the goal date. That line is what is needed, not a forecast. "Ahead", "on track" or "behind" compares the rate it needs with your own rate over the last twelve weeks, and only shows once you have had at least two FTP values in the last sixteen weeks.</p>}</>}>
      {fg && <p class="small" style="margin:0 0 4px"><b>{fg.needed} W</b> still needed in <b>{fg.daysLeft} days</b>{fg.neededPerWeek != null ? <> · needs <b>{fg.neededPerWeek} W</b> a week</> : null}{fg.ownPerWeek != null ? <> · your last 12 weeks <b>{sg(fg.ownPerWeek, 1)} W</b> a week</> : null}{fg.verdict && <> · <b class={fg.verdict === 'behind' ? '' : 'good-t'}>{fg.verdict}</b></>}</p>}
      {goalExtra && <p class="small" style="margin:0 0 4px">{goalExtra.words}</p>}
      {showChart && (
        <Fill initial={140} min={64}>{(h) => <LineChart series={[
          { name: 'FTP on record', color: 'var(--accent)', values: [...ftp.map((d) => d.ftp), ...ahead.map(() => null)], width: 2, unit: 'W' },
          { name: 'Test estimate', color: 'var(--warn)', values: dates.map((d) => onDay.get(d)?.result?.ftpEstimate ?? null), dots: true, unit: 'W' },
          ...(ftpGoalOn ? [{ name: 'needed', color: 'var(--accent)', values: need, dash: '5 4', width: 1.6, unit: 'W' }] : []),
        ]} xLabels={dates} xTick={tick} yTitle="W" height={h}
          refLines={ftpGoalOn ? [{ value: ftpGoalOn.targetWatts, label: `target ${ftpGoalOn.targetWatts}`, color: 'var(--today)' }] : []}
          markers={ahead.length ? [{ index: n - 1, label: 'today', color: 'var(--today)' }] : []}
          yMin={Math.min(...vals) - 15} yMax={Math.max(...vals) + 15}
          readout={(i) => { const x = onDay.get(dates[i]); if (i >= n) return `${short(dates[i])} · needed ${need[i]} W to reach the target`; return `${short(dates[i])} · FTP ${ftp[i].ftp} W${x ? ` · ${label(x.kind)}, ${fmtDate(x.date, { month: 'short', day: 'numeric' })}: FTP ${x.result!.ftpEstimate} W${x.kind === 'ramp' && vo2(x.result) !== '—' ? `, VO2max ${vo2(x.result)}` : ''}` : ''}`; }}
          onPick={(i) => { const x = onDay.get(dates[i]); if (x?.rideId) go(`rides/${x.rideId}`); }} pickLabel={(i) => (onDay.get(dates[i])?.rideId ? 'open the test' : null)} />}</Fill>
      )}
      {goalExtra?.chart && <Fill initial={120} min={80}>{(h) => goalExtra.chart!(h)}</Fill>}
      {!tests.length ? <p class="faint small" style="margin:6px 0 0">No tests yet: ride the Ramp Test from the Library to see your FTP and VO2max estimates here.</p> : (
        <ul class="tests-list">{tests.map((x) => {
          const when = fmtDate(x.date, x.date.slice(0, 4) === to.slice(0, 4) ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
          const chose = x.result?.ftpAction === 'updated' ? 'you updated your FTP' : x.result?.ftpAction === 'kept' ? 'you kept your FTP' : '';
          const breath = x.result?.breath?.vt1 || x.result?.breath?.vt2 ? `breathing thresholds ${[x.result.breath.vt1, x.result.breath.vt2].filter(Boolean).map((v) => `${v!.watts} W`).join(' and ')}${x.result.breath.estimated ? ' (estimated)' : ''}` : '';
          const numbers = [x.result?.ftpEstimate != null ? <>FTP estimate <b>{x.result.ftpEstimate} W</b></> : null, x.kind === 'ramp' && vo2(x.result) !== '\u2014' ? <>VO2max estimate <b>{vo2(x.result)}</b>{x.result?.vo2maxMlKgMin != null ? ' ml/kg/min' : ''}</> : null].filter(Boolean);
          return (
            <li key={x.key}>
              <div class="tl-head">{x.rideId ? <a href={`#/rides/${x.rideId}`}>{when} · {label(x.kind)} ›</a> : <span>{when} · {label(x.kind)}</span>}</div>
              <div class="small">{numbers.length ? numbers.map((n, i) => <span key={i}>{i > 0 ? ' · ' : ''}{n}</span>) : x.result ? 'no estimate from this test' : 'open it to see its results'}</div>
              {(chose || breath) && <div class="faint small">{[chose, breath].filter(Boolean).join(' · ')}</div>}
            </li>
          );
        })}</ul>
      )}
    </PCard>
  );
}

/** Sessions beyond the bike each week, and how matched strength work spreads across the body. */
function BodyCard({ data, from, to, readout, coach }: { data: AppData; from: string; to: string; readout?: string; coach: ProgressCoachState }) {
  const starts = weekStarts(from, to, (d) => weekStart(d));
  const items = [...data.rides.filter((r) => r.date >= from && r.date <= to).map((r) => ({ date: r.date, kind: r.sport })),
    ...data.planned.filter((p) => p.date >= from && p.date <= to && p.status === 'completed' && !p.activityId).map((p) => ({ date: p.date, kind: (findWorkout(data.mine, p.workoutId)?.kind ?? 'other') as SessionKind }))];
  const s = sessionsPerWeek(items, starts);
  const bal = balanceOf(data, from, to);
  const GROUP_COLOR: Record<string, string> = { push: 'var(--strength)', pull: 'color-mix(in srgb, var(--strength) 60%, var(--ink))', posterior: 'var(--mobility)', trunk: 'color-mix(in srgb, var(--mobility) 60%, var(--ink))' };
  return (
    <PCard id="body" title="Whole body" coach={coach} readout={readout}
      explain={`Sessions beyond the bike each week, from your recorded activities and sessions you logged in the app, and how this range's strength work divides between push, pull, the posterior chain (deadlifts, swings, hip thrusts, bridges and other hinges) and trunk, using the same meanings as the Library's Includes filter. The balance uses only strength sessions the app can match to a Library or own session, and shows once there are at least ${BALANCE_MIN_SESSIONS}; it says balanced when no group is under 20%. Tap a week to open it on the Calendar.`}>
      <Fill initial={150} min={90}>{(h) => <BarChart
        categories={starts}
        series={s.kinds.map((k) => ({ name: KIND_NAME[k], color: KIND_COLOR[k], values: s.weeks.map((w) => w[k]) }))}
        xTick={(d, i) => (i === 0 || i === starts.length - 1 || i % Math.ceil(starts.length / 4) === 0) ? short(d) : null}
        yTitle="sessions a week" height={h}
        readout={(i) => `Week of ${short(starts[i])} · ${s.kinds.map((k) => `${KIND_NAME[k].toLowerCase()} ${s.weeks[i][k]}`).join(' · ')}`}
        onPick={(i) => go(`calendar?v=list&w=${starts[i]}`)} pickLabel={() => 'open the week'} />}</Fill>
      <div class="bal">
        {bal.enough ? (<>
          <div class="small" style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px"><b>Strength balance</b><span class={bal.balanced ? 'good-t' : ''}>{bal.balanced ? 'balanced' : `light on ${BODY_GROUP_LABEL[bal.smallest!]}`} · {bal.sessions} sessions{bal.unmatched ? `, ${bal.unmatched} not matched` : ''}</span></div>
          <div class="bal-bar" role="img" aria-label={BODY_GROUPS.map((g) => `${BODY_GROUP_LABEL[g]} ${bal.shares![g]}%`).join(', ')}>{BODY_GROUPS.map((g) => <span key={g} style={`width:${bal.shares![g]}%;background:${GROUP_COLOR[g]}`} />)}</div>
          <div class="bal-key faint small">{BODY_GROUPS.map((g) => <span key={g}><span class="sw-dot" style={`background:${GROUP_COLOR[g]}`} />{BODY_GROUP_LABEL[g]} {bal.shares![g]}%</span>)}</div>
        </>) : <p class="small muted" style="margin:0">Strength balance shows once {BALANCE_MIN_SESSIONS} strength sessions in this range match a Library or own session ({bal.sessions} so far{bal.unmatched ? `; ${bal.unmatched} more could not be matched` : ''}).</p>}
      </div>
    </PCard>
  );
}

/** Breathing: the thresholds on the rider's zones, over time, and breathing rate at endurance power. Only with breathing data. */
function BreathingCard({ data, curves, tests, from, to, readout, coach }: { data: AppData; curves: PowerCurve[]; tests: TestEntry[]; from: string; to: string; readout?: string; coach: ProgressCoachState }) {
  const profile = data.profile!;
  const zones = ridePowerZones(profile);
  const bc = curves.filter((c) => c.breathAtPower?.length);
  const now = testThresholds(tests, to);
  const hist = breathHistory(bc, profile.ftp, to);
  // Thresholds over time: each test's, and the reading of ordinary rides every four weeks.
  const checks: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -28)) checks.unshift(d);
  const ride1 = checks.map((d) => breathHistory(bc.filter((c) => c.date <= d), profile.ftp, d).vt1?.watts ?? null);
  const tIn = tests.filter((x) => x.date >= from && x.date <= to && (x.result?.breath?.vt1 || x.result?.breath?.vt2));
  const tDates = [...new Set([...checks, ...tIn.map((x) => x.date)])].sort();
  const vt1T = tDates.map((d) => tIn.find((x) => x.date === d)?.result?.breath?.vt1?.watts ?? null);
  const vt2T = tDates.map((d) => tIn.find((x) => x.date === d)?.result?.breath?.vt2?.watts ?? null);
  const ridesV = tDates.map((d) => { const i = checks.indexOf(d); return i >= 0 ? ride1[i] : null; });
  const rates = bc.filter((c) => c.date >= from && c.date <= to).map((c) => ({ date: c.date, id: c.id, v: enduranceBreathRate(c.breathAtPower) })).filter((x): x is { date: string; id: string; v: number } => x.v != null);
  const mark = (w?: number) => (w ? `${(zonePosition(w / profile.ftp, zones) * 100).toFixed(1)}%` : null);
  const any1 = ridesV.some((v) => v != null) || vt1T.some((v) => v != null) || vt2T.some((v) => v != null);
  const points = Math.max(ridesV.filter((v) => v != null).length, vt1T.filter((v) => v != null).length, vt2T.filter((v) => v != null).length);
  return (
    <PCard id="breathing" title="Breathing" coach={coach} readout={readout} big="breath"
      explain="Your two breathing thresholds from tests ridden with a breathing strap, and the first threshold as the app reads it from ordinary rides, marked on your power zones; how they move over time; and how fast you breathe at endurance power (55–75% of FTP) on each ride. Fewer breaths for the same power over time is a sign of aerobic fitness. Shown only when your rides include breathing data.">
      <div class="zbar" role="img" aria-label={`Breathing thresholds on your power zones${now.vt1 ? `: first ${now.vt1} W` : ''}${now.vt2 ? `, second ${now.vt2} W` : ''}`}>
        {ZONE_VAR.map((c, i) => <span key={i} style={`background:${c}`} />)}
        {mark(now.vt1 ?? hist.vt1?.watts) && <i style={`left:${mark(now.vt1 ?? hist.vt1?.watts)}`} title="first threshold" />}
        {mark(now.vt2) && <i style={`left:${mark(now.vt2)}`} title="second threshold" />}
      </div>
      <div class="zbar-key faint small"><span>Z1</span><span>{now.vt1 || hist.vt1 ? `first ${now.vt1 ?? hist.vt1?.watts} W` : 'first threshold not read yet'}{now.vt2 ? ` · second ${now.vt2} W` : ''}</span><span>Z7</span></div>
      <Fill initial={130}>{(h) => (
        <div class="pmulti stack">
          <div>
            <div class="small" style="margin-bottom:1px"><b>Thresholds over time</b> <span class="faint">(W)</span></div>
            {points < 2 ? <div class="empty small">{points === 1 ? `One reading so far${now.vt2 ? `: second threshold ${now.vt2} W` : now.vt1 ? `: first threshold ${now.vt1} W` : ''}${now.date ? `, from the ${short(now.date)} test` : ''}. A line draws here after the next test.` : 'Not enough breathing yet to read a threshold.'}</div> : any1 ? <LineChart series={[
              { name: 'first, from tests', color: 'var(--z3)', values: vt1T, dots: true, width: 2 },
              { name: 'second, from tests', color: 'var(--z5)', values: vt2T, dots: true, width: 2 },
              { name: 'first, from rides', color: 'var(--aqua)', values: ridesV, width: 2, connectGaps: true },
            ]} xLabels={tDates} xTick={(d, i) => (i === 0 || i === tDates.length - 1) ? short(d) : null} yTitle="W" height={h} /> : <div class="empty small">Not enough breathing yet to read a threshold.</div>}
          </div>
          <div>
            <div class="small" style="margin-bottom:1px"><b>Breaths a minute at endurance power</b></div>
            {rates.length >= 2 ? <LineChart series={[{ name: 'ride', color: 'var(--aqua)', values: rates.map((r) => r.v), dots: true }, { name: '5-ride average', color: 'var(--aqua)', values: rollingMean(rates.map((r) => r.v), 5), width: 2 }]}
              xLabels={rates.map((r) => r.date)} xTick={(d, i) => (i === 0 || i === rates.length - 1) ? short(d) : null} yTitle="breaths/min" height={h}
              readout={(i) => `${short(rates[i].date)} · ${rates[i].v} breaths a minute at endurance power`} onPick={(i) => go(`rides/${rates[i].id}`)} pickLabel={() => 'open the ride'} /> : <div class="empty small">Two or more rides with five minutes or more at endurance power draw here.</div>}
          </div>
        </div>
      )}</Fill>
    </PCard>
  );
}

export type { PlannedWorkout };
