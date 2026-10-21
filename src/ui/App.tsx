import { APP_NAME } from '../appName';
import { useRoute } from './router';
import { notify, useAppData } from './store';
import { useEffect } from 'preact/hooks';
import { syncDevices } from '../data/devicesync';
import { credentials, matchHistory, onHistoryMatched } from '../sync/syncService';
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
import { findWorkout } from './store';
import { Plan } from './screens/Plan';
import { PlanPage } from './screens/PlanPage';
import { Progress } from './screens/Progress';
import { Help } from './screens/Help';
import { PrintView } from './screens/Print';
import { Icon } from './icons';
import { Logo, Mark } from './Brand';
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
    const run = async () => { if (Date.now() - last < 60_000) return; last = Date.now(); const c = await credentials(); if (c) { await syncDevices(c); void matchHistory(); } };
    const off = onHistoryMatched((r) => {
      notify();
      if (r.activities || r.wellness) toast({ ok: true, text: `Loaded ${r.activities} older activities and ${r.wellness} days of wellness, so this device has the same history as your others.` });
    });
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); off(); };
  }, []);
  if (!data.loaded) return <Loading />;
  if (!data.profile) return <Onboarding />;

  const [root, id] = route.parts;
  if (root === 'print') return <PrintView data={data} planId={id} params={route.params} />;
  let screen;
  switch (root) {
    case 'calendar': screen = <Calendar data={data} params={route.params} />; break;
    case 'library': screen = <Library data={data} />; break;
    case 'workout': screen = <WorkoutScreen data={data} id={id} params={route.params} />; break;
    case 'build': {
      const copyId = route.params.get('copy') ?? undefined;
      const source = id ? findWorkout(data.mine, id) : copyId ? findWorkout(data.mine, copyId) : undefined;
      const kind = (source?.kind ?? route.params.get('kind') ?? '') as string;
      const key = id ?? copyId ?? `new-${kind}`;
      screen = !kind ? <BuildChooser /> : kind === 'strength' || kind === 'mobility' || kind === 'walk'
        ? <SessionBuilder key={key} data={data} kind={kind} id={id} copyId={copyId} />
        : <Builder key={key} data={data} id={id} copyId={copyId} />;
      break;
    }
    case 'plan': screen = id ? <PlanPage data={data} id={id} editing={route.parts[2] === 'edit'} /> : <Plan data={data} />; break;
    case 'progress': screen = <Progress data={data} />; break;
    case 'rides': screen = <Rides data={data} id={id} />; break;
    case 'settings': screen = <Settings data={data} />; break;
    case 'help': screen = <Help />; break;
    default: screen = <Today data={data} />;
  }
  const active = root === 'workout' ? (route.params.get('from') ?? 'library') : root === 'build' ? 'library' : root || 'today';

  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand"><Logo height={26} /></div>
        {TABS.map((t) => [
          <a key={t.path} href={`#/${t.path}`} aria-current={active === t.path ? 'page' : undefined} class={`${active === t.path ? 'active' : ''}${'railOnly' in t && t.railOnly ? ' rail-only' : ''}${'railFirst' in t && t.railFirst ? ' rail-first' : ''}`}>{t.icon}<span>{t.label}</span></a>,
          'groupEnd' in t && t.groupEnd ? <div key={`${t.path}-sep`} class="nav-sep" /> : null,
        ])}
      </nav>
      <header class="topbar">
        <Mark size={24} />
        <span>{APP_NAME}</span>
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
