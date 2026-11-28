import { useState } from 'preact/hooks';
import { PERIOD_LABEL, type LabPeriod } from '../../engine/lab';
import type { LabData } from './useLab';

const SHORT: Record<LabPeriod, string> = { '4w': '4 wk', '3m': '3 mo', '6m': '6 mo', '1y': '1 yr', all: 'All', plan: 'This plan', custom: 'Custom' };

/** The one period choice, the same on every Insights and Lab screen: set lengths, all time, the plan in force, or two dates. */
export function PeriodPicker({ L }: { L: Pick<LabData, 'period' | 'setPeriod' | 'plan' | 'custom' | 't' | 'earliest'> }) {
  const [open, setOpen] = useState(L.period === 'custom');
  const keys: LabPeriod[] = ['4w', '3m', '6m', '1y', 'all', ...(L.plan ? ['plan' as const] : []), 'custom'];
  const set = (from: string, to: string) => { if (from && to && from <= to) L.setPeriod('custom', { from, to }); };
  return (
    <div class="lb-period">
      <div class="seg range" role="radiogroup" aria-label="Period">
        {keys.map((k) => <button key={k} role="radio" aria-checked={L.period === k} title={PERIOD_LABEL[k]} class={L.period === k ? 'on' : ''}
          onClick={() => { if (k === 'custom') { setOpen(true); L.setPeriod('custom'); } else { setOpen(false); L.setPeriod(k); } }}>{SHORT[k]}</button>)}
      </div>
      {open && L.period === 'custom' && (
        <div class="lb-dates small">
          <label>From <input type="date" value={L.custom.from} min={L.earliest} max={L.t} onChange={(e) => set((e.target as HTMLInputElement).value, L.custom.to)} /></label>
          <label>to <input type="date" value={L.custom.to} min={L.earliest} max={L.t} onChange={(e) => set(L.custom.from, (e.target as HTMLInputElement).value)} /></label>
        </div>
      )}
    </div>
  );
}
