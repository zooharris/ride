import { useState } from 'preact/hooks';
import type { AppData } from './store';
import { allWorkouts, alreadyText, findWorkout } from './store';
import { runBandText } from '../engine/run';
import { WorkoutProfile } from './Profile';
import { clock, workoutStats } from '../engine/workout';
import { today } from '../engine/load';
import { fmtDate, quickMoveDays, quickMoveLabel } from './derived';
import { FAMILY_LABEL } from '../library/workouts';
import type { PlannedWorkout, Workout } from '../engine/types';
import { KIND_LABEL, KindDot } from './screens/Plan';
import { movePlanned, removePlanned, replacePlanned } from './planService';
import { toast } from './Toast';
import { applyFilters, FilterBar, useFilters } from './LibraryFilters';

/**
 * Move a session to another day and say so. If the day already has a session of
 * the same kind the move still happens; the message mentions it.
 */
export async function moveSession(data: AppData, p: PlannedWorkout, date: string): Promise<void> {
  if (!date || date === p.date) return;
  const w = findWorkout(data.mine, p.workoutId);
  const kind = w?.kind;
  const clash = kind && data.planned.some((o) => o.id !== p.id && o.date === date && findWorkout(data.mine, o.workoutId)?.kind === kind);
  const wasSent = p.status === 'sent';
  await movePlanned(p, date);
  const kindWord = kind === 'ride' ? 'a ride' : kind === 'walk' ? 'a walk' : kind ? `a ${KIND_LABEL[kind].toLowerCase()} session` : 'a session';
  toast({ ok: true, text: `Moved ${w?.name ?? 'the session'} to ${fmtDate(date)}.${clash ? ` That day already has ${kindWord}.` : ''}${wasSent ? ' It came off your Garmin; send it again when you are ready.' : ''}` });
}

/**
 * The sheet for changing one calendar session: move it (one tap for the next
 * few days, or any date), replace it with another workout of any kind, or
 * remove it. Shared by the Calendar, Today and a session's own page.
 */
export function ChangeSheet({ data, planned, onClose, onDone, startWith }: {
  data: AppData;
  planned: PlannedWorkout;
  onClose: () => void;
  /** Called after a change, with what happened, so the page can follow the session. */
  onDone?: (what: 'moved' | 'replaced' | 'removed', p: PlannedWorkout) => void;
  startWith?: 'menu' | 'replace';
}) {
  const [mode, setMode] = useState<'menu' | 'replace'>(startWith ?? 'menu');
  const [date, setDate] = useState(planned.date);
  const [busy, setBusy] = useState(false);
  const w = findWorkout(data.mine, planned.workoutId);
  const basis = data.profile?.basis ?? 'power';

  async function move(to: string) {
    if (busy || !to || to === planned.date) return;
    setBusy(true);
    try { await moveSession(data, planned, to); onClose(); onDone?.('moved', { ...planned, date: to }); }
    finally { setBusy(false); }
  }
  async function replace(nw: Workout) {
    setBusy(true);
    try {
      if (await replacePlanned(planned, nw, basis) === 'already') { toast({ ok: false, text: alreadyText(nw.name, planned.date) }); return; }
      toast({ ok: true, text: `${fmtDate(planned.date)}: ${nw.name} instead of ${w?.name ?? 'the session'}.` }); onClose(); onDone?.('replaced', planned);
    }
    finally { setBusy(false); }
  }
  async function remove() {
    onClose();
    if (await removePlanned(planned.id, data.mine)) onDone?.('removed', planned);
  }

  if (mode === 'replace') return <WorkoutPicker data={data} title={`Replace ${w?.name ?? 'this session'}`} onPick={replace} onClose={onClose} onBack={startWith === 'replace' ? undefined : () => setMode('menu')} startKind={w?.kind === 'other' ? 'ride' : w?.kind} />;

  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:480px" role="dialog" aria-label={`Change ${w?.name ?? 'this session'}`}>
        <div class="row between" style="margin-bottom:6px"><h2>{w?.name ?? 'This session'}</h2><button class="btn sm quiet" onClick={onClose}>Cancel</button></div>
        <p class="muted small" style="margin:0 0 14px">{fmtDate(planned.date)}{planned.planId ? ' · from your plan' : ''}{planned.status === 'sent' ? ' · on your Garmin' : ''}{planned.status === 'missed' ? ' · missed' : ''}</p>
        <div class="stack">
          <div class="panel" style="padding:10px 12px">
            <div class="small" style="margin-bottom:8px"><b>Move to another day</b></div>
            <div class="row wrap quick-days" style="gap:6px;margin-bottom:10px">
              {quickMoveDays(planned.date).map((d) => (
                <button key={d} class="btn sm" disabled={busy} onClick={() => move(d)} title={`Move to ${fmtDate(d)}`}>{quickMoveLabel(d)}</button>
              ))}
            </div>
            <div class="row wrap" style="gap:8px">
              <span class="faint small">Or a date</span>
              <input type="date" value={date} min={today()} onInput={(e) => setDate((e.target as HTMLInputElement).value)} style="width:auto" aria-label="Date to move to" />
              <button class="btn sm" onClick={() => move(date)} disabled={busy || !date || date === planned.date || date < today()}>Move</button>
            </div>
          </div>
          <button class="btn" style="justify-content:flex-start" onClick={() => setMode('replace')}>Replace with another session<span class="faint small" style="margin-left:auto">any kind</span></button>
          <button class="btn danger" style="justify-content:flex-start" onClick={remove}>Remove from the calendar</button>
        </div>
        {planned.status === 'sent' && <p class="faint small" style="margin:12px 0 0">Moving or replacing takes it off the Garmin; send the new one when you are ready.</p>}
        {planned.planId && <p class="faint small" style="margin:8px 0 0">The plan keeps your change. The daily re-check may still suggest something for this day, which you can accept or ignore.</p>}
      </div>
    </div>
  );
}

/** Choose a workout of any kind from the library and My Workouts. */
export function WorkoutPicker({ data, title, onPick, onClose, onBack, startKind }: { data: AppData; title: string; onPick: (w: Workout) => void; onClose: () => void; onBack?: () => void; startKind?: 'ride' | 'strength' | 'mobility' | 'walk' | 'run' }) {
  const [kind, setKind] = useState<'ride' | 'strength' | 'mobility' | 'walk' | 'run'>(startKind ?? 'ride');
  const kinds = ['ride', 'strength', 'mobility', 'walk', 'run'] as const;
  // The Library's filters, so a shorter ride is a length filter away (Batch 10 C). Kept while the sheet is open.
  const [f, setF] = useFilters();
  const list = applyFilters(allWorkouts(data.mine).filter((w) => w.kind === kind && w.source !== 'generated'), f, kind);
  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div class="row between" style="margin-bottom:12px">
          <div class="row" style="gap:4px;min-width:0">{onBack && <button class="btn sm quiet" style="margin-left:-8px" onClick={onBack} aria-label="Back">‹</button>}<h2>{title}</h2></div>
          <button class="btn sm quiet" onClick={onClose}>Cancel</button>
        </div>
        <div class="seg" style="margin-bottom:12px">
          {kinds.map((k) => <button key={k} class={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'ride' ? 'Rides' : k === 'walk' ? 'Walks' : k === 'run' ? 'Runs' : KIND_LABEL[k]}</button>)}
        </div>
        <FilterBar kind={kind} f={f} set={setF} />
        <p class="faint small" style="margin:0 0 10px">{list.length === 0 ? 'Nothing matches: widen the length or clear the search. ' : ''}Or <a href="#/build">make a new workout</a>.</p>
        <div class="stack">
          {list.map((w) => {
            const s = workoutStats(w.blocks);
            const n = w.exercises?.length ?? 0;
            return (
              <button class="cal-item" key={w.id} onClick={() => onPick(w)} style="cursor:pointer;text-align:left">
                {w.kind === 'ride' ? <WorkoutProfile blocks={w.blocks} height={28} ratio={2.2} /> : <KindDot kind={w.kind} big />}
                <div class="t"><b>{w.name}</b><span>{w.kind === 'ride' ? `${w.subtitle ? `${w.subtitle} · ` : FAMILY_LABEL[w.family] + ' · '}${clock(s.seconds)} · ${s.tss} TSS` : w.kind === 'walk' ? `${w.walk?.minutes ?? w.minutes} min${w.walk?.packKg ? ` · ${Math.round(w.walk.packKg * 2.2)} lb pack` : ''}` : w.kind === 'run' ? `${w.minutes ?? '–'} min · ${runBandText(w, data.profile ?? undefined)}${w.source === 'mine' ? ' · mine' : ''}` : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}${w.source === 'mine' ? ' · mine' : ''}`}</span></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
