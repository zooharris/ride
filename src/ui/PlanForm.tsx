import { addDays, today } from '../engine/load';
import type { Availability, AwayRange } from '../engine/planner';
import type { EventType, Goal } from '../engine/goals';
import type { Equipment, Profile, SessionKind } from '../engine/types';
import { dayOrder, fmtDate } from './derived';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVENT_TYPES: Array<[EventType, string]> = [
  ['century', 'Century or long endurance ride'], ['gran-fondo', 'Gran fondo or hard sportive'], ['climbing', 'Climbing event'],
  ['time-trial', 'Time trial'], ['group-ride', 'Fast group ride or race'], ['multi-day', 'Multi-day tour'], ['other', 'Something else'],
];
export const GOAL_KIND_LABEL: Record<Goal['kind'], string> = { event: 'An event on a date', ftp: 'Raise FTP', vo2max: 'Raise VO2max', endurance: 'Ride longer comfortably', weight: 'Lose weight', general: 'General fitness' };

/**
 * What the plan is for. New plans choose the goal; an existing plan's goal kind
 * is fixed (a different goal is a different plan), and its length is set by an
 * end date instead of a number of weeks.
 */
export function GoalFields({ goal, setGoal, profile, fixedKind = false, endDate, setEndDate }: { goal: Goal; setGoal: (g: Goal) => void; profile: Profile; fixedKind?: boolean; endDate?: string; setEndDate?: (d: string) => void }) {
  const imperial = profile.units === 'imperial';
  return (
    <>
          {fixedKind ? (
            <div class="field"><label>What you are training for</label><div style="padding:9px 0" class="small"><b>{GOAL_KIND_LABEL[goal.kind]}</b> <span class="faint">· a different goal is a new plan</span></div></div>
          ) : (
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
          )}
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
          {goal.kind !== 'event' && setEndDate && (
            <div class="field"><label>Ends on</label><input type="date" min={addDays(today(), 7)} value={endDate} onInput={(e) => setEndDate((e.target as HTMLInputElement).value || endDate!)} /></div>
          )}
          {goal.kind !== 'event' && !setEndDate && (
            <div class="field"><label>Weeks</label><input type="number" min="4" max="24" value={goal.weeks} onInput={(e) => setGoal({ ...goal, weeks: Number((e.target as HTMLInputElement).value) || 8 })} /></div>
          )}
          {goal.kind === 'ftp' && (
            <div class="field"><label>Target FTP (watts, now {profile.ftp})</label><input type="number" value={goal.targetWatts} onInput={(e) => setGoal({ ...goal, targetWatts: Number((e.target as HTMLInputElement).value) || profile.ftp })} /></div>
          )}
          {goal.kind === 'endurance' && (
            <div class="field"><label>Ride this long comfortably (hours)</label><input type="number" step="0.5" value={goal.targetHours} onInput={(e) => setGoal({ ...goal, targetHours: Number((e.target as HTMLInputElement).value) || 3 })} /></div>
          )}
    </>
  );
}

/** The rider's week: hours, where they can ride, standing commitments, equipment, recovery rhythm. */
export function WeekFields({ av, setAv, masters, setMasters, profile }: { av: Availability; setAv: (a: Availability) => void; masters: boolean; setMasters: (m: boolean) => void; profile: Profile }) {
  const setHours = (i: number, v: number) => setAv({ ...av, hours: av.hours.map((h, k) => (k === i ? v : h)) });
  const toggleEquipment = (q: Equipment) => setAv({ ...av, equipment: av.equipment.includes(q) ? av.equipment.filter((e) => e !== q) : [...av.equipment, q] });
  const setPin = (dow: number, kind: SessionKind | 'rest' | '') => setAv({ ...av, pins: [...(av.pins ?? []).filter((p) => p.dow !== dow), ...(kind ? [{ dow, kind }] : [])] });
  return (
    <>
        <div class="week-table">
          <div class="week-head"><span>Day</span><span>Hours</span><span title="Outdoors: the ride can be shaped for the road or trail. Indoors: trainer-shaped. No bike: no ride that day; strength, a walk or mobility can still go there.">Where you can ride</span><span title="A standing commitment the plan must keep. Everything else is the app's choice.">Commitment</span></div>
          {dayOrder().map((i) => {
            const d = DAYS[i];
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
            {([['dumbbells', 'Dumbbells'], ['bench', 'Bench'], ['band', 'Bands'], ['barbell', 'Barbell'], ['pullup-bar', 'Pull-up bar'], ['dip-bars', 'Dip bars'], ['bodyweight', 'Bodyweight only'], ['trainer', 'Indoor trainer'], ['treadmill', 'Treadmill'], ['outdoor-walk', 'Somewhere to walk']] as Array<[Equipment, string]>).map(([q, l]) => (
              <button key={q} class={`chip${av.equipment.includes(q) ? ' on' : ''}`} onClick={() => toggleEquipment(q)}>{l}</button>
            ))}
          </div>
        </div>
        <div class="row wrap" style="margin-top:14px;gap:18px">
          <div class="field"><label>Recovery rhythm</label>
            <div class="seg"><button class={masters ? 'on' : ''} onClick={() => setMasters(true)}>Masters (more recovery)</button><button class={!masters ? 'on' : ''} onClick={() => setMasters(false)}>Standard</button></div></div>
          <span class="faint small" style="align-self:flex-end;padding-bottom:10px">Targets in {profile.basis === 'power' ? 'power' : 'heart rate'} (change in Settings).</span>
        </div>
    </>
  );
}

/** Days away: travel, a busy week. Nothing is planned on them; a week mostly away is kept light. */
export function AwayFields({ away, setAway }: { away: AwayRange[]; setAway: (a: AwayRange[]) => void }) {
  const set = (i: number, r: Partial<AwayRange>) => setAway(away.map((x, k) => (k === i ? { ...x, ...r } : x)));
  return (
    <div class="stack" style="gap:8px">
      {away.length === 0 && <p class="faint small" style="margin:0">No time away planned.</p>}
      {away.map((r, i) => (
        <div class="row wrap" key={i} style="gap:8px;align-items:flex-end">
          <div class="field"><label>From</label><input type="date" value={r.from} onInput={(e) => { const v = (e.target as HTMLInputElement).value; set(i, { from: v, to: r.to < v ? v : r.to }); }} /></div>
          <div class="field"><label>To</label><input type="date" value={r.to} min={r.from} onInput={(e) => set(i, { to: (e.target as HTMLInputElement).value })} /></div>
          <div class="field" style="flex:1;min-width:160px"><label>Note (optional)</label><input value={r.note ?? ''} placeholder="Work trip" onInput={(e) => set(i, { note: (e.target as HTMLInputElement).value || undefined })} /></div>
          <button class="btn sm quiet" onClick={() => setAway(away.filter((_, k) => k !== i))} aria-label={`Remove time away from ${fmtDate(r.from)}`}>Remove</button>
        </div>
      ))}
      <button class="btn sm" style="align-self:flex-start" onClick={() => { const from = addDays(today(), 7); setAway([...away, { from, to: addDays(from, 4) }]); }}>Add time away</button>
    </div>
  );
}
