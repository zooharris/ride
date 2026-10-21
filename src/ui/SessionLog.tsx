import { useState } from 'preact/hooks';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { clock } from '../engine/workout';
import { loggedTss } from '../engine/sessions';
import { buildDoneRecord, recordText } from '../engine/record';
import { db } from '../data/db';
import { notify } from './store';
import { credentials } from '../sync/syncService';
import { createManualActivity } from '../sync/intervals';
import { undoHandLog } from '../sync/records';
import { WhatYouDid } from './DoneRecord';
import { toast } from './Toast';

/**
 * A session on its planning page. Not done: log it by hand (one tap for done,
 * an effort score, and a manual activity in Intervals.icu so it counts like
 * everything else). Done with a recording: one line pointing to how it went,
 * where the record lives. Done by hand: the record of what was done, editable,
 * with an undo.
 */
export function SessionLog({ planned, workout, defaultMinutes, recording, units, history }: { planned: PlannedWorkout; workout: Workout; defaultMinutes: number; recording?: Ride; units: 'imperial' | 'metric'; history: PlannedWorkout[] }) {
  const [rpe, setRpe] = useState<number>(workout.kind === 'strength' ? 7 : workout.kind === 'walk' || workout.kind === 'run' ? 4 : 3);
  const [distance, setDistance] = useState('');   // runs: optional, in miles or km
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function done() {
    setBusy(true);
    const seconds = minutes * 60;
    const tss = loggedTss(workout, seconds, rpe);
    const rec = buildDoneRecord(workout, minutes);
    let note = 'Marked done.';
    let manual: string | undefined;
    try {
      const c = await credentials();
      if (c) {
        const type = workout.kind === 'walk' ? 'Walk' : workout.kind === 'run' ? 'Run' : workout.kind === 'strength' ? 'WeightTraining' : workout.kind === 'mobility' ? 'Yoga' : 'Ride';
        const dist = workout.kind === 'run' ? Number(distance) : 0;
        const description = rec ? recordText(workout.name, rec, rpe, units) : workout.purpose;
        manual = await createManualActivity(c, { date: planned.date, name: workout.name, type, seconds, tss, rpe, description, distanceM: dist > 0 ? Math.round(dist * (units === 'imperial' ? 1609.344 : 1000)) : undefined }) || undefined;
        if (manual) note = 'Marked done and recorded on Intervals.icu.';
      }
    } catch (e) {
      note = `Marked done here; Intervals.icu did not take the record (${(e as Error).message}).`;
    }
    await db.planned.update(planned.id, { status: 'completed', rpe, loggedSeconds: seconds, done: rec, manualActivityId: manual });
    notify();
    setMsg(note);
    setBusy(false);
  }

  async function undo() {
    const remote = planned.manualActivityId ? ', and the activity the app created for it in Intervals.icu is deleted' : '';
    if (!confirm(`Mark ${workout.name} as not done?\n\nIts record here is removed${remote}. It goes back to to-do.`)) return;
    setBusy(true);
    await undoHandLog(planned);
    notify();
    toast({ ok: true, text: `${workout.name} is back to to-do.` });
    setBusy(false);
  }

  if (planned.status === 'completed') {
    if (recording && !planned.loggedSeconds) {
      return (
        <div class="msg ok row between wrap" style="gap:10px">
          <span>Done · {clock(recording.seconds)} recorded{recording.tss != null ? ` · training load ${recording.tss} TSS` : ''}.</span>
          <a class="btn sm" href={`#/rides/${recording.id}`}>See how it went ›</a>
        </div>
      );
    }
    if (planned.activityId && !planned.loggedSeconds) {
      return <div class="msg ok">Done. The recording is in Intervals.icu; press Sync on Today to bring it to this device and see how it went.</div>;
    }
    return (
      <div class="stack" style="gap:12px">
        <div class="msg ok row between wrap" style="gap:10px">
          <span>Done, logged by hand{planned.loggedSeconds ? ` · ${Math.round(planned.loggedSeconds / 60)} min` : ''}.</span>
          <button class="btn sm quiet" onClick={undo} disabled={busy}>Undo: not done yet</button>
        </div>
        {workout.kind !== 'ride' && <><h3 style="margin:4px 0 0">What you did</h3><WhatYouDid planned={planned} workout={workout} units={units} history={history} /></>}
      </div>
    );
  }
  return (
    <div class="panel">
      <div class="row wrap" style="gap:14px">
        <div class="field"><label>Minutes</label><input type="number" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value) || defaultMinutes)} style="width:80px" /></div>
        {workout.kind === 'run' && <div class="field"><label>Distance ({units === 'imperial' ? 'miles' : 'km'}, optional)</label><input type="number" min="0" step="0.1" inputMode="decimal" value={distance} onInput={(e) => setDistance((e.target as HTMLInputElement).value)} style="width:90px" /></div>}
        <div class="field"><label>How hard was it? 1 easy, 10 all-out</label>
          <div class="chips">{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <button key={n} class={`chip${rpe === n ? ' on' : ''}`} onClick={() => setRpe(n)}>{n}</button>)}</div></div>
      </div>
      <button class="btn primary" style="margin-top:12px" onClick={done} disabled={busy}>{busy ? 'Saving…' : 'Mark done'}</button>
      {msg && <p class="muted small" style="margin-top:8px">{msg}</p>}
      <p class="faint small" style="margin-top:8px">If a watch or app already recorded this, skip this and press Sync instead; it will be matched by date. You can correct the exercises, sets, reps and weights once it is done.</p>
    </div>
  );
}
