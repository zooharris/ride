import { useEffect, useRef, useState } from 'preact/hooks';
import type { Equipment, Exercise } from '../engine/types';
import { picturesFor } from '../art/pictures';
import { ExThumb } from './ExercisePictures';

/**
 * Adding exercises and stretches to a session (13 Nov 2026): chips that add with a
 * tap and open the details with the expand icon at their right end; the details
 * sheet; and a searchable list that adds at the end of the list or at a chosen spot.
 * An exercise can be in a session more than once (warm-up sets and work sets, a
 * circuit), so a tick or count shows what is already in it and never blocks a repeat.
 */

/** One thing that can be added: its name, its group (movement or target) and what goes into the session. */
export interface AddItem { name: string; group: string; make: () => Exercise }

/** The open-large icon used on charts, so the same mark means "see more" everywhere. */
export const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5h4v4M12.5 1.5 8 6M5.5 12.5h-4v-4M1.5 12.5 6 8" /></svg>
);

const EQUIPMENT_WORDS: Record<Equipment, string> = {
  bodyweight: 'no equipment', dumbbells: 'dumbbells', kettlebell: 'a kettlebell', bench: 'a bench or sturdy chair', band: 'a resistance band',
  barbell: 'a barbell', 'pullup-bar': 'a pull-up bar', 'dip-bars': 'dip bars', treadmill: 'a treadmill', 'outdoor-walk': 'somewhere to walk', trainer: 'a trainer',
};

/** "3 × 8–10 per side", "45 s each side": what the builder puts in by default. */
export function usualText(e: Exercise): string {
  if (e.holdSeconds && !e.sets) return `${e.holdSeconds} s${e.reps ? `, ${e.reps}` : ''}`;
  if (e.holdSeconds) return `${e.sets} × ${e.holdSeconds} s`;
  return [e.sets ? `${e.sets} ×` : '', e.reps ?? ''].filter(Boolean).join(' ');
}

/** "Dumbbells or a bench or sturdy chair"; nothing when it needs no equipment. */
export function equipmentText(eq: Equipment[] | undefined): string {
  const list = (eq ?? []).filter((q) => q !== 'bodyweight');
  if (!list.length) return (eq ?? []).includes('bodyweight') ? 'No equipment' : '';
  const words = list.map((q) => EQUIPMENT_WORDS[q] ?? q);
  const s = words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words[0];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * An exercise's details: its pictures, how to do it, why it helps on the bike, the
 * usual sets and the equipment. Only what the app holds is shown. With onAdd, one
 * main button adds it ("Add again" when it is already in the session).
 */
export function ExerciseSheet({ ex, count = 0, addLabel, onAdd, onClose }: { ex: Exercise; count?: number; addLabel?: string; onAdd?: () => void; onClose: () => void }) {
  const p = picturesFor(ex.name);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const usual = usualText(ex);
  const eq = equipmentText(ex.equipment);
  return (
    <div class="modal-bg" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div class="modal ex-sheet" onClick={(e) => e.stopPropagation()} style="max-width:560px" role="dialog" aria-modal="true" aria-label={ex.name}>
        <div class="row between" style="margin-bottom:12px;gap:12px;align-items:flex-start"><h2 style="margin:0">{ex.name}</h2><button ref={closeRef} class="btn sm quiet" onClick={onClose}>Close</button></div>
        {p.a && (
          <div class={p.b ? 'ex-big two' : 'ex-big'}>
            <figure><div class="ex-tile"><img src={p.a} alt={p.b ? `${ex.name}, start` : ex.name} width={384} height={384} /></div>{p.b && <figcaption>start</figcaption>}</figure>
            {p.b && <figure><div class="ex-tile"><img src={p.b} alt={`${ex.name}, finish`} width={384} height={384} /></div><figcaption>finish</figcaption></figure>}
          </div>
        )}
        <dl class="ex-facts">
          {ex.cue && <div><dt>How to do it</dt><dd>{ex.cue}</dd></div>}
          {ex.why && <div><dt>Why it helps on the bike</dt><dd>{ex.why}</dd></div>}
          {(usual || eq) && <div><dt>{usual && eq ? 'Usually, and what you need' : usual ? 'Usually' : 'What you need'}</dt><dd>{[usual, eq].filter(Boolean).join(' · ')}</dd></div>}
        </dl>
        {onAdd && (
          <div class="stack" style="gap:8px;margin-top:14px">
            <button class="btn primary" onClick={() => { onAdd(); onClose(); }}>{count ? 'Add again' : (addLabel ?? 'Add to workout')}</button>
            {count > 0 && <p class="faint small" style="margin:0;text-align:center">Already in this session{count > 1 ? ` ${count} times` : ''}. Adding it again gives it its own sets and reps.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** How many times each name is in the session. */
export function countsOf(list: Pick<Exercise, 'name'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of list) m.set(e.name, (m.get(e.name) ?? 0) + 1);
  return m;
}

const PlusMark = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 2v10M2 7h10" /></svg>;
const TickMark = () => <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7.5l3 3 6-7" /></svg>;

/**
 * The chips, by group. Tapping a chip adds it; the expand icon in its own section at
 * the right opens the details and adds nothing. A chip already in the session shows a
 * tick (or a count) and still adds again.
 */
export function ChipPicker({ items, label, counts, onAdd, onDetails }: { items: AddItem[]; label: string; counts: Map<string, number>; onAdd: (i: AddItem) => void; onDetails: (i: AddItem) => void }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <details class="panel" style="margin-top:10px" open>
      <summary style="cursor:pointer;font-weight:600">{label}</summary>
      <p class="faint small" style="margin:6px 0 0">Tap an exercise to add it. Tap <span class="ex-chip-mark"><ExpandIcon /></span> to see its pictures and how to do it.</p>
      {groups.map((g) => (
        <div key={g} style="margin-top:10px">
          <div class="faint small" style="margin-bottom:4px">{g}</div>
          <div class="chips">
            {items.filter((i) => i.group === g).map((i) => {
              const n = counts.get(i.name) ?? 0;
              return (
                <span key={i.name} class={`ex-chip${n ? ' on' : ''}`}>
                  <button type="button" class="ex-chip-add" onClick={() => onAdd(i)} aria-label={n ? `Add ${i.name} again` : `Add ${i.name}`}>
                    <ExThumb name={i.name} size={44} />
                    {!n && <span class="ex-chip-mark"><PlusMark /></span>}
                    <span>{i.name}</span>
                    {n === 1 && <span class="ex-chip-mark"><TickMark /></span>}
                    {n > 1 && <span class="ex-chip-count" aria-label={`in this session ${n} times`}>{n}</span>}
                  </button>
                  <button type="button" class="ex-chip-more" onClick={() => onDetails(i)} aria-label={`Details: ${i.name}`} title="See its pictures and how to do it"><ExpandIcon /></button>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </details>
  );
}

/** Lower case, accents and punctuation gone: what a search matches on. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');

/** The items whose name holds the search anywhere, ignoring case; in the chips' group order. */
export function matchItems<T extends { name: string }>(items: T[], q: string): T[] {
  const f = fold(q.trim());
  return f ? items.filter((i) => fold(i.name).includes(f)) : items;
}

/**
 * A field that opens a list under it: grouped as the chips are, each row with its
 * picture, name and the expand icon; typing narrows it by name. Arrows move, Enter
 * chooses, Escape closes. Choosing adds the exercise where the field sits.
 */
export function AddList({ items, counts, placeholder, autoFocus, onChoose, onDetails, onClose }: {
  items: AddItem[]; counts: Map<string, number>; placeholder: string; autoFocus?: boolean;
  onChoose: (i: AddItem) => void; onDetails: (i: AddItem) => void; onClose?: () => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!!autoFocus);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useRef(`addlist-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  const shown = matchItems(items, q);
  const groups = [...new Set(shown.map((i) => i.group))];
  const ordered = groups.flatMap((g) => shown.filter((i) => i.group === g));
  const at = Math.min(hi, Math.max(0, ordered.length - 1));
  const choose = (i: AddItem) => { onChoose(i); setQ(''); setHi(0); input.current?.focus(); };
  const close = () => { setOpen(false); setQ(''); onClose?.(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(Math.min(at + 1, ordered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(at - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && ordered[at]) choose(ordered[at]); else setOpen(true); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  useEffect(() => { document.getElementById(`${listId}-${at}`)?.scrollIntoView?.({ block: 'nearest' }); }, [at, listId]);
  return (
    <div class="addlist">
      <div class="addlist-field">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input ref={input} value={q} placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && ordered[at] ? `${listId}-${at}` : undefined} aria-label={placeholder}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setHi(0); setOpen(true); }} onKeyDown={key} />
        {(open || onClose) && <button type="button" class="icon-btn sm" aria-label="Close the list" onClick={close}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg></button>}
      </div>
      {open && (
        <div class="addlist-menu" id={listId} role="listbox">
          {!ordered.length && <p class="muted small" style="margin:8px">No exercise matches. Clear the search to see them all.</p>}
          {groups.map((g) => (
            <div key={g} role="group" aria-label={g}>
              <div class="addlist-group">{g}</div>
              {shown.filter((i) => i.group === g).map((i) => {
                const k = ordered.indexOf(i);
                const n = counts.get(i.name) ?? 0;
                return (
                  <div key={i.name} id={`${listId}-${k}`} role="option" aria-selected={k === at} class={`addlist-row${k === at ? ' hi' : ''}`} onMouseEnter={() => setHi(k)}>
                    <button type="button" class="addlist-pick" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                      <span class="addlist-pic"><ExThumb name={i.name} size={36} /></span>
                      <span class="addlist-name">{i.name}{n > 0 && <span class="faint small"> · in this workout{n > 1 ? ` ×${n}` : ''}</span>}</span>
                      {n > 0 && <span class="ex-chip-mark"><TickMark /></span>}
                    </button>
                    <button type="button" class="addlist-more" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => onDetails(i)} aria-label={`Details: ${i.name}`} title="See its pictures and how to do it"><ExpandIcon /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The quiet "Add an exercise here" on a dashed line between blocks. */
export function InsertHere({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div class="insert-here">
      <span aria-hidden="true" />
      <button type="button" class="insert-here-btn" onClick={onClick} aria-label={label} title={label}><PlusMark /><span class="insert-here-word">{label}</span></button>
      <span aria-hidden="true" />
    </div>
  );
}
