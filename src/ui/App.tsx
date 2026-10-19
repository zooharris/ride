import { APP_NAME } from '../appName';
import { useRoute } from './router';
import { useAppData } from './store';
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
import { Help } from './screens/Help';
import { Icon } from './icons';

const TABS = [
  { path: 'today', label: 'Today', icon: <Icon.sun /> },
  { path: 'calendar', label: 'Calendar', icon: <Icon.calendar /> },
  { path: 'library', label: 'Library', icon: <Icon.library /> },
  { path: 'rides', label: 'Activities', icon: <Icon.ride size={22} /> },
  { path: 'settings', label: 'Settings', icon: <Icon.settings /> },
  { path: 'help', label: 'Help', icon: <Icon.help />, railOnly: true },
];

export function App() {
  const route = useRoute();
  const data = useAppData();
  if (!data.loaded) return <div class="main" />;
  if (!data.profile) return <Onboarding />;

  const [root, id] = route.parts;
  let screen;
  switch (root) {
    case 'calendar': screen = <Calendar data={data} />; break;
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
    case 'plan': screen = <Plan data={data} />; break;
    case 'rides': screen = <Rides data={data} id={id} />; break;
    case 'settings': screen = <Settings data={data} />; break;
    case 'help': screen = <Help />; break;
    default: screen = <Today data={data} />;
  }
  const active = root === 'workout' ? (route.params.get('from') ?? 'library') : root === 'build' ? 'library' : root === 'plan' ? 'calendar' : root || 'today';

  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand">
          <svg viewBox="0 0 512 512"><rect width="512" height="512" fill="#101418" /><g transform="translate(64 112)"><rect x="0" y="208" width="56" height="80" fill="#3C8DD6" /><rect x="64" y="96" width="56" height="192" fill="#D9D45A" /><rect x="128" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="176" y="48" width="56" height="240" fill="#F08A4B" /><rect x="240" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="288" y="0" width="56" height="288" fill="#E0485B" /><rect x="352" y="224" width="32" height="64" fill="#6B7A8F" /></g></svg>
          {APP_NAME}
        </div>
        {TABS.map((t) => (
          <a key={t.path} href={`#/${t.path}`} class={`${active === t.path ? 'active' : ''}${'railOnly' in t && t.railOnly ? ' rail-only' : ''}`}>{t.icon}<span>{t.label}</span></a>
        ))}
      </nav>
      <header class="topbar">
        <svg viewBox="0 0 512 512" class="mark"><rect width="512" height="512" rx="112" fill="#101418" /><g transform="translate(64 112)"><rect x="0" y="208" width="56" height="80" fill="#3C8DD6" /><rect x="64" y="96" width="56" height="192" fill="#D9D45A" /><rect x="128" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="176" y="48" width="56" height="240" fill="#F08A4B" /><rect x="240" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="288" y="0" width="56" height="288" fill="#E0485B" /><rect x="352" y="224" width="32" height="64" fill="#6B7A8F" /></g></svg>
        <span>{APP_NAME}</span>
        <a href="#/help" class="help-link" aria-label="Help"><Icon.help size={20} /></a>
      </header>
      <main class="main">{screen}</main>
    </div>
  );
}
