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

const TABS = [
  { path: 'today', label: 'Today', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg> },
  { path: 'calendar', label: 'Calendar', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg> },
  { path: 'library', label: 'Library', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V9M9 20V4M14 20v-8M19 20V7" /></svg> },
  { path: 'rides', label: 'Rides', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-8h5l3 8M10 8l-1.5-3h3" /></svg> },
  { path: 'settings', label: 'Settings', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg> },
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
    case 'rides': screen = <Rides data={data} id={id} />; break;
    case 'settings': screen = <Settings data={data} />; break;
    default: screen = <Today data={data} />;
  }
  const active = root === 'workout' ? (route.params.get('from') ?? 'library') : root || 'today';

  return (
    <div class="shell">
      <nav class="nav">
        <div class="brand">
          <svg viewBox="0 0 512 512"><rect width="512" height="512" fill="#101418" /><g transform="translate(64 112)"><rect x="0" y="208" width="56" height="80" fill="#3C8DD6" /><rect x="64" y="96" width="56" height="192" fill="#D9D45A" /><rect x="128" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="176" y="48" width="56" height="240" fill="#F08A4B" /><rect x="240" y="208" width="40" height="80" fill="#3C8DD6" /><rect x="288" y="0" width="56" height="288" fill="#E0485B" /><rect x="352" y="224" width="32" height="64" fill="#6B7A8F" /></g></svg>
          {APP_NAME}
        </div>
        {TABS.map((t) => (
          <a key={t.path} href={`#/${t.path}`} class={active === t.path ? 'active' : ''}>{t.icon}<span>{t.label}</span></a>
        ))}
      </nav>
      <main class="main">{screen}</main>
    </div>
  );
}
