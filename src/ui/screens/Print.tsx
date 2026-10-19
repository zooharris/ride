import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { getPlans, type ActivePlan } from '../planService';
import { addDays, today } from '../../engine/load';
import { workoutStats } from '../../engine/workout';
import { weekStart } from '../derived';
import { APP_NAME } from '../../appName';
import type { PlannedWorkout, SessionKind, Workout } from '../../engine/types';
import { KIND_LABEL } from './Plan';
import { GOAL_LABEL_FULL } from './Plan';

/**
 * A plan on paper: US Letter, landscape, one row per week, one column per
 * day, up to sixteen weeks a page. The page carries its own print rules, so
 * the browser's print dialog (or Save as PDF) gives the same sheet every time.
 */
const WEEKS_PER_PAGE = 16;
const PHASE: Record<string, string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', recovery: 'Recovery' };

export function PrintView({ data, planId, params }: { data: AppData; planId?: string; params: URLSearchParams }) {
  const [plans, setPlans] = useState<ActivePlan[] | null>(null);
  const [layout, setLayout] = useState<'calendar' | 'list'>((params.get('layout') as 'list') === 'list' ? 'list' : 'calendar');
  useEffect(() => { getPlans().then(setPlans); }, []);
  if (!plans) return <div class="main"><div class="empty small">Loading…</div></div>;
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  if (!plan) return <div class="main"><div class="empty">No plan to print. <a href="#/plan">Plan my training</a> first.</div></div>;
  const profile = data.profile!;

  // Every session in the plan's date range, plan-made or added by hand, grouped by week from the plan's first Monday.
  const first = weekStart(plan.start);
  const last = plan.goalDate;
  const sessions = data.planned.filter((p) => p.date >= first && p.date <= last);
  const workoutOf = (p: PlannedWorkout) => findWorkout(data.mine, p.workoutId);
  const weeks: Array<{ index: number; start: string; days: PlannedWorkout[][]; hours: number; tss: number; phase?: string }> = [];
  for (let ws = first, i = 1; ws <= last; ws = addDays(ws, 7), i++) {
    const days = [0, 1, 2, 3, 4, 5, 6].map((k) => sessions.filter((p) => p.date === addDays(ws, k)).sort((a, b) => kindOrder(workoutOf(a)?.kind) - kindOrder(workoutOf(b)?.kind)));
    let secs = 0, tss = 0;
    for (const p of days.flat()) { const w = workoutOf(p); if (!w) continue; const m = minutesOf(w); secs += m * 60; tss += tssOf(w); }
    const phase = days.flat().map((p) => p.note).find((n) => n && /^(Base|Build|Peak|Taper|Recovery)/.test(n));
    weeks.push({ index: i, start: ws, days, hours: Math.round(secs / 360) / 10, tss: Math.round(tss), phase: phase ? phase.split(' ')[0] : undefined });
  }
  // A sixteen-week plan that starts mid-week spans seventeen calendar rows; it still goes on one page, tighter.
  const perPage = weeks.length <= WEEKS_PER_PAGE + 1 ? weeks.length : WEEKS_PER_PAGE;
  const pages: typeof weeks[] = [];
  for (let i = 0; i < weeks.length; i += perPage) pages.push(weeks.slice(i, i + perPage));
  const dense = perPage > 12;
  const totalHours = weeks.reduce((s, w) => s + w.hours, 0);
  const totalTss = weeks.reduce((s, w) => s + w.tss, 0);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, o);
  const commitments = (plan.availability.pins ?? []).map((p) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dow]} ${p.kind === 'rest' ? 'rest' : KIND_LABEL[p.kind as SessionKind].toLowerCase()}`).join(', ');
  const goalText = plan.goal.kind === 'event' ? `${plan.goal.name || 'Event'} on ${fmt(plan.goal.date, { month: 'long', day: 'numeric', year: 'numeric' })}` : GOAL_LABEL_FULL[plan.goal.kind];

  const Header = ({ page }: { page: number }) => (
    <div class="p-hd">
      <div>
        <h1>{plan.name}</h1>
        <div class="p-sub">{goalText} · {weeks.length} weeks · {fmt(plan.start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} to {fmt(plan.goalDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}{pages.length > 1 ? ` · page ${page} of ${pages.length}` : ''}</div>
      </div>
      <div class="p-meta"><b>{profile.name}</b> · FTP {profile.ftp} W · LTHR {profile.lthr}{commitments ? <><br />Standing: {commitments}</> : null}<br />{Math.round(totalHours)} hours · {totalTss} TSS planned</div>
    </div>
  );
  const Legend = () => (
    <div class="p-legend">
      <span><i class="sw k-ride" />Ride</span><span><i class="sw k-strength" />Strength</span><span><i class="sw k-walk" />Walk</span><span><i class="sw k-mobility" />Mobility</span><span class="p-ph">Recovery week</span>
      <span class="p-done">✓ done · ✗ missed</span>
      <span style="margin-left:auto">Rides are named for their turnaround from home; the full steps are on the Garmin.</span>
    </div>
  );
  const Footer = ({ page }: { page: number }) => (
    <div class="p-ft"><span>Zone 2 = conversational effort. TSS = training load; an hour flat out at FTP is 100. Sessions done, missed or changed in the app show that way the next time you print.</span><span>{APP_NAME} · printed {fmt(today(), { month: 'short', day: 'numeric', year: 'numeric' })} · page {page} of {pages.length}</span></div>
  );

  return (
    <div class={`print-root${dense ? ' dense' : ''}${perPage >= 16 ? ' tight' : ''}`}>
      <div class="p-tools">
        <a href="#/plan" class="btn sm quiet">‹ Back</a>
        <div class="seg"><button class={layout === 'calendar' ? 'on' : ''} onClick={() => setLayout('calendar')}>Calendar</button><button class={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')}>List</button></div>
        <span class="faint small">US Letter, landscape. {pages.length === 1 ? 'Fits one page.' : `${pages.length} pages.`} Use the print dialog's Save as PDF to keep a copy.</span>
        <button class="btn primary sm" style="margin-left:auto" onClick={() => window.print()}>Print</button>
      </div>
      {pages.map((pw, pi) => (
        <section class="p-sheet" key={pi}>
          <Header page={pi + 1} />
          {layout === 'calendar' ? (
            <>
              <Legend />
              <table class="p-table">
                <thead><tr><th>Week</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th><th class="r">Total</th></tr></thead>
                <tbody>
                  {pw.map((w) => (
                    <tr class={w.phase === 'Recovery' ? 'recovery' : w.phase === 'Taper' ? 'taper' : ''} key={w.start}>
                      <th><div class="wk">Week {w.index}</div><div class="dt">{fmt(w.start)} – {fmt(addDays(w.start, 6))}</div>{w.phase && <div class="ph">{PHASE[w.phase.toLowerCase()] ?? w.phase}</div>}</th>
                      {w.days.map((ds, k) => (
                        <td key={k}>
                          {ds.length === 0 && <div class="rest">rest</div>}
                          {ds.map((p) => { const w2 = workoutOf(p); if (!w2) return null; return <div class={`s k-${w2.kind}${p.status === 'completed' ? ' done' : p.status === 'missed' ? ' missed' : ''}`} key={p.id}><span class="nm">{p.status === 'completed' ? '✓ ' : p.status === 'missed' ? '✗ ' : ''}{shortName(w2)}</span> <span class="du">{hm(minutesOf(w2))}</span></div>; })}
                        </td>
                      ))}
                      <td class="tot"><div><b>{w.hours.toFixed(1)} h</b></div><div>{w.tss} TSS</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div class="p-cols">
              {pw.map((w) => (
                <div class={`p-lw${w.phase === 'Recovery' ? ' recovery' : ''}`} key={w.start}>
                  <div class="p-lh"><b>Week {w.index}</b> · {fmt(w.start)}{w.phase ? ` · ${PHASE[w.phase.toLowerCase()] ?? w.phase}` : ''} · {w.hours.toFixed(1)} h · {w.tss} TSS</div>
                  {w.days.map((ds, k) => ds.length ? (
                    <div class="p-li" key={k}><span class="ld">{fmt(addDays(w.start, k), { weekday: 'short', day: 'numeric' })}</span><span>{ds.map((p, j) => { const w2 = workoutOf(p); if (!w2) return null; return <span key={p.id}>{j ? ' · ' : ''}<span class={`lk k-${w2.kind}`}>{p.status === 'completed' ? '✓ ' : p.status === 'missed' ? '✗ ' : ''}{shortName(w2)} <span class="du">({hm(minutesOf(w2))})</span></span></span>; })}</span></div>
                  ) : null)}
                </div>
              ))}
            </div>
          )}
          <Footer page={pi + 1} />
        </section>
      ))}
    </div>
  );
}

function kindOrder(k?: SessionKind): number { return { ride: 0, walk: 1, strength: 2, mobility: 3, other: 4 }[k ?? 'other'] ?? 5; }
function minutesOf(w: Workout): number { return w.kind === 'ride' ? Math.round(workoutStats(w.blocks).seconds / 60) : (w.walk?.minutes ?? w.minutes ?? 0); }
function tssOf(w: Workout): number { return w.kind === 'ride' ? workoutStats(w.blocks).tss : (w.estimatedTss ?? 0); }
function hm(m: number): string { return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m} min`; }
function shortName(w: Workout): string {
  return w.name
    .replace(/^Mobility: after the long ride \(\d+ min\)$/, 'Mobility')
    .replace(/^Mobility: after strength \(\d+ min\)$/, 'Mobility')
    .replace(/^Mobility: (.+?) \(\d+ min\)$/, 'Mobility: $1')
    .replace(/^(Strength|Foundation|Build|Maintain|Light) ([AB]): .+$/, '$1 $2')
    .replace(/^Zone 2 walk (\d+) min with a (\d+) lb pack$/, 'Walk · $2 lb pack')
    .replace(/^Zone 2 walk (\d+) min$/, 'Walk')
    .replace(/^Long Endurance /, 'Long ')
    .replace(/^Endurance (\d+|\d+:\d\d)$/, 'Endurance');
}
