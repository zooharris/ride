import { useEffect, useState } from 'preact/hooks';
import { workoutStats } from '../engine/workout';
import type { StrengthFocus, Workout } from '../engine/types';
import { INTENSITY_LABEL, PURPOSE_LABEL, tagsOf, type Intensity, type Purpose } from '../library/tags';
import { FOCUS_WORDS } from '../library/strengthSessions';
import { readQuery, useUrlSync } from './router';
import { libraryKey } from './favorites';

/**
 * The Library's filters, shared with every place a workout is chosen from a list: the Library
 * itself, Replace, and the Calendar's add picker (Batch 10 C). One implementation, so they cannot
 * drift apart. 9 Nov 2026 ("the Library grows up", Part B): browse rides by what they are for,
 * filter every kind by how hard, rides by whether they ride well outdoors, strength by body
 * focus, and any kind to the rider's favourites or what they did recently. All of it reads the
 * tags every workout carries (library/tags.ts).
 */

/** The purposes a ride can serve, in the order they're offered. */
export const RIDE_PURPOSES: Purpose[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2', 'anaerobic', 'mixed', 'test'];
export const INTENSITIES: Intensity[] = ['easy', 'moderate', 'hard', 'very-hard'];
const FOCI: StrengthFocus[] = ['legs', 'upper', 'full'];

export type Duration = 'all' | 'u60' | '60-90' | '90-120' | '120-180' | '180-240' | '240+';
export const DURATIONS: Array<[Duration, string, [number, number]]> = [
  ['all', 'Any length', [0, 1e9]], ['u60', 'Under 1 h', [0, 60]], ['60-90', '1–1½ h', [60, 90]], ['90-120', '1½–2 h', [90, 120]], ['120-180', '2–3 h', [120, 180]], ['180-240', '3–4 h', [180, 240]], ['240+', '4 h and up', [240, 1e9]],
];
export type SortKey = 'family' | 'short' | 'long';
export type Show = 'all' | 'favorites' | 'recent';
export interface Filters {
  query: string;
  purpose: Purpose | 'all';
  intensity: Intensity | 'all';
  /** Rides only: just those that ride well outdoors on a bike computer. */
  outdoor: boolean;
  /** Strength only. */
  focus: StrengthFocus | 'all';
  show: Show;
  duration: Duration;
  sort: SortKey;
}
export const NO_FILTERS: Filters = { query: '', purpose: 'all', intensity: 'all', outdoor: false, focus: 'all', show: 'all', duration: 'all', sort: 'family' };

/** What the rider has starred, and when each workout was last done (Library id → YYYY-MM-DD). */
export interface Mine { favorites: Set<string>; recent: Map<string, string> }
const NOBODY: Mine = { favorites: new Set(), recent: new Map() };

/** A workout's length in minutes: a ride from its steps, anything else from its stated minutes. */
export const minutesOf = (w: Workout): number => (w.kind === 'ride' ? workoutStats(w.blocks).seconds / 60 : (w.minutes ?? 0));

/**
 * The filters applied to a list of workouts of one kind: favourites or recent, search (name,
 * subtitle, purpose, description), purpose (rides), intensity, outdoors (rides), body focus
 * (strength), length band, then the order. Recently done lists the most recent first unless
 * the rider asked for an order by length.
 */
export function applyFilters(list: Workout[], f: Filters, kind: string, mine: Mine = NOBODY): Workout[] {
  const q = f.query.trim().toLowerCase();
  const [lo, hi] = DURATIONS.find((d) => d[0] === f.duration)![2];
  const kept = list.filter((w) => {
    const t = tagsOf(w);
    const key = libraryKey(w);
    if (f.show === 'favorites' && !mine.favorites.has(key)) return false;
    if (f.show === 'recent' && !mine.recent.has(key)) return false;
    const m = minutesOf(w);
    if (m < lo || m >= hi) return false;
    if (kind === 'ride' && f.purpose !== 'all' && t.purpose !== f.purpose) return false;
    if (f.intensity !== 'all' && t.intensity !== f.intensity) return false;
    if (kind === 'ride' && f.outdoor && t.outdoor !== 'well') return false;
    if (kind === 'strength' && f.focus !== 'all' && w.strength?.focus !== f.focus) return false;
    return !q || `${w.name} ${w.subtitle ?? ''} ${PURPOSE_LABEL[t.purpose]} ${w.purpose}`.toLowerCase().includes(q);
  });
  if (f.sort !== 'family') return [...kept].sort((a, b) => (f.sort === 'short' ? minutesOf(a) - minutesOf(b) : minutesOf(b) - minutesOf(a)));
  if (f.show === 'recent') return [...kept].sort((a, b) => (mine.recent.get(libraryKey(b)) ?? '').localeCompare(mine.recent.get(libraryKey(a)) ?? ''));
  return kept;
}

/** Whether any filter narrows the list (Clear shows only then). */
export const narrowed = (f: Filters) => !!f.query.trim() || f.purpose !== 'all' || f.intensity !== 'all' || f.outdoor || f.focus !== 'all' || f.show !== 'all' || f.duration !== 'all';

/** The filters as the Library's address carries them; defaults left out. */
export function filtersToQuery(f: Filters): Record<string, string | undefined> {
  return {
    q: f.query || undefined,
    p: f.purpose !== 'all' ? f.purpose : undefined,
    i: f.intensity !== 'all' ? f.intensity : undefined,
    out: f.outdoor ? '1' : undefined,
    focus: f.focus !== 'all' ? f.focus : undefined,
    show: f.show !== 'all' ? f.show : undefined,
    len: f.duration !== 'all' ? f.duration : undefined,
    sort: f.sort !== 'family' ? f.sort : undefined,
  };
}

/** The type names the address carried before 9 Nov, read as the purposes they became. */
const OLD_TYPE: Record<string, Purpose> = { recovery: 'recovery', endurance: 'endurance', tempo: 'tempo', sweetspot: 'sweetspot', threshold: 'threshold', vo2max: 'vo2', anaerobic: 'anaerobic', test: 'test' };

/** The filters read back from an address; anything unknown falls back to no filter. */
export function filtersFromQuery(q: URLSearchParams): Filters {
  const p = q.get('p') ?? OLD_TYPE[q.get('t') ?? ''] ?? '';
  return {
    query: q.get('q') ?? '',
    purpose: RIDE_PURPOSES.find((x) => x === p) ?? 'all',
    intensity: INTENSITIES.find((x) => x === q.get('i')) ?? 'all',
    outdoor: q.get('out') === '1',
    focus: FOCI.find((x) => x === q.get('focus')) ?? 'all',
    show: (['favorites', 'recent'] as Show[]).find((x) => x === q.get('show')) ?? 'all',
    duration: DURATIONS.find((d) => d[0] === q.get('len'))?.[0] ?? 'all',
    sort: (['family', 'short', 'long'] as SortKey[]).find((x) => x === q.get('sort')) ?? 'family',
  };
}

/**
 * The filter state. With `url` (the Library), it opens from the address and keeps itself there, so
 * Back to the Library finds the list as it was left. Without (Replace, the Calendar's add picker, which
 * open as sheets over another page), it lives only as long as the sheet and never touches the address.
 */
export function useFilters(opts: { url?: boolean } = {}): [Filters, (next: Partial<Filters>) => void] {
  const [f, setF] = useState<Filters>(() => (opts.url ? filtersFromQuery(readQuery()) : NO_FILTERS));
  useUrlSync(opts.url ? filtersToQuery(f) : {}, opts.url ? ['t'] : []);
  return [f, (next) => setF((prev) => ({ ...prev, ...next }))];
}

const SHOW_LABEL: Record<Show, string> = { all: 'All workouts', favorites: 'Favorites', recent: 'Recently done' };

/**
 * The bar. For rides it opens with "What do you want to work on?": one chip per purpose. Below
 * it, the search and the menus: length, how hard, body focus (strength), which ones (all,
 * favourites, recently done), the order, and for rides the outdoor switch.
 */
export function FilterBar({ kind, f, set }: { kind: string; f: Filters; set: (next: Partial<Filters>) => void }) {
  const [menu, setMenu] = useState<'length' | 'intensity' | 'focus' | 'show' | 'sort' | null>(null);
  // A sheet that switches kind keeps only what applies to the new one.
  useEffect(() => {
    const clear: Partial<Filters> = {};
    if (kind !== 'ride' && (f.purpose !== 'all' || f.outdoor)) Object.assign(clear, { purpose: 'all', outdoor: false });
    if (kind !== 'strength' && f.focus !== 'all') clear.focus = 'all';
    if (Object.keys(clear).length) set(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const open = (m: typeof menu) => () => setMenu(menu === m ? null : m);
  const close = () => setMenu(null);
  return (
    <div class="filters">
      {kind === 'ride' && (
        <div class="purpose-row">
          <span class="small muted purpose-ask">What do you want to work on?</span>
          <div class="chips purpose-chips" role="group" aria-label="What do you want to work on?">
            <button class={`chip${f.purpose === 'all' ? ' on' : ''}`} aria-pressed={f.purpose === 'all'} onClick={() => set({ purpose: 'all' })}>Anything</button>
            {RIDE_PURPOSES.map((p) => <button key={p} class={`chip${f.purpose === p ? ' on' : ''}`} aria-pressed={f.purpose === p} onClick={() => set({ purpose: f.purpose === p ? 'all' : p })}>{PURPOSE_LABEL[p]}</button>)}
          </div>
        </div>
      )}
      <div class="filterbar">
        <input value={f.query} placeholder="Search by name" onInput={(e) => set({ query: (e.target as HTMLInputElement).value })} aria-label="Search the library" />
        <Menu label={DURATIONS.find((d) => d[0] === f.duration)![1]} active={f.duration !== 'all'} open={menu === 'length'} onOpen={open('length')} onClose={close} title="Length"
          options={DURATIONS.map(([d, l]) => [d, l] as [string, string])} value={f.duration} onPick={(v) => set({ duration: v as Duration })} />
        <Menu label={f.intensity === 'all' ? 'Any effort' : INTENSITY_LABEL[f.intensity]} active={f.intensity !== 'all'} open={menu === 'intensity'} onOpen={open('intensity')} onClose={close} title="How hard"
          options={[['all', 'Any effort'], ...INTENSITIES.map((x) => [x, INTENSITY_LABEL[x]] as [string, string])]} value={f.intensity} onPick={(v) => set({ intensity: v as Intensity | 'all' })} />
        {kind === 'strength' && <Menu label={f.focus === 'all' ? 'Whole body or part' : cap(FOCUS_WORDS[f.focus])} active={f.focus !== 'all'} open={menu === 'focus'} onOpen={open('focus')} onClose={close} title="Body focus"
          options={[['all', 'Any focus'], ...FOCI.map((x) => [x, cap(FOCUS_WORDS[x])] as [string, string])]} value={f.focus} onPick={(v) => set({ focus: v as StrengthFocus | 'all' })} />}
        <Menu label={SHOW_LABEL[f.show]} active={f.show !== 'all'} open={menu === 'show'} onOpen={open('show')} onClose={close} title="Show"
          options={(Object.keys(SHOW_LABEL) as Show[]).map((x) => [x, SHOW_LABEL[x]] as [string, string])} value={f.show} onPick={(v) => set({ show: v as Show })} />
        {kind === 'ride' && <button class={`chip${f.outdoor ? ' on' : ''}`} aria-pressed={f.outdoor} onClick={() => set({ outdoor: !f.outdoor })}>Rides well outdoors</button>}
        <Menu label={f.sort === 'family' ? (f.show === 'recent' ? 'Most recent first' : 'Library order') : f.sort === 'short' ? 'Shortest first' : 'Longest first'} active={false} open={menu === 'sort'} onOpen={open('sort')} onClose={close} title="Order"
          options={[['family', f.show === 'recent' ? 'Most recent first' : 'Library order'], ['short', 'Shortest first'], ['long', 'Longest first']]} value={f.sort} onPick={(v) => set({ sort: v as SortKey })} />
        {narrowed(f) && <button class="btn sm quiet" onClick={() => set({ ...NO_FILTERS, sort: f.sort })}>Clear</button>}
      </div>
    </div>
  );
}

/** The empty list, saying why in words that fit the filter that emptied it. */
export function NothingMatches({ f }: { f: Filters }) {
  if (f.show === 'favorites') return <div class="empty small"><b>No favorites here yet.</b><span class="small muted">Tap the star on any workout to keep it in Favorites.</span></div>;
  if (f.show === 'recent') return <div class="empty small"><b>Nothing done here in the last 90 days.</b><span class="small muted">Workouts you complete from the calendar show up here.</span></div>;
  return <div class="empty small"><b>Nothing matches.</b><span class="small muted">Widen the length or effort, choose another purpose, or clear the search.</span></div>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A filter menu: a button that names the current choice; the options open as a dropdown on a laptop and a sheet on a phone. */
function Menu({ label, active, open, onOpen, onClose, title, options, value, onPick }: { label: string; active: boolean; open: boolean; onOpen: () => void; onClose: () => void; title: string; options: Array<[string, string]>; value: string; onPick: (v: string) => void }) {
  return (
    <div class="menu">
      <button class={`btn sm${active ? '' : ' quiet'} menu-btn`} aria-haspopup="listbox" aria-expanded={open} onClick={onOpen}>{label}<span class="caret">▾</span></button>
      {open && (
        <>
          <div class="menu-bg" onClick={onClose} />
          <div class="menu-list" role="listbox">
            <div class="menu-title">{title}</div>
            {options.map(([v, l]) => <button key={v} role="option" aria-selected={v === value} class={v === value ? 'on' : ''} onClick={() => { onPick(v); onClose(); }}><span>{l}</span>{v === value && <span class="tick">✓</span>}</button>)}
          </div>
        </>
      )}
    </div>
  );
}
