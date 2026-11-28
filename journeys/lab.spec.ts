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
  await expect(page.locator('.lb-row[data-measure="avgHr"] .lb-dot').first()).toBeVisible();
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
