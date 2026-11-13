import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * The width of an element in CSS pixels, kept current as it resizes. Charts
 * draw at this width so their text and line weights stay the same size on a
 * phone and on a wide laptop, rather than scaling with the window.
 */
export function useWidth<T extends HTMLElement = HTMLDivElement>(fallback = 480): [preact.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  // 13 Nov 2026 (found by the journeys): the element can appear after the first render (a page that
  // first shows "loading"), so watch for it on every render rather than only once, or the fallback
  // width sticks and a phone gets the three-column layout.
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => { if (ref.current !== el) setEl(ref.current); });
  useEffect(() => {
    if (!el) return;
    const first = Math.round(el.getBoundingClientRect().width);
    if (first > 0) setW(first);
    const ro = new ResizeObserver((es) => { const cw = Math.round(es[0].contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w];
}
