import { useEffect, useState } from 'preact/hooks';
import { MonthGrid, monthOf, shiftMonth } from '../MonthGrid';
import { getSetting, setSetting } from '../../data/db';
import { KIND_COLOR } from './Plan';
import { ZONE_VAR } from '../Profile';
import type { AppData } from '../store';
import { allWorkouts, findWorkout, notify } from '../store';
import { WorkoutProfile } from '../Profile';
import { addDays, today } from '../../engine/load';
import { clock, newId, workoutStats } from '../../engine/workout';
import { fmtDate, plannedOn, weekStart } from '../derived';
import { db } from '../../data/db';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Workout } from '../../engine/types';
import { credentials } from '../../sync/syncService';
import { deleteEvent, sendWorkout } from '../../sync/intervals';
import { KIND_LABEL, KindDot } from './Plan';

export function Calendar({ data }: { data: AppData }) {
  const profile = data.profile!;
  const [start, setStart] = useState(weekStart(today()));
  const [view, setView] = useState<'list' | 'month'>('list');
  const [month, setMonth] = useState(monthOf(today()));
  useEffect(() => { getSetting<'list' | 'month'>('calendarView', 'list').then(setView); }, []);
  const pickView = (v: 'list' | 'month') => { setView(v); setSetting('calendarView', v); };
  const [picking, setPicking] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));

  async function add(date: string, w: Workout) {
    await db.planned.put({ id: newId(), date, workoutId: w.id, basis: w.bases.includes(profile.basis) ? profile.basis : w.bases[0], status: 'planned' });
    setPicking(null);
    notify();
  }

  async function remove(id: string) {
    const p = await db.planned.get(id);
    const w = p ? findWorkout(data.mine, p.workoutId) : undefined;
    if (!confirm(`Remove ${w?.name ?? 'this workout'} from ${p ? fmtDate(p.date) : 'the calendar'}?${p?.icuEventId ? ' It will also be removed from Intervals.icu and your Garmin.' : ''}`)) return;
    if (p?.icuEventId) {
      const c = await credentials();
      if (c) { try { await deleteEvent(c, p.icuEventId); } catch { /* the app's record is what matters; a stale event is harmless */ } }
    }
    await db.planned.delete(id);
    notify();
  }

  async function sendWeek(ws: string) {
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send workouts to your Garmin.' }); return; }
    const end = addDays(ws, 6);
    const todo = data.planned.filter((p) => p.date >= ws && p.date <= end && p.date >= today() && p.status === 'planned' && (findWorkout(data.mine, p.workoutId)?.kind ?? 'ride') === 'ride');
    if (todo.length === 0) { setMsg({ ok: true, text: 'Nothing unsent in that week.' }); return; }
    setBusy(ws);
    let sent = 0;
    try {
      for (const p of todo) {
        const w = findWorkout(data.mine, p.workoutId);
        if (!w) continue;
        const id = await sendWorkout(c, w, p.date, p.basis);
        await db.planned.update(p.id, { status: 'sent', icuEventId: id });
        sent++;
      }
      setMsg({ ok: true, text: `Sent ${sent} workout${sent === 1 ? '' : 's'}. They reach your Garmin on its next phone sync.` });
    } catch (e) {
      setMsg({ ok: false, text: `Sent ${sent}, then: ${(e as Error).message}` });
    } finally { setBusy(null); notify(); }
  }

  const weekTss = (ws: string) => {
    let planned = 0, done = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      for (const p of plannedOn(data.planned, d)) {
        const w = findWorkout(data.mine, p.workoutId);
        if (w) planned += workoutStats(w.blocks).tss;
      }
      for (const r of data.rides.filter((r) => r.date === d)) done += r.tss ?? 0;
    }
    return { planned, done };
  };

  return (
    <div>
      <div class="page-head">
        <h1>Calendar</h1>
        <div class="row">
          <a class="btn sm" href="#/plan">Plan</a>
          <div class="seg"><button class={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>List</button><button class={view === 'month' ? 'on' : ''} onClick={() => pickView('month')}>Calendar</button></div>
          {view === 'list' && <>
            <button class="btn sm quiet" onClick={() => setStart(addDays(start, -7))}>‹</button>
            <button class="btn sm quiet" onClick={() => setStart(weekStart(today()))}>This week</button>
            <button class="btn sm quiet" onClick={() => setStart(addDays(start, 7))}>›</button>
          </>}
        </div>
      </div>

      {view === 'month' && (
        <MonthGrid month={month} onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))} onToday={() => setMonth(monthOf(today()))}
          render={(d) => {
            const plans = plannedOn(data.planned, d, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
            const rides = data.rides.filter((r) => r.date === d && !plans.some((p) => p.activityId === r.id));
            return (
              <>
                {plans.map((p) => {
                  const w = findWorkout(data.mine, p.workoutId);
                  if (!w) return null;
                  const colour = w.kind === 'ride' ? ZONE_VAR[workoutStats(w.blocks).dominantZone - 1] : KIND_COLOR[w.kind];
                  return <a class={`month-item ${p.status}`} key={p.id} href={`#/workout/${w.id}?from=calendar&date=${d}`} title={w.name}><span class="sw" style={`background:${colour}`} /><span>{w.name}</span></a>;
                })}
                {rides.map((r) => <a class="month-item done" key={r.id} href={`#/rides/${r.id}`} title={r.name}><span class="sw" style="background:var(--good)" /><span>{r.name}</span></a>)}
                {d >= today() && plans.length === 0 && rides.length === 0 && <button class="month-item" style="background:none;border:0;padding:0;cursor:pointer;color:var(--ink-3)" onClick={() => setPicking(d)}>+</button>}
              </>
            );
          }} />
      )}

      {view === 'list' && <>

      {msg && <div class={`msg ${msg.ok ? 'ok' : 'err'}`} style="margin-bottom:14px">{msg.text}</div>}
      {[0, 7].map((offset) => {
        const ws = addDays(start, offset);
        const t = weekTss(ws);
        const unsent = data.planned.filter((p) => p.date >= ws && p.date <= addDays(ws, 6) && p.date >= today() && p.status === 'planned' && (findWorkout(data.mine, p.workoutId)?.kind ?? 'ride') === 'ride').length;
        return (
          <section class="section" key={ws} style={offset ? '' : 'margin-top:0'}>
            <div class="row between" style="margin-bottom:8px">
              <h2>{fmtDate(ws, { month: 'short', day: 'numeric' })} – {fmtDate(addDays(ws, 6), { month: 'short', day: 'numeric' })}</h2>
              <div class="row">
                <span class="muted small">{t.done} done · {t.planned} planned TSS</span>
                {unsent > 0 && <button class="btn sm" onClick={() => sendWeek(ws)} disabled={busy === ws}>{busy === ws ? 'Sending…' : `Send ${unsent} to Garmin`}</button>}
              </div>
            </div>
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
                        return (
                          <div class={`cal-item ${p.status}`} key={p.id}>
                            <a href={`#/workout/${w.id}?from=calendar&date=${d}`} class="row" style="flex:1;min-width:0;text-decoration:none">
                              {w.kind === 'ride' ? <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} /> : <KindDot kind={w.kind} big />}
                              <div class="t"><b>{w.name}</b><span>{w.kind === 'ride' ? `${clock(s.seconds)} · ${s.tss} TSS · ${p.status === 'planned' ? 'not sent' : p.status === 'sent' ? 'on Garmin' : p.status}` : `${KIND_LABEL[w.kind]} · ${p.status === 'completed' ? 'done' : 'to do'}`}{p.note ? ` · ${p.note}` : ''}</span></div>
                            </a>
                            {p.status !== 'completed' && <button class="btn sm quiet" aria-label="Remove" onClick={() => remove(p.id)}>×</button>}
                          </div>
                        );
                      })}
                      {rides.filter((r) => !plans.some((p) => p.activityId === r.id)).map((r) => (
                        <a class="cal-item done" key={r.id} href={`#/rides/${r.id}`}>
                          <div class="t"><b>{r.name}</b><span>{clock(r.seconds)} · {r.tss ?? '–'} TSS{r.normalizedPower ? ` · NP ${r.normalizedPower} W` : r.averageHr ? ` · ${r.averageHr} bpm` : ''}</span></div>
                        </a>
                      ))}
                      {d >= today() && !plans.some((p) => findWorkout(data.mine, p.workoutId)?.kind === 'ride') && <button class="cal-add" onClick={() => setPicking(d)}>+ Add a ride</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      </>}

      {picking && (
        <div class="modal-bg" onClick={() => setPicking(null)}>
          <div class="modal" onClick={(e) => e.stopPropagation()}>
            <div class="row between" style="margin-bottom:12px">
              <h2>{fmtDate(picking)}</h2>
              <button class="btn sm quiet" onClick={() => setPicking(null)}>Close</button>
            </div>
            <div class="stack">
              {allWorkouts(data.mine).map((w) => {
                const s = workoutStats(w.blocks);
                return (
                  <button class="cal-item" key={w.id} onClick={() => add(picking, w)} style="cursor:pointer;text-align:left">
                    <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} />
                    <div class="t"><b>{w.name}</b><span>{FAMILY_LABEL[w.family]} · {clock(s.seconds)} · {s.tss} TSS</span></div>
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
