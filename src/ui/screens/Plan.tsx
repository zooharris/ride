import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout, notify } from '../store';
import { PLAN_TEMPLATES, layOutPlan, templateById } from '../../library/plans';
import { addDays, today } from '../../engine/load';
import { clock, workoutStats } from '../../engine/workout';
import { db, getSetting, setSetting } from '../../data/db';
import { fmtDate } from '../derived';
import { WorkoutProfile } from '../Profile';
import { go } from '../router';

interface ActivePlan { templateId: string; start: string; longOffset: number; appliedAt: string }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nextDow(dow: number, from = today()): string {
  let d = from;
  for (let i = 0; i < 7; i++) { if (new Date(d + 'T00:00:00').getDay() === dow) return d; d = addDays(d, 1); }
  return from;
}

export function Plan({ data }: { data: AppData }) {
  const profile = data.profile!;
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [templateId, setTemplateId] = useState(PLAN_TEMPLATES[0].id);
  const [qualityDow, setQualityDow] = useState(6);
  const [start, setStart] = useState(nextDow(6));
  const [longOffset, setLongOffset] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { getSetting<ActivePlan | null>('activePlan', null).then(setActive); }, []);
  useEffect(() => { setStart(nextDow(qualityDow)); }, [qualityDow]);

  const t = templateById(templateId)!;
  const preview = layOutPlan(t, start, longOffset, profile.basis, '0000-00-00');

  async function apply() {
    const items = layOutPlan(t, start, longOffset, profile.basis, today());
    // Clear any still-unsent plan items on those dates so re-applying does not double up.
    const dates = new Set(items.map((i) => i.date));
    const clash = data.planned.filter((p) => dates.has(p.date) && p.status === 'planned');
    if (clash.length && !confirm(`${clash.length} unsent workout${clash.length > 1 ? 's are' : ' is'} already on those dates and will be replaced. Continue?`)) return;
    await db.planned.bulkDelete(clash.map((c) => c.id));
    await db.planned.bulkAdd(items);
    const a: ActivePlan = { templateId: t.id, start, longOffset, appliedAt: new Date().toISOString() };
    await setSetting('activePlan', a);
    setActive(a);
    notify();
    setMsg(`${items.length} rides placed on the calendar from ${fmtDate(items[0]?.date ?? start)}. Send each week to your Garmin from the Calendar.`);
    go('calendar');
  }

  const activeT = active ? templateById(active.templateId) : undefined;
  const weekOf = active ? Math.floor((Date.parse(today()) - Date.parse(active.start)) / (7 * 864e5)) + 1 : 0;

  return (
    <div>
      <a href="#/calendar" class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Calendar</a>
      <div class="page-head"><h1>Plan</h1></div>

      {activeT && active && (
        <div class="panel accent" style="margin-bottom:22px">
          <b>{activeT.name}</b>
          <p class="muted small" style="margin-top:4px">
            Started {fmtDate(active.start, { month: 'long', day: 'numeric' })}. {weekOf >= 1 && weekOf <= activeT.weeks.length ? `Week ${weekOf} of ${activeT.weeks.length}: ${activeT.weeks[weekOf - 1].label}.` : weekOf < 1 ? 'Starts soon.' : 'Finished.'}
          </p>
        </div>
      )}

      {msg && <div class="msg ok" style="margin-bottom:14px">{msg}</div>}

      <section>
        <h2>Templates</h2>
        <p class="muted small" style="margin:6px 0 12px">A template lays a whole block onto the calendar. The plan builder that designs a block from your goal and dates arrives in phase 3.</p>
        <div class="stack">
          {PLAN_TEMPLATES.map((p) => (
            <button key={p.id} class={`panel${templateId === p.id ? ' accent' : ''}`} style="text-align:left;cursor:pointer" onClick={() => setTemplateId(p.id)}>
              <b>{p.name}</b>
              <p class="muted small" style="margin-top:3px">{p.summary}</p>
            </button>
          ))}
        </div>
      </section>

      <section class="section">
        <p class="muted" style="font-size:14px;line-height:1.6">{t.description}</p>
        <div class="form" style="margin-top:14px">
          <div class="field"><label>Quality ride day</label>
            <select value={qualityDow} onChange={(e) => setQualityDow(Number((e.target as HTMLSelectElement).value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
          <div class="field"><label>Long ride</label>
            <select value={longOffset} onChange={(e) => setLongOffset(Number((e.target as HTMLSelectElement).value))}>
              <option value={1}>The day after</option><option value={2}>Two days after</option><option value={-1}>The day before</option>
            </select></div>
          <div class="field"><label>First quality ride (week 1)</label><input type="date" value={start} onInput={(e) => setStart((e.target as HTMLInputElement).value)} /></div>
        </div>
        <p class="faint small" style="margin-top:8px">To join a block already under way, set week 1 to the date it actually started; past weeks are skipped and the calendar picks up from today.</p>
      </section>

      <section class="section">
        <h2>Weeks</h2>
        <table class="steps">
          {t.weeks.map((w, i) => {
            const q = addDays(start, i * 7);
            const qw = w.quality ? findWorkout(data.mine, w.quality) : undefined;
            const lw = w.long ? findWorkout(data.mine, w.long) : undefined;
            const past = addDays(q, Math.max(longOffset, 0)) < today();
            return (
              <tr key={i} style={past ? 'opacity:.45' : ''}>
                <td colSpan={2} style="white-space:nowrap">
                  <b>{w.label}</b><div class="faint small">{fmtDate(q, { month: 'short', day: 'numeric' })}</div>
                </td>
                <td colSpan={2}>
                  {w.note && <div class="faint small" style="margin-bottom:4px">{w.note}</div>}
                  {qw && <div class="row" style="gap:8px"><div style="width:48px"><WorkoutProfile blocks={qw.blocks} height={20} ratio={2.4} /></div><span class="small">{qw.name} <span class="faint">{clock(workoutStats(qw.blocks).seconds)}</span></span></div>}
                  {lw && <div class="row" style="gap:8px;margin-top:4px"><div style="width:48px"><WorkoutProfile blocks={lw.blocks} height={20} ratio={2.4} /></div><span class="small">{lw.name} <span class="faint">{clock(workoutStats(lw.blocks).seconds)}</span></span></div>}
                </td>
              </tr>
            );
          })}
        </table>
        <p class="faint small" style="margin-top:8px">{preview.filter((p) => p.date >= today()).length} rides would go on the calendar from today.</p>
      </section>

      <button class="btn primary block" style="margin-top:20px" onClick={apply}>Put this plan on the calendar</button>
    </div>
  );
}
