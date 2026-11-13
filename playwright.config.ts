import { defineConfig, devices } from '@playwright/test';

/**
 * Whole-journey tests (13 Nov 2026, item 16): the app used as a rider would, on the built site, with a stand-in for
 * Intervals.icu and no network beyond it. Run with `npm run journeys` after `npm run build`; the deploy runs them on
 * every build and publishes nothing when one fails.
 */
const chrome = process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {};
const sizes = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true },
  laptop: { viewport: { width: 1280, height: 800 } },
} as const;

export default defineConfig({
  testDir: 'journeys',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'journeys-report' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/ride/',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    ...chrome,
  },
  // Four of the six size-and-light pairs: enough to catch a page wider than a phone, a dark-mode
  // problem and a laptop layout, without doubling the run.
  projects: ([['phone', 'dark'], ['tablet', 'light'], ['laptop', 'light'], ['laptop', 'dark']] as const).map(([size, scheme]) => ({
    name: `${size}-${scheme === 'light' ? 'day' : 'night'}`,
    use: { ...devices['Desktop Chrome'], ...chrome, ...sizes[size], colorScheme: scheme },
  })),
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/ride/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
