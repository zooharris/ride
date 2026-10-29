import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME, APP_SHORT_NAME } from './src/appName';

// One build time for the app and for version.json, the file the app checks to know a newer build is published.
const BUILD = new Date().toISOString();

// Served from https://<user>.github.io/ride/ — the base must match the repo name.
export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  base: '/ride/',
  plugins: [
    preact(),
    { name: 'version-json', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }); } },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: 'Adaptive cycling training and fitness. Better rides. Fitter you.',
        theme_color: '#0A1220',
        background_color: '#0A1220',
        display: 'standalone',
        orientation: 'any',
        start_url: '/ride/',
        scope: '/ride/',
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
        navigateFallback: '/ride/index.html',
        // Map tiles already seen stay available offline for a month.
        runtimeCaching: [{
          urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
          handler: 'CacheFirst',
          options: { cacheName: 'map-tiles', expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600 } },
        }],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
