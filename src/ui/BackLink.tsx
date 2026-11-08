import { canGoBack, goBack } from './router';

/**
 * The one Back in the app: returns to the page this one was opened from, as it was left (its
 * filters, tab, month and scroll), the same as the browser's back. Opened with nothing behind it
 * (a fresh tab), it goes to `fallback` instead. A real link to `fallback`, so it still opens in a
 * new tab with a middle click.
 */
export function BackLink({ fallback, label = 'Back', arrow = true, class: cls = 'btn quiet sm', style }: { fallback: string; label?: string; arrow?: boolean; class?: string; style?: string }) {
  return (
    <a href={fallback} class={cls} style={style} onClick={(e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      goBack(fallback);
    }}>{arrow ? '‹ ' : ''}{label}</a>
  );
}

/** What a back control is called: "Back" when it returns to the page before, else the page it falls back to. */
export const backLabel = (fallbackLabel: string): string => (canGoBack() ? 'Back' : fallbackLabel);
