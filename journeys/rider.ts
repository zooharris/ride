import { expect, type Page, type TestInfo } from '@playwright/test';
import { standIn, watchProblems, type Ledger, type RiderKind } from './standin';

/**
 * The three made-up riders, set up through the first-run setup as a rider would (13 Nov 2026):
 *  - new: no account, no history, no sensors, "I don't know" to every number;
 *  - hr: trains by heart rate, three months of history, a Wahoo connected in Intervals.icu;
 *  - power: a power meter, a year of history, a Garmin and a Wahoo (and a Coros with uploads off).
 */

export interface Session { page: Page; ledger: Ledger; problems: string[] }

export async function open(page: Page, kind: RiderKind): Promise<Session> {
  const problems = watchProblems(page);
  const ledger = await standIn(page, kind);
  await page.goto('./');
  return { page, ledger, problems };
}

/** First-run setup, through to Today. */
export async function setUp(page: Page, kind: RiderKind): Promise<Session> {
  const s = await open(page, kind);
  if (kind === 'new') {
    await page.getByRole('button', { name: 'No account yet, enter numbers by hand' }).click();
    await page.getByLabel('Name').fill('Nova Example');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: "I don't know" }).first().click();
    await page.getByRole('button', { name: '5 h', exact: true }).click();
    await expect(page.getByText('Targets start on heart rate.')).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
  } else {
    await page.getByLabel('Athlete ID').fill(kind === 'hr' ? 'i900001' : 'i900002');
    await page.getByLabel('API key').fill('made-up-key');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your numbers' })).toBeVisible();
    await page.getByRole('button', { name: kind === 'hr' ? 'A heart-rate strap or a watch that reads heart rate' : 'A power meter or smart trainer' }).click();
    // What Intervals.icu doesn't hold, the rider doesn't know.
    for (const box of await page.locator('.ob-number').all()) {
      const input = box.locator('input');
      if (await input.count() && !(await input.inputValue())) await box.getByRole('button', { name: "I don't know" }).click();
    }
    await page.getByRole('button', { name: /^Use \d/ }).click();
    await expect(page.getByText(kind === 'hr' ? 'Targets start on heart rate.' : 'Targets start on power.')).toBeVisible();
    await page.getByRole('button', { name: 'Start and pull my rides' }).click();
  }
  await expect(page).toHaveURL(/#\/today/);
  await expect(page.locator('main')).toBeVisible();
  return s;
}

/** Plan my training with the form's defaults, and put it on the calendar. */
export async function makePlan(page: Page, opts: { strength?: boolean } = {}): Promise<void> {
  await go(page, '#/plan');
  if (opts.strength) {
    // Let the plan schedule strength, so a strength session is on the calendar.
    const chip = page.locator('button.chip[aria-pressed]', { hasText: /^Strength$/ }).first();
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await page.getByRole('button', { name: 'Build the plan' }).click();
  await page.getByRole('button', { name: 'Put it on the calendar' }).click();
  // Placing ends on the Calendar.
  await expect(page).toHaveURL(/#\/calendar/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
}

/** What every step of every journey checks: a page with something on it, no errors, nothing wider than the screen. */
export async function looksRight(s: Session, info: TestInfo, where: string): Promise<void> {
  const { page } = s;
  await page.waitForLoadState('networkidle').catch(() => {});
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length, `${where}: the page is blank`).toBeGreaterThan(40);
  // A page that settles within two seconds is fine; one that stays wider than the screen is not.
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await expect.poll(sideways, { message: `${where}: the page scrolls sideways`, timeout: 2_000 }).toBeLessThanOrEqual(1);
  expect(s.problems, `${where}: errors on the page`).toEqual([]);
  const shot = await page.screenshot({ fullPage: !!process.env.SHOTS });
  await info.attach(where, { body: shot, contentType: 'image/png' });
  // SHOTS=<folder> keeps every step's picture, for looking at by eye.
  if (process.env.SHOTS) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(process.env.SHOTS, { recursive: true });
    writeFileSync(`${process.env.SHOTS}/${info.project.name}--${info.title.slice(0, 40).replace(/\W+/g, '-')}--${where.replace(/\W+/g, '-')}.png`, shot);
  }
}

/** Go to a screen the way the app's own links do. */
export async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page).toHaveURL(new RegExp(`${hash.replace(/[/?]/g, (c) => `\\${c}`)}`));
  await page.waitForTimeout(250);
  // A screen that sends the rider elsewhere when it finishes (Save, Put it on the calendar) can land just after: go again.
  if (!page.url().includes(hash)) await page.evaluate((h) => { location.hash = h; }, hash);
}

/** Settings, Ride player: practise with a simulated trainer. */
export async function simulatedTrainer(page: Page): Promise<void> {
  await go(page, '#/settings');
  await page.getByRole('button', { name: 'Ride player' }).click();
  const field = page.locator('.field', { hasText: 'Practice with a simulated trainer' });
  await field.getByRole('button', { name: 'On', exact: true }).click();
  await expect(field.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
}
