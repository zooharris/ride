import type { ComponentChildren } from 'preact';
import { Mark } from './Brand';

/**
 * The one header every screen uses: a small line above the title (the date,
 * a count, or the way back), the title, and the screen's actions on the right.
 * On a laptop it stays pinned while the page scrolls.
 */
export function PageHead({ title, eyebrow, back, children }: {
  title: ComponentChildren;
  eyebrow?: ComponentChildren;
  back?: { label: string; href?: string; onClick?: () => void };
  children?: ComponentChildren;
}) {
  return (
    <header class="page-head">
      <div class="ph-title">
        {back
          ? (back.href ? <a class="eyebrow back" href={back.href}>‹ {back.label}</a> : <button class="eyebrow back" onClick={back.onClick}>‹ {back.label}</button>)
          : eyebrow != null && <p class="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {back && eyebrow != null && <p class="eyebrow" style="margin-top:4px">{eyebrow}</p>}
      </div>
      {children && <div class="ph-actions">{children}</div>}
    </header>
  );
}

/** A designed empty state: the mark, one bold line, one explaining line, and at most one action. */
export function Empty({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <span class="empty-mark"><Mark size={40} title="" /></span>
      <b>{title}</b>
      {children && <p class="small muted">{children}</p>}
      {action && <div style="margin-top:6px">{action}</div>}
    </div>
  );
}

/** A shimmering placeholder block while data loads. */
export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: string | number; r?: number }) {
  return <div class="skeleton" style={`height:${h}px;width:${typeof w === 'number' ? `${w}px` : w}${r != null ? `;border-radius:${r}px` : ''}`} />;
}
