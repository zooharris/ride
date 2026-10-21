import type { SessionKind } from '../engine/types';

/** Line icons drawn to one 24-unit grid at one stroke weight, so they sit evenly beside text. */
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' } as const;
type P = { size?: number };
const sz = (p: P, d: number) => ({ width: p.size ?? d, height: p.size ?? d });

export const Icon = {
  ride: (p: P) => <svg {...base} {...sz(p, 18)}><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5l3.5-7h6l3.5 7M9 9.5L7.5 6.5H10M15 9.5l-1.5-3h2.5M12 16.5l3-7" /></svg>,
  strength: (p: P) => <svg {...base} {...sz(p, 18)}><path d="M2.5 10v4M21.5 10v4M5.5 7.5v9M18.5 7.5v9M5.5 12h13" /></svg>,
  // a seated forward fold: head, curved back over straight legs, hands to the toes
  mobility: (p: P) => <svg {...base} {...sz(p, 18)}><circle cx="15.5" cy="6" r="1.9" /><path d="M5 18.5h15M5 18.5c0-4 2.5-8 7.5-9.5l2 1.5M13 10.5l5 4.5" /></svg>,
  // mid-stride: one arm forward, one leg back
  walk: (p: P) => <svg {...base} {...sz(p, 18)}><circle cx="13" cy="4" r="1.9" /><path d="M12.5 7.5l-1.5 6 3 3 1 4.5M11 13.5l-2.5 7M12.3 8.5l-3.8 2.5-1 3.5M12.5 8.5l2.5 3 3 .5" /></svg>,
  run: (p: P) => <svg {...base} {...sz(p, 18)}><circle cx="14.5" cy="4" r="1.9" /><path d="M13.5 7.5l-2.5 5.5 3.5 2.5-1 5.5M11 13l-3.5 2-3 -.5M13.5 7.5l-4 1.5-2 3M13.5 8l2.5 3.5 3.5 .5" /></svg>,
  sun: (p: P) => <svg {...base} {...sz(p, 22)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg>,
  calendar: (p: P) => <svg {...base} {...sz(p, 22)}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  library: (p: P) => <svg {...base} {...sz(p, 22)}><path d="M4.5 20V10M9.5 20V4.5M14.5 20v-7.5M19.5 20V7.5" /></svg>,
  settings: (p: P) => <svg {...base} {...sz(p, 22)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  check: (p: P) => <svg {...base} {...sz(p, 16)}><path d="M5 12.5l4 4L19 7" /></svg>,
  sync: (p: P) => <svg {...base} {...sz(p, 16)}><path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4M4 4v5h5M20 20v-5h-5" /></svg>,
  plan: (p: P) => <svg {...base} {...sz(p, 22)}><path d="M4 4.5v15h16" /><path d="M7.5 15l3.5-4 3 2.5 4.5-6" /><circle cx="18.5" cy="7.5" r="1.4" /></svg>,
  progress: (p: P) => <svg {...base} {...sz(p, 22)}><path d="M3.5 18.5l5-6 4 3 8-9.5" /><path d="M15.5 6h5v5" /></svg>,
  help: (p: P) => <svg {...base} {...sz(p, 22)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01" /></svg>,
  send: (p: P) => <svg {...base} {...sz(p, 16)}><path d="M4 12l16-8-6 16-2-7z" /></svg>,
  theme: (p: P) => <svg {...base} {...sz(p, 20)}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></svg>,
  close: (p: P) => <svg {...base} {...sz(p, 18)}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  more: (p: P) => <svg {...base} {...sz(p, 18)}><circle cx="5.5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" /></svg>,
  chevron: (p: P) => <svg {...base} {...sz(p, 16)}><path d="M9 6l6 6-6 6" /></svg>,
};

export const KIND_ICON: Record<SessionKind, (p: { size?: number }) => preact.JSX.Element> = { ride: Icon.ride, strength: Icon.strength, mobility: Icon.mobility, walk: Icon.walk, run: Icon.run, other: Icon.sync };
