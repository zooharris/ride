import { footLthr } from '../../engine/zones';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { AppData } from '../store';
import { alreadyText, doneHistory, findWorkout, notify, scheduleWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { clock, renderIntervalsText, workoutStats } from '../../engine/workout';
import { addDays, today } from '../../engine/load';
import { go, goBack, replaceRoute } from '../router';
import { BackLink } from '../BackLink';
import type { Basis, PlannedWorkout, Ride, Workout } from '../../engine/types';
import { fmtDate } from '../derived';
import { SessionLog } from '../SessionLog';
import { type HrProfile } from '../../sync/intervals';
import { credentials } from '../../sync/syncService';
import { runEvent, sessionSteps } from '../../sync/intervals';
import { paceHint, timeWords } from '../../engine/run';
import { bandBpm, bandKeyOf, bandZoneWords, capFirst, hasNoFloor, recoveryBand, stepBand, walkBand, walkZoneWords } from '../../engine/foot';
import { KIND_LABEL, KindDot } from './Plan';
import { AddToDate } from './Library';
import { getPlans, removePlanned, sendPlanned, setEntryBasis, setWhere } from '../planService';
import { ChangeSheet } from '../ChangeSheet';
import { toast } from '../Toast';
import { Empty } from '../PageHead';
import { Star } from '../Star';
import { outdoorVersion, PURPOSE_LABEL, tagsOf } from '../../library/tags';
import { hasTwoVersions, versionFor, whereFor, type PlanDays, type Where } from '../../library/sendWhere';
import { LIBRARY } from '../../library/workouts';
import { StepsTable } from '../StepsTable';
import { lastDone, setsText, weightText } from '../../engine/record';
import { ExercisePictures } from '../ExercisePictures';
import { playerOffered, TRAINER_ONLY_ELSEWHERE } from '../../player/platform';
import { TrainerOnlyTag } from '../Thumbs';
import { APP_SHORT_NAME } from '../../appName';

export function WorkoutScreen({ data, id, params }: { data: AppData; id: string; params: URLSearchParams }) {
  const profile = data.profile!;
  const w = findWorkout(data.mine, id);
  // The calendar entry this page is about: the one on the date in the link, else the nearest upcoming entry for
  // this workout or for a copy of it (a library session is copied when it is put on a date).
  const sameSession = (p: PlannedWorkout) => { if (!w) return false; if (p.workoutId === w.id) return true; const c = findWorkout(data.mine, p.workoutId); return !!c && c.source === 'generated' && c.kind === w.kind && c.name === w.name; };
  const plannedEntry = !w ? undefined : params.get('date')
    ? data.planned.find((p) => p.date === params.get('date') && p.workoutId === w.id)
    : data.planned.filter((p) => p.date >= today() && p.status !== 'completed' && sameSession(p)).sort((a, b) => a.date.localeCompare(b.date))[0];
  // Power or heart rate (10 Nov 2026, one control). On a calendar entry's page (opened from the Calendar or Today, not
  // done) the switch is the entry's setting, "Ride by", and flipping it changes the entry. Anywhere else it is a view,
  // "Show as", starting on the rider's default; it changes nothing stored. The player opens with whatever it shows.
  const entryPage = !!plannedEntry && !!params.get('date') && plannedEntry.status !== 'completed' && !!w?.bases.includes(plannedEntry.basis);
  const [viewBasis, setViewBasis] = useState<Basis>(plannedEntry && w?.bases.includes(plannedEntry.basis) ? plannedEntry.basis : w?.bases.includes(profile.basis) ? profile.basis : (w?.bases[0] ?? 'power'));
  const basis: Basis = entryPage ? plannedEntry!.basis : viewBasis;
  const setBasis = (b: Basis) => { if (entryPage) { if (b !== plannedEntry!.basis) void setEntryBasis(plannedEntry!.id, b); } else setViewBasis(b); };
  const [adding, setAdding] = useState(false);
  const [showText, setShowText] = useState(false);
  const [change, setChange] = useState<'menu' | 'replace' | null>(null);
  // The plans' outdoor weekdays, for where a ride with an outdoor version will be ridden (10 Nov 2026).
  const [plans, setPlans] = useState<PlanDays[]>([]);
  useEffect(() => { void getPlans().then(setPlans).catch(() => {}); }, [data.planned]);
  if (!w) return <Empty title="That workout is not in the library." action={<a class="btn sm" href="#/library">Open the library</a>}>It may have been deleted from My Workouts on this or another device.</Empty>;
  const from = params.get('from') ?? 'library';
  // Where Back goes when nothing is behind this page (a fresh tab); otherwise Back returns to the page before, as it was left.
  const backHref = from === 'today' ? '#/today' : from === 'calendar' ? (params.get('date') ? `#/calendar?d=${params.get('date')}` : '#/calendar') : from === 'rides' ? (params.get('ride') ? `#/rides/${params.get('ride')}` : '#/rides') : '#/library';
  const recording = plannedEntry?.status === 'completed' && plannedEntry.activityId ? data.rides.find((r) => r.id === plannedEntry.activityId) : undefined;
  const units = profile.units ?? 'imperial';
  // Move, replace or remove this session; the page follows a move to its new date.
  const changeSheet = change && plannedEntry && <ChangeSheet data={data} planned={plannedEntry} startWith={change} onClose={() => setChange(null)}
    onDone={(what, p) => { if (what === 'moved') replaceRoute(`workout/${w.id}?from=${from}&date=${p.date}`); else goBack(backHref); }} />;
  const changeButtons = plannedEntry && plannedEntry.status !== 'completed' && <><button class="btn sm" style="margin-left:6px" onClick={() => setChange('menu')}>Move</button><button class="btn sm" style="margin-left:6px" onClick={() => setChange('replace')}>Replace</button></>;
  if (w.kind !== 'ride') return <SessionScreen w={w} backHref={backHref} planned={plannedEntry} recording={recording} history={doneHistory(data.planned, data.edits)} units={units} basis={data.profile?.basis ?? 'power'} maxHr={data.profile?.maxHr ?? 0} lthr={data.profile?.lthr ?? 0} hr={data.profile ?? undefined} thresholdPace={data.profile?.thresholdPaceSec} changeButtons={changeButtons} changeSheet={changeSheet} onRemove={plannedEntry ? async () => { if (await removePlanned(plannedEntry.id, data.mine)) goBack(backHref); } : undefined} />;
  const s = workoutStats(w.blocks);

  async function schedule(date: string) {
    // Through the one adding function, so the duplicate check (and the library-copy step) apply here too.
    if (await scheduleWorkout(w!, date, basis) === 'already') { toast({ ok: false, text: alreadyText(w!.name, date) }); return; }
    go('calendar');
  }



  return (
    <div>
      <BackLink fallback={backHref} style="margin-left:-10px;margin-bottom:8px" />
      <div class="row between" style="margin-bottom:6px">
        <span class="row" style="gap:6px"><span class="tag" style={`--c:var(--z${s.dominantZone})`}>{PURPOSE_LABEL[tagsOf(w).purpose]}</span>{w.trainerOnly && <TrainerOnlyTag />}</span>
        {w.bases.length > 1 ? (
          <div class="row" style="gap:8px;align-items:center">
            <span class="small muted">{entryPage ? 'Ride by' : 'Show as'}</span>
            <div class="seg" role="group" aria-label={entryPage ? 'Ride by' : 'Show as'}>
              <button class={basis === 'power' ? 'on' : ''} aria-pressed={basis === 'power'} onClick={() => setBasis('power')}>Power</button>
              <button class={basis === 'hr' ? 'on' : ''} aria-pressed={basis === 'hr'} onClick={() => setBasis('hr')}>Heart rate</button>
            </div>
          </div>
        ) : <span class="faint small">{w.bases[0] === 'power' ? 'power only' : 'heart rate only'}</span>}
      </div>
      {entryPage && !w.trainerOnly && <GarminLine w={w} entry={plannedEntry!} where={whereFor(plannedEntry, w, plans)} profile={profile} />}
      <div class="row" style="gap:8px;align-items:center"><h1>{w.name}</h1><Star w={w} /></div>
      {w.subtitle && <p style="margin:2px 0 0;font-size:16px;color:var(--ink-2)">{w.subtitle}</p>}
      <p class="muted small" style="margin:4px 0 14px">{clock(s.seconds)} · {s.tss} TSS · intensity {s.intensityFactor.toFixed(2)}</p>
      <WorkoutProfile blocks={w.blocks} height={110} hero targets={{ profile, basis, touch: true }} />
      <p style="margin:16px 0 6px;font-size:15px;line-height:1.6">{w.purpose}</p>
      {w.physiology && <p class="faint small">{w.physiology}</p>}
      <OutdoorNote w={w} entry={plannedEntry && plannedEntry.status !== 'completed' ? plannedEntry : undefined} plans={plans} />
      {!entryPage && plannedEntry && plannedEntry.status === 'sent' && <StaleCopy w={w} entry={plannedEntry} where={whereFor(plannedEntry, w, plans)} profile={profile} />}

      <div class="row wrap" style="margin:18px 0;gap:8px">
        {w.trainerOnly && playerOffered() && <a class="btn primary" href={plannedEntry && plannedEntry.status !== 'completed' ? `#/play/planned/${plannedEntry.id}?basis=${basis}` : `#/play/workout/${w.id}?basis=${basis}`}>Ride indoors on the trainer</a>}
        <button class={`btn${w.trainerOnly ? '' : ' primary'}`} onClick={() => schedule(today())}>Ride today</button>
        <button class="btn" onClick={() => schedule(addDays(today(), 1))}>Tomorrow</button>
        {!w.trainerOnly && playerOffered() && <a class="btn" href={plannedEntry && plannedEntry.status !== 'completed' ? `#/play/planned/${plannedEntry.id}?basis=${basis}` : `#/play/workout/${w.id}?basis=${basis}`}>Ride indoors on the trainer</a>}
        {w.source === 'mine' ? <a class="btn" href={`#/build/${w.id}`}>Edit</a> : <a class="btn" href={`#/build?copy=${w.id}`}>Copy and edit</a>}
        {w.source === 'generated' && <span class="faint small" style="align-self:center">built by the plan</span>}
        {/* The same Add to a date sheet as every other page (10 Nov 2026): a hidden date box over a label opened nothing on a laptop. */}
        <button class="btn" onClick={() => setAdding(true)}>Pick a date</button>
      </div>
      {w.trainerOnly && <p class="faint small" style="margin-top:-8px;margin-bottom:14px">Ridden on the trainer in {APP_SHORT_NAME}, not sent to the Garmin: a Garmin workout is a fixed list of steps, and this one goes on until you can't.{playerOffered() ? '' : ` ${TRAINER_ONLY_ELSEWHERE}`}</p>}
      {plannedEntry && (<>
        <p class="faint small" style="margin-top:-8px;margin-bottom:14px">Planned for {fmtDate(plannedEntry.date)}{plannedEntry.note ? ` · ${plannedEntry.note}` : ''}.{entryPage && !w.trainerOnly && plannedEntry.status !== 'sent' && <SendButton w={w} entry={plannedEntry} profile={profile} />}{changeButtons} <button class="btn sm quiet" onClick={async () => { if (await removePlanned(plannedEntry.id, data.mine)) goBack(backHref); }}>Remove from the calendar</button></p>
        {plannedEntry.reason && <p style="margin:-6px 0 14px;font-size:15px"><b>Why it’s on your plan:</b> {plannedEntry.reason}</p>}
      </>)}

      <section class="section">
        <h2>Steps</h2>
        {w.test === 'ramp' ? <p class="faint small" style="margin:4px 0 8px">The standard ramp, each step as a share of FTP (yours is {profile.ftp} W). In the ride player you choose the step size, the trainer holds each step, and the steps keep climbing until you stop.</p>
        : <p class="faint small" style="margin:4px 0 8px">Each step as a share of FTP, and what that is in watts (FTP {profile.ftp}) and in beats per minute (threshold {profile.lthr}, through your zone tables). The Garmin holds you to the {basis === 'power' ? 'watts' : 'heart rate'}; the other column is there to read.</p>}
        <StepsTable blocks={w.blocks} basis={basis} profile={profile} />
      </section>

      {plannedEntry && plannedEntry.status === 'completed' && (
        <section class="section">
          <h2>Done</h2>
          <div style="margin-top:8px"><SessionLog planned={plannedEntry} workout={w} defaultMinutes={Math.round(s.seconds / 60)} recording={recording} units={units} history={doneHistory(data.planned, data.edits)} /></div>
        </section>
      )}
      {plannedEntry && plannedEntry.status !== 'completed' && (
        <section class="section">
          <h2>Rode it without a device?</h2>
          <p class="faint small" style="margin:4px 0 8px">Normally the ride arrives from Intervals.icu on the next Sync. Use this only when nothing recorded it.</p>
          <SessionLog planned={plannedEntry} workout={w} defaultMinutes={Math.round(s.seconds / 60)} units={units} history={doneHistory(data.planned, data.edits)} />
        </section>
      )}

      {!w.trainerOnly && <section class="section">
        <button class="btn quiet sm" style="margin-left:-10px" onClick={() => setShowText(!showText)}>{showText ? 'Hide' : 'Show'} what is sent to Intervals.icu</button>
        {showText && <pre class="panel small" style="white-space:pre-wrap;margin-top:8px;font-family:inherit">{renderIntervalsText(versionFor(w, whereFor(plannedEntry, w, plans)).workout, basis)}</pre>}
      </section>}
      {changeSheet}
      {adding && <AddToDate w={w} basis={basis} onClose={() => setAdding(false)} />}
    </div>
  );
}


/** Strength, mobility and walk sessions: the checklist is the player. */
function SessionScreen({ w, backHref, planned, recording, history, units, basis, maxHr, lthr, hr, thresholdPace, onRemove, changeButtons, changeSheet }: { w: NonNullable<ReturnType<typeof findWorkout>>; backHref: string; planned?: PlannedWorkout; recording?: Ride; history: PlannedWorkout[]; units: 'imperial' | 'metric'; basis: 'power' | 'hr'; maxHr: number; lthr: number; hr?: HrProfile; thresholdPace?: number; onRemove?: () => void; changeButtons?: ComponentChildren; changeSheet?: ComponentChildren }) {
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const setSendMsg = toast;
  async function sendWalk() {
    if (!planned) return;
    const c = await credentials();
    if (!c) { setSendMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send sessions to your Garmin.' }); return; }
    setSending(true);
    try {
      const again = planned.status === 'sent';
      await sendPlanned(c, { ...planned, basis }, w, hr ?? { maxHr, lthr });
      notify();
      setSendMsg({ ok: true, text: again ? 'Sent again: the copy on your Garmin is replaced with this version after its next phone sync.' : w.kind === 'strength' || w.kind === 'mobility' ? 'Sent. On the watch it is under Today\'s Workouts in an indoor-bike profile (Garmin only shows step names for rides); the recording is filed here as what it really was.' : 'Sent. It reaches your Garmin on its next phone sync.' });
    } catch (e) { setSendMsg({ ok: false, text: `Could not send: ${(e as Error).message}` }); }
    finally { setSending(false); }
  }
  const estimated = Math.round((w.exercises ?? []).reduce((s, e) => s + ((e.holdSeconds ?? 0) * (e.reps === 'each side' ? 2 : 1) + 15) * (e.sets ?? 1) + (e.sets && !e.holdSeconds ? e.sets * 75 : 0), 0) / 60);
  const minutes = w.minutes ?? w.walk?.minutes ?? (estimated || 30);
  return (
    <div>
      <BackLink fallback={backHref} style="margin-left:-10px;margin-bottom:8px" />
      <div class="row" style="gap:10px;margin-bottom:6px"><KindDot kind={w.kind} big /><span class="faint small">{KIND_LABEL[w.kind]} · about {minutes} min{planned ? <> · on the calendar {planned.date === today() ? 'today' : fmtDate(planned.date, { weekday: 'long', month: 'short', day: 'numeric' })}</> : null}{w.estimatedTss ? <span title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does."> · ≈ {w.estimatedTss} TSS, estimated</span> : null}</span></div>
      <div class="row" style="gap:8px;align-items:center"><h1>{w.name}</h1><Star w={w} /></div>
      {planned && <p class="faint small" style="margin-top:4px">Planned for {fmtDate(planned.date)}{planned.note ? ` · ${planned.note}` : ''}.{changeButtons}{onRemove && <button class="btn danger sm" style="margin-left:6px" onClick={onRemove}>Remove from the calendar</button>}</p>}
      {planned?.reason && <p style="margin:8px 0 0;font-size:15px"><b>Why it’s on your plan:</b> {planned.reason}</p>}
      <p style="margin:14px 0 6px;font-size:15px;line-height:1.6">{w.purpose}</p>
      {w.physiology && <p class="faint small">{w.physiology}</p>}

      {w.walk && (() => {
        const b = walkBand(w.walk, hr);
        const bpm = bandBpm(b, hr);
        const noFloor = hasNoFloor(b);
        return (
        <section class="section">
          <h2>The walk</h2>
          <div class="stats" style="margin-top:10px">
            <div class="stat"><div class="v">{w.walk.minutes}<span class="faint small" style="font-weight:400"> min</span></div><div class="l">Duration</div></div>
            <div class="stat"><div class="v">{capFirst(walkZoneWords(w.walk, hr))}</div><div class="l">heart-rate band on your foot table{noFloor ? ' · no minimum' : ''}</div></div>
            {bpm && <div class="stat"><div class="v">{noFloor ? 'up to ' : `${bpm.low}–`}{bpm.high}</div><div class="l">beats per minute (foot threshold {footLthr(hr ?? { lthr })})</div></div>}
            {w.estimatedTss ? <div class="stat"><div class="v">≈ {w.estimatedTss}</div><div class="l">TSS, estimated from the heart-rate band{w.walk.packKg ? ' and pack' : ''}</div></div> : null}
            {w.walk.packKg && <div class="stat"><div class="v">{Math.round(w.walk.packKg * 2.2)}<span class="faint small" style="font-weight:400"> lb</span></div><div class="l">Pack weight</div></div>}
          </div>
          <p class="muted small" style="margin-top:10px">{noFloor ? 'No minimum: walk at whatever pace feels steady; the only rule is to slow down if the heart rate climbs past the ceiling. On the flat it drifts up slowly over the walk and may stay in zone 1 the whole way, and that is the walk done right.' : <>{b.zoneLow >= 2.5 ? 'Purposeful: arms swinging, breathing noticeably but still able to talk in short sentences.' : 'Talk-in-full-sentences effort.'} Walks go by heart rate rather than power. Speed and grade are what get the heart rate up, far more than a heavier pack: walk faster or find a hill (or raise the treadmill's grade) until it settles in the band, and back off if it drifts higher.</>}</p>
        </section>
        );
      })()}

      {w.run && (
        <section class="section">
          <h2>The run</h2>
          <table class="steps" style="margin-top:8px">
            <tr><td class="faint small">Step</td><td class="faint small">Time</td><td class="faint small">Heart-rate band</td><td class="faint small r">bpm</td>{thresholdPace ? <td class="faint small r">Pace, as a guide</td> : null}</tr>
            {w.run.steps.flatMap((s, i) => {
              const n = Math.max(1, s.repeat ?? 1);
              const row = (key: string, label: string, sec: number, b: ReturnType<typeof stepBand>) => {
                const bpm = bandBpm(b, hr);
                return (
                <tr key={key}>
                  <td style="white-space:nowrap">{label}</td><td class="num" style="white-space:nowrap">{n > 1 && key.endsWith('w') ? `${n} × ` : ''}{timeWords(sec)}</td><td>{bandZoneWords(b)}</td>
                  <td class="r num">{bpm ? `${hasNoFloor(b) ? 'up to ' : `${bpm.low}–`}${bpm.high}` : '–'}</td>
                  {thresholdPace ? <td class="r num">{paceHint(bandKeyOf(b), thresholdPace, units === 'imperial') ?? '–'}</td> : null}
                </tr>
                );
              };
              const out = [row(`${i}w`, s.label ? s.label.charAt(0).toUpperCase() + s.label.slice(1) : `Step ${i + 1}`, s.seconds, stepBand(s, hr))];
              if (n > 1 && s.recoverSeconds) { const rb = recoveryBand(s, hr); out.push(row(`${i}r`, `  between: ${hasNoFloor(rb) ? 'walk' : 'easy'}`, s.recoverSeconds, rb)); }
              return out;
            })}
          </table>
          <p class="muted small" style="margin-top:10px">Runs go by heart rate, each band a zone on your foot table (threshold {footLthr(hr ?? { lthr })} bpm): the Garmin holds you in it. {thresholdPace ? 'The pace column comes from your threshold pace and is only a guide; on hills, heat or tired legs, follow the heart rate.' : 'Set a threshold run pace in Settings to see the pace each band implies.'} Easy means easy: if the heart rate climbs past the band, slow down or walk.</p>
        </section>
      )}

      {w.exercises && (
        <section class="section">
          <h2>{w.kind === 'strength' ? 'Exercises' : 'Stretches'}</h2>
          <div class="stack" style="margin-top:10px">
            {w.exercises.map((e, i) => (
              <div class="panel ex-panel" key={i} style="padding:12px 14px">
                <ExercisePictures name={e.name} cue={e.cue} />
                <div class="ex-text">
                <div class="row between">
                  <b>{e.name}</b>
                  <span class="num small muted">{e.sets ? `${e.sets} × ` : ''}{e.reps ?? (e.holdSeconds ? `${e.holdSeconds} s${e.sets ? '' : ' hold'}` : '')}</span>
                </div>
                {e.load && <div class="small" style="margin-top:4px;color:var(--ink-2)">{e.load}</div>}
                {w.kind === 'strength' && planned?.status !== 'completed' && (() => { const last = lastDone(e.name, history, planned?.date ?? today()); return last ? <div class="small" style="margin-top:4px;color:var(--accent)">Last time: {weightText(last)} · {setsText(last)} · {fmtDate(last.date)}</div> : null; })()}
                <div class="small" style="margin-top:6px;line-height:1.45">{e.cue}</div>
                {e.why && <div class="faint small" style="margin-top:4px;line-height:1.4">{e.why}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {planned && w.kind !== 'ride' && planned.status !== 'completed' && (
        <section class="section">
          <h2>On the Garmin</h2>
          <p class="muted small" style="margin:4px 0 8px">{planned.status === 'sent' ? (w.kind === 'walk' ? 'Sent: it is on your Garmin after its next phone sync, as a walking workout with the heart-rate target.' : w.kind === 'run' ? 'Sent: it is on your Garmin after its next phone sync, as a running workout with each step and its heart-rate band.' : 'Sent: it is on your Garmin after its next phone sync, as a step-by-step workout. Start it from the watch\u2019s Training menu; the recording comes back here through Intervals.icu.') : w.kind === 'walk' ? 'Send it as a walking workout with the heart-rate target, so the watch or head unit guides the effort and records it; the recording then comes back through Intervals.icu like a ride.' : w.kind === 'run' ? 'Send it as a running workout: the watch shows each step with its heart-rate band and moves you on. The recording comes back through Intervals.icu and is matched to this session.' : w.kind === 'strength' ? 'Send it as a step-by-step strength workout: the watch names each exercise with its reps and load, each set ends when you press lap, and each rest counts down. The recording comes back through Intervals.icu and is matched to this session.' : 'Send it as a timed stretching routine: the watch names each stretch and counts the hold down, then moves you on. The recording comes back through Intervals.icu and is matched to this session.'}</p>
          {planned.status === 'planned' && <button class="btn primary" onClick={sendWalk} disabled={sending}>{sending ? 'Sending…' : 'Send to Garmin'}</button>}
          {planned.status === 'sent' && <button class="btn" onClick={sendWalk} disabled={sending} title="Replaces the copy on your Garmin with this version">{sending ? 'Sending…' : 'Send again'}</button>}
          {w.kind === 'run' && (
            <details style="margin-top:10px"><summary class="small muted">What the watch will show, step by step</summary>
              <pre class="panel small" style="white-space:pre-wrap;margin-top:8px;font-family:inherit">{runEvent(w, planned.date, hr ?? { maxHr, lthr }).description.split('\n').slice(2).join('\n')}</pre>
              <p class="faint small">Percentages are of your threshold heart rate on foot ({footLthr(hr ?? { lthr })} bpm), which is how Intervals.icu and the Garmin take heart-rate targets; the app's bands are zones on your foot table, so the percentages come straight from it.</p>
            </details>
          )}
          {w.kind !== 'walk' && w.kind !== 'run' && (
            <details style="margin-top:10px"><summary class="small muted">What the watch will show, step by step</summary>
              <pre class="panel small" style="white-space:pre-wrap;margin-top:8px;font-family:inherit">{sessionSteps(w).map((l) => /^\d+x$/.test(l) ? `${l.slice(0, -1)} sets of:` : l.replace(/^- /, '  ')).join('\n')}</pre>
              <p class="faint small">"Press lap" steps end when you press the lap button; the time after a set is only the estimate the plan uses. Rests and holds count down on the watch. Repeated sets appear as repeats.</p>
            </details>
          )}
        </section>
      )}
      {planned && (
        <section class="section">
          <h2>{planned.status === 'completed' ? 'Done' : 'Or log it by hand'}</h2>
          <div style="margin-top:8px"><SessionLog planned={planned} workout={w} defaultMinutes={minutes} recording={recording} units={units} history={history} /></div>
        </section>
      )}

      <div class="row wrap" style="margin-top:22px;gap:8px">
        {!planned && <button class="btn primary" onClick={() => setAdding(true)}>Add to a date</button>}
        {w.source === 'mine' ? <a class="btn" href={`#/build/${w.id}`}>Edit</a> : <a class="btn" href={`#/build?copy=${w.id}`}>Copy and edit</a>}
        {w.source === 'generated' && <span class="faint small" style="align-self:center">built by the plan</span>}
      </div>
      {adding && <AddToDate w={w} basis={basis} onClose={() => setAdding(false)} />}
      {changeSheet}
    </div>
  );
}

/**
 * How the ride fares on a bike computer outdoors (9 Nov 2026, Part C): what the Garmin copy softens, or,
 * for a ride with no honest outdoor version, the nearest Library ride of the same purpose that rides well outdoors.
 */
function OutdoorNote({ w, entry, plans }: { w: Workout; entry?: PlannedWorkout; plans: PlanDays[] }) {
  const t = tagsOf(w);
  if (w.trainerOnly) return null;
  if (hasTwoVersions(w)) {
    const { note } = outdoorVersion(w);
    const softened = note ? note.replace(/^Adjusted for riding outdoors: /, '').replace(/^./, (c) => c.toUpperCase()) : '';
    // From the Library (no date yet): what the Garmin copy would soften, for information.
    if (!entry) return note ? <p class="faint small" style="margin-top:6px"><b>On the Garmin, outdoors:</b> {softened} On a trainer it goes as written, and the ride player always keeps the steps as written.</p> : null;
    // On the calendar (10 Nov 2026): the rider says where, and the Garmin gets that version.
    const where = whereFor(entry, w, plans);
    return (
      <div class="where" style="margin-top:10px">
        <div class="row wrap" style="gap:10px;align-items:center">
          <span class="small muted">Riding it</span>
          <div class="seg" role="group" aria-label="Riding it">
            {(['outdoor', 'trainer'] as Where[]).map((x) => <button key={x} class={where === x ? 'on' : ''} aria-pressed={where === x} onClick={() => void setWhere(entry.id, x, where)}>{x === 'outdoor' ? 'Outdoors' : 'On a trainer'}</button>)}
          </div>
        </div>
        <p class="faint small" style="margin:6px 0 0">{where === 'outdoor' ? <><b>On the Garmin:</b> {softened}</> : 'Sent to your Garmin exactly as written.'} The ride player on the trainer always keeps the steps as written.</p>
      </div>
    );
  }
  if (t.outdoor !== 'indoor') return null;
  const alt = LIBRARY.filter((x) => x.id !== w.id && tagsOf(x).purpose === t.purpose && tagsOf(x).outdoor === 'well' && w.bases.some((b) => x.bases.includes(b)))
    .sort((a, b) => Math.abs(tagsOf(a).minutes - t.minutes) - Math.abs(tagsOf(b).minutes - t.minutes))[0];
  return <p class="faint small" style="margin-top:6px"><b>Best on the trainer:</b> its quick changes can't be followed on an open road.{alt ? <> For a road ride, <a href={`#/workout/${alt.id}?from=library`}>{alt.name}</a> ({alt.subtitle ?? PURPOSE_LABEL[t.purpose]}) does a similar job.</> : null}</p>;
}

/**
 * The copy on the Garmin no longer matches the page (10 Nov 2026): the rider switched outdoors/trainer or power/heart
 * rate after sending. Never re-sent by itself; one line says what the Garmin has, with Send again.
 */
function StaleCopy({ w, entry, where, profile }: { w: Workout; entry: PlannedWorkout; where: Where; profile?: HrProfile }) {
  const [sending, setSending] = useState(false);
  const parts: string[] = [];
  if (entry.sentBasis && entry.sentBasis !== entry.basis) parts.push(entry.sentBasis === 'hr' ? 'by heart rate' : 'by power');
  if (hasTwoVersions(w) && entry.sentWhere && entry.sentWhere !== where) parts.push(entry.sentWhere === 'outdoor' ? 'the outdoor version' : 'the ride as written');
  if (!parts.length) return null;
  const sendAgain = async () => {
    const c = await credentials();
    if (!c) { toast({ ok: false, text: 'Connect Intervals.icu in Settings to send rides to your Garmin.' }); return; }
    setSending(true);
    try { await sendPlanned(c, entry, w, profile); notify(); toast({ ok: true, text: 'Sent again: the copy on your Garmin is replaced after its next phone sync.' }); }
    catch (e) { toast({ ok: false, text: `Could not send: ${(e as Error).message}` }); }
    finally { setSending(false); }
  };
  return <p class="small" style="margin:8px 0 0">The copy on your Garmin is {parts.join(', and ')}. <button class="btn sm" disabled={sending} onClick={() => void sendAgain()}>{sending ? 'Sending…' : 'Send again'}</button></p>;
}

/** The words for a power or heart-rate setting, as the Garmin line uses them. */
const targetWord = (b: Basis) => (b === 'hr' ? 'heart-rate' : 'power');

/**
 * What the Garmin gets for this entry (10 Nov 2026, one control): always shown under Ride by on an entry's page. Not
 * yet sent, what it will get; sent, what it has, with Send again when that differs from the page (power or heart
 * rate, or the outdoor version or the ride as written). Never re-sent by itself.
 */
function GarminLine({ w, entry, where, profile }: { w: Workout; entry: PlannedWorkout; where: Where; profile?: HrProfile }) {
  const [sending, setSending] = useState(false);
  if (entry.status !== 'sent') return <p class="faint small garmin-line">Your Garmin gets {targetWord(entry.basis)} targets when you send it.</p>;
  const hasBasis = entry.sentBasis ?? entry.basis;
  const whereDiffers = hasTwoVersions(w) && !!entry.sentWhere && entry.sentWhere !== where;
  const differs = hasBasis !== entry.basis || whereDiffers;
  const sendAgain = async () => {
    const c = await credentials();
    if (!c) { toast({ ok: false, text: 'Connect Intervals.icu in Settings to send rides to your Garmin.' }); return; }
    setSending(true);
    try {
      const r = await sendPlanned(c, entry, w, profile); notify();
      const which = r.version === 'outdoor' ? ' the outdoor version' : r.version === 'as written' ? ' as written' : '';
      toast({ ok: true, text: `Sent again${which}: the copy on your Garmin is replaced after its next phone sync.` });
    } catch (e) { toast({ ok: false, text: `Could not send: ${(e as Error).message}` }); }
    finally { setSending(false); }
  };
  const version = whereDiffers ? (entry.sentWhere === 'outdoor' ? ', in its outdoor version' : ', as written') : '';
  return (
    <p class={`small garmin-line${differs ? '' : ' faint'}`}>Your Garmin has the {targetWord(hasBasis)} version{version}.
      {differs && <> <button class="btn sm" disabled={sending} onClick={() => void sendAgain()}>{sending ? 'Sending…' : 'Send again'}</button></>}</p>
  );
}

/** Send to Garmin from an entry's page (10 Nov 2026): the same send as Today's, naming the version for a two-version ride. */
function SendButton({ w, entry, profile }: { w: Workout; entry: PlannedWorkout; profile?: HrProfile }) {
  const [sending, setSending] = useState(false);
  const send = async () => {
    const c = await credentials();
    if (!c) { toast({ ok: false, text: 'Connect Intervals.icu in Settings to send rides to your Garmin.' }); return; }
    setSending(true);
    try {
      const r = await sendPlanned(c, entry, w, profile); notify();
      const which = r.version === 'outdoor' ? ' the outdoor version' : r.version === 'as written' ? ' as written' : '';
      toast({ ok: true, text: `Sent${which}. It will be on your Garmin after the next phone sync, under Training, Workouts.` });
    } catch (e) { toast({ ok: false, text: `Could not send: ${(e as Error).message}` }); }
    finally { setSending(false); }
  };
  return <button class="btn sm" style="margin-left:6px" disabled={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send to Garmin'}</button>;
}
