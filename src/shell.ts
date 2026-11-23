import type { SavedGarminKey } from './sync/garminPersonal';

/**
 * Antogo as an installed app (23 Nov 2026). The same pages run in a browser and inside the app; the app's own side
 * offers a few things a web page may not do: asking Garmin with the rider's personal key, and keeping that key in the
 * computer's password store. Everything here is absent in a browser, and the pages say so plainly where it matters.
 */
interface AppSide {
  kind: string;
  garminFetch(url: string, init?: { method?: string; headers?: Record<string, string> }): Promise<{ status: number; type: string; body: Uint8Array }>;
  keyCan(): Promise<boolean>;
  keyRead(): Promise<SavedGarminKey | null>;
  keySave(key: string, expires?: string): Promise<SavedGarminKey>;
  keyForget(): Promise<boolean>;
  onBluetooth?(fn: (found: FoundDevice[]) => void): void;
  chooseBluetooth?(id: string): Promise<boolean>;
}
/** A Bluetooth device the app's search has found. */
export interface FoundDevice { id: string; name: string }

const side = (): AppSide | undefined => (typeof window !== 'undefined' ? (window as unknown as { antogoApp?: AppSide }).antogoApp : undefined);

/** True inside the installed app, false in a browser. */
export const inApp = (): boolean => !!side();

/** Where the web version is published, and where the newest file of the Mac app is always found. */
export const WEB_ADDRESS = 'https://zooharris.github.io/ride/';
export const MAC_DOWNLOAD = 'https://github.com/zooharris/ride/releases/latest/download/Antogo.dmg';

/** A fetch that asks Garmin through the app's own side, shaped like the browser's so the same code can use either. */
export const garminFetch: typeof fetch = async (input, init) => {
  const s = side();
  if (!s) throw new Error('Not in the app');
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
  const r = await s.garminFetch(String(input), { method: init?.method, headers });
  const empty = r.status === 204 || r.status === 304 || r.body.byteLength === 0;
  return new Response(empty ? null : new Blob([r.body as BlobPart]), { status: r.status, headers: r.type ? { 'content-type': r.type } : {} });
};

/** The Garmin key kept by the app's own side, in the computer's password store. */
export const appKey = {
  can: (): Promise<boolean> => side()?.keyCan() ?? Promise.resolve(false),
  read: (): Promise<SavedGarminKey | null> => side()?.keyRead() ?? Promise.resolve(null),
  save: (key: string, expires?: string): Promise<SavedGarminKey> => side()!.keySave(key, expires),
  forget: async (): Promise<void> => { await side()?.keyForget(); },
};

/**
 * Choosing a Bluetooth device in the installed app (23 Nov 2026). A browser shows its own list; the app's own side
 * hands the devices it finds to the pages instead, again each time it finds more, and waits for one to be picked.
 */
export const appBluetooth = {
  /** Whether this app can show its own list (an older copy of the app's own side cannot). */
  can: (): boolean => typeof side()?.onBluetooth === 'function' && typeof side()?.chooseBluetooth === 'function',
  watch: (fn: (found: FoundDevice[]) => void): void => { side()?.onBluetooth?.(fn); },
  /** The device picked, by id; an empty id stops the search. */
  choose: (id: string): Promise<boolean> => side()?.chooseBluetooth?.(id) ?? Promise.resolve(false),
};
