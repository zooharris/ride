import { useState } from 'preact/hooks';
import type { PlannedWorkout, Workout } from '../engine/types';
import { loggedTss } from '../engine/sessions';
import { db } from '../data/db';
import { notify } from './store';
import { credentials } from '../sync/syncService';
import { createManualActivity } from '../sync/intervals';

/**
 * Logging for sessions that no device records: one tap for done, an optional
 * effort score, and the record goes to Intervals.icu as a manual activity so it
 * counts like everything else. If Intervals.icu cannot be reached the session
 * is still marked done here.
 */
export function SessionLog({ planned, workout, defaultMinutes }: { planned: PlannedWorkout; workout: Workout; defaultMinutes: number }) {
  const [rpe, setRpe] = useState<number>(workout.kind === 'strength' ? 7 : workout.kind === 'walk' ? 4 : 3);
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function done() {
    setBusy(true);
    const seconds = minutes * 60;
    const tss = loggedTss(workout, seconds, rpe);
    let note = 'Marked done.';
    try {
      const c = await credentials();
      if (c) {
        const type = workout.kind === 'walk' ? 'Walk' : workout.kind === 'strength' ? 'WeightTraining' : 'Yoga';
        const id = await createManualActivity(c, { date: planned.date, name: workout.name, type, seconds, tss, rpe, description: workout.purpose });
        if (id) note = 'Marked done and recorded on Intervals.icu.';
      }
    } catch (e) {
      note = `Marked done here; Intervals.icu did not take the record (${(e as Error).message}).`;
    }
    await db.planned.update(planned.id, { status: 'completed', rpe, loggedSeconds: seconds });
    notify();
    setMsg(note);
    setBusy(false);
  }

  if (planned.status === 'completed') {
    return <div class="msg ok">Done{planned.rpe ? `, effort ${planned.rpe}/10` : ''}{planned.loggedSeconds ? `, ${Math.round(planned.loggedSeconds / 60)} min` : ''}.</div>;
  }
  return (
    <div class="panel">
      <div class="row wrap" style="gap:14px">
        <div class="field"><label>Minutes</label><input type="number" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value) || defaultMinutes)} style="width:80px" /></div>
        <div class="field"><label>How hard, 1 easy to 10 all-out</label>
          <div class="chips">{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} class={`chip${rpe === n ? ' on' : ''}`} onClick={() => setRpe(n)}>{n}</button>)}</div></div>
      </div>
      <button class="btn primary" style="margin-top:12px" onClick={done} disabled={busy}>{busy ? 'Saving…' : 'Mark done'}</button>
      {msg && <p class="muted small" style="margin-top:8px">{msg}</p>}
      <p class="faint small" style="margin-top:8px">If a watch or app already recorded this, skip this and press Sync instead; it will be matched by date.</p>
    </div>
  );
}
