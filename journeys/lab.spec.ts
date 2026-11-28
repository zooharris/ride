import { expect, test } from '@playwright/test';
import { go, looksRight, setUp } from './rider';

/**
 * The Lab (27 Nov 2026): the front page with its families, search, pins and the opening choice; a family's full list;
 * a measure opened in the one large view; and a rider with no data, who is never shown a line they did not ride.
 */

test('the Lab: families, search, a pin, a family list, and a measure opened large', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'power');
  await go(page, '#/lab');
  await expect(page.getByRole('heading', { name: 'The Lab', level: 1 })).toBeVisible();
  // Ten families, each a list with the rider's newest values.
  await expect(page.locator('.lb-fam')).toHaveCount(10);
  const load = page.locator('.lb-fam[data-family="load"]');
  await expect(load).toContainText('Load and form');
  await expect(load.locator('.lb-fam-r em').first()).not.toHaveText('–');
  await looksRight(s, info, 'The Lab');
  // The same period choice as everywhere: it is kept in the address.
  await page.getByRole('radio', { name: '1 yr' }).click();
  await expect(page).toHaveURL(/p=1y/);
  // Search finds a measure by a plain word, and says so when it finds nothing.
  const search = page.getByPlaceholder('Search every chart and measure');
  await search.fill('sleep');
  await expect(page.locator('.lb-row[data-measure="sleep"]')).toBeVisible();
  await search.fill('qqqq');
  await expect(page.getByText('nothing for “qqqq”')).toBeVisible();
  await search.fill('resting');
  // Pin it: it then leads the front page.
  await page.getByRole('button', { name: 'Pin Resting heart rate to the top of the Lab' }).click();
  await search.fill('');
  await expect(page.getByRole('heading', { name: /Pinned/ })).toBeVisible();
  await expect(page.locator('.lb-row[data-measure="restingHr"]')).toBeVisible();
  // A family opens its full list; the period went with it.
  await load.click();
  await expect(page).toHaveURL(/#\/lab\/family\/load/);
  await expect(page.getByRole('heading', { name: 'Load and form', level: 1 })).toBeVisible();
  await expect(page.locator('.lb-row[data-measure="fitness"]')).toBeVisible();
  await expect(page.locator('.lb-row[data-measure="ramp"]')).toBeVisible();
  await looksRight(s, info, 'The Lab, a family');
  // A measure opens in the large view the Progress page uses, where others are laid over it.
  await page.locator('.lb-row[data-measure="fitness"]').click();
  const large = page.getByRole('dialog').first();
  await expect(large).toContainText('Fitness');
  await expect(large.getByRole('group', { name: 'Lay over it' })).toBeVisible();
  await expect(page).toHaveURL(/big=fitness/);
  await looksRight(s, info, 'The Lab, a measure opened large');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Back returns to the front page as it was left, the pin still there.
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'The Lab', level: 1 })).toBeVisible();
  await expect(page.locator('.lb-row[data-measure="restingHr"]')).toBeVisible();
  // The opening choice is kept.
  await page.getByRole('radio', { name: 'The Lab' }).click();
  await expect(page.getByRole('radio', { name: 'The Lab' })).toHaveAttribute('aria-checked', 'true');
  // The choice is written to the device a moment after the press: let it land before the app is closed.
  await page.waitForTimeout(400);
  await page.reload();
  await go(page, '#/lab');
  await expect(page.getByRole('radio', { name: 'The Lab' })).toHaveAttribute('aria-checked', 'true');
});

test('the Lab for a rider who trains by heart rate: the power measures are empty and say why', async ({ page }, info) => {
  const s = await setUp(page, 'hr');
  await go(page, '#/lab/family/power');
  await expect(page.getByRole('heading', { name: 'Power', level: 1 })).toBeVisible();
  const np = page.locator('.lb-row[data-measure="np"]');
  await expect(np).toContainText('Needs a power meter');
  await expect(np.locator('.lb-line, .lb-dot, .lb-bar')).toHaveCount(0);
  await go(page, '#/lab/family/heart');
  await expect(page.locator('.lb-row[data-measure="avgHr"] .lb-dot')).not.toHaveCount(0);
  await looksRight(s, info, 'The Lab, heart, a rider without power');
});

test('the Lab for a new rider: empty frames and reasons, never a line they did not ride', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await go(page, '#/lab');
  await expect(page.locator('.lb-fam')).toHaveCount(10);
  await expect(page.locator('.lb-fam[data-family="power"]')).toContainText('Needs a power meter');
  await expect(page.locator('.lb-fam-r em:not(.no)')).toHaveCount(0);
  await looksRight(s, info, 'The Lab, a new rider');
  await go(page, '#/lab/family/body');
  await expect(page.locator('.lb-row:not(.wait)')).toHaveCount(0);
  await expect(page.locator('.lb-line, .lb-dot, .lb-bar')).toHaveCount(0);
  await expect(page.locator('.lb-row[data-measure="hrv"]')).toContainText('Needs overnight readings');
});

const CHARTS = ['fitness', 'power', 'records', 'zones', 'heart', 'compare', 'breathing', 'durability', 'year', 'recovery', 'weight', 'pedal'];

test('the Lab\'s designed charts: a tile each, drawn from the rider\'s own data, and each opens with its sentence, its reading and its figures', async ({ page }, info) => {
  test.setTimeout(240_000);
  const s = await setUp(page, 'power');
  await go(page, '#/lab');
  await expect(page.locator('.lb-tile')).toHaveCount(CHARTS.length);
  // The rider has no breathing sensor: that tile is an empty frame with the reason, and no line.
  const breathing = page.locator('.lb-tile[data-chart="breathing"]');
  await expect(breathing).toContainText('Needs a breathing sensor');
  await expect(breathing.locator('.lb-tile-pic path, .lb-tile-pic rect')).toHaveCount(0);
  await expect(page.locator('.lb-tile[data-chart="fitness"] .lb-fig b')).toHaveText(/^\d+$/);
  await looksRight(s, info, 'The Lab, with its charts');
  for (const id of CHARTS.filter((c) => c !== 'breathing')) {
    await go(page, `#/lab/chart/${id}`);
    await expect(page.locator('.lc-lead')).toBeVisible();
    await expect(page.locator('.lc-how')).toContainText('How to read this');
    await expect(page.locator('.lc-how')).toContainText('In plain words');
    await expect(page.locator('.lc-body').first()).toBeVisible();
    await looksRight(s, info, `The Lab, chart ${id}`);
  }
  // The reading follows the finger, and the figures open as a table.
  await go(page, '#/lab/chart/fitness');
  const before = await page.locator('.lc-read .lc-when').innerText();
  const box = (await page.locator('.lc-plot svg').first().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await expect(page.locator('.lc-read .lc-when')).not.toHaveText(before);
  await page.getByRole('button', { name: /^The figures/ }).click();
  await expect(page.locator('.lc-tw table tbody tr').first()).toBeVisible();
  // "What does this mean?" leads up to the question the chart bears on.
  await expect(page.getByRole('link', { name: /What does this mean\? Am I getting fitter\?/ })).toHaveAttribute('href', '#/insights/fitter');
  // A chart with nothing to draw says so, and what it needs.
  await go(page, '#/lab/chart/breathing');
  await expect(page.getByText('There is nothing to draw here yet. Needs a breathing sensor.')).toBeVisible();
});

test('the Lab\'s charts for a rider by heart rate and for a new rider: nothing drawn that they did not ride', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'hr');
  await go(page, '#/lab');
  for (const id of ['power', 'records', 'durability']) await expect(page.locator(`.lb-tile[data-chart="${id}"]`)).toContainText('Needs a power meter');
  for (const id of ['fitness', 'zones', 'heart', 'year', 'recovery']) {
    await go(page, `#/lab/chart/${id}`);
    await expect(page.locator('.lc-lead')).toBeVisible();
    await looksRight(s, info, `The Lab, chart ${id}, a rider without power`);
  }
});

test('the Lab\'s charts for a new rider: every tile an empty frame with its reason', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await go(page, '#/lab');
  await expect(page.locator('.lb-tile')).toHaveCount(CHARTS.length);
  await expect(page.locator('.lb-tile.wait')).toHaveCount(CHARTS.length);
  await expect(page.locator('.lb-tile-pic path, .lb-tile-pic rect, .lb-tile-pic circle')).toHaveCount(0);
  await looksRight(s, info, 'The Lab, charts, a new rider');
});
