import { defineConfig, devices } from '@playwright/test';

/**
 * The pictures in Help (25 Nov 2026): the app's own pages, opened as each version of the app, at a computer's, an
 * iPhone's and an iPad's size, with a made-up rider. Run with `npm run help:shots` after anything a picture shows
 * has changed; the pictures are kept in public/help, and a test fails if Help asks for one that is not there.
 */
const chrome = process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

export default defineConfig({
  testDir: 'shots',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 3,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173/ride/', serviceWorkers: 'block', colorScheme: 'dark', ...devices['Desktop Chrome'], ...chrome },
  projects: [
    { name: 'computer', use: { ...devices['Desktop Chrome'], ...chrome, colorScheme: 'dark', viewport: { width: 1280, height: 800 } }, metadata: { app: 'mac', width: 1100 } },
    { name: 'iphone', use: { ...devices['Desktop Chrome'], ...chrome, colorScheme: 'dark', viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, metadata: { app: 'ios', width: 600 } },
    { name: 'ipad', use: { ...devices['Desktop Chrome'], ...chrome, colorScheme: 'dark', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, hasTouch: true, userAgent: IPAD }, metadata: { app: 'ios', width: 900 } },
  ],
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/ride/', reuseExistingServer: true, timeout: 60_000 },
});
