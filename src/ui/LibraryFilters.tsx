import { EXERCISES } from '../library/strength';
import { useEffect, useState } from 'preact/hooks';
import { useNarrow } from './Glance';
import { workoutStats } from '../engine/workout';
import type { StrengthFocus, Workout } from '../engine/types';
import { PURPOSE_LABEL, tagsOf, type Intensity, type Purpose } from '../library/tags';
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
/**
 * How the list is sorted (10 Nov 2026, "sorting the Library"). Each kind offers only the sorts its cards show a number
 * for; `desc` flips the direction from the one each sort starts in.
 */
export type SortKey = 'suggested' | 'name' | 'length' | 'tss' | 'intensity' | 'exercises' | 'last';
export const SORTS: Record<string, SortKey[]> = {
  ride: ['suggested', 'name', 'length', 'tss', 'intensity', 'last'],
  strength: ['suggested', 'name', 'length', 'tss', 'exercises', 'last'],
  mobility: ['suggested', 'name', 'length', 'last'],
  walk: ['suggested', 'name', 'length', 'tss', 'last'],
  run: ['suggested', 'name', 'length', 'tss', 'last'],
};
export const SORT_LABEL: Record<SortKey, string> = { suggested: 'Suggested', name: 'Name', length: 'Length', tss: 'Training load (TSS)', intensity: 'Intensity', exercises: 'Number of exercises', last: 'Last done' };
/** Each sort's two directions, in words: [as it starts, flipped]. */
export const SORT_WAYS: Record<SortKey, [string, string]> = {
  suggested: ['by purpose', 'by purpose'], name: ['A to Z', 'Z to A'], length: ['shortest first', 'longest first'], tss: ['lowest first', 'highest first'],
  intensity: ['easiest first', 'hardest first'], exercises: ['fewest first', 'most first'], last: ['longest ago first', 'most recent first'],
};
export const sortsFor = (kind: string): SortKey[] => SORTS[kind] ?? SORTS.ride;
/** The sort a list opens on when the rider hasn't chosen one (10 Nov 2026): rides A to Z, everything else Suggested; Recently done, most recent first. */
export const defaultSort = (kind: string): SortKey => (kind === 'ride' ? 'name' : 'suggested');
/** The sort actually in force: the rider's choice when this kind offers it, else the kind's default. */
export const sortIn = (f: Pick<Filters, 'sort'> & Partial<Pick<Filters, 'show'>>, kind: string): SortKey =>
  f.sort !== 'default' && sortsFor(kind).includes(f.sort) ? f.sort : f.show === 'recent' ? 'suggested' : defaultSort(kind);   // Recently done opens most recent first
export type Show = 'all' | 'favorites' | 'recent';
export interface Filters {
  query: string;
  purpose: Purpose | 'all';
  intensity: Intensity | 'all';
  /** Rides only: just those that ride well outdoors on a bike computer. */
  outdoor: boolean;
  /** Rides only: just those that can be ridden by heart rate, without a power meter (10 Nov 2026). */
  hrOnly: boolean;
  /** Strength only. */
  focus: StrengthFocus | 'all';
  /** Strength only (Part D batch 2, 11 Nov 2026): sessions that include all of these kinds of movement. */
  includes: Includes[];
  show: Show;
  duration: Duration;
  /** 'default': the kind's own default (rides A to Z). */
  sort: SortKey | 'default';
  /** The sort's direction flipped (the arrow). */
  desc: boolean;
}
export const NO_FILTERS: Filters = { query: '', purpose: 'all', intensity: 'all', outdoor: false, hrOnly: false, focus: 'all', includes: [], show: 'all', duration: 'all', sort: 'default', desc: false };

/**
 * What a strength session works (Part D batch 2, 11 Nov 2026), from its exercises' movement patterns: push, pull,
 * posterior chain (any hinge: deadlifts, swings, hip thrusts, bridges, good mornings, Nordic lowering) and trunk.
 */
export type Includes = 'push' | 'pull' | 'posterior' | 'trunk';
export const INCLUDES: Includes[] = ['push', 'pull', 'posterior', 'trunk'];
export const INCLUDES_LABEL: Record<Includes, string> = { push: 'Push', pull: 'Pull', posterior: 'Posterior chain', trunk: 'Trunk' };
const PATTERN_OF = new Map(EXERCISES.map((e) => [e.name, e.pattern]));
const INCLUDES_PATTERN: Record<Includes, string> = { push: 'push', pull: 'pull', posterior: 'hinge', trunk: 'trunk' };
/** Whether a session has at least one exercise of that kind of movement. */
export const sessionIncludes = (w: Pick<Workout, 'exercises'>, x: Includes): boolean => (w.exercises ?? []).some((e) => PATTERN_OF.get(e.name) === INCLUDES_PATTERN[x]);

/** What the rider has starred, and when each workout was last done (Library id → YYYY-MM-DD). */
/** `last`: when each workout was last done, at any time (for the Last done sort); `recent` is the last 90 days. */
export interface Mine { favorites: Set<string>; recent: Map<string, string>; last?: Map<string, string> }
const NOBODY: Mine = { favorites: new Set(), recent: new Map() };

/** The value a sort orders by. Rides take load and intensity from their steps; other kinds from their estimate. */
export function sortValue(w: Workout, key: SortKey, mine: Mine = NOBODY): string | number {
  switch (key) {
    case 'name': return w.name.toLocaleLowerCase();
    case 'length': return minutesOf(w);
    case 'tss': return w.kind === 'ride' ? workoutStats(w.blocks).tss : (w.estimatedTss ?? 0);
    case 'intensity': return w.kind === 'ride' ? workoutStats(w.blocks).intensityFactor : 0;
    case 'exercises': return w.exercises?.length ?? 0;
    case 'last': return (mine.last ?? mine.recent).get(libraryKey(w)) ?? '';   // never done: '' sorts first
    default: return 0;
  }
}

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
    if (kind === 'ride' && f.hrOnly && !w.bases.includes('hr')) return false;
    if (kind === 'strength' && f.focus !== 'all' && w.strength?.focus !== f.focus) return false;
    if (kind === 'strength' && f.includes.length && !f.includes.every((x) => sessionIncludes(w, x))) return false;
    return !q || `${w.name} ${w.subtitle ?? ''} ${PURPOSE_LABEL[t.purpose]} ${w.purpose}`.toLowerCase().includes(q);
  });
  // A sort the kind doesn't offer falls back to Suggested; ties keep the Suggested order (the sort is stable).
  const key = sortIn(f, kind);
  if (key !== 'suggested') {
    const v = new Map(kept.map((w) => [w, sortValue(w, key, mine)]));
    const dir = f.desc ? -1 : 1;
    return [...kept].sort((a, b) => { const x = v.get(a)!, y = v.get(b)!; return dir * (typeof x === 'number' ? x - (y as number) : (x as string).localeCompare(y as string)); });
  }
  if (f.show === 'recent') return [...kept].sort((a, b) => (mine.recent.get(libraryKey(b)) ?? '').localeCompare(mine.recent.get(libraryKey(a)) ?? ''));
  return kept;
}

/** Whether any filter narrows the list (Clear shows only then). */
export const narrowed = (f: Filters) => !!f.query.trim() || f.purpose !== 'all' || f.intensity !== 'all' || f.outdoor || f.hrOnly || f.focus !== 'all' || f.includes.length > 0 || f.show !== 'all' || f.duration !== 'all';

/** The filters as the Library's address carries them; defaults left out. */
export function filtersToQuery(f: Filters): Record<string, string | undefined> {
  return {
    q: f.query || undefined,
    p: f.purpose !== 'all' ? f.purpose : undefined,
    i: f.intensity !== 'all' ? f.intensity : undefined,
    out: f.outdoor ? '1' : undefined,
    hr: f.hrOnly ? '1' : undefined,
    focus: f.focus !== 'all' ? f.focus : undefined,
    has: f.includes.length ? f.includes.join(',') : undefined,
    show: f.show !== 'all' ? f.show : undefined,
    len: f.duration !== 'all' ? f.duration : undefined,
    sort: f.sort !== 'default' ? f.sort : undefined,
    dir: f.desc ? 'd' : undefined,
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
    hrOnly: q.get('hr') === '1',
    focus: FOCI.find((x) => x === q.get('focus')) ?? 'all',
    includes: (q.get('has') ?? '').split(',').filter((x): x is Includes => (INCLUDES as string[]).includes(x)),
    show: (['favorites', 'recent'] as Show[]).find((x) => x === q.get('show')) ?? 'all',
    duration: DURATIONS.find((d) => d[0] === q.get('len'))?.[0] ?? 'all',
    // An address saved with the old order (Shortest first, Longest first) opens as Length, the same way round.
    ...(q.get('sort') === 'short' ? { sort: 'length' as SortKey, desc: false } : q.get('sort') === 'long' ? { sort: 'length' as SortKey, desc: true }
      : { sort: (Object.keys(SORT_LABEL) as SortKey[]).find((x) => x === q.get('sort')) ?? 'default', desc: q.get('dir') === 'd' }),
  };
}

/**
 * The filter state. With `url` (the Library), it opens from the address and keeps itself there, so
 * Back to the Library finds the list as it was left. Without (Replace, the Calendar's add picker, which
 * open as sheets over another page), it lives only as long as the sheet and never touches the address.
 */
export function useFilters(opts: { url?: boolean } = {}): [Filters, (next: Partial<Filters>) => void] {
  // "How hard" was taken out of the bar on 10 Nov 2026; an address saved with one opens without it.
  const [f, setF] = useState<Filters>(() => (opts.url ? { ...filtersFromQuery(readQuery()), intensity: 'all' } : NO_FILTERS));
  useUrlSync(opts.url ? filtersToQuery(f) : {}, opts.url ? ['t'] : []);
  return [f, (next) => setF((prev) => ({ ...prev, ...next }))];
}

const SHOW_LABEL: Record<Show, string> = { all: 'All workouts', favorites: 'Favorites', recent: 'Recently done' };

/**
 * The bar. For rides it opens with "What do you want to work on?": one chip per purpose. Below
 * it, the search and the menus: length, body focus (strength), which ones (all,
 * favourites, recently done), the order, and for rides the outdoor switch.
 */
export function FilterBar({ kind, f, set }: { kind: string; f: Filters; set: (next: Partial<Filters>) => void }) {
  const [menu, setMenu] = useState<'length' | 'intensity' | 'focus' | 'show' | null>(null);
  // A sheet that switches kind keeps only what applies to the new one.
  useEffect(() => {
    const clear: Partial<Filters> = {};
    if (kind !== 'ride' && (f.purpose !== 'all' || f.outdoor || f.hrOnly)) Object.assign(clear, { purpose: 'all', outdoor: false, hrOnly: false });
    if (kind !== 'strength' && f.focus !== 'all') clear.focus = 'all';
    if (kind !== 'strength' && f.includes.length) clear.includes = [];
    if (f.sort !== 'default' && !sortsFor(kind).includes(f.sort)) Object.assign(clear, { sort: 'default', desc: false });
    if (Object.keys(clear).length) set(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const open = (m: typeof menu) => () => setMenu(menu === m ? null : m);
  const close = () => setMenu(null);
  // On a phone the filters fold behind one button, so the list starts on the first screen (10 Nov 2026).
  const phone = useNarrow(520);
  const [shown, setShown] = useState(false);
  const active = activeCount(f);
  const search = <input value={f.query} placeholder="Search by name" onInput={(e) => set({ query: (e.target as HTMLInputElement).value })} aria-label="Search the library" />;
  const clear = narrowed(f) && <button class="btn sm quiet" onClick={() => set({ ...NO_FILTERS, sort: f.sort, desc: f.desc })}>Clear</button>;
  if (phone && !shown) return (
    <div class="filters">
      <div class="filterbar filters-folded">
        {search}
        <button class={`btn sm${active ? ' on-wash' : ''}`} aria-expanded={false} onClick={() => setShown(true)}>Filters{active ? ` · ${active}` : ''} <span aria-hidden="true">▾</span></button>
        {clear}
      </div>
    </div>
  );
  return (
    <div class="filters">
      {phone && <div class="row between" style="margin-bottom:6px"><span class="small muted">Filters</span><button class="btn sm quiet" aria-expanded={true} onClick={() => setShown(false)}>Done</button></div>}
      {phone && <div class="filterbar filters-folded" style="margin-bottom:10px">{search}</div>}
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
        {!phone && search}
        <Menu label={DURATIONS.find((d) => d[0] === f.duration)![1]} active={f.duration !== 'all'} open={menu === 'length'} onOpen={open('length')} onClose={close} title="Length"
          options={DURATIONS.map(([d, l]) => [d, l] as [string, string])} value={f.duration} onPick={(v) => set({ duration: v as Duration })} />
        {kind === 'strength' && <Menu label={f.focus === 'all' ? 'Whole body or part' : cap(FOCUS_WORDS[f.focus])} active={f.focus !== 'all'} open={menu === 'focus'} onOpen={open('focus')} onClose={close} title="Body focus"
          options={[['all', 'Any focus'], ...FOCI.map((x) => [x, cap(FOCUS_WORDS[x])] as [string, string])]} value={f.focus} onPick={(v) => set({ focus: v as StrengthFocus | 'all' })} />}
        {kind === 'strength' && <span class="chips includes-chips" role="group" aria-label="Includes"><span class="faint small">Includes</span>{INCLUDES.map((x) => { const on = f.includes.includes(x); return <button key={x} class={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => set({ includes: on ? f.includes.filter((y) => y !== x) : [...f.includes, x] })}>{INCLUDES_LABEL[x]}</button>; })}</span>}
        <Menu label={SHOW_LABEL[f.show]} active={f.show !== 'all'} open={menu === 'show'} onOpen={open('show')} onClose={close} title="Show"
          options={(Object.keys(SHOW_LABEL) as Show[]).map((x) => [x, SHOW_LABEL[x]] as [string, string])} value={f.show} onPick={(v) => set({ show: v as Show })} />
        {kind === 'ride' && <button class={`chip${f.outdoor ? ' on' : ''}`} aria-pressed={f.outdoor} onClick={() => set({ outdoor: !f.outdoor })}>Rides well outdoors</button>}
        {kind === 'ride' && <button class={`chip${f.hrOnly ? ' on' : ''}`} aria-pressed={f.hrOnly} onClick={() => set({ hrOnly: !f.hrOnly })}>Works by heart rate</button>}
        {clear}
      </div>
    </div>
  );
}

/** How many filters narrow the list, besides the search (which shows on its own), for the folded button's count. */
const activeCount = (f: Filters) => [f.purpose !== 'all', f.duration !== 'all', f.focus !== 'all', f.includes.length > 0, f.show !== 'all', f.outdoor, f.hrOnly].filter(Boolean).length;

/** The empty list, saying why in words that fit the filter that emptied it. */
export function NothingMatches({ f }: { f: Filters }) {
  if (f.show === 'favorites') return <div class="empty small"><b>No favorites here yet.</b><span class="small muted">Tap the star on any workout to keep it in Favorites.</span></div>;
  if (f.show === 'recent') return <div class="empty small"><b>Nothing done here in the last 90 days.</b><span class="small muted">Workouts you complete from the calendar show up here.</span></div>;
  return <div class="empty small"><b>Nothing matches.</b><span class="small muted">Widen the length, choose another purpose, or clear the search.</span></div>;
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

/**
 * The count and the sort, on one line below the filters (10 Nov 2026): "148 rides" on the left, "Sort: Length ↑" on
 * the right as plain text. The words open the list of sorts; the arrow flips the direction.
 */
export function SortLine({ kind, f, set, count, noun }: { kind: string; f: Filters; set: (next: Partial<Filters>) => void; count: number; noun: [string, string] }) {
  const [open, setOpen] = useState(false);
  const sorts = sortsFor(kind);
  const key = sortIn(f, kind);
  const way = SORT_WAYS[key][f.desc ? 1 : 0];
  return (
    <div class="sort-line">
      <span class="small muted">{count} {count === 1 ? noun[0] : noun[1]}</span>
      <span class="sort-ctl menu">
        <button class="sort-link" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>Sort: {SORT_LABEL[key]}</button>
        {key !== 'suggested' && <button class="sort-link sort-dir" aria-label={`${cap(way)}. Tap for ${SORT_WAYS[key][f.desc ? 0 : 1]}.`} onClick={() => set({ desc: !f.desc })}>{f.desc ? '↓' : '↑'}</button>}
        {open && (
          <>
            <div class="menu-bg" onClick={() => setOpen(false)} />
            <div class="menu-list sort-list" role="listbox" aria-label={`Sort ${noun[1]} by`}>
              <div class="menu-title">Sort {noun[1]} by</div>
              {sorts.map((k) => (
                <button key={k} role="option" aria-selected={k === key} class={k === key ? 'on' : ''} onClick={() => { set({ sort: k, desc: k === key ? f.desc : false }); setOpen(false); }}>
                  <span>{SORT_LABEL[k]}</span><span class="sort-way">{k === 'suggested' && f.show === 'recent' ? 'most recent first' : SORT_WAYS[k][k === key && f.desc ? 1 : 0]}{k === key ? ' ✓' : ''}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </span>
    </div>
  );
}

/** When a workout was last done, in words: "today", "3 days ago", "3 weeks ago", "not yet". */
export function lastDoneWords(date: string | undefined, now = new Date()): string {
  if (!date) return 'not yet';
  const days = Math.round((now.getTime() - new Date(date + 'T12:00:00').getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
