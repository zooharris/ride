import { db } from '../data/db';
import { arrival, useRoute } from './router';
import { loadAppData, notify, useAppData } from './store';
import { useEffect, useRef } from 'preact/hooks';
import { syncDevices } from '../data/devicesync';
import { autoSync, credentials, matchHistory, onHistoryMatched, onSyncRunning, syncRunning } from '../sync/syncService';
import { fillPlanReasons, moveSessionsToLibrary, nameRideSessions, retargetFootSessions, retireCreatedWorkouts } from './planService';
import { Today } from './screens/Today';
import { Calendar } from './screens/Calendar';
import { Library } from './screens/Library';
import { WorkoutScreen } from './screens/Workout';
import { Rides } from './screens/Rides';
import { Settings } from './screens/Settings';
import { Onboarding } from './screens/Onboarding';
import { Builder } from './screens/Builder';
import { SessionBuilder } from './screens/SessionBuilder';
import { BuildChooser } from './screens/BuildChooser';
import { RunBuilder } from './screens/RunBuilder';
import { findWorkout } from './store';
import { buildPowerCurves, curveContext } from './powerCurves';
import { buildReads, readsInput } from './reads';
import { ensureJudgment } from './judgeService';
import { Plan } from './screens/Plan';
import { PlanPage } from './screens/PlanPage';
import { Progress } from './screens/Progress';
import { Help } from './screens/Help';
import { PrintView } from './screens/Print';
import { Player } from './screens/Player';
import { sendWaitingRides, tidyRecordings } from '../player/rides';
import { watchGarminRule } from './garminWatch';
import { Icon } from './icons';
import { Logo } from './Brand';
import { toast, Toaster } from './Toast';
import { UpdateBanner } from './UpdateBanner';
import { Skeleton } from './PageHead';

const TABS = [
  { path: 'today', label: 'Today', icon: <Icon.sun /> },
  { path: 'calendar', label: 'Calendar', icon: <Icon.calendar /> },
  { path: 'rides', label: 'Activities', icon: <Icon.ride size={22} /> },
  { path: 'progress', label: 'Progress', icon: <Icon.progress /> },
  { path: 'library', label: 'Library', icon: <Icon.library /> },
  { path: 'plan', label: 'Plan', icon: <Icon.plan /> },
  { path: 'settings', label: 'Settings', icon: <Icon.settings />, railOnly: true, railFirst: true },
  { path: 'help', label: 'Help', icon: <Icon.help />, railOnly: true },
];

export function App() {
  const route = useRoute();
  const data = useAppData();
  // Merge with the rider's other devices on launch and whenever the app comes back to the front (at most once a minute),
  // then bring this device's history level with theirs.
  useEffect(() => {
    let last = 0;
    const run = async () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      const c = await credentials();
      if (c) { await syncDevices(c); void matchHistory(); }
      // Batch 6: walks and runs on the calendar move to their new targets once, after the merge, so a
      // device that already has another device's conversion does nothing.
      try {
        const r = await retargetFootSessions(c);
        if (r.walks || r.runs) {
          if (c) await syncDevices(c);
          const parts = [r.walks ? `${r.walks} walk${r.walks === 1 ? '' : 's'} now easy (no minimum, up to the top of zone 2)` : '', r.runs ? `${r.runs} run${r.runs === 1 ? '' : 's'} now on your foot zones` : ''].filter(Boolean).join(' and ');
          const sent = r.resent ? ` ${r.resent} re-sent to your Garmin with the new targets.` : '';
          const failed = r.failed ? ` ${r.failed} could not be re-sent: use Send on the Calendar.` : '';
          toast({ ok: !r.failed, text: `Updated your calendar: ${parts}.${sent}${failed}` });
        }
      } catch { /* the conversion runs again at the next start */ }
      // Batch 6 B4: rides the plan put on the calendar before plans were built from the Library take
      // their Library names, after the walk re-target above.
      try { if (await nameRideSessions() && c) await syncDevices(c); } catch { /* runs again at the next start */ }
      // 30 Oct 2026 (the plan engine): strength the planner built itself moves onto the Library's sessions, once.
      try {
        const r = await moveSessionsToLibrary();
        if (r.moves.length) {
          if (c) await syncDevices(c);
          toast({ ok: !r.failed, text: `Your plan’s sessions now come from the Library.${r.resent ? ` ${r.resent} re-sent to your Garmin.` : ''}${r.failed ? ` ${r.failed} could not be re-sent: use Send on the Calendar.` : ''}` });
        }
      } catch { /* runs again at the next start */ }
      // 30 Oct 2026: sessions of a plan placed before reasons were stored get theirs, once.
      try { if (await fillPlanReasons() && c) await syncDevices(c); } catch { /* runs again at the next start */ }
      // Batch 6 B2.6: workouts Part B briefly let a plan add to the Library are retired.
      // Rides recorded by the player that have not reached Intervals.icu yet go up now (quietly; Today shows any still waiting).
      try { const r = await sendWaitingRides(); if (r.sent) { notify(); toast({ ok: true, text: `Saved ${r.sent} recorded ride${r.sent === 1 ? '' : 's'} to Intervals.icu.` }); } await tidyRecordings(); } catch { /* tried again next time */ }
      // Step 2b (30 Oct 2026): the per-ride cache (curve, heart rate alongside power, hard sessions judged) fills in
      // the background, so Today's FTP messages have their evidence without a visit to Progress.
      try { const d = await loadAppData(); buildPowerCurves(d.rides, (p) => { if (p.total && p.done === p.total) notify(); }, curveContext(d.profile, d.planned, (id) => findWorkout(d.mine, id))); } catch { /* tried again next time */ }
      // 1 Nov 2026: the coach's old review after a sync is replaced by its judgment of the day; the old setting goes (on every device).
      try { if (await db.settings.get('coachReview')) await db.settings.delete('coachReview'); } catch { /* next start */ }
      // The re-check thinks (1 Nov 2026): every activity of the last 12 weeks is read once, planned or not.
      try { const d = await loadAppData(); void buildReads(readsInput(d)).then((n) => { if (n) notify(); }); } catch { /* tried again next time */ }
      try { const n = await retireCreatedWorkouts(); if (n) { if (c) await syncDevices(c); toast({ ok: true, text: `${n} session${n === 1 ? '' : 's'} on your calendar now use${n === 1 ? 's' : ''} the nearest Library workout.` }); } } catch { /* runs again at the next start */ }
    };
    const off = onHistoryMatched((r) => {
      notify();
      if (r.activities || r.wellness) toast({ ok: true, text: `Loaded ${r.activities} older activities and ${r.wellness} days of wellness, so this device has the same history as your others.` });
    });
    // Pull from Intervals.icu when the app opens and whenever it comes back to the front, if the last
    // pull is ten minutes old or more (Batch 9 A1). The coach's judgment (1 Nov 2026) is asked for after
    // every pull below, and only when what it is made from has changed; ensureJudgment checks that itself.
    const pull = () => autoSync(async () => { notify(); })
      .then((ran) => { if (ran) notify(); });
    run();
    pull();
    watchGarminRule();
    // After every pull the per-ride cache reads any new ride, so a Garmin ride with breathing is learned from (2A, 31 Oct).
    const offPulled = onSyncRunning(() => {
      if (syncRunning()) return;
      void loadAppData().then((d) => buildPowerCurves(d.rides, () => {}, curveContext(d.profile, d.planned, (id) => findWorkout(d.mine, id)))()).catch(() => {});   // no progress wanted: unsubscribe at once, the build runs on
      // Reads first, so the coach sees what the new activities show; then the judgment, if anything it is made from changed.
      void loadAppData().then((d) => buildReads(readsInput(d))).then(async (n) => { if (n) notify(); await ensureJudgment(await loadAppData()); }).catch(() => {});
    });
    const onVis = () => { if (document.visibilityState === 'visible') { run(); pull(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); off(); offPulled(); };
  }, []);
  // A new screen starts at its top; a screen returned to (Back, or the browser's back or forward) is put
  // back where it was left (8 Nov 2026). A change of query inside a screen (the Calendar's ?d=) does not
  // jump; a screen that places itself (the Calendar's focused day, Progress's chart) scrolls after this.
  const lastPath = useRef(route.path);
  useEffect(() => {
    const { nav, scroll } = arrival();
    const moved = lastPath.current !== route.path;
    lastPath.current = route.path;
    if (scroll !== undefined) {
      // The page may still be filling in: try again briefly until it is tall enough to reach the spot.
      const put = (tries: number) => { window.scrollTo(0, scroll); if (Math.abs(window.scrollY - scroll) > 2 && tries > 0) setTimeout(() => put(tries - 1), 50); };
      put(6);
    } else if (moved && nav !== 'replace') window.scrollTo(0, 0);
  }, [route.raw]);
  if (!data.loaded) return <Loading />;
  if (!data.profile) return <Onboarding />;

  const [root, id] = route.parts;
  if (root === 'print') return <PrintView data={data} planId={id} params={route.params} />;
  // The ride player has the whole window, without the app's menu.
  if (root === 'play') return <><Player data={data} parts={route.parts} /><Toaster /></>;
  let screen;
  switch (root) {
    // The list screens read their view (filters, tab, month) from the address when they open, so each
    // address is its own screen: the sidebar's plain link opens it fresh, Back opens it as it was left.
    case 'calendar': screen = <Calendar key={route.raw} data={data} params={route.params} />; break;
    case 'library': screen = <Library key={route.raw} data={data} />; break;
    case 'workout': screen = <WorkoutScreen data={data} id={id} params={route.params} />; break;
    case 'build': {
      const copyId = route.params.get('copy') ?? undefined;
      const source = id ? findWorkout(data.mine, id) : copyId ? findWorkout(data.mine, copyId) : undefined;
      const kind = (source?.kind ?? route.params.get('kind') ?? '') as string;
      const key = id ?? copyId ?? `new-${kind}`;
      screen = !kind ? <BuildChooser /> : kind === 'run' ? <RunBuilder key={key} data={data} id={id} copyId={copyId} />
        : kind === 'strength' || kind === 'mobility' || kind === 'walk'
        ? <SessionBuilder key={key} data={data} kind={kind} id={id} copyId={copyId} />
        : <Builder key={key} data={data} id={id} copyId={copyId} />;
      break;
    }
    case 'plan': screen = id ? <PlanPage data={data} id={id} editing={route.parts[2] === 'edit'} /> : <Plan data={data} />; break;
    case 'progress': screen = <Progress data={data} params={route.params} />; break;
    case 'rides': screen = <Rides key={route.raw} data={data} id={id} />; break;
    case 'settings': screen = <Settings data={data} />; break;
    case 'help': screen = <Help params={route.params} />; break;
    default: screen = <Today data={data} />;
  }
  const active = root === 'workout' ? (route.params.get('from') ?? 'library') : root === 'build' ? 'library' : root || 'today';

  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand"><Logo height={54} tag="below" /></div>
        {TABS.map((t) => [
          <a key={t.path} href={`#/${t.path}`} aria-current={active === t.path ? 'page' : undefined} class={`${active === t.path ? 'active' : ''}${'railOnly' in t && t.railOnly ? ' rail-only' : ''}${'railFirst' in t && t.railFirst ? ' rail-first' : ''}`}>{t.icon}<span>{t.label}</span></a>,
          'groupEnd' in t && t.groupEnd ? <div key={`${t.path}-sep`} class="nav-sep" /> : null,
        ])}
      </nav>
      <header class="topbar">
        <Logo height={26} tag="beside" />
        <a href="#/help" class="help-link" aria-label="Help"><Icon.help size={20} /></a>
        <a href="#/settings" class="help-link" aria-label="Settings" style="margin-left:0"><Icon.settings size={20} /></a>
      </header>
      <main class="main"><UpdateBanner />{screen}</main>
      <Toaster />
    </div>
  );
}

/** What shows for the moment before the database answers: the shell's shape, shimmering. */
function Loading() {
  return (
    <div class="shell">
      <main class="main" aria-busy="true">
        <div class="stack" style="gap:14px">
          <Skeleton h={12} w={140} />
          <Skeleton h={30} w={220} />
          <Skeleton h={220} r={12} />
          <Skeleton h={120} r={12} />
        </div>
      </main>
    </div>
  );
}
