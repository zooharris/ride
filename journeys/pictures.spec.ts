import { test } from '@playwright/test';
import { go, makePlan, setUp } from './rider';
import type { RiderKind } from './standin';

/**
 * Pictures of Insights and the Lab for the three made-up riders (27 Nov 2026), for the build's report. Not a check:
 * it runs only when asked for (PICTURES=1), and writes into pictures/.
 */
const PAGES: Array<[string, string]> = (process.env.PICTURE_PAGES ?? 'lab').split(',').map((p) => [p.replace(/[^a-z0-9]+/gi, '-'), `#/${p}`]);

for (const kind of ['power', 'hr', 'new'] as RiderKind[]) {
  test(`pictures: ${kind}`, async ({ page }, info) => {
    test.skip(!process.env.PICTURES, 'pictures are taken only when asked for');
    test.setTimeout(240_000);
    await setUp(page, kind);
    if (kind === 'power' && process.env.PICTURE_PLAN) await makePlan(page);
    for (const [name, hash] of PAGES) {
      await go(page, hash);
      await page.waitForTimeout(Number(process.env.PICTURE_WAIT ?? 1500));
      await page.screenshot({ path: `pictures/${info.project.name}/${kind}-${name}.png`, fullPage: true });
    }
  });
}
