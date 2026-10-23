import { useEffect, useRef, useState } from 'preact/hooks';
import type { Replan } from '../engine/adapt';
import type { AppData } from './store';
import { recommendFor, type Recommended } from './planService';

/**
 * Batch 7, A2: the recommended changes for a re-check, the same way on every
 * screen that shows them. While the coach is being asked, `checking` is true
 * and the screen shows "Checking your plan…" and no list; then the coach's list,
 * or after ten seconds the app's own. Once the coach has failed to answer in
 * this view it is not waited for again here (an accepted change would otherwise
 * start a second wait); its answer, when it comes, is used the next time.
 */
export function useRecommended(data: AppData, check: Replan | null): { rec: Recommended | null; checking: boolean } {
  const [rec, setRec] = useState<Recommended | null>(null);
  const [checking, setChecking] = useState(false);
  const gaveUp = useRef(false);
  useEffect(() => {
    let alive = true;
    if (!check) { setRec(null); setChecking(false); return; }
    (async () => {
      const r = await recommendFor(data, check, () => { if (alive) setChecking(true); }, gaveUp.current);
      if (r.fellBack) gaveUp.current = true;
      if (!alive) return;
      setRec(r);
      setChecking(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);
  return { rec, checking };
}
