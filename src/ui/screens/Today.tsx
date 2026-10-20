import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { GettingStarted } from './Help';
import { findWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { FAMILY_LABEL } from '../../library/workouts';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { fitnessFromRides, fitnessOn, fmtDate, missedThisWeek, plannedOn, readinessToday, weekStart } from '../derived';
import { db, getSetting, setSetting } from '../../data/db';
import { credentials, syncAll } from '../../sync/syncService';
import { sendWorkout } from '../../sync/intervals';
import { notify, saveDayNote, trustedWellness } from '../store';
import { dailyNote } from '../../coach/claude';
import { FitnessChart, RangePicker, valueDaysAgo, type RangeKey } from '../FitnessChart';
import { ReadinessDial, Sparkline, WeekStrip } from '../Glance';
import { lastPlannedDate, projectFitness, weekSummary } from '../week';
import { StepsTable } from '../StepsTable';
import { addDays } from '../../engine/load';
import { KIND_LABEL, KindDot, ReplanView } from './Plan';
import { StatusMark, StatusPill, statusOf } from '../StatusMark';
import { applyPlan, coachReviewAfterSync, getActivePlan, markChecked, recentNoteLines, replan, type ActivePlan } from '../planService';
import type { CoachReview } from '../../coach/claude';
import type { Replan } from '../../engine/adapt';
import type { DayNote } from '../../engine/types';
import { toast } from '../Toast';
import { Empty, PageHead } from '../PageHead';
import { Icon } from '../icons';

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
  const daySig = 'v2|' + withW.map((x) => `${x.w!.id}:${x.p.status}:${x.p.activityId ?? ''}`).join(',') + `|${todayNote?.text ?? ''}|${todayNote?.badWellness ? 'bad' : ''}`;

  const [busy, setBusy] = useState<string | null>(null);
  const setMsg = toast;
  const [note, setNote] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [check, setCheck] = useState<Replan | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<CoachReview | null>(null);
  const [tourDone, setTourDone] = useState<boolean | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [range, setRange] = useState<RangeKey>('3m');
  useEffect(() => { getSetting<RangeKey>('fitnessRange', '3m').then(setRange); }, []);
  const pickRange = (k: RangeKey) => { setRange(k); setSetting('fitnessRange', k); };
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
    // Re-read on every data change: plans can arrive from another device without the calendar changing size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
          todaySessions: withW.map((x) => ({ planned: x.p, workout: x.w!, recorded: x.p.activityId ? data.rides.find((r) => r.id === x.p.activityId) : undefined })),
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

  const last = series[series.length - 1];
  const projEnd = lastPlannedDate(data.planned, date);
  const projection = last && projEnd ? projectFitness(last, data.planned, data.mine, projEnd > addDays(date, 180) ? addDays(date, 180) : projEnd) : [];
  const events = active && active.goal.kind === 'event' ? [{ date: active.goalDate, label: 'event' }] : [];

  const bandText = readinessAdvice(ready.band, withW.filter((x) => x.p.status !== 'completed').map((x) => x.w!.kind));

  return (
    <div>
      <PageHead eyebrow={fmtDate(date)} title={profile.name ? `Hello, ${profile.name.split(' ')[0]}` : 'Today'}>
        <button class="btn sm" onClick={sync} disabled={busy === 'sync' || busy === 'review' || connected === false}><Icon.sync size={15} />{busy === 'sync' ? 'Syncing…' : busy === 'review' ? 'Asking the coach…' : 'Sync'}</button>
      </PageHead>

      <WeekStrip week={weekSummary(weekStart(date), data.planned, data.rides, data.mine)} />

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
            <span class="tag" style={`--c:var(--z${stats.dominantZone})`}>{FAMILY_LABEL[workout.family]}</span>
            <span class="row" style="gap:8px"><StatusMark status={statusOf(plan.status)} /><StatusPill status={statusOf(plan.status)} /></span>
          </div>
          <h2 style="font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.02em;margin:12px 0 2px">{workout.name}</h2>
          {workout.subtitle && <div style="color:var(--ink-2);font-size:15px">{workout.subtitle}</div>}
          <p class="muted small">{clock(stats.seconds)} · {stats.tss} TSS · IF {stats.intensityFactor.toFixed(2)} · {plan.basis === 'power' ? 'power targets' : 'heart-rate targets'}</p>
          <div style="margin:14px 0 12px"><WorkoutProfile blocks={workout.blocks} height={96} hero /></div>
          <p class="muted" style="font-size:14px">{workout.purpose}</p>
          <div class="row wrap" style="margin-top:14px;gap:8px">
            {plan.status === 'planned' && <button class="btn primary" onClick={send} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Send to Garmin'}</button>}
            {plan.status === 'sent' && <button class="btn" onClick={send} disabled={busy === 'send'}>Send again</button>}
            <button class="btn" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)}>{showSteps ? 'Hide steps' : 'Steps and targets'}</button>
            <a class="btn quiet" href={`#/workout/${workout.id}?from=today&date=${date}`}>Details</a>
            {plan.status !== 'completed' && <a class="icon-btn" style="margin-left:auto" href={`#/calendar?d=${date}&change=${plan.id}`} title="Replace, move or remove" aria-label="Replace, move or remove"><Icon.more /></a>}
          </div>
          {showSteps && <div style="margin-top:14px"><StepsTable blocks={workout.blocks} basis={plan.basis} profile={profile} /></div>}
        </section>
      ) : others.length === 0 ? (
        <Empty title="Nothing planned today." action={<a class="btn primary sm" href="#/library">Choose a workout</a>}>Pick something from the library, build a plan, or take the day.</Empty>
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
        <h2 style="margin-bottom:12px">Readiness</h2>
        <div class="panel readiness">
          <div class="rd-top">
            <ReadinessDial score={ready.score} band={ready.band} />
            <p class="rd-advice">{bandText}.</p>
          </div>
          <ReadinessRows data={data} date={date} series={series} drivers={ready.drivers} />
          {wellnessSetAside ? (
            <p class="small" style="margin-top:10px;color:var(--warn)">Today's HRV, sleep and resting heart rate are set aside as wrong, so the score is from form alone and the day is left out of your averages.</p>
          ) : (
            <p class="faint small" style="margin-top:10px">The score blends HRV (40%), sleep (30%), resting heart rate (15%) and form (15%), each against your own two-week normal. Lines show the last two weeks; green is better than normal, red worse.</p>
          )}
          {data.wellnessAll.length === 0 && <p class="faint small" style="margin-top:10px">HRV, sleep and resting heart rate appear once Intervals.icu is connected and has wellness data from whatever you use to record it.</p>}
          <DayNoteEditor date={date} note={todayNote} hasWellness={data.wellnessAll.some((w) => w.date === date)} />
        </div>
      </section>

      <section class="section">
        <div class="row between wrap" style="margin-bottom:12px;gap:8px">
          <h2>Fitness</h2>
          <RangePicker value={range} onChange={pickRange} />
        </div>
        <div class="panel">
          <FitnessTiles series={series} />
          <FitnessChart series={series} range={range} projection={projection} events={events} />
        </div>
        <p class="faint small" style="margin-top:8px">Form is fitness minus fatigue. It runs below zero while fitness is being built (the blue band), returns toward zero in a recovery week, and should sit above zero on an event day. Dashed lines carry fitness and form forward over what is on your calendar. Hover a band or a line for more.</p>
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


/** Fitness, fatigue and form today, each with its change over the last seven days. */
function FitnessTiles({ series }: { series: ReturnType<typeof fitnessFromRides> }) {
  const now = series[series.length - 1], ago = valueDaysAgo(series, 7);
  const tile = (label: string, v: number | undefined, prev: number | undefined, color: string, help: string, signed = false) => {
    const d = v != null && prev != null ? Math.round(v) - Math.round(prev) : null;
    return (
      <div class="stat" title={help}>
        <div class="v" style={`font-size:28px;line-height:32px;color:${color}`}>{v == null ? '–' : `${signed && v > 0 ? '+' : ''}${Math.round(v)}`}</div>
        <div class="l">{label}{d != null && <span class="delta" style={`color:${d === 0 ? 'var(--ink-3)' : 'var(--ink-2)'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '·'} {Math.abs(d)} in 7 days</span>}</div>
      </div>
    );
  };
  return (
    <div class="stats tiles" style="margin-bottom:12px">
      {tile('Fitness', now?.ctl, ago?.ctl, 'var(--info)', 'Fitness: the 42-day weighted average of daily training load.')}
      {tile('Fatigue', now?.atl, ago?.atl, 'var(--z5)', 'Fatigue: the 7-day weighted average of daily training load.')}
      {tile('Form', now?.tsb, ago?.tsb, 'var(--ink)', 'Form: fitness minus fatigue.', true)}
    </div>
  );
}

/**
 * The four inputs to readiness, each with this morning's value, its last two
 * weeks as a line, and the difference from the two-week normal, coloured by
 * whether that difference helps.
 */
function ReadinessRows({ data, date, series, drivers }: { data: AppData; date: string; series: ReturnType<typeof fitnessFromRides>; drivers: Array<{ name: string; value: string; effect: 'up' | 'down' | 'flat' }> }) {
  const days = Array.from({ length: 15 }, (_, i) => addDays(date, i - 14));
  const w = (d: string) => data.wellness.find((x) => x.date === d);
  const mean = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x != null && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rows: Array<{ name: string; vals: Array<number | null>; fmt: (v: number) => string; unit: string; help: string }> = [
    { name: 'HRV', vals: days.map((d) => w(d)?.hrv ?? null), fmt: (v) => `${Math.round(v)}`, unit: 'ms', help: READINESS_HELP.HRV },
    { name: 'Sleep', vals: days.map((d) => { const s = w(d)?.sleepSeconds; return s ? s / 3600 : null; }), fmt: (v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, unit: '', help: READINESS_HELP.Sleep },
    { name: 'Resting HR', vals: days.map((d) => w(d)?.restingHr ?? null), fmt: (v) => `${Math.round(v)}`, unit: 'bpm', help: READINESS_HELP['Resting HR'] },
    { name: 'Form', vals: days.map((d) => series.find((f) => f.date === d)?.tsb ?? null), fmt: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`, unit: '', help: READINESS_HELP.Form },
  ];
  return (
    <div class="rd-rows">
      {rows.map((r) => {
        const todayV = r.vals[14];
        const base = r.name === 'Form' ? null : mean(r.vals.slice(0, 14));
        const eff = drivers.find((d) => d.name === r.name)?.effect ?? 'flat';
        const color = eff === 'up' ? 'var(--good)' : eff === 'down' ? 'var(--bad)' : 'var(--ink-2)';
        const diff = todayV != null && base != null ? todayV - base : null;
        return (
          <div class="rd-row" key={r.name} title={r.help}>
            <span class="rd-name">{r.name}</span>
            <Sparkline values={r.vals} color={r.name === 'Form' ? 'var(--ink-3)' : 'var(--aqua)'} label={`${r.name}, last two weeks`} />
            <span class="rd-val num">{todayV != null ? r.fmt(todayV) : '–'}<span class="faint" style="font-weight:400">{todayV != null && r.unit ? ` ${r.unit}` : ''}</span></span>
            <span class="rd-delta small" style={`color:${color}`}>{r.name === 'Form' ? (eff === 'up' ? 'fresh' : eff === 'down' ? 'tired' : 'normal') : diff == null ? 'no data' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${r.name === 'Sleep' ? r.fmt(Math.abs(diff)) : Math.abs(Math.round(diff))} vs normal`}</span>
          </div>
        );
      })}
    </div>
  );
}
