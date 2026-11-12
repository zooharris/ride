import { useState } from 'preact/hooks';

/**
 * A number box that keeps what the rider types (Todd, 31 Oct). A controlled
 * `type="number"` input that parses each keystroke and writes the number
 * back turns "7." into "7": the point vanishes and the cursor jumps to the
 * front. This box keeps the typed text while it has focus, reports a number
 * whenever the text is a complete number (so live estimates keep up), and
 * settles on leaving the box or pressing Enter. Shows the owner's value when
 * not focused.
 */

/** What may be typed: digits and, for a decimal box, one point (a comma counts as one). */
export function cleanNumberText(text: string, decimals: boolean): string {
  let t = text.replace(/,/g, '.').replace(decimals ? /[^0-9.]/g : /[^0-9]/g, '');
  if (decimals) {
    const i = t.indexOf('.');
    if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
  }
  return t;
}

/** The number in the text, or undefined for an empty box. "7." is 7; "." is nothing yet. */
export function parseNumberText(text: string): number | undefined {
  if (!/\d/.test(text)) return undefined;
  const n = parseFloat(text);
  return isFinite(n) ? n : undefined;
}

/** How a number shows in the box: 7.5, never 7.50; whole numbers plain. */
export function showNumber(v: number | undefined, decimals: boolean): string {
  if (v == null || !isFinite(v)) return '';
  return decimals ? String(Math.round(v * 100) / 100) : String(Math.round(v));
}

/**
 * `check` (Todd, 12 Nov): says what is wrong with a number, in plain words, or
 * nothing when it is fine. A number that fails is held back: it is never
 * handed to the owner, the box keeps showing what was typed with the reason
 * beneath it in red, and leaving the box does not throw it away, so the rider
 * can see and correct it. An empty box is not checked; the owner decides what
 * empty means.
 */
export function NumberBox({ value, onValue, decimals = false, placeholder, title, ariaLabel, style, class: cls, check }: {
  value: number | undefined;
  onValue: (v: number | undefined) => void;
  decimals?: boolean;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
  style?: string;
  class?: string;
  check?: (v: number) => string | undefined;
}) {
  const [text, setText] = useState<string | null>(null); // null: not being edited, show the owner's value
  const problem = (t: string | null): string | undefined => {
    if (t == null || !check) return undefined;
    const n = parseNumberText(t);
    return n == null ? undefined : check(n);
  };
  const [told, setTold] = useState(false); // the reason shows once the rider leaves the box, not mid-number ("2" on the way to 238)
  const wrong = told ? problem(text) : undefined;
  const settle = () => {
    if (text == null) return;
    if (problem(text)) { setTold(true); return; }
    onValue(parseNumberText(text)); setText(null); setTold(false);
  };
  const box = (
    <input
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={text ?? showNumber(value, decimals)}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel}
      style={style}
      class={cls}
      aria-invalid={wrong ? true : undefined}
      onFocus={() => setText((t) => t ?? showNumber(value, decimals))}
      onInput={(e) => {
        const el = e.target as HTMLInputElement;
        const t = cleanNumberText(el.value, decimals);
        if (t !== el.value) el.value = t;
        setText(t);
        if (told && !problem(t)) setTold(false);
        // A complete number goes up as it is typed; "7." waits for its next digit or for leaving the box.
        if (!t.endsWith('.') && !problem(t)) onValue(parseNumberText(t));
      }}
      onBlur={settle}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
  if (!check) return box;
  return <>{box}{wrong && <span class="small" style="color:var(--bad)">{wrong} Not used until it's corrected.</span>}</>;
}
