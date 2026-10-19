import type { ComponentChildren } from 'preact';
import { addDays, today } from '../engine/load';
import { DAY_SHORT, dayOrder, firstDay } from './derived';

/** A month as a seven-column grid, starting on the rider's first day of the week. The caller renders each day's contents. */
export function MonthGrid({ month, render, onPrev, onNext, onToday }: { month: string; render: (date: string) => ComponentChildren; onPrev: () => void; onNext: () => void; onToday: () => void }) {
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
      <div class="month">
        {dayOrder().map((d) => <div class="month-head" key={d}>{DAY_SHORT[d]}</div>)}
        {Array.from({ length: rows * 7 }, (_, i) => {
          const date = addDays(start, i);
          const inMonth = date.slice(0, 7) === month;
          return (
            <div class={`month-cell${inMonth ? '' : ' out'}${date === t ? ' today' : ''}`} key={date}>
              <div class="month-day">{Number(date.slice(8))}</div>
              {render(date)}
            </div>
          );
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
