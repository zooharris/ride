import { expect, test } from '@playwright/test';
import { go, looksRight, makePlan, setUp, simulatedTrainer } from './rider';

/**
 * Journey 2: Today's session in the ride player on the simulated trainer, ridden to the end, saved, and done.
 * The clock is run forward so an hour's ride takes seconds.
 */
test('ride the day\'s session on the simulated trainer, save it, see it done', async ({ page }, info) => {
  // The slowest journey: run on a phone at night and a laptop by day only.
  test.skip(!['phone-night', 'laptop-day'].includes(info.project.name), 'ridden on two sizes only');
  test.setTimeout(240_000);
  page.on('dialog', (d) => void d.accept());
  const s = await setUp(page, 'power');
  await makePlan(page);
  await simulatedTrainer(page);
  // The first ride on the calendar from today on, opened from the Calendar's list as a rider would.
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await page.locator('a[href*="#/workout/"]').filter({ hasNot: page.locator('.done') }).first().click();
  await looksRight(s, info, 'A planned ride');
  await page.getByRole('link', { name: 'Ride indoors on the trainer' }).first().click();
  await page.getByRole('button', { name: 'Choose your trainer' }).click();
  await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
  await looksRight(s, info, 'The player, ready');
  const rideName = (await page.locator('.pl-workout h1').innerText()).trim();
  const rideSeconds = await page.locator('.pl-figures .pl-fig').first().innerText().then((t) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0));
  // From here the page's clock is ours to run forward.
  await page.clock.install();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.clock.runFor(3 * 60_000);
  await looksRight(s, info, 'Riding');
  // Far enough to count as the session (five minutes and a fifth of the ride), then ended early, as a rider may.
  await page.clock.runFor(Math.max(6 * 60, rideSeconds / 5 + 60) * 1000);
  await page.getByRole('button', { name: 'End ride' }).first().click();
  await expect(page.getByRole('button', { name: 'Save ride' })).toBeVisible();
  await looksRight(s, info, 'The summary');
  await page.getByRole('button', { name: 'Save ride' }).click();
  await expect(page.locator('.rd-saved')).toBeVisible({ timeout: 20_000 });
  await looksRight(s, info, 'Saved');
  // The ride is on today, done.
  await page.clock.resume();
  await go(page, '#/calendar');
  await expect(page.locator('main')).toContainText(rideName);
  await go(page, '#/today');
  await expect(page.locator('main')).toContainText(/Done/);
  await looksRight(s, info, 'Today, done');
});
