import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * A small sheet for naming something (a plan): a text field, Save and Cancel.
 * The app's own replacement for the browser's prompt(). Enter saves, Escape
 * cancels; Save is off while the name is empty or unchanged.
 */
export function NameSheet({ title, label = 'Name', initial, onSave, onClose }: { title: string; label?: string; initial: string; onSave: (name: string) => void | Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const name = value.trim();
  const can = !!name && name !== initial.trim() && !busy;
  async function save() {
    if (!can) return;
    setBusy(true);
    try { await onSave(name); onClose(); } finally { setBusy(false); }
  }
  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:460px" role="dialog" aria-label={title}>
        <div class="row between" style="margin-bottom:12px"><h2>{title}</h2><button class="btn sm quiet" onClick={onClose}>Cancel</button></div>
        <div class="field">
          <label for="name-sheet-input">{label}</label>
          <input id="name-sheet-input" ref={input} value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } else if (e.key === 'Escape') onClose(); }} />
        </div>
        <div class="row" style="gap:8px;margin-top:14px">
          <button class="btn primary" onClick={save} disabled={!can}>{busy ? 'Saving…' : 'Save'}</button>
          <button class="btn quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
