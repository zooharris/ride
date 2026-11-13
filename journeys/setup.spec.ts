import { expect, test } from '@playwright/test';
import { looksRight, makePlan, setUp } from './rider';

/** Journey 1: first-run setup through to a first plan, for each made-up rider. */

test('a new rider who knows none of their numbers gets a plan, and no target built on a missing number', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await looksRight(s, info, 'Today after setup');
  await makePlan(page);
  await looksRight(s, info, 'Plan placed');
  // The plan's page says why its first week has no test (no sensors to measure with).
  await page.goto('./#/calendar');
  await looksRight(s, info, 'Calendar');
  // A ride's page: zones and shares of threshold, no watts and no beats per minute.
  await page.goto('./#/library');
  await page.locator('a[href*="#/workout/"]').first().click();
  await expect(page.getByText('Your FTP and threshold heart rate are not known yet')).toBeVisible();
  await expect(page.locator('table.steps')).not.toContainText(/\d W\b/);
  await expect(page.locator('table.steps')).not.toContainText('bpm');
  await looksRight(s, info, 'A ride with no numbers known');
  // Settings says what is not known, and shows no stand-in.
  await page.goto('./#/settings');
  await page.getByRole('tab', { name: 'Power' }).click();
  await expect(page.getByText('Not known yet: a power test sets it')).toBeVisible();
  await looksRight(s, info, 'Settings');
});

test('a rider who trains by heart rate: numbers from Intervals.icu, a test for the FTP they don\'t have', async ({ page }, info) => {
  const s = await setUp(page, 'hr');
  await looksRight(s, info, 'Today after setup and sync');
  await makePlan(page);
  await looksRight(s, info, 'Plan placed');
});

test('a rider with power and a year of history: everything from Intervals.icu', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await looksRight(s, info, 'Today after setup and sync');
  await makePlan(page);
  await looksRight(s, info, 'Plan placed');
});
