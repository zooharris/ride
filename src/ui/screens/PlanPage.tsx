import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, sessionHref, setCurrentEquipment } from '../store';
import { applyPlan, buildPlan, cancelPlan, changeSig, freshData, getActivePlan, getPlans, plannedTss, putPlan, rejectChanges, renamePlan, replan, type ActivePlan, type PlanWeekSummary } from '../planService';
import { changeKey, diffPlan, type Change, type Replan } from '../../engine/adapt';
import type { Availability, AwayRange, Plan as GeneratedPlan } from '../../engine/planner';
import type { Goal } from '../../engine/goals';
import type { PlannedWorkout, Workout } from '../../engine/types';
import { addDays, today } from '../../engine/load';
import { fitnessFromRides, fitnessOn, fmtDate, weekStart } from '../derived';
import { PlanTimeline } from '../Glance';
import { FitnessChart } from '../FitnessChart';
import { StatusMark, StatusPill, statusOf } from '../StatusMark';
import { Empty, PageHead } from '../PageHead';
import { go } from '../router';
import { toast } from '../Toast';
import { KIND_LABEL, KindDot, ReplanView } from './Plan';
import { AwayFields, GOAL_KIND_LABEL, GoalFields, WeekFields } from '../PlanForm';
import { NameSheet } from '../NameSheet';

const statusOfPlan = (p: ActivePlan) => { const t = today(); return p.goalDate < t ? 'finished' : p.start > t ? 'upcoming' : 'current'; };
const goalLine = (p: ActivePlan) => p.goal.kind === 'event' ? `${p.goal.name || 'Event'} on ${fmtDate(p.goal.date, { month: 'long', day: 'numeric' })}` : GOAL_KIND_LABEL[p.goal.kind];
const range = (r: AwayRange) => r.from === r.to ? fmtDate(r.from, { month: 'short', day: 'numeric' }) : `${fmtDate(r.from, { month: 'short', day: 'numeric' })} to ${fmtDate(r.to, { month: 'short', day: 'numeric' })}`;

/** One plan, opened: its shape, how fitness is tracking, every week's sessions, and the actions. */
export function PlanPage({ data, id, editing }: { data: AppData; id: string; editing: boolean }) {
  const [plan, setPlan] = useState<ActivePlan | null | undefined>(undefined);
  const [isActive, setIsActive] = useState(false);
  const [check, setCheck] = useState<Replan | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);

  async function load() {
    const plans = await getPlans();
    const p = plans.find((x) => x.id === id) ?? null;
    setPlan(p);
    const a = await getActivePlan();
    const act = !!p && a?.id === p.id;
    setIsActive(act);
    setCheck(act && p && p.start <= today() && data.rides.length ? await replan(data) : null);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id, data]);

  if (plan === undefined) return null;
  if (!plan) return <Empty title="That plan is not here." action={<a class="btn sm" href="#/plan">Your plans</a>}>It may have been cancelled, or this device has not synced it yet.</Empty>;
  if (editing) return <EditPlan data={data} plan={plan} />;

  const sessions = data.planned.filter((p) => p.planId === plan.id).sort((a, b) => a.date.localeCompare(b.date));
  const weeks = weeksOf(plan, sessions, data.mine);
  const status = statusOfPlan(plan);
  const series = fitnessFromRides(data.rides);
  const now = fitnessOn(series, today())?.ctl;
  const expected = plan.projection.find((f) => f.date === today())?.ctl;
  const projection = plan.projection.filter((f) => f.date >= today());

  async function rename(n: string) {
    await renamePlan(plan!.id, n);
    await load();
  }
  async function cancel() {
    const pending = sessions.filter((x) => x.date >= today() && x.status !== 'completed').length;
    if (!confirm(`Cancel “${plan!.name}”? ${pending} planned session${pending === 1 ? '' : 's'} from today onward will be removed from the calendar, from Intervals.icu and from your Garmin. Sessions already done, and anything you added by hand, are kept.`)) return;
    setBusy(true);
    try { await cancelPlan(data, plan!.id); go('plan'); } finally { setBusy(false); }
  }
  async function accept(changes: Change[]) {
    if (!check) return;
    setBusy(true);
    try {
      await applyPlan(data, check.plan, plan!.goal, plan!.availability, plan!.masters, new Set(changes.map(changeKey)), { planId: plan!.id });
      setCheck(await replan(await freshData(data)));
      toast({ ok: true, text: changes.length === 1 ? 'Change made on the calendar.' : `${changes.length} changes made on the calendar.` });
    } finally { setBusy(false); }
  }
  async function reject(changes: Change[]) {
    if (!check) return;
    await rejectChanges(changes);
    const gone = new Set(changes.map(changeSig));
    setCheck({ ...check, changes: check.changes.filter((c) => !gone.has(changeSig(c))) });
  }

  const thisWeek = weekStart(today());
  return (
    <div>
      <PageHead back={{ label: 'Plans', href: '#/plan' }} eyebrow={`${status} · ${goalLine(plan)} · ${fmtDate(plan.start, { month: 'short', day: 'numeric' })} to ${fmtDate(plan.goalDate, { month: 'short', day: 'numeric', year: 'numeric' })}`} title={plan.name} />
      <div class="row wrap" style="gap:8px;margin-top:-4px">
        {status !== 'finished' && <a class="btn primary sm" href={`#/plan/${plan.id}/edit`}>Edit plan</a>}
        <button class="btn sm quiet" onClick={() => setRenaming(true)}>Rename</button>
        <a class="btn sm quiet" href={`#/print/${plan.id}`}>Print</a>
        {status !== 'finished' && <button class="btn sm quiet" onClick={cancel} disabled={busy}>Cancel plan</button>}
      </div>

      {plan.away && plan.away.length > 0 && (
        <p class="muted small" style="margin-top:12px">Away: {plan.away.map((r) => `${range(r)}${r.note ? ` (${r.note})` : ''}`).join('; ')}.</p>
      )}

      {isActive && check && check.changes.length > 0 && (
        <section class="panel" style="margin-top:14px;padding:12px 16px">
          <div class="row between wrap" style="gap:8px">
            <span class="small"><b>{check.changes.length === 1 ? '1 suggested change' : `${check.changes.length} suggested changes`}</b> <span class="muted">from today's re-check.</span></span>
            <button class="btn sm" aria-expanded={showSuggestions} onClick={() => setShowSuggestions(!showSuggestions)}>{showSuggestions ? 'Hide' : 'Review'}</button>
          </div>
          {showSuggestions && <ReplanView check={check} onAccept={accept} onReject={reject} busy={busy} />}
        </section>
      )}

      {weeks.length > 0 && (
        <section class="section">
          <h2 style="margin-bottom:12px">Weekly load</h2>
          <div class="panel">
            <PlanTimeline weeks={weeks} goalDate={plan.goalDate} event={plan.goal.kind === 'event' ? (plan.goal.name || 'Event') : undefined} bars />
            <p class="faint small" style="margin-top:6px">Planned training load for each week as it stands on your calendar now, coloured by phase. Tap or hover over a week for its name and load.</p>
          </div>
        </section>
      )}

      <section class="section">
        <h2 style="margin-bottom:12px">Fitness</h2>
        <div class="panel">
          <FitnessChart series={series} projection={projection} events={plan.goal.kind === 'event' ? [{ date: plan.goalDate, label: 'event' }] : []} />
          <p class="faint small" style="margin-top:6px">
            {now != null && expected != null ? `Fitness today ${Math.round(now)}; the plan expected about ${Math.round(expected)} by now. ` : now != null ? `Fitness today ${Math.round(now)}. ` : ''}
            {projection.length ? 'The dashed line is where the plan, as built, takes it.' : 'No fitness forecast is saved for this plan; editing it, or the next re-check you accept, adds one.'}
          </p>
        </div>
      </section>

      <section class="section">
        <h2>Week by week</h2>
        <div class="stack" style="margin-top:10px;gap:10px">
          {weeks.map((w) => {
            const ws = sessions.filter((s) => weekStart(s.date) === w.start);
            const away = (plan.away ?? []).some((r) => r.from <= addDays(w.start, 6) && r.to >= w.start);
            return (
              <details class="panel" key={w.start} open={w.start === thisWeek || w.start === addDays(thisWeek, 7)} style="padding:10px 14px">
                <summary class="row between" style="cursor:pointer;gap:8px">
                  <span class="small"><b>Week of {fmtDate(w.start, { month: 'short', day: 'numeric' })}</b> <span class="muted">· {w.label || w.phase}{away ? ' · away part of the week' : ''}</span></span>
                  <span class="faint small">{ws.length} session{ws.length === 1 ? '' : 's'} · {w.tss} TSS</span>
                </summary>
                <div class="stack" style="gap:6px;margin-top:10px">
                  {ws.length === 0 && <span class="faint small">Nothing planned this week.</span>}
                  {ws.map((p) => {
                    const wk = findWorkout(data.mine, p.workoutId);
                    if (!wk) return null;
                    return (
                      <a class={`cal-item ${p.status}`} key={p.id} href={sessionHref(p, wk.id, 'calendar', p.date, data.rides)}>
                        <StatusMark status={statusOf(p.status)} />
                        <KindDot kind={wk.kind} big />
                        <div class="t"><b>{wk.name}</b><span>{fmtDate(p.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {KIND_LABEL[wk.kind]}{wk.purpose ? ` · ${wk.purpose}` : ''}</span></div>
                        <StatusPill status={statusOf(p.status)} />
                      </a>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </section>
      {renaming && <NameSheet title="Rename the plan" label="Plan name" initial={plan.name} onSave={rename} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** The plan's weeks with each week's load as it stands on the calendar now (moves and swaps included). */
function weeksOf(plan: ActivePlan, sessions: PlannedWorkout[], mine: Workout[]): PlanWeekSummary[] {
  const load = new Map<string, number>();
  const label = new Map<string, string>();
  for (const s of sessions) {
    const ws = weekStart(s.date);
    const w = findWorkout(mine, s.workoutId);
    load.set(ws, (load.get(ws) ?? 0) + (w ? plannedTss(w) : 0));
    if (s.note && !label.has(ws)) label.set(ws, s.note);
  }
  const stored = new Map((plan.weeks ?? []).map((w) => [weekStart(w.start), w]));
  const starts = [...new Set([...stored.keys(), ...load.keys()])].sort();
  return starts.map((ws) => {
    const st = stored.get(ws);
    const lab = st?.label || label.get(ws) || '';
    const phase = st?.phase ?? ((['recovery', 'taper', 'peak', 'build', 'base'] as const).find((ph) => lab.toLowerCase().startsWith(ph)) ?? 'base');
    return { start: ws, phase, label: lab, tss: Math.round(load.get(ws) ?? 0) };
  });
}

/**
 * Change a plan already on the calendar: the week, time away, dates and target.
 * Preview lists every session that would change; Save applies the ticked ones
 * and keeps the new settings (unticked ones are declined, so the daily re-check
 * does not bring them back). Only sessions still to come are touched.
 */
function EditPlan({ data, plan }: { data: AppData; plan: ActivePlan }) {
  const profile = data.profile!;
  const [goal, setGoal] = useState<Goal>(plan.goal);
  const [av, setAv] = useState<Availability>(plan.availability);
  const [masters, setMasters] = useState(plan.masters);
  const [away, setAway] = useState<AwayRange[]>(plan.away ?? []);
  const [endDate, setEndDate] = useState(plan.goalDate);
  const upcoming = plan.start > today();
  const [startDate, setStartDate] = useState(plan.start);
  const [preview, setPreview] = useState<{ plan: GeneratedPlan; changes: Change[] } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Any edit makes an earlier preview stale.
  useEffect(() => { setPreview(null); }, [goal, av, masters, away, endDate, startDate]);

  const workouts = useMemo(() => new Map(data.mine.map((w) => [w.id, w])), [data.mine]);
  const mine = data.planned.filter((p) => !p.planId || p.planId === plan.id);

  async function makePreview() {
    setBusy(true);
    try {
      const built = await buildPlan(data, goal, av, masters, upcoming ? startDate : plan.start, goal.kind === 'event' ? undefined : endDate, away);
      const changes = diffPlan(mine, workouts, built, undefined, { includeEdited: true });
      setPreview({ plan: built, changes });
      setTicked(new Set(changes.filter((c) => !c.userEdited).map(sig)));
    } finally { setBusy(false); }
  }

  const sig = (c: Change) => changeSig(c);
  const onGarmin = preview ? preview.changes.filter((c) => ticked.has(sig(c)) && mine.some((p) => p.date === c.date && p.icuEventId && p.status !== 'completed' && findWorkout(data.mine, p.workoutId)?.kind === c.kind)).length : 0;

  async function save() {
    if (!preview) return;
    setBusy(true);
    try {
      const accepted = preview.changes.filter((c) => ticked.has(sig(c)));
      const declined = preview.changes.filter((c) => !ticked.has(sig(c)));
      await applyPlan(data, preview.plan, goal, av, masters, new Set(accepted.map(changeKey)), { planId: plan.id, away });
      // The settings are kept whatever was ticked, so tomorrow's re-check works from them.
      const saved = (await getPlans()).find((p) => p.id === plan.id);
      if (saved) await putPlan({ ...saved, goal, availability: av, masters, away, start: upcoming ? (preview.plan.weeks[0]?.sessions[0]?.date ?? startDate) : saved.start, goalDate: preview.plan.goalDate, projection: preview.plan.projection, requiredCtl: preview.plan.requiredCtl });
      if (declined.length) await rejectChanges(declined);
      setCurrentEquipment(av.equipment);   // the Library builds sessions for this equipment
      toast({ ok: true, text: accepted.length ? `Plan saved; ${accepted.length} change${accepted.length === 1 ? '' : 's'} made on the calendar.` : 'Plan settings saved; the calendar is unchanged.' });
      go(`plan/${plan.id}`);
    } finally { setBusy(false); }
  }

  const line = (c: Change) => c.note === 'added' ? <span><span style="color:var(--good)">+</span> {c.after}</span> : c.note === 'removed' ? <span><span style="color:var(--bad)">−</span> {c.before}</span> : <span>{c.before} <span class="faint">→</span> {c.after}</span>;

  return (
    <div>
      <PageHead back={{ label: plan.name, href: `#/plan/${plan.id}` }} eyebrow="Edit plan" title={plan.name} />
      <p class="muted small" style="margin-top:-4px">Change what you need, then Preview. Nothing on the calendar changes until you Save, and only sessions still to come can change: done sessions stay, and anything you added or changed by hand is offered, never replaced unasked.</p>

      <section class="section">
        <h2 style="margin-bottom:12px">Goal and dates</h2>
        <div class="panel"><div class="form">
          {upcoming && <div class="field"><label>Starts on</label><input type="date" value={startDate} min={today()} onInput={(e) => setStartDate((e.target as HTMLInputElement).value || startDate)} /></div>}
          <GoalFields goal={goal} setGoal={setGoal} profile={profile} fixedKind endDate={endDate} setEndDate={setEndDate} />
        </div></div>
      </section>

      <section class="section">
        <h2>Your week</h2>
        <div class="panel" style="margin-top:10px"><WeekFields av={av} setAv={setAv} masters={masters} setMasters={setMasters} profile={profile} /></div>
      </section>

      <section class="section">
        <h2>Time away</h2>
        <p class="faint small" style="margin:4px 0 10px">Nothing is planned on these days; a week mostly away is kept light.</p>
        <div class="panel"><AwayFields away={away} setAway={setAway} /></div>
      </section>

      <div class="row" style="margin-top:20px;gap:8px">
        <button class="btn primary" style="flex:1" onClick={makePreview} disabled={busy || av.hours.reduce((s, h) => s + (h || 0), 0) < 2}>{busy && !preview ? 'Working…' : 'Preview changes'}</button>
        <a class="btn quiet" href={`#/plan/${plan.id}`}>Cancel</a>
      </div>

      {preview && (
        <section class="section" id="edit-preview">
          <h2>What would change</h2>
          <div class="panel" style="margin-top:10px">
            {preview.changes.length === 0 ? <p class="muted small" style="margin:0">No session changes. Saving keeps the new settings for future re-checks.</p> : (
              <div class="stack" style="gap:4px">
                {preview.changes.map((c) => {
                  const k = sig(c);
                  return (
                    <label class="small row" key={k} style="gap:8px;align-items:flex-start;cursor:pointer;padding:4px 0">
                      <input type="checkbox" checked={ticked.has(k)} onChange={() => setTicked((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} style="margin-top:3px" />
                      <span><span class="faint">{fmtDate(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span> · {line(c)}{c.userEdited && <span class="faint"> · {c.userAdded ? 'you added this' : 'you changed this'}</span>}</span>
                    </label>
                  );
                })}
                <div class="row" style="gap:8px;margin-top:6px">
                  <button class="btn sm quiet" onClick={() => setTicked(new Set(preview.changes.map(sig)))}>Tick all</button>
                  <button class="btn sm quiet" onClick={() => setTicked(new Set())}>Untick all</button>
                </div>
                <p class="faint small" style="margin-top:4px">Unticked changes are declined: the daily re-check will not suggest them again. Changes to sessions you added or changed yourself start unticked.</p>
              </div>
            )}
            {onGarmin > 0 && <p class="msg small" style="margin-top:10px">{onGarmin} session{onGarmin === 1 ? ' is' : 's are'} already on your Garmin and will be replaced; send the week again from the calendar afterwards.</p>}
            <div class="row" style="gap:8px;margin-top:12px">
              <button class="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : ticked.size ? `Save plan and make ${ticked.size} change${ticked.size === 1 ? '' : 's'}` : 'Save plan settings'}</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
