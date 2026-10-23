import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { setCurrentEquipment } from '../store';

import { assess, LIMITER_LABEL, type Evidence, type PowerCurve } from '../../engine/assessment';
import { applyPlan, buildPlan, cancelPlan, changeSig, defaultPlanName, freshData, getActivePlan, getPlans, markChecked, overlapping, rejectChanges, renamePlan, replan, type ActivePlan } from '../planService';
import { changeKey, type Change, type Replan } from '../../engine/adapt';
import type { Availability, Plan as GeneratedPlan } from '../../engine/planner';
import type { Goal } from '../../engine/goals';
import { hoursText } from '../../engine/goals';
import { addDays, today } from '../../engine/load';
import { clock } from '../../engine/workout';
import { getSetting, setSetting } from '../../data/db';
import { fmtDate } from '../derived';
import { WorkoutProfile } from '../Profile';
import { go } from '../router';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Fitness, SessionKind } from '../../engine/types';
import { KIND_ICON } from '../icons';
import { FORM_BANDS, LineChart } from '../LineChart';
import { PageHead } from '../PageHead';
import { PlanTimeline } from '../Glance';
import { AwayFields, GoalFields, WeekFields } from '../PlanForm';
import type { AwayRange } from '../../engine/planner';
import { NameSheet } from '../NameSheet';


interface Saved { goal: Goal; availability: Availability; masters: boolean }

const DEFAULT_GOAL: Goal = { kind: 'event', date: addDays(today(), 84), name: '', eventType: 'century', priority: 'A' };

export function Plan({ data }: { data: AppData }) {
  const profile = data.profile!;
  const [goal, setGoal] = useState<Goal>(DEFAULT_GOAL);
  const [av, setAv] = useState<Availability>({ hours: [3, 0.5, 1, 0.5, 1, 0, 3], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] });
  const [masters, setMasters] = useState(profile.masters);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [curve, setCurve] = useState<PowerCurve | undefined>(undefined);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [plans, setPlans] = useState<ActivePlan[]>([]);
  const [check, setCheck] = useState<Replan | null>(null);
  const [name, setName] = useState('');
  // Until the rider types a name, each build fills one in that says what and when.
  const [nameTouched, setNameTouched] = useState(false);
  const [startDate, setStartDate] = useState(today());
  const [away, setAway] = useState<AwayRange[]>([]);
  // With a plan under way the form for a new one stays folded away until asked for.
  const [showForm, setShowForm] = useState(false);
  const [renaming, setRenaming] = useState<ActivePlan | null>(null);
  const refreshPlans = () => getPlans().then((ps) => { setPlans(ps); getActivePlan().then(setActive); });

  useEffect(() => {
    getSetting<Saved | null>('planRequest', null).then((s) => { if (s && s.availability.equipment) { setGoal(s.goal); setAv(s.availability); setMasters(s.masters); } });
    getSetting<{ curve: PowerCurve } | null>('powerCurve', null).then((c) => setCurve(c?.curve));
    refreshPlans();
  }, []);

  const assessment = useMemo(() => assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve }), [data.rides, data.wellness, data.planned, curve, profile]);

  async function build() {
    const p = await buildPlan(data, goal, av, masters, startDate, undefined, away);
    setPlan(p);
    if (!nameTouched) {
      const from = p.weeks[0]?.sessions[0]?.date ?? p.weeks[0]?.start ?? startDate;
      setName(`${defaultPlanName(goal)}, ${fmtDate(from, { month: 'short', day: 'numeric' })} to ${fmtDate(p.goalDate, { month: 'short', day: 'numeric' })}`);
    }
    setOpenWeek(1);
    setSetting('planRequest', { goal, availability: av, masters } as Saved);
    setCurrentEquipment(av.equipment);
    setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  const planStart = plan ? (plan.weeks[0]?.sessions[0]?.date ?? plan.weeks[0]?.start) : startDate;
  const clash = plan ? overlapping(plans, planStart, plan.goalDate) : undefined;
  async function apply() {
    if (!plan || clash) return;
    setBusy(true);
    try {
      await applyPlan(data, plan, goal, av, masters, undefined, { name: name.trim() || defaultPlanName(goal), away });
      go('calendar');
    } finally { setBusy(false); }
  }

  async function recheck() {
    setBusy(true);
    try { setCheck(await replan(data)); await markChecked(); } finally { setBusy(false); }
  }

  async function rename(p: ActivePlan, n: string) {
    await renamePlan(p.id, n);
    await refreshPlans();
  }

  async function cancel(p: ActivePlan) {
    const pending = data.planned.filter((x) => x.date >= today() && x.status !== 'completed' && x.planId === p.id).length;
    if (!confirm(`Cancel “${p.name}”? ${pending} planned session${pending === 1 ? '' : 's'} from today onward will be removed from the calendar, from Intervals.icu and from your Garmin. Sessions already done, and anything you added by hand, are kept.`)) return;
    setBusy(true);
    try { await cancelPlan(data, p.id); setCheck(null); await refreshPlans(); } finally { setBusy(false); }
  }

  async function acceptChanges(changes: Change[]) {
    if (!check || !active) return;
    setBusy(true);
    try {
      await applyPlan(data, check.plan, active.goal, active.availability, active.masters, new Set(changes.map(changeKey)), { planId: active.id });
      setCheck(await replan(await freshData(data)));
    } finally { setBusy(false); }
  }
  async function rejectSuggested(changes: Change[]) {
    if (!check) return;
    await rejectChanges(changes);
    const gone = new Set(changes.map(changeSig));
    setCheck({ ...check, changes: check.changes.filter((c) => !gone.has(changeSig(c))) });
  }

  const DEFAULT_AV: Availability = { hours: [3, 0.5, 1, 0.5, 1, 0, 3], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] };
  async function resetForm() {
    if (!confirm('Reset the goal and your week to what was last saved?')) return;
    const saved = await getSetting<Saved | null>('planRequest', null);
    if (saved && saved.availability.equipment) { setGoal(saved.goal); setAv(saved.availability); setMasters(saved.masters); }
    else { setGoal(DEFAULT_GOAL); setAv(DEFAULT_AV); setMasters(profile.masters); }
    setPlan(null);
  }
  const totalHours = av.hours.reduce((s, h) => s + (h || 0), 0);

  return (
    <div>
      <PageHead eyebrow={`Fitness today ${assessment.fitness.ctl.toFixed(0)}`} title="Plan my training" help="plan" />

      {plans.length > 0 && (
        <section style="margin-bottom:22px">
          <h2 style="margin-bottom:8px">Your plans</h2>
          <div class="stack">
            {plans.map((p) => {
              const t = today();
              const status = p.goalDate < t ? 'finished' : p.start > t ? 'upcoming' : 'current';
              const isActive = active?.id === p.id;
              return (
                <div class={`panel${isActive ? ' accent' : ''}`} key={p.id}>
                  <div class="row between wrap" style="gap:8px">
                    <div>
                      <a class="plain-link" href={`#/plan/${p.id}`}><b>{p.name}</b></a> <span class="faint small">· {status}</span>
                      <div class="muted small">{p.goal.kind === 'event' ? `${p.goal.name || 'Event'} on ${fmtDate(p.goal.date, { month: 'long', day: 'numeric' })} · ` : `${GOAL_LABEL[p.goal.kind]} · `}{fmtDate(p.start, { month: 'short', day: 'numeric' })} to {fmtDate(p.goalDate, { month: 'short', day: 'numeric', year: 'numeric' })}{p.requiredCtl ? ` · goal needs fitness ${p.requiredCtl}` : ''}</div>
                    </div>
                    <div class="row wrap" style="gap:6px">
                      {isActive && status === 'current' && <button class="btn sm" onClick={recheck} disabled={busy}>{busy ? 'Checking…' : 'Re-check the plan'}</button>}
                      <a class="btn sm" href={`#/plan/${p.id}`}>Open</a>
                      <button class="btn sm quiet" onClick={() => setRenaming(p)} disabled={busy}>Rename</button>
                      <a class="btn sm quiet" href={`#/print/${p.id}`}>Print</a>
                      {status !== 'finished' && <button class="btn sm quiet" onClick={() => cancel(p)} disabled={busy}>Cancel plan</button>}
                    </div>
                  </div>
                  {p.weeks && p.weeks.length > 0 && <div style="margin-top:12px"><PlanTimeline weeks={p.weeks} goalDate={p.goalDate} event={p.goal.kind === 'event' ? (p.goal.name || 'Event') : undefined} /></div>}
                  {isActive && check && <ReplanView check={check} onAccept={acceptChanges} onReject={rejectSuggested} busy={busy} />}
                </div>
              );
            })}
          </div>
          <p class="faint small" style="margin-top:8px">Plans follow one another and never overlap. The daily re-check works on the plan that covers today; an upcoming plan is re-checked once it starts.</p>
        </section>
      )}

      <section>
        <h2>What your data say</h2>
        <p class="faint small" style="margin:4px 0 10px">The plan is built on these. Green: well supported by your data; amber: thin evidence; grey: a guess with no data behind it yet. They firm up as rides and wellness come in.</p>
        <div class="panel"><div class="stack" style="gap:6px">
          {([assessment.weeklyHours, assessment.longestRide, assessment.decoupling, assessment.efficiencyTrend, assessment.powerProfile, assessment.ftpStatus, assessment.afterStrength, assessment.afterLongRide, assessment.afterHardRide, assessment.compliance, assessment.rampRate] as Evidence<unknown>[]).map((e, i) => (
            <div class="row" key={i} style="align-items:flex-start;gap:10px">
              <span class="dot" style={`margin-top:7px;width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:${e.confidence === 'good' ? 'var(--good)' : e.confidence === 'thin' ? 'var(--warn)' : 'var(--ink-3)'}`} />
              <span class="small muted">{e.note}</span>
            </div>
          ))}
        </div>
        <p class="small" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">Limiter to work on first: <b>{LIMITER_LABEL[assessment.limiters[0]]}</b>{assessment.limiters[1] ? <span class="muted">, then {LIMITER_LABEL[assessment.limiters[1]]}</span> : null}.</p></div>
      </section>

      {active && !showForm && !plan && (
        <div class="row" style="margin-top:20px">
          <button class="btn" onClick={() => setShowForm(true)}>Build a new plan</button>
        </div>
      )}

      {(!active || showForm || plan) && <>
      <section class="section">
        <h2 style="margin-bottom:12px">{plans.length ? 'New plan' : 'Goal'}</h2>
        <div class="panel"><div class="form">
          <div class="field"><label>Plan name</label><input value={name} placeholder={defaultPlanName(goal)} onInput={(e) => { setName((e.target as HTMLInputElement).value); setNameTouched(true); }} /></div>
          <div class="field"><label>Starts on</label><input type="date" value={startDate} min={today()} onInput={(e) => setStartDate((e.target as HTMLInputElement).value || today())} /></div>
          <GoalFields goal={goal} setGoal={setGoal} profile={profile} />
        </div></div>
      </section>

      <section class="section">
        <h2>Your week</h2>
        <p class="faint small" style="margin:4px 0 10px">For each day: how much time you have, where you can ride, and whether the day is already spoken for. Leave the commitment on "App decides" unless a day really is fixed (a class, a friend you lift with, a day you always rest): the app chooses ride, strength, walk, run, mobility or rest for every other day, within what you let it schedule. {totalHours ? `${hoursText(totalHours)} a week in total.` : ''}</p>
        <div class="panel">
        <WeekFields av={av} setAv={setAv} masters={masters} setMasters={setMasters} profile={profile} />
        </div>
      </section>

      <section class="section">
        <h2>Time away</h2>
        <p class="faint small" style="margin:4px 0 10px">Travel or a busy stretch you already know about. Nothing is planned on those days; a week mostly away is kept light. You can add or change these later from the plan's page.</p>
        <div class="panel"><AwayFields away={away} setAway={setAway} /></div>
      </section>

      <div class="row" style="margin-top:20px;gap:8px">
        <button class="btn primary" style="flex:1" onClick={build} disabled={totalHours < 2 || (goal.kind === 'event' && !goal.date)}>Build the plan</button>
        <button class="btn quiet" onClick={resetForm}>Reset</button>
      </div>

      {plan && (
        <div id="plan-result">
          <section class="section">
            <div class="panel" style={`border-color:${verdictColor(plan.verdict)}`}>
              <b style={`color:${verdictColor(plan.verdict)}`}>{verdictLabel(plan.verdict)}</b>
              <p style="margin-top:6px;font-size:14px;line-height:1.55">{plan.advice}</p>
              <p class="muted small" style="margin-top:8px">{plan.demand.why}</p>
            </div>
          </section>

          <section class="section">
            <h2 style="margin-bottom:12px">Fitness projection</h2>
            <div class="panel">
              <Projection series={plan.projection} required={plan.requiredCtl} taperStart={plan.weeks.find((w) => w.phase === 'taper')?.start} goalDate={plan.goalDate} />
            </div>
          </section>

          <section class="section">
            <h2 style="margin-bottom:12px">Weekly load</h2>
            <div class="panel">
              <PlanTimeline weeks={plan.weeks} goalDate={plan.goalDate} event={goal.kind === 'event' ? (goal.name || 'Event') : undefined} bars />
              <p class="faint small" style="margin-top:6px">Planned training load (TSS) for each week, coloured by phase. Load climbs through each block and drops in the recovery weeks, so fitness can catch up with the work. Tap or hover over a week for its name and load.</p>
            </div>
          </section>

          <section class="section">
            <h2>Why it looks like this</h2>
            <ul class="muted small" style="margin:8px 0 0;padding-left:18px;line-height:1.55">
              {plan.decisions.map((d, i) => <li key={i} style="margin-bottom:6px">{d}</li>)}
            </ul>
          </section>

          <section class="section">
            <h2>Weeks</h2>
            <div class="stack" style="margin-top:8px">
              {plan.weeks.map((w) => (
                <div class="panel" key={w.index} style="padding:10px 12px">
                  <button class="row between" style="width:100%;background:none;border:0;padding:0;cursor:pointer;text-align:left" onClick={() => setOpenWeek(openWeek === w.index ? null : w.index)}>
                    <div>
                      <b>{w.label}</b> <span class="faint small">· {fmtDate(w.start, { month: 'short', day: 'numeric' })}</span>
                      <div class="faint small">{w.sessions.filter((s) => s.kind === 'ride').length} rides, {w.sessions.filter((s) => s.kind === 'strength').length} strength{w.sessions.some((s) => s.kind === 'walk') ? `, ${w.sessions.filter((s) => s.kind === 'walk').length} walk${w.sessions.filter((s) => s.kind === 'walk').length > 1 ? 's' : ''}` : ''} · {w.hours} h · {w.tss} TSS</div>
                    </div>
                    <div class="row" style="gap:4px">
                      {w.sessions.map((s, k) => s.kind === 'ride' ? <div key={k} style="width:30px"><WorkoutProfile blocks={s.workout.blocks} height={16} ratio={1.9} /></div> : <KindDot key={k} kind={s.kind} />)}
                    </div>
                  </button>
                  {openWeek === w.index && (
                    <div style="margin-top:10px">
                      <p class="faint small" style="margin-bottom:8px">{w.note}</p>
                      <div class="stack">
                        {w.sessions.map((s) => (
                          <div class="cal-item" key={s.date + s.kind + s.workout.id} style="cursor:default">
                            {s.kind === 'ride' ? <WorkoutProfile blocks={s.workout.blocks} height={28} ratio={2.2} /> : <KindDot kind={s.kind} big />}
                            <div class="t">
                              <b>{s.workout.name} <span class="faint" style="font-weight:400">· {fmtDate(s.date, { weekday: 'short', day: 'numeric' })}</span></b>
                              <span>{clock(s.seconds)} · {s.tss} TSS · {s.kind === 'ride' ? FAMILY_LABEL[s.workout.family] : KIND_LABEL[s.kind]}</span>
                              <div class="muted small" style="margin-top:4px;white-space:normal;line-height:1.4">{s.reason}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {clash && <p class="msg err" style="margin-top:16px">This plan would run {fmtDate(planStart, { month: 'short', day: 'numeric' })} to {fmtDate(plan.goalDate, { month: 'short', day: 'numeric' })}, which overlaps “{clash.name}” ({fmtDate(clash.start, { month: 'short', day: 'numeric' })} to {fmtDate(clash.goalDate, { month: 'short', day: 'numeric' })}). Plans cannot overlap: start this one after {fmtDate(clash.goalDate, { month: 'short', day: 'numeric' })}, shorten it, or cancel “{clash.name}” above.</p>}
          <p class="small" style="margin:20px 0 0"><b>{name.trim() || defaultPlanName(goal)}</b></p>
          <div class="row" style="margin-top:8px;gap:8px">
            <button class="btn primary" style="flex:1" onClick={apply} disabled={busy || !!clash}>{busy ? 'Placing…' : 'Put it on the calendar'}</button>
            <button class="btn quiet" onClick={() => { setPlan(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Discard</button>
          </div>
          <p class="faint small" style="margin-top:10px">Sessions this plan places go on the calendar from {fmtDate(planStart, { month: 'short', day: 'numeric' })}; anything you added by hand stays. The plan is re-checked as rides and wellness arrive.</p>
        </div>
      )}
      </>}

      {renaming && <NameSheet title="Rename the plan" label="Plan name" initial={renaming.name} onSave={(n) => rename(renaming, n)} onClose={() => setRenaming(null)} />}
    </div>
  );
}

function Projection({ series, required, taperStart, goalDate }: { series: Fitness[]; required: number; taperStart?: string; goalDate: string }) {
  if (series.length < 2) return null;
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const ti = taperStart ? series.findIndex((f) => f.date === taperStart) : -1;
  const markers = [];
  if (ti > 0) markers.push({ index: ti, label: 'taper starts' });
  const last = series[series.length - 1];
  const first = series[0];
  return (
    <div>
      <p class="muted small" style="margin:4px 0 10px;max-width:68ch">
        What your fitness, fatigue and form would do if every session in this plan is done as written, day by day from today to the goal.
        Fitness is the same number as on the Today page: a 42-day weighted average of daily training load (TSS). Fatigue is the 7-day average; form is fitness minus fatigue. Fitness only rises while fatigue sits above it, so form is negative through a build (the shaded "building" band) and comes back up in recovery weeks and the taper; above zero is where you want to be on an event day, not every day.
        {required > 0 && ' The dashed line is the fitness the goal asks for.'}
      </p>
      <LineChart
        series={[
          { name: 'fitness', color: 'var(--info)', values: series.map((f) => Math.round(f.ctl)), width: 2.2, explain: '42-day weighted average of daily training load' },
          { name: 'fatigue', color: 'var(--z5)', values: series.map((f) => Math.round(f.atl)), width: 1.3, explain: '7-day weighted average of daily training load' },
          { name: 'form', color: 'var(--ink-3)', values: series.map((f) => Math.round(f.tsb)), dash: '2 3', width: 1.2, explain: 'fitness minus fatigue; positive means fresh' },
        ]}
        xLabels={series.map((f) => f.date)}
        xTick={(d, i) => (i === 0 || i === series.length - 1 || (i % 14 === 0 && i < series.length - 7)) ? fmt(d) : null}
        yTitle="training load points"
        refLines={required > 0 ? [{ value: required, label: `goal needs ${required}` }] : []}
        markers={markers}
        bands={FORM_BANDS}
        readout={(i) => { const f = series[i]; return `${fmt(f.date)} · fitness ${Math.round(f.ctl)} · fatigue ${Math.round(f.atl)} · form ${f.tsb > 0 ? '+' : ''}${Math.round(f.tsb)}`; }}
      />
      <p class="faint small" style="margin-top:8px">Starts at fitness {Math.round(first.ctl)} today; reaches {Math.round(ti > 0 ? series[ti].ctl : last.ctl)}{ti > 0 ? ' when the taper starts' : ` by ${fmt(goalDate)}`}, with form {last.tsb > 0 ? '+' : ''}{Math.round(last.tsb)} on {fmt(last.date)}. Tap or hover over the chart for any day.</p>
    </div>
  );
}

export const KIND_LABEL: Record<SessionKind, string> = { ride: 'Ride', strength: 'Strength', mobility: 'Mobility', walk: 'Walk', run: 'Run', other: 'Other' };
export const KIND_COLOR: Record<SessionKind, string> = { ride: 'var(--ride)', strength: 'var(--strength)', mobility: 'var(--mobility)', walk: 'var(--walk)', run: 'var(--run)', other: 'var(--z1)' };

export function KindDot({ kind, big = false }: { kind: SessionKind; big?: boolean }) {
  const I = KIND_ICON[kind];
  const w = big ? 54 : 30, h = big ? 28 : 16;
  return <div class="kind-tile" style={`width:${w}px;height:${h}px;flex:0 0 ${w}px;background:color-mix(in srgb, ${KIND_COLOR[kind]} 18%, transparent);color:${KIND_COLOR[kind]}`}><I size={big ? 16 : 11} /></div>;
}

const GOAL_LABEL: Record<string, string> = { ftp: 'Raise FTP', vo2max: 'Raise VO2max', endurance: 'Ride longer', weight: 'Lose weight', general: 'General fitness' };
export const GOAL_LABEL_FULL: Record<string, string> = { ftp: 'Raise FTP', vo2max: 'Raise VO2max', endurance: 'Ride longer comfortably', weight: 'Lose weight', general: 'General fitness' };

/**
 * The plan re-check's suggestions, one row each with Accept and Reject. An
 * accepted change goes on the calendar; a rejected one disappears and is not
 * offered again. Why the re-check suggests them, and how last week went, sit
 * above the list.
 */
export function ReplanView({ check, onAccept, onReject, busy, coachSays, coachVerdict, coachSkip = [] }: { check: Replan; onAccept: (changes: Change[]) => void; onReject: (changes: Change[]) => void; busy: boolean; coachSays?: string; coachVerdict?: 'all' | 'some' | 'none'; coachSkip?: string[] }) {
  // The coach's view of each change, beside it: skip when it said none, or some and named this date.
  const coachOn = (c: Change) => !coachVerdict ? null : coachVerdict === 'none' || (coachVerdict === 'some' && coachSkip.includes(c.date)) ? 'skip' : 'apply';
  const r = check.review;
  const [all, setAll] = useState(false);
  const shown = all ? check.changes : check.changes.slice(0, 6);
  const sub = (t?: string) => (t ? <span class="faint small"> · {t}</span> : null);
  const line = (c: Change) => c.note === 'added' ? <span><span style="color:var(--good)">+</span> {c.after}{sub(c.afterSub)}</span> : c.note === 'removed' ? <span><span style="color:var(--bad)">−</span> {c.before}{sub(c.beforeSub)}</span> : <span>{c.before}{sub(c.beforeSub)} <span class="faint">→</span> {c.after}{sub(c.afterSub)}</span>;
  return (
    <div style="margin-top:12px">
      {(r.planned > 0 || r.lines.length > 0) && <>
        <div class="small"><b>Last week:</b> {r.completed} of {r.planned} done{r.missed ? `, ${r.missed} missed` : ''}.</div>
        {r.lines.map((l, i) => <div class="muted small" key={i} style="margin-top:3px">{l}</div>)}
        <div class="hr" />
      </>}
      <div class="small"><b>Why the re-check suggests changes</b></div>
      {check.summary.map((l, i) => <div class="muted small" key={i} style="margin-top:3px">{l}</div>)}
      {coachSays && <div class="small" style="margin-top:8px"><b>The coach:</b> <span class="muted">{coachSays}</span></div>}
      {check.changes.length > 0 ? (
        <div class="stack" style="margin-top:12px;gap:6px">
          {shown.map((c) => (
            <div class="row between wrap small" key={changeKey(c) + (c.before ?? '') + (c.after ?? '')} style="gap:8px;padding:6px 0;border-top:1px solid var(--line)">
              <span style="flex:1;min-width:200px"><span class="faint">{fmtDate(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span> · {line(c)}{c.userEdited && <span class="faint"> · {c.userAdded ? 'you added this' : 'you changed this'}</span>}{coachOn(c) && <span class="faint"> · coach: {coachOn(c)}</span>}</span>
              <span class="row" style="gap:6px">
                <button class="btn sm" onClick={() => onAccept([c])} disabled={busy}>Accept</button>
                <button class="btn sm quiet" onClick={() => onReject([c])} disabled={busy}>Reject</button>
              </span>
            </div>
          ))}
          {check.changes.length > 6 && <button class="btn sm quiet" style="align-self:flex-start;margin-left:-10px" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${check.changes.length} changes`}</button>}
          {check.changes.length > 1 && (
            <div class="row" style="gap:8px;margin-top:6px">
              <button class="btn primary sm" onClick={() => onAccept(check.changes.filter((c) => !c.userEdited))} disabled={busy}>Accept all {check.changes.length}</button>
              <button class="btn sm quiet" onClick={() => onReject(check.changes)} disabled={busy}>Reject all</button>
            </div>
          )}
        </div>
      ) : <div class="muted small" style="margin-top:8px">Nothing to change.</div>}
    </div>
  );
}

function verdictColor(v: string) { return { 'on-track': 'var(--good)', close: 'var(--warn)', short: 'var(--bad)' }[v] ?? 'var(--line-2)'; }
function verdictLabel(v: string) { return { 'on-track': 'On track', close: 'Close', short: 'Short of the goal', 'no-target': 'No single number to hit' }[v] ?? v; }
