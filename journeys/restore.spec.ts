import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { go, looksRight, makePlan, open, setUp, type Session } from './rider';
import type { Ledger } from './standin';

/**
 * Restoring a backup, and joining the rider's other devices, in every order (25 Nov 2026). An older backup restored on
 * a device that then joined the others once replaced their newer data. Now: a restore brings data in as it was then;
 * when devices are combined the newer version of each thing wins; a saved copy found after a restore is asked about
 * at once; and replacing newer data everywhere is its own named action that warns first.
 */

const NOTE = 'App backup (do not edit)';
const note = (l: Ledger) => l.events.find((e) => e.name === NOTE);
const fold = (page: Page) => page.getByRole('button', { name: /^Across your devices, and backup/ });
/** Settings, with the devices-and-backup section open (or shut, to read its one-line state). */
const section = async (page: Page, open = true) => { await go(page, '#/settings'); const f = fold(page); if (((await f.getAttribute('aria-expanded')) === 'true') !== open) await f.click(); return f; };
// A number that is the rider's own and no service sets: the hours a week they have.
const nameBox = (page: Page) => page.locator('.field:has(> label:text-is("Hours per week")) input');
const reloads = async (page: Page, step: () => Promise<unknown>) => { await Promise.all([page.waitForEvent('load'), step()]); await expect(page.locator('main')).toBeVisible(); };
const hasPlan = async (page: Page) => { await go(page, '#/plan'); await expect(page.getByRole('heading', { name: 'Your plans' })).toBeVisible(); };
const hasNoPlan = async (page: Page) => { await go(page, '#/plan'); await expect(page.getByText(/^As of today, /)).toBeVisible(); await expect(page.getByRole('heading', { name: 'Your plans' })).toHaveCount(0); };
const question = (page: Page) => page.getByRole('dialog', { name: 'Your other devices' });

async function backupFile(page: Page): Promise<string> {
  await section(page);
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up everything' }).click()]);
  return (await d.path())!;
}
async function syncNow(page: Page, s: Session): Promise<void> {
  await section(page);
  const button = page.getByRole('button', { name: 'Sync now' });
  // One whole round: the note is read, and written when this device has something newer.
  await Promise.all([page.waitForResponse((r) => /\/events/.test(r.url()) && r.request().method() === 'GET'), button.click()]);
  await expect(button).toBeEnabled();
  await expect(page.locator('main')).toContainText('Last merged');
  await expect.poll(() => !!note(s.ledger)).toBe(true);
}
async function rename(page: Page, to: string): Promise<void> {
  await go(page, '#/settings');
  await nameBox(page).fill(to);
  await nameBox(page).blur();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
}
const nameIs = async (page: Page, name: string) => { await go(page, '#/settings'); await expect(nameBox(page)).toHaveValue(name); };

/**
 * The rider's first device, in step: a backup file is made ("the old file"), and afterwards the rider's hours a week are changed and
 * a plan is made. The saved copy in the account carries both later changes; the old file has neither.
 */
async function firstDeviceWithAnOldFile(page: Page): Promise<{ s: Session; oldFile: string; oldName: string }> {
  const s = await setUp(page, 'power');
  await syncNow(page, s);
  const oldName = await nameBox(page).inputValue();
  const oldFile = await backupFile(page);
  await rename(page, '9');
  await makePlan(page);
  await syncNow(page, s);
  return { s, oldFile, oldName };
}

async function newDevice(browser: Browser, info: TestInfo, shared?: Ledger): Promise<{ page: Page; s: Session; asked: string[]; wrote: string[] }> {
  const fresh = await browser.newContext({ serviceWorkers: 'block', baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? undefined });
  const page = await fresh.newPage();
  const asked: string[] = [];
  page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  const wrote: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET' && /\/events/.test(r.url()) && (r.postData() ?? '').includes(NOTE)) wrote.push(`${r.method()} ${r.url()}`); });
  const s = await open(page, 'power', shared);
  return { page, s, asked, wrote };
}

test('an old file restored on a new device, then joined to the others: asked at once, and the newer data wins', async ({ page, browser }, info) => {
  const a = await firstDeviceWithAnOldFile(page);
  const b = await newDevice(browser, info, a.s.ledger);
  await reloads(b.page, () => b.page.getByLabel('Choose a backup file').setInputFiles(a.oldFile));
  // The question before the restore leads with the backup's date and age, and says what happens with other devices.
  expect(b.asked[0]).toMatch(/^This backup was made on .+ \(today\)\./);
  expect(b.asked[0]).toContain('Your other devices are not changed');
  // The saved copy from the other device is asked about at once; nothing has been combined or written.
  await expect(question(b.page)).toBeVisible();
  await expect(question(b.page)).toContainText('the newer version is kept');
  expect(b.wrote).toEqual([]);
  await looksRight(b.s, info, 'Asked at once after a restore');
  await question(b.page).getByRole('button', { name: 'Keep this device in step with my others' }).click();
  await expect(question(b.page)).toHaveCount(0);
  // The newer name and the plan made since arrive; the old file's name does not go back to the other device.
  await nameIs(b.page, '9');
  await hasPlan(b.page);
  await syncNow(page, a.s);
  await page.reload();
  await nameIs(page, '9');
  await hasPlan(page);
  expect(a.s.problems).toEqual([]);
  expect(b.s.problems).toEqual([]);
});

test('an old file on a new device, "decide later", then kept separate: the saved copy is never touched', async ({ page, browser }, info) => {
  const a = await firstDeviceWithAnOldFile(page);
  const b = await newDevice(browser, info, a.s.ledger);
  await reloads(b.page, () => b.page.getByLabel('Choose a backup file').setInputFiles(a.oldFile));
  await question(b.page).getByRole('button', { name: 'Decide later' }).click();
  await expect(question(b.page)).toHaveCount(0);
  // Today still says a choice is waiting, and Settings holds it.
  await go(b.page, '#/today');
  await expect(b.page.locator('main')).toContainText('found its saved copy from another device');
  await expect(await section(b.page, false)).toContainText('A saved copy was found: your choice is needed');
  await section(b.page);
  await b.page.getByRole('button', { name: 'Keep this device separate' }).click();
  await expect(await section(b.page, false)).toContainText('Separate: this device keeps its own data');
  await nameIs(b.page, a.oldName);
  await hasNoPlan(b.page);
  await b.page.waitForTimeout(5000);
  expect(b.wrote).toEqual([]);
  expect(b.s.problems).toEqual([]);
});

test('in step, an old file restored the ordinary way: nothing newer is replaced', async ({ page }, info) => {
  const a = await firstDeviceWithAnOldFile(page);
  const asked: string[] = [];
  page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await section(page);
  await expect(page.locator('main')).toContainText('never replaces anything newer');
  await looksRight(a.s, info, 'Settings, restore on a device in step');
  await reloads(page, () => page.getByLabel('Restore from a backup', { exact: true }).setInputFiles(a.oldFile));
  expect(asked[0]).toMatch(/^This backup was made on .+ \(today\)\./);
  expect(asked[0]).toContain('nothing newer is replaced');
  await nameIs(page, '9');
  await hasPlan(page);
  expect(a.s.problems).toEqual([]);
});

test('in step, "put everything back as it was": warned first, then the backup wins', async ({ page, browser }, info) => {
  const a = await firstDeviceWithAnOldFile(page);
  // A second device, in step, to see that the backup's version reaches it too.
  const b = await newDevice(browser, info, a.s.ledger);
  await b.page.getByRole('button', { name: 'Connect Intervals.icu' }).click();
  await b.page.getByLabel('Athlete ID').fill('i900002');
  await b.page.getByLabel('API key').fill('made-up-key');
  await b.page.getByRole('button', { name: 'Connect', exact: true }).click();
  await reloads(b.page, () => b.page.getByRole('button', { name: 'Keep this device in step with my others' }).click());
  await nameIs(b.page, '9');

  const asked: string[] = [];
  page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await section(page);
  await reloads(page, () => page.getByLabel('Put everything back as it was').setInputFiles(a.oldFile));
  expect(asked[0]).toMatch(/^This backup was made on .+ \(today\)\./);
  expect(asked[0]).toContain('on every device kept in step');
  expect(asked[0]).toContain('cannot be undone');
  await nameIs(page, a.oldName);
  // What was added since (the plan) stays, as the warning said.
  await hasPlan(page);
  await syncNow(page, a.s);
  await syncNow(b.page, b.s);
  await b.page.reload();
  await nameIs(b.page, a.oldName);
  expect(a.s.problems).toEqual([]);
  expect(b.s.problems).toEqual([]);
});

test('a file newer than the saved copy: its newer data reaches the others', async ({ page, browser }, info) => {
  const a = await setUp(page, 'power');
  await syncNow(page, a);
  // Kept separate from here, so what follows never reaches the saved copy; then changed, and backed up to a file.
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Keep this device separate' }).click();
  await expect(await section(page, false)).toContainText('Separate: this device keeps its own data');
  await rename(page, '11');
  const newerFile = await backupFile(page);

  const b = await newDevice(browser, info, a.ledger);
  await reloads(b.page, () => b.page.getByLabel('Choose a backup file').setInputFiles(newerFile));
  await question(b.page).getByRole('button', { name: 'Keep this device in step with my others' }).click();
  await expect(question(b.page)).toHaveCount(0);
  await nameIs(b.page, '11');
  // This device's newer data is written to the saved copy for the others.
  await expect.poll(() => b.wrote.length).toBeGreaterThan(0);
  expect(b.s.problems).toEqual([]);
});

test('two new devices restored from different files, then joined: the newer of each thing on both', async ({ page, browser }, info) => {
  const a = await firstDeviceWithAnOldFile(page);
  const newerFile = await backupFile(page);
  // A different account's saved copy starts empty: the first device to arrive writes it.
  const q = await newDevice(browser, info);
  await reloads(q.page, () => q.page.getByLabel('Choose a backup file').setInputFiles(a.oldFile));
  await expect.poll(() => !!note(q.s.ledger)).toBe(true);
  await expect(question(q.page)).toHaveCount(0);
  await nameIs(q.page, a.oldName);

  const r = await newDevice(browser, info, q.s.ledger);
  await reloads(r.page, () => r.page.getByLabel('Choose a backup file').setInputFiles(newerFile));
  await question(r.page).getByRole('button', { name: 'Keep this device in step with my others' }).click();
  await expect(question(r.page)).toHaveCount(0);
  await nameIs(r.page, '9');
  await hasPlan(r.page);
  await expect.poll(() => r.wrote.length).toBeGreaterThan(0);
  // The first of the two hears of the newer name and the plan at its next sync.
  await syncNow(q.page, q.s);
  await q.page.reload();
  await nameIs(q.page, '9');
  await hasPlan(q.page);
  expect(q.s.problems).toEqual([]);
  expect(r.s.problems).toEqual([]);
});
