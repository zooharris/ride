import { useEffect, useState } from 'preact/hooks';
import { MonthGrid, monthOf, shiftMonth } from '../MonthGrid';
import { STATUS_WORD, StatusMark, StatusPill, statusOf } from '../StatusMark';
import { KIND_COLOR } from './Plan';
import { ZONE_VAR } from '../Profile';
import type { AppData } from '../store';
import { alreadyText, findWorkout, notify, scheduleWorkout, sessionHref } from '../store';
import { WorkoutProfile } from '../Profile';
import { addDays, today } from '../../engine/load';
import { clock, workoutStats } from '../../engine/workout';
import { fmtDate, plannedOn, weekStart } from '../derived';
import { db } from '../../data/db';
import type { PlannedWorkout, Ride, Workout } from '../../engine/types';
import { credentials } from '../../sync/syncService';
import { sendWorkout } from '../../sync/intervals';
import { KIND_LABEL, KindDot } from './Plan';
import { getPlans, replacePlanned } from '../planService';
import { ChangeSheet, WorkoutPicker, moveSession } from '../ChangeSheet';
import { useDragMove } from '../useDragMove';
import { toast } from '../Toast';
import { PageHead } from '../PageHead';
import { WeekBar } from '../Glance';
import { weekSummary } from '../week';
import { Icon } from '../icons';
import { ActivityPicture, ExerciseRow } from '../Thumbs';
import { picturedCount } from '../ExercisePictures';
import { WeekNote } from '../MonthGrid';

/** A name short enough for a month cell: the part before any colon ("Strength A"), at most 14 characters. The full name is the cell's title. */
function shortName(name: string): string {
  const n = name.split(':')[0].trim();
  return n.length > 14 ? `${n.slice(0, 13).trimEnd()}…` : n;
}

const sendable = (k?: string) => k === 'ride' || k === 'walk' || k === 'run' || k === 'strength' || k === 'mobility';

export function Calendar({ data, params }: { data: AppData; params?: URLSearchParams }) {
  const profile = data.profile!;
  const focus = params?.get('d') ?? undefined;
  const [start, setStart] = useState(weekStart(focus && /^\d{4}-\d{2}-\d{2}$/.test(focus) ? focus : today()));
  // The calendar always opens as the month (the rider's preference); a link to one day opens the list at that day.
  const [view, setView] = useState<'list' | 'month'>(focus ? 'list' : 'month');
  const [month, setMonth] = useState(monthOf(today()));
  // Opened from Today's week strip or its ⋯ button: show that week as a list, and open the change sheet if asked.
  useEffect(() => { setView(focus ? 'list' : 'month'); }, [focus]);
  useEffect(() => { if (focus) setStart(weekStart(focus)); }, [focus]);
  // ...and scroll to that day, outlined for a moment. After a short delay, so it lands after the
  // shell's own scroll to the top of a new screen (which runs after this component's effects).
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || view !== 'list') return;
    const go = setTimeout(() => {
      document.getElementById(`day-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setFlash(focus);
    }, 80);
    const stop = setTimeout(() => setFlash(null), 2200);
    return () => { clearTimeout(go); clearTimeout(stop); };
    // Once per focused day: moving between weeks or views afterwards must not scroll or flash again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  const pickView = (v: 'list' | 'month') => setView(v);
  const [picking, setPicking] = useState<{ date: string; replace?: PlannedWorkout } | null>(null);
  const [changing, setChanging] = useState<PlannedWorkout | null>(null);
  // A month cell with more than one session to change: choose which first.
  const [choosing, setChoosing] = useState<string | null>(null);
  // Recovery weeks of every plan, to shade them on the month view.
  const [recoveryWeeks, setRecoveryWeeks] = useState<Set<string>>(new Set());
  useEffect(() => { getPlans().then((ps) => setRecoveryWeeks(new Set(ps.flatMap((p) => (p.weeks ?? []).filter((w) => w.phase === 'recovery').map((w) => weekStart(w.start)))))); }, [data.planned.length]);
  const changeId = params?.get('change');
  useEffect(() => {
    if (!changeId) return;
    const p = data.planned.find((x) => x.id === changeId);
    if (p && p.status !== 'completed') setChanging(p);
    history.replaceState(null, '', `${location.pathname}#/calendar${focus ? `?d=${focus}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeId]);
  const setMsg = toast;
  const [busy, setBusy] = useState<string | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  // Drag a session to another day with the mouse (laptop); the ⋯ sheet does the same anywhere.
  const dnd = useDragMove((id, date) => { const p = data.planned.find((x) => x.id === id); if (p) moveSession(data, p, date); });
  const movable = (p: PlannedWorkout) => p.status !== 'completed';
  async function add(date: string, w: Workout) {
    const r = picking?.replace ? await replacePlanned(picking.replace, w, profile.basis) : await scheduleWorkout(w, date, profile.basis);
    if (r === 'already') { toast({ ok: false, text: alreadyText(w.name, picking?.replace?.date ?? date) }); return; }
    setPicking(null);
  }

  async function sendWeek(ws: string) {
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send sessions to your Garmin.' }); return; }
    const end = addDays(ws, 6);
    const todo = data.planned.filter((p) => p.date >= ws && p.date <= end && p.date >= today() && p.status === 'planned' && sendable(findWorkout(data.mine, p.workoutId)?.kind));
    if (todo.length === 0) { setMsg({ ok: true, text: 'Nothing unsent in that week.' }); return; }
    setBusy(ws);
    let sent = 0;
    try {
      for (const p of todo) {
        const w = findWorkout(data.mine, p.workoutId);
        if (!w) continue;
        const id = await sendWorkout(c, w, p.date, p.basis, profile);
        await db.planned.update(p.id, { status: 'sent', icuEventId: id });
        sent++;
      }
      setMsg({ ok: true, text: `Sent ${sent} session${sent === 1 ? '' : 's'}. They reach your Garmin on its next phone sync.` });
    } catch (e) {
      setMsg({ ok: false, text: `Sent ${sent}, then: ${(e as Error).message}` });
    } finally { setBusy(null); notify(); }
  }


  return (
    <div>
      <PageHead title="Calendar" help="calendar">
        <>
          <a class="btn sm" href="#/plan">Plan my training</a>
          <div class="seg"><button class={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>List</button><button class={view === 'month' ? 'on' : ''} onClick={() => pickView('month')}>Month</button></div>
          {view === 'list' && <div class="row" style="gap:0">
            <button class="icon-btn" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><span style="transform:scaleX(-1);display:inline-flex"><Icon.chevron /></span></button>
            <button class="btn sm quiet" onClick={() => setStart(weekStart(today()))}>This week</button>
            <button class="icon-btn" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><Icon.chevron /></button>
          </div>}
        </>
      </PageHead>

      {view === 'month' && (
        <MonthGrid month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onToday={() => setMonth(monthOf(today()))}
          cellClass={(d) => `${recoveryWeeks.has(weekStart(d)) ? 'recovery' : ''} ${dnd.dropClass(d)}`}
          weekNote={(ws) => { const wk = weekSummary(ws, data.planned, data.rides, data.mine); return wk.plannedTss || wk.doneTss ? <WeekNote done={wk.doneTss} planned={wk.plannedTss} tag={recoveryWeeks.has(ws) ? 'recovery' : undefined} /> : null; }}
          render={(d) => {
            const plans = plannedOn(data.planned, d, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
            const rides = data.rides.filter((r) => r.date === d && !plans.some((p) => p.activityId === r.id));
            const changeable = plans.filter(movable);
            return (
              <>
                {changeable.length > 0 && <button class="month-more" title="Move, replace or remove" aria-label={`Move, replace or remove ${fmtDate(d)}'s session${changeable.length > 1 ? 's' : ''}`} onClick={() => (changeable.length === 1 ? setChanging(changeable[0]) : setChoosing(d))}><Icon.more size={14} /></button>}
                {plans.map((p) => {
                  const w = findWorkout(data.mine, p.workoutId);
                  if (!w) return null;
                  const colour = w.kind === 'ride' ? ZONE_VAR[workoutStats(w.blocks).dominantZone - 1] : KIND_COLOR[w.kind];
                  const rec = p.status === 'completed' && p.activityId ? data.rides.find((r) => r.id === p.activityId) : undefined;
                  // The picture: what was done for a done session (route, effort, exercises), else what is planned (the ride's diagram, the exercises).
                  const pic = rec ? <ActivityPicture ride={rec} w={w} profile={profile} height={56} />
                    : w.kind === 'ride' ? <span class="mi-diag"><WorkoutProfile blocks={w.blocks} height={30} ratio={6} /></span>
                    : w.kind === 'strength' || w.kind === 'mobility' ? <ExerciseRow w={w} max={3} /> : null;
                  return (
                    <a class={`month-item ${p.status} k-${w.kind}${pic ? ' has-pic' : ''}${movable(p) ? ' movable' : ''}${dnd.dragging === p.id ? ' drag-src' : ''}`} key={p.id} {...(movable(p) ? dnd.source(p.id, d, w.name) : {})} href={sessionHref(p, w.id, 'calendar', d, data.rides)} title={`${w.name} · ${STATUS_WORD[statusOf(p.status)]}`} style={`--c:${colour}`}>
                      <span class="mi-top"><StatusMark status={statusOf(p.status)} size={11} />{w.kind !== 'ride' && <KindDot kind={w.kind} />}<span class="mi-name">{shortName(w.name)}</span></span>
                      {pic && <span class="mi-pic">{pic}</span>}
                    </a>
                  );
                })}
                {rides.map((r) => <MonthDone key={r.id} r={r} data={data} title={`${r.name} · Done, unscheduled`} />)}
                {d >= today() && plans.length === 0 && rides.length === 0 && <button class="month-item" style="background:none;border:0;padding:0;cursor:pointer;color:var(--ink-3)" onClick={() => setPicking({ date: d })}>+</button>}
              </>
            );
          }} />
      )}

      {view === 'list' && <>

      {[0, 7].map((offset) => {
        const ws = addDays(start, offset);
        const wk = weekSummary(ws, data.planned, data.rides, data.mine);
        const unsent = data.planned.filter((p) => p.date >= ws && p.date <= addDays(ws, 6) && p.date >= today() && p.status === 'planned' && sendable(findWorkout(data.mine, p.workoutId)?.kind)).length;
        return (
          <section class="section" key={ws} style={offset ? '' : 'margin-top:0'}>
            <WeekBar week={wk}>
              {unsent > 0 && <button class="btn sm" onClick={() => sendWeek(ws)} disabled={busy === ws}><Icon.send size={14} />{busy === ws ? 'Sending…' : `Send ${unsent} to Garmin`}</button>}
            </WeekBar>
            <div class="cal-week">
              {days.slice(offset, offset + 7).map((d) => {
                const plans = plannedOn(data.planned, d, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
                const rides = data.rides.filter((r) => r.date === d);
                const isToday = d === today();
                return (
                  <div class={`cal-day${isToday ? ' today' : ''}${flash === d ? ' focused' : ''} ${dnd.dropClass(d)}`} key={d} data-date={d}>
                    <div class="d" id={`day-${d}`}>{fmtDate(d, { weekday: 'short' })}<b>{Number(d.slice(8))}</b></div>
                    <div class="c">
                      {plans.map((p) => {
                        const w = findWorkout(data.mine, p.workoutId);
                        if (!w) return null;
                        const s = workoutStats(w.blocks);
                        const rec = p.status === 'completed' && p.activityId ? data.rides.find((r) => r.id === p.activityId) : undefined;
                        // A done row shows what was recorded; a scheduled one what is planned.
                        const recorded = rec ? `${clock(rec.seconds)} · ${rec.tss ?? '–'} TSS${rec.normalizedPower ? ` · ${rec.normalizedPower} W normalized` : rec.averageHr ? ` · ${rec.averageHr} bpm` : ''}` : p.status === 'completed' ? 'logged by hand' : '';
                        const plannedLine = w.kind === 'ride' ? `${w.subtitle ? `${w.subtitle} · ` : ''}${clock(s.seconds)} · ${s.tss} TSS` : `${KIND_LABEL[w.kind]}${w.minutes ? ` · ${w.minutes} min` : ''}${w.estimatedTss ? ` · ≈ ${w.estimatedTss} TSS` : ''}`;
                        const st = statusOf(p.status);
                        return (
                          <div class={`cal-item ${p.status}${movable(p) ? ' movable' : ''}${dnd.dragging === p.id ? ' drag-src' : ''}`} key={p.id} {...(movable(p) ? dnd.source(p.id, d, w.name) : {})}>
                            <a href={sessionHref(p, w.id, 'calendar', d, data.rides)} draggable={false} class="row" style="flex:1;min-width:0;text-decoration:none">
                              <StatusMark status={st} />
                              {rec ? <ActivityPicture ride={rec} w={w} profile={profile} height={52} width={88} exMax={2} /> : <PlanPicture w={w} />}
                              <div class="t"><b>{w.name}</b><span>{st === 'done' ? recorded : plannedLine}</span>{(p.note || p.userEdited) && <span class="t2">{[p.note, p.userEdited ? (p.movedFrom && p.movedFrom !== p.date ? `moved by you from ${fmtDate(p.movedFrom, { month: 'short', day: 'numeric' })}` : 'changed by you') : ''].filter(Boolean).join(' · ')}</span>}</div>
                            </a>
                            <StatusPill status={st} />
                            {p.status !== 'completed' && <button class="btn sm quiet" aria-label="Change" title="Move, replace or remove" onClick={() => setChanging(p)}>⋯</button>}
                            {rec && <a class="btn sm quiet" href={`#/workout/${w.id}?from=calendar&date=${d}`} title="The session as it was planned">Plan ›</a>}
                          </div>
                        );
                      })}
                      {rides.filter((r) => !plans.some((p) => p.activityId === r.id)).map((r) => (
                        <a class="cal-item completed" key={r.id} href={`#/rides/${r.id}`}>
                          <StatusMark status="done" />
                          <ActivityPicture ride={r} profile={profile} height={52} width={88} />
                          <div class="t"><b>{r.name}</b><span>{clock(r.seconds)} · {r.tss ?? '–'} TSS{r.normalizedPower ? ` · ${r.normalizedPower} W normalized` : r.averageHr ? ` · ${r.averageHr} bpm` : ''} · unscheduled</span></div>
                          <StatusPill status="done" />
                        </a>
                      ))}
                      {d >= today() && <button class="cal-add" onClick={() => setPicking({ date: d })} aria-label={`Add a session on ${fmtDate(d)}`}>+ Add</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      </>}

      {changing && <ChangeSheet data={data} planned={changing} onClose={() => setChanging(null)} />}

      {choosing && (
        <div class="modal-bg" onClick={() => setChoosing(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:480px" role="dialog" aria-label={`Sessions on ${fmtDate(choosing)}`}>
            <div class="row between" style="margin-bottom:12px"><h2>{fmtDate(choosing)}</h2><button class="btn sm quiet" onClick={() => setChoosing(null)}>Cancel</button></div>
            <p class="muted small" style="margin:0 0 10px">Which session do you want to move, replace or remove?</p>
            <div class="stack">
              {plannedOn(data.planned, choosing, (id) => findWorkout(data.mine, id)?.kind ?? 'ride').filter(movable).map((p) => {
                const w = findWorkout(data.mine, p.workoutId);
                if (!w) return null;
                return (
                  <button class="cal-item" key={p.id} style="cursor:pointer;text-align:left" onClick={() => { setChoosing(null); setChanging(p); }}>
                    <StatusMark status={statusOf(p.status)} />
                    {w.kind === 'ride' ? <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} /> : <KindDot kind={w.kind} big />}
                    <div class="t"><b>{w.name}</b><span>{KIND_LABEL[w.kind]}</span></div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {picking && <WorkoutPicker data={data} title={picking.replace ? `Replace ${findWorkout(data.mine, picking.replace.workoutId)?.name ?? 'this session'}` : fmtDate(picking.date)} onPick={(w) => add(picking.date, w)} onClose={() => setPicking(null)} />}
      {dnd.ghost}
    </div>
  );
}

/** A done activity in a month cell: its name, then its picture (route, effort or exercises). */
export function MonthDone({ r, data, title }: { r: Ride; data: AppData; title: string }) {
  const p = data.planned.find((x) => x.activityId === r.id);
  const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
  const kind = r.sport === 'other' ? 'ride' : r.sport;
  return (
    <a class={`month-item completed k-${r.sport} has-pic`} href={`#/rides/${r.id}`} title={title} style={`--c:${KIND_COLOR[kind]}`}>
      <span class="mi-top"><StatusMark status="done" size={11} />{kind !== 'ride' && <KindDot kind={kind} />}<span class="mi-name">{shortName(w?.name ?? r.name)}</span></span>
      <span class="mi-pic"><ActivityPicture ride={r} w={w} profile={data.profile!} height={56} /></span>
    </a>
  );
}

/** A planned session's picture in a list row, in the same 88-pixel slot as a done one: the ride's diagram, else two exercise pictures, else the kind's tile. */
export function PlanPicture({ w }: { w: Workout }) {
  if (w.kind === 'ride') return <span class="act-pic plan"><WorkoutProfile blocks={w.blocks} height={34} ratio={2.6} /></span>;
  if (w.exercises && picturedCount(w.exercises) > 0) return <span class="act-pic ex" style="width:88px"><ExerciseRow w={w} max={2} /></span>;
  return <span class="act-pic" style="width:88px"><KindDot kind={w.kind} big /></span>;
}
