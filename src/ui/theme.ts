import { getSetting, setSetting } from '../data/db';
import { activeSeason, deviceTimeZone, guessHemisphere, seasonVars, statusBarColour, type Hemisphere, type Season, type SeasonChoice } from './season';

/**
 * Light or dark. "system" follows the device; the choice is stored per device
 * (it is a setting like any other, so it also travels with the sync, which is
 * what a rider who set it on the laptop would expect on the phone).
 *
 * The season (Obsidian, 12 Nov 2026) is a second choice beside it: Automatic by
 * date, or one season all year. Its colours are set on the page root here, so
 * they apply before the first render and change at once with light or dark.
 */
export type ThemeChoice = 'system' | 'dark' | 'light';
export type { SeasonChoice, Hemisphere, Season } from './season';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;
let choice: ThemeChoice = 'system';
let seasonChoice: SeasonChoice = 'auto';
let hemisphere: Hemisphere | null = null;   // null: not set by the rider, use the time-zone guess
const listeners = new Set<(t: 'dark' | 'light') => void>();
const SEASON_VALUES: SeasonChoice[] = ['auto', 'spring', 'summer', 'autumn', 'winter'];

export function resolvedTheme(): 'dark' | 'light' {
  return choice === 'system' ? (media?.matches ? 'light' : 'dark') : choice;
}

export function getHemisphere(): Hemisphere { return hemisphere ?? guessHemisphere(deviceTimeZone()); }
export function currentSeason(): Season { return activeSeason(seasonChoice, getHemisphere()); }

let applied = '';
function apply(force = false): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const t = resolvedTheme();
  const season = currentSeason();
  const key = t + season;
  root.style.colorScheme = t;
  root.setAttribute('data-season', season);
  if (force || key !== applied) {
    const vars = seasonVars(season, t);
    for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
    applied = key;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', statusBarColour(t));   // the phone's status bar sits over the graphite top bar
  listeners.forEach((l) => l(t));
}

/** Called once before the first render, so the page never flashes the wrong theme. */
export function initTheme(): void {
  // The last choices are mirrored in localStorage so they apply before IndexedDB answers.
  try {
    const c = localStorage.getItem('theme') as ThemeChoice | null; if (c === 'dark' || c === 'light' || c === 'system') choice = c;
    const s = localStorage.getItem('season') as SeasonChoice | null; if (s && SEASON_VALUES.includes(s)) seasonChoice = s;
    const h = localStorage.getItem('hemisphere'); if (h === 'north' || h === 'south') hemisphere = h;
  } catch { /* private mode */ }
  apply(true);
  media?.addEventListener('change', () => { if (choice === 'system') apply(); });
  // A rider who leaves the app open over a season's first day sees the new season the next time they look.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') apply(); });
  window.addEventListener('focus', () => apply());
  getSetting<ThemeChoice>('theme', choice).then((c) => { if (c !== choice) { choice = c; remember(); apply(); } }).catch(() => {});
  getSetting<SeasonChoice>('season', seasonChoice).then((s) => { if (SEASON_VALUES.includes(s) && s !== seasonChoice) { seasonChoice = s; remember(); apply(); } }).catch(() => {});
  getSetting<Hemisphere | null>('hemisphere', hemisphere).then((h) => { if ((h === 'north' || h === 'south' || h === null) && h !== hemisphere) { hemisphere = h; remember(); apply(); } }).catch(() => {});
}

function remember(): void {
  try {
    localStorage.setItem('theme', choice);
    localStorage.setItem('season', seasonChoice);
    if (hemisphere) localStorage.setItem('hemisphere', hemisphere); else localStorage.removeItem('hemisphere');
  } catch { /* private mode */ }
}

export function getThemeChoice(): ThemeChoice { return choice; }
export function getSeasonChoice(): SeasonChoice { return seasonChoice; }

export async function setThemeChoice(c: ThemeChoice): Promise<void> {
  choice = c;
  remember();
  apply();
  await setSetting('theme', c);
}

export async function setSeasonChoice(s: SeasonChoice): Promise<void> {
  seasonChoice = s;
  remember();
  apply();
  await setSetting('season', s);
}

export async function setHemisphere(h: Hemisphere): Promise<void> {
  hemisphere = h;
  remember();
  apply();
  await setSetting('hemisphere', h);
}

/** For the few things drawn outside CSS (map tiles, the route line) that must redraw when the theme or season changes. */
export function onThemeChange(fn: (t: 'dark' | 'light') => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A CSS custom property's current value, for libraries that need a literal colour. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
