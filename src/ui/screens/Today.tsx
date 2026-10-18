import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { FAMILY_LABEL } from '../../library/workouts';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { fitnessFromRides, fitnessOn, fmtDate, missedThisWeek, plannedOn, readinessToday } from '../derived';
import { db, getSetting, setSetting } from '../../data/db';
import { credentials, syncAll } from '../../sync/syncService';
import { sendWorkout } from '../../sync/intervals';
import { notify } from '../store';
import { dailyNote } from '../../coach/claude';
import { FitnessChart } from '../FitnessChart';
import { KIND_LABEL, KindDot, ReplanView } from './Plan';
import { applyPlan, getActivePlan, markChecked, replan, type ActivePlan } from '../planService';
import type { Replan } from '../../engine/adapt';

export function Today({ data }: { data: AppData }) {
  const profile = data.profile!;
  const date = today();
  const series = fitnessFromRides(data.rides);
  const fit = fitnessOn(series, date);
  const ready = readinessToday(data.wellness, fit);
  const plans = plannedOn(data.planned, date, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
  const withW = plans.map((p) => ({ p, w: findWorkout(data.mine, p.workoutId) })).filter((x) => x.w);
  const ridePlan = withW.find((x) => x.w!.kind === 'ride');
  const others = withW.filter((x) => x.w!.kind !== 'ride');
  const plan = ridePlan?.p;
  const workout = ridePlan?.w;
  const stats = workout ? workoutStats(workout.blocks) : undefined;

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [check, setCheck] = useState<Replan | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => { credentials().then((c) => setConnected(!!c)); }, []);

  // Once a day, after the data have had a chance to arrive, the plan checks itself.
  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await getActivePlan();
      if (!alive) return;
      setActive(a);
      if (a && a.lastCheck !== date && data.rides.length) {
        const r = await replan(data);
        if (alive && r) setCheck(r);
        await markChecked();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.rides.length, data.planned.length]);

  async function applyCheck() {
    if (!check || !active) return;
    setChecking(true);
    try { await applyPlan(data, check.plan, active.goal, active.availability, active.masters); setCheck(null); setMsg({ ok: true, text: 'Plan updated on the calendar.' }); } finally { setChecking(false); }
  }

  async function recheckNow() {
    setChecking(true);
    try { setCheck(await replan(data)); await markChecked(); } finally { setChecking(false); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const key = await getSetting<string>('claudeKey', '');
      if (!key) return;
      const cached = await getSetting<{ date: string; text: string } | null>('coachNote', null);
      if (cached?.date === date && cached.text) { if (alive) setNote(cached.text); return; }
      try {
        const text = await dailyNote(key, {
          profile, date, fitness: fit, readiness: ready, todayWorkout: workout,
          recentRides: data.rides, missedThisWeek: missedThisWeek(data.planned),
        });
        await setSetting('coachNote', { date, text });
        if (alive) setNote(text);
      } catch (e) {
        if (alive) setNote(`Coach note unavailable: ${(e as Error).message}`);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, plan?.id, data.rides.length]);

  async function send() {
    if (!plan || !workout) return;
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send workouts to your Garmin.' }); return; }
    setBusy('send');
    try {
      const id = await sendWorkout(c, workout, plan.date, plan.basis);
      await db.planned.update(plan.id, { status: 'sent', icuEventId: id });
      notify();
      setMsg({ ok: true, text: 'Sent. It will be on your Garmin after the next phone sync, under Training, Workouts.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(null); }
  }

  async function sync() {
    setBusy('sync');
    try {
      const r = await syncAll();
      notify();
      setMsg({ ok: true, text: `Synced ${r.rides} rides and ${r.wellness} days of wellness.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(null); }
  }

  const bandText = { go: 'Ready for the full session', ease: 'Ease the intensity 10–15% if it feels heavy', easy: 'Keep it in zone 1–2 today', rest: 'A rest day would serve you better' }[ready.band];

  return (
    <div>
      <div class="page-head">
        <div>
          <p class="muted small">{fmtDate(date)}</p>
          <h1>{profile.name ? `Hello, ${profile.name.split(' ')[0]}` : 'Today'}</h1>
        </div>
        <div class="row">
          <button class="btn sm" onClick={sync} disabled={busy === 'sync' || connected === false}>{busy === 'sync' ? 'Syncing…' : 'Sync'}</button>
        </div>
      </div>

      {msg && <div class={`msg ${msg.ok ? 'ok' : 'err'}`} style="margin-bottom:14px">{msg.text}</div>}
      {connected === false && (
        <div class="panel accent" style="margin-bottom:14px">
          <b>Connect Intervals.icu</b>
          <p class="muted small" style="margin-top:4px">That is the pipe to your Garmin. Add your athlete ID and API key in Settings, and rides and wellness will start arriving.</p>
          <a class="btn sm" href="#/settings" style="margin-top:10px">Open Settings</a>
        </div>
      )}

      {active && (
        <section class="panel" style="margin-bottom:14px;padding:12px 16px">
          <div class="row between">
            <div class="small"><b>{active.goal.kind === 'event' ? active.goal.name || 'Event plan' : 'Training plan'}</b>{plan?.note ? <span class="muted"> · {plan.note}</span> : others[0]?.p.note ? <span class="muted"> · {others[0].p.note}</span> : null}{active.goal.kind === 'event' ? <span class="muted"> · {Math.ceil((Date.parse(active.goalDate) - Date.parse(date)) / 864e5)} days to go</span> : null}</div>
            {!check && <button class="btn sm quiet" onClick={recheckNow} disabled={checking}>{checking ? 'Checking…' : 'Re-check'}</button>}
          </div>
          {check && (check.changes.length > 0 || check.review.missed > 0 || check.review.lines.length > 0) && <ReplanView check={check} onApply={applyCheck} busy={checking} />}
        </section>
      )}

      {workout && plan && stats ? (
        <section class="panel accent" style="padding:18px 18px 16px">
          <div class="row between">
            <span class="tag" style={`background:var(--z${stats.dominantZone})`}>{FAMILY_LABEL[workout.family]}</span>
            <span class="pill"><span class="dot" style={`background:${plan.status === 'completed' ? 'var(--good)' : plan.status === 'sent' ? 'var(--z2)' : 'var(--ink-3)'}`} />{statusLabel(plan.status)}</span>
          </div>
          <h2 style="font-size:24px;margin:10px 0 2px">{workout.name}</h2>
          <p class="muted small">{clock(stats.seconds)} · {stats.tss} TSS · IF {stats.intensityFactor.toFixed(2)} · {plan.basis === 'power' ? 'power targets' : 'heart-rate targets'}</p>
          <div style="margin:14px 0 12px"><WorkoutProfile blocks={workout.blocks} height={96} hero /></div>
          <p class="muted" style="font-size:14px">{workout.purpose}</p>
          <div class="row wrap" style="margin-top:14px;gap:8px">
            {plan.status === 'planned' && <button class="btn primary" onClick={send} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Send to Garmin'}</button>}
            {plan.status === 'sent' && <button class="btn" onClick={send} disabled={busy === 'send'}>Send again</button>}
            <a class="btn" href={`#/workout/${workout.id}?from=today&date=${date}`}>Steps and targets</a>
            <a class="btn quiet" href="#/calendar">Change</a>
          </div>
        </section>
      ) : others.length === 0 ? (
        <section class="empty">
          <b>Nothing planned today.</b>
          <p class="small" style="margin-top:6px">Pick something from the library, build a plan, or take the day.</p>
          <a class="btn primary sm" href="#/library" style="margin-top:12px">Choose a workout</a>
        </section>
      ) : null}

      {others.length > 0 && (
        <section class="section" style={workout ? '' : 'margin-top:0'}>
          <h2>{workout ? 'Also today' : 'Today'}</h2>
          <div class="stack" style="margin-top:8px">
            {others.map(({ p, w }) => (
              <a class={`cal-item ${p.status}`} key={p.id} href={`#/workout/${w!.id}?from=today&date=${date}`}>
                <KindDot kind={w!.kind} big />
                <div class="t"><b>{w!.name}</b><span>{KIND_LABEL[w!.kind]} · {p.status === 'completed' ? 'done' : 'tap for the details and to log it'}</span></div>
              </a>
            ))}
          </div>
        </section>
      )}

      {note && (
        <section class="section">
          <h2>Coach</h2>
          <p class="muted" style="font-size:15px;line-height:1.6">{note}</p>
        </section>
      )}

      <section class="section">
        <div class="row between" style="margin-bottom:10px">
          <h2>Readiness</h2>
          <span class="big" style={`color:${ready.band === 'go' ? 'var(--good)' : ready.band === 'rest' ? 'var(--bad)' : ready.band === 'easy' ? 'var(--warn)' : 'var(--ink)'}`}>{ready.score}</span>
        </div>
        <p class="muted small" style="margin-bottom:10px">{bandText}.</p>
        <div class="stats">
          {ready.drivers.map((d) => (
            <div class="stat" key={d.name}>
              <div class="v" style={`font-size:16px;color:${d.effect === 'up' ? 'var(--good)' : d.effect === 'down' ? 'var(--bad)' : 'var(--ink)'}`}>{d.value}</div>
              <div class="l">{d.name}</div>
            </div>
          ))}
        </div>
        {data.wellness.length === 0 && <p class="faint small" style="margin-top:10px">HRV, sleep and resting HR appear once Intervals.icu is connected and your watch has synced.</p>}
      </section>

      <section class="section">
        <div class="row between" style="margin-bottom:10px">
          <h2>Fitness</h2>
          <div class="stats" style="gap:4px 18px;grid-template-columns:repeat(3,max-content)">
            <div class="stat"><div class="v" style="font-size:18px;color:var(--z2)">{fit?.ctl.toFixed(0) ?? '–'}</div><div class="l">Fitness</div></div>
            <div class="stat"><div class="v" style="font-size:18px;color:var(--z5)">{fit?.atl.toFixed(0) ?? '–'}</div><div class="l">Fatigue</div></div>
            <div class="stat"><div class="v" style="font-size:18px">{fit ? (fit.tsb > 0 ? '+' : '') + fit.tsb.toFixed(0) : '–'}</div><div class="l">Form</div></div>
          </div>
        </div>
        <FitnessChart series={series.slice(-84)} />
      </section>
    </div>
  );
}

export function statusLabel(s: string): string {
  return { planned: 'Not sent yet', sent: 'On your Garmin', completed: 'Completed', missed: 'Missed' }[s] ?? s;
}
