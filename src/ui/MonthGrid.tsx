import type { ComponentChildren } from 'preact';
import { addDays, today } from '../engine/load';
import { DAY_SHORT, dayOrder, firstDay } from './derived';

/** A month as a seven-column grid, starting on the rider's first day of the week. The caller renders each day's contents. */
export function MonthGrid({ month, render, onPrev, onNext, onToday, cellClass, weekNote }: { month: string; render: (date: string) => ComponentChildren; onPrev: () => void; onNext: () => void; onToday: () => void; cellClass?: (date: string) => string; weekNote?: (weekStart: string) => ComponentChildren }) {
  const first = `${month}-01`;
  const firstDow = (new Date(first + 'T00:00:00').getDay() - firstDay() + 7) % 7;   // offset of the 1st from the week's first day
  const start = addDays(first, -firstDow);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const rows = Math.ceil((firstDow + daysInMonth) / 7);
  const t = today();
  const label = new Date(first + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <div>
      <div class="row between" style="margin-bottom:10px">
        <h2>{label}</h2>
        <div class="row">
          <button class="btn sm quiet" onClick={onPrev} aria-label="Previous month">‹</button>
          <button class="btn sm quiet" onClick={onToday}>Today</button>
          <button class="btn sm quiet" onClick={onNext} aria-label="Next month">›</button>
        </div>
      </div>
      <div class={`month${weekNote ? ' with-notes' : ''}`}>
        {dayOrder().map((d) => <div class="month-head" key={d}>{DAY_SHORT[d]}</div>)}
        {weekNote && <div class="month-head month-note-head">Week</div>}
        {Array.from({ length: rows }, (_, r) => {
          const ws = addDays(start, r * 7);
          return [
            ...Array.from({ length: 7 }, (_, c) => {
              const date = addDays(ws, c);
              const inMonth = date.slice(0, 7) === month;
              return (
                <div data-date={date} class={`month-cell${inMonth ? '' : ' out'}${date === t ? ' today' : date < t ? ' past' : ''}${cellClass ? ` ${cellClass(date)}` : ''}`} key={date}>
                  <div class="month-day">{Number(date.slice(8))}</div>
                  {render(date)}
                </div>
              );
            }),
            weekNote ? <div class="month-note" key={`n${ws}`}>{weekNote(ws)}</div> : null,
          ];
        })}
      </div>
    </div>
  );
}

export function monthOf(date: string): string { return date.slice(0, 7); }
export function shiftMonth(month: string, n: number): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The week column: training load done against planned, with a bar that fills as the week is done. */
export function WeekNote({ done, planned, tag }: { done: number; planned: number; tag?: string }) {
  const share = planned > 0 ? Math.min(1, done / planned) : done > 0 ? 1 : 0;
  return (
    <>
      <span><b class="num">{done}</b>{planned > 0 && <span class="faint"> of {planned}</span>}</span>
      <span class="faint">TSS</span>
      <span class="mn-bar" title={planned > 0 ? `${Math.round(share * 100)}% of the week's planned load done` : undefined}><i style={`width:${Math.round(share * 100)}%`} /></span>
      {tag && <span class="mn-tag">{tag}</span>}
    </>
  );
}
