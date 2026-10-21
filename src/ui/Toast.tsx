import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons';

/**
 * Results of Sync, Send and Save, shown as a toast at the bottom of the screen
 * so the page does not jump. Successes go after 4 seconds; errors stay 10
 * seconds (they usually say what to do next) and can be closed by hand. A
 * toast with an action (Undo) stays five seconds; the action runs once.
 */
export interface ToastMsg { ok: boolean; text: string; action?: { label: string; run: () => void | Promise<void> } }
interface Live extends ToastMsg { id: number }

let seq = 0;
let items: Live[] = [];
const listeners = new Set<(t: Live[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

export function toast(m: ToastMsg | null | undefined): void {
  if (!m || !m.text) return;
  const id = ++seq;
  items = [...items.filter((t) => t.text !== m.text), { ...m, id }].slice(-3);
  emit();
  setTimeout(() => dismiss(id), m.action ? 5000 : m.ok ? 4000 : 10000);
}

function dismiss(id: number): void { items = items.filter((t) => t.id !== id); emit(); }

export function Toaster() {
  const [list, setList] = useState<Live[]>(items);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  if (!list.length) return null;
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.ok ? 'ok' : 'err'}`}>
          <span class="toast-dot" />
          <span class="toast-text">{t.text}</span>
          {t.action && <button class="btn sm quiet toast-action" onClick={() => { const a = t.action!; dismiss(t.id); void a.run(); }}>{t.action.label}</button>}
          <button class="icon-btn sm" aria-label="Close" onClick={() => dismiss(t.id)}><Icon.close size={16} /></button>
        </div>
      ))}
    </div>
  );
}
