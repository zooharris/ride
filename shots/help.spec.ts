import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { join } from 'node:path';
import { go, makePlan, open, setUp } from '../journeys/rider';

/**
 * Makes Help's pictures: one made-up rider's app, as the Mac app and as the iPhone and iPad app, each screen saved
 * for Help to show on that kind of device. Devices in the pictures are simulated or made up; nothing is anyone's own.
 */
const OUT = join(process.cwd(), 'public', 'help');

/** The page is told it is inside the installed app of this kind, so every picture carries that version's own words. */
async function asApp(context: BrowserContext, kind: string): Promise<void> {
  await context.addInitScript((k) => {
    const w = window as unknown as { antogoApp: unknown; __found?: (list: unknown[]) => void };
    w.antogoApp = {
      kind: k,
      garminFetch: async () => ({ status: 0, type: '', body: new Uint8Array() }),
      keyCan: async () => true, keyRead: async () => null, keySave: async () => ({}), keyForget: async () => true,
      onBluetooth: (fn: (list: unknown[]) => void) => { w.__found = fn; },
      chooseBluetooth: async () => true,
      keepAwake: async () => undefined,
    };
    // The apps have Bluetooth of their own; the machine making the pictures has none, and the player must not say so in them.
    if (!('bluetooth' in navigator)) Object.defineProperty(navigator, 'bluetooth', { value: {}, configurable: true });
  }, kind);
}

test('the pictures in Help', async ({ page, context, browser }, info) => {
  const version = info.project.name;
  const { app, width } = info.project.metadata as { app: string; width: number };
  await asApp(context, app);
  const shot = async (p: Page, name: string) => {
    await p.waitForLoadState('networkidle').catch(() => undefined);
    await p.waitForTimeout(700);
    const png = await p.screenshot({ animations: 'disabled' });
    await sharp(png).resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toFile(join(OUT, `${name}-${version}.webp`));
  };
  const fresh = async () => {
    const c = await browser.newContext({ ...info.project.use, serviceWorkers: 'block' });
    await asApp(c, app);
    const p = await c.newPage();
    p.on('dialog', (d) => void d.accept());
    return p;
  };

  // The first screen, before anything is set up.
  const first = await fresh();
  await open(first, 'new');
  await expect(first.getByRole('button', { name: 'Set up Antogo' })).toBeVisible();
  await shot(first, 'welcome');
  await first.context().close();

  // A rider with a year of history and a plan.
  const s = await setUp(page, 'power');
  await makePlan(page);
  await go(page, '#/today');
  await page.getByRole('button', { name: 'Dismiss' }).first().click().catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'today');
  await go(page, '#/calendar');
  await shot(page, 'calendar');

  await go(page, '#/library');
  await page.locator('a[href^="#/workout/"]').first().click();
  await expect(page).toHaveURL(/#\/workout\//);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'workout');

  await go(page, '#/rides');
  await page.locator('a[href^="#/rides/"]').first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'activity');

  await go(page, '#/progress');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'progress');

  // Settings: how this device stands with the rider's others, and backup.
  await go(page, '#/settings');
  const fold = page.getByRole('button', { name: /^Across your devices, and backup/ });
  await fold.click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('main')).toContainText('Last merged');
  await page.locator('.toast button, [role=status] button').first().click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  await fold.evaluate((el) => { const y = el.getBoundingClientRect().top + window.scrollY - 90; window.scrollTo(0, Math.max(0, y)); });
  await shot(page, 'settings-devices');

  // Another of the rider's devices, finding the saved copy at first run.
  const other = await fresh();
  await open(other, 'power', s.ledger);
  await other.getByRole('button', { name: 'Connect Intervals.icu' }).click();
  await other.getByLabel('Athlete ID').fill('i900002');
  await other.getByLabel('API key').fill('made-up-key');
  await other.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(other.getByRole('heading', { name: 'Your other devices' })).toBeVisible();
  await other.getByRole('heading', { name: 'Your other devices' }).evaluate((el) => { window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 24)); });
  await shot(other, 'other-devices');
  await other.context().close();

  // The ride player, with simulated devices.
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^Ride player/ }).click();
  await page.getByText('Practice with a simulated trainer', { exact: true }).locator('..').getByRole('button', { name: 'On', exact: true }).click();
  await go(page, '#/play/free');
  for (const box of [/smart trainer/i, /heart rate/i]) {
    await page.locator('button.pl-dev', { hasText: box }).first().click();
    await page.getByRole('menuitem', { name: /Simulated/ }).click();
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'player-devices');

  // The app's own list of devices found nearby (made-up names).
  await page.evaluate(() => (window as unknown as { __found: (l: unknown[]) => void }).__found([{ id: 'a', name: 'Smart trainer 2A7F' }, { id: 'b', name: 'Smart trainer 91C0' }]));
  await expect(page.getByRole('dialog', { name: 'Choose a device' })).toBeVisible();
  await shot(page, 'choose-device');
  await page.getByRole('dialog', { name: 'Choose a device' }).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: /Start ride/ }).click();
  await page.waitForTimeout(14_000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'riding');
});
