import type { ComponentChildren } from 'preact';
import { Shot, type ShotName } from './Shot';

/**
 * The parts Help's articles are made of (26 Nov 2026): numbered steps with a picture beside each, short notes set
 * apart from the text, and the full detail folded away at the foot. An article is a page a rider can take in at a
 * glance: a sentence of what it is for, a handful of steps, and no more than a few notes.
 */

export function Steps({ children }: { children: ComponentChildren }) {
  return <ol class="h-steps">{children}</ol>;
}

/** One step: what to do, in a line or two, with the screen it happens on. */
export function Step({ title, shot, alt, children }: { title: string; shot?: ShotName; alt?: string; children?: ComponentChildren }) {
  return (
    <li class={`h-step${shot ? ' has-shot' : ''}`}>
      <div class="h-step-text">
        <h3>{title}</h3>
        {children && <div class="h-step-body">{children}</div>}
      </div>
      {shot && <Shot name={shot} alt={alt ?? title} />}
    </li>
  );
}

const NOTE_WORD = { tip: 'Tip', know: 'Good to know', warn: 'Take care' } as const;
/** A short note set apart from the steps. */
export function Note({ kind = 'know', title, children }: { kind?: keyof typeof NOTE_WORD; title?: string; children: ComponentChildren }) {
  return (
    <aside class={`h-note k-${kind}`}>
      <b class="h-note-word">{title ?? NOTE_WORD[kind]}</b>
      <div>{children}</div>
    </aside>
  );
}

/** A row of short facts, each with a heading: for "what it holds / what it does not", "three versions", and the like. */
export function Facts({ items }: { items: Array<{ title: string; text: ComponentChildren }> }) {
  return <div class="h-facts">{items.map((f) => <div class="h-fact" key={f.title}><b>{f.title}</b><span>{f.text}</span></div>)}</div>;
}
