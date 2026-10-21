import { OVERLAYS, type OverlayKey } from './FitnessChart';
import { toast } from './Toast';

export const MAX_OVERLAYS = 6;
const CORE: OverlayKey[] = ['fitness', 'fatigue', 'form'];

/** Parse "fitness,fatigue,hrv" into known keys, in the chips' order; empty or unknown gives undefined. */
export function parseOverlays(s: string | null | undefined): OverlayKey[] | undefined {
  if (!s) return undefined;
  const want = new Set(s.split(','));
  const out = OVERLAYS.map((o) => o.key).filter((k) => want.has(k));
  return out.length ? out : undefined;
}

/**
 * The chips under the fitness chart: one per thing that can be laid over it.
 * On is filled in the line's colour, off is outlined. At most six on; one with
 * fewer than three days of data in the range is greyed and says so; fitness,
 * fatigue and form cannot all be off at once.
 */
export function OverlayChips({ on, available, onChange }: { on: OverlayKey[]; available: Record<OverlayKey, boolean>; onChange: (next: OverlayKey[]) => void }) {
  function toggle(k: OverlayKey) {
    if (on.includes(k)) {
      const next = on.filter((x) => x !== k);
      if (CORE.includes(k) && !next.some((x) => CORE.includes(x))) return;   // the last of fitness, fatigue and form stays
      onChange(next);
      return;
    }
    if (on.length >= MAX_OVERLAYS) { toast({ ok: false, text: 'Turn one off first (six at once is the limit).' }); return; }
    onChange(OVERLAYS.map((o) => o.key).filter((x) => x === k || on.includes(x)));
  }
  return (
    <div class="ochips" role="group" aria-label="What to show on the chart">
      {OVERLAYS.map((o) => {
        const isOn = on.includes(o.key);
        const can = available[o.key];
        return (
          <button key={o.key} class={`ochip${isOn && can ? ' on' : ''}`} aria-pressed={isOn && can} disabled={!can} onClick={() => toggle(o.key)} style={`--c:${o.color}`}>
            <span class={`ochip-sw${o.bars ? ' bars' : o.dotted ? ' dotted' : ''}`} aria-hidden="true" />
            {o.label}{!can && <span class="ochip-none"> · no data in range</span>}
          </button>
        );
      })}
    </div>
  );
}
