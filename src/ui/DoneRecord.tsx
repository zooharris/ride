import { walkZoneWords } from '../engine/foot';
import { useState } from 'preact/hooks';
import type { ActivityEdit, DoneExercise, DoneRecord, Exercise, PlannedWorkout, Ride, Workout } from '../engine/types';
import { buildDoneRecord, exerciseIdFor, isHold, lastDone, setsText, unitOf, weightText } from '../engine/record';
import { EXERCISES, type Pattern } from '../library/strength';
import { MOBILITY } from '../library/mobility';
import { getCurrentEquipment, notify } from './store';
import { saveActivityEffort, saveActivityRecord, saveEffort, saveRecord } from '../sync/records';
import { fmtDate } from './derived';
import { toast } from './Toast';
import { ExThumb } from './ExercisePictures';
import { AddList, ExerciseSheet, countsOf, type AddItem } from './ExerciseAdd';
import { NumberBox } from './NumberBox';
import { packWords } from '../engine/units';

const PATTERN_LABEL: Record<Pattern, string> = { squat: 'Squat', 'single-leg': 'Lunge and single leg', hinge: 'Hinge', push: 'Push', pull: 'Pull', carry: 'Carry', rotate: 'Rotate', trunk: 'Trunk', hip: 'Hips and calves' };
const LB_PER_KG = 2.2046;

type Kind = Workout['kind'];

/**
 * "What you did": the record of a done strength, mobility or walk session, or
 * of an unplanned activity. As planned (or empty) until the rider corrects it;
 * Edit opens the editor in place. The effort rating sits beneath it (for
 * strength it sets the training load).
 */
export function RecordPanel({ rec, rpe, kind, date, units, history, plannedRec, onSave, onEffort, unplanned }: {
  rec: DoneRecord; rpe?: number; kind: Kind; date: string; units: 'imperial' | 'metric'; history: PlannedWorkout[];
  plannedRec?: DoneRecord; onSave: (rec: DoneRecord) => Promise<void>; onEffort: (n: number) => Promise<void>; unplanned?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const unit = unitOf(units);
  const empty = !rec.walk && !(rec.exercises ?? []).length;
  return (
    <div class="stack" style="gap:12px">
      {editing
        ? <DoneEditor rec={rec} kind={kind} date={date} units={units} history={history} plannedRec={plannedRec} onSave={onSave} onClose={() => setEditing(false)} />
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
                <span class="row" style="gap:10px;min-width:0"><ExThumb name={e.name} exerciseId={e.exerciseId} size={36} /><b>{e.name}</b></span>
                <span class="num">{e.skipped ? 'skipped' : [setsText(e), weightText(e, unit)].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
            {empty && <p class="muted small" style="margin:0">{unplanned ? `No planned session covers this, so nothing is recorded yet. Add what you did: ${kind === 'mobility' ? 'the stretches and holds' : 'the exercises, sets, reps and weights'}.` : 'Nothing recorded yet.'}</p>}
            <div class="row between wrap" style="gap:8px;margin-top:10px">
              <span class="faint small">{rec.editedAt ? `Edited ${fmtDate(rec.editedAt.slice(0, 10))}.` : empty ? '' : 'As planned. Edit it if you changed anything: an exercise, the sets, reps or weight.'}</span>
              <button class="btn sm" onClick={() => setEditing(true)}>{empty ? 'Add what you did' : 'Edit'}</button>
            </div>
          </div>
        )}
      <Effort rpe={rpe} kind={kind} onEffort={onEffort} />
    </div>
  );
}

/** The record of a planned session that is done. */
export function WhatYouDid({ planned, workout, units, history }: { planned: PlannedWorkout; workout: Workout; units: 'imperial' | 'metric'; history: PlannedWorkout[] }) {
  const plannedRec = buildDoneRecord(workout, planned.loggedSeconds ? Math.round(planned.loggedSeconds / 60) : undefined);
  const rec = planned.done ?? plannedRec;
  if (!rec) return null;
  return <RecordPanel rec={rec} rpe={planned.rpe} kind={workout.kind} date={planned.date} units={units} history={history} plannedRec={plannedRec}
    onSave={async (r) => { await saveRecord(planned, workout, r); notify(); }}
    onEffort={async (n) => { await saveEffort(planned, workout, n, rec); notify(); }} />;
}

/** The record of an activity no planned session covers (strength, mobility or a walk). */
export function ActivityWhatYouDid({ ride, edit, units, history }: { ride: Ride; edit?: ActivityEdit; units: 'imperial' | 'metric'; history: PlannedWorkout[] }) {
  const kind = ride.sport as Kind;
  const rec: DoneRecord = edit?.done ?? (kind === 'walk' ? { walk: { minutes: Math.round(ride.seconds / 60) } } : { exercises: [] });
  return <RecordPanel rec={rec} rpe={edit?.rpe} kind={kind} date={ride.date} units={units} history={history} unplanned
    onSave={async (r) => { await saveActivityRecord(ride, r); notify(); }}
    onEffort={async (n) => { await saveActivityEffort(ride, n); notify(); }} />;
}

function Effort({ rpe, kind, onEffort }: { rpe?: number; kind: Kind; onEffort: (n: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const pick = async (n: number) => { setBusy(true); try { await onEffort(n); } finally { setBusy(false); } };
  return (
    <div class="field">
      <label>How hard was it? 1 easy, 10 all-out</label>
      <div class="effort-chips">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <button key={n} disabled={busy} class={`chip${rpe === n ? ' on' : ''}`} onClick={() => pick(n)}>{n}</button>)}</div>
      <span class="faint small">{kind === 'strength' ? 'Sets the training load for this session: heart rate under-reads lifting.' : 'For your records and the coach.'}</span>
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
export function DoneEditor({ rec, kind, date, units, history, plannedRec, onSave, onClose }: { rec: DoneRecord; kind: Kind; date: string; units: 'imperial' | 'metric'; history: PlannedWorkout[]; plannedRec?: DoneRecord; onSave: (rec: DoneRecord) => Promise<void>; onClose: () => void }) {
  const unit = unitOf(units);
  const clone = (r: DoneRecord): DoneRecord => JSON.parse(JSON.stringify(r));
  const [draft, setDraft] = useState<DoneRecord>(clone(rec));
  const [busy, setBusy] = useState(false);
  const groups = choices(kind);
  const set = (i: number, patch: Partial<DoneExercise>) => setDraft({ ...draft, exercises: (draft.exercises ?? []).map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const remove = (i: number) => setDraft({ ...draft, exercises: (draft.exercises ?? []).filter((_, j) => j !== i) });
  // Adding: the same searchable list and details sheet as the session builder (13 Nov 2026).
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<{ item?: AddItem; ex: Exercise } | null>(null);
  const addItems: AddItem[] = groups.flatMap((g) => g.items.map((x) => ({
    name: x.name, group: g.group,
    make: (): Exercise => { const lib = fromLibrary(x.id)!; return { name: lib.name!, cue: lib.cue ?? '', why: lib.why, equipment: lib.equipment ?? [], holdSeconds: lib.holdSeconds, sets: kind === 'mobility' ? 1 : 3, reps: kind === 'mobility' ? undefined : '10' }; },
    id: x.id,
  })));
  const add = (i: AddItem & { id?: string }) => {
    const lib = i.id ? fromLibrary(i.id) : undefined;
    setDraft((d) => ({ ...d, exercises: [...(d.exercises ?? []), { name: lib?.name ?? i.name, ...lib, sets: kind === 'mobility' ? 1 : 3, reps: kind === 'mobility' ? undefined : '10' }] }));
  };
  const counts = countsOf(draft.exercises ?? []);
  const save = async () => {
    setBusy(true);
    const clean: DoneRecord = {
      ...draft,
      exercises: draft.exercises?.map((e) => ({ ...e, unit: e.weight != null ? (e.unit ?? unit) : undefined, exerciseId: e.exerciseId ?? exerciseIdFor(e.name) })),
    };
    try { await onSave(clean); toast({ ok: true, text: 'Saved what you did.' }); onClose(); }
    catch (e) { toast({ ok: false, text: `Could not save: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  return (
    <div class="panel done-editor">
      {draft.walk && (
        <div class="done-edit-fields">
          <div class="field"><label>Minutes walked</label><NumberBox value={draft.walk.minutes} onValue={(v) => setDraft({ ...draft, walk: { ...draft.walk!, minutes: v && v > 0 ? v : draft.walk!.minutes } })} /></div>
          <div class="field"><label>Pack weight ({unit}, 0 for none)</label><NumberBox decimals value={draft.walk.packKg ? Math.round(draft.walk.packKg * (unit === 'kg' ? 1 : LB_PER_KG) * 10) / 10 : 0} onValue={(v) => setDraft({ ...draft, walk: { ...draft.walk!, packKg: v ? (unit === 'kg' ? v : v / LB_PER_KG) : undefined } })} /></div>
        </div>
      )}
      {(draft.exercises ?? []).map((e, i) => {
        const last = kind === 'strength' ? lastDone(e.name, history, date) : undefined;
        const hold = isHold(e);
        const key = e.exerciseId ?? exerciseIdFor(e.name) ?? `name:${e.name}`;
        const inList = groups.some((g) => g.items.some((x) => x.id === key));
        return (
          <div class={`done-edit${e.skipped ? ' skipped' : ''}`} key={i}>
            <div class="row" style="gap:8px;align-items:flex-end">
              <button type="button" class="ex-thumb-btn" onClick={() => { const lib = fromLibrary(key); setSheet({ ex: { name: e.name, cue: e.cue ?? lib?.cue ?? '', why: e.why ?? lib?.why, equipment: e.equipment ?? lib?.equipment ?? [], sets: e.sets, reps: e.reps, holdSeconds: e.holdSeconds } }); }} aria-label={`Details: ${e.name}`} title="See its pictures and how to do it"><ExThumb name={e.name} exerciseId={e.exerciseId} size={44} /></button>
              <div class="field" style="flex:1;min-width:0">
                <label>{kind === 'mobility' ? 'Stretch' : 'Exercise'}</label>
                <select value={key} onChange={(ev) => { const v = (ev.target as HTMLSelectElement).value; const lib = fromLibrary(v); if (lib) set(i, { ...lib, holdSeconds: lib.holdSeconds ?? e.holdSeconds }); }}>
                  {!inList && <option value={key}>{e.name}</option>}
                  {groups.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
                </select>
              </div>
              <button class="icon-btn" title="Remove this exercise from the record" aria-label={`Remove ${e.name}`} onClick={() => remove(i)}>×</button>
            </div>
            <div class="done-edit-fields">
              <div class="field"><label>Sets</label><NumberBox value={e.sets} onValue={(v) => set(i, { sets: v || undefined })} /></div>
              {hold
                ? <div class="field"><label>Hold (seconds)</label><NumberBox value={e.holdSeconds} onValue={(v) => set(i, { holdSeconds: v || undefined })} /></div>
                : <div class="field"><label>Reps</label><input value={e.reps ?? ''} placeholder="10" onInput={(ev) => set(i, { reps: (ev.target as HTMLInputElement).value || undefined })} /></div>}
              {kind === 'strength' && (!hold || e.weight != null) && (
                <div class="field"><label>Weight ({unit})</label><NumberBox decimals value={e.weight} placeholder={last ? `last ${last.weight}` : 'none'} onValue={(v) => set(i, { weight: v, unit })} /></div>
              )}
              <label class="done-skip"><input type="checkbox" checked={!!e.skipped} onChange={(ev) => set(i, { skipped: (ev.target as HTMLInputElement).checked || undefined })} /> Skipped</label>
            </div>
            {last && <p class="faint small" style="margin:2px 0 0">Last time: {weightText(last)} · {setsText(last)} · {fmtDate(last.date)}</p>}
          </div>
        );
      })}
      {draft.exercises && (adding
        ? <AddList items={addItems} counts={counts} autoFocus placeholder={`Find ${kind === 'mobility' ? 'a stretch' : 'an exercise'} by name`} onChoose={(i) => add(i)} onDetails={(i) => setSheet({ item: i, ex: i.make() })} onClose={() => setAdding(false)} />
        : <button class="btn sm quiet" style="margin-left:-8px;align-self:flex-start" onClick={() => setAdding(true)}>+ Add {kind === 'mobility' ? 'a stretch' : 'an exercise'}</button>)}
      {sheet && <ExerciseSheet ex={sheet.ex} count={sheet.item ? counts.get(sheet.ex.name) ?? 0 : 0} addLabel="Add to what you did" onAdd={sheet.item ? () => add(sheet.item!) : undefined} onClose={() => setSheet(null)} />}
      <div class="row wrap" style="gap:8px;margin-top:12px">
        <button class="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button class="btn quiet" onClick={onClose} disabled={busy}>Cancel</button>
        {plannedRec && <button class="btn quiet" disabled={busy} onClick={() => setDraft(clone(plannedRec))} title="Start again from the session as it was planned">Reset to planned</button>}
      </div>
    </div>
  );
}

/** The planned exercises or stretches as a compact list, for "What was planned". */
export function PlannedList({ workout }: { workout: Workout }) {
  if (workout.walk) return <p class="small">{workout.walk.minutes} min walk{workout.walk.packKg ? ` with a ${packWords(workout.walk.packKg)} pack` : ''}, heart rate {walkZoneWords(workout.walk)}.</p>;
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
