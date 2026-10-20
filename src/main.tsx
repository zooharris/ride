import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './styles/global.css';
import { initTheme } from './ui/theme';
import { setUpdateReady } from './ui/update';

// New versions are checked for on every launch and every 15 minutes while open. A new build
// waits until the rider presses Reload on the banner, so old code never runs unannounced.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { setUpdateReady(() => { updateSW(true); }); },
  onRegisteredSW(_url, r) { if (r) setInterval(() => { r.update().catch(() => {}); }, 15 * 60 * 1000); },
});
// Every launch opens on Today, whatever screen was showing when the app was last closed.
if (location.hash && location.hash !== '#/today') history.replaceState(null, '', `${location.pathname}#/today`);
initTheme();
render(<App />, document.getElementById('app')!);
