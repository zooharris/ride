import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/**
 * A Settings section folded to its title and one line of current state; tap to
 * open. The content stays mounted while folded, so anything running inside
 * (a history load, a sync) carries on and nothing typed is lost.
 */
export function Fold({ title, summary, children }: { title: string; summary?: ComponentChildren; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <section class="section">
      <h2>
        <button class="fold-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span>{title}</span>
          {!open && summary != null && <span class="fold-sum muted small">{summary}</span>}
        </button>
      </h2>
      <div style={open ? '' : 'display:none'}>{children}</div>
    </section>
  );
}
