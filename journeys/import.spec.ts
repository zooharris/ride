import { expect, test, type Page } from '@playwright/test';
import { go, looksRight, setUp } from './rider';
import { encodeFitActivity } from '../src/export/activityFiles';

/**
 * Stage 1 (22 Nov 2026): activity files brought in, the same file again (already here), a made-up whole-account
 * export with wellness, an imported activity on its page and on Progress, and an activity from the data service
 * whose numbers Antogo has worked out from its kept file.
 */

const T = Array.from({ length: 3000 }, (_, i) => i);
function fit(startIso: string): Buffer {
  return Buffer.from(encodeFitActivity({ id: 'x', date: startIso.slice(0, 10), startTime: startIso, name: 'R', type: 'Ride', sport: 'ride', seconds: 3000 } as never,
    { time: T, watts: T.map((i) => 190 + (i % 50)), heartrate: T.map(() => 138), cadence: T.map(() => 88), distance: T.map((i) => i * 8), velocity: T.map(() => 8), altitude: T.map((i) => 100 + (i % 400) / 10) }));
}
const daysAgo = (n: number, hour = 7) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(hour, 15, 0, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:15:00`; };

/** A stored ZIP of several entries. */
function zip(entries: Array<[string, Buffer]>): Buffer {
  const parts: Buffer[] = [], cds: Buffer[] = []; let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const l = Buffer.alloc(30 + n.length + data.length); l.writeUInt32LE(0x04034b50, 0); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26); n.copy(l, 30); data.copy(l, 30 + n.length);
    const c = Buffer.alloc(46 + n.length); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42); n.copy(c, 46);
    parts.push(l); cds.push(c); off += l.length;
  }
  const cd = Buffer.concat(cds); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

async function addFiles(page: Page, files: Array<{ name: string; buffer: Buffer }>) {
  await go(page, '#/rides');
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add activity files' });
  await sheet.getByLabel('Activity files', { exact: true }).setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/octet-stream' })));
  await expect(sheet.locator('.import-result')).toBeVisible({ timeout: 30_000 });
  return sheet;
}

test('bring in activity files: a new one, the same again, and an export with wellness', async ({ page }, info) => {
  const s = await setUp(page, 'hr');
  const one = { name: 'ride.fit', buffer: fit(daysAgo(2, 6)) };
  let sheet = await addFiles(page, [one]);
  await expect(sheet.locator('.import-result')).toContainText('1 new activity');
  await looksRight(s, info, 'Files brought in');
  await sheet.getByRole('button', { name: 'Close' }).click();
  // The same file again: already here.
  sheet = await addFiles(page, [{ ...one, name: 'ride again.fit' }]);
  await expect(sheet.locator('.import-result')).toContainText('0 new activities, 1 already here');
  await sheet.getByRole('button', { name: 'Close' }).click();
  // A made-up whole-account export: an activity inside its own archive, and days of wellness.
  const sleepDay = daysAgo(200).slice(0, 10);
  const exportZip = zip([
    ['DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip', zip([['9_ACTIVITY.fit', fit(daysAgo(3, 17))]])],
    ['DI_CONNECT/DI-Connect-Wellness/1_sleepData.json', Buffer.from(JSON.stringify([{ calendarDate: sleepDay, deepSleepSeconds: 5000, lightSleepSeconds: 16000, remSleepSeconds: 6000, sleepScores: { overallScore: 80 } }]))],
  ]);
  sheet = await addFiles(page, [{ name: 'my export.zip', buffer: exportZip }]);
  await expect(sheet.locator('.import-result')).toContainText(/1 new activity, 1 day of wellness/);
  await sheet.getByRole('button', { name: 'Close' }).click();
  // The activity brought in: its page, with Antogo's numbers.
  await page.locator('a[href*="#/rides/file-"]').first().click();
  await expect(page.locator('.numgrid')).toContainText('Worked out by Antogo');
  await expect(page.getByRole('heading', { name: 'The recording' })).toBeVisible();
  await looksRight(s, info, 'An activity brought in from its file');
  await go(page, '#/progress');
  await looksRight(s, info, 'Progress with activities brought in');
  // Each run is listed in Settings and can be undone: the export's activity and its day of wellness go, the first file's stays.
  page.on('dialog', (d) => void d.accept());
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^History/ }).click();
  const list = page.locator('.imports-list');
  await expect(list).toContainText('1 activity and 1 day of wellness');
  await expect(page.locator('.keep-safe')).toBeVisible();
  await looksRight(s, info, 'Files brought in, listed with Undo');
  await list.getByRole('button', { name: 'Undo bringing in my export.zip' }).click();
  await expect(list).not.toContainText('my export.zip');
  await go(page, '#/rides');
  await expect(page.locator('a[href*="#/rides/file-"]')).toHaveCount(1);
});

test('an activity from the data service, with its numbers worked out by Antogo from the kept file', async ({ page }, info) => {
  test.setTimeout(150_000);
  const s = await setUp(page, 'power');
  // The evening walk's file is kept a little after the sync; then its numbers change over.
  await go(page, '#/settings');
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.locator('.keeping')).toContainText(/Original files: [1-9]/, { timeout: 60_000 });
  await expect.poll(async () => {
    await go(page, '#/rides');
    await page.locator('a[href*="#/rides/"]').filter({ hasText: 'Evening walk' }).first().click();
    return page.locator('.numgrid').innerText();
  }, { timeout: 60_000, intervals: [3000] }).toContain('Worked out by Antogo');
  await looksRight(s, info, 'An activity on Antogo\'s numbers');
  // The temporary check page (by its address only): it compares, and copies.
  await go(page, '#/check-numbers');
  await expect(page.getByRole('heading', { name: "Check Antogo's numbers" })).toBeVisible();
  await expect(page.getByText(/Average heart rate: \d+ of \d+ agree|Average heart rate: none to compare/)).toBeVisible();
  await looksRight(s, info, 'The one-time check');
});
