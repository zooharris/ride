import { expect, test, type Page } from '@playwright/test';
import { go, looksRight, makePlan, setUp, type Session } from './rider';

/**
 * 22 Nov 2026: an activity's Numbers as compact cells; its chart opened large with the Show chips and a lap picked;
 * Plan my training's "What your data say" without a plan, with one, and with lines that have moved since it was built.
 */

/** Change the plans on this device as another device or an older build would have left them. */
async function editPlans(page: Page, how: 'started' | 'older'): Promise<void> {
  await page.evaluate(async (mode) => {
    await new Promise<void>((done, fail) => {
      const req = indexedDB.open('ride');
      req.onerror = () => fail(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('plans', 'readwrite');
        const store = tx.objectStore('plans');
        const all = store.getAll();
        all.onsuccess = () => {
          const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
          for (const p of all.result as Array<{ start: string; updatedAt?: string; findings?: { date: string; lines: Array<{ key: string; note: string; figure: unknown; confidence: string }>; limiters?: string[] } }>) {
            p.updatedAt = new Date(Date.now() + 60_000).toISOString();
            if (mode === 'started') { p.start = day(-1); store.put(p); continue; }
            if (!p.findings) continue;
            p.findings.date = day(-30);
            const h = p.findings.lines.find((l) => l.key === 'weeklyHours')!;
            h.note = 'About 3.5 hours of riding a week (4 hours of training in all) over the last four weeks.'; h.figure = [3.5, 4]; h.confidence = 'thin';
            const f = p.findings.lines.find((l) => l.key === 'ftpStatus')!;
            f.note = 'No hard efforts in six weeks, so the FTP in use is unverified; a test early in the plan is worth it.'; f.figure = 'stale';
            p.findings.limiters = ['vo2max', 'anaerobic'];
            store.put(p);
          }
        };
        tx.oncomplete = () => done();
        tx.onerror = () => fail(tx.error);
      };
    });
  }, how);
}

/** Open the first activity in the list whose row says `kind` (a ride when none is given). */
async function openActivity(page: Page, name: RegExp): Promise<void> {
  await go(page, '#/rides');
  await page.locator('a[href*="#/rides/"]').filter({ hasText: name }).first().click();
  await expect(page.getByRole('heading', { name: 'Numbers' })).toBeVisible();
}

async function readNumbers(s: Session, info: Parameters<typeof looksRight>[1], what: string, groups: string[]): Promise<void> {
  const { page } = s;
  const numbers = page.locator('.numgrid');
  for (const g of groups) await expect(numbers.getByRole('heading', { name: g, exact: true })).toBeVisible();
  // Nothing in a cell is cut short: every value fits its cell.
  const cut = await numbers.locator('.ng-value').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  expect(cut, `${what}: values cut short`).toEqual([]);
  await numbers.scrollIntoViewIfNeeded();
  await looksRight(s, info, `Numbers for ${what}`);
}

test('an activity\'s Numbers, for a ride, a walk and a strength session; an "i" opens and closes', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await openActivity(page, /Long ride|Endurance|Intervals/);
  await readNumbers(s, info, 'a ride', ['Time and distance', 'Power', 'Heart rate']);
  // An explanation behind an "i": a second tap closes it, as do Escape and a tap elsewhere.
  const i = page.getByRole('button', { name: 'What moving time means' });
  await i.click();
  await expect(page.getByRole('note')).toContainText('Time pedalling, stops excluded');
  await looksRight(s, info, 'An explanation open');
  await i.click();
  await expect(page.getByRole('note')).toHaveCount(0);
  await i.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note')).toHaveCount(0);
  await i.click();
  await page.getByRole('heading', { name: 'Numbers' }).click();
  await expect(page.getByRole('note')).toHaveCount(0);
  await openActivity(page, /walk/i);
  await readNumbers(s, info, 'a walk', ['Time and distance', 'Heart rate']);
  await openActivity(page, /Strength/);
  await readNumbers(s, info, 'a strength session', ['Time and distance', 'Heart rate']);
});

test('an activity\'s chart opened large: each Show chip on and off, smoothing, a lap picked', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await openActivity(page, /Long ride|Endurance|Intervals/);
  await page.getByRole('button', { name: 'Open power large' }).click();
  const large = page.getByRole('dialog');
  await expect(large).toBeVisible();
  const show = large.getByRole('group', { name: 'Show' });
  const laps = show.getByRole('button', { name: 'Laps and steps' });
  const zones = show.getByRole('button', { name: 'Zones' });
  // Laps start on, zones off.
  await expect(laps).toHaveAttribute('aria-pressed', 'true');
  await expect(zones).toHaveAttribute('aria-pressed', 'false');
  await expect(large.locator('.lv-lap').first()).toBeVisible();
  await looksRight(s, info, 'Large, laps and steps on');
  await laps.click();
  await expect(large.locator('.lv-lap')).toHaveCount(0);
  await laps.click();
  await zones.click();
  await expect(large.locator('.lv-zone').first()).toBeAttached();
  await expect(large.getByRole('heading', { name: /^Time in power zones/ })).toBeVisible();
  await looksRight(s, info, 'Large, zones on');
  await zones.click();
  await expect(large.locator('.lv-zone')).toHaveCount(0);
  // Smoothing for power, said in the panel.
  await large.getByRole('group', { name: 'Power smoothing' }).getByRole('button', { name: '30 seconds' }).click();
  await expect(large.getByText('Power\'s low and high are from 30-second power; its average is always from the recording.')).toBeVisible();
  // A lap: the window moves to it, and back.
  await large.getByRole('button', { name: /^Look at just / }).first().click();
  await expect(large.getByRole('button', { name: 'Whole activity' })).toBeVisible();
  await expect(large.getByRole('heading', { name: 'Over this part' })).toBeVisible();
  await looksRight(s, info, 'Large, one lap');
  await large.getByRole('button', { name: 'Whole activity' }).click();
  await expect(large.getByRole('heading', { name: 'Over the whole activity' })).toBeVisible();
  // No AI is connected: no coach, and nothing missing.
  await expect(large.locator('.lv-coach')).toHaveCount(0);
  // What was chosen is remembered on the device.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open power large' }).click();
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Power smoothing' }).getByRole('button', { name: '30 seconds' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
});

test('Plan my training: today\'s findings without a plan, with one, and what has moved since it was built', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await go(page, '#/plan');
  await expect(page.getByText(/^As of today, /)).toBeVisible();
  await expect(page.getByText('Worked out from your rides and wellness as they stand today.', { exact: false })).toBeVisible();
  await expect(page.getByText('What this plan was built on', { exact: false })).toHaveCount(0);
  await looksRight(s, info, 'Plan my training, no plan');
  await makePlan(page);
  // The plan covers today (its first session may be tomorrow; it is moved to have begun yesterday).
  await editPlans(page, 'started');
  await page.reload();
  await go(page, '#/plan');
  await expect(page.getByText(/^What this plan was built on, /)).toBeVisible();
  // Built today on today's findings: nothing has moved.
  await expect(page.getByText(/^When the plan was built \(/)).toHaveCount(0);
  // The plan as if built a month ago on different findings, as an older device would have it.
  await editPlans(page, 'older');
  await page.reload();
  await go(page, '#/plan');
  await expect(page.getByText(/^When the plan was built \(.+\): About 3\.5 hours of riding a week/)).toBeVisible();
  await expect(page.getByText(/^When the plan was built \(.+\): No hard efforts in six weeks, so the FTP in use was unverified/)).toBeVisible();
  await expect(page.getByText(/^When the plan was built, the first limiter was top-end aerobic power \(VO2max\)\. Check the plan/)).toBeVisible();
  await page.getByText(/^What this plan was built on, /).click();
  await expect(page.locator('.built-on')).toContainText('Limiter worked on first: top-end aerobic power (VO2max), then short, sharp power.');
  await page.locator('.built-on').scrollIntoViewIfNeeded();
  await looksRight(s, info, 'Plan my training, lines that moved');
});
