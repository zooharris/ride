import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, notify } from '../store';
import { WorkoutProfile, ZONE_VAR } from '../Profile';
import { clock, newId, stepTargets, workoutStats } from '../../engine/workout';
import { powerZone, zonesFor } from '../../engine/zones';
import type { Family, Workout, WorkoutBlock, WorkoutStep } from '../../engine/types';
import { db } from '../../data/db';
import { go } from '../router';
import { deleteWorkoutEverywhere } from '../planService';
import { today } from '../../engine/load';
import { FAMILY_LABEL } from '../../library/workouts';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';

/** A row in the editor: either a single step or a repeated set of steps. */
type Row = { id: string; kind: 'step'; minutes: number; pct: number; pctHigh?: number; label: string; cadence?: number }
         | { id: string; kind: 'repeat'; times: number; label: string; steps: Array<{ id: string; minutes: number; pct: number; pctHigh?: number; label: string; cadence?: number }> };

function toBlocks(rows: Row[]): WorkoutBlock[] {
  const st = (r: { minutes: number; pct: number; pctHigh?: number; label: string; cadence?: number }): WorkoutStep => ({
    // A low of 0 means no minimum: the step is "up to" its high end (50% if none given), and the
    // load estimate assumes the rider sits around half of that.
    kind: 'step', seconds: Math.round(r.minutes * 60),
    intensity: r.pct === 0 ? (r.pctHigh || 50) / 200 : r.pct / 100,
    intensityHigh: r.pct === 0 ? (r.pctHigh || 50) / 100 : r.pctHigh ? r.pctHigh / 100 : undefined,
    noFloor: r.pct === 0 || undefined,
    label: r.label || undefined, cadence: r.cadence || undefined,
  });
  return rows.map((r) => r.kind === 'step' ? st(r) : { kind: 'repeat', times: r.times, label: r.label || undefined, steps: r.steps.map(st) });
}

function fromBlocks(blocks: WorkoutBlock[]): Row[] {
  const row = (s: WorkoutStep) => ({ id: newId(), minutes: Math.round(s.seconds / 6) / 10, pct: s.noFloor ? 0 : Math.round(s.intensity * 100), pctHigh: s.intensityHigh ? Math.round(s.intensityHigh * 100) : undefined, label: s.label ?? '', cadence: s.cadence });
  return blocks.map((b) => b.kind === 'step' ? { kind: 'step', ...row(b) } : { id: newId(), kind: 'repeat', times: b.times, label: b.label ?? '', steps: b.steps.map(row) });
}

const FAMILIES: Family[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'];

function guessFamily(blocks: WorkoutBlock[]): Family {
  const z = workoutStats(blocks).dominantZone;
  const steps = blocks.flatMap((b) => b.kind === 'step' ? [b] : b.steps);
  const hasSweetSpot = steps.some((s) => s.intensity >= 0.84 && s.intensity < 0.95 && s.seconds >= 300);
  if (z === 3 && hasSweetSpot) return 'sweetspot';
  return (['recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'anaerobic', 'anaerobic'] as Family[])[z - 1];
}

export function Builder({ data, id, copyId }: { data: AppData; id?: string; copyId?: string }) {
  const profile = data.profile!;
  const existing = id ? findWorkout(data.mine, id) : undefined;
  const source = existing ?? (copyId ? findWorkout(data.mine, copyId) : undefined);
  const [name, setName] = useState(existing?.name ?? (source ? `${source.name} (copy)` : ''));
  const [purpose, setPurpose] = useState(source?.purpose ?? '');
  const [family, setFamily] = useState<Family | 'auto'>(source ? source.family : 'auto');
  const [rows, setRows] = useState<Row[]>(source ? fromBlocks(source.blocks) : [
    { id: newId(), kind: 'step', minutes: 10, pct: 55, pctHigh: 65, label: 'Warm up' },
    { id: newId(), kind: 'repeat', times: 3, label: 'Main set', steps: [{ id: newId(), minutes: 10, pct: 88, pctHigh: 93, label: '' }, { id: newId(), minutes: 5, pct: 50, label: 'Easy' }] },
    { id: newId(), kind: 'step', minutes: 10, pct: 50, label: 'Cool down' },
  ]);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { setSaved(null); }, [rows, name]);
  const initial = useRef({ name, purpose, family, rows: JSON.stringify(rows) });
  const dirty = name !== initial.current.name || purpose !== initial.current.purpose || family !== initial.current.family || JSON.stringify(rows) !== initial.current.rows;
  function reset() {
    if (dirty && !confirm('Reset the builder to where it started? Your edits here will be lost.')) return;
    setName(initial.current.name); setPurpose(initial.current.purpose); setFamily(initial.current.family); setRows(JSON.parse(initial.current.rows));
  }
  function cancel() {
    if (dirty && !saved && !confirm('Leave without saving? Your edits here will be lost.')) return;
    go('library');
  }

  const blocks = toBlocks(rows);
  const stats = workoutStats(blocks);
  const fam = family === 'auto' ? guessFamily(blocks) : family;
  const zones = zonesFor('power');

  const update = (rid: number, patch: Partial<Row>) => setRows(rows.map((r, i) => i === rid ? { ...r, ...patch } as Row : r));
  const updateSub = (rid: number, sid: number, patch: Partial<Row & { minutes: number }>) =>
    setRows(rows.map((r, i) => i === rid && r.kind === 'repeat' ? { ...r, steps: r.steps.map((s, j) => j === sid ? { ...s, ...patch } : s) } : r));
  const remove = (rid: number) => setRows(rows.filter((_, i) => i !== rid));
  const move = (rid: number, dir: -1 | 1) => {
    const to = rid + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[rid], next[to]] = [next[to], next[rid]];
    setRows(next);
  };
  const addStep = () => setRows([...rows, { id: newId(), kind: 'step', minutes: 10, pct: 65, label: '' }]);
  const addSet = () => setRows([...rows, { id: newId(), kind: 'repeat', times: 3, label: 'Set', steps: [{ id: newId(), minutes: 5, pct: 100, label: '' }, { id: newId(), minutes: 3, pct: 50, label: 'Easy' }] }]);

  async function save(then?: 'today' | 'library') {
    if (!name.trim()) return;
    const w: Workout = {
      id: existing?.id ?? `mine-${newId()}`, name: name.trim(), family: fam, purpose: purpose.trim() || `Built in the app: ${clock(stats.seconds)}, ${stats.tss} TSS.`,
      phases: ['any'], bases: stats.dominantZone >= 5 ? ['power'] : ['power', 'hr'], blocks, source: 'mine', setting: 'any', kind: 'ride',
    };
    await db.workouts.put(w);
    if (then === 'today') {
      await db.planned.put({ id: newId(), date: today(), workoutId: w.id, basis: profile.basis, status: 'planned' });
    }
    notify();
    setSaved(w.id);
    toast({ ok: true, text: `Saved “${w.name}” to My Workouts.` });
    if (then === 'today') go('today');
    if (then === 'library') go('library');
  }

  const pctField = (value: number | undefined, on: (v: number | undefined) => void, placeholder = '') => (
    <input type="number" min="0" max="250" value={value ?? ''} placeholder={placeholder} title="0 in the low box means no minimum" onInput={(e) => { const raw = (e.target as HTMLInputElement).value; on(raw === '' ? undefined : Math.max(0, Number(raw) || 0)); }} style="width:64px" />
  );
  const minField = (value: number, on: (v: number) => void) => (
    <input type="number" min="0.25" step="0.25" value={value} onInput={(e) => on(Number((e.target as HTMLInputElement).value) || 0)} style="width:64px" />
  );
  const labelField = (value: string, on: (v: string) => void) => (
    <input value={value} placeholder="label" onInput={(e) => on((e.target as HTMLInputElement).value)} style="flex:1;min-width:90px" />
  );
  const zoneDot = (pct: number) => <span class="z" style={`background:${ZONE_VAR[powerZone(pct / 100) - 1]};display:inline-block;width:10px;height:10px;border-radius:2px;flex:0 0 10px`} />;

  return (
    <div>
      <PageHead back={{ label: 'Library', onClick: cancel }} title={existing ? 'Edit workout' : 'New ride workout'} eyebrow={`${clock(stats.seconds)} · ${stats.tss} TSS · IF ${stats.intensityFactor.toFixed(2)}`} />

      <div class="panel" style="padding:14px 16px 12px">
        <div class="row between" style="margin-bottom:8px">
          <span class="tag" style={`--c:var(--z${stats.dominantZone})`}>{FAMILY_LABEL[fam]}</span>
          <span class="faint small">intensity as % of FTP {profile.ftp} W</span>
        </div>
        <WorkoutProfile blocks={blocks} height={88} />
      </div>

      <div class="form" style="margin-top:16px">
        <div class="field" style="grid-column:1/-1"><label>Name</label><input value={name} placeholder="Tuesday sweet spot" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="field" style="grid-column:1/-1"><label>What it is for (optional)</label><input value={purpose} placeholder="One sentence you will read on the day" onInput={(e) => setPurpose((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label>Family</label>
          <select value={family} onChange={(e) => setFamily((e.target as HTMLSelectElement).value as Family | 'auto')}>
            <option value="auto">Auto ({FAMILY_LABEL[guessFamily(blocks)]})</option>
            {FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABEL[f]}</option>)}
          </select>
        </div>
      </div>

      <section class="section">
        <h2>Steps</h2>
        <p class="faint small" style="margin-bottom:10px">Minutes, then intensity as a percentage of FTP. Give a high value for a range (88 to 93). Sets repeat their steps in order.</p>
        <div class="stack">
          {rows.map((r, i) => (
            <div class="panel" key={r.id} style="padding:10px 12px">
              {r.kind === 'step' ? (
                <div class="row wrap" style="gap:8px">
                  {zoneDot(r.pct)}
                  {minField(r.minutes, (v) => update(i, { minutes: v }))}<span class="faint small">min</span>
                  {pctField(r.pct, (v) => update(i, { pct: v ?? 50 }))}<span class="faint small">to</span>{pctField(r.pctHigh, (v) => update(i, { pctHigh: v }), '–')}<span class="faint small">%</span>
                  {labelField(r.label, (v) => update(i, { label: v }))}
                  <span class="num small muted" style="min-width:72px;text-align:right">{stepTargets(toBlocks([r])[0] as WorkoutStep, profile).watts} W</span>
                  <RowButtons onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(i)} />
                </div>
              ) : (
                <div>
                  <div class="row wrap" style="gap:8px;margin-bottom:8px">
                    <span class="faint small">Repeat</span>
                    <input type="number" min="1" max="30" value={r.times} onInput={(e) => update(i, { times: Number((e.target as HTMLInputElement).value) || 1 })} style="width:56px" /><span class="faint small">×</span>
                    {labelField(r.label, (v) => update(i, { label: v }))}
                    <RowButtons onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(i)} />
                  </div>
                  <div class="stack" style="padding-left:14px;border-left:2px solid var(--line-2)">
                    {r.steps.map((s, j) => (
                      <div class="row wrap" key={s.id} style="gap:8px">
                        {zoneDot(s.pct)}
                        {minField(s.minutes, (v) => updateSub(i, j, { minutes: v }))}<span class="faint small">min</span>
                        {pctField(s.pct, (v) => updateSub(i, j, { pct: v ?? 50 } as never))}<span class="faint small">to</span>{pctField(s.pctHigh, (v) => updateSub(i, j, { pctHigh: v } as never), '–')}<span class="faint small">%</span>
                        {labelField(s.label, (v) => updateSub(i, j, { label: v } as never))}
                        <button class="btn sm quiet" aria-label="Remove step" onClick={() => update(i, { steps: r.steps.filter((_, k) => k !== j) } as never)}>×</button>
                      </div>
                    ))}
                    <button class="btn sm quiet" style="align-self:flex-start" onClick={() => update(i, { steps: [...r.steps, { id: newId(), minutes: 3, pct: 50, label: 'Easy' }] } as never)}>+ step in set</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" onClick={addStep}>+ Step</button>
          <button class="btn sm" onClick={addSet}>+ Set (repeats)</button>
        </div>
      </section>

      <section class="section">
        <h2>Your zones</h2>
        <div class="row wrap faint small" style="gap:12px">
          {zones.map((z, i) => <span key={z.n}><span style={`color:${ZONE_VAR[i]}`}>■</span> Z{z.n} {Math.round(z.low * 100)}{isFinite(z.high) ? `–${Math.round(z.high * 100)}` : '+'}%</span>)}
        </div>
      </section>

      <div class="row wrap" style="margin-top:22px;gap:8px">
        <button class="btn primary" onClick={() => save('library')} disabled={!name.trim() || rows.length === 0}>Save to My Workouts</button>
        <button class="btn" onClick={() => save('today')} disabled={!name.trim() || rows.length === 0}>Save and ride today</button>
        <button class="btn quiet" onClick={reset} disabled={!dirty}>Reset</button>
        <button class="btn quiet" onClick={cancel}>Cancel</button>
        {existing && <button class="btn quiet" style="color:var(--bad)" onClick={async () => { if (await deleteWorkoutEverywhere(existing)) go('library'); }}>Delete</button>}
      </div>
    </div>
  );
}

function RowButtons({ onUp, onDown, onRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <span class="row" style="gap:2px;margin-left:auto">
      <button class="btn sm quiet" aria-label="Move up" onClick={onUp}>↑</button>
      <button class="btn sm quiet" aria-label="Move down" onClick={onDown}>↓</button>
      <button class="btn sm quiet" aria-label="Remove" onClick={onRemove}>×</button>
    </span>
  );
}
