/**
 * Asking the browser to keep this device's data for good (22 Nov 2026). A browser treats a site's storage as something
 * it may clear by itself when space runs short, or (Safari) when the site goes unused for a while, unless the site has
 * asked for it to be kept and the browser has agreed. Antogo holds the rider's record on the device, so it asks, and
 * says plainly in Settings whether the browser agreed.
 */
export interface KeepSafe { asked: boolean; kept: boolean | undefined; usedBytes?: number; roomBytes?: number }

/** Ask once per start; harmless to repeat. Resolves to whether the browser now keeps the data for good (undefined when it can't say). */
export async function askToKeep(): Promise<boolean | undefined> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return undefined;
    if (await s.persisted?.()) return true;
    return await s.persist();
  } catch { return undefined; }
}

export async function keepSafeState(): Promise<KeepSafe> {
  try {
    const s = navigator.storage;
    if (!s?.persisted) return { asked: false, kept: undefined };
    const kept = await s.persisted();
    const est = s.estimate ? await s.estimate() : undefined;
    return { asked: true, kept, usedBytes: est?.usage, roomBytes: est?.quota };
  } catch { return { asked: false, kept: undefined }; }
}
