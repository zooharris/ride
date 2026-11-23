import { appKey, garminFetch, inApp } from '../shell';
import { garminState, runGarmin, type GarminDeps, type GarminState } from './garminSource';

/** Garmin as a source, as the installed app runs it: asked through the app's own side, with the key from the computer's password store. */
export function garminDeps(): GarminDeps {
  return {
    fetch: garminFetch,
    key: async () => (await appKey.read().catch(() => null))?.key,
    changed: () => { void import('../ui/store').then((m) => m.notify()); },
    settle: () => import('./syncService').then((m) => m.startChangeOver()),
  };
}

/** Fetch now (the page's button, and the timers below). In a browser there is nothing to do. */
export function fetchGarmin(): Promise<GarminState> {
  return inApp() ? runGarmin(garminDeps()) : Promise.resolve(garminState());
}

const FIRST_MS = 15_000, EVERY_MS = 3 * 3600_000;
let started = false;
/** A little after the app opens, then every few hours while it is open. Only what is new is asked for. */
export function startGarmin(): void {
  if (started || !inApp()) return;
  started = true;
  setTimeout(() => { void fetchGarmin(); }, FIRST_MS);
  setInterval(() => { void fetchGarmin(); }, EVERY_MS);
}
