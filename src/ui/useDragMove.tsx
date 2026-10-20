import { useEffect, useRef, useState } from 'preact/hooks';
import { today } from '../engine/load';

interface Drag { id: string; from: string; name: string; x: number; y: number; over?: string }

/**
 * Drag a calendar session onto another day, with a mouse. A press that moves
 * less than 6 px is still a click (it opens the session). Any element with a
 * data-date attribute is a day to drop on; days before today refuse the drop.
 * Touch screens use the ⋯ sheet instead, so scrolling a phone never moves a
 * session by accident.
 */
export function useDragMove(onDrop: (id: string, date: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const canDrop = (d: Drag | null, date?: string) => !!d && !!date && date !== d.from && date >= today();

  function source(id: string, from: string, name: string) {
    return {
      draggable: false,
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        const sx = e.clientX, sy = e.clientY;
        let started = false;
        let cur: Drag | null = null;
        const move = (ev: PointerEvent) => {
          if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          if (!started) { started = true; document.body.classList.add('dragging-session'); }
          const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-date]');
          cur = { id, from, name, x: ev.clientX, y: ev.clientY, over: el?.getAttribute('data-date') ?? undefined };
          setDrag(cur);
        };
        const end = (drop: boolean) => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('keydown', key);
          document.body.classList.remove('dragging-session');
          cleanup.current = null;
          if (started) {
            suppressClick.current = true;
            setTimeout(() => { suppressClick.current = false; }, 0);
            if (drop && cur && canDrop(cur, cur.over)) onDrop(id, cur.over!);
          }
          setDrag(null);
        };
        const up = () => end(true);
        const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') end(false); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('keydown', key);
        cleanup.current = () => end(false);
      },
      onClickCapture: (e: MouseEvent) => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); } },
    };
  }

  /** Class for a day while something is dragged over it. */
  function dropClass(date: string): string {
    if (!drag || drag.over !== date) return '';
    return canDrop(drag, date) ? 'drop-ok' : date === drag.from ? '' : 'drop-no';
  }

  const ghost = drag ? <div class="drag-ghost" style={`left:${drag.x + 12}px;top:${drag.y + 10}px`} aria-hidden="true">{drag.name}</div> : null;
  return { source, dropClass, ghost, dragging: drag?.id ?? null };
}
