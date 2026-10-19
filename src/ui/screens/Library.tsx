import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { allWorkouts, scheduleWorkout } from '../store';
import { WorkoutProfile } from '../Profile';
import { clock, workoutStats } from '../../engine/workout';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Family, SessionKind, Workout } from '../../engine/types';
import { KIND_LABEL, KindDot } from './Plan';
import { KIND_ICON } from '../icons';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';

const ORDER: Family[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'];
type Tab = 'ride' | 'strength' | 'mobility' | 'walk';
const TABS: Array<[Tab, string]> = [['ride', 'Rides'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['walk', 'Walks']];
type Duration = 'all' | 'u60' | '60-90' | '90-120' | '120-180' | '180-240' | '240+';
const DURATIONS: Array<[Duration, string, [number, number]]> = [
  ['all', 'Any', [0, 1e9]], ['u60', 'Under 1 h', [0, 60]], ['60-90', '1–1½ h', [60, 90]], ['90-120', '1½–2 h', [90, 120]], ['120-180', '2–3 h', [120, 180]], ['180-240', '3–4 h', [180, 240]], ['240+', '4 h and up', [240, 1e9]],
];

export function Library({ data }: { data: AppData }) {
  const [tab, setTab] = useState<Tab>('ride');
  const [family, setFamily] = useState<Family | 'all'>('all');
  const [adding, setAdding] = useState<Workout | null>(null);
  const [duration, setDuration] = useState<Duration>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'family' | 'short' | 'long'>('family');
  const q = query.trim().toLowerCase();
  const minutesOf = (w: Workout) => (w.kind === 'ride' ? workoutStats(w.blocks).seconds / 60 : (w.minutes ?? 0));
  const inDuration = (w: Workout) => { const m = minutesOf(w); const [lo, hi] = DURATIONS.find((d) => d[0] === duration)![2]; return m >= lo && m < hi; };
  const matches = (w: Workout) => !q || `${w.name} ${w.subtitle ?? ''} ${FAMILY_LABEL[w.family]} ${w.purpose}`.toLowerCase().includes(q);
  const all = allWorkouts(data.mine).filter((w) => w.kind === tab && w.source !== 'generated').filter(inDuration).filter(matches);
  const ordered = sort === 'family' ? all : [...all].sort((a, b) => (sort === 'short' ? minutesOf(a) - minutesOf(b) : minutesOf(b) - minutesOf(a)));
  const list = tab === 'ride' ? ordered.filter((w) => family === 'all' || w.family === family) : ordered;
  const mine = list.filter((w) => w.source === 'mine');
  const ready = list.filter((w) => w.source === 'library');
  return (
    <div>
      <div class="page-head">
        <h1>Library</h1>
        <div class="row wrap"><span class="muted small">{list.length} {tab === 'ride' ? 'rides' : 'sessions'}</span><a class="btn sm" href="#/plan">Plan my training</a><a class="btn sm primary" href="#/build">New workout</a></div>
      </div>
      <div class="row wrap" style="gap:10px;margin-bottom:12px">
        <div class="seg">
          {TABS.map(([t, l]) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{KIND_ICON[t]({ size: 15 })}<span>{l}</span></button>)}
        </div>
        <input value={query} placeholder="Search by name or purpose" onInput={(e) => setQuery((e.target as HTMLInputElement).value)} style="flex:1;min-width:180px;max-width:320px" aria-label="Search the library" />
      </div>
      <div class="row wrap" style="gap:6px 10px;margin-bottom:12px;align-items:center">
        <span class="faint small">Length</span>
        <div class="chips">
          {DURATIONS.map(([d, l]) => <button key={d} class={`chip${duration === d ? ' on' : ''}`} onClick={() => setDuration(d)}>{l}</button>)}
        </div>
        <span class="faint small" style="margin-left:auto">Sort</span>
        <div class="seg">
          <button class={sort === 'family' ? 'on' : ''} onClick={() => setSort('family')}>By type</button>
          <button class={sort === 'short' ? 'on' : ''} onClick={() => setSort('short')}>Shortest</button>
          <button class={sort === 'long' ? 'on' : ''} onClick={() => setSort('long')}>Longest</button>
        </div>
      </div>

      {mine.length > 0 && (
        <section style="margin-bottom:22px">
          <h2 style="margin-bottom:10px">My {tab === 'ride' ? 'workouts' : KIND_LABEL[tab].toLowerCase() + ' sessions'}</h2>
          <div class="grid">
            {mine.map((w) => tab === 'ride' ? <Card key={w.id} w={w} mine /> : <SessionCard key={w.id} w={w} mine onAdd={() => setAdding(w)} />)}
          </div>
        </section>
      )}

      {tab === 'ride' ? (
        <>
          <div class="chips" style="margin-bottom:18px">
            <button class={`chip${family === 'all' ? ' on' : ''}`} onClick={() => setFamily('all')}>All</button>
            {ORDER.map((f) => <button key={f} class={`chip${family === f ? ' on' : ''}`} onClick={() => setFamily(f)}>{FAMILY_LABEL[f]}</button>)}
          </div>
          {ready.length === 0 && mine.length === 0 && <div class="empty small">Nothing matches. Widen the length or clear the search.</div>}
          <div class="grid">{ready.map((w) => <Card key={w.id} w={w} />)}</div>
        </>
      ) : (
        <>
          <p class="muted small" style="margin:0 0 14px;max-width:62ch">
            {tab === 'strength' && 'Built for your equipment from the planner’s own sessions: the same lifts, sets and reps a plan would give you, at each level. Add one to any date, or make your own with New workout.'}
            {tab === 'mobility' && 'Stretching routines by what cycling tightens. Each one names the stretches and how long to hold them. Add one to any date, or make your own with New workout.'}
            {tab === 'walk' && 'Zone 2 on foot for days the bike is out: treadmill or outdoors, with or without a weighted pack. Add one to any date, or make your own with New workout.'}
          </p>
          <div class="grid">{ready.map((w) => <SessionCard key={w.id} w={w} onAdd={() => setAdding(w)} />)}</div>
        </>
      )}

      {adding && <AddToDate w={adding} basis={data.profile?.basis ?? 'power'} onClose={() => setAdding(null)} />}
    </div>
  );
}

function Card({ w, mine = false }: { w: Workout; mine?: boolean }) {
  const s = workoutStats(w.blocks);
  return (
    <a class="wcard" href={`#/workout/${w.id}?from=library`}>
      <div class="row between">
        <span class="tag" style={`background:var(--z${s.dominantZone})`}>{FAMILY_LABEL[w.family]}</span>
        <span class="faint small">{mine ? 'mine' : w.bases.includes('hr') ? 'power or HR' : 'power only'}</span>
      </div>
      <WorkoutProfile blocks={w.blocks} height={56} />
      <h3>{w.name}</h3>
      {w.subtitle && <p class="small" style="margin:-2px 0 2px;color:var(--ink-2)">{w.subtitle}</p>}
      <p class="muted small">{clock(s.seconds)} · {s.tss} TSS · IF {s.intensityFactor.toFixed(2)}{w.setting === 'outdoor' ? ' · outdoors' : w.setting === 'indoor' ? ' · indoor' : ''}</p>
    </a>
  );
}

function SessionCard({ w, mine = false, onAdd }: { w: Workout; mine?: boolean; onAdd: () => void }) {
  const n = w.exercises?.length ?? 0;
  const detail = w.kind === 'walk'
    ? `${w.walk?.minutes ?? w.minutes} min · ${w.walk?.packKg ? `${Math.round(w.walk.packKg * 2.2)} lb pack` : 'no pack'} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}`;
  return (
    <div class="wcard" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between"><span class="row" style="gap:8px"><KindDot kind={w.kind as SessionKind} big /><span class="faint small">{KIND_LABEL[w.kind]}</span></span><span class="faint small" title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does.">{mine ? 'mine' : w.estimatedTss ? `≈ ${w.estimatedTss} TSS` : ''}</span></div>
      <a href={`#/workout/${w.id}?from=library`} style="color:inherit;text-decoration:none"><h3 style="margin:0">{w.name}</h3></a>
      <p class="muted small" style="margin:0">{detail}</p>
      {w.exercises && <p class="faint small" style="margin:0;line-height:1.4">{w.exercises.slice(0, 4).map((e) => e.name).join(' · ')}{n > 4 ? ` · +${n - 4}` : ''}</p>}
      <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm" onClick={onAdd}>Add to a date</button><a class="btn sm quiet" href={`#/workout/${w.id}?from=library`}>View</a></div>
    </div>
  );
}

/** A small sheet: pick a date, put the session on the calendar. */
export function AddToDate({ w, basis, onClose }: { w: Workout; basis: 'power' | 'hr'; onClose: () => void }) {
  const [date, setDate] = useState(today());
  const [done, setDone] = useState(false);
  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:460px">
        <div class="row between" style="margin-bottom:12px"><h2>Add to a date</h2><button class="btn sm quiet" onClick={onClose}>Close</button></div>
        <p class="small" style="margin:0 0 12px"><b>{w.name}</b> <span class="muted">· {KIND_LABEL[w.kind]}{w.minutes ? ` · ${w.minutes} min` : ''}</span></p>
        {done ? (
          <p class="msg ok">Added to {fmtDate(date)}. <a href="#/calendar">Open the calendar</a>.</p>
        ) : (
          <div class="row wrap" style="gap:8px;align-items:center">
            <input type="date" value={date} min={today()} onInput={(e) => setDate((e.target as HTMLInputElement).value || today())} style="width:auto" aria-label="Date" />
            <button class="btn primary" onClick={async () => { await scheduleWorkout(w, date, basis); setDone(true); }}>Add to {date === today() ? 'today' : fmtDate(date)}</button>
            <button class="btn quiet" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
