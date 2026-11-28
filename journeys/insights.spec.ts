import { expect, test } from '@playwright/test';
import { go, looksRight, makePlan, setUp } from './rider';

/**
 * Insights (27 Nov 2026): the questions that apply to the rider, each answered with how strong the evidence is; the
 * page that explains an answer; the way down to the Lab and back up; and riders the questions must not assume
 * things about (no power meter, no plan, nothing recorded).
 */

test('Insights for a rider with power: the questions, an explanation with its evidence, down to the Lab and back up', async ({ page }, info) => {
  test.setTimeout(180_000);
  const s = await setUp(page, 'power');
  await go(page, '#/insights');
  await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();
  // Always asked: fitter, ready, riding enough; with a power meter, strengths and limiters. No plan: the mix, never the plan.
  for (const q of ['fitter', 'ready', 'profile', 'enough', 'mix', 'health']) await expect(page.locator(`.in-card[data-question="${q}"]`)).toBeVisible();
  for (const q of ['plan', 'event', 'goal']) await expect(page.locator(`.in-card[data-question="${q}"]`)).toHaveCount(0);
  const fitter = page.locator('.in-card[data-question="fitter"]');
  await expect(fitter.locator('.in-ask')).toHaveText('Am I getting fitter?');
  await expect(fitter.locator('.in-conf')).toContainText(/Evidence: (clear|likely|mixed)/);
  await expect(fitter.locator('.in-mt i')).toHaveCount(3);
  await looksRight(s, info, 'Insights');
  // The explanation: the answer, the strength as a sentence with its reason, the evidence, the fuller picture.
  await fitter.click();
  await expect(page).toHaveURL(/#\/insights\/fitter/);
  await expect(page.getByRole('heading', { name: 'Am I getting fitter?', level: 1 })).toBeVisible();
  await expect(page.locator('.in-sure')).toContainText(/This conclusion is (clear|likely, not certain):|The evidence is mixed:/);
  await expect(page.locator('.in-ev-k').first()).toContainText('Supporting evidence 1');
  await expect(page.locator('[data-picture="built"]')).toContainText('What built your fitness');
  await expect(page.locator('[data-picture="built"]')).toContainText('How to read this');
  await looksRight(s, info, 'Insights, why Antogo says so');
  // "See the data" goes down to the matching Lab chart; "What does this mean?" comes back up.
  await page.locator('.in-ev .in-see').first().click();
  await expect(page).toHaveURL(/#\/lab\/chart\/fitness/);
  await page.getByRole('link', { name: /What does this mean\?/ }).click();
  await expect(page).toHaveURL(/#\/insights\/fitter/);
  // A piece of evidence that rests on a measure opens that measure large in the Lab.
  await go(page, '#/insights/enough');
  await page.locator('.in-ev[data-evidence="who"] .in-see').click();
  await expect(page).toHaveURL(/#\/lab\/family\/volume\?big=weekHours/);
  await expect(page.getByRole('dialog').first()).toContainText('Hours trained, each week');
  // A direct path to the Lab from the first screen.
  await go(page, '#/insights');
  await page.getByRole('link', { name: 'The Lab: every chart and measure' }).click();
  await expect(page).toHaveURL(/#\/lab/);
});

test('Insights with a plan: the plan is asked about, the mix is not, and the weeks are set against the plan', async ({ page }, info) => {
  test.setTimeout(180_000);
  const s = await setUp(page, 'power');
  await makePlan(page);
  await go(page, '#/insights');
  await expect(page.locator('.in-card[data-question="plan"]')).toBeVisible();
  await expect(page.locator('.in-card[data-question="mix"]')).toHaveCount(0);
  // A plan made today has nothing come due: too early, with what is needed, and no guess.
  await expect(page.locator('.in-card[data-question="plan"]')).toHaveAttribute('data-strength', 'early');
  await page.locator('.in-card[data-question="plan"]').click();
  await expect(page.locator('.in-sure')).toContainText('It is too early to conclude:');
  await expect(page.getByText('What Antogo needs')).toBeVisible();
  await expect(page.locator('.in-ev-k', { hasText: /evidence/ })).toHaveCount(0);
  await looksRight(s, info, 'Insights, too early');
});

test('Insights for a rider by heart rate: no question that needs power, and the reason at the foot', async ({ page }, info) => {
  const s = await setUp(page, 'hr');
  await go(page, '#/insights');
  await expect(page.locator('.in-card[data-question="fitter"]')).toBeVisible();
  await expect(page.locator('.in-card[data-question="profile"]')).toHaveCount(0);
  await expect(page.locator('[data-not-shown="profile"]')).toContainText('It needs a power meter');
  await looksRight(s, info, 'Insights, a rider without power');
  await go(page, '#/insights/fitter');
  await expect(page.locator('.in-ev-k').first()).toContainText('indirect');
  // The question that does not apply says why, if its address is opened.
  await go(page, '#/insights/profile');
  await expect(page.getByText('It needs a power meter')).toBeVisible();
});

test('Insights for a new rider: every answer too early, with what is needed, and nothing drawn', async ({ page }, info) => {
  const s = await setUp(page, 'new');
  await go(page, '#/insights');
  await expect(page.locator('.in-card')).not.toHaveCount(0);
  await expect(page.locator('.in-card:not(.early)')).toHaveCount(0);
  await expect(page.locator('.in-card svg')).toHaveCount(0);
  await expect(page.locator('.in-card[data-question="fitter"]')).toContainText('Too early to say.');
  await expect(page.locator('.in-card[data-question="fitter"]')).toContainText('six weeks');
  await looksRight(s, info, 'Insights, a new rider');
});

test('today\'s Progress page is still there, as it was', async ({ page }, info) => {
  const s = await setUp(page, 'power');
  await go(page, '#/progress');
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  await expect(page.locator('#fitness-card')).toBeVisible();
  await expect(page.locator('.pg-cell')).not.toHaveCount(0);
  await looksRight(s, info, 'Progress, unchanged');
});
