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
import type { Basis, PlannedWorkout, WorkoutStep } from '../../engine/types';
import { fmtDate } from '../derived';
import { SessionLog } from '../SessionLog';
import { sendWorkout } from '../../sync/intervals';
import { credentials } from '../../sync/syncService';
import { KIND_LABEL, KindDot } from './Plan';
import { AddToDate } from './Library';

export function WorkoutScreen({ data, id, params }: { data: AppData; id: string; params: URLSearchParams }) {
  const profile = data.profile!;
  const w = findWorkout(data.mine, id);
  const [basis, setBasis] = useState<Basis>(w?.bases.includes(profile.basis) ? profile.basis : (w?.bases[0] ?? 'power'));
  const [showText, setShowText] = useState(false);
  if (!w) return <div class="empty">That workout is not in the library.</div>;
  const from = params.get('from') ?? 'library';
  const backHref = from === 'today' ? '#/today' : from === 'calendar' ? '#/calendar' : '#/library';
  const plannedEntry = params.get('date') ? data.planned.find((p) => p.date === params.get('date') && p.workoutId === w.id) : undefined;
  if (w.kind !== 'ride') return <SessionScreen w={w} backHref={backHref} planned={plannedEntry} basis={data.profile?.basis ?? 'power'} maxHr={data.profile?.maxHr ?? 0} lthr={data.profile?.lthr ?? 0} />;
  const s = workoutStats(w.blocks);

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
      {w.subtitle && <p style="margin:2px 0 0;font-size:16px;color:var(--ink-2)">{w.subtitle}</p>}
      <p class="muted small" style="margin:4px 0 14px">{clock(s.seconds)} · {s.tss} TSS · IF {s.intensityFactor.toFixed(2)}</p>
      <WorkoutProfile blocks={w.blocks} height={110} hero />
      <p style="margin:16px 0 6px;font-size:15px;line-height:1.6">{w.purpose}</p>
      {w.physiology && <p class="faint small">{w.physiology}</p>}

      <div class="row wrap" style="margin:18px 0;gap:8px">
        <button class="btn primary" onClick={() => schedule(today())}>Ride today</button>
        <button class="btn" onClick={() => schedule(addDays(today(), 1))}>Tomorrow</button>
        {w.source === 'mine' ? <a class="btn quiet" href={`#/build/${w.id}`}>Edit</a> : <a class="btn quiet" href={`#/build?copy=${w.id}`}>Copy and edit</a>}
        {w.source === 'generated' && <span class="faint small" style="align-self:center">built by the plan</span>}
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

      {plannedEntry && plannedEntry.status !== 'completed' && (
        <section class="section">
          <h2>Rode it without a device?</h2>
          <p class="faint small" style="margin:4px 0 8px">Normally the ride arrives from Intervals.icu on the next Sync. Use this only when nothing recorded it.</p>
          <SessionLog planned={plannedEntry} workout={w} defaultMinutes={Math.round(s.seconds / 60)} />
        </section>
      )}

      <section class="section">
        <button class="btn quiet sm" style="margin-left:-10px" onClick={() => setShowText(!showText)}>{showText ? 'Hide' : 'Show'} what is sent to Intervals.icu</button>
        {showText && <pre class="panel small" style="white-space:pre-wrap;margin-top:8px;font-family:inherit">{renderIntervalsText(w, basis)}</pre>}
      </section>
    </div>
  );
}


/** Strength, mobility and walk sessions: the checklist is the player. */
function SessionScreen({ w, backHref, planned, basis, maxHr, lthr }: { w: NonNullable<ReturnType<typeof findWorkout>>; backHref: string; planned?: PlannedWorkout; basis: 'power' | 'hr'; maxHr: number; lthr: number }) {
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function sendWalk() {
    if (!planned) return;
    const c = await credentials();
    if (!c) { setSendMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send workouts to your Garmin.' }); return; }
    setSending(true);
    try {
      const id = await sendWorkout(c, w, planned.date, basis, { maxHr, lthr });
      await db.planned.update(planned.id, { status: 'sent', icuEventId: id });
      notify();
      setSendMsg({ ok: true, text: 'Sent. It reaches your Garmin on its next phone sync.' });
    } catch (e) { setSendMsg({ ok: false, text: `Could not send: ${(e as Error).message}` }); }
    finally { setSending(false); }
  }
  const estimated = Math.round((w.exercises ?? []).reduce((s, e) => s + ((e.holdSeconds ?? 0) * (e.reps === 'each side' ? 2 : 1) + 15) * (e.sets ?? 1) + (e.sets && !e.holdSeconds ? e.sets * 75 : 0), 0) / 60);
  const minutes = w.minutes ?? w.walk?.minutes ?? (estimated || 30);
  return (
    <div>
      <a href={backHref} class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Back</a>
      <div class="row" style="gap:10px;margin-bottom:6px"><KindDot kind={w.kind} big /><span class="faint small">{KIND_LABEL[w.kind]} · about {minutes} min{w.estimatedTss ? <span title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does."> · ≈ {w.estimatedTss} TSS, estimated</span> : null}</span></div>
      <h1>{w.name}</h1>
      {planned && <p class="faint small" style="margin-top:4px">Planned for {fmtDate(planned.date)}{planned.note ? ` · ${planned.note}` : ''}.</p>}
      <p style="margin:14px 0 6px;font-size:15px;line-height:1.6">{w.purpose}</p>
      {w.physiology && <p class="faint small">{w.physiology}</p>}

      {w.walk && (
        <section class="section">
          <h2>The walk</h2>
          <div class="stats" style="margin-top:10px">
            <div class="stat"><div class="v">{w.walk.minutes}<span class="faint small" style="font-weight:400"> min</span></div><div class="l">Duration</div></div>
            <div class="stat"><div class="v">{Math.round(w.walk.hrLow * 100)}–{Math.round(w.walk.hrHigh * 100)}%</div><div class="l">of max heart rate</div></div>
            {maxHr > 0 && <div class="stat"><div class="v">{Math.round(maxHr * w.walk.hrLow)}–{Math.round(maxHr * w.walk.hrHigh)}</div><div class="l">beats per minute (your max {maxHr})</div></div>}
            {w.estimatedTss ? <div class="stat"><div class="v">≈ {w.estimatedTss}</div><div class="l">TSS, estimated from the heart-rate target{w.walk.packKg ? ' and pack' : ''}</div></div> : null}
            {w.walk.packKg && <div class="stat"><div class="v">{Math.round(w.walk.packKg * 2.2)}<span class="faint small" style="font-weight:400"> lb</span></div><div class="l">Pack weight</div></div>}
          </div>
          <p class="muted small" style="margin-top:10px">{w.walk.hrHigh <= 0.6 ? 'Very easy: this is recovery, so if the heart rate climbs, slow down.' : w.walk.hrLow >= 0.68 ? 'Purposeful: arms swinging, breathing noticeably but still able to talk in short sentences.' : 'Talk-in-full-sentences effort.'} Walks go by heart rate rather than power. On a flat treadmill the pack or the incline is what gets the heart rate up; raise speed, grade or weight until it settles in the target, and back off if it drifts higher.</p>
        </section>
      )}

      {w.exercises && (
        <section class="section">
          <h2>{w.kind === 'strength' ? 'Exercises' : 'Stretches'}</h2>
          <div class="stack" style="margin-top:10px">
            {w.exercises.map((e, i) => (
              <div class="panel" key={i} style="padding:12px 14px">
                <div class="row between">
                  <b>{e.name}</b>
                  <span class="num small muted">{e.sets ? `${e.sets} × ` : ''}{e.reps ?? (e.holdSeconds ? `${e.holdSeconds} s${e.sets ? '' : ' hold'}` : '')}</span>
                </div>
                {e.load && <div class="small" style="margin-top:4px;color:var(--ink-2)">{e.load}</div>}
                <div class="small" style="margin-top:6px;line-height:1.45">{e.cue}</div>
                {e.why && <div class="faint small" style="margin-top:4px;line-height:1.4">{e.why}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {planned && w.kind === 'walk' && (
        <section class="section">
          <h2>On the Garmin</h2>
          <p class="muted small" style="margin:4px 0 8px">{planned.status === 'sent' ? 'Sent: it is on your Garmin after its next phone sync, as a walking workout with the heart-rate target.' : planned.status === 'completed' ? 'Done.' : 'Send it as a walking workout with the heart-rate target, so the watch or head unit guides the effort and records it; the recording then comes back through Intervals.icu like a ride.'}</p>
          {planned.status === 'planned' && <button class="btn primary" onClick={sendWalk} disabled={sending}>{sending ? 'Sending…' : 'Send to Garmin'}</button>}
          {sendMsg && <p class={`msg ${sendMsg.ok ? 'ok' : 'err'}`} style="margin-top:8px">{sendMsg.text}</p>}
        </section>
      )}
      {planned && (
        <section class="section">
          <h2>{w.kind === 'walk' ? 'Or log it by hand' : 'Log it'}</h2>
          <div style="margin-top:8px"><SessionLog planned={planned} workout={w} defaultMinutes={minutes} /></div>
        </section>
      )}

      <div class="row wrap" style="margin-top:22px;gap:8px">
        {!planned && <button class="btn primary" onClick={() => setAdding(true)}>Add to a date</button>}
        {w.source === 'mine' ? <a class="btn quiet" href={`#/build/${w.id}`}>Edit</a> : <a class="btn quiet" href={`#/build?copy=${w.id}`}>Copy and edit</a>}
        {w.source === 'generated' && <span class="faint small" style="align-self:center">built by the plan</span>}
      </div>
      {adding && <AddToDate w={w} basis={basis} onClose={() => setAdding(false)} />}
    </div>
  );
}
