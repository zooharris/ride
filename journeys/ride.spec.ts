import { expect, test, type Page } from '@playwright/test';
import { go, looksRight, makePlan, openFirstRide, setUp, simulatedTrainer } from './rider';

/**
 * Journey 2: Today's session in the ride player on the simulated trainer, ridden to the end, saved, and done.
 * The clock is run forward so an hour's ride takes seconds.
 */
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
  // On a phone the screen before the ride is one screen, with Start ride in view.
  if (info.project.name.startsWith('phone')) { await expect(page.locator('.pp')).toBeVisible(); await expect(page.getByRole('button', { name: 'Start ride' })).toBeInViewport(); }
  const rideName = (await page.locator('.pl-workout h1').innerText()).trim();
  const rideSeconds = await page.locator('.pl-figures .pl-fig').first().innerText().then((t) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0));
  // From here the page's clock is ours to run forward.
  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.clock.runFor(3 * 60_000);
  await looksRight(s, info, 'Riding');
  // On a phone the ride is three pages of one screen each (26 Nov 2026): each is reached, and none runs below the fold.
  if (info.project.name.startsWith('phone')) {
    for (const name of ['Numbers', 'Workout', 'Ride']) {
      await page.locator('.rp-dots button', { hasText: name }).click();
      await expect(page.locator('.rp-dots button.on')).toHaveText(name);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${name} fits the screen`).toBe(true);
    }
    await expect(page.getByRole('button', { name: 'Skip this step ›' })).toBeAttached();
  }
  // Far enough to count as the session (five minutes and a fifth of the ride), then ended early, as a rider may.
  await page.clock.runFor(Math.max(6 * 60, rideSeconds / 5 + 60) * 1000);
  await page.getByRole('button', { name: 'End ride' }).first().click();
  await expect(page.getByRole('button', { name: 'Save ride' }).first()).toBeVisible();
  await looksRight(s, info, 'The summary');
  await page.getByRole('button', { name: 'Save ride' }).first().click();
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
  // 23 Nov 2026: saved in Antogo's record and sent on to the data service, it is one activity, not two.
  await expect(page.locator('a[href*="#/rides/"]').filter({ hasText: rideName })).toHaveCount(1);
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

/**
 * 23 Nov 2026: a rider with no account anywhere rides and saves. The ride is in Antogo's own record at once, with
 * nothing said about a data service; and a ride under five minutes is kept, not listed, and the player says where it is.
 */
test('a rider with no data service saves rides from the player', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('laptop'), 'the player with a trainer is a laptop journey');
  const s = await setUp(page, 'new');
  page.on('dialog', (d) => void d.accept());   // "End the ride?"
  await simulatedTrainer(page);
  await page.clock.install({ time: new Date(new Date().setHours(12, 0, 0, 0)) });
  const rideFor = async (minutes: number) => {
    await go(page, '#/play/free');
    await page.getByRole('button', { name: /^Smart trainer/ }).first().click();
    await page.getByRole('menuitem', { name: /Simulated smart trainer/i }).click();
    await page.getByRole('button', { name: 'Start ride' }).click();
    await page.clock.runFor(minutes * 60_000);
    await page.getByRole('button', { name: 'End ride' }).first().click();
    await page.getByRole('button', { name: 'Save ride' }).first().click();
    await expect(page.locator('.rd-saved')).toBeVisible({ timeout: 20_000 });
    const text = (await page.locator('.rd-saved').innerText()).trim();
    if (minutes < 5) await looksRight(s, info, 'Saved, under five minutes'); else await looksRight(s, info, 'Saved, with no data service');
    await page.getByRole('button', { name: 'Done', exact: true }).first().click();
    return text;
  };
  const said = await rideFor(8);
  expect(said).toMatch(/^Saved/);
  expect(said).not.toMatch(/Intervals|upload/i);
  await page.clock.resume();
  await go(page, '#/rides');
  await expect(page.locator('main')).toContainText('1 activity');
  await expect(page.locator('a[href*="#/rides/file-"]')).toHaveCount(1);
  await page.locator('a[href*="#/rides/file-"]').first().click();
  await expect(page.locator('[data-own-numbers]')).toHaveAttribute('data-own-numbers', 'yes');
  await expect(page.getByRole('heading', { name: 'The recording' })).toBeVisible();
  await go(page, '#/today');
  await expect(page.getByText('waiting to be saved')).toHaveCount(0);
  // A ride of three minutes: kept, not listed, and the player says so.
  await page.clock.install({ time: new Date(new Date().setHours(15, 0, 0, 0)) });
  const short = await rideFor(3);
  expect(short).toContain('under five minutes');
  expect(short).toContain('Show the recordings that are not training');
  await page.clock.resume();
  await go(page, '#/rides');
  await expect(page.locator('main')).toContainText('1 activity · 1 not training');
  await expect(page.locator('a[href*="#/rides/file-"]')).toHaveCount(1);
});
