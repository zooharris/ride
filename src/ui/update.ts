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
export function applyUpdate(): void { if (apply) apply(); else location.reload(); }
