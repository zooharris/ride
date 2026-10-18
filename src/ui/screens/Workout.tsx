import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, notify } from '../store';
import { WorkoutProfile, ZONE_VAR } from '../Profile';
import { clock, formatDuration, newId, renderIntervalsText, stepTargets, workoutStats } from '../../engine/workout';
import { powerZone } from '../../engine/zones';
import { FAMILY_LABEL } from '../../library/workouts';
import { addDays, today } from '../../engine/load';
import { db } from '../../data/db';
import { go } from '../router';
import type { Basis, WorkoutStep } from '../../engine/types';
import { fmtDate } from '../derived';

export function WorkoutScreen({ data, id, params }: { data: AppData; id: string; params: URLSearchParams }) {
  const profile = data.profile!;
  const w = findWorkout(data.mine, id);
  const [basis, setBasis] = useState<Basis>(w?.bases.includes(profile.basis) ? profile.basis : (w?.bases[0] ?? 'power'));
  const [showText, setShowText] = useState(false);
  if (!w) return <div class="empty">That workout is not in the library.</div>;
  const s = workoutStats(w.blocks);
  const from = params.get('from') ?? 'library';
  const backHref = from === 'today' ? '#/today' : from === 'calendar' ? '#/calendar' : '#/library';

  async function schedule(date: string) {
    await db.planned.put({ id: newId(), date, workoutId: w!.id, basis, status: 'planned' });
    notify();
    go('calendar');
  }

  const rows: Array<{ step: WorkoutStep; set?: string }> = [];
  for (const b of w.blocks) {
    if (b.kind === 'step') rows.push({ step: b });
    else { rows.push({ step: b.steps[0], set: `${b.label ?? 'Set'} × ${b.times}` }); for (const st of b.steps.slice(1)) rows.push({ step: st }); }
  }

  return (
    <div>
      <a href={backHref} class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Back</a>
      <div class="row between" style="margin-bottom:6px">
        <span class="tag" style={`background:var(--z${s.dominantZone})`}>{FAMILY_LABEL[w.family]}</span>
        {w.bases.length > 1 ? (
          <div class="seg">
            <button class={basis === 'power' ? 'on' : ''} onClick={() => setBasis('power')}>Power</button>
            <button class={basis === 'hr' ? 'on' : ''} onClick={() => setBasis('hr')}>Heart rate</button>
          </div>
        ) : <span class="faint small">{w.bases[0] === 'power' ? 'power only' : 'heart rate only'}</span>}
      </div>
      <h1>{w.name}</h1>
      <p class="muted small" style="margin:4px 0 14px">{clock(s.seconds)} · {s.tss} TSS · IF {s.intensityFactor.toFixed(2)}</p>
      <WorkoutProfile blocks={w.blocks} height={110} hero />
      <p style="margin:16px 0 6px;font-size:15px;line-height:1.6">{w.purpose}</p>
      {w.physiology && <p class="faint small">{w.physiology}</p>}

      <div class="row wrap" style="margin:18px 0;gap:8px">
        <button class="btn primary" onClick={() => schedule(today())}>Ride today</button>
        <button class="btn" onClick={() => schedule(addDays(today(), 1))}>Tomorrow</button>
        {w.source === 'mine' ? <a class="btn quiet" href={`#/build/${w.id}`}>Edit</a> : <a class="btn quiet" href={`#/build?copy=${w.id}`}>Copy and edit</a>}
        <label class="btn" style="position:relative;overflow:hidden">Pick a date
          <input type="date" min={today()} style="position:absolute;inset:0;opacity:0;cursor:pointer" onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) schedule(v); }} />
        </label>
      </div>
      {params.get('date') && <p class="faint small" style="margin-top:-8px;margin-bottom:14px">Planned for {fmtDate(params.get('date')!)}.</p>}

      <section class="section">
        <h2>Steps · {basis === 'power' ? `watts at FTP ${profile.ftp}` : `bpm at LTHR ${profile.lthr}`}</h2>
        <table class="steps">
          {rows.map(({ step, set }, i) => {
            const t = stepTargets(step, profile);
            const z = powerZone(step.intensity);
            return (
              <>
                {set && <tr key={`s${i}`}><td colSpan={4} class="set">{set}</td></tr>}
                <tr key={i}>
                  <td><span class="z" style={`background:${ZONE_VAR[z - 1]}`} /></td>
                  <td>{step.label ?? `Zone ${z}`}{step.cadence ? <span class="faint"> · {step.cadence} rpm</span> : null}</td>
                  <td class="r muted">{formatDuration(step.seconds)}</td>
                  <td class="r num">{basis === 'power' ? `${t.watts} W` : `${t.bpm} bpm`}</td>
                </tr>
              </>
            );
          })}
        </table>
      </section>

      <section class="section">
        <button class="btn quiet sm" style="margin-left:-10px" onClick={() => setShowText(!showText)}>{showText ? 'Hide' : 'Show'} what is sent to Intervals.icu</button>
        {showText && <pre class="panel small" style="white-space:pre-wrap;margin-top:8px;font-family:inherit">{renderIntervalsText(w, basis)}</pre>}
      </section>
    </div>
  );
}
