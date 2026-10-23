import { useRef, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, notify } from '../store';
import type { RunStep, Workout } from '../../engine/types';
import { db } from '../../data/db';
import { newId } from '../../engine/workout';
import { runStepsTss } from '../../engine/sessions';
import { RUN_BANDS, band, paceHint, runMinutes, runSeconds, type RunBandKey } from '../../engine/run';
import { bandBpm, bandKeyOf, bandZoneWords, recoveryBand, stepBand } from '../../engine/foot';
import { footLthr } from '../../engine/zones';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';
import { go } from '../router';
import { deleteWorkoutEverywhere } from '../planService';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';

/** A step as the builder edits it: minutes and seconds, a band by name, an optional repeat with its recovery. */
interface Row { min: number; sec: number; band: RunBandKey; label: string; repeat: number; recMin: number; recSec: number; recBand: RunBandKey }

const toRow = (s: RunStep): Row => ({
  min: Math.floor(s.seconds / 60), sec: s.seconds % 60, band: bandKeyOf(stepBand(s)), label: s.label ?? '',
  repeat: s.repeat ?? 1, recMin: Math.floor((s.recoverSeconds ?? 0) / 60), recSec: (s.recoverSeconds ?? 0) % 60,
  recBand: bandKeyOf(recoveryBand(s)),
});
const toStep = (r: Row): RunStep => {
  const step: RunStep = { seconds: Math.max(5, r.min * 60 + r.sec), band: r.band, ...(r.label.trim() ? { label: r.label.trim() } : {}) };
  if (r.repeat > 1) Object.assign(step, { repeat: r.repeat, recoverSeconds: r.recMin * 60 + r.recSec, recoverBand: r.recBand });
  return step;
};
const DEFAULT_ROWS: Row[] = [
  { min: 10, sec: 0, band: 'easy', label: 'warm-up', repeat: 1, recMin: 0, recSec: 0, recBand: 'easy' },
  { min: 15, sec: 0, band: 'easy', label: '', repeat: 1, recMin: 0, recSec: 0, recBand: 'easy' },
  { min: 5, sec: 0, band: 'easy', label: 'cool-down', repeat: 1, recMin: 0, recSec: 0, recBand: 'easy' },
];

/** Build a run by hand: steps on time with a heart-rate band, sent to the Garmin as a run. */
export function RunBuilder({ data, id, copyId }: { data: AppData; id?: string; copyId?: string }) {
  const existing = id ? findWorkout(data.mine, id) : undefined;
  const source = existing ?? (copyId ? findWorkout(data.mine, copyId) : undefined);
  const [name, setName] = useState(existing?.name ?? (source ? `${source.name} (copy)` : ''));
  const [purpose, setPurpose] = useState(source?.purpose ?? '');
  const [where, setWhere] = useState<'outdoor' | 'treadmill'>(source?.run?.where ?? 'outdoor');
  const [rows, setRows] = useState<Row[]>(source?.run?.steps.length ? source.run.steps.map(toRow) : DEFAULT_ROWS);
  const [date, setDate] = useState(today());
  const profile = data.profile!;
  const imperial = profile.units === 'imperial';

  const snapshot = () => JSON.stringify({ name, purpose, where, rows });
  const initial = useRef(snapshot());
  const dirty = snapshot() !== initial.current;
  function reset() {
    if (dirty && !confirm('Reset the builder to where it started? Your edits here will be lost.')) return;
    const s0 = JSON.parse(initial.current) as { name: string; purpose: string; where: 'outdoor' | 'treadmill'; rows: Row[] };
    setName(s0.name); setPurpose(s0.purpose); setWhere(s0.where); setRows(s0.rows);
  }
  function cancel() {
    if (dirty && !confirm('Leave without saving? Your edits here will be lost.')) return;
    go('library');
  }

  const steps = rows.map(toStep);
  const spec = { steps, where };
  const minutes = runMinutes(spec);
  const tss = runStepsTss(steps);
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rows.filter((_, k) => k !== i));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
  const addStep = () => setRows([...rows, { min: 5, sec: 0, band: 'easy', label: '', repeat: 1, recMin: 0, recSec: 0, recBand: 'easy' }]);
  const bpm = (k: RunBandKey) => { const x = bandBpm(band(k), profile); return x ? `${band(k).zoneLow <= 1 ? 'up to ' : `${x.low}–`}${x.high} bpm on your foot table` : ''; };
  const bandLine = (k: RunBandKey) => { const b = band(k); const p = paceHint(k, profile.thresholdPaceSec, imperial); return `${b.label} · ${bandZoneWords(b)}${p ? ` · about ${p}` : ''}`; };

  async function save(then: 'date' | 'library') {
    if (!name.trim() || !steps.length) return;
    const w: Workout = {
      id: existing?.id ?? `mine-${newId()}`, name: name.trim(), kind: 'run', family: steps.some((s) => s.band === 'tempo' || s.band === 'hard') ? 'tempo' : 'endurance',
      purpose: purpose.trim() || 'A run built in the app, by heart rate.',
      phases: ['any'], bases: ['power', 'hr'], setting: where === 'outdoor' ? 'outdoor' : 'indoor', blocks: [], source: 'mine',
      run: spec, minutes, estimatedTss: tss,
    };
    await db.workouts.put(w);
    if (then === 'date') await db.planned.put({ id: newId(), date, workoutId: w.id, basis: profile.basis, status: 'planned' });
    notify(); toast({ ok: true, text: 'Saved to My Workouts.' });
    go(then === 'date' ? 'calendar' : 'library');
  }

  return (
    <div>
      <PageHead back={{ label: 'Library', onClick: cancel }} title={existing ? 'Edit run' : 'New run'} eyebrow={<span title="Estimated training stress from each step's heart-rate band; it counts toward fitness and fatigue the way a ride's TSS does.">{minutes} min · ≈ {tss} TSS</span>} />
      <div class="form">
        <div class="field" style="grid-column:1/-1"><label>Name</label><input value={name} placeholder="Thursday easy run" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="field" style="grid-column:1/-1"><label>What it is for (optional)</label><input value={purpose} onInput={(e) => setPurpose((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label>Where</label>
          <div class="seg"><button class={where === 'outdoor' ? 'on' : ''} onClick={() => setWhere('outdoor')}>Outdoor</button><button class={where === 'treadmill' ? 'on' : ''} onClick={() => setWhere('treadmill')}>Treadmill</button></div></div>
      </div>

      <section class="section">
        <h2>Steps <span class="muted" style="font-weight:400">· {rows.length}</span></h2>
        <p class="muted small" style="margin:6px 0 10px;max-width:68ch">Each step is a time and a heart-rate band, named by zone on your foot table (threshold {footLthr(profile)} bpm); the Garmin holds you in it. A repeated step runs its recovery between repeats.{profile.thresholdPaceSec ? ' The pace beside each band comes from your threshold pace and is a guide only.' : ' Set a threshold run pace in Settings to see the pace each band implies.'}</p>
        <div class="stack">
          {rows.map((r, i) => (
            <div class="panel" key={i} style="padding:10px 12px">
              <div class="row between"><b class="small">Step {i + 1}{r.repeat > 1 ? ` · ${r.repeat} ×` : ''}</b>
                <span class="row" style="gap:2px"><button class="btn sm quiet" aria-label="Move up" onClick={() => move(i, -1)}>↑</button><button class="btn sm quiet" aria-label="Move down" onClick={() => move(i, 1)}>↓</button><button class="btn sm quiet" aria-label="Remove step" onClick={() => remove(i)}>×</button></span></div>
              <div class="row wrap" style="gap:8px;margin-top:6px;align-items:center">
                <input type="number" min="0" value={r.min} onInput={(e) => update(i, { min: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} style="width:64px" aria-label="Minutes" /><span class="faint small">min</span>
                <input type="number" min="0" max="59" step="5" value={r.sec} onInput={(e) => update(i, { sec: Math.min(59, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)) })} style="width:60px" aria-label="Seconds" /><span class="faint small">s</span>
                <select value={r.band} onChange={(e) => update(i, { band: (e.target as HTMLSelectElement).value as RunBandKey })} aria-label="Heart-rate band">
                  {RUN_BANDS.map((b) => <option key={b.key} value={b.key}>{bandLine(b.key)}</option>)}
                </select>
                <input value={r.label} placeholder="label, e.g. warm-up" onInput={(e) => update(i, { label: (e.target as HTMLInputElement).value })} style="flex:1;min-width:120px" />
              </div>
              <div class="row wrap" style="gap:8px;margin-top:6px;align-items:center">
                <span class="faint small">Repeat</span>
                <input type="number" min="1" max="20" value={r.repeat} onInput={(e) => update(i, { repeat: Math.min(20, Math.max(1, Number((e.target as HTMLInputElement).value) || 1)) })} style="width:56px" aria-label="Repeat count" />
                {r.repeat > 1 && <>
                  <span class="faint small">× with</span>
                  <input type="number" min="0" value={r.recMin} onInput={(e) => update(i, { recMin: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} style="width:56px" aria-label="Recovery minutes" /><span class="faint small">min</span>
                  <input type="number" min="0" max="59" step="5" value={r.recSec} onInput={(e) => update(i, { recSec: Math.min(59, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)) })} style="width:56px" aria-label="Recovery seconds" /><span class="faint small">s of</span>
                  <select value={r.recBand} onChange={(e) => update(i, { recBand: (e.target as HTMLSelectElement).value as RunBandKey })} aria-label="Recovery band">
                    {RUN_BANDS.filter((b) => b.key === 'easy' || b.key === 'walk').map((b) => <option key={b.key} value={b.key}>{b.label.toLowerCase()}</option>)}
                  </select>
                  <span class="faint small">between</span>
                </>}
              </div>
              <div class="faint small" style="margin-top:6px">{bpm(r.band)}</div>
            </div>
          ))}
        </div>
        <button class="btn sm" style="margin-top:10px" onClick={addStep}>Add a step</button>
        <p class="small" style="margin-top:10px"><b>{minutes} min</b> in all ({Math.round(runSeconds(spec))} s), about <b>{tss} TSS</b>.</p>
      </section>

      <div class="row wrap" style="margin-top:22px;gap:8px;align-items:center">
        <button class="btn primary" onClick={() => save('library')} disabled={!name.trim() || !rows.length}>Save to My Workouts</button>
        <button class="btn" onClick={() => save('date')} disabled={!name.trim() || !rows.length}>Save and put on {date === today() ? 'today' : fmtDate(date)}</button>
        <input type="date" value={date} min={today()} onInput={(e) => setDate((e.target as HTMLInputElement).value || today())} style="width:auto" aria-label="Date to put it on" />
        <button class="btn quiet" onClick={reset} disabled={!dirty}>Reset</button>
        <button class="btn quiet" onClick={cancel}>Cancel</button>
        {existing && <button class="btn danger" onClick={async () => { if (await deleteWorkoutEverywhere(existing)) go('library'); }}>Delete</button>}
      </div>
    </div>
  );
}
