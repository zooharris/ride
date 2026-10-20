/**
 * A new version of the app, downloaded and waiting. The service worker holds
 * it until the rider says Reload, so a sync never runs half on old code
 * without the rider knowing a newer version is there.
 */
let ready = false;
const listeners = new Set<() => void>();

export function setUpdateReady(): void {
  ready = true;
  listeners.forEach((l) => l());
}
export function updateReady(): boolean { return ready; }
export function onUpdateReady(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
/**
 * Switch to the newest published version in one press. First ask the server
 * again, so a version published after the banner appeared is the one used, not
 * the one downloaded earlier; wait for it to finish installing; then tell it to
 * take over and reload once it has. Anything unexpected ends in a plain reload.
 */
let applying = false;
export async function applyUpdate(): Promise<void> {
  if (applying) return;
  applying = true;
  const reg = registration;
  const sw = navigator.serviceWorker;
  if (!reg || !sw) { await hardReload(); return; }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let found = false;
  const onFound = () => { found = true; };
  reg.addEventListener('updatefound', onFound);
  try { await reg.update(); } catch { /* offline: use what is already downloaded */ }
  // The browser announces a newer version a moment after the check returns; give it that moment,
  // then wait for the newest to finish installing so it, not an older waiting one, is used.
  for (let t = Date.now(); !found && !reg.installing && Date.now() - t < 2000;) await sleep(100);
  reg.removeEventListener('updatefound', onFound);
  for (let t = Date.now(); reg.installing && Date.now() - t < 10000;) await sleep(150);
  const waiting = reg.waiting;
  if (!waiting) { await hardReload(); return; }
  sw.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => { void hardReload(); }, 5000);   // in case the switch is never announced
}

/** When this copy of the app was built, in the rider's own time. */
export function buildTime(): string {
  const d = new Date(__BUILD__);
  return isNaN(d.getTime()) ? __BUILD__ : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

let registration: ServiceWorkerRegistration | null = null;
let lastCheck = 0;
export function setRegistration(r: ServiceWorkerRegistration): void { registration = r; }
/**
 * Ask the server whether a newer build is published. Runs at launch, every 15
 * minutes, and whenever the app comes back to the front (at most once a minute
 * then), so an update shows up when the rider returns rather than whenever a
 * background timer happens to fire. Resolves true if one is now waiting.
 */
export async function checkForUpdate(force = false): Promise<boolean> {
  if (!force && Date.now() - lastCheck < 60_000) return ready;
  lastCheck = Date.now();
  if (registration) {
    try { await registration.update(); } catch { /* offline: try again later */ }
    // a found update takes a moment to install before the banner's signal arrives
    await new Promise((r) => setTimeout(r, 1500));
  }
  // The second, independent check: the build the server publishes against this one. It catches a
  // browser whose service worker never noticed (an iPhone home-screen app resumed from the background).
  const published = await publishedBuild();
  if (!ready && published && published !== __BUILD__ && published > __BUILD__) setUpdateReady();
  return ready || !!registration?.waiting;
}

/** The build time of the newest published version, read past every cache; undefined offline. */
async function publishedBuild(): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    return ((await res.json()) as { build?: string }).build;
  } catch { return undefined; }
}

/**
 * The last resort when the usual switch cannot happen (no newer version waiting
 * although the server has one): forget the cached copy of the app and load it
 * fresh from the server. The app's own data (IndexedDB) is untouched.
 */
async function hardReload(): Promise<void> {
  const published = await publishedBuild();
  if (published && published !== __BUILD__) {
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister(); } catch { /* ignore */ }
    try { if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
    location.replace(`${location.pathname}?v=${encodeURIComponent(published)}${location.hash}`);
    return;
  }
  location.reload();
}
