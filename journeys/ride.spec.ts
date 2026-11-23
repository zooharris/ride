import { expect, test, type Page } from '@playwright/test';
import { go, looksRight, makePlan, setUp, simulatedTrainer } from './rider';

/**
 * Journey 2: Today's session in the ride player on the simulated trainer, ridden to the end, saved, and done.
 * The clock is run forward so an hour's ride takes seconds.
 */
/**
 * Open the first session on the calendar that is a ride for the trainer. Which session comes first depends on the day
 * of the week the journey runs (on a Monday the plan opens with a mobility session), so the first link is not assumed
 * to be a ride (23 Nov 2026).
 */
async function openFirstRide(page: Page, notDone: boolean): Promise<void> {
  const links = page.locator('a[href*="#/workout/"]');
  await expect(links.first()).toBeVisible();
  const all = notDone ? links.filter({ hasNot: page.locator('.done') }) : links;
  const hrefs = [...new Set(await all.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')))].filter(Boolean);
  for (const h of hrefs.slice(0, 12)) {
    await go(page, h);
    const ride = page.getByRole('link', { name: 'Ride indoors on the trainer' }).first();
    if (await ride.isVisible().catch(() => false)) return;
  }
  throw new Error('No ride for the trainer among the first sessions on the calendar.');
}

test('ride the day\'s session on the simulated trainer, save it, see it done', async ({ page }, info) => {
  // The slowest journey: run on a phone at night, a tablet and a laptop by day only.
  test.skip(!['phone-night', 'tablet-day', 'laptop-day'].includes(info.project.name), 'ridden on three sizes only');
  test.setTimeout(240_000);
  page.on('dialog', (d) => void d.accept());
  // The page's clock starts at midday, so the ride run forward below never crosses midnight whenever the journey runs (23 Nov 2026).
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  await page.clock.install({ time: noon });
  const s = await setUp(page, 'power');
  await makePlan(page);
  await simulatedTrainer(page);
  // The first ride on the calendar from today on, opened from the Calendar's list as a rider would.
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await openFirstRide(page, true);
  await looksRight(s, info, 'A planned ride');
  await page.getByRole('link', { name: 'Ride indoors on the trainer' }).first().click();
  await page.getByRole('button', { name: 'Choose your trainer' }).click();
  await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
  await looksRight(s, info, 'The player, ready');
  const rideName = (await page.locator('.pl-workout h1').innerText()).trim();
  const rideSeconds = await page.locator('.pl-figures .pl-fig').first().innerText().then((t) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0));
  // From here the page's clock is ours to run forward.
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
  // The month view shortens a long name ("Paeonian Spri…"), so the start of it is enough.
  await expect(page.locator('main')).toContainText(rideName.slice(0, 12));
  await go(page, '#/today');
  await expect(page.locator('main')).toContainText(/Done/);
  await looksRight(s, info, 'Today, done');
  // 22 Nov 2026: the ride's chart opened large shows the planned target, from the player's own record of each step.
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').filter({ hasText: rideName }).first().click();
  await page.getByRole('button', { name: 'Open power large' }).click();
  const large = page.getByRole('dialog');
  const target = large.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Planned target' });
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(large.locator('.lv-target').first()).toBeAttached();
  await looksRight(s, info, 'Large, the planned target');
  await target.click();
  await expect(large.locator('.lv-target')).toHaveCount(0);
  await target.click();
  await expect(large.locator('.lv-target').first()).toBeAttached();
});

/** The riding screen, paused, fits a phone: Resume is wider than Pause. */
test('pause a ride on a phone', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('phone'), 'a phone check');
  const s = await setUp(page, 'power');
  await makePlan(page);
  await simulatedTrainer(page);
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await openFirstRide(page, false);
  await page.getByRole('link', { name: 'Ride indoors on the trainer' }).first().click();
  await page.getByRole('button', { name: 'Choose your trainer' }).click();
  await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' }).first()).toBeVisible();
  await looksRight(s, info, 'Paused');
});
