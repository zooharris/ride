import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME, APP_SHORT_NAME } from './src/appName';
import { noticesPlugin } from './scripts/noticesPlugin';

// One build time for the app and for version.json, the file the app checks to know a newer build is published.
const BUILD = new Date().toISOString();

// Served from https://<user>.github.io/ride/ — the base must match the repo name.
// The preview (27 Nov 2026) is the same app built from the preview branch and served one folder down, with its own
// data store, so work in progress can be looked at in minutes without touching the public version.
const PREVIEW = !!process.env.ANTOGO_PREVIEW;
const BASE = PREVIEW ? '/ride/preview/' : '/ride/';
export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD), __PREVIEW__: JSON.stringify(PREVIEW) },
  base: BASE,
  plugins: [
    preact(),
    // Open-source notices for what this build ships; the build stops if a shipped licence isn't allowed (24 Nov 2026).
    noticesPlugin(),
    // Two files say which build is published (27 Nov 2026). web-version.json changes with every web publish and is what
    // the web version checks. version.json is what the installed Mac app checks to offer a newer app: a web-only publish
    // keeps the last release's copy of it, so the Mac app is told of a newer version only when there is a newer app.
    { name: 'version-json', generateBundle() { for (const fileName of ['version.json', 'web-version.json']) this.emitFile({ type: 'asset', fileName, source: JSON.stringify({ build: BUILD }) }); } },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: PREVIEW ? `${APP_NAME} Preview` : APP_NAME,
        short_name: PREVIEW ? 'Preview' : APP_SHORT_NAME,
        description: 'Adaptive cycling training and fitness. Better rides. Fitter you.',
        theme_color: '#141922',
        background_color: '#0B0E14',
        display: 'standalone',
        orientation: 'any',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // webp: the exercise pictures, so they show offline in a gym.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webp}'],
        // The app's own code is one file, kept whole so the app opens offline; it has grown past the tool's 2 MiB default.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Help's pictures come in three versions (computer, iPhone, iPad): a browser keeps the ones it has shown, not all of them.
        globIgnores: ['help/**'],
        navigateFallback: `${BASE}index.html`,
        // The public version must never answer for the preview's address.
        navigateFallbackDenylist: PREVIEW ? [] : [/^\/ride\/preview\//],
        // Map tiles already seen stay available offline for a month.
        runtimeCaching: [{
          urlPattern: /\/help\/[a-z-]+\.webp$/,
          handler: 'CacheFirst',
          options: { cacheName: 'help-pictures', expiration: { maxEntries: 60, maxAgeSeconds: 90 * 24 * 3600 } },
        }, {
          urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
          handler: 'CacheFirst',
          options: { cacheName: 'map-tiles', expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600 } },
        }],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
