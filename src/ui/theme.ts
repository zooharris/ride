import { getSetting, setSetting } from '../data/db';

/**
 * Light or dark. "system" follows the device; the choice is stored per device
 * (it is a setting like any other, so it also travels with the sync, which is
 * what a rider who set it on the laptop would expect on the phone).
 */
export type ThemeChoice = 'system' | 'dark' | 'light';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
let choice: ThemeChoice = 'system';
const listeners = new Set<(t: 'dark' | 'light') => void>();

export function resolvedTheme(): 'dark' | 'light' {
  return choice === 'system' ? (media?.matches ? 'light' : 'dark') : choice;
}

function apply(): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const t = resolvedTheme();
  root.style.colorScheme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#F4F6FA' : '#0A1220');
  listeners.forEach((l) => l(t));
}

/** Called once before the first render, so the page never flashes the wrong theme. */
export function initTheme(): void {
  // The last choice is mirrored in localStorage so it applies before IndexedDB answers.
  try { const c = localStorage.getItem('theme') as ThemeChoice | null; if (c === 'dark' || c === 'light' || c === 'system') choice = c; } catch { /* private mode */ }
  apply();
  media?.addEventListener('change', () => { if (choice === 'system') apply(); });
  getSetting<ThemeChoice>('theme', choice).then((c) => { if (c !== choice) { choice = c; remember(); apply(); } }).catch(() => {});
}

function remember(): void { try { localStorage.setItem('theme', choice); } catch { /* private mode */ } }

export function getThemeChoice(): ThemeChoice { return choice; }

export async function setThemeChoice(c: ThemeChoice): Promise<void> {
  choice = c;
  remember();
  apply();
  await setSetting('theme', c);
}

/** For the few things drawn outside CSS (map tiles, the route line) that must redraw when the theme changes. */
export function onThemeChange(fn: (t: 'dark' | 'light') => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A CSS custom property's current value, for libraries that need a literal colour. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
