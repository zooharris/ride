import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Hash routing: survives refresh, works on a static host, no server config.
 *
 * Every history entry the app makes is stamped with its place in the visit (`history.state.idx`),
 * so the app can tell a new page (a link, `go`) from a return (the browser's back or forward,
 * or a Back button), whether there is an app page behind this one, and which scroll position
 * belongs to the entry being returned to (8 Nov 2026: Back returns to the page you left).
 */

type Nav = 'push' | 'back' | 'forward' | 'replace';
let current = 0;
let lastNav: Nav = 'push';
/** Scroll position of each entry of this visit, saved as it is left. */
const scrolls = new Map<number, number>();

const idxOf = (s: unknown): number | undefined => (s && typeof (s as { idx?: unknown }).idx === 'number' ? (s as { idx: number }).idx : undefined);

/** Called once at launch, after main.tsx has settled the first address: this entry is the visit's first. */
export function startHistory(): void {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  current = 0;
  history.replaceState({ ...(history.state ?? {}), idx: 0 }, '', location.href);
}

// Registered when the module loads, so it runs before any screen hears of the change (not under the tests, which have no window).
if (typeof window !== 'undefined') addEventListener('hashchange', () => {
  const idx = idxOf(history.state);
  if (idx === undefined) {
    // A new entry (a link or `go`): it sits one past the entry it was made from.
    scrolls.set(current, window.scrollY);
    current += 1;
    history.replaceState({ ...(history.state ?? {}), idx: current }, '', location.href);
    lastNav = 'push';
  } else if (idx === current) {
    lastNav = 'replace';
  } else {
    scrolls.set(current, window.scrollY);
    lastNav = idx < current ? 'back' : 'forward';
    current = idx;
  }
});

/** How the app arrived at the entry now showing, and the scroll saved for it when it was left. */
export function arrival(): { nav: Nav; scroll?: number } {
  return { nav: lastNav, scroll: lastNav === 'back' || lastNav === 'forward' ? scrolls.get(current) : undefined };
}

/** Whether an app page sits behind this one in the visit (a fresh tab or a launch has none). */
export function canGoBack(): boolean {
  return current > 0;
}

const norm = (path: string) => '/' + path.replace(/^#?\/?/, '');

export function useRoute(): { path: string; parts: string[]; params: URLSearchParams; raw: string } {
  const read = () => location.hash.replace(/^#\/?/, '') || 'today';
  const [raw, setRaw] = useState(read);
  useEffect(() => {
    const on = () => setRaw(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const [p, q] = raw.split('?');
  return { path: p, parts: p.split('/'), params: new URLSearchParams(q ?? ''), raw };
}

/** A new page. */
export function go(path: string): void {
  location.hash = norm(path);
}

/** The page this entry shows changes in place (a session moved to another date): Back still returns past it. */
export function replaceRoute(path: string): void {
  history.replaceState(history.state, '', `${location.pathname}${location.search}#${norm(path)}`);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Back to the page this one was opened from; with none behind it (a fresh tab), to `fallback`. */
export function goBack(fallback: string): void {
  if (canGoBack()) history.back();
  else go(fallback);
}

/** The current address's query. */
export function readQuery(): URLSearchParams {
  return new URLSearchParams(location.hash.split('?')[1] ?? '');
}

/**
 * Changes the current address's query without making a history entry: `set` values replace,
 * `undefined` removes, `drop` names keys to remove too. A screen's view (a filter, a tab, the month
 * shown) is kept this way, so Back to that screen finds it as it was left.
 */
export function replaceQuery(set: Record<string, string | undefined>, drop: string[] = []): void {
  const [p] = location.hash.replace(/^#\/?/, '').split('?');
  const q = readQuery();
  for (const k of drop) q.delete(k);
  for (const [k, v] of Object.entries(set)) { if (v === undefined || v === '') q.delete(k); else q.set(k, v); }
  const qs = q.toString();
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/${p}${qs ? `?${qs}` : ''}`);
}

/**
 * Keeps a screen's view in its address: after each change of `values` (not on the first render),
 * the query takes them, with defaults left out by the caller as `undefined`. Writes only while the
 * address is still the screen's own, so a change made as the rider leaves never lands on the next page.
 */
export function useUrlSync(values: Record<string, string | undefined>, drop: string[] = []): void {
  const first = useRef(true);
  const path = useRef(location.hash.split('?')[0]);
  const key = JSON.stringify(values);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (location.hash.split('?')[0] !== path.current) return;
    replaceQuery(values, drop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
