import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The app's own yes-or-no question (27 Nov 2026), in place of the browser's confirm(). A web page opened from an
 * iPhone's Home Screen can drop the browser's pop-up without showing it, and the app then takes that as "no": a backup
 * file was chosen at first run and nothing happened. This one is drawn by the app, so it is the same everywhere.
 *
 * The words keep the shape they had: the first paragraph is the question, the rest explains what will happen.
 */
interface Asked { text: string; ok: string; cancel: string; done: (yes: boolean) => void }

let show: ((q: Asked | null) => void) | undefined;
const waiting: Asked[] = [];
let open: Asked | null = null;

function next(): void {
  if (open || !show) return;
  open = waiting.shift() ?? null;
  show(open);
}

export function ask(text: string, words?: { ok?: string; cancel?: string }): Promise<boolean> {
  // With nowhere to draw it (a test of the logic alone), the browser's own is used.
  if (!show) return Promise.resolve(typeof confirm === 'function' ? confirm(text) : true);
  return new Promise((resolve) => {
    waiting.push({ text, ok: words?.ok ?? 'OK', cancel: words?.cancel ?? 'Cancel', done: resolve });
    next();
  });
}

/** Drawn once, at the top of the app. */
export function AskHost() {
  const [q, setQ] = useState<Asked | null>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { show = setQ; next(); return () => { show = undefined; }; }, []);
  const answer = (yes: boolean) => { const was = open; open = null; setQ(null); was?.done(yes); next(); };
  useEffect(() => {
    if (!q) return;
    ok.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); } };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [q]);
  if (!q) return null;
  const [head, ...rest] = q.text.split(/\n\n+/);
  return (
    <div class="ask-veil" onClick={(e) => { if (e.target === e.currentTarget) answer(false); }}>
      <div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-head" data-words={q.text}>
        <h2 id="ask-head">{head}</h2>
        {rest.map((p, i) => <p key={i}>{p}</p>)}
        <div class="ask-btns">
          <button class="btn" onClick={() => answer(false)}>{q.cancel}</button>
          <button class="btn primary" ref={ok} onClick={() => answer(true)}>{q.ok}</button>
        </div>
      </div>
    </div>
  );
}
