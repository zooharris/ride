import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { go, looksRight, makePlan, open, setUp, type Session } from './rider';
import type { Ledger } from './standin';

/**
 * First run with nothing required (25 Nov 2026). A rider installs, opens and begins; connecting Intervals.icu,
 * restoring from a backup file they pick, and keeping this device in step with their others are each a choice,
 * explained before it is made.
 */

const NOTE = 'App backup (do not edit)';
const note = (l: Ledger) => l.events.find((e) => e.name === NOTE);

/** Another of the rider's devices: a fresh browser, optionally on the same Intervals.icu account. */
async function otherDevice(browser: Browser, info: TestInfo): Promise<Page> {
  const fresh = await browser.newContext({ serviceWorkers: 'block', baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? undefined });
  const page = await fresh.newPage();
  page.on('dialog', (d) => void d.accept());
  return page;
}

/** The rider's first device: set up with Intervals.icu, a plan made, and its saved copy written to the account. */
async function firstDevice(page: Page): Promise<Session> {
  const s = await setUp(page, 'power');
  await makePlan(page);
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => !!note(s.ledger)).toBe(true);
  return s;
}

/** Connect Intervals.icu from the first screen, as far as whatever comes next. */
async function connectAtFirstRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Connect Intervals.icu' }).click();
  await page.getByLabel('Athlete ID').fill('i900002');
  await page.getByLabel('API key').fill('made-up-key');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
}

/** The rest of setup for a rider who has just connected, through to Today. */
async function finishSetup(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Your numbers' })).toBeVisible();
  await page.getByRole('button', { name: 'A power meter or smart trainer' }).click();
  for (const box of await page.locator('.ob-number').all()) {
    const input = box.locator('input');
    if (await input.count() && !(await input.inputValue())) await box.getByRole('button', { name: "I don't know" }).click();
  }
  await page.getByRole('button', { name: /^Use \d/ }).click();
  await page.getByRole('button', { name: 'Start and pull my rides' }).click();
  await expect(page).toHaveURL(/#\/today/);
}

/** A step that ends by reloading the app (a restore, joining the other devices): wait for the page to come back. */
const reloads = async (page: Page, step: () => Promise<unknown>) => { await Promise.all([page.waitForEvent('load'), step()]); await expect(page).toHaveURL(/#\/today/); await expect(page.locator('main')).toBeVisible(); };
const hasPlan = async (page: Page) => { await go(page, '#/plan'); await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible(); };
const hasNoPlan = async (page: Page) => { await go(page, '#/plan'); await expect(page.getByText(/^As of today, /)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Your plans' })).toHaveCount(0); };
const standing = async (page: Page) => { await go(page, '#/settings'); return page.getByRole('button', { name: /^Across your devices, and backup/ }); };

test('the first screen asks for nothing: setup is one press away, and what can be connected is offered as optional', async ({ page }, info) => {
  const s = await open(page, 'new');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.locator('main')).toContainText('There is no account to make and nothing you have to connect.');
  await expect(page.getByRole('button', { name: 'Set up Antogo' })).toBeEnabled();
  for (const offer of ['Restore from a backup file', 'Use Intervals.icu? Connect it', 'Have a Garmin personal key?']) await expect(page.locator('main')).toContainText(offer);
  // Nothing was asked of Intervals.icu, or of anyone, to get this far.
  expect(s.ledger.requests).toEqual([]);
  await looksRight(s, info, 'Welcome');
  // Looking at the Intervals.icu form commits to nothing: Back returns, and setup goes on without it.
  await page.getByRole('button', { name: 'Connect Intervals.icu' }).click();
  await looksRight(s, info, 'Connect Intervals.icu, optional');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Set up Antogo' }).click();
  await expect(page.getByRole('heading', { name: 'Your numbers' })).toBeVisible();
  await looksRight(s, info, 'Your numbers, nothing connected');
});

test('a rider with nothing connected: a plan, Settings that say what is true for them, and no request to Intervals.icu', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  // Getting started lists the rider's own steps; connecting is not one of them.
  await expect(page.getByText(/Getting started · 0 of 2/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Connect Intervals.icu');
  await makePlan(page);
  const fold = await standing(page);
  await expect(fold).toContainText('Backup and restore');
  await fold.click();
  await expect(page.locator('main')).toContainText('Without Intervals.icu, move your data between devices with the backup file below.');
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await expect(page.locator('main')).toContainText('your data stays on your devices');
  await expect(page.locator('main')).not.toContainText('in your own Intervals.icu account');
  await looksRight(s, info, 'Settings, nothing connected');
  expect(s.ledger.requests.filter((r) => /intervals\.icu/.test(r))).toEqual([]);
});

test('restore at first run from a backup file the rider picks: told what it holds, then the app opens with it', async ({ page, browser }, info) => {
  const s = await setUp(page, 'new');
  await makePlan(page);
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up everything' }).click()]);
  const file = (await backup.path())!;
  const fresh = await browser.newContext({ serviceWorkers: 'block', baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? undefined });
  const p2 = await fresh.newPage();
  const asked: string[] = [];
  p2.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  const s2 = await open(p2, 'new');
  await reloads(p2, () => p2.getByLabel('Choose a backup file').setInputFiles(file));
  expect(asked[0]).toMatch(/^Restore from this backup made /);
  expect(asked[0]).toContain('It holds ');
  await hasPlan(p2);
  await looksRight(s2, info, 'Restored at first run from a chosen file');
  // A file that is not a backup is refused in words, and setup is still there.
  const p3 = await (await browser.newContext({ serviceWorkers: 'block', baseURL: info.project.use.baseURL })).newPage();
  await open(p3, 'new');
  await p3.getByLabel('Choose a backup file').setInputFiles({ name: 'holiday.json', mimeType: 'application/json', buffer: Buffer.from('{"photos":[]}') });
  await expect(p3.locator('.msg.err')).toBeVisible();
  await expect(p3.getByRole('button', { name: 'Set up Antogo' })).toBeEnabled();
  expect(s.problems).toEqual([]);
});

test('connecting at first run with no saved copy: straight on to the numbers', async ({ page }, info) => {
  const s = await open(page, 'power');
  await connectAtFirstRun(page);
  await expect(page.getByRole('heading', { name: 'Your numbers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your other devices' })).toHaveCount(0);
  await looksRight(s, info, 'Connected, no saved copy');
});

test('a saved copy found at first run: said what and where it is; "in step" takes it and stays in step', async ({ page, browser }, info) => {
  const a = await firstDevice(page);
  const p2 = await otherDevice(browser, info);
  const b = await open(p2, 'power', a.ledger);
  await connectAtFirstRun(p2);
  await expect(p2.getByRole('heading', { name: 'Your other devices' })).toBeVisible();
  const main = p2.locator('main');
  await expect(main).toContainText('Antogo found its saved copy in your Intervals.icu account.');
  await expect(main).toContainText('a private note in your own Intervals.icu calendar (dated 31 Dec 2099)');
  await expect(main).toContainText("What it doesn't hold: your rides and recordings.");
  await expect(main).toContainText('Last saved:');
  for (const choice of ['Keep this device in step with my others', 'Keep this device separate']) await expect(p2.getByRole('button', { name: choice })).toBeVisible();
  await expect(p2.getByLabel('Restore from a file I choose instead')).toBeAttached();
  await looksRight(b, info, 'Your other devices: the choice');
  await reloads(p2, () => p2.getByRole('button', { name: 'Keep this device in step with my others' }).click());
  await hasPlan(p2);
  await expect(await standing(p2)).toContainText('In step');
  await looksRight(b, info, 'In step after first run');
});

test('"keep this device separate": set up afresh, the saved copy untouched; turned on later, the two are combined', async ({ page, browser }, info) => {
  const a = await firstDevice(page);
  const p2 = await otherDevice(browser, info);
  // What this device itself sends to the calendar in Intervals.icu (the first device, still open, goes on writing its own).
  const wrote: string[] = [];
  p2.on('request', (r) => { if (r.method() !== 'GET' && /\/events/.test(r.url()) && (r.postData() ?? '').includes(NOTE)) wrote.push(`${r.method()} ${r.url()}`); });
  const b = await open(p2, 'power', a.ledger);
  await connectAtFirstRun(p2);
  await p2.getByRole('button', { name: 'Keep this device separate' }).click();
  await finishSetup(p2);
  await hasNoPlan(p2);
  const fold = await standing(p2);
  await expect(fold).toContainText('Separate: this device keeps its own data');
  await fold.click();
  await expect(p2.locator('main')).toContainText('keeps its own data and does not read or write the saved copy');
  await expect(p2.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await looksRight(b, info, 'Settings, kept separate');
  // Used on its own for a while: the saved copy is as the first device left it.
  await p2.waitForTimeout(5000);
  expect(wrote).toEqual([]);
  // Turned on: the rider is told what happens, the plan from the other device arrives, and the note is written by this one too.
  const asked: string[] = [];
  p2.on('dialog', (d) => asked.push(d.message()));
  await p2.getByRole('button', { name: 'Keep in step with my other devices' }).click();
  await expect(p2.locator('main')).toContainText('In step with your other devices through Intervals.icu.');
  expect(asked[0]).toContain('are combined now with the saved copy');
  await hasPlan(p2);
  await expect.poll(() => wrote.length).toBeGreaterThan(0);
  expect(b.problems).toEqual([]);
});

test('"restore from a file I choose instead", when a saved copy was found', async ({ page, browser }, info) => {
  const a = await firstDevice(page);
  const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up everything' }).click()]);
  const p2 = await otherDevice(browser, info);
  const b = await open(p2, 'power', a.ledger);
  await connectAtFirstRun(p2);
  const file = (await backup.path())!;
  await reloads(p2, () => p2.getByLabel('Restore from a file I choose instead').setInputFiles(file));
  await hasPlan(p2);
  expect(b.problems).toEqual([]);
});

test('a device used on its own, then connected in Settings: nothing is combined until the rider chooses', async ({ page, browser }, info) => {
  const a = await firstDevice(page);
  const p2 = await otherDevice(browser, info);
  const wrote: string[] = [];
  p2.on('request', (r) => { if (r.method() !== 'GET' && /\/events/.test(r.url()) && (r.postData() ?? '').includes(NOTE)) wrote.push(`${r.method()} ${r.url()}`); });
  const b = await open(p2, 'power', a.ledger);
  // Set up with nothing connected.
  await p2.getByRole('button', { name: 'Set up Antogo' }).click();
  await p2.getByLabel('Name').fill('Nova Example');
  for (let i = 0; i < 4; i++) await p2.getByRole('button', { name: "I don't know" }).first().click();
  await p2.getByRole('button', { name: '5 h', exact: true }).click();
  await p2.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(p2).toHaveURL(/#\/today/);
  // Later, Intervals.icu is connected in Settings.
  await go(p2, '#/settings');
  await p2.getByRole('button', { name: /^Intervals\.icu/ }).click();
  await p2.getByPlaceholder('i123456').fill('i900002');
  await p2.locator('.field:has(input[placeholder="i123456"]) + .field input').fill('made-up-key');
  await p2.getByRole('button', { name: 'Connect', exact: true }).click();
  const fold = p2.getByRole('button', { name: /^Across your devices, and backup/ });
  await expect(fold).toContainText('A saved copy was found: your choice is needed');
  expect(wrote).toEqual([]);
  await hasNoPlan(p2);
  // Today says so too, and leads to the choice.
  await go(p2, '#/today');
  await expect(p2.getByText('Antogo found its saved copy from another device')).toBeVisible();
  await looksRight(b, info, 'Today, a saved copy waiting for a choice');
  await p2.getByRole('link', { name: 'Choose in Settings' }).click();
  await p2.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await looksRight(b, info, 'Settings, the choice');
  await p2.getByRole('button', { name: 'Keep this device in step with my others' }).click();
  await expect(p2.locator('main')).toContainText('In step with your other devices through Intervals.icu.');
  await hasPlan(p2);
  await go(p2, '#/today');
  await expect(p2.getByText('Antogo found its saved copy from another device')).toHaveCount(0);
});
