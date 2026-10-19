/**
 * The one visual language for "where does this session stand", used on every
 * row that lists a session: the calendar (list and month), Today and Next up.
 * The mark sits at the left edge, before the kind icon, so state reads before
 * the name; the pill repeats it in a word at the right.
 *
 *   done    filled green circle with a tick
 *   todo    an empty ring (scheduled, not yet sent)
 *   sent    a ring with an arrow (on the Garmin, not done)
 *   missed  a grey ring with a dash
 */
export type SessionStatus = 'done' | 'todo' | 'sent' | 'missed';

export function statusOf(s: 'planned' | 'sent' | 'completed' | 'missed'): SessionStatus {
  return s === 'completed' ? 'done' : s === 'sent' ? 'sent' : s === 'missed' ? 'missed' : 'todo';
}

export const STATUS_WORD: Record<SessionStatus, string> = { done: 'Done', todo: 'To do', sent: 'On Garmin', missed: 'Missed' };

export function StatusMark({ status, size = 18, title }: { status: SessionStatus; size?: number; title?: string }) {
  const label = title ?? STATUS_WORD[status];
  const common = { width: size, height: size, viewBox: '0 0 20 20', role: 'img', 'aria-label': label, style: `flex:0 0 ${size}px;display:block` } as const;
  if (status === 'done') {
    return (
      <svg {...common}>
        <title>{label}</title>
        <circle cx="10" cy="10" r="9" fill="var(--good)" />
        <path d="M6 10.4l2.6 2.6L14.4 7.4" fill="none" stroke="var(--on-color)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  }
  if (status === 'sent') {
    return (
      <svg {...common}>
        <title>{label}</title>
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="var(--z2)" stroke-width="1.6" />
        <path d="M6.5 10h6.5M10.5 7.5L13 10l-2.5 2.5" fill="none" stroke="var(--z2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    );
  }
  if (status === 'missed') {
    return (
      <svg {...common}>
        <title>{label}</title>
        <circle cx="10" cy="10" r="8.2" fill="none" stroke="var(--ink-3)" stroke-width="1.6" />
        <path d="M6.5 10h7" fill="none" stroke="var(--ink-3)" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <title>{label}</title>
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="var(--ink-3)" stroke-width="1.6" />
    </svg>
  );
}

export function StatusPill({ status }: { status: SessionStatus }) {
  const colour = status === 'done' ? 'var(--good)' : status === 'sent' ? 'var(--z2)' : 'var(--ink-3)';
  return <span class={`pill status-pill ${status}`} style={`color:${colour};border-color:color-mix(in srgb, ${colour} 45%, var(--line))`}>{STATUS_WORD[status]}</span>;
}
