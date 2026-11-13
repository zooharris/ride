import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { addDays, today } from '../engine/load';
import { workoutStats } from '../engine/workout';
import { playerOffered } from '../player/platform';
import { DAY_SHORT, distance, plannedOn, splitToday, syncLine, weekStart } from './derived';
import { findWorkout, useSyncState, type AppData } from './store';
import { weekSummary, plannedMinutes } from './week';
import { getActivePlan, type ActivePlan } from './planService';
import { Icon } from './icons';
import { miles } from '../engine/units';
import { isUnknown } from '../engine/known';

/**
 * The sidebar's blocks under the navigation (11 Nov 2026). Each shows a live fact the page in
 * front of the rider does not already show: a block is left out on every page that shows its information,
 * and at most three show, the first three in this order that are allowed and have something true to say.
 * On a short window the ones that do not fit are dropped from the end; the sidebar never scrolls.
 * Only on a laptop: a phone has no sidebar.
 */
export type SideBlock = 'today' | 'week' | 'coming' | 'goal' | 'last';
export const SIDE_ORDER: SideBlock[] = ['today', 'week', 'coming', 'goal', 'last'];

/**
 * The pages that already show each block's information, checked against the pages as they are (11 Nov 2026):
 * Today shows today's sessions, the week strip, what is next and (for an event) the days to go; the Calendar
 * opens on the month, which shows today, the week, the days ahead and the latest activities; a plan's page
 * shows its weeks, their load, its sessions and its goal; Progress shows this week's load and the goal;
 * Activities shows the latest activity.
 */
export const LEFT_OUT: Record<SideBlock, string[]> = {
  today: ['today', 'calendar', 'plan'],
  week: ['today', 'calendar', 'plan', 'progress'],
  coming: ['today', 'calendar', 'plan'],
  goal: ['today', 'plan', 'progress'],
  last: ['rides', 'calendar'],
};
/** The sync line is left out where the page shows it (Today's sync line, Settings). */
export const STATUS_LEFT_OUT = ['today', 'settings'];

export function blocksFor(page: string, has: Record<SideBlock, boolean>): SideBlock[] {
  return SIDE_ORDER.filter((b) => has[b] && !LEFT_OUT[b].includes(page)).slice(0, 3);
}

const KIND_WORD: Record<string, string> = { ride: 'Ride', strength: 'Strength', mobility: 'Mobility', walk: 'Walk', run: 'Run', other: 'Session' };
const minutesWords = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(Math.round(m % 60)).padStart(2, '0')}` : ''}` : `${Math.round(m)} min`);

/** The day's main session: the first ride not yet done, else the first session not yet done, else the first. */
export function mainSession(data: AppData, date: string): { p: PlannedWorkout; w: Workout } | undefined {
  const withW = plannedOn(data.planned, date, (id) => findWorkout(data.mine, id)?.kind ?? 'ride')
    .map((p) => ({ p, w: findWorkout(data.mine, p.workoutId) }))
    .filter((x): x is { p: PlannedWorkout; w: Workout } => !!x.w);
  if (!withW.length) return undefined;
  const { hero } = splitToday(withW);
  return (hero && hero.p.status !== 'completed' ? hero : undefined) ?? withW.find((x) => x.p.status !== 'completed') ?? hero ?? withW[0];
}

/** The latest training activity before today. */
export function lastActivity(rides: Ride[], date: string): Ride | undefined {
  let best: Ride | undefined;
  for (const r of rides) if (r.date < date && (!best || r.startTime > best.startTime)) best = r;
  return best;
}

export function SideBlocks({ data, page }: { data: AppData; page: string }) {
  const date = today();
  const [plan, setPlan] = useState<ActivePlan | null>(null);
  useEffect(() => { let alive = true; getActivePlan().then((p) => alive && setPlan(p)).catch(() => {}); return () => { alive = false; }; }, [data.planned.length]);

  const main = mainSession(data, date);
  const week = weekSummary(weekStart(date), data.planned, data.rides, data.mine);
  const weekHas = week.plannedTss > 0 || week.doneTss > 0;
  const coming = [1, 2, 3].map((i) => addDays(date, i)).map((d) => ({ d, s: mainSession(data, d) }));
  const comingHas = coming.some((c) => c.s);
  const goal = plan && plan.goal.kind !== 'general' && plan.goalDate >= date ? plan : null;
  const last = lastActivity(data.rides, date);
  const has: Record<SideBlock, boolean> = { today: true, week: weekHas, coming: comingHas, goal: !!goal, last: !!last };
  const blocks = blocksFor(page, has);

  // Drop whatever does not fit, from the end, so nothing is ever cut off and the sidebar never scrolls.
  const box = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    kids.forEach((k) => { k.style.display = ''; });
    const h = el.clientHeight;
    let hide = false;
    for (const k of kids) {
      if (hide || k.offsetTop - el.offsetTop + k.offsetHeight > h) { hide = true; k.style.display = 'none'; }
    }
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div class="side" ref={box} aria-label="At a glance">
      {blocks.map((b) => {
        if (b === 'today') return <TodayBlock key={b} main={main} />;
        if (b === 'week') return <WeekBlock key={b} week={week} date={date} />;
        if (b === 'coming') return <ComingBlock key={b} coming={coming} />;
        if (b === 'goal') return <GoalBlock key={b} plan={goal!} date={date} ftp={data.profile && !isUnknown(data.profile, 'ftp') ? data.profile.ftp : 0} />;
        return <LastBlock key={b} ride={last!} data={data} />;
      })}
    </div>
  );
}

export function SideStatus({ page }: { page: string }) {
  const sync = useSyncState();
  if (STATUS_LEFT_OUT.includes(page)) return null;
  const line = syncLine(sync, new Date());
  return (
    <div class="side-foot">
      <span class="side-dot" style={`background:${line.failed ? 'var(--bad)' : sync.last ? 'var(--good)' : 'var(--ink-3)'}`} />
      {line.text}
    </div>
  );
}

function TodayBlock({ main }: { main?: { p: PlannedWorkout; w: Workout } }) {
  if (!main) return (
    <a class="side-card" href="#/today">
      <div class="side-cap">Today</div>
      <div class="side-sub">Nothing planned today</div>
    </a>
  );
  const { p, w } = main;
  const done = p.status === 'completed';
  const mins = w.kind === 'ride' ? Math.round(workoutStats(w.blocks).seconds / 60) : plannedMinutes(w);
  const canStart = !done && w.kind === 'ride' && playerOffered();
  return (
    <div class="side-card side-row">
      <a class="side-main" href="#/today">
        <div class="side-cap">Today</div>
        <div class="side-name">{done && <span class="side-done" aria-label="Done"><Icon.check size={14} /></span>}{w.name}</div>
        <div class="side-sub">{done ? 'Done' : `${KIND_WORD[w.kind] ?? 'Session'}${mins ? ` · ${minutesWords(mins)}` : ''}`}</div>
      </a>
      {canStart && <a class="btn sm side-start" href={`#/play/planned/${p.id}`} aria-label={`Start ${w.name}`}>Start</a>}
    </div>
  );
}

function WeekBlock({ week, date }: { week: ReturnType<typeof weekSummary>; date: string }) {
  const days = week.days.map((d) => {
    let done = 0, planned = 0;
    for (const s of d.sessions) {
      if (s.status === 'completed' || s.status === 'unscheduled') done += s.tss;
      else if (s.status !== 'missed') planned += s.tss;
    }
    return { date: d.date, done, planned };
  });
  const max = Math.max(1, ...days.map((d) => d.done + d.planned));
  const head = week.plannedTss > 0 ? `${week.doneTss} of ${week.plannedTss}` : `${week.doneTss} done`;
  return (
    <a class="side-card" href="#/calendar?v=list">
      <div class="side-cap">This week · {head}</div>
      <div class="side-week" role="img" aria-label={`This week: ${head} load`}>
        {days.map((d) => {
          const isToday = d.date === date;
          const hDone = Math.round((d.done / max) * 30), hPlan = Math.round((d.planned / max) * 30);
          return (
            <div class="side-day" key={d.date}>
              <div class="side-bars">
                {hPlan > 0 && <span class={`side-plan${isToday ? ' now' : ''}`} style={`height:${Math.max(2, hPlan)}px`} />}
                {hDone > 0 && <span class="side-doneb" style={`height:${Math.max(2, hDone)}px`} />}
                {!hDone && !hPlan && <span class="side-none" />}
              </div>
              <span class={`side-dl${isToday ? ' now' : ''}`}>{DAY_SHORT[new Date(d.date + 'T00:00:00').getDay()].charAt(0)}</span>
            </div>
          );
        })}
      </div>
    </a>
  );
}

function ComingBlock({ coming }: { coming: Array<{ d: string; s?: { p: PlannedWorkout; w: Workout } }> }) {
  return (
    <a class="side-card" href="#/calendar?v=list">
      <div class="side-cap">Coming up</div>
      {coming.map(({ d, s }) => (
        <div class="side-line" key={d}>
          <span class="side-wd">{DAY_SHORT[new Date(d + 'T00:00:00').getDay()]}</span>
          <span class={s ? 'side-ln' : 'side-ln dim'}>{s ? s.w.name : 'Nothing planned'}</span>
        </div>
      ))}
    </a>
  );
}

function GoalBlock({ plan, date, ftp }: { plan: ActivePlan; date: string; ftp: number }) {
  const g = plan.goal;
  const end = g.kind === 'event' ? g.date : plan.goalDate;
  const days = Math.max(0, Math.round((Date.parse(end + 'T00:00:00') - Date.parse(date + 'T00:00:00')) / 864e5));
  const endWord = new Date(end + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  let title = plan.name, share: number, left = '', right = '';
  if (g.kind === 'ftp' && ftp > 0 && g.targetWatts > 0) {
    title = `FTP ${g.targetWatts} W`;
    share = Math.min(1, ftp / g.targetWatts);
    left = `FTP ${ftp} W`; right = `target ${g.targetWatts}`;
  } else {
    if (g.kind === 'event') title = g.name || plan.name;
    const total = Math.max(1, (Date.parse(end) - Date.parse(plan.start)) / 864e5);
    share = Math.min(1, Math.max(0, (Date.parse(date) - Date.parse(plan.start)) / 864e5 / total));
    left = 'plan so far'; right = `${Math.round(share * 100)}%`;
  }
  return (
    <a class="side-card" href={`#/plan/${plan.id}`}>
      <div class="side-cap">Goal · {endWord}</div>
      <div class="side-name">{title}</div>
      <div class="side-sub">{days === 0 ? 'Today' : days === 1 ? '1 day to go' : `${days} days to go`}</div>
      <div class="side-meter"><span style={`width:${Math.round(share * 100)}%`} /></div>
      <div class="side-sub side-split"><span>{left}</span><span>{right}</span></div>
    </a>
  );
}

function LastBlock({ ride, data }: { ride: Ride; data: AppData }) {
  const wd = DAY_SHORT[new Date(ride.date + 'T00:00:00').getDay()];
  const bits = [ride.distanceM ? distance(ride.distanceM, data.profile!) : '', minutesWords(Math.round(ride.seconds / 60))];
  if (ride.elevationM && ride.elevationM >= 10) bits.push(miles(data.profile) ? `${Math.round(ride.elevationM * 3.28084).toLocaleString()} ft` : `${Math.round(ride.elevationM).toLocaleString()} m`);
  return (
    <a class="side-card" href={`#/rides/${ride.id}`}>
      <div class="side-cap">Last activity · {wd}</div>
      <div class="side-name">{ride.name}</div>
      <div class="side-sub">{bits.filter(Boolean).join(' · ')}</div>
    </a>
  );
}
