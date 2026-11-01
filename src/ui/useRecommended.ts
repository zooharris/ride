import { useEffect, useRef, useState } from 'preact/hooks';
import type { Replan } from '../engine/adapt';
import type { AppData } from './store';
import type { Recommended } from './planService';
import { onJudgment, recommendFor } from './judgeService';

/**
 * The recommended changes, the same way on every screen that shows them. With
 * the coach judging, its changes; while a new judgment is being made,
 * `checking` is true and the screen shows "Checking your plan…" and no list,
 * then the coach's list, or after the wait the app's own. Once the coach has
 * not answered in this view it is not waited for again here; its judgment,
 * when it comes, replaces the list (onJudgment). Works with no plan too: the
 * coach may recommend changes to sessions the rider placed by hand.
 */
export function useRecommended(data: AppData, check: Replan | null): { rec: Recommended | null; checking: boolean } {
  const [rec, setRec] = useState<Recommended | null>(null);
  const [checking, setChecking] = useState(false);
  const [bump, setBump] = useState(0);
  const gaveUp = useRef(false);
  useEffect(() => onJudgment(() => setBump((b) => b + 1)), []);
  useEffect(() => {
    let alive = true;
    if (!data.profile) { setRec(null); setChecking(false); return; }
    (async () => {
      const r = await recommendFor(data, check, () => { if (alive) setChecking(true); }, gaveUp.current);
      if (r.fellBack) gaveUp.current = true;
      if (!alive) return;
      setRec(r);
      setChecking(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, bump, data.planned]);
  return { rec, checking };
}
