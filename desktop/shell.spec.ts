import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { standIn, watchProblems } from '../journeys/standin';
import { go } from '../journeys/rider';
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
    if (url.startsWith('/activitylist-service')) return json(url.includes('start=0') ? [{ activityId: 9, activityName: 'Long ride', startTimeLocal: '2026-11-21 08:00:00', activityType: { typeKey: 'cycling' } }, { activityId: 8, activityName: 'Walk', startTimeLocal: '2019-03-02 08:00:00' }] : []);
    if (url.startsWith('/download-service')) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.from(fit)); return; }
    if (url.startsWith('/hrv-service')) return json({ hrvSummaries: [{ calendarDate: '2026-11-20' }] });
    return json([]);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

interface Running { app: ElectronApplication; page: Page; problems: string[]; outside: string[]; data: string; downloads: string }
async function launch(opts: { data?: string; garmin?: string; kind?: 'new' | 'power' } = {}): Promise<Running> {
  const data = opts.data ?? scratch('data');
  const downloads = scratch('downloads');
  const env = { ...process.env, ANTOGO_DATA: data, ANTOGO_DOWNLOADS: downloads, ANTOGO_TEST_STORE: '1', ...(opts.garmin ? { ANTOGO_GARMIN_BASE: opts.garmin } : {}) } as Record<string, string>;
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
  await page.getByRole('button', { name: 'No account yet, enter numbers by hand' }).click();
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
  b.page.on('dialog', (d) => void d.accept());
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
  again.page.on('dialog', (d) => void d.accept());
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

test('Settings, Help and the ride player say plainly what the Mac app is, and that Bluetooth is its next step', async () => {
  const r = await launch();
  await setUpNew(r.page);
  await go(r.page, '#/play/free');
  await expect(r.page.getByRole('heading', { name: 'Riding with a trainer is coming to the Mac app' })).toBeVisible();
  await go(r.page, '#/settings');
  await expect(r.page.locator('main')).toContainText('This is Antogo for the Mac');
  await go(r.page, '#/help?s=settings');
  await expect(r.page.locator('main')).toContainText('Open Anyway');
  expect(r.problems).toEqual([]);
  await r.app.close();
});
