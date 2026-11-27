import { expect, test } from '@playwright/test';
import { answers, go, looksRight, setUp } from './rider';

/**
 * Stage 0 (22 Nov 2026): the whole history kept on this device, an activity that arrives with no detail (shown from
 * its kept file, or said plainly), and the Garmin personal key test page keeping the key to show and copy again.
 */

test('the whole history kept; an activity with no detail shown from its kept file, or said plainly', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'power');
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^History/ }).click();
  const keeping = page.locator('.keeping');
  await expect(keeping).toContainText('Kept on this device');
  // The keeping starts a little after the sync and works through the files one at a time.
  await expect(keeping).toContainText(/Your whole history, back to/, { timeout: 60_000 });
  await expect(keeping).toContainText(/Original files: [1-9]\d* of/, { timeout: 60_000 });
  await looksRight(s, info, 'Settings, kept on this device');
  // The evening walk came back with no detail, but its file was kept: its recording is shown from it.
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').filter({ hasText: 'Evening walk' }).first().click();
  await expect(page.getByText('shown from the original file kept on this device', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The recording' })).toBeVisible();
  await looksRight(s, info, 'An activity shown from its kept file');
  // The lunch walk came back with no detail and has no file: the page says why, and the way round it.
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').filter({ hasText: 'Lunch walk' }).first().click();
  await expect(page.getByText(/Intervals\.icu sent this activity without its detail\. Garmin now limits/)).toBeVisible();
  await looksRight(s, info, 'An activity with no detail');
});

test('the Garmin key test page: save a key, show it, copy it, test it, forget it', async ({ page, context }, info) => {
  const s = await setUp(page, 'power');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await answers(page);
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^History/ }).click();
  await page.getByRole('link', { name: 'Garmin, with your personal key' }).click();
  await expect(page.getByRole('heading', { name: 'Garmin, with your personal key' })).toBeVisible();
  // In a browser the page says where Garmin does answer, with the Mac app's download (23 Nov 2026).
  await expect(page.getByText('Garmin does not answer a browser.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download Antogo for the Mac' })).toHaveAttribute('href', /releases\/latest\/download\/Antogo\.dmg$/);
  await looksRight(s, info, 'The Garmin key page, empty');
  await page.getByLabel('Garmin personal key').fill('made-up-garmin-key-0123456789');
  await page.getByRole('button', { name: 'Save on this device' }).click();
  const shown = page.getByLabel('Your Garmin personal key');
  await expect(shown).not.toContainText('made-up-garmin-key-0123456789');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(shown).toHaveText('made-up-garmin-key-0123456789');
  // Still there after the app is closed and opened again.
  await page.reload();
  await go(page, '#/garmin-key');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByLabel('Your Garmin personal key')).toHaveText('made-up-garmin-key-0123456789');
  await page.getByRole('button', { name: 'Copy the key' }).click();
  await looksRight(s, info, 'The Garmin key page, saved');
  // Nothing leaves this machine in the journeys, so Garmin "does not answer": said plainly.
  await page.getByRole('button', { name: 'Run the test' }).click();
  await expect(page.getByText(/does not allow its key to be used from a browser/)).toBeVisible();
  await looksRight(s, info, 'The Garmin key test, refused');
  await page.getByRole('button', { name: 'Forget' }).click();
  await expect(page.getByLabel('Garmin personal key')).toBeVisible();
});
