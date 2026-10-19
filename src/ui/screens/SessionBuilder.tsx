import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, getCurrentEquipment, notify } from '../store';
import type { Equipment, Exercise, SessionKind, Workout } from '../../engine/types';
import { EXERCISES, type Pattern } from '../../library/strength';
import { MOBILITY, type Target } from '../../library/mobility';
import { db } from '../../data/db';
import { newId } from '../../engine/workout';
import { estimateSessionTss } from '../../engine/sessions';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';
import { go } from '../router';
import { KIND_LABEL } from './Plan';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';

/** Build a strength, mobility or walk session by hand. */
export function SessionBuilder({ data, kind, id, copyId }: { data: AppData; kind: Exclude<SessionKind, 'ride' | 'other'>; id?: string; copyId?: string }) {
  const existing = id ? findWorkout(data.mine, id) : undefined;
  const source = existing ?? (copyId ? findWorkout(data.mine, copyId) : undefined);
  const [name, setName] = useState(existing?.name ?? (source ? `${source.name} (copy)` : ''));
  const [purpose, setPurpose] = useState(source?.purpose ?? '');
  const [exercises, setExercises] = useState<Exercise[]>(source?.exercises ?? []);
  const [minutes, setMinutes] = useState(source?.minutes ?? (kind === 'walk' ? 45 : kind === 'strength' ? 40 : 12));
  const [packLb, setPackLb] = useState(source?.walk?.packKg ? Math.round(source.walk.packKg * 2.2) : 0);
  const [equipment, setEquipment] = useState<Equipment[]>(getCurrentEquipment());
  const [date, setDate] = useState(today());
  const [effort, setEffort] = useState<number>(source?.effort ?? 6);
  const [hrLow, setHrLow] = useState(Math.round((source?.walk?.hrLow ?? 0.6) * 100));
  const [hrHigh, setHrHigh] = useState(Math.round((source?.walk?.hrHigh ?? 0.7) * 100));
  const maxHr = data.profile?.maxHr ?? 0;
  const walkSpec = { minutes, hrLow: hrLow / 100, hrHigh: hrHigh / 100, packKg: packLb ? packLb / 2.2 : undefined };
  const tss = estimateSessionTss({ kind, minutes, walk: kind === 'walk' ? walkSpec : undefined, effort: kind === 'strength' ? effort : undefined });
  const WALK_TARGETS: Array<[string, number, number, string]> = [
    ['Recovery', 0, 60, 'no minimum: stroll, and slow down if the heart rate climbs'],
    ['Zone 2', 60, 70, 'talk in full sentences; the default'],
    ['Brisk', 68, 78, 'purposeful; top of zone 2 into zone 3'],
  ];

  const pool = kind === 'strength' ? EXERCISES.filter((e) => e.equipment.some((q) => equipment.includes(q))) : [];
  const add = (e: Exercise) => setExercises([...exercises, e]);
  const update = (i: number, patch: Partial<Exercise>) => setExercises(exercises.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => setExercises(exercises.filter((_, k) => k !== i));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= exercises.length) return; const n = [...exercises]; [n[i], n[j]] = [n[j], n[i]]; setExercises(n); };

  async function save(then: 'date' | 'library') {
    if (!name.trim()) return;
    const w: Workout = {
      id: existing?.id ?? `mine-${newId()}`, name: name.trim(), kind, family: kind === 'walk' ? 'endurance' : 'recovery',
      purpose: purpose.trim() || (kind === 'walk' ? 'A zone 2 walk.' : `Built in the app: ${exercises.length} ${kind === 'strength' ? 'exercises' : 'stretches'}.`),
      phases: ['any'], bases: ['power', 'hr'], setting: 'any', blocks: [], source: 'mine', minutes,
      exercises: kind === 'walk' ? undefined : exercises,
      walk: kind === 'walk' ? walkSpec : undefined,
      effort: kind === 'strength' ? effort : undefined,
      estimatedTss: tss,
    };
    await db.workouts.put(w);
    if (then === 'date') await db.planned.put({ id: newId(), date, workoutId: w.id, basis: data.profile!.basis, status: 'planned' });
    notify(); toast({ ok: true, text: 'Saved to My Workouts.' });
    go(then === 'date' ? 'calendar' : 'library');
  }

  const PATTERN_LABEL: Record<Pattern, string> = { squat: 'Squat', hinge: 'Hinge', 'single-leg': 'Single leg', push: 'Push', pull: 'Pull', trunk: 'Trunk', hip: 'Hips and calves' };
  const TARGET_LABEL: Record<Target, string> = { hips: 'Hips', hamstrings: 'Hamstrings', thoracic: 'Upper back', glutes: 'Glutes', quads: 'Quads', calves: 'Calves', 'neck-shoulders': 'Neck and shoulders', 'low-back': 'Lower back' };

  return (
    <div>
      <PageHead back={{ label: 'Library', href: '#/library' }} title={existing ? `Edit ${KIND_LABEL[kind].toLowerCase()} session` : `New ${KIND_LABEL[kind].toLowerCase()} session`} eyebrow={<span title="Estimated training stress for this session; it counts toward fitness and fatigue the way a ride’s TSS does. Walks are estimated from the heart-rate target and pack, strength from the planned effort, mobility from its length.">{minutes} min · ≈ {tss} TSS</span>} />
      <div class="form">
        <div class="field" style="grid-column:1/-1"><label>Name</label><input value={name} placeholder={kind === 'strength' ? 'Tuesday legs' : kind === 'walk' ? 'Lunchtime walk' : 'Evening stretch'} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="field" style="grid-column:1/-1"><label>What it is for (optional)</label><input value={purpose} onInput={(e) => setPurpose((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label>Minutes</label><input type="number" min="5" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value) || 30)} /></div>
        {kind === 'walk' && <div class="field"><label>Pack weight (lb, 0 for none)</label><input type="number" min="0" value={packLb} onInput={(e) => setPackLb(Number((e.target as HTMLInputElement).value) || 0)} /></div>}
        {kind === 'strength' && (
          <div class="field"><label>Planned effort (sets the TSS estimate)</label>
            <select value={effort} onChange={(e) => setEffort(Number((e.target as HTMLSelectElement).value))}>
              {[[3, '3 · very easy: mobility-like, no strain'], [4, '4 · easy: light weights, long rests'], [5, '5 · light: moderate weights, reps in reserve'], [6, '6 · moderate: working weights, 2 reps in reserve'], [7, '7 · hard: heavy, 1 rep in reserve on the last set'], [8, '8 · very hard: near maximal on main lifts']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        )}
      </div>

      {kind === 'walk' && (
        <section class="section">
          <h2>Heart-rate target</h2>
          <p class="muted small" style="margin:6px 0 10px;max-width:64ch">Walks go by heart rate, not power: there is no power meter on foot, and a treadmill’s readout is not comparable to a bike’s. The target is a share of your maximum heart rate.</p>
          <div class="chips" style="margin-bottom:10px">
            {WALK_TARGETS.map(([l, lo, hi, d]) => <button key={l} class={`chip${hrLow === lo && hrHigh === hi ? ' on' : ''}`} title={d} onClick={() => { setHrLow(lo); setHrHigh(hi); }}>{l} {lo ? `${lo}–${hi}` : `up to ${hi}`}%</button>)}
          </div>
          <div class="form">
            <div class="field"><label>Low (% of max heart rate; 0 for no minimum)</label><input type="number" min="0" max="95" value={hrLow} onInput={(e) => setHrLow(Math.min(95, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)))} /></div>
            <div class="field"><label>High (% of max heart rate)</label><input type="number" min="45" max="100" value={hrHigh} onInput={(e) => setHrHigh(Math.min(100, Math.max(45, Number((e.target as HTMLInputElement).value) || 70)))} /></div>
          </div>
          <p class="small" style="margin-top:10px">{maxHr ? <>That is <b>{hrLow ? `${Math.round(maxHr * hrLow / 100)}–` : 'up to '}{Math.round(maxHr * hrHigh / 100)} bpm</b> for your max of {maxHr}.{hrLow ? '' : ' No minimum: a casual stroll counts, even if the heart rate stays near resting.'}</> : 'Set your max heart rate in Settings to see this in beats per minute.'}{hrHigh <= hrLow && <span style="color:var(--bad)"> The high end must be above the low end.</span>}</p>
        </section>
      )}

      {kind === 'strength' && (
        <section class="section">
          <div class="field"><label>Equipment to choose from</label>
            <div class="chips">{([['dumbbells', 'Dumbbells'], ['bench', 'Bench'], ['band', 'Bands'], ['bodyweight', 'Bodyweight']] as Array<[Equipment, string]>).map(([q, l]) => <button key={q} class={`chip${equipment.includes(q) ? ' on' : ''}`} onClick={() => setEquipment(equipment.includes(q) ? equipment.filter((e) => e !== q) : [...equipment, q])}>{l}</button>)}</div></div>
          <Picker onAdd={add} label="Add an exercise" items={pool.map((e) => ({ name: e.name, group: PATTERN_LABEL[e.pattern], make: () => ({ name: e.name, sets: 3, reps: e.unilateral ? '8–10 per side' : '8–10', load: e.loadable ? 'Leave 2 reps in reserve' : 'Bodyweight; slow and controlled', cue: e.cue, why: e.why, equipment: e.equipment }) }))} />
        </section>
      )}
      {kind === 'mobility' && (
        <section class="section">
          <Picker onAdd={add} label="Add a stretch" items={MOBILITY.map((m) => ({ name: m.name, group: TARGET_LABEL[m.target], make: () => ({ name: m.name, holdSeconds: m.holdSeconds, reps: m.perSide ? 'each side' : undefined, cue: m.cue, why: m.why, equipment: m.equipment }) }))} />
        </section>
      )}

      {kind !== 'walk' && (
        <section class="section">
          <h2>{kind === 'strength' ? 'Exercises' : 'Stretches'} <span class="muted" style="font-weight:400">· {exercises.length}</span></h2>
          {exercises.length === 0 && <div class="empty small" style="margin-top:8px">Nothing yet. Add from the list above.</div>}
          <div class="stack" style="margin-top:8px">
            {exercises.map((e, i) => (
              <div class="panel" key={i} style="padding:10px 12px">
                <div class="row between"><b>{e.name}</b>
                  <span class="row" style="gap:2px"><button class="btn sm quiet" onClick={() => move(i, -1)}>↑</button><button class="btn sm quiet" onClick={() => move(i, 1)}>↓</button><button class="btn sm quiet" onClick={() => remove(i)}>×</button></span></div>
                <div class="row wrap" style="gap:8px;margin-top:6px">
                  {kind === 'strength' ? (
                    <>
                      <input type="number" min="1" value={e.sets ?? 3} onInput={(ev) => update(i, { sets: Number((ev.target as HTMLInputElement).value) || 1 })} style="width:60px" /><span class="faint small">sets ×</span>
                      <input value={e.reps ?? ''} placeholder="8–10" onInput={(ev) => update(i, { reps: (ev.target as HTMLInputElement).value })} style="width:140px" />
                      <input value={e.load ?? ''} placeholder="load note" onInput={(ev) => update(i, { load: (ev.target as HTMLInputElement).value })} style="flex:1;min-width:140px" />
                    </>
                  ) : (
                    <>
                      <input type="number" min="10" step="5" value={e.holdSeconds ?? 45} onInput={(ev) => update(i, { holdSeconds: Number((ev.target as HTMLInputElement).value) || 30 })} style="width:70px" /><span class="faint small">seconds{e.reps ? ', each side' : ''}</span>
                    </>
                  )}
                </div>
                <div class="faint small" style="margin-top:6px">{e.cue}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div class="row wrap" style="margin-top:22px;gap:8px;align-items:center">
        <button class="btn primary" onClick={() => save('library')} disabled={!name.trim() || (kind !== 'walk' && exercises.length === 0) || (kind === 'walk' && hrHigh <= hrLow)}>Save to My Workouts</button>
        <button class="btn" onClick={() => save('date')} disabled={!name.trim() || (kind !== 'walk' && exercises.length === 0) || (kind === 'walk' && hrHigh <= hrLow)}>Save and put on {date === today() ? 'today' : fmtDate(date)}</button>
        <input type="date" value={date} min={today()} onInput={(e) => setDate((e.target as HTMLInputElement).value || today())} style="width:auto" aria-label="Date to put it on" />
        <a class="btn quiet" href="#/library">Cancel</a>
        {existing && <button class="btn quiet" style="color:var(--bad)" onClick={async () => { if (!confirm(`Delete ${existing.name}?`)) return; await db.planned.where('workoutId').equals(existing.id).delete(); await db.workouts.delete(existing.id); notify(); go('library'); }}>Delete</button>}
      </div>
    </div>
  );
}

/** A grouped list of things to add. Lives outside the builder so it keeps its open state across re-renders. */
function Picker({ items, label, onAdd }: { items: Array<{ name: string; group: string; make: () => Exercise }>; label: string; onAdd: (e: Exercise) => void }) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <details class="panel" style="margin-top:10px" open>
      <summary style="cursor:pointer;font-weight:600">{label}</summary>
      {groups.map((g) => (
        <div key={g} style="margin-top:10px">
          <div class="faint small" style="margin-bottom:4px">{g}</div>
          <div class="chips">{items.filter((i) => i.group === g).map((i) => <button key={i.name} class="chip" onClick={() => onAdd(i.make())}>+ {i.name}</button>)}</div>
        </div>
      ))}
    </details>
  );
}
