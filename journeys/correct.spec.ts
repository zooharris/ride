import { expect, test, type Page } from '@playwright/test';
import { answers, go, looksRight, setUp } from './rider';
import { encodeFitActivity } from '../src/export/activityFiles';

/**
 * Antogo's own FTP history, the setting, and activities you can correct (22 Nov 2026), as a rider would use them, on
 * a phone, a tablet and a laptop. The riders and their files are made up; nothing here is any real rider's.
 */

const T = Array.from({ length: 3000 }, (_, i) => i);
/** A 50-minute ride file; `ftp` is the FTP the device had set that day, when the file is to carry one. */
function fit(startIso: string, ftp?: number): Buffer {
  return Buffer.from(encodeFitActivity({ id: 'x', date: startIso.slice(0, 10), startTime: startIso, name: 'R', type: 'Ride', sport: 'ride', seconds: 3000, ...(ftp ? { ftpAtRide: ftp } : {}) } as never,
    { time: T, watts: T.map((i) => 190 + (i % 50)), heartrate: T.map(() => 138), cadence: T.map(() => 88), distance: T.map((i) => i * 8), velocity: T.map(() => 8), altitude: T.map((i) => 100 + (i % 400) / 10) }));
}
const pad = (n: number) => String(n).padStart(2, '0');
const dayAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysAgo = (n: number, hour = 17) => `${dayAgo(n)}T${pad(hour)}:15:00`;

async function addFiles(page: Page, files: Array<{ name: string; buffer: Buffer }>) {
  await go(page, '#/rides');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add activity files' });
  await sheet.getByLabel('Activity files', { exact: true }).setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/octet-stream' })));
  await expect(sheet.locator('.import-result')).toBeVisible({ timeout: 30_000 });
  return sheet;
}

/** Settings, with the FTP history open (it is filled in a moment after the first sync). */
async function ftpHistory(page: Page) {
  await expect.poll(async () => {
    await go(page, '#/settings');
    return page.locator('details.th-ftp > summary').innerText().catch(() => '');
  }, { timeout: 30_000, intervals: [1500] }).toMatch(/\d+ entr(y|ies)/);
  const box = page.locator('details.th-ftp');
  if (!(await box.getAttribute('open') !== null)) await box.locator('> summary').click();
  await expect(box.locator('.th-list')).toBeVisible();
  return box;
}
/** Where the FTP used came from: said under Correct this activity, once "FTP used for this ride" is opened. */
const why = (page: Page) => page.locator('.fix-ftp .fix-why');
const cell = (page: Page, label: string) => page.locator('.ng-cell', { has: page.locator('.ng-label', { hasText: label }) }).locator('.ng-value');
/** The newest hard ride of the made-up power rider: from Intervals.icu, with power, no file kept. */
async function openIntervalsRide(page: Page) {
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').filter({ hasText: 'Intervals' }).first().click();
  await expect(page.getByRole('heading', { name: 'Numbers' })).toBeVisible();
}

test('the FTP history: add an entry in the past, and a ride\'s numbers change; then correct one ride only, and undo it', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await answers(page);
  // The history was filled in from the activities already here: one figure all year.
  let box = await ftpHistory(page);
  await expect(box.locator('.th-list')).toContainText('255 W');
  await expect(box.locator('.th-list')).toContainText('filled in from your activities');
  await expect(box.getByRole('radio', { name: "Antogo's FTP history" })).toHaveAttribute('aria-checked', 'true');
  await looksRight(s, info, 'Settings, the FTP history as filled in');
  // A ride of the last week, as scored now.
  await openIntervalsRide(page);
  await expect(cell(page, 'FTP used for this ride')).toHaveText('255 W');
  await expect(cell(page, 'Intensity')).toHaveText('0.93');
  // Why that figure is under Correct this activity, once opened.
  await page.locator('details.fix-ftp > summary').click();
  await expect(why(page)).toContainText("255 W · Antogo's history (filled in from your activities");
  const before = await cell(page, 'Training load (TSS)').innerText();
  // An entry in the past: from two months ago the FTP was 230.
  box = await ftpHistory(page);
  await box.getByRole('button', { name: 'Add an entry' }).click();
  await box.getByLabel('From this day').fill(dayAgo(60));
  await box.getByLabel('FTP in watts').fill('230');
  await box.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.locator('.toast-text').filter({ hasText: /Added: 230 W.*activities worked out again/ })).toBeVisible({ timeout: 30_000 });
  await expect(box.locator('.th-list')).toContainText('230 W');
  await expect(box.locator('.th-list')).toContainText('typed by you');
  await expect(box.locator('.th-work')).toContainText('Last worked out again');
  // The entry in force today is the rider's FTP: the box above follows.
  await expect(page.locator('.field', { hasText: 'FTP (watts)' }).first().locator('input')).toHaveValue('230');
  await looksRight(s, info, 'Settings, an entry added in the past');
  await openIntervalsRide(page);
  await expect(cell(page, 'FTP used for this ride')).toHaveText('230 W');
  await expect(cell(page, 'Intensity')).toHaveText('1.03');
  expect(await cell(page, 'Training load (TSS)').innerText()).not.toBe(before);
  await looksRight(s, info, 'A ride scored with the new entry');
  // Correct this ride's FTP, for this ride only.
  await page.locator('details.fix-ftp > summary').click();
  await expect(why(page)).toContainText("230 W · Antogo's history (typed by you");
  await page.getByLabel('FTP for this ride, in watts').fill('240');
  await page.locator('.fix-ftp').getByRole('button', { name: 'Save', exact: true }).click();
  const fixes = page.locator('.fixes-on');
  await expect(fixes).toContainText('FTP for this ride set to 240 W by you');
  await expect(cell(page, 'FTP used for this ride')).toHaveText('240 W');
  await expect(why(page)).toHaveText('240 W · set by you for this ride');
  await expect(cell(page, 'Intensity')).toHaveText('0.99');
  await looksRight(s, info, 'A ride with its own FTP');
  // Undo it, from the list at the top of the page.
  await fixes.getByRole('button', { name: /^Undo: FTP for this ride/ }).click();
  await expect(fixes).toHaveCount(0);
  await expect(cell(page, 'FTP used for this ride')).toHaveText('230 W');
  await expect(cell(page, 'Intensity')).toHaveText('1.03');
  // The entry is removed again: the ride is back as it was.
  box = await ftpHistory(page);
  await box.getByRole('button', { name: /^Remove the entry from/ }).first().click();
  await expect(page.locator('.toast-text').filter({ hasText: /Removed\./ })).toBeVisible({ timeout: 30_000 });
  await openIntervalsRide(page);
  await expect(cell(page, 'Intensity')).toHaveText('0.93');
  expect(await cell(page, 'Training load (TSS)').innerText()).toBe(before);
});

test('files that carry FTP settings: the summary before scoring, the setting changed and back, the device\'s figure used for a period', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'power');
  await answers(page);
  await ftpHistory(page);
  // Two rides whose files say the device had 244 W set.
  const sheet = await addFiles(page, [{ name: 'one.fit', buffer: fit(daysAgo(40), 244) }, { name: 'two.fit', buffer: fit(daysAgo(33), 244) }]);
  const result = sheet.locator('.import-result');
  await expect(result).toContainText('2 new activities');
  await expect(result).toContainText(/Your files say your FTP was 244 W from \w+ \d{4}\./);
  await expect(result).toContainText("Your setting is to score rides with Antogo's FTP history. 2 new rides are from");
  await expect(result).toContainText('Nothing brought in has been scored yet.');
  await looksRight(s, info, 'Files brought in: what they say about FTP, before scoring');
  await result.getByRole('button', { name: 'Carry on' }).click();
  await expect(result).toContainText('The new activities have been scored.', { timeout: 60_000 });
  await sheet.getByRole('button', { name: 'Close' }).click();
  const openFileRide = async () => { await go(page, '#/rides'); await page.locator('a[href*="#/rides/file-"]').first().click(); await expect(page.getByRole('heading', { name: 'Numbers' })).toBeVisible(); };
  await openFileRide();
  await expect(cell(page, 'FTP used for this ride')).toHaveText('255 W');
  // The setting: the FTP my device had set that day; and back.
  let box = await ftpHistory(page);
  await box.getByRole('radio', { name: 'The FTP my device had set that day' }).click();
  await expect(page.locator('.toast-text').filter({ hasText: /scored with the FTP your device had set that day\. 2 activities worked out again/ })).toBeVisible({ timeout: 30_000 });
  await looksRight(s, info, 'Settings, scoring by the device\'s FTP');
  await openFileRide();
  await expect(cell(page, 'FTP used for this ride')).toHaveText('244 W');
  await page.locator('details.fix-ftp > summary').click();
  await expect(why(page)).toHaveText("244 W · your device's setting that day");
  await looksRight(s, info, 'A ride scored with its device\'s FTP');
  box = await ftpHistory(page);
  await box.getByRole('radio', { name: "Antogo's FTP history" }).click();
  await expect(page.locator('.toast-text').filter({ hasText: /scored with Antogo's FTP history\. 2 activities worked out again/ })).toBeVisible({ timeout: 30_000 });
  await openFileRide();
  await expect(cell(page, 'FTP used for this ride')).toHaveText('255 W');
  // The device's figure, shown beside the history as a suggestion, used for its period.
  box = await ftpHistory(page);
  const device = box.locator('.th-device');
  await expect(device).toContainText('Your device had 244 W');
  await looksRight(s, info, "Settings, what the device had set");
  await device.getByRole('button', { name: "Use the device's for this period" }).click();
  await expect(page.locator('.toast-text').filter({ hasText: /244 W used .*worked out again/ })).toBeVisible({ timeout: 30_000 });
  await expect(box.locator('.th-list')).toContainText('from your device');
  await expect(box.locator('.th-device')).toHaveCount(0);
  await looksRight(s, info, "Settings, the device's figure used for its period");
  await openFileRide();
  await expect(cell(page, 'FTP used for this ride')).toHaveText('244 W');
  await page.locator('details.fix-ftp > summary').click();
  await expect(why(page)).toContainText("244 W · Antogo's history (from your device");
});

test('correct an activity: leave out its power, trim it and restore it, move its start; each undone', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'hr');
  await answers(page);
  const sheet = await addFiles(page, [{ name: 'ride.fit', buffer: fit(daysAgo(2, 6)) }]);
  await expect(sheet.locator('.import-result')).toContainText('1 new activity');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.locator('a[href*="#/rides/file-"]').first().click();
  await expect(cell(page, 'Moving time')).toHaveText('50:00');
  await expect(cell(page, 'Normalized power')).toContainText('W');
  await expect(page.getByRole('heading', { name: 'Correct this activity' })).toBeVisible();
  const fixes = page.locator('.fixes-on');
  // Leave out the power: scored from heart rate, its power numbers hidden with a line saying why.
  await page.locator('details.fix-leave > summary').click();
  await page.getByRole('checkbox', { name: /^Leave out the power/ }).click();
  await expect(fixes).toContainText('Power left out');
  await expect(cell(page, 'Power')).toHaveText('Left out by you');
  await expect(cell(page, 'Normalized power')).toHaveCount(0);
  await expect(page.locator('details.fix-leave > summary')).toContainText('power left out');
  await looksRight(s, info, 'An activity with its power left out');
  await fixes.getByRole('button', { name: 'Undo: Power left out' }).click();
  await expect(fixes).toHaveCount(0);
  await expect(cell(page, 'Normalized power')).toContainText('W');
  // Trim: drag the start on the chart, then type the times. The numbers are worked out from the part kept.
  await page.locator('details.fix-trim > summary').click();
  const chart = page.locator('.trim-chart');
  await expect(chart).toBeVisible();
  // Brought to the middle of the screen, as a rider would, so the phone's bar along the bottom is not over it.
  await chart.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const b = (await chart.boundingBox())!;
  const y = b.y + b.height / 2;
  if (info.project.name.startsWith('phone')) {
    // A finger, not a mouse: the press, the slide and the lift as a touch screen reports them.
    const touch = (type: string, x: number) => chart.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: y });
    await touch('pointerdown', b.x + b.width * 0.02);
    for (const f of [0.06, 0.1, 0.15, 0.2]) await touch('pointermove', b.x + b.width * f);
    await touch('pointerup', b.x + b.width * 0.2);
  } else {
    await page.mouse.move(b.x + b.width * 0.02, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, y, { steps: 5 });
    await page.mouse.up();
  }
  const from = page.getByLabel('Keep from this time into the recording');
  await expect(from).not.toHaveValue('0:00');
  await from.fill('5:00');
  await page.getByLabel('Keep to this time into the recording').fill('40:00');
  await looksRight(s, info, 'Trimming: the two ends set');
  await page.getByRole('button', { name: 'Trim to this part' }).click();
  await expect(fixes).toContainText('Trimmed to the part from 5:00 to 40:00 of the recording');
  await expect(cell(page, 'Moving time')).toHaveText('35:00');
  await expect(page.getByRole('heading', { name: 'The recording' })).toBeVisible();
  await looksRight(s, info, 'An activity trimmed');
  // Download offers the trimmed activity or the original file.
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const dl = page.getByRole('dialog', { name: /^Download/ });
  await expect(dl.getByText('The trimmed activity')).toBeVisible();
  await expect(dl.getByText('The original file', { exact: true })).toBeVisible();
  await looksRight(s, info, 'Download: trimmed, or the original');
  await dl.getByRole('button', { name: 'Cancel' }).click();
  await fixes.getByRole('button', { name: 'Restore the whole recording' }).click();
  await expect(fixes).toHaveCount(0);
  await expect(cell(page, 'Moving time')).toHaveText('50:00');
  // When it started: a day earlier. The page, the list and the Calendar follow.
  await page.locator('details.fix-start > summary').click();
  await page.getByLabel('Date and time the activity started').fill(`${dayAgo(3)}T18:30`);
  await page.locator('.fix-start').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(fixes).toContainText('Start moved to');
  await expect(page.locator('details.fix-start > summary')).toContainText('moved by you');
  await looksRight(s, info, 'An activity with its start moved');
  await fixes.getByRole('button', { name: /^Undo: Start moved/ }).click();
  await expect(fixes).toHaveCount(0);
  await expect(page.locator('details.fix-start > summary')).not.toContainText('moved by you');
  await looksRight(s, info, 'The activity, every correction undone');
});
