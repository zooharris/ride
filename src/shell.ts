import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SavedGarminKey } from './sync/garminPersonal';
import { chooserBus } from './player/ble/chooserBus';
import { installNativeBluetooth, type NativeBluetooth } from './player/ble/native';

/**
 * Antogo as an installed app (23 Nov 2026; iPhone and iPad from 24 Nov). The same pages run in a browser and inside
 * the app; the app's own side offers a few things a web page may not do: asking Garmin with the rider's personal key,
 * and keeping that key in the device's password store. Everything here is absent in a browser, and the pages say so
 * plainly where it matters.
 *
 * On the Mac the app's own side is the desktop shell (desktop/preload.cjs). On iPhone and iPad it is Antogo's own small
 * native plugin inside the iOS shell (ios/App/App/AntogoNative.swift), wrapped below in the same shape, so the pages
 * use one interface for both.
 */
interface AppSide {
  kind: 'mac' | 'ios';
  garminFetch(url: string, init?: NetInit): Promise<NetReply>;
  keyCan(): Promise<boolean>;
  keyRead(): Promise<SavedGarminKey | null>;
  keySave(key: string, expires?: string): Promise<SavedGarminKey>;
  keyForget(): Promise<boolean>;
  /** True when a key is kept but this copy of the app cannot read it (an older, unsigned copy sealed it). */
  keyUnreadable?(): Promise<boolean>;
  onBluetooth?(fn: (found: FoundDevice[]) => void): void;
  chooseBluetooth?(id: string): Promise<boolean>;
  /** Mac: open the full list of the engine's (Chromium's) licences in the rider's browser. */
  openEngineNotices?(): Promise<boolean>;
  /** iPhone and iPad: hand files to the system's share and save sheet. False when the rider closed it without saving. */
  shareFiles?(files: Array<{ name: string; mime: string; data: Uint8Array }>): Promise<boolean>;
  /** iPhone and iPad: ask one of the services the rider connects (Intervals.icu, Garmin, their AI) through the app's own side. */
  serviceFetch?(url: string, init?: NetInit): Promise<NetReply>;
  /** iPhone and iPad: keep the screen on (a ride in progress), or let it dim again. */
  keepAwake?(on: boolean): Promise<void>;
}
interface NetInit { method?: string; headers?: Record<string, string>; body?: Uint8Array }
interface NetReply { status: number; type: string; body: Uint8Array }
/** A Bluetooth device the app's search has found. */
export interface FoundDevice { id: string; name: string }

// ---- iPhone and iPad: the native plugin, in the app's own shape ----------------------------------------------------

interface NativePlugin extends NativeBluetooth {
  keepAwake(o: { on: boolean }): Promise<void>;
  fetch(o: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; type: string; body: string }>;
  keyRead(): Promise<{ saved?: string }>;
  keySave(o: { saved: string }): Promise<void>;
  keyForget(): Promise<void>;
  share(o: { files: Array<{ name: string; data: string }> }): Promise<{ completed: boolean }>;
}

const b64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let iosSide: AppSide | null | undefined;
function iOS(): AppSide | null {
  if (iosSide !== undefined) return iosSide;
  iosSide = null;
  try {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return null;
  } catch { return null; }
  const plugin = registerPlugin<NativePlugin>('AntogoNative');
  // The iPhone's Bluetooth, offered to the player in the shape a browser's has (25 Nov 2026).
  installNativeBluetooth(plugin);
  const ask = async (url: string, init?: NetInit): Promise<NetReply> => {
    const r = await plugin.fetch({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body ? { body: b64(init.body) } : {}) });
    return { status: r.status, type: r.type, body: r.body ? unb64(r.body) : new Uint8Array() };
  };
  const read = async (): Promise<SavedGarminKey | null> => {
    const r = await plugin.keyRead();
    try { return r.saved ? (JSON.parse(r.saved) as SavedGarminKey) : null; } catch { return null; }
  };
  iosSide = {
    kind: 'ios',
    garminFetch: ask,
    serviceFetch: ask,
    keyCan: async () => true,
    keyRead: read,
    keySave: async (key, expires) => {
      const saved: SavedGarminKey = { key: key.trim(), savedAt: new Date().toISOString(), ...(expires ? { expires } : {}) };
      await plugin.keySave({ saved: JSON.stringify(saved) });
      return saved;
    },
    keyForget: async () => { await plugin.keyForget(); return true; },
    shareFiles: async (files) => (await plugin.share({ files: files.map((f) => ({ name: f.name, data: b64(f.data) })) })).completed,
    // Antogo's own "Choose a device" list, fed by the app's search.
    onBluetooth: (fn) => chooserBus.watch(fn),
    chooseBluetooth: async (id) => chooserBus.pick(id),
    keepAwake: async (on) => { await plugin.keepAwake({ on }); },
  };
  return iosSide;
}

const side = (): AppSide | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { antogoApp?: AppSide }).antogoApp ?? iOS() ?? undefined;
};

/** True inside an installed app (Mac, iPhone or iPad), false in a browser. */
export const inApp = (): boolean => !!side();

/** Which installed app this is: the Mac's, or the iPhone and iPad one; null in a browser. */
export const appKind = (): 'mac' | 'ios' | null => side()?.kind ?? null;

/** What Antogo runs on, in words for the pages: "this computer" in the Mac app, "this iPhone" or "this iPad" in the iOS app, "this device" in a browser (which may be either). */
export const thisDevice = (): string => (appKind() === 'ios' ? (/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) ? 'this iPad' : 'this iPhone') : appKind() === 'mac' ? 'this computer' : 'this device');

/** Where the web version is published, and where the newest file of the Mac app is always found. */
export const WEB_ADDRESS = 'https://zooharris.github.io/ride/';
export const MAC_DOWNLOAD = 'https://github.com/zooharris/ride/releases/latest/download/Antogo.dmg';

/** A request's headers and body in the plain form the app's own side takes. FormData is turned into its bytes. */
async function netInit(init?: RequestInit): Promise<NetInit> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
  let body: Uint8Array | undefined;
  if (init?.body != null) {
    const r = new Response(init.body as BodyInit);
    const type = r.headers.get('content-type');
    if (type && !headers['content-type']) headers['content-type'] = type;
    body = new Uint8Array(await r.arrayBuffer());
  }
  return { method: init?.method, headers, ...(body ? { body } : {}) };
}
const asResponse = (r: NetReply): Response => {
  const empty = r.status === 204 || r.status === 304 || r.body.byteLength === 0;
  return new Response(empty ? null : new Blob([r.body as BlobPart]), { status: r.status, headers: r.type ? { 'content-type': r.type } : {} });
};

/** A fetch that asks Garmin through the app's own side, shaped like the browser's so the same code can use either. */
export const garminFetch: typeof fetch = async (input, init) => {
  const s = side();
  if (!s) throw new Error('Not in the app');
  return asResponse(await s.garminFetch(String(input), await netInit(init)));
};

/**
 * The fetch for the services a rider connects (Intervals.icu and their AI provider). In a browser and on the Mac it
 * is the page's own fetch, as before. On iPhone and iPad it goes through the app's own side, which reaches only those
 * services' addresses: an iOS app's pages have an address of their own that these services may not answer.
 */
export const serviceFetch: typeof fetch = async (input, init) => {
  const s = side();
  if (!s?.serviceFetch) return globalThis.fetch(input, init);
  return asResponse(await s.serviceFetch(String(input), await netInit(init)));
};

/** The Garmin key kept by the app's own side, in the device's password store. */
export const appKey = {
  can: (): Promise<boolean> => side()?.keyCan() ?? Promise.resolve(false),
  read: (): Promise<SavedGarminKey | null> => side()?.keyRead() ?? Promise.resolve(null),
  save: (key: string, expires?: string): Promise<SavedGarminKey> => side()!.keySave(key, expires),
  forget: async (): Promise<void> => { await side()?.keyForget(); },
  /** A key is kept, but this copy of the app can't read it: the rider pastes it once more. */
  unreadable: async (): Promise<boolean> => (await side()?.keyUnreadable?.().catch(() => false)) ?? false,
};

/** iPhone and iPad: whether files go to the system's share and save sheet through the app's own side. */
export const appSharesFiles = (): boolean => typeof side()?.shareFiles === 'function';
/** Hand files to the share and save sheet (iPhone and iPad app). False when the rider closed it without saving. */
export const appShareFiles = (files: Array<{ name: string; mime: string; data: Uint8Array }>): Promise<boolean> => side()!.shareFiles!(files);

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

/** iPhone and iPad: keep the screen on during a ride, and let it dim again after. Nothing to do elsewhere (the page asks the browser itself). */
export const appKeepAwake = (on: boolean): void => { void side()?.keepAwake?.(on).catch(() => undefined); };

/** The Mac app's engine notices: the full list of Chromium's licences, opened in the rider's browser. */
export const appNotices = {
  canOpenEngine: (): boolean => typeof side()?.openEngineNotices === 'function',
  openEngine: (): Promise<boolean> => side()?.openEngineNotices?.() ?? Promise.resolve(false),
};
