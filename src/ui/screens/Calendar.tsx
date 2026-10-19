import { useEffect, useState } from 'preact/hooks';
import { MonthGrid, monthOf, shiftMonth } from '../MonthGrid';
import { STATUS_WORD, StatusMark, StatusPill, statusOf } from '../StatusMark';
import { getSetting, setSetting } from '../../data/db';
import { KIND_COLOR } from './Plan';
import { ZONE_VAR } from '../Profile';
import type { AppData } from '../store';
import { allWorkouts, findWorkout, notify, scheduleWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { addDays, today } from '../../engine/load';
import { clock, workoutStats } from '../../engine/workout';
import { fmtDate, plannedOn, weekStart } from '../derived';
import { db } from '../../data/db';
import { FAMILY_LABEL } from '../../library/workouts';
import type { PlannedWorkout, Workout } from '../../engine/types';
import { credentials } from '../../sync/syncService';
import { sendWorkout } from '../../sync/intervals';
import { KIND_LABEL, KindDot } from './Plan';
import { getPlans, movePlanned, removePlanned, replacePlanned } from '../planService';
import { toast } from '../Toast';
import { PageHead } from '../PageHead';
import { WeekBar } from '../Glance';
import { weekSummary } from '../week';
import { Icon } from '../icons';

const sendable = (k?: string) => k === 'ride' || k === 'walk' || k === 'strength' || k === 'mobility';

export function Calendar({ data, params }: { data: AppData; params?: URLSearchParams }) {
  const profile = data.profile!;
  const focus = params?.get('d') ?? undefined;
  const [start, setStart] = useState(weekStart(focus && /^\d{4}-\d{2}-\d{2}$/.test(focus) ? focus : today()));
  const [view, setView] = useState<'list' | 'month'>('list');
  const [month, setMonth] = useState(monthOf(today()));
  // Opened from Today's week strip or its ⋯ button: show that week as a list, and open the change sheet if asked.
  useEffect(() => { if (focus) { setView('list'); return; } getSetting<'list' | 'month'>('calendarView', 'list').then(setView); }, [focus]);
  useEffect(() => { if (focus) setStart(weekStart(focus)); }, [focus]);
  const pickView = (v: 'list' | 'month') => { setView(v); setSetting('calendarView', v); };
  const [picking, setPicking] = useState<{ date: string; replace?: PlannedWorkout } | null>(null);
  const [changing, setChanging] = useState<PlannedWorkout | null>(null);
  const [moveDate, setMoveDate] = useState('');
  // Recovery weeks of every plan, to shade them on the month view.
  const [recoveryWeeks, setRecoveryWeeks] = useState<Set<string>>(new Set());
  useEffect(() => { getPlans().then((ps) => setRecoveryWeeks(new Set(ps.flatMap((p) => (p.weeks ?? []).filter((w) => w.phase === 'recovery').map((w) => weekStart(w.start)))))); }, [data.planned.length]);
  const changeId = params?.get('change');
  useEffect(() => {
    if (!changeId) return;
    const p = data.planned.find((x) => x.id === changeId);
    if (p && p.status !== 'completed') { setChanging(p); setMoveDate(p.date); }
    history.replaceState(null, '', `${location.pathname}#/calendar${focus ? `?d=${focus}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeId]);
  const setMsg = toast;
  const [busy, setBusy] = useState<string | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  const [pickKind, setPickKind] = useState<'ride' | 'strength' | 'mobility' | 'walk'>('ride');
  async function add(date: string, w: Workout) {
    if (picking?.replace) await replacePlanned(picking.replace, w, profile.basis);
    else await scheduleWorkout(w, date, profile.basis);
    setPicking(null);
  }
  async function move() {
    if (!changing || !moveDate) return;
    await movePlanned(changing, moveDate);
    setChanging(null);
  }

  async function remove(id: string) { await removePlanned(id, data.mine); }

  async function sendWeek(ws: string) {
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send workouts to your Garmin.' }); return; }
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
      setMsg({ ok: true, text: `Sent ${sent} workout${sent === 1 ? '' : 's'}. They reach your Garmin on its next phone sync.` });
    } catch (e) {
      setMsg({ ok: false, text: `Sent ${sent}, then: ${(e as Error).message}` });
    } finally { setBusy(null); notify(); }
  }


  return (
    <div>
      <PageHead title="Calendar">
        <>
          <a class="btn sm" href="#/plan">Plan my training</a>
          <div class="seg"><button class={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>List</button><button class={view === 'month' ? 'on' : ''} onClick={() => pickView('month')}>Calendar</button></div>
          {view === 'list' && <div class="row" style="gap:0">
            <button class="icon-btn" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><span style="transform:scaleX(-1);display:inline-flex"><Icon.chevron /></span></button>
            <button class="btn sm quiet" onClick={() => setStart(weekStart(today()))}>This week</button>
            <button class="icon-btn" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><Icon.chevron /></button>
          </div>}
        </>
      </PageHead>

      {view === 'month' && (
        <MonthGrid month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onToday={() => setMonth(monthOf(today()))}
          cellClass={(d) => (recoveryWeeks.has(weekStart(d)) ? 'recovery' : '')}
          weekNote={(ws) => { const wk = weekSummary(ws, data.planned, data.rides, data.mine); return wk.plannedTss || wk.doneTss ? <><b class="num">{wk.doneTss}</b>{wk.plannedTss > 0 && <span class="faint"> of {wk.plannedTss}</span>}<span class="faint">TSS</span>{recoveryWeeks.has(ws) && <span class="mn-tag">recovery</span>}</> : null; }}
          render={(d) => {
            const plans = plannedOn(data.planned, d, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
            const rides = data.rides.filter((r) => r.date === d && !plans.some((p) => p.activityId === r.id));
            return (
              <>
                {plans.map((p) => {
                  const w = findWorkout(data.mine, p.workoutId);
                  if (!w) return null;
                  const colour = w.kind === 'ride' ? ZONE_VAR[workoutStats(w.blocks).dominantZone - 1] : KIND_COLOR[w.kind];
                  return (
                    <a class={`month-item ${p.status} k-${w.kind}`} key={p.id} href={`#/workout/${w.id}?from=calendar&date=${d}`} title={`${w.name} · ${STATUS_WORD[statusOf(p.status)]}`} style={`--c:${colour}`}>
                      <span class="mi-top"><StatusMark status={statusOf(p.status)} size={11} />{w.kind === 'ride' ? <span class="mi-prof"><WorkoutProfile blocks={w.blocks} height={10} ratio={4} /></span> : <span class="sw" />}</span>
                      <span class="mi-name">{w.name}</span>
                    </a>
                  );
                })}
                {rides.map((r) => <a class={`month-item completed k-${r.sport}`} key={r.id} href={`#/rides/${r.id}`} title={`${r.name} · Done, unscheduled`} style={`--c:${KIND_COLOR[r.sport === 'other' ? 'ride' : r.sport]}`}><span class="mi-top"><StatusMark status="done" size={11} /><span class="sw" /></span><span class="mi-name">{r.name}</span></a>)}
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
                  <div class={`cal-day${isToday ? ' today' : ''}`} key={d}>
                    <div class="d">{fmtDate(d, { weekday: 'short' })}<b>{Number(d.slice(8))}</b></div>
                    <div class="c">
                      {plans.map((p) => {
                        const w = findWorkout(data.mine, p.workoutId);
                        if (!w) return null;
                        const s = workoutStats(w.blocks);
                        const rec = p.status === 'completed' && p.activityId ? data.rides.find((r) => r.id === p.activityId) : undefined;
                        // A done row shows what was recorded; a scheduled one what is planned.
                        const recorded = rec ? `${clock(rec.seconds)} · ${rec.tss ?? '–'} TSS${rec.normalizedPower ? ` · NP ${rec.normalizedPower} W` : rec.averageHr ? ` · ${rec.averageHr} bpm` : ''}` : p.status === 'completed' ? 'logged by hand' : '';
                        const plannedLine = w.kind === 'ride' ? `${w.subtitle ? `${w.subtitle} · ` : ''}${clock(s.seconds)} · ${s.tss} TSS` : `${KIND_LABEL[w.kind]}${w.minutes ? ` · ${w.minutes} min` : ''}${w.estimatedTss ? ` · ≈ ${w.estimatedTss} TSS` : ''}`;
                        const st = statusOf(p.status);
                        return (
                          <div class={`cal-item ${p.status}`} key={p.id}>
                            <a href={`#/workout/${w.id}?from=calendar&date=${d}`} class="row" style="flex:1;min-width:0;text-decoration:none">
                              <StatusMark status={st} />
                              {w.kind === 'ride' ? <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} /> : <KindDot kind={w.kind} big />}
                              <div class="t"><b>{w.name}</b><span>{st === 'done' ? recorded : plannedLine}{p.note ? ` · ${p.note}` : ''}{p.userEdited ? (p.movedFrom && p.movedFrom !== p.date ? ` · moved by you from ${fmtDate(p.movedFrom, { month: 'short', day: 'numeric' })}` : ' · changed by you') : ''}</span></div>
                            </a>
                            <StatusPill status={st} />
                            {p.status !== 'completed' && <button class="btn sm quiet" aria-label="Change" title="Replace, move or remove" onClick={() => { setChanging(p); setMoveDate(p.date); }}>⋯</button>}
                            {rec && <a class="btn sm quiet" href={`#/rides/${rec.id}`} title="Open the recording">Recording ›</a>}
                          </div>
                        );
                      })}
                      {rides.filter((r) => !plans.some((p) => p.activityId === r.id)).map((r) => (
                        <a class="cal-item completed" key={r.id} href={`#/rides/${r.id}`}>
                          <StatusMark status="done" />
                          <KindDot kind={r.sport === 'other' ? 'ride' : r.sport} big />
                          <div class="t"><b>{r.name}</b><span>{clock(r.seconds)} · {r.tss ?? '–'} TSS{r.normalizedPower ? ` · NP ${r.normalizedPower} W` : r.averageHr ? ` · ${r.averageHr} bpm` : ''} · unscheduled</span></div>
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

      {changing && (() => {
        const w = findWorkout(data.mine, changing.workoutId);
        return (
          <div class="modal-bg" onClick={() => setChanging(null)}>
            <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:480px">
              <div class="row between" style="margin-bottom:6px"><h2>{w?.name ?? 'This session'}</h2><button class="btn sm quiet" onClick={() => setChanging(null)}>Close</button></div>
              <p class="muted small" style="margin:0 0 14px">{fmtDate(changing.date)}{changing.planId ? ' · from your plan' : ''}{changing.status === 'sent' ? ' · on your Garmin' : ''}</p>
              <div class="stack">
                <button class="btn" style="justify-content:flex-start" onClick={() => { setPicking({ date: changing.date, replace: changing }); setChanging(null); }}>Replace with another workout<span class="faint small" style="margin-left:auto">any kind</span></button>
                <div class="panel" style="padding:10px 12px">
                  <div class="small" style="margin-bottom:6px"><b>Move to another day</b></div>
                  <div class="row wrap" style="gap:8px">
                    <input type="date" value={moveDate} min={today()} onInput={(e) => setMoveDate((e.target as HTMLInputElement).value)} style="width:auto" />
                    <button class="btn sm" onClick={move} disabled={!moveDate || moveDate === changing.date}>Move</button>
                  </div>
                </div>
                <button class="btn quiet" style="justify-content:flex-start;color:var(--bad)" onClick={() => { const id = changing.id; setChanging(null); remove(id); }}>Remove from the calendar</button>
              </div>
              {changing.status === 'sent' && <p class="faint small" style="margin:12px 0 0">Replacing or moving takes it off the Garmin; send the new one when you are ready.</p>}
              {changing.planId && <p class="faint small" style="margin:8px 0 0">The plan keeps your change. The daily re-check may still suggest something for this day, which you can accept or ignore.</p>}
            </div>
          </div>
        );
      })()}

      {picking && (
        <div class="modal-bg" onClick={() => setPicking(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="row between" style="margin-bottom:12px">
              <h2>{picking.replace ? `Replace ${findWorkout(data.mine, picking.replace.workoutId)?.name ?? 'this session'}` : fmtDate(picking.date)}</h2>
              <button class="btn sm quiet" onClick={() => setPicking(null)}>Close</button>
            </div>
            <div class="seg" style="margin-bottom:12px">
              {(['ride', 'strength', 'mobility', 'walk'] as const).map((k) => <button key={k} class={pickKind === k ? 'on' : ''} onClick={() => setPickKind(k)}>{k === 'ride' ? 'Rides' : k === 'walk' ? 'Walks' : KIND_LABEL[k]}</button>)}
            </div>
            <p class="faint small" style="margin:0 0 10px">Or <a href="#/build">make a new workout</a>.</p>
            <div class="stack">
              {allWorkouts(data.mine).filter((w) => w.kind === pickKind && w.source !== 'generated').map((w) => {
                const s = workoutStats(w.blocks);
                const n = w.exercises?.length ?? 0;
                return (
                  <button class="cal-item" key={w.id} onClick={() => add(picking.date, w)} style="cursor:pointer;text-align:left">
                    {w.kind === 'ride' ? <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} /> : <KindDot kind={w.kind} big />}
                    <div class="t"><b>{w.name}</b><span>{w.kind === 'ride' ? `${w.subtitle ? `${w.subtitle} · ` : FAMILY_LABEL[w.family] + ' · '}${clock(s.seconds)} · ${s.tss} TSS` : w.kind === 'walk' ? `${w.walk?.minutes ?? w.minutes} min${w.walk?.packKg ? ` · ${Math.round(w.walk.packKg * 2.2)} lb pack` : ''}` : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}${w.source === 'mine' ? ' · mine' : ''}`}</span></div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
