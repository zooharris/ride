import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './styles/font.css';
import './styles/global.css';
import { initTheme } from './ui/theme';
import { startHistory } from './ui/router';
import { checkForUpdate, setRegistration, setUpdateReady } from './ui/update';
import { appBluetooth, appKind, inApp } from './shell';
import { BluetoothChooser } from './ui/BluetoothChooser';
import { startGarmin } from './sync/garminAuto';

// New versions are checked for on every launch, every 15 minutes while open, and whenever the app
// comes back to the front. A new build
// waits until the rider presses Reload on the banner, so old code never runs unannounced.
// Inside the installed app the pages are already packed in, so nothing is cached or swapped: a newer version is a new file to download.
if (!inApp()) registerSW({
  immediate: true,
  onNeedRefresh() { setUpdateReady(); },
  onRegisteredSW(_url, r) {
    if (!r) return;
    setRegistration(r);
    void checkForUpdate(true);
  },
});
// Look for a newer version at launch, every 15 minutes, and whenever the app comes back to the front
// (including an iPhone home-screen app resumed from the background, which fires pageshow).
setTimeout(() => { void checkForUpdate(true); }, 3000);
setInterval(() => { void checkForUpdate(true); }, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate(); });
window.addEventListener('focus', () => { void checkForUpdate(); });
window.addEventListener('pageshow', () => { void checkForUpdate(); });
// Every launch opens on Today, whatever screen was showing when the app was last closed.
if (location.hash && location.hash !== '#/today') history.replaceState(null, '', `${location.pathname}#/today`);
// This entry is the visit's first: Back buttons on it fall back to their own page (8 Nov 2026).
startHistory();
initTheme();
// The installed app, with the rider's say-so, brings what is new from Garmin by itself.
startGarmin();
// iPhone and iPad: the self-test the publishing machine asks for in Apple's simulator (never in the app riders get).
if (appKind() === 'ios') setTimeout(() => { void import('./selfTestIos').then((m) => m.runIosSelfTest()); }, 2500);
// The installed app shows its own list for choosing a Bluetooth device, over whatever screen asked for one.
render(<><App />{appBluetooth.can() && <BluetoothChooser />}</>, document.getElementById('app')!);
