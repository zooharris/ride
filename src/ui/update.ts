/**
 * A new version of the app, downloaded and waiting. The service worker holds
 * it until the rider says Reload, so a sync never runs half on old code
 * without the rider knowing a newer version is there.
 */
let ready = false;
let apply: (() => void) | null = null;
const listeners = new Set<() => void>();

export function setUpdateReady(applyUpdate: () => void): void {
  ready = true;
  apply = applyUpdate;
  listeners.forEach((l) => l());
}
export function updateReady(): boolean { return ready; }
export function onUpdateReady(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function applyUpdate(): void {
  if (apply) { apply(); return; }
  // found by a check before its "ready" signal arrived: tell the waiting build to take over, then reload
  const waiting = registration?.waiting;
  if (waiting && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  location.reload();
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
  if (!registration) return ready;
  if (!force && Date.now() - lastCheck < 60_000) return ready;
  lastCheck = Date.now();
  try { await registration.update(); } catch { /* offline: try again later */ }
  // a found update takes a moment to install before the banner's signal arrives
  await new Promise((r) => setTimeout(r, 1500));
  return ready || !!registration.waiting;
}
