import { useEffect, useRef, useState } from 'preact/hooks';
import type { NumberRow } from './activityNumbers';
import { columnsFor, groupNumbers, placeCells, type NumberCell } from './numberGroups';
import { useWidth } from './useWidth';

/**
 * An activity's Numbers as compact cells (22 Nov 2026, brief Part A): the label small above, the value in bold under
 * it, in groups with short headings; two across on a phone, three wider. The sentence that explained a number now
 * sits behind an "i" on its cell, in the pop-up the Progress cards use; one open at a time, closed by a second tap,
 * a tap elsewhere or Escape.
 */
export function NumbersGrid({ rows }: { rows: NumberRow[] }) {
  const [box, width] = useWidth<HTMLDivElement>(720);
  const cols = columnsFor(width);
  const groups = groupNumbers(rows);
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length) return null;
  return (
    <div class="numgrid" ref={box}>
      {groups.map((g) => {
        const place = placeCells(g.cells, cols);
        return (
          <div key={g.name} class="ng-group">
            <h3 class="ng-head">{g.name}</h3>
            <div class="ng-cells panel" style={`grid-template-columns:repeat(${cols},minmax(0,1fr))`}>
              {g.cells.map((c, i) => <Cell key={c.label} cell={c} span={place[i].span} top={place[i].row > 0} left={place[i].col > 0} right={place[i].col + place[i].span >= cols && place[i].col > 0} open={open === c.label} setOpen={setOpen} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Cell({ cell, span, top, left, right, open, setOpen }: { cell: NumberCell; span: number; top: boolean; left: boolean; right: boolean; open: boolean; setOpen: (k: string | null) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); btn.current?.focus(); } };
    const click = (e: Event) => { const el = e.target as Node; if (pop.current?.contains(el) || btn.current?.contains(el)) return; setOpen(null); };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    document.addEventListener('touchstart', click);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); document.removeEventListener('touchstart', click); };
  }, [open]);
  const id = `num-${cell.label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div class={`ng-cell${top ? ' t' : ''}${left ? ' l' : ''}`} style={span > 1 ? `grid-column:span ${span}` : undefined}>
      <div class="ng-label">
        <span>{cell.label}</span>
        {cell.explain && <button ref={btn} class="pc-i ng-i" aria-label={`What ${cell.label.toLowerCase()} means`} aria-expanded={open} aria-controls={`${id}-explain`} onClick={() => setOpen(open ? null : cell.label)}>i</button>}
      </div>
      <b class="ng-value num">{cell.value}</b>
      {open && cell.explain && <div class={`pc-pop small ng-pop${right ? ' right' : ''}`} id={`${id}-explain`} role="note" ref={pop}>{cell.explain}</div>}
    </div>
  );
}
