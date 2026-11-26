/**
 * The iPhone and iPad app's self-test (24 Nov 2026). Runs only in the test build the publishing machine starts in
 * Apple's simulator, when that machine asks for it; the app riders get never runs it (its native side always answers
 * "not asked"). It checks, from inside the real app, what a browser test cannot: that the pages run from inside the
 * app with nothing fetched, that data survives the app being closed and opened again, that the Garmin key is kept in
 * the iPhone's password store and nowhere else, that the app's own side reaches Garmin (a stand-in here) and refuses
 * any address that isn't one of the services a rider connects, and where the notch and home bar sit.
 * The result is written to a file the publishing machine reads; a failure there stops the iOS build being uploaded.
 */
import { registerPlugin } from '@capacitor/core';
import { appKey, garminFetch } from './shell';
import { db, getSetting, setSetting } from './data/db';
import { makeBackup } from './data/backup';
import { GARMIN_KEY_SETTING, runGarminTest } from './sync/garminPersonal';
import { chooseDevice } from './player/ble/web';
import { chooserBus } from './player/ble/chooserBus';
import { playerOffered } from './player/platform';

interface TestSide {
  btState(): Promise<{ state: string }>;
  keepAwake(o: { on: boolean }): Promise<void>;
  selfTest(): Promise<{ requested: boolean; run?: string }>;
  report(o: { name: string; text: string }): Promise<void>;
}

const KEY = 'made-up-garmin-key-0123456789';
const MARK = 'selfTestMark';

export async function runIosSelfTest(): Promise<void> {
  const side = registerPlugin<TestSide>('AntogoNative');
  const asked = await side.selfTest().catch(() => ({ requested: false, run: '1' }));
  if (!asked.requested) return;
  const run = asked.run ?? '1';
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = async (name: string, fn: () => Promise<string | boolean | void>) => {
    try {
      const r = await fn();
      checks.push({ name, ok: r !== false, ...(typeof r === 'string' ? { detail: r } : {}) });
    } catch (e) { checks.push({ name, ok: false, detail: (e as Error).message }); }
  };

  // What the page asked the outside world for while it opened, before anything below asks for anything.
  const atLaunch = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith('capacitor://'));
  await check('The pages run from inside the app', async () => { if (location.protocol !== 'capacitor:') throw new Error(`address is ${location.href}`); return true; });
  await check('Nothing fetched from outside when the app opened', async () => atLaunch.length === 0 ? true : (() => { throw new Error(atLaunch.join(', ')); })());

  if (run === '1') {
    await check('Data is kept on the device', async () => {
      await setSetting(MARK, { at: new Date().toISOString() });
      return !!(await getSetting(MARK, null));
    });
    await check('Storage the system keeps', async () => {
      const persisted = await navigator.storage?.persist?.().catch(() => false);
      return `persist() answered ${String(persisted)}`;
    });
    await check('The Garmin key is kept in the password store', async () => {
      await appKey.save(KEY);
      const back = await appKey.read();
      if (back?.key !== KEY) throw new Error('read back something else');
      return true;
    });
    await check("The key is not in the app's data", async () => {
      if (await getSetting(GARMIN_KEY_SETTING, null)) throw new Error('found in the settings');
      if (JSON.stringify(await db.settings.toArray()).includes(KEY)) throw new Error('found in the data');
      return true;
    });
    await check('The key is not in a backup', async () => !JSON.stringify(await makeBackup()).includes(KEY));
    await check("Garmin (a stand-in) answers the app's own side", async () => {
      const steps = await runGarminTest(KEY, () => {}, garminFetch, new Date(), 'app');
      const first = steps.slice(0, 2);
      if (first.length < 2 || !first.every((s) => s.ok)) throw new Error(steps.map((s) => `${s.name}: ${s.ok ? 'ok' : s.words}`).join(' | '));
      return `${steps.filter((s) => s.ok).length} of ${steps.length} steps answered`;
    });
    await check("The app's own side refuses an address that isn't a connected service", async () => {
      try { await garminFetch('https://example.com/'); } catch { return true; }
      throw new Error('example.com was asked');
    });
    // Bluetooth for the ride player (25 Nov 2026). Apple's simulator has no Bluetooth, so what is checked here is that
    // the app's own side answers, that the pages are offered it, and that Bluetooth which can't be used is said in words.
    await check('The ride player is offered on this device', async () => playerOffered());
    await check("The app's own side offers Bluetooth to the pages", async () => 'bluetooth' in navigator && !!navigator.bluetooth);
    let bluetooth = 'unknown';
    await check("Asking for Bluetooth's state is answered", async () => { bluetooth = (await side.btState()).state; return `it answered "${bluetooth}"`; });
    await check('Bluetooth that cannot be used is said to the rider, and nothing is searched for', async () => {
      if (bluetooth === 'on') return 'Bluetooth is on here, so there was nothing to say';
      let said = '';
      chooserBus.watchProblems((p) => { said = p; });
      let chose = false;
      try { await chooseDevice('trainer'); chose = true; } catch { /* as it should */ }
      chooserBus.watchProblems(() => undefined);
      if (chose) throw new Error('a device was handed back');
      if (!said) throw new Error('nothing was said');
      return `said "${said}"`;
    });
    await check('The screen can be kept on for a ride, and let go again', async () => { await side.keepAwake({ on: true }); await side.keepAwake({ on: false }); return true; });
  } else {
    await check('Data is still there after closing and opening the app', async () => !!(await getSetting(MARK, null)));
    await check('The key is still in the password store after opening the app again', async () => (await appKey.read())?.key === KEY);
    await check('Forgetting the key removes it', async () => { await appKey.forget(); return !(await appKey.read()); });
  }

  // Where the notch and the home bar are: the page's own measure of the safe areas.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft, width: innerWidth, height: innerHeight };
  probe.remove();

  // The page is shown at its own size: an iPhone enlarges a page when a box with small text is typed in, which Antogo's text sizes must not cause.
  const scale = window.visualViewport?.scale ?? 1;
  checks.push({ name: 'The page is shown at its own size, not enlarged', ok: Math.abs(scale - 1) < 0.01 && innerWidth === screen.width, detail: `scale ${scale}, page ${innerWidth} wide on a screen ${screen.width} wide` });
  const ok = checks.every((c) => c.ok);
  await side.report({ name: `antogo-selftest-${run}.json`, text: JSON.stringify({ ok, run, checks, insets, userAgent: navigator.userAgent }, null, 2) });
}
