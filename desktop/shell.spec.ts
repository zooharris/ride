import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standIn, watchProblems } from '../journeys/standin';
import { answers, go } from '../journeys/rider';
import { encodeFitActivity } from '../src/export/activityFiles';
import type { Ride } from '../src/engine/types';

/**
 * The installed app, used as a rider would (23 Nov 2026). What these show: every page runs from inside the app with
 * nothing fetched to start it; a backup made in the app restores into a fresh copy of the app; Garmin, which gives a
 * web page no answer, answers the app's own side; and the Garmin key is kept apart from the app's data and backups.
 * ANTOGO_APP=<path to the built app's program> runs the same journeys against the packaged app.
 */
const KEY = 'made-up-garmin-key-0123456789';
const scratch = (what: string) => mkdtempSync(join(tmpdir(), `antogo-${what}-`));

/** A stand-in for Garmin: it answers any program, and gives web pages no permission to read its answers. */
function garminStandIn(seen: string[]): Promise<Server> {
  const t = Array.from({ length: 600 }, (_, i) => i);
  const fit = encodeFitActivity({ id: 'a', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'Long ride', type: 'Ride', sport: 'ride', seconds: 600 } as Ride, { time: t, watts: t.map(() => 200), heartrate: t.map(() => 140) });
  const token = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64')}.y`;
  const srv = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(`${req.method} ${url.split('?')[0]} ${String(req.headers.authorization ?? '').split(' ')[0]}`);
    const json = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.includes('personal-api-key/token')) {
      if (req.headers.authorization !== `ApiKey ${KEY}`) { res.writeHead(401); res.end('bad key'); return; }
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end(token); return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end('no token'); return; }
    if (url.startsWith('/userprofile-service')) return json({ id: 1, measurementSystem: 'statute' });
    if (url.startsWith('/activitylist-service')) return json(url.includes('start=0') ? [{ activityId: 9, activityName: 'Long ride', startTimeLocal: '2026-11-21 08:00:00', duration: 600, activityType: { typeKey: 'cycling' } }, { activityId: 8, activityName: 'Walk', startTimeLocal: '2019-03-02 08:00:00' }] : []);
    // The newest activity has its original file; the old one was entered by hand and has none.
    if (url.startsWith('/download-service/files/activity/9')) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.from(fit)); return; }
    if (url.startsWith('/download-service')) { res.writeHead(404); res.end(''); return; }
    // One night's wellness, yesterday's, whatever stretch is asked for.
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (url.startsWith('/hrv-service')) return json({ hrvSummaries: [{ calendarDate: yesterday, lastNightAvg: 58 }] });
    if (url.startsWith('/sleep-service')) return json([{ calendarDate: yesterday, sleepTimeSeconds: 27000 }]);
    if (url.startsWith('/usersummary-service')) return json([{ calendarDate: yesterday, restingHeartRate: 49, totalSteps: 8123 }]);
    return json([]);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

interface Running { app: ElectronApplication; page: Page; problems: string[]; outside: string[]; data: string; downloads: string }
async function launch(opts: { data?: string; garmin?: string; kind?: 'new' | 'power'; update?: string } = {}): Promise<Running> {
  const data = opts.data ?? scratch('data');
  const downloads = scratch('downloads');
  const env = { ...process.env, ANTOGO_DATA: data, ANTOGO_DOWNLOADS: downloads, ANTOGO_TEST_STORE: '1', ...(opts.garmin ? { ANTOGO_GARMIN_BASE: opts.garmin } : {}), ...(opts.update ? { ANTOGO_UPDATE_LATEST: opts.update } : {}) } as Record<string, string>;
  const flags = process.platform === 'linux' ? ['--no-sandbox', '--password-store=basic'] : [];
  const app = process.env.ANTOGO_APP
    ? await electron.launch({ executablePath: process.env.ANTOGO_APP, args: flags, env })
    : await electron.launch({ args: [...flags, '.'], env });
  const page = await app.firstWindow();
  const problems = watchProblems(page);
  const outside: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('app://') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
  await standIn(page, opts.kind ?? 'new');
  await page.reload();
  return { app, page, problems, outside, data, downloads };
}

/** First-run setup for a rider with no account, through to Today. */
async function setUpNew(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Set up Antogo' }).click();
  await page.getByLabel('Name').fill('Nova Example');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: "I don't know" }).first().click();
  await page.getByRole('button', { name: '5 h', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page).toHaveURL(/#\/today/);
}

test('the app opens on its own pages, with nothing fetched to start it', async () => {
  const r = await launch();
  await expect(r.page.getByText('Better rides. Fitter you.')).toBeVisible();
  expect(await r.page.evaluate(() => location.origin)).toBe('app://antogo');
  // The typeface is the app's own, loaded from inside it.
  await expect.poll(() => r.page.evaluate(() => document.fonts.check('16px Archivo'))).toBe(true);
  expect(await r.page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''))).then((x) => x.includes('Archivo'))).toBe(true);
  // The app keeps the rider's data, and the system treats it as permanent.
  expect(await r.page.evaluate(() => navigator.storage.persisted())).toBe(true);
  // Nothing has been cached or swapped behind the pages: the app has no service worker.
  expect(await r.page.evaluate(async () => navigator.serviceWorker?.getRegistrations().then((x) => x.length, () => 0) ?? 0)).toBe(0);
  await setUpNew(r.page);
  await r.page.waitForTimeout(4000);   // past the launch's look for a newer version
  // The only thing asked of the outside world is whether a newer version is published.
  expect(r.outside.filter((u) => !/zooharris\.github\.io\/ride\/version\.json/.test(u))).toEqual([]);
  // The app's own downloader is there, and has started nothing by itself.
  expect(await r.page.evaluate(() => (window as unknown as { antogoApp: { updateState(): Promise<{ state: string }> } }).antogoApp.updateState())).toEqual({ state: 'idle' });
  expect(r.problems).toEqual([]);
  console.log(`Bluetooth in this engine on ${process.platform}: ${await r.page.evaluate(() => 'bluetooth' in navigator)}`);
  await r.app.close();
});

test('a plan made in the app is backed up, and restored into a fresh copy of the app', async () => {
  const a = await launch();
  await setUpNew(a.page);
  await go(a.page, '#/plan');
  await a.page.getByRole('button', { name: 'Build the plan' }).click();
  await a.page.getByRole('button', { name: 'Put it on the calendar' }).click();
  await expect(a.page).toHaveURL(/#\/calendar/, { timeout: 30_000 });
  await go(a.page, '#/settings');
  await a.page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await a.page.getByRole('button', { name: 'Back up everything' }).click();
  await expect.poll(() => readdirSync(a.downloads).filter((f) => /backup/.test(f) && !f.endsWith('.crdownload')).length, { timeout: 20_000 }).toBe(1);
  const file = join(a.downloads, readdirSync(a.downloads).find((f) => /backup/.test(f))!);
  await a.page.waitForTimeout(800);
  expect(a.problems).toEqual([]);
  await a.app.close();

  // The data is still there when the app is opened again.
  const again = await launch({ data: a.data });
  await expect(again.page.getByRole('link', { name: 'Today' }).first()).toBeVisible();
  await go(again.page, '#/plan');
  await expect(again.page.locator('main')).toContainText(/Event plan/);
  await again.app.close();

  // A fresh copy of the app, as on another computer: empty, then restored.
  const b = await launch();
  await setUpNew(b.page);
  await answers(b.page);
  await go(b.page, '#/settings');
  await b.page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await b.page.locator('input[type=file][accept*="json"]').setInputFiles(file);
  await b.page.waitForEvent('load', { timeout: 20_000 }).catch(() => {});
  await go(b.page, '#/plan');
  await expect(b.page.locator('main')).toContainText(/Event plan/);
  expect(b.problems).toEqual([]);
  await b.app.close();
});

test('Garmin, which gives a web page no answer, answers the app; and the key is kept apart from the data', async () => {
  test.skip(!!process.env.ANTOGO_APP, 'The built app only ever asks Garmin itself, so this runs against the app before it is packed.');
  const seen: string[] = [];
  const srv = await garminStandIn(seen);
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  const r = await launch({ garmin: base });
  await setUpNew(r.page);

  // A web page asking the same stand-in directly is refused its answer, as in a browser.
  const direct = await r.page.evaluate(async (u) => { try { await (await fetch(`${u}userprofile-service/x`)).text(); return 'read'; } catch { return 'blocked'; } }, base);
  expect(direct).toBe('blocked');
  seen.length = 0;
  // The app's own side asks Garmin's address only.
  const elsewhere = await r.page.evaluate(async () => { try { await (window as unknown as { antogoApp: { garminFetch(u: string): Promise<unknown> } }).antogoApp.garminFetch('https://example.com/'); return 'answered'; } catch { return 'refused'; } });
  expect(elsewhere).toBe('refused');

  await go(r.page, '#/garmin-key');
  await expect(r.page.getByText('Garmin does not answer a browser.')).toHaveCount(0);
  await r.page.getByLabel('Garmin personal key').fill(KEY);
  await r.page.getByRole('button', { name: 'Save on this device' }).click();
  const shown = r.page.getByLabel('Your Garmin personal key');
  await expect(shown).not.toContainText(KEY);
  await r.page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(shown).toHaveText(KEY);

  await r.page.getByRole('button', { name: 'Run the test' }).click();
  await expect(r.page.getByRole('button', { name: 'Run the test again' })).toBeVisible({ timeout: 30_000 });
  const main = r.page.locator('main');
  await expect(main).toContainText('Garmin exchanged the key for a token');
  await expect(main).not.toContainText('A web page can reach Garmin');
  await expect(main).toContainText('Listed 2 activities, from 2019-03-02 to 2026-11-21');
  await expect(main).toContainText(/Downloaded Long ride .* 10 minutes, with power, heart rate/);
  await expect(main).toContainText('HRV: 1 entry');
  expect(seen[0]).toMatch(/^POST .*token ApiKey$/);
  expect(seen.slice(1).every((s) => s.endsWith('Bearer'))).toBe(true);

  // Garmin as a source: nothing is fetched until the rider says so.
  seen.length = 0;
  await r.page.waitForTimeout(1000);
  expect(seen).toEqual([]);
  await r.page.getByRole('button', { name: 'Bring my activities and wellness from Garmin' }).click();
  const source = r.page.locator('section', { hasText: 'Bring from Garmin' });
  await expect(source).toContainText('Last fetched', { timeout: 60_000 });
  await expect(source).toContainText('1 activity added from Garmin');
  await expect(source).toContainText('1 has no file at Garmin');
  await expect(source).toContainText('1 day of wellness filled in');
  if (process.env.SHOTS) await r.page.screenshot({ path: `${process.env.SHOTS}/garmin.png`, fullPage: true });
  expect(seen.filter((x) => x.includes('/download-service')).length).toBe(2);
  // Pressing again asks for the list and wellness, never for a file it has dealt with, and adds nothing twice.
  seen.length = 0;
  await r.page.getByRole('button', { name: 'Fetch from Garmin now' }).click();
  await expect(r.page.getByRole('button', { name: 'Fetching…' })).toHaveCount(0, { timeout: 60_000 });
  expect(seen.filter((x) => x.includes('/download-service'))).toEqual([]);
  await expect(source).toContainText('1 activity added from Garmin');
  // The activity is in the app under Garmin's name, worked out from its file, and says where it came from.
  await go(r.page, '#/rides');
  await r.page.getByRole('link', { name: /Long ride/ }).first().click();
  await expect(r.page.locator('main')).toContainText('From Garmin');
  await expect(r.page.locator('[data-own-numbers]')).toHaveAttribute('data-own-numbers', 'yes');
  // Turned off: it stops asking, and what was brought in stays.
  await go(r.page, '#/garmin-key');
  await r.page.getByRole('button', { name: 'Stop bringing from Garmin' }).click();
  await expect(r.page.getByRole('button', { name: 'Bring my activities and wellness from Garmin' })).toBeVisible();
  await expect(r.page.locator('section', { hasText: 'Bring from Garmin' })).toContainText('1 activity added');
  await go(r.page, '#/rides');
  await expect(r.page.getByRole('link', { name: /Long ride/ }).first()).toBeVisible();

  // The key is not in the app's data, nor in a backup, nor readable in the file that holds it.
  const inData = await r.page.evaluate(() => new Promise<boolean>((ok) => {
    const q = indexedDB.open('ride');
    q.onsuccess = () => { const t = q.result.transaction('settings').objectStore('settings').get('garminPersonalKey'); t.onsuccess = () => ok(!!t.result); t.onerror = () => ok(false); };
    q.onerror = () => ok(false);
  }));
  expect(inData).toBe(false);
  expect(readFileSync(join(r.data, 'garmin-key'), 'utf8')).not.toContain(KEY);
  await go(r.page, '#/settings');
  await r.page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await r.page.getByRole('button', { name: 'Back up everything' }).click();
  await expect.poll(() => readdirSync(r.downloads).filter((f) => /backup/.test(f) && !f.endsWith('.crdownload')).length, { timeout: 20_000 }).toBe(1);
  await r.page.waitForTimeout(500);
  expect(readFileSync(join(r.downloads, readdirSync(r.downloads)[0])).includes(Buffer.from(KEY))).toBe(false);
  // (The one error on the page is the refusal provoked above.)
  expect(r.problems.filter((p) => !/blocked by CORS policy/.test(p))).toEqual([]);
  await r.app.close();

  // Still there, and still hidden, when the app is opened again; and gone when forgotten.
  const again = await launch({ data: r.data, garmin: base });
  await go(again.page, '#/garmin-key');
  await answers(again.page);
  await again.page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(again.page.getByLabel('Your Garmin personal key')).toHaveText(KEY);
  await again.page.getByRole('button', { name: 'Forget' }).click();
  await expect(again.page.getByLabel('Garmin personal key', { exact: true })).toBeVisible();
  expect(existsSync(join(again.data, 'garmin-key'))).toBe(false);

  // A key that arrives in a backup made in a browser sits in the app's data: opening the page moves it to the password store.
  const put = (present: boolean) => again.page.evaluate((add) => new Promise<boolean>((ok) => {
    const q = indexedDB.open('ride');
    q.onsuccess = () => {
      const store = q.result.transaction('settings', 'readwrite').objectStore('settings');
      if (add) { const w = store.put({ key: 'garminPersonalKey', value: { key: add, savedAt: '2026-11-22T10:00:00.000Z' } }); w.onsuccess = () => ok(true); }
      else { const g = store.get('garminPersonalKey'); g.onsuccess = () => ok(!!g.result); }
    };
  }), present ? KEY : '');
  await put(true);
  await go(again.page, '#/today');
  await go(again.page, '#/garmin-key');
  await again.page.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(again.page.getByLabel('Your Garmin personal key')).toHaveText(KEY);
  expect(await put(false)).toBe(false);
  expect(existsSync(join(again.data, 'garmin-key'))).toBe(true);
  await again.app.close();
  srv.close();
});

test('Settings, Help and the ride player say plainly what the Mac app is', async () => {
  const r = await launch();
  await setUpNew(r.page);
  // Where the app can't reach Bluetooth at all (this test machine, on Linux), the player says so.
  if (process.platform === 'linux') {
    await go(r.page, '#/play/free');
    await expect(r.page.getByRole('heading', { name: 'The app can’t reach Bluetooth on this computer' })).toBeVisible();
  }
  await go(r.page, '#/settings');
  await expect(r.page.locator('main')).toContainText('This is Antogo for the Mac');
  await go(r.page, '#/help/start');
  await expect(r.page.locator('main')).toContainText('signed by its maker and checked by Apple');
  await expect(r.page.locator('main')).not.toContainText('Open Anyway');
  expect(r.problems).toEqual([]);
  await r.app.close();
});

test('choosing a Bluetooth device: the app shows its own list, and connects to nothing until one is picked', async () => {
  const r = await launch();
  await setUpNew(r.page);
  // The engine's search reports what it has found to the app's own side, again each time it finds more.
  const found = (devices: Array<{ deviceId: string; deviceName: string }>) => r.app.evaluate(({ BrowserWindow }, list) => {
    const g = globalThis as unknown as { picked?: string };
    g.picked = undefined;
    BrowserWindow.getAllWindows()[0].webContents.emit('select-bluetooth-device', { preventDefault() {} }, list, (id: string) => { g.picked = id; });
  }, devices);
  const picked = () => r.app.evaluate(() => (globalThis as unknown as { picked?: string }).picked);
  await found([]);
  const list = r.page.getByRole('dialog', { name: 'Choose a device' });
  await expect(list).toContainText('Nothing found yet.');
  await expect(list).toContainText('Still looking');
  await found([{ deviceId: 'aa', deviceName: 'KICKR CORE 1234' }, { deviceId: 'bb', deviceName: 'Unknown or Unsupported Device (bb)' }]);
  await expect(list.locator('.bt-item')).toHaveText(['KICKR CORE 1234', 'A device with no name']);
  if (process.env.SHOTS) await r.page.screenshot({ path: `${process.env.SHOTS}/chooser.png` });
  expect(await picked()).toBeUndefined();
  await list.getByRole('button', { name: 'KICKR CORE 1234' }).click();
  await expect(list).toHaveCount(0);
  expect(await picked()).toBe('aa');
  // Cancel stops the search without choosing anything.
  await found([{ deviceId: 'aa', deviceName: 'KICKR CORE 1234' }]);
  await list.getByRole('button', { name: 'Cancel' }).click();
  await expect(list).toHaveCount(0);
  expect(await picked()).toBe('');
  expect(r.problems).toEqual([]);
  await r.app.close();
});

test('a key an earlier copy of the app sealed, which this copy cannot read, is asked for once and said plainly', async () => {
  // What an unsigned copy leaves behind for a signed one: the key's file is there, sealed with a secret this copy is not given.
  const data = scratch('data');
  writeFileSync(join(data, 'garmin-key'), JSON.stringify({ sealed: Buffer.from('sealed-by-another-copy').toString('base64'), savedAt: '2026-11-23T12:00:00.000Z' }));
  const r = await launch({ data });
  await setUpNew(r.page);
  await go(r.page, '#/garmin-key');
  await expect(r.page.getByText('Please paste your key once more.')).toBeVisible();
  await expect(r.page.locator('main')).toContainText('make a new one in Garmin Connect');
  // Pasting it saves it in this copy's own store; the notice goes, and the key shows again after the app is reopened.
  await r.page.getByLabel('Garmin personal key').fill(KEY);
  await r.page.getByRole('button', { name: 'Save on this device' }).click();
  await expect(r.page.getByText('Please paste your key once more.')).toHaveCount(0);
  await expect(r.page.getByRole('button', { name: 'Copy the key' })).toBeVisible();
  expect(readFileSync(join(data, 'garmin-key'), 'utf8')).not.toContain(KEY);
  expect(r.problems).toEqual([]);
  await r.app.close();
});

test('About and legal: the open-source notices are inside the app, and say what it is built with', async () => {
  const r = await launch();
  await setUpNew(r.page);
  await go(r.page, '#/settings');
  await r.page.getByRole('button', { name: /About and legal/ }).click();
  await expect(r.page.locator('main')).toContainText('OpenStreetMap contributors');
  await r.page.getByRole('link', { name: 'Read the notices' }).click();
  const text = r.page.locator('.notices-text');
  for (const name of ['preact', 'dexie', 'leaflet', '@fontsource-variable/archivo', 'SIL Open Font License', 'Apache License', 'Electron']) await expect(text).toContainText(name);
  await expect(text).not.toContainText('GNU GENERAL PUBLIC LICENSE');
  // Reading them asked nothing of the outside world.
  expect(r.outside.filter((u) => !/zooharris\.github\.io\/ride\/version\.json/.test(u))).toEqual([]);
  expect(r.problems).toEqual([]);
  await r.app.close();
});

/**
 * A newer version, downloaded by the app itself (26 Nov 2026). A stand-in publishes a release and serves its file
 * slowly. What this shows: one press starts one download however often the button is pressed; the pages say how far
 * it has got; Cancel leaves nothing behind; the whole file is checked before it is called downloaded; a file already
 * in Downloads is never replaced; and a file that is not the one published is refused.
 */
function releaseStandIn(file: Buffer, seen: string[], wrongFingerprint = false): Promise<Server> {
  const sha = createHash('sha256').update(wrongFingerprint ? Buffer.from('another file') : file).digest('hex');
  const srv = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(url);
    const at = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    if (url.startsWith('/latest')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: 'mac-999', assets: [{ name: 'Antogo.dmg', size: file.length, digest: `sha256:${sha}`, browser_download_url: `${at}/Antogo.dmg` }] })); return; }
    if (url.startsWith('/Antogo.dmg')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(file.length) });
      const piece = Math.ceil(file.length / 16);
      let i = 0;
      const next = () => { if (res.destroyed) return; if (i >= file.length) { res.end(); return; } res.write(file.subarray(i, i + piece)); i += piece; setTimeout(next, 180); };
      next();
      return;
    }
    res.writeHead(404); res.end('');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

test('a newer version is downloaded by the app itself: once, with its progress shown, checked, and nothing replaced', async () => {
  test.skip(!!process.env.ANTOGO_APP, 'the built app asks only the real published release');
  const file = Buffer.alloc(3_200_000, 7);
  const seen: string[] = [];
  const srv = await releaseStandIn(file, seen);
  const r = await launch({ update: `http://127.0.0.1:${(srv.address() as { port: number }).port}/latest` });
  await setUpNew(r.page);
  // The published web version says a newer build exists.
  await r.page.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: '2999-01-01T00:00:00.000Z' }) }));
  await go(r.page, '#/settings');
  await r.page.getByRole('button', { name: 'Check for updates' }).click();
  const start = r.page.getByRole('button', { name: 'A newer version is ready: download' });
  await expect(start).toBeVisible();
  // A file of an earlier version is already in Downloads: it is not to be touched.
  writeFileSync(join(r.downloads, 'Antogo.dmg'), 'an earlier version');
  // Pressed, the button gives way at once to how far the download has got. Pressed three times in a hurry, it is still one download.
  await start.click();
  await r.page.evaluate(() => { const a = (window as unknown as { antogoApp: { updateStart(): Promise<boolean> } }).antogoApp; void a.updateStart(); void a.updateStart(); });
  await expect(r.page.getByText('Downloading the newer Antogo…').first()).toBeVisible();
  await expect(start).toHaveCount(0);
  await expect(r.page.getByRole('progressbar', { name: 'Download' }).first()).toBeVisible();
  await expect(r.page.getByText(/\d+ of 3 MB/).first()).toBeVisible();
  // Cancelled part-way: nothing is left behind, and the offer is back.
  await r.page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(start).toBeVisible();
  expect(readdirSync(r.downloads).sort()).toEqual(['Antogo.dmg']);
  expect(seen.filter((u) => u.startsWith('/Antogo.dmg')).length).toBe(1);
  // Started again, it runs to the end; the file is whole, named after its release, and the earlier file is as it was.
  await start.click();
  await expect(r.page.getByText('The newer Antogo is downloaded.').first()).toBeVisible({ timeout: 20_000 });
  await expect(r.page.getByText(/Downloads folder as Antogo 999\.dmg/).first()).toBeVisible();
  await expect(r.page.getByRole('button', { name: 'Quit and open the installer' }).first()).toBeVisible();
  expect(readdirSync(r.downloads).sort()).toEqual(['Antogo 999.dmg', 'Antogo.dmg']);
  expect(readFileSync(join(r.downloads, 'Antogo 999.dmg')).equals(file)).toBe(true);
  expect(readFileSync(join(r.downloads, 'Antogo.dmg'), 'utf8')).toBe('an earlier version');
  expect(seen.filter((u) => u.startsWith('/Antogo.dmg')).length).toBe(2);
  expect(r.problems).toEqual([]);
  await r.app.close();

  // A fresh start of the app, with that file still in Downloads: asked again, nothing is fetched again.
  const again = await launch({ update: `http://127.0.0.1:${(srv.address() as { port: number }).port}/latest` });
  writeFileSync(join(again.downloads, 'Antogo 999.dmg'), file);
  await again.page.evaluate(() => (window as unknown as { antogoApp: { updateStart(): Promise<boolean> } }).antogoApp.updateStart());
  await expect.poll(() => again.page.evaluate(() => (window as unknown as { antogoApp: { updateState(): Promise<{ state: string; already?: boolean }> } }).antogoApp.updateState())).toMatchObject({ state: 'done', already: true });
  expect(seen.filter((u) => u.startsWith('/Antogo.dmg')).length).toBe(2);
  await again.app.close();
  srv.close();

  // A file that is not the one published is refused, and not kept.
  const seen2: string[] = [];
  const bad = await releaseStandIn(file, seen2, true);
  const b = await launch({ update: `http://127.0.0.1:${(bad.address() as { port: number }).port}/latest` });
  await b.page.evaluate(() => (window as unknown as { antogoApp: { updateStart(): Promise<boolean> } }).antogoApp.updateStart());
  await expect.poll(() => b.page.evaluate(() => (window as unknown as { antogoApp: { updateState(): Promise<{ state: string; why?: string }> } }).antogoApp.updateState()), { timeout: 20_000 }).toMatchObject({ state: 'failed', why: 'the file that arrived was not the one published' });
  expect(readdirSync(b.downloads)).toEqual([]);
  await b.app.close();
  bad.close();
});
