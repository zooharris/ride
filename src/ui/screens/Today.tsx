import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { GettingStarted } from './Help';
import { findWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { FAMILY_LABEL } from '../../library/workouts';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { fitnessFromRides, fitnessOn, fmtDate, missedThisWeek, plannedOn, readinessToday } from '../derived';
import { db, getSetting, setSetting } from '../../data/db';
import { credentials, syncAll } from '../../sync/syncService';
import { sendWorkout } from '../../sync/intervals';
import { notify, saveDayNote, trustedWellness } from '../store';
import { dailyNote } from '../../coach/claude';
import { FitnessChart } from '../FitnessChart';
import { KIND_LABEL, KindDot, ReplanView } from './Plan';
import { StatusMark, StatusPill, statusOf } from '../StatusMark';
import { applyPlan, coachReviewAfterSync, getActivePlan, markChecked, recentNoteLines, replan, type ActivePlan } from '../planService';
import type { CoachReview } from '../../coach/claude';
import type { Replan } from '../../engine/adapt';
import type { DayNote } from '../../engine/types';

export function Today({ data }: { data: AppData }) {
  const profile = data.profile!;
  const date = today();
  const series = fitnessFromRides(data.rides);
  const fit = fitnessOn(series, date);
  const ready = readinessToday(data.wellness, fit);
  const todayNote = data.dayNotes.find((n) => n.date === date);
  const wellnessSetAside = !!todayNote?.badWellness && data.wellnessAll.some((w) => w.date === date);
  const plans = plannedOn(data.planned, date, (id) => findWorkout(data.mine, id)?.kind ?? 'ride');
  const withW = plans.map((p) => ({ p, w: findWorkout(data.mine, p.workoutId) })).filter((x) => x.w);
  const ridePlan = withW.find((x) => x.w!.kind === 'ride');
  const others = withW.filter((x) => x.w!.kind !== 'ride');
  const plan = ridePlan?.p;
  const workout = ridePlan?.w;
  const stats = workout ? workoutStats(workout.blocks) : undefined;
  // What is on today's calendar, in one string: the coach note is remade when this changes.
  const daySig = withW.map((x) => `${x.w!.id}:${x.p.status}`).join(',') + `|${todayNote?.text ?? ''}|${todayNote?.badWellness ? 'bad' : ''}`;

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [check, setCheck] = useState<Replan | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<CoachReview | null>(null);
  const [tourDone, setTourDone] = useState<boolean | null>(null);
  useEffect(() => { getSetting<boolean>('tourDone', false).then(setTourDone); }, []);

  useEffect(() => { credentials().then((c) => setConnected(!!c)); }, []);
  const [locked, setLocked] = useState<{ question: string } | null>(null);
  useEffect(() => { getSetting<{ locked?: { question: string } } | null>('deviceSync', null).then((s) => setLocked(s?.locked ?? null)); }, [data.planned.length, data.rides.length, data.dayNotes.length]);

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

  async function applyCheck(accepted: Set<string>) {
    if (!check || !active) return;
    setChecking(true);
    try { await applyPlan(data, check.plan, active.goal, active.availability, active.masters, accepted); setCheck(null); setMsg({ ok: true, text: 'Plan updated on the calendar.' }); } finally { setChecking(false); }
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
      // One note a day, unless the day's calendar changes under it (a session added, replaced or done).
      const cached = await getSetting<{ date: string; text: string; sig?: string } | null>('coachNote', null);
      if (cached?.date === date && cached.text && (cached.sig ?? '') === daySig) { if (alive) setNote(cached.text); return; }
      try {
        const text = await dailyNote(key, {
          profile, date, fitness: fit, readiness: ready,
          todaySessions: withW.map((x) => ({ planned: x.p, workout: x.w! })),
          recentRides: data.rides, missedThisWeek: missedThisWeek(data.planned),
          riderNote: todayNote?.text, wellnessSetAside,
          recentNotes: recentNoteLines(data.dayNotes.filter((n) => n.date !== date), date, 90),
        });
        await setSetting('coachNote', { date, text, sig: daySig });
        if (alive) setNote(text);
      } catch (e) {
        if (alive) setNote(`Coach note unavailable: ${(e as Error).message}`);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, daySig, data.rides.length]);

  async function send() {
    if (!plan || !workout) return;
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send workouts to your Garmin.' }); return; }
    setBusy('send');
    try {
      const id = await sendWorkout(c, workout, plan.date, plan.basis, profile);
      await db.planned.update(plan.id, { status: 'sent', icuEventId: id });
      notify();
      setMsg({ ok: true, text: 'Sent. It will be on your Garmin after the next phone sync, under Training, Workouts.' });
    } catch (e) {
      setMsg({ ok: false, text: `Could not send: ${(e as Error).message}` });
    } finally { setBusy(null); }
  }

  async function sync() {
    setBusy('sync');
    try {
      const r = await syncAll();
      notify();
      setMsg({ ok: true, text: `Synced ${r.rides} activities and ${r.wellness} days of wellness.${r.newIds.length ? ` ${r.newIds.length} new.` : ''}` });
      if (r.newIds.length) {
        setBusy('review');
        try {
          const notes = await db.dayNotes.toArray();
          const fresh = { ...data, rides: await db.rides.orderBy('date').reverse().toArray(), planned: await db.planned.toArray(), wellness: trustedWellness(await db.wellness.orderBy('date').toArray(), notes), dayNotes: notes };
          const out = await coachReviewAfterSync(fresh, r.newIds);
          if (out) { setReview(out.review); if (out.check) setCheck(out.check); }
        } catch (e) { setMsg({ ok: false, text: `Synced, but the coach review failed: ${(e as Error).message}` }); }
      }
    } catch (e) {
      setMsg({ ok: false, text: `Sync failed: ${(e as Error).message} Your calendar and activities here are unchanged; try again, or run the connection checks in Settings.` });
    } finally { setBusy(null); }
  }

  const bandText = readinessAdvice(ready.band, withW.filter((x) => x.p.status !== 'completed').map((x) => x.w!.kind));

  return (
    <div>
      <div class="page-head">
        <div>
          <p class="muted small">{fmtDate(date)}</p>
          <h1>{profile.name ? `Hello, ${profile.name.split(' ')[0]}` : 'Today'}</h1>
        </div>
        <div class="row">
          <button class="btn sm" onClick={sync} disabled={busy === 'sync' || busy === 'review' || connected === false}>{busy === 'sync' ? 'Syncing…' : busy === 'review' ? 'Asking the coach…' : 'Sync'}</button>
        </div>
      </div>

      {msg && <div class={`msg ${msg.ok ? 'ok' : 'err'}`} style="margin-bottom:14px">{msg.text}</div>}
      <div class="today-grid">
      <div class="today-main">
      {tourDone === false && connected !== null && (
        <GettingStarted connected={connected === true} synced={data.rides.length > 0} planned={!!active} sent={data.planned.some((p) => p.status === 'sent' || p.status === 'completed')} reviewed={data.planned.some((p) => p.status === 'completed' && !!p.activityId)} onDismiss={() => { setTourDone(true); setSetting('tourDone', true); }} />
      )}
      {connected === false && tourDone !== false && (
        <div class="panel accent" style="margin-bottom:14px">
          <b>Connect Intervals.icu</b>
          <p class="muted small" style="margin-top:4px">That is how workouts reach your bike computer and finished activities come back. Add your athlete ID and API key in Settings.</p>
          <a class="btn sm" href="#/settings" style="margin-top:10px">Open Settings</a>
        </div>
      )}

      {locked && (
        <div class="panel accent" style="margin-bottom:14px">
          <b>Your sync note is locked on this device</b>
          <p class="muted small" style="margin-top:4px">The note in Intervals.icu is encrypted. Until this device has the passphrase, or the answer to your question, nothing from your other devices arrives here and nothing from here is sent. Nothing is lost either way.</p>
          <a class="btn sm" href="#/settings" style="margin-top:10px">Unlock in Settings</a>
        </div>
      )}

      {review && (
        <section class="panel accent" style="margin-bottom:14px;padding:14px 16px">
          <div class="row between"><b>Coach review of the new activities</b><button class="btn sm quiet" onClick={() => setReview(null)}>Dismiss</button></div>
          <p style="margin-top:8px;font-size:15px;line-height:1.6">{review.text}</p>
          {check && check.changes.length > 0 && (
            <p class="muted small" style="margin-top:8px">{review.applyChanges ? 'Recommends applying the plan changes below.' : 'Recommends leaving the plan as it is for now.'} {review.reason}</p>
          )}
        </section>
      )}

      {active && (
        <section class="panel" style="margin-bottom:14px;padding:12px 16px">
          <div class="row between">
            <div class="small"><b>{active.name}</b>{active.start > date ? <span class="muted"> · starts {fmtDate(active.start, { month: 'short', day: 'numeric' })}</span> : null}{plan?.note ? <span class="muted"> · {plan.note}</span> : others[0]?.p.note ? <span class="muted"> · {others[0].p.note}</span> : null}{active.goal.kind === 'event' ? <span class="muted"> · {Math.ceil((Date.parse(active.goalDate) - Date.parse(date)) / 864e5)} days to go</span> : null}</div>
            {!check && active.start <= date && <button class="btn sm quiet" onClick={recheckNow} disabled={checking}>{checking ? 'Checking…' : 'Re-check'}</button>}
          </div>
          {check && (check.changes.length > 0 || check.review.missed > 0 || check.review.lines.length > 0) && <ReplanView check={check} onApply={applyCheck} busy={checking} />}
        </section>
      )}

      {workout && plan && stats ? (
        <section class="panel accent" style="padding:18px 18px 16px">
          <div class="row between">
            <span class="tag" style={`background:var(--z${stats.dominantZone})`}>{FAMILY_LABEL[workout.family]}</span>
            <span class="row" style="gap:8px"><StatusMark status={statusOf(plan.status)} /><StatusPill status={statusOf(plan.status)} /></span>
          </div>
          <h2 style="font-size:24px;margin:10px 0 2px">{workout.name}</h2>
          {workout.subtitle && <div style="color:var(--ink-2);font-size:15px">{workout.subtitle}</div>}
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
                <StatusMark status={statusOf(p.status)} />
                <KindDot kind={w!.kind} big />
                <div class="t"><b>{w!.name}</b><span>{KIND_LABEL[w!.kind]}{w!.minutes ? ` · ${w!.minutes} min` : ''}{p.status === 'completed' ? '' : ' · tap for the details and to log it'}</span></div>
                <StatusPill status={statusOf(p.status)} />
              </a>
            ))}
          </div>
        </section>
      )}

      <NextUp data={data} date={date} />

      {note && (
        <section class="section">
          <h2>Coach</h2>
          <p class="muted" style="font-size:15px;line-height:1.6">{note}</p>
        </section>
      )}
      </div>
      <div class="today-side">
      <section class="section">
        <div class="row between" style="margin-bottom:10px">
          <h2>Readiness</h2>
          <span class="big" style={`color:${ready.band === 'go' ? 'var(--good)' : ready.band === 'rest' ? 'var(--bad)' : ready.band === 'easy' ? 'var(--warn)' : 'var(--ink)'}`}>{ready.score}</span>
        </div>
        <p class="muted small" style="margin-bottom:10px">{bandText}.</p>
        <div class="stats">
          {ready.drivers.map((d) => (
            <div class="stat" key={d.name} title={READINESS_HELP[d.name] ?? ''}>
              <div class="v" style={`font-size:16px;color:${d.effect === 'up' ? 'var(--good)' : d.effect === 'down' ? 'var(--bad)' : 'var(--ink)'}`}>{d.value}</div>
              <div class="l">{d.name}{d.name !== 'Form' ? ' today vs your 2-week average' : ' (fitness minus fatigue)'}</div>
            </div>
          ))}
        </div>
        {wellnessSetAside ? (
          <p class="small" style="margin-top:8px;color:var(--warn)">Today's HRV, sleep and resting heart rate are set aside as wrong, so the score is from form alone and the day is left out of your averages.</p>
        ) : (
          <p class="faint small" style="margin-top:8px">The score blends HRV (40%), sleep (30%), resting heart rate (15%) and form (15%), each against your own recent normal. Green is better than normal, red worse.</p>
        )}
        {data.wellnessAll.length === 0 && <p class="faint small" style="margin-top:10px">HRV, sleep and resting heart rate appear once Intervals.icu is connected and has wellness data from whatever you use to record it.</p>}
        <DayNoteEditor date={date} note={todayNote} hasWellness={data.wellnessAll.some((w) => w.date === date)} />
      </section>

      <section class="section">
        <div class="row between" style="margin-bottom:10px">
          <h2>Fitness</h2>
          <div class="stats" style="gap:4px 16px;grid-template-columns:repeat(3,max-content);margin-left:auto">
            <div class="stat"><div class="v" style="font-size:18px;color:var(--z2)">{fit?.ctl.toFixed(0) ?? '–'}</div><div class="l">Fitness</div></div>
            <div class="stat"><div class="v" style="font-size:18px;color:var(--z5)">{fit?.atl.toFixed(0) ?? '–'}</div><div class="l">Fatigue</div></div>
            <div class="stat"><div class="v" style="font-size:18px">{fit ? (fit.tsb > 0 ? '+' : '') + fit.tsb.toFixed(0) : '–'}</div><div class="l">Form</div></div>
          </div>
        </div>
        <FitnessChart series={series.slice(-84)} />
        <p class="faint small" style="margin-top:6px">Form is fitness minus fatigue. It runs below zero while fitness is being built (the blue band), returns toward zero in a recovery week, and should sit above zero on an event day. Hover a band or a line for more.</p>
      </section>
      </div>
      </div>
    </div>
  );
}

function NextUp({ data, date }: { data: AppData; date: string }) {
  const upcoming = data.planned.filter((p) => p.date > date && p.status !== 'completed').sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return null;
  const nextDate = upcoming[0].date;
  const items = plannedOn(upcoming, nextDate, (id) => findWorkout(data.mine, id)?.kind ?? 'ride').map((p) => ({ p, w: findWorkout(data.mine, p.workoutId) })).filter((x) => x.w);
  if (!items.length) return null;
  const days = Math.round((Date.parse(nextDate) - Date.parse(date)) / 864e5);
  return (
    <section class="section">
      <h2>Next up <span class="muted" style="font-weight:400">· {days === 1 ? 'tomorrow' : fmtDate(nextDate, { weekday: 'long' })}</span></h2>
      <div class="stack" style="margin-top:8px">
        {items.map(({ p, w }) => (
          <a class={`cal-item ${p.status}`} key={p.id} href={`#/workout/${w!.id}?from=today&date=${nextDate}`}>
            <StatusMark status={statusOf(p.status)} />
            {w!.kind === 'ride' ? <WorkoutProfile blocks={w!.blocks} height={28} ratio={2.2} /> : <KindDot kind={w!.kind} big />}
            <div class="t"><b>{w!.name}</b><span>{w!.kind === 'ride' ? `${clock(workoutStats(w!.blocks).seconds)} · ${workoutStats(w!.blocks).tss} TSS` : `${KIND_LABEL[w!.kind]}${w!.minutes ? ` · ${w!.minutes} min` : ''}`}{p.note ? ` · ${p.note}` : ''}{p.userEdited ? ' · changed by you' : ''}</span></div>
            <StatusPill status={statusOf(p.status)} />
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * The rider's own word on the day: a note the coach reads first, and a switch to
 * set the day's wellness numbers aside when the watch got them wrong. Saved on
 * blur or Save, synced across devices with everything else.
 */
function DayNoteEditor({ date, note, hasWellness }: { date: string; note?: DayNote; hasWellness: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note?.text ?? '');
  const [bad, setBad] = useState(!!note?.badWellness);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText(note?.text ?? ''); setBad(!!note?.badWellness); }, [note?.text, note?.badWellness]);
  const dirty = text.trim() !== (note?.text ?? '') || bad !== !!note?.badWellness;
  async function save() {
    setSaving(true);
    try { await saveDayNote(date, { text, badWellness: bad }); setOpen(false); } finally { setSaving(false); }
  }
  if (!open) {
    if (!note?.text && !note?.badWellness) return <button class="btn sm quiet" style="margin-top:10px" onClick={() => setOpen(true)}>Add a note about today</button>;
    return (
      <div class="row between" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);gap:10px;align-items:flex-start">
        <div class="small"><span class="muted">Your note:</span> {note.text || <span class="faint">no text</span>}{note.badWellness ? <span class="faint"> · wellness set aside</span> : null}</div>
        <button class="btn sm quiet" onClick={() => setOpen(true)}>Edit</button>
      </div>
    );
  }
  return (
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <div class="field">
        <label>Your note about today <span class="faint">· the coach reads this before the numbers</span></label>
        <textarea rows={3} value={text} placeholder="e.g. the watch was out of sleep mode overnight, so the sleep and HRV are wrong; or: travelling, legs heavy from yard work, a cold coming on" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} style="resize:vertical;min-height:64px" />
      </div>
      <label class="row small" style="gap:8px;margin-top:8px;align-items:flex-start;cursor:pointer">
        <input type="checkbox" checked={bad} onChange={() => setBad(!bad)} style="margin-top:3px" />
        <span>Today's wellness numbers are not real measurements: leave today's HRV, sleep and resting heart rate out of readiness and out of my averages{!hasWellness ? <span class="faint"> (none synced for today yet; the flag will apply when they arrive)</span> : null}</span>
      </label>
      <p class="faint small" style="margin-top:6px">Tick only when the watch was not measuring you (out of sleep mode, on the nightstand). Real numbers with a reason behind them, a late glass of wine, a flight, a cold coming on, stay in: just write the note. The coach reads your notes before the numbers and keeps three months of them in mind.</p>
      <div class="row" style="gap:8px;margin-top:10px">
        <button class="btn sm primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button class="btn sm quiet" onClick={() => { setText(note?.text ?? ''); setBad(!!note?.badWellness); if (!dirty) setOpen(false); }} disabled={saving}>{dirty ? 'Reset' : 'Close'}</button>
      </div>
    </div>
  );
}

/**
 * The one-line advice under the readiness score, written for what is actually
 * on the calendar today (anything not yet done), not for an assumed ride.
 */
export function readinessAdvice(band: 'go' | 'ease' | 'easy' | 'rest', kinds: string[]): string {
  const ride = kinds.includes('ride'), lift = kinds.includes('strength'), walk = kinds.includes('walk'), mob = kinds.includes('mobility');
  const gentleOnly = kinds.length > 0 && !ride && !lift;
  if (kinds.length === 0) {
    return { go: 'Recovered and ready; nothing is on the calendar, so the day is yours', ease: 'A little below normal; a free day suits', easy: 'Below normal; keep anything you add gentle', rest: 'Well below normal; rest is the right call today' }[band];
  }
  if (gentleOnly) {
    const what = walk && mob ? 'the walk and the mobility work' : walk ? 'the walk' : 'the mobility work';
    return { go: `Recovered and ready; ${what} will do its job`, ease: `A little below normal; ${what} is the right kind of day`, easy: `Below normal; ${what} is just right, keep it easy`, rest: `Well below normal; ${what} is fine if it stays gentle, or take the day` }[band];
  }
  if (lift && !ride) {
    return { go: 'Ready for the full session, loads as planned', ease: 'Ease off a little: drop the load 10–15% or a set if it feels heavy', easy: 'Below normal; keep the lifting light today, technique over load', rest: 'Well below normal; a rest day would serve you better than lifting' }[band];
  }
  const extra = lift ? ' Fit the strength work around it, lighter if the ride is the priority' : '';
  return { go: 'Ready for the full session' + extra, ease: 'Ease the intensity 10–15% if it feels heavy' + extra, easy: 'Keep the ride in zone 1–2 today' + (lift ? ' and keep the lifting light' : ''), rest: 'A rest day would serve you better' + (lift ? '; if you do anything, make it the mobility and skip the lifting' : '') }[band];
}

const READINESS_HELP: Record<string, string> = {
  HRV: 'Heart-rate variability this morning against your two-week average. Higher than normal means recovered; lower means stress or fatigue.',
  Sleep: 'Last night against your two-week average.',
  'Resting HR': 'Resting heart rate this morning against your two-week average. Higher than normal is a fatigue or illness signal.',
  Form: 'Fitness minus fatigue. Negative while building, positive when fresh; +5 to +20 is the window for an event.',
};

