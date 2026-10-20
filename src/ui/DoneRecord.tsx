import { useState } from 'preact/hooks';
import type { DoneExercise, DoneRecord, PlannedWorkout, Workout } from '../engine/types';
import { buildDoneRecord, exerciseIdFor, isHold, lastDone, setsText, unitOf, weightText } from '../engine/record';
import { EXERCISES, type Pattern } from '../library/strength';
import { MOBILITY } from '../library/mobility';
import { getCurrentEquipment, notify } from './store';
import { saveEffort, saveRecord } from '../sync/records';
import { fmtDate } from './derived';
import { toast } from './Toast';

const PATTERN_LABEL: Record<Pattern, string> = { squat: 'Squat', 'single-leg': 'Lunge and single leg', hinge: 'Hinge', push: 'Push', pull: 'Pull', carry: 'Carry', rotate: 'Rotate', trunk: 'Trunk', hip: 'Hips and calves' };
const LB_PER_KG = 2.2046;

/**
 * "What you did": the record of a done strength, mobility or walk session.
 * As planned until the rider corrects it; Edit opens the editor in place. The
 * effort rating sits beneath it (for strength it sets the training load).
 */
export function WhatYouDid({ planned, workout, units, history }: { planned: PlannedWorkout; workout: Workout; units: 'imperial' | 'metric'; history: PlannedWorkout[] }) {
  const [editing, setEditing] = useState(false);
  const rec = planned.done ?? buildDoneRecord(workout, planned.loggedSeconds ? Math.round(planned.loggedSeconds / 60) : undefined);
  if (!rec) return null;
  const unit = unitOf(units);
  return (
    <div class="stack" style="gap:12px">
      {editing
        ? <DoneEditor planned={planned} workout={workout} rec={rec} units={units} history={history} onClose={() => setEditing(false)} />
        : (
          <div class="panel">
            {rec.walk && (
              <div class="done-row">
                <b>Walk</b>
                <span class="num">{rec.walk.minutes} min{rec.walk.packKg ? ` · ${unit === 'kg' ? `${Math.round(rec.walk.packKg)} kg` : `${Math.round(rec.walk.packKg * LB_PER_KG)} lb`} pack` : ''}</span>
              </div>
            )}
            {(rec.exercises ?? []).map((e, i) => (
              <div class={`done-row${e.skipped ? ' skipped' : ''}`} key={i}>
                <b>{e.name}</b>
                <span class="num">{e.skipped ? 'skipped' : [setsText(e), weightText(e, unit)].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
            {!rec.walk && !(rec.exercises ?? []).length && <p class="muted small">Nothing recorded yet.</p>}
            <div class="row between wrap" style="gap:8px;margin-top:10px">
              <span class="faint small">{rec.editedAt ? `Edited ${fmtDate(rec.editedAt.slice(0, 10))}.` : 'As planned. Edit it if you changed anything: an exercise, the sets, reps or weight.'}</span>
              <button class="btn sm" onClick={() => setEditing(true)}>Edit</button>
            </div>
          </div>
        )}
      <Effort planned={planned} workout={workout} fallback={rec} />
    </div>
  );
}

function Effort({ planned, workout, fallback }: { planned: PlannedWorkout; workout: Workout; fallback: DoneRecord }) {
  const [busy, setBusy] = useState(false);
  const pick = async (n: number) => {
    setBusy(true);
    await saveEffort(planned, workout, n, fallback);
    notify();
    setBusy(false);
  };
  return (
    <div class="field">
      <label>How hard was it, 1 easy to 10 all-out</label>
      <div class="effort-chips">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <button key={n} disabled={busy} class={`chip${planned.rpe === n ? ' on' : ''}`} onClick={() => pick(n)}>{n}</button>)}</div>
      <span class="faint small">{workout.kind === 'strength' ? 'Sets the training load for this session: heart rate under-reads lifting.' : 'For your records and the coach.'}</span>
    </div>
  );
}

/** The list an exercise can be changed to: strength by movement pattern for the rider's equipment, or the stretches. */
function choices(kind: Workout['kind']): Array<{ group: string; items: Array<{ id: string; name: string }> }> {
  if (kind === 'mobility') return [{ group: 'Stretches', items: MOBILITY.map((m) => ({ id: m.id, name: m.name })) }];
  const have = getCurrentEquipment();
  const order: Pattern[] = ['squat', 'single-leg', 'hinge', 'push', 'pull', 'carry', 'rotate', 'trunk', 'hip'];
  return order.map((p) => ({ group: PATTERN_LABEL[p], items: EXERCISES.filter((e) => e.pattern === p && e.equipment.some((q) => have.includes(q))).map((e) => ({ id: e.id, name: e.name })) })).filter((g) => g.items.length);
}

function fromLibrary(id: string): Partial<DoneExercise> | undefined {
  const s = EXERCISES.find((e) => e.id === id);
  if (s) return { name: s.name, exerciseId: s.id, cue: s.cue, why: s.why, equipment: s.equipment };
  const m = MOBILITY.find((x) => x.id === id);
  if (m) return { name: m.name, exerciseId: m.id, cue: m.cue, why: m.why, equipment: m.equipment, holdSeconds: m.holdSeconds };
  return undefined;
}

/** Edit what was done: exercise (from the app's list), sets, reps, weight, hold, skipped; walks: minutes and pack. */
export function DoneEditor({ planned, workout, rec, units, history, onClose }: { planned: PlannedWorkout; workout: Workout; rec: DoneRecord; units: 'imperial' | 'metric'; history: PlannedWorkout[]; onClose: () => void }) {
  const unit = unitOf(units);
  const clone = (r: DoneRecord): DoneRecord => JSON.parse(JSON.stringify(r));
  const [draft, setDraft] = useState<DoneRecord>(clone(rec));
  const [busy, setBusy] = useState(false);
  const groups = choices(workout.kind);
  const set = (i: number, patch: Partial<DoneExercise>) => setDraft({ ...draft, exercises: (draft.exercises ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const remove = (i: number) => setDraft({ ...draft, exercises: (draft.exercises ?? []).filter((_, j) => j !== i) });
  const add = () => {
    const first = groups[0]?.items[0];
    const lib = first ? fromLibrary(first.id) : undefined;
    setDraft({ ...draft, exercises: [...(draft.exercises ?? []), { name: lib?.name ?? 'Exercise', ...lib, sets: workout.kind === 'mobility' ? 1 : 3, reps: workout.kind === 'mobility' ? undefined : '10' }] });
  };
  const num = (v: string): number | undefined => { const n = parseFloat(v); return isFinite(n) && n >= 0 ? n : undefined; };
  const save = async () => {
    setBusy(true);
    const clean: DoneRecord = {
      ...draft,
      exercises: draft.exercises?.map((e) => ({ ...e, unit: e.weight != null ? (e.unit ?? unit) : undefined, exerciseId: e.exerciseId ?? exerciseIdFor(e.name) })),
    };
    try { await saveRecord(planned, workout, clean); notify(); toast({ ok: true, text: 'Saved what you did.' }); onClose(); }
    catch (e) { toast({ ok: false, text: `Could not save: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const plannedRec = buildDoneRecord(workout, planned.loggedSeconds ? Math.round(planned.loggedSeconds / 60) : undefined);
  return (
    <div class="panel done-editor">
      {draft.walk && (
        <div class="done-edit-fields">
          <div class="field"><label>Minutes walked</label><input type="number" min="1" value={draft.walk.minutes} onInput={(e) => setDraft({ ...draft, walk: { ...draft.walk!, minutes: num((e.target as HTMLInputElement).value) ?? draft.walk!.minutes } })} /></div>
          <div class="field"><label>Pack weight ({unit}, 0 for none)</label><input type="number" min="0" step="0.5" value={draft.walk.packKg ? Math.round(draft.walk.packKg * (unit === 'kg' ? 1 : LB_PER_KG)) : 0} onInput={(e) => { const v = num((e.target as HTMLInputElement).value) ?? 0; setDraft({ ...draft, walk: { ...draft.walk!, packKg: v ? (unit === 'kg' ? v : v / LB_PER_KG) : undefined } }); }} /></div>
        </div>
      )}
      {(draft.exercises ?? []).map((e, i) => {
        const last = workout.kind === 'strength' ? lastDone(e.name, history, planned.date) : undefined;
        const hold = isHold(e);
        const key = e.exerciseId ?? exerciseIdFor(e.name) ?? `name:${e.name}`;
        const inList = groups.some((g) => g.items.some((x) => x.id === key));
        return (
          <div class={`done-edit${e.skipped ? ' skipped' : ''}`} key={i}>
            <div class="row" style="gap:8px;align-items:flex-end">
              <div class="field" style="flex:1;min-width:0">
                <label>{workout.kind === 'mobility' ? 'Stretch' : 'Exercise'}</label>
                <select value={key} onChange={(ev) => { const v = (ev.target as HTMLSelectElement).value; const lib = fromLibrary(v); if (lib) set(i, { ...lib, holdSeconds: lib.holdSeconds ?? e.holdSeconds }); }}>
                  {!inList && <option value={key}>{e.name}</option>}
                  {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
                </select>
              </div>
              <button class="icon-btn" title="Remove this exercise from the record" aria-label={`Remove ${e.name}`} onClick={() => remove(i)}>×</button>
            </div>
            <div class="done-edit-fields">
              <div class="field"><label>Sets</label><input type="number" min="1" value={e.sets ?? ''} onInput={(ev) => set(i, { sets: num((ev.target as HTMLInputElement).value) })} /></div>
              {hold
                ? <div class="field"><label>Hold (seconds)</label><input type="number" min="1" value={e.holdSeconds ?? ''} onInput={(ev) => set(i, { holdSeconds: num((ev.target as HTMLInputElement).value) })} /></div>
                : <div class="field"><label>Reps</label><input value={e.reps ?? ''} placeholder="10" onInput={(ev) => set(i, { reps: (ev.target as HTMLInputElement).value || undefined })} /></div>}
              {workout.kind === 'strength' && (!hold || e.weight != null) && (
                <div class="field"><label>Weight ({unit})</label><input type="number" min="0" step="0.5" value={e.weight ?? ''} placeholder={last ? `last ${last.weight}` : 'none'} onInput={(ev) => set(i, { weight: num((ev.target as HTMLInputElement).value), unit })} /></div>
              )}
              <label class="done-skip"><input type="checkbox" checked={!!e.skipped} onChange={(ev) => set(i, { skipped: (ev.target as HTMLInputElement).checked || undefined })} /> Skipped</label>
            </div>
            {last && <p class="faint small" style="margin:2px 0 0">Last time: {weightText(last)} · {setsText(last)} · {fmtDate(last.date)}</p>}
          </div>
        );
      })}
      {draft.exercises && <button class="btn sm quiet" style="margin-left:-8px;align-self:flex-start" onClick={add}>+ Add an exercise</button>}
      <div class="row wrap" style="gap:8px;margin-top:12px">
        <button class="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button class="btn" onClick={onClose} disabled={busy}>Cancel</button>
        {plannedRec && <button class="btn quiet" disabled={busy} onClick={() => setDraft(clone(plannedRec))} title="Start again from the session as it was planned">Reset to planned</button>}
      </div>
    </div>
  );
}

/** The planned exercises or stretches as a compact list, for "What was planned". */
export function PlannedList({ workout }: { workout: Workout }) {
  if (workout.walk) return <p class="small">{workout.walk.minutes} min walk{workout.walk.packKg ? ` with a ${Math.round(workout.walk.packKg * LB_PER_KG)} lb pack` : ''}, heart rate {workout.walk.hrLow ? `${Math.round(workout.walk.hrLow * 100)}–` : 'up to '}{Math.round(workout.walk.hrHigh * 100)}% of max.</p>;
  return (
    <div>
      {(workout.exercises ?? []).map((e, i) => (
        <div class="done-row" key={i}>
          <span>{e.name}{e.load ? <span class="faint small"> · {e.load}</span> : null}</span>
          <span class="num muted">{setsText(e)}</span>
        </div>
      ))}
    </div>
  );
}
