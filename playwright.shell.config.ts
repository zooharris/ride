import { defineConfig } from '@playwright/test';

/**
 * The installed app's own journeys (23 Nov 2026): the built pages run from inside the app, as a rider would use it.
 * Run after `npm run build`: on Linux with a screen to draw on (`xvfb-run -a npx playwright test -c playwright.shell.config.ts`).
 */
export default defineConfig({
  testDir: 'desktop',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'shell-report' }]] : 'list',
});
