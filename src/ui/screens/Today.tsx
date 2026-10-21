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
import { notify, saveDayNote, sessionHref, trustedWellness } from '../store';
import { durationWords, type CoachContext } from '../../coach/claude';
import { CoachPanel } from '../CoachPanel';
import { FitnessChart, RangePicker, valueDaysAgo, type RangeKey } from '../FitnessChart';
import { ReadinessDial, Sparkline, WeekStrip } from '../Glance';
import { lastPlannedDate, projectFitness, weekSummary } from '../week';
import { StepsTable } from '../StepsTable';
import { addDays } from '../../engine/load';
import { KIND_LABEL, KindDot, ReplanView } from './Plan';
import { StatusPill, statusOf } from '../StatusMark';
import { applyPlan, changeSig, coachReviewAfterSync, dismissCoachReview, freshData, getActivePlan, getCoachReview, markChecked, recentNoteLines, rejectChanges, replan, type ActivePlan, type SavedReview } from '../planService';
import { changeKey, type Change, type Replan } from '../../engine/adapt';
import type { DayNote } from '../../engine/types';
import { toast } from '../Toast';
import { Empty, PageHead } from '../PageHead';
import { Icon } from '../icons';
import { ChangeSheet } from '../ChangeSheet';
import { GLOSSARY, READINESS_HELP } from '../glossary';
import type { PlannedWorkout } from '../../engine/types';

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
  const recOf = (p: { activityId?: string }) => (p.activityId ? data.rides.find((r) => r.id === p.activityId) : undefined);
  const daySig = 'v3|' + withW.map((x) => `${x.w!.id}:${x.p.status}:${x.p.activityId ?? ''}:${recOf(x.p)?.seconds ?? ''}`).join(',') + `|${todayNote?.text ?? ''}|${todayNote?.badWellness ? 'bad' : ''}`;

  const [busy, setBusy] = useState<string | null>(null);
  const setMsg = toast;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [check, setCheck] = useState<Replan | null>(null);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<SavedReview | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  useEffect(() => { getCoachReview().then(setReview); }, []);
  const [tourDone, setTourDone] = useState<boolean | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [changing, setChanging] = useState<PlannedWorkout | null>(null);
  const [range, setRange] = useState<RangeKey>('3m');
  useEffect(() => { getSetting<RangeKey>('fitnessRange', '3m').then(setRange); }, []);
  const pickRange = (k: RangeKey) => { setRange(k); setSetting('fitnessRange', k); };
  useEffect(() => { getSetting<boolean>('tourDone', false).then(setTourDone); }, []);

  useEffect(() => { credentials().then((c) => setConnected(!!c)); }, []);
  const [locked, setLocked] = useState<{ question: string } | null>(null);
  useEffect(() => { getSetting<{ locked?: { question: string } } | null>('deviceSync', null).then((s) => setLocked(s?.locked ?? null)); }, [data.planned.length, data.rides.length, data.dayNotes.length]);

  // The plan re-checks itself whenever the data change; its suggestions stay on offer until accepted or rejected.
  useEffect(() => {
    let alive = true;
    (async () => {
      const a = await getActivePlan();
      if (!alive) return;
      setActive(a);
      if (a && a.start <= date && data.rides.length) {
        const r = await replan(data);
        if (alive) setCheck(r);
        if (a.lastCheck !== date) await markChecked();
      } else if (alive) setCheck(null);
    })();
    return () => { alive = false; };
    // Re-read on every data change: plans can arrive from another device without the calendar changing size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function acceptChanges(changes: Change[]) {
    if (!check || !active) return;
    setChecking(true);
    try {
      await applyPlan(data, check.plan, active.goal, active.availability, active.masters, new Set(changes.map(changeKey)), { planId: active.id });
      setCheck(await replan(await freshData(data)));
      setMsg({ ok: true, text: changes.length === 1 ? 'Change made on the calendar.' : `${changes.length} changes made on the calendar.` });
    } finally { setChecking(false); }
  }

  /** Everything as it is in storage now, for a coach request right after a sync. */
  async function storedData(): Promise<AppData> {
    const notes = await db.dayNotes.toArray();
    const ridesAll = await db.rides.orderBy('date').reverse().toArray();
    return { ...data, rides: ridesAll.filter((r) => !r.notTraining), ridesAll, planned: await db.planned.toArray(), wellness: trustedWellness(await db.wellness.orderBy('date').toArray(), notes), dayNotes: notes };
  }

  const [retrying, setRetrying] = useState(false);
  async function retryReview() {
    setRetrying(true);
    try {
      const fresh = await storedData();
      // Reviews saved by older builds do not list their activities; the last two days' stand in.
      const ids = review?.ids?.length ? review.ids : fresh.rides.filter((r) => r.date >= addDays(date, -1)).map((r) => r.id);
      const out = await coachReviewAfterSync(fresh, ids, true);
      if (out) { setReview(await getCoachReview()); if (out.check) setCheck(out.check); }
    } catch (e) { setMsg({ ok: false, text: `The coach review failed again: ${(e as Error).message}` }); }
    finally { setRetrying(false); }
  }

  async function rejectSuggested(changes: Change[]) {
    if (!check) return;
    await rejectChanges(changes);
    const gone = new Set(changes.map(changeSig));
    setCheck({ ...check, changes: check.changes.filter((c) => !gone.has(changeSig(c))) });
  }

  const coachCtx: CoachContext = {
    profile, date, fitness: fit, readiness: ready,
    todaySessions: withW.map((x) => ({ planned: x.p, workout: x.w!, recorded: recOf(x.p) })),
    recentRides: data.rides, missedThisWeek: missedThisWeek(data.planned),
    riderNote: todayNote?.text, wellnessSetAside,
    recentNotes: recentNoteLines(data.dayNotes.filter((n) => n.date !== date), date, 90),
  };

  async function send() {
    if (!plan || !workout) return;
    const c = await credentials();
    if (!c) { setMsg({ ok: false, text: 'Connect Intervals.icu in Settings to send sessions to your Garmin.' }); return; }
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
          const out = await coachReviewAfterSync(await storedData(), r.newIds);
          if (out) { setReview(await getCoachReview()); if (out.check) setCheck(out.check); }
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
      <PageHead help="today" eyebrow={fmtDate(date)} title={profile.name ? `Hello, ${profile.name.split(' ')[0]}` : 'Today'}>
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

      {active && (
        <section class="panel" style="margin-bottom:14px;padding:12px 16px">
          <div class="row between">
            <a class="small plain-link" href={`#/plan/${active.id}`} title="Open the plan"><b>{active.name}</b>{active.start > date ? <span class="muted"> · starts {fmtDate(active.start, { month: 'short', day: 'numeric' })}</span> : null}{plan?.note ? <span class="muted"> · {plan.note}</span> : others[0]?.p.note ? <span class="muted"> · {others[0].p.note}</span> : null}{active.goal.kind === 'event' ? <span class="muted"> · {Math.ceil((Date.parse(active.goalDate) - Date.parse(date)) / 864e5)} days to go</span> : null} <span class="faint">›</span></a>
          </div>
          {check && check.changes.length > 0 && (
            <div class="row between wrap" style="gap:8px;margin-top:8px">
              <span class="small"><b>{check.changes.length === 1 ? '1 suggested change' : `${check.changes.length} suggested changes`}</b> <span class="muted">to your plan{review && review.text ? (review.applyChanges ? '; the coach recommends them' : '; the coach suggests leaving the plan as it is') : ''}.</span></span>
              <button class="btn sm" aria-expanded={showSuggestions} onClick={() => setShowSuggestions(!showSuggestions)}>{showSuggestions ? 'Hide' : 'Review'}</button>
            </div>
          )}
          {check && check.changes.length > 0 && showSuggestions && <ReplanView check={check} onAccept={acceptChanges} onReject={rejectSuggested} busy={checking} coachSays={review?.reason || undefined} />}
        </section>
      )}

      {workout && plan && stats ? (
        <section class="panel accent" style="padding:18px 18px 16px">
          <div class="row between">
            <span class="tag" style={`--c:var(--z${stats.dominantZone})`}>{FAMILY_LABEL[workout.family]}</span>
            <StatusPill status={statusOf(plan.status)} />
          </div>
          <h2 style="font-size:28px;line-height:32px;font-weight:700;letter-spacing:-0.02em;margin:12px 0 2px">{workout.name}</h2>
          {workout.subtitle && <div style="color:var(--ink-2);font-size:15px">{workout.subtitle}</div>}
          <p class="muted small">{durationWords(stats.seconds)} · {stats.tss} TSS · intensity {stats.intensityFactor.toFixed(2)} · {plan.basis === 'power' ? 'power targets' : 'heart-rate targets'}</p>
          <div style="margin:14px 0 12px"><WorkoutProfile blocks={workout.blocks} height={96} hero /></div>
          <p class="muted" style="font-size:14px">{workout.purpose}</p>
          <div class="row wrap" style="margin-top:14px;gap:8px">
            {plan.status === 'planned' && <button class="btn primary" onClick={send} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : 'Send to Garmin'}</button>}
            {plan.status === 'sent' && <button class="btn" onClick={send} disabled={busy === 'send'}>Send again</button>}
            <button class="btn" aria-expanded={showSteps} onClick={() => setShowSteps(!showSteps)}>{showSteps ? 'Hide steps' : 'Steps and targets'}</button>
            {plan.status === 'completed' && plan.activityId && data.rides.some((r) => r.id === plan.activityId) && <a class="btn primary" href={`#/rides/${plan.activityId}`}>See the recording</a>}
            <a class="btn quiet" href={`#/workout/${workout.id}?from=today&date=${date}`}>{plan.status === 'completed' ? 'The plan' : 'Details'}</a>
            {plan.status !== 'completed' && <button class="icon-btn" style="margin-left:auto" onClick={() => setChanging(plan)} title="Move, replace or remove" aria-label="Move, replace or remove"><Icon.more /></button>}
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
              <div class={`cal-item ${p.status}`} key={p.id}>
              <a class="row" style="flex:1;min-width:0;text-decoration:none" href={sessionHref(p, w!.id, 'today', date, data.rides)}>
                <KindDot kind={w!.kind} big />
                <div class="t"><b>{w!.name}</b><span>{KIND_LABEL[w!.kind]}{w!.minutes ? ` · ${w!.minutes} min` : ''}{p.status === 'completed' ? (p.activityId && data.rides.some((r) => r.id === p.activityId) ? ' · tap for the recording' : ' · logged by hand') : ' · tap to see it or log it'}</span></div>
                <StatusPill status={statusOf(p.status)} />
              </a>
              {p.status !== 'completed' && <button class="icon-btn" onClick={() => setChanging(p)} title="Move, replace or remove" aria-label={`Move, replace or remove ${w!.name}`}><Icon.more /></button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <NextUp data={data} date={date} />
      {changing && <ChangeSheet data={data} planned={changing} onClose={() => setChanging(null)} />}

      <CoachPanel ctx={coachCtx} date={date} daySig={daySig} review={review} onDismissReview={async () => { await dismissCoachReview(); setReview(null); }} onRetryReview={retryReview} retrying={retrying} />
      </div>
      <div class="today-side">
      <section class="section">
        <h2 style="margin-bottom:12px">Readiness</h2>
        <div class="panel readiness">
          <div class="rd-top">
            <a href="#/progress?on=hrv,restinghr,sleep&r=6w" class="rd-dial-link" aria-label="HRV, resting heart rate and sleep over time"><ReadinessDial score={ready.score} band={ready.band} /></a>
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
        <p class="faint small" style="margin-top:8px">Hover or touch the chart to read any day. Form is fitness minus fatigue. It runs below zero while fitness is being built (the blue band), returns toward zero in a recovery week, and should sit above zero on an event day. Dashed lines carry all three forward over what is on your calendar, every session done as planned; form is the mirror of fatigue because fitness moves slowly. Tap or hover over a band or a line for more.</p>
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
          <a class={`cal-item ${p.status}`} key={p.id} href={sessionHref(p, w!.id, 'today', nextDate, data.rides)}>
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
    if (!note?.text && !note?.badWellness) return <button class="btn sm quiet" style="margin-top:10px;padding-left:0;padding-right:0" onClick={() => setOpen(true)}>Add a note about today</button>;
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
        <span>Today's wellness numbers are not real measurements</span>
      </label>
      <p class="faint small" style="margin-top:6px">Ticked, today's HRV, sleep and resting heart rate are left out of readiness and out of your averages{!hasWellness ? ' (none synced for today yet; the flag will apply when they arrive)' : ''}. Tick only when the watch was not measuring you (out of sleep mode, on the nightstand). Real numbers with a reason behind them, a late glass of wine, a flight, a cold coming on, stay in: just write the note. The coach reads your notes before the numbers, the last three months of them.</p>
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



/** Fitness, fatigue and form today, each with its change over the last seven days. */
function FitnessTiles({ series }: { series: ReturnType<typeof fitnessFromRides> }) {
  const now = series[series.length - 1], ago = valueDaysAgo(series, 7);
  const tile = (label: string, v: number | undefined, prev: number | undefined, color: string, help: string, signed = false) => {
    const d = v != null && prev != null ? Math.round(v) - Math.round(prev) : null;
    return (
      <a class="stat stat-link" href="#/progress?on=fitness,fatigue,form" title={help} aria-label={`${label} over time`}>
        <div class="v" style={`font-size:28px;line-height:32px;color:${color}`}>{v == null ? '–' : `${signed && v > 0 ? '+' : ''}${Math.round(v) < 0 ? '−' + Math.abs(Math.round(v)) : Math.round(v)}`}</div>
        <div class="l">{label}{d != null && <span class="delta" style={`color:${d === 0 ? 'var(--ink-3)' : 'var(--ink-2)'}`}>{d === 0 ? 'no change in 7 days' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} in 7 days`}</span>}</div>
      </a>
    );
  };
  return (
    <div class="stats tiles" style="margin-bottom:12px">
      {tile('Fitness', now?.ctl, ago?.ctl, 'var(--info)', `Fitness: the ${GLOSSARY.fitness.short}.`)}
      {tile('Fatigue', now?.atl, ago?.atl, 'var(--z5)', `Fatigue: the ${GLOSSARY.fatigue.short}.`)}
      {tile('Form', now?.tsb, ago?.tsb, 'var(--ink)', `Form, today: ${GLOSSARY.form.short}.`, true)}
    </div>
  );
}

/**
 * The four inputs to readiness, each with this morning's value, its last two
 * weeks as a line, and the difference from the two-week normal, coloured by
 * whether that difference helps.
 */
/** A sleep difference in hours, shown as minutes under an hour ("37 min"), else hours and minutes ("1h05"). */
function sleepDiff(h: number): string {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

/** Each readiness row opens Progress with that metric on the fitness chart, over six weeks. */
const RD_LINK: Record<string, string> = {
  HRV: '#/progress?on=hrv,fatigue,load&r=6w',
  Sleep: '#/progress?on=sleep,fatigue,load&r=6w',
  'Resting HR': '#/progress?on=restinghr,fatigue,load&r=6w',
  Form: '#/progress?on=fitness,fatigue,form&r=6w',
};

function ReadinessRows({ data, date, series, drivers }: { data: AppData; date: string; series: ReturnType<typeof fitnessFromRides>; drivers: Array<{ name: string; value: string; effect: 'up' | 'down' | 'flat' }> }) {
  const days = Array.from({ length: 15 }, (_, i) => addDays(date, i - 14));
  const w = (d: string) => data.wellness.find((x) => x.date === d);
  const mean = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x != null && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  // Form is negative as often as not, so its normal is the plain mean of the two weeks.
  const meanSigned = (xs: Array<number | null>) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const rows: Array<{ name: string; vals: Array<number | null>; fmt: (v: number) => string; unit: string; help: string }> = [
    { name: 'HRV', vals: days.map((d) => w(d)?.hrv ?? null), fmt: (v) => `${Math.round(v)}`, unit: 'ms', help: READINESS_HELP.HRV },
    { name: 'Sleep', vals: days.map((d) => { const s = w(d)?.sleepSeconds; return s ? s / 3600 : null; }), fmt: (v) => `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, unit: '', help: READINESS_HELP.Sleep },
    { name: 'Resting HR', vals: days.map((d) => w(d)?.restingHr ?? null), fmt: (v) => `${Math.round(v)}`, unit: 'bpm', help: READINESS_HELP['Resting HR'] },
    { name: 'Form', vals: days.map((d) => series.find((f) => f.date === d)?.tsb ?? null), fmt: (v) => { const n = Math.round(v); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`; }, unit: '', help: READINESS_HELP.Form },
  ];
  return (
    <div class="rd-rows">
      <div class="rd-row rd-head caption" aria-hidden="true"><span /><span class="rd-spark" /><span class="rd-val">Today</span><span class="rd-delta">vs 2-week normal</span></div>
      {rows.map((r) => {
        const todayV = r.vals[14];
        const base = r.name === 'Form' ? meanSigned(r.vals.slice(0, 14)) : mean(r.vals.slice(0, 14));
        const eff = drivers.find((d) => d.name === r.name)?.effect ?? 'flat';
        const color = eff === 'up' ? 'var(--good)' : eff === 'down' ? 'var(--bad)' : 'var(--ink-2)';
        const raw = todayV != null && base != null ? todayV - base : null;
        // round before choosing the sign, so a difference under half a unit reads ±0, not −0
        const diff = raw == null ? null : r.name === 'Sleep' ? Math.round(raw * 60) / 60 : Math.round(raw);
        return (
          <a class="rd-row" key={r.name} title={r.help} href={RD_LINK[r.name]} aria-label={`${r.name} over time`}>
            <span class="rd-name">{r.name}</span>
            <span class="rd-spark"><Sparkline values={r.vals} width={56} color={r.name === 'Form' ? 'var(--ink-3)' : 'var(--aqua)'} label={`${r.name}, last two weeks`} /></span>
            <span class="rd-val num">{todayV != null ? r.fmt(todayV) : '–'}{todayV != null && r.unit ? <span class="rd-unit">{r.unit}</span> : null}</span>
            <span class="rd-delta small" style={`color:${color}`}>{diff == null ? 'none today' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${r.name === 'Sleep' ? sleepDiff(Math.abs(diff)) : Math.abs(Math.round(diff))}`}<span class="rd-go" aria-hidden="true"> ›</span></span>
          </a>
        );
      })}
    </div>
  );
}
