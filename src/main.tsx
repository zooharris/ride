import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './styles/global.css';
import { initTheme } from './ui/theme';
import { checkForUpdate, setRegistration, setUpdateReady } from './ui/update';

// New versions are checked for on every launch, every 15 minutes while open, and whenever the app
// comes back to the front. A new build
// waits until the rider presses Reload on the banner, so old code never runs unannounced.
registerSW({
  immediate: true,
  onNeedRefresh() { setUpdateReady(); },
  onRegisteredSW(_url, r) {
    if (!r) return;
    setRegistration(r);
    setInterval(() => { void checkForUpdate(true); }, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate(); });
    window.addEventListener('focus', () => { void checkForUpdate(); });
  },
});
// Every launch opens on Today, whatever screen was showing when the app was last closed.
if (location.hash && location.hash !== '#/today') history.replaceState(null, '', `${location.pathname}#/today`);
initTheme();
render(<App />, document.getElementById('app')!);
