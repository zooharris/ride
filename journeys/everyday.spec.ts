import { expect, test } from '@playwright/test';
import { go, looksRight, makePlan, open, setUp } from './rider';

/** Journeys 3 to 8: what a rider does most days, each from a fresh setup. */

test('sync with the data service, then the plan checks itself', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await makePlan(page);
  await go(page, '#/today');
  const before = s.ledger.requests.filter((r) => r.includes('/activities')).length;
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeEnabled({ timeout: 30_000 });
  expect(s.ledger.requests.filter((r) => r.includes('/activities')).length).toBeGreaterThan(before);
  await looksRight(s, info, 'Today after a sync and the re-check');
});

for (const kind of ['hr', 'power'] as const) {
  test(`send a ride and a strength or mobility session (${kind === 'hr' ? 'one device' : 'two devices'})`, async ({ page }, info) => {
    const s = await setUp(page, kind);
    await makePlan(page, { strength: true });
    const where = kind === 'hr' ? 'Intervals.icu will pass this to your Wahoo.' : 'Intervals.icu will pass this to your Garmin and Wahoo.';
    // A ride from the calendar.
    await go(page, '#/calendar');
    const list = page.getByRole('button', { name: 'List', exact: true });
    if (await list.isVisible()) await list.click();
    const rows = page.locator('a[href*="#/workout/"]');
    await rows.filter({ hasNotText: /Strength|Legs|Upper|Mobility|Walk|Ramp/ }).first().click();
    await expect(page.getByText(where).first()).toBeVisible();
    if (kind === 'power') await expect(page.getByText('Your Coros is connected in Intervals.icu, but uploading planned workouts to it is off.').first()).toBeVisible();
    await looksRight(s, info, 'A ride, before sending');
    const sent = s.ledger.events.length;
    await page.getByRole('button', { name: /^Send to my devices/ }).first().click();
    await expect(page.getByText(/^Sent to Intervals\.icu/).first()).toBeVisible();
    expect(s.ledger.events.length).toBe(sent + 1);
    await page.getByRole('button', { name: 'Not on your device?' }).click();
    await expect(page.getByText('Too far ahead.')).toBeVisible();
    await looksRight(s, info, 'A ride, sent');
    // A strength session from the calendar if the plan has one in view; else a mobility session (the same send).
    await go(page, '#/calendar');
    if (await list.isVisible()) await list.click();
    const strength = rows.filter({ hasText: /Legs|Upper|Strength|body/i }).first();
    const other = (await strength.count()) ? strength : rows.filter({ hasText: /Mobility/ }).first();
    await other.click();
    await expect(page.getByText(where).first()).toBeVisible();
    await page.getByRole('button', { name: 'Send to my devices' }).first().click();
    await expect(page.getByText(/Sent to Intervals\.icu/).first()).toBeVisible();
    expect(s.ledger.events.length).toBe(sent + 2);
    await looksRight(s, info, 'Strength or mobility, sent');
  });
}

test('nothing set to receive workouts: the app says what to change, before sending', async ({ page }, info) => {
  const s = await setUp(page, 'hr');
  await makePlan(page);
  // The rider turns Wahoo's uploads off in Intervals.icu; Settings, Check again, reads it.
  await page.unroute('https://intervals.icu/**');
  await page.route('https://intervals.icu/**/connections', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ wahoo_connected: true }) }));
  await page.route('https://intervals.icu/api/v1/athlete/i900001', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'i900001', wahoo_upload_workouts: false }) }));
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^Intervals\.icu/ }).click();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('Wahoo: connected, uploads off')).toBeVisible();
  await looksRight(s, info, 'Settings, where your workouts go');
  await go(page, '#/calendar');
  const list = page.getByRole('button', { name: 'List', exact: true });
  if (await list.isVisible()) await list.click();
  await page.locator('a[href*="#/workout/"]').filter({ hasNotText: /Strength|Legs|Upper|Mobility|Walk/ }).first().click();
  await expect(page.getByText("Intervals.icu isn't set to upload workouts to any device.").first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Put it on my Intervals.icu calendar anyway' })).toBeVisible();
  await looksRight(s, info, 'A ride with nothing to receive it');
});

test('build a strength workout: chips, details, a repeat, the list at a spot; save, do it, edit the record', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await go(page, '#/library');
  await page.getByRole('link', { name: 'New workout' }).or(page.getByRole('button', { name: 'New workout' })).first().click();
  await page.getByText('Strength', { exact: true }).first().click();
  await page.getByPlaceholder('Tuesday legs').fill('Journey legs');
  // A chip adds; the expand icon opens the details and adds nothing.
  await page.getByRole('button', { name: 'Add Bodyweight squat' }).click();
  await page.getByRole('button', { name: 'Details: Glute bridge' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Glute bridge' });
  await expect(sheet.getByText('How to do it')).toBeVisible();
  await looksRight(s, info, 'The details sheet');
  await sheet.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('heading', { name: /Exercises/ })).toContainText('1');
  // A repeat, with Undo; then again, kept.
  await page.getByRole('button', { name: 'Add Bodyweight squat again' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: /Exercises/ })).toContainText('1');
  await page.getByRole('button', { name: 'Add Bodyweight squat again' }).click();
  await expect(page.getByRole('heading', { name: /Exercises/ })).toContainText('2');
  // From the list, at a chosen spot: above the first.
  await page.getByRole('button', { name: 'Add an exercise here' }).first().click();
  await page.getByRole('combobox', { name: /Find an exercise to put here/ }).fill('plank');
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel b').filter({ hasText: /plank/i }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Exercises/ })).toContainText('3');
  await looksRight(s, info, 'The builder with three blocks');
  await page.getByRole('button', { name: /^Save and put on today/ }).click();
  // It is on today's calendar: do it, and correct the record.
  await page.getByRole('link', { name: /Journey legs/ }).first().click();
  await expect(page).toHaveURL(/#\/workout\//);
  await page.getByRole('button', { name: 'Mark done' }).first().click();
  await page.getByRole('button', { name: /^Edit$|Add what you did/ }).first().click();
  await expect(page.locator('.done-edit')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await looksRight(s, info, 'The record of what was done');
});

test('Library: filter, sort, open a ride, Back as left; Copy and edit says what it trains', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await go(page, '#/library');
  await page.getByLabel('Search the library').fill('level 2');
  const filters = page.getByRole('button', { name: /^Filters/ });
  if (await filters.isVisible()) await filters.click();
  await page.getByRole('group', { name: /^Trains/ }).getByRole('button').first().click();
  await page.getByRole('button', { name: /^Sort:/ }).click();
  await page.getByRole('option', { name: /Length/ }).click();
  await looksRight(s, info, 'Library, filtered and sorted');
  const first = page.locator('a[href*="#/workout/"]').first();
  const name = (await first.innerText()).split('\n')[0];
  await first.click();
  await page.locator('main').getByRole('link', { name: /Library|Back/ }).or(page.locator('main').getByRole('button', { name: /Library|Back/ })).first().click();
  await expect(page.getByLabel('Search the library')).toHaveValue('level 2');
  await expect(page.locator('a[href*="#/workout/"]').first()).toContainText(name);
  await page.locator('a[href*="#/workout/"]').first().click();
  await page.getByRole('link', { name: 'Copy and edit' }).click();
  await expect(page.locator('.trains-line')).toContainText('Trains:');
  await looksRight(s, info, 'Copy and edit');
  await page.getByRole('button', { name: 'Save to My Workouts' }).click();
  await looksRight(s, info, 'Saved');
});

test('Progress: open a chart large, lay one measure over, close', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await go(page, '#/progress');
  await page.getByRole('button', { name: /^Open .* large$/ }).first().click();
  const large = page.getByRole('dialog').first();
  await expect(large).toBeVisible();
  const lay = large.getByRole('button', { name: /^(Sleep|HRV|Training load|Resting heart rate|Daily load|Fitness)/ }).first();
  if (await lay.count()) await lay.click();
  await looksRight(s, info, 'A chart open large');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await looksRight(s, info, 'Progress');
});

test('export one activity; back up everything, then restore it into a fresh browser', async ({ page, browser }, info) => {
  const s = await setUp(page, 'power');
  await makePlan(page);
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').first().click();
  await page.getByRole('button', { name: 'Download', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.locator('.toasts')).toContainText(/Downloaded|Could not get|summary/);
  await looksRight(s, info, 'An activity downloaded');
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up everything' }).click()]);
  const file = await backup.path();
  const fresh = await browser.newContext({ serviceWorkers: 'block', baseURL: info.project.use.baseURL, viewport: info.project.use.viewport ?? undefined });
  const p2 = await fresh.newPage();
  const s2 = await setUp(p2, 'new');
  p2.on('dialog', (d) => void d.accept());
  await go(p2, '#/settings');
  await p2.getByRole('button', { name: /^Across your devices, and backup/ }).click();
  await p2.locator('input[type=file][accept*="json"]').setInputFiles(file!);
  await p2.waitForEvent('load', { timeout: 20_000 }).catch(() => {});
  await go(p2, '#/plan');
  await expect(p2.locator('main')).toContainText(/Event plan/);
  await looksRight(s2, info, 'Restored in a fresh browser');
  await fresh.close();
  void open;
});
