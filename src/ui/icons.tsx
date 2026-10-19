import type { SessionKind } from '../engine/types';

/** Line icons drawn to one 24-unit grid so they sit evenly beside text. */
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

export const Icon = {
  ride: (p: { size?: number }) => <svg {...base} width={p.size ?? 18} height={p.size ?? 18}><circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" /><path d="M5.5 17l4-8h5l4 8M9.5 9l-1.5-3h3" /></svg>,
  strength: (p: { size?: number }) => <svg {...base} width={p.size ?? 18} height={p.size ?? 18}><path d="M3 10v4M21 10v4M6 8v8M18 8v8M6 12h12" /></svg>,
  mobility: (p: { size?: number }) => <svg {...base} width={p.size ?? 18} height={p.size ?? 18}><circle cx="12" cy="4.5" r="1.8" /><path d="M12 7v6M7 10l5 3 5-3M9 20l3-7 3 7" /></svg>,
  walk: (p: { size?: number }) => <svg {...base} width={p.size ?? 18} height={p.size ?? 18}><circle cx="13" cy="4" r="1.8" /><path d="M9.5 21l2-6-2.5-2 1-5 3 1 2 3h2M14 14l1.5 2 1.5 5M9 10l-3 3" /></svg>,
  sun: (p: { size?: number }) => <svg {...base} width={p.size ?? 22} height={p.size ?? 22}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>,
  calendar: (p: { size?: number }) => <svg {...base} width={p.size ?? 22} height={p.size ?? 22}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  library: (p: { size?: number }) => <svg {...base} width={p.size ?? 22} height={p.size ?? 22}><path d="M4 20V9M9 20V4M14 20v-8M19 20V7" /></svg>,
  settings: (p: { size?: number }) => <svg {...base} width={p.size ?? 22} height={p.size ?? 22}><circle cx="12" cy="12" r="3" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>,
  check: (p: { size?: number }) => <svg {...base} width={p.size ?? 16} height={p.size ?? 16}><path d="M5 12l4 4L19 7" /></svg>,
  sync: (p: { size?: number }) => <svg {...base} width={p.size ?? 16} height={p.size ?? 16}><path d="M20 11a8 8 0 0 0-14.5-4M4 13a8 8 0 0 0 14.5 4M4 4v5h5M20 20v-5h-5" /></svg>,
  help: (p: { size?: number }) => <svg {...base} width={p.size ?? 22} height={p.size ?? 22}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17h.01" /></svg>,
  send: (p: { size?: number }) => <svg {...base} width={p.size ?? 16} height={p.size ?? 16}><path d="M4 12l16-8-6 16-2-7z" /></svg>,
};

export const KIND_ICON: Record<SessionKind, (p: { size?: number }) => preact.JSX.Element> = { ride: Icon.ride, strength: Icon.strength, mobility: Icon.mobility, walk: Icon.walk, other: Icon.sync };
