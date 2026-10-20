import { useState } from 'preact/hooks';
import type { PlannedWorkout, Ride, Workout } from '../engine/types';
import { clock } from '../engine/workout';
import { loggedTss } from '../engine/sessions';
import { today } from '../engine/load';
import { db } from '../data/db';
import { notify } from './store';
import { credentials, unmatchRecording } from '../sync/syncService';
import { createManualActivity } from '../sync/intervals';

/**
 * Logging for sessions that no device records: one tap for done, an optional
 * effort score, and the record goes to Intervals.icu as a manual activity so it
 * counts like everything else. If Intervals.icu cannot be reached the session
 * is still marked done here.
 */
export function SessionLog({ planned, workout, defaultMinutes, recording }: { planned: PlannedWorkout; workout: Workout; defaultMinutes: number; recording?: Ride }) {
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

  const notThis = async () => {
    const when = recording ? ` (${recording.name}, ${clock(recording.seconds)})` : '';
    if (!confirm(`Was the recording${when} something else, not ${workout.name}?\n\n${workout.name} goes back to to-do${planned.date < today() ? ' (missed, as its day has passed)' : ''}. The recording stays as an extra activity and still counts toward your training load. The app will not match it to this session again.`)) return;
    setBusy(true);
    await unmatchRecording(planned.id);
    notify();
    setBusy(false);
  };
  const notThisButton = <button class="btn sm quiet" onClick={notThis} disabled={busy} title="The recording was an extra workout, not this session; put this session back to to-do">Not this session</button>;
  if (planned.status === 'completed') {
    if (recording) {
      return (
        <div class="msg ok row between wrap" style="gap:10px">
          <span>Done · {clock(recording.seconds)} recorded{recording.tss != null ? ` · training load ${recording.tss} TSS` : ''}{recording.averageHr ? ` · average heart rate ${Math.round(recording.averageHr)} bpm` : ''}.</span>
          <span class="row" style="gap:6px">{notThisButton}<a class="btn sm" href={`#/rides/${recording.id}`}>See the recording ›</a></span>
        </div>
      );
    }
    if (planned.activityId) {
      return <div class="msg ok row between wrap" style="gap:10px"><span>Done. The recording is in Intervals.icu; press Sync on Today to bring it to this device.</span>{notThisButton}</div>;
    }
    return <div class="msg ok">Done, logged by hand{planned.loggedSeconds ? ` · ${Math.round(planned.loggedSeconds / 60)} min` : ''}{planned.rpe ? ` · effort ${planned.rpe}/10` : ''}. No recording.</div>;
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
