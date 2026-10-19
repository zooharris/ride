import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './styles/global.css';
import { initTheme } from './ui/theme';

// The app updates itself: the service worker is re-checked on every launch and every 15 minutes
// while open, and a new build takes over on the next reload.
registerSW({
  immediate: true,
  onRegisteredSW(_url, r) { if (r) setInterval(() => { r.update().catch(() => {}); }, 15 * 60 * 1000); },
});
// Every launch opens on Today, whatever screen was showing when the app was last closed.
if (location.hash && location.hash !== '#/today') history.replaceState(null, '', `${location.pathname}#/today`);
initTheme();
render(<App />, document.getElementById('app')!);
