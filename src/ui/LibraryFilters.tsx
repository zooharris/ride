import { useState } from 'preact/hooks';
import { FAMILY_LABEL } from '../library/workouts';
import { workoutStats } from '../engine/workout';
import type { Family, Workout } from '../engine/types';

/**
 * The Library's filter bar (search, type, length, sort), shared with every place a
 * workout is chosen from a list: the Library itself, Replace, and the Calendar's add
 * picker (Batch 10 C). One implementation, so they cannot drift apart.
 */
export const ORDER: Family[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'];
export type Duration = 'all' | 'u60' | '60-90' | '90-120' | '120-180' | '180-240' | '240+';
export const DURATIONS: Array<[Duration, string, [number, number]]> = [
  ['all', 'Any', [0, 1e9]], ['u60', 'Under 1 h', [0, 60]], ['60-90', '1–1½ h', [60, 90]], ['90-120', '1½–2 h', [90, 120]], ['120-180', '2–3 h', [120, 180]], ['180-240', '3–4 h', [180, 240]], ['240+', '4 h and up', [240, 1e9]],
];
export type SortKey = 'family' | 'short' | 'long';
export interface Filters { query: string; family: Family | 'all'; duration: Duration; sort: SortKey }
export const NO_FILTERS: Filters = { query: '', family: 'all', duration: 'all', sort: 'family' };

/** A workout's length in minutes: a ride from its steps, anything else from its stated minutes. */
export const minutesOf = (w: Workout): number => (w.kind === 'ride' ? workoutStats(w.blocks).seconds / 60 : (w.minutes ?? 0));

/**
 * The filters applied to a list of workouts of one kind: search (name, subtitle, type,
 * purpose), length band, then the sort; the type filter applies to rides only.
 */
export function applyFilters(list: Workout[], f: Filters, kind: string): Workout[] {
  const q = f.query.trim().toLowerCase();
  const [lo, hi] = DURATIONS.find((d) => d[0] === f.duration)![2];
  const kept = list
    .filter((w) => { const m = minutesOf(w); return m >= lo && m < hi; })
    .filter((w) => !q || `${w.name} ${w.subtitle ?? ''} ${FAMILY_LABEL[w.family]} ${w.purpose}`.toLowerCase().includes(q));
  const ordered = f.sort === 'family' ? kept : [...kept].sort((a, b) => (f.sort === 'short' ? minutesOf(a) - minutesOf(b) : minutesOf(b) - minutesOf(a)));
  return kind === 'ride' ? ordered.filter((w) => f.family === 'all' || w.family === f.family) : ordered;
}

export function useFilters(): [Filters, (next: Partial<Filters>) => void] {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  return [f, (next) => setF((prev) => ({ ...prev, ...next }))];
}

/** The bar itself. `kind` decides whether the type menu shows (rides only). */
export function FilterBar({ kind, f, set }: { kind: string; f: Filters; set: (next: Partial<Filters>) => void }) {
  const [menu, setMenu] = useState<'type' | 'length' | 'sort' | null>(null);
  const q = f.query.trim();
  return (
    <div class="filterbar">
      <input value={f.query} placeholder="Search" onInput={(e) => set({ query: (e.target as HTMLInputElement).value })} aria-label="Search the library" />
      {kind === 'ride' && <Menu label={f.family === 'all' ? 'All types' : FAMILY_LABEL[f.family]} active={f.family !== 'all'} open={menu === 'type'} onOpen={() => setMenu(menu === 'type' ? null : 'type')} onClose={() => setMenu(null)} title="Type"
        options={[['all', 'All types'], ...ORDER.map((x) => [x, FAMILY_LABEL[x]] as [string, string])]} value={f.family} onPick={(v) => set({ family: v as Family | 'all' })} />}
      <Menu label={f.duration === 'all' ? 'Any length' : DURATIONS.find((d) => d[0] === f.duration)![1]} active={f.duration !== 'all'} open={menu === 'length'} onOpen={() => setMenu(menu === 'length' ? null : 'length')} onClose={() => setMenu(null)} title="Length"
        options={DURATIONS.map(([d, l]) => [d, l] as [string, string])} value={f.duration} onPick={(v) => set({ duration: v as Duration })} />
      <Menu label={f.sort === 'family' ? 'By type' : f.sort === 'short' ? 'Shortest first' : 'Longest first'} active={false} open={menu === 'sort'} onOpen={() => setMenu(menu === 'sort' ? null : 'sort')} onClose={() => setMenu(null)} title="Sort"
        options={[['family', 'By type'], ['short', 'Shortest first'], ['long', 'Longest first']]} value={f.sort} onPick={(v) => set({ sort: v as SortKey })} />
      {(f.family !== 'all' || f.duration !== 'all' || q) && <button class="btn sm quiet" onClick={() => set({ family: 'all', duration: 'all', query: '' })}>Clear</button>}
    </div>
  );
}

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
