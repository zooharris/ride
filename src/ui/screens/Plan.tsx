import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { setCurrentEquipment } from '../store';

import { assess, LIMITER_LABEL, type Evidence, type PowerCurve } from '../../engine/assessment';
import { applyPlan, buildPlan, cancelPlan, getActivePlan, isPlanSession, markChecked, replan, type ActivePlan } from '../planService';
import { changeKey, type Replan } from '../../engine/adapt';
import type { Availability, Plan as GeneratedPlan } from '../../engine/planner';
import type { Goal, EventType } from '../../engine/goals';
import { hoursText } from '../../engine/goals';
import { addDays, today } from '../../engine/load';
import { clock } from '../../engine/workout';
import { getSetting, setSetting } from '../../data/db';
import { fmtDate } from '../derived';
import { WorkoutProfile } from '../Profile';
import { go } from '../router';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Equipment, Fitness, SessionKind } from '../../engine/types';
import { KIND_ICON } from '../icons';
import { FORM_BANDS, LineChart } from '../LineChart';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVENT_TYPES: Array<[EventType, string]> = [
  ['century', 'Century or long endurance ride'], ['gran-fondo', 'Gran fondo or hard sportive'], ['climbing', 'Climbing event'],
  ['time-trial', 'Time trial'], ['group-ride', 'Fast group ride or race'], ['multi-day', 'Multi-day tour'], ['other', 'Something else'],
];

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
  const [msg] = useState<string | null>(null);
  const [curve, setCurve] = useState<PowerCurve | undefined>(undefined);
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [check, setCheck] = useState<Replan | null>(null);

  useEffect(() => {
    getSetting<Saved | null>('planRequest', null).then((s) => { if (s && s.availability.equipment) { setGoal(s.goal); setAv(s.availability); setMasters(s.masters); } });
    getSetting<{ curve: PowerCurve } | null>('powerCurve', null).then((c) => setCurve(c?.curve));
    getActivePlan().then(setActive);
  }, []);

  const assessment = useMemo(() => assess({ today: today(), profile, rides: data.rides, wellness: data.wellness, planned: data.planned, powerCurve: curve }), [data.rides, data.wellness, data.planned, curve, profile]);

  async function build() {
    const p = await buildPlan(data, goal, av, masters);
    setPlan(p);
    setOpenWeek(1);
    setSetting('planRequest', { goal, availability: av, masters } as Saved);
    setCurrentEquipment(av.equipment);
    setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function apply() {
    if (!plan) return;
    const future = data.planned.filter((p) => p.date >= today() && p.status !== 'completed' && isPlanSession(p, data));
    if (future.length && !confirm(`Sessions the current plan put on the calendar from today onward are replaced where the new plan differs. Anything you added by hand stays. Continue?`)) return;
    setBusy(true);
    try {
      await applyPlan(data, plan, goal, av, masters);
      go('calendar');
    } finally { setBusy(false); }
  }

  async function recheck() {
    setBusy(true);
    try { setCheck(await replan(data)); await markChecked(); } finally { setBusy(false); }
  }

  async function cancel() {
    const pending = data.planned.filter((p) => p.date >= today() && p.status !== 'completed' && isPlanSession(p, data)).length;
    if (!confirm(`Cancel this plan? ${pending} planned session${pending === 1 ? '' : 's'} from today onward will be removed from the calendar, from Intervals.icu and from your Garmin. Sessions already done, and anything you added by hand, are kept.`)) return;
    setBusy(true);
    try { await cancelPlan(data); setActive(null); setCheck(null); setPlan(null); } finally { setBusy(false); }
  }

  async function applyCheck(accepted: Set<string>) {
    if (!check || !active) return;
    setBusy(true);
    try { await applyPlan(data, check.plan, active.goal, active.availability, active.masters, accepted); setCheck(null); go('calendar'); } finally { setBusy(false); }
  }

  const DEFAULT_AV: Availability = { hours: [3, 0.5, 1, 0.5, 1, 0, 3], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] };
  async function resetForm() {
    if (!confirm('Reset the goal and your week to what was last saved?')) return;
    const saved = await getSetting<Saved | null>('planRequest', null);
    if (saved && saved.availability.equipment) { setGoal(saved.goal); setAv(saved.availability); setMasters(saved.masters); }
    else { setGoal(DEFAULT_GOAL); setAv(DEFAULT_AV); setMasters(profile.masters); }
    setPlan(null);
  }
  const setHours = (i: number, v: number) => setAv({ ...av, hours: av.hours.map((h, k) => (k === i ? v : h)) });
  const toggleEquipment = (q: Equipment) => setAv({ ...av, equipment: av.equipment.includes(q) ? av.equipment.filter((e) => e !== q) : [...av.equipment, q] });
  const setPin = (dow: number, kind: SessionKind | 'rest' | '') => setAv({ ...av, pins: [...(av.pins ?? []).filter((p) => p.dow !== dow), ...(kind ? [{ dow, kind }] : [])] });
  const totalHours = av.hours.reduce((s, h) => s + (h || 0), 0);
  const imperial = profile.units === 'imperial';

  return (
    <div>
      <div class="page-head"><h1>Plan my training</h1><span class="muted small">Fitness today {assessment.fitness.ctl.toFixed(0)}</span></div>

      {active && (
        <section class="panel accent" style="margin-bottom:22px">
          <div class="row between">
            <div>
              <b>{active.goal.kind === 'event' ? active.goal.name || 'Event' : GOAL_LABEL[active.goal.kind]}</b>
              <div class="muted small">{active.goal.kind === 'event' ? `${fmtDate(active.goal.date, { month: 'long', day: 'numeric' })} · ` : ''}on the calendar since {fmtDate(active.start, { month: 'short', day: 'numeric' })}{active.requiredCtl ? ` · goal wants fitness ${active.requiredCtl}` : ''}</div>
            </div>
            <div class="row" style="gap:6px">
              <button class="btn sm" onClick={recheck} disabled={busy}>{busy ? 'Checking…' : 'Re-check the plan'}</button>
              <button class="btn sm quiet" onClick={cancel} disabled={busy}>Cancel plan</button>
            </div>
          </div>
          {check && <ReplanView check={check} onApply={applyCheck} busy={busy} />}
        </section>
      )}

      <section>
        <h2>What your data say</h2>
        <p class="faint small" style="margin:4px 0 10px">The plan is built on these. Grey dots are guesses with no data behind them yet; they firm up as rides and wellness come in.</p>
        <div class="stack" style="gap:5px">
          {([assessment.weeklyHours, assessment.longestRide, assessment.decoupling, assessment.efficiencyTrend, assessment.powerProfile, assessment.ftpStatus, assessment.afterStrength, assessment.afterLongRide, assessment.afterHardRide, assessment.compliance, assessment.rampRate] as Evidence<unknown>[]).map((e, i) => (
            <div class="row" key={i} style="align-items:flex-start;gap:10px">
              <span class="dot" style={`margin-top:7px;width:8px;height:8px;border-radius:50%;flex:0 0 8px;background:${e.confidence === 'good' ? 'var(--good)' : e.confidence === 'thin' ? 'var(--warn)' : 'var(--ink-3)'}`} />
              <span class="small muted">{e.note}</span>
            </div>
          ))}
        </div>
        <p class="small" style="margin-top:10px">Limiter to work on first: <b>{LIMITER_LABEL[assessment.limiters[0]]}</b>{assessment.limiters[1] ? <span class="muted">, then {LIMITER_LABEL[assessment.limiters[1]]}</span> : null}.</p>
      </section>

      <section class="section">
        <h2>Goal</h2>
        <div class="form" style="margin-top:10px">
          <div class="field"><label>What you are training for</label>
            <select value={goal.kind} onChange={(e) => {
              const k = (e.target as HTMLSelectElement).value as Goal['kind'];
              setGoal(k === 'event' ? { kind: 'event', date: addDays(today(), 84), name: '', eventType: 'century', priority: 'A' }
                : k === 'ftp' ? { kind: 'ftp', weeks: 12, targetWatts: Math.round(profile.ftp * 1.06) }
                : k === 'endurance' ? { kind: 'endurance', weeks: 12, targetHours: 4 }
                : { kind: k, weeks: 12 } as Goal);
            }}>
              <option value="event">An event on a date</option>
              <option value="ftp">Raise FTP</option>
              <option value="vo2max">Raise VO2max</option>
              <option value="endurance">Ride longer comfortably</option>
              <option value="weight">Lose weight</option>
              <option value="general">General fitness</option>
            </select>
          </div>
          {goal.kind === 'event' && (
            <>
              <div class="field"><label>Event name</label><input value={goal.name} placeholder="Seagull Century" onInput={(e) => setGoal({ ...goal, name: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>Date</label><input type="date" min={addDays(today(), 28)} value={goal.date} onInput={(e) => setGoal({ ...goal, date: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>Kind of event</label>
                <select value={goal.eventType} onChange={(e) => setGoal({ ...goal, eventType: (e.target as HTMLSelectElement).value as EventType })}>{EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div class="field"><label>Distance ({imperial ? 'miles' : 'km'})</label>
                <input type="number" value={goal.distanceKm != null ? Math.round(imperial ? goal.distanceKm / 1.609 : goal.distanceKm) : ''} placeholder={imperial ? '100' : '160'} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setGoal({ ...goal, distanceKm: v ? (imperial ? v * 1.609 : v) : undefined }); }} /></div>
              <div class="field"><label>Climbing ({imperial ? 'feet' : 'metres'})</label>
                <input type="number" value={goal.climbingM != null ? Math.round(imperial ? goal.climbingM * 3.281 : goal.climbingM) : ''} placeholder="optional" onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setGoal({ ...goal, climbingM: v ? (imperial ? v / 3.281 : v) : undefined }); }} /></div>
              <div class="field"><label>Priority</label>
                <div class="seg">{(['A', 'B', 'C'] as const).map((p) => <button key={p} class={goal.priority === p ? 'on' : ''} onClick={() => setGoal({ ...goal, priority: p })}>{p}</button>)}</div></div>
            </>
          )}
          {goal.kind !== 'event' && (
            <div class="field"><label>Weeks</label><input type="number" min="4" max="24" value={goal.weeks} onInput={(e) => setGoal({ ...goal, weeks: Number((e.target as HTMLInputElement).value) || 8 })} /></div>
          )}
          {goal.kind === 'ftp' && (
            <div class="field"><label>Target FTP (watts, now {profile.ftp})</label><input type="number" value={goal.targetWatts} onInput={(e) => setGoal({ ...goal, targetWatts: Number((e.target as HTMLInputElement).value) || profile.ftp })} /></div>
          )}
          {goal.kind === 'endurance' && (
            <div class="field"><label>Ride this long comfortably (hours)</label><input type="number" step="0.5" value={goal.targetHours} onInput={(e) => setGoal({ ...goal, targetHours: Number((e.target as HTMLInputElement).value) || 3 })} /></div>
          )}
        </div>
      </section>

      <section class="section">
        <h2>Your week</h2>
        <p class="faint small" style="margin:4px 0 10px">For each day: how much time you have, where you can ride, and whether the day is already spoken for. Leave the commitment on "App decides" unless a day really is fixed (a class, a friend you lift with, a day you always rest): the app chooses ride, strength, walk, mobility or rest for every other day. {totalHours ? `${hoursText(totalHours)} a week in total.` : ''}</p>
        <div class="week-table">
          <div class="week-head"><span>Day</span><span>Hours</span><span title="Outdoors: the ride can be shaped for the road or trail. Indoors: trainer-shaped. No bike: no ride that day; strength, a walk or mobility can still go there.">Where you can ride</span><span title="A standing commitment the plan must keep. Everything else is the app's choice.">Commitment</span></div>
          {DAYS.map((d, i) => {
            const where: 'out' | 'in' | 'none' = av.noBike?.[i] ? 'none' : av.outdoor[i] ? 'out' : 'in';
            const setWhere = (w: 'out' | 'in' | 'none') => setAv({ ...av, outdoor: [0, 1, 2, 3, 4, 5, 6].map((k) => (k === i ? w === 'out' : !!av.outdoor[k])), noBike: [0, 1, 2, 3, 4, 5, 6].map((k) => (k === i ? w === 'none' : !!av.noBike?.[k])) });
            const pin = (av.pins ?? []).find((p) => p.dow === i)?.kind ?? '';
            return (
              <div class="week-row" key={d}>
                <span class="small"><b>{d}</b></span>
                <input type="number" min="0" max="12" step="0.25" value={av.hours[i] || ''} placeholder="0" inputMode="decimal" onInput={(e) => setHours(i, Number((e.target as HTMLInputElement).value) || 0)} style="padding:8px 6px;text-align:center" aria-label={`Hours on ${d}`} />
                <div class="seg">
                  <button class={where === 'out' ? 'on' : ''} onClick={() => setWhere('out')} title="Rides on this day are shaped for outdoors">Outdoors</button>
                  <button class={where === 'in' ? 'on' : ''} onClick={() => setWhere('in')} title="Rides on this day are shaped for the trainer">Indoors</button>
                  <button class={where === 'none' ? 'on' : ''} onClick={() => setWhere('none')} title="No ride this day; strength, a walk or mobility can still be placed">No bike</button>
                </div>
                <select value={pin} onChange={(e) => setPin(i, (e.target as HTMLSelectElement).value as SessionKind | 'rest' | '')} style="min-height:36px;padding:4px 8px" aria-label={`Commitment on ${d}`}>
                  <option value="">App decides</option><option value="ride">Always a ride</option><option value="strength">Always strength</option><option value="walk">Always a walk</option><option value="mobility">Always mobility</option><option value="rest">Always rest</option>
                </select>
              </div>
            );
          })}
        </div>
        <div class="field" style="margin-top:14px"><label>What you have</label>
          <div class="chips">
            {([['dumbbells', 'Dumbbells'], ['bench', 'Bench'], ['band', 'Bands'], ['bodyweight', 'Bodyweight only'], ['trainer', 'Indoor trainer'], ['treadmill', 'Treadmill'], ['outdoor-walk', 'Somewhere to walk']] as Array<[Equipment, string]>).map(([q, l]) => (
              <button key={q} class={`chip${av.equipment.includes(q) ? ' on' : ''}`} onClick={() => toggleEquipment(q)}>{l}</button>
            ))}
          </div>
        </div>
        <div class="row wrap" style="margin-top:14px;gap:18px">
          <div class="field"><label>Recovery rhythm</label>
            <div class="seg"><button class={masters ? 'on' : ''} onClick={() => setMasters(true)}>Masters (more recovery)</button><button class={!masters ? 'on' : ''} onClick={() => setMasters(false)}>Standard</button></div></div>
          <span class="faint small" style="align-self:flex-end;padding-bottom:10px">Targets in {profile.basis === 'power' ? 'power' : 'heart rate'} (change in Settings).</span>
        </div>
      </section>

      <div class="row" style="margin-top:20px;gap:8px">
        <button class="btn primary" style="flex:1" onClick={build} disabled={totalHours < 2 || (goal.kind === 'event' && !goal.date)}>Plan my training</button>
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
            <h2>Fitness projection</h2>
            <Projection series={plan.projection} required={plan.requiredCtl} taperStart={plan.weeks.find((w) => w.phase === 'taper')?.start} goalDate={plan.goalDate} />
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

          <div class="row" style="margin-top:20px;gap:8px">
            <button class="btn primary" style="flex:1" onClick={apply} disabled={busy}>{busy ? 'Placing…' : 'Put this plan on the calendar'}</button>
            <button class="btn quiet" onClick={() => { setPlan(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Discard</button>
          </div>
          {msg && <p class="msg ok" style="margin-top:10px">{msg}</p>}
          <p class="faint small" style="margin-top:10px">Rides already on the calendar from this week on are replaced. Completed rides are kept. The plan is re-checked as rides and wellness arrive.</p>
        </div>
      )}
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
        {required > 0 && ' The dashed amber line is the fitness the goal asks for.'}
      </p>
      <LineChart
        series={[
          { name: 'fitness', color: 'var(--z2)', values: series.map((f) => Math.round(f.ctl)), width: 2.2, explain: '42-day weighted average of daily training load' },
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
      <p class="faint small" style="margin-top:8px">Starts at fitness {Math.round(first.ctl)} today; reaches {Math.round(ti > 0 ? series[ti].ctl : last.ctl)}{ti > 0 ? ' when the taper starts' : ` by ${fmt(goalDate)}`}, with form {last.tsb > 0 ? '+' : ''}{Math.round(last.tsb)} on {fmt(last.date)}. Hover the chart for any day.</p>
    </div>
  );
}

export const KIND_LABEL: Record<SessionKind, string> = { ride: 'Ride', strength: 'Strength', mobility: 'Mobility', walk: 'Walk', other: 'Other' };
export const KIND_COLOR: Record<SessionKind, string> = { ride: 'var(--z2)', strength: 'var(--strength)', mobility: 'var(--z3)', walk: 'var(--z4)', other: 'var(--z1)' };

export function KindDot({ kind, big = false }: { kind: SessionKind; big?: boolean }) {
  const I = KIND_ICON[kind];
  const w = big ? 54 : 30, h = big ? 28 : 16;
  return <div class="kind-tile" style={`width:${w}px;height:${h}px;flex:0 0 ${w}px;background:color-mix(in srgb, ${KIND_COLOR[kind]} 18%, transparent);color:${KIND_COLOR[kind]}`}><I size={big ? 16 : 11} /></div>;
}

const GOAL_LABEL: Record<string, string> = { ftp: 'Raise FTP', vo2max: 'Raise VO2max', endurance: 'Ride longer', weight: 'Lose weight', general: 'General fitness' };

export function ReplanView({ check, onApply, busy }: { check: Replan; onApply: (accepted: Set<string>) => void; busy: boolean }) {
  const r = check.review;
  // Each change is a tick box. Changes to sessions the plan made are on by default; changes to anything the rider edited are off.
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(check.changes.filter((c) => !c.userEdited).map(changeKey)));
  useEffect(() => { setAccepted(new Set(check.changes.filter((c) => !c.userEdited).map(changeKey))); }, [check]);
  const toggle = (k: string) => setAccepted((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const edited = check.changes.filter((c) => c.userEdited).length;
  return (
    <div style="margin-top:12px">
      <div class="small"><b>Last week:</b> {r.completed} of {r.planned} done{r.missed ? `, ${r.missed} missed` : ''}.</div>
      {r.lines.map((l, i) => <div class="muted small" key={i} style="margin-top:3px">{l}</div>)}
      <div class="hr" />
      <div class="small"><b>What the re-check says</b></div>
      {check.summary.map((l, i) => <div class="muted small" key={i} style="margin-top:3px">{l}</div>)}
      {check.changes.length > 0 && (
        <div class="stack" style="margin-top:10px;gap:4px">
          {check.changes.slice(0, 14).map((c, i) => {
            const k = changeKey(c);
            return (
              <label class="small row" key={i} style="gap:8px;align-items:flex-start;cursor:pointer">
                <input type="checkbox" checked={accepted.has(k)} onChange={() => toggle(k)} style="margin-top:3px" />
                <span><span class="faint">{fmtDate(c.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span> · {c.note === 'added' ? <span><span style="color:var(--good)">+</span> {c.after}</span> : c.note === 'removed' ? <span><span style="color:var(--bad)">−</span> {c.before}</span> : <span>{c.before} <span class="faint">→</span> {c.after}</span>}{c.userEdited && <span class="faint"> · you changed this; a suggestion only</span>}</span>
              </label>
            );
          })}
          {check.changes.length > 14 && <div class="faint small">and {check.changes.length - 14} more</div>}
          {edited > 0 && <div class="faint small" style="margin-top:4px">Untick anything you want left as it is. Suggestions for sessions you changed yourself start unticked.</div>}
        </div>
      )}
      <div class="row" style="margin-top:12px">
        {check.changes.length > 0 ? <button class="btn primary sm" onClick={() => onApply(accepted)} disabled={busy || accepted.size === 0}>Apply {accepted.size === check.changes.length ? 'these changes' : accepted.size === 1 ? '1 change' : `${accepted.size} changes`}</button> : <span class="muted small">Nothing to change.</span>}
      </div>
    </div>
  );
}

function verdictColor(v: string) { return { 'on-track': 'var(--good)', close: 'var(--warn)', short: 'var(--bad)' }[v] ?? 'var(--line-2)'; }
function verdictLabel(v: string) { return { 'on-track': 'On track', close: 'Close', short: 'Short of the goal', 'no-target': 'No single number to hit' }[v] ?? v; }
