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
import { PageHead } from '../PageHead';
import { toast } from '../Toast';
import { GLOSSARY } from '../glossary';

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
  const [menu, setMenu] = useState<'type' | 'length' | 'sort' | null>(null);
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
      <PageHead eyebrow={`${list.length} ${tab === 'ride' ? 'rides' : 'sessions'}`} title="Library" help="library">
        <a class="btn sm" href="#/plan">Plan my training</a><a class="btn sm primary" href="#/build">New workout</a>
      </PageHead>
      <div class="row wrap" style="gap:10px;margin-bottom:12px">
        <div class="seg kinds">
          {TABS.map(([t, l]) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{KIND_ICON[t]({ size: 15 })}<span>{l}</span></button>)}
        </div>
      </div>
      <div class="filterbar">
        <input value={query} placeholder="Search" onInput={(e) => setQuery((e.target as HTMLInputElement).value)} aria-label="Search the library" />
        {tab === 'ride' && <Menu label={family === 'all' ? 'All types' : FAMILY_LABEL[family]} active={family !== 'all'} open={menu === 'type'} onOpen={() => setMenu(menu === 'type' ? null : 'type')} onClose={() => setMenu(null)} title="Type"
          options={[['all', 'All types'], ...ORDER.map((f) => [f, FAMILY_LABEL[f]] as [string, string])]} value={family} onPick={(v) => setFamily(v as Family | 'all')} />}
        <Menu label={duration === 'all' ? 'Any length' : DURATIONS.find((d) => d[0] === duration)![1]} active={duration !== 'all'} open={menu === 'length'} onOpen={() => setMenu(menu === 'length' ? null : 'length')} onClose={() => setMenu(null)} title="Length"
          options={DURATIONS.map(([d, l]) => [d, l] as [string, string])} value={duration} onPick={(v) => setDuration(v as Duration)} />
        <Menu label={sort === 'family' ? 'By type' : sort === 'short' ? 'Shortest first' : 'Longest first'} active={false} open={menu === 'sort'} onOpen={() => setMenu(menu === 'sort' ? null : 'sort')} onClose={() => setMenu(null)} title="Sort"
          options={[['family', 'By type'], ['short', 'Shortest first'], ['long', 'Longest first']]} value={sort} onPick={(v) => setSort(v as 'family' | 'short' | 'long')} />
        {(family !== 'all' || duration !== 'all' || q) && <button class="btn sm quiet" onClick={() => { setFamily('all'); setDuration('all'); setQuery(''); }}>Clear</button>}
      </div>
      {mine.length > 0 && (
        <section style="margin-bottom:22px">
          <h2 style="margin-bottom:10px">My {tab === 'ride' ? 'workouts' : KIND_LABEL[tab].toLowerCase() + ' sessions'}</h2>
          <div class="grid">
            {mine.map((w) => tab === 'ride' ? <Card key={w.id} w={w} mine basis={data.profile?.basis ?? 'power'} onPick={() => setAdding(w)} /> : <SessionCard key={w.id} w={w} mine onAdd={() => setAdding(w)} />)}
          </div>
        </section>
      )}

      {tab === 'ride' ? (
        <>
          {ready.length === 0 && mine.length === 0 && <div class="empty small"><b>Nothing matches.</b><span class="small muted">Widen the length, pick another type, or clear the search.</span></div>}
          <div class="grid">{ready.map((w) => <Card key={w.id} w={w} basis={data.profile?.basis ?? 'power'} onPick={() => setAdding(w)} />)}</div>
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

/**
 * A ride in the library: family and basis, the workout's shape, its place name
 * and descriptive name, then length, load and intensity. On a laptop, hovering
 * shows Ride today and Pick a date; on a phone, the workout's page has both.
 */
function Card({ w, mine = false, basis, onPick }: { w: Workout; mine?: boolean; basis: 'power' | 'hr'; onPick: () => void }) {
  const s = workoutStats(w.blocks);
  return (
    <div class="wcard ride">
      <a class="wcard-main" href={`#/workout/${w.id}?from=library`}>
        <div class="row between">
          <span class="tag" style={`--c:var(--z${s.dominantZone})`}>{FAMILY_LABEL[w.family]}</span>
          <span class="faint small">{mine ? 'mine' : w.bases.includes('hr') ? 'power or HR' : 'power only'}</span>
        </div>
        <div class="profile"><WorkoutProfile blocks={w.blocks} height={56} /></div>
        <h3>{w.name}</h3>
        <p class="wc-sub small">{w.subtitle ?? '\u00a0'}</p>
        <p class="wc-stats"><span><b class="num">{clock(s.seconds)}</b> time</span><span><b class="num">{s.tss}</b> TSS</span><span title={`Intensity: ${GLOSSARY.intensity.short}`}><b class="num">{s.intensityFactor.toFixed(2)}</b> intensity</span>{w.setting !== 'any' && <span>{w.setting === 'outdoor' ? 'outdoors' : 'indoor'}</span>}</p>
      </a>
      <div class="wcard-actions">
        <button class="btn sm primary" onClick={async () => { await scheduleWorkout(w, today(), basis); toast({ ok: true, text: `${w.name} is on today's calendar.` }); }}>Ride today</button>
        <button class="btn sm" onClick={onPick}>Pick a date</button>
      </div>
    </div>
  );
}

function SessionCard({ w, mine = false, onAdd }: { w: Workout; mine?: boolean; onAdd: () => void }) {
  const n = w.exercises?.length ?? 0;
  const detail = w.kind === 'walk'
    ? `${w.walk?.minutes ?? w.minutes} min · ${w.walk?.packKg ? `${Math.round(w.walk.packKg * 2.2)} lb pack` : 'no pack'} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}`;
  return (
    <div class="wcard" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between"><span class="row" style="gap:8px"><KindDot kind={w.kind as SessionKind} big /><span class="faint small">{KIND_LABEL[w.kind]}</span></span><span class="faint small" title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does.">{mine ? 'mine' : w.estimatedTss ? `≈ ${w.estimatedTss} TSS, estimated` : ''}</span></div>
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
          <p class="msg ok">Added to {fmtDate(date)}. <a href={`#/calendar?d=${date}`}>Open the calendar</a>.</p>
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

/** A filter menu: a button that names the current choice; the options open as a dropdown on a laptop and a sheet on a phone. */
function Menu({ label, active, open, onOpen, onClose, title, options, value, onPick }: { label: string; active: boolean; open: boolean; onOpen: () => void; onClose: () => void; title: string; options: Array<[string, string]>; value: string; onPick: (v: string) => void }) {
  return (
    <div class="menu">
      <button class={`btn sm${active ? '' : ' quiet'} menu-btn`} aria-haspopup="listbox" aria-expanded={open} onClick={onOpen}>{label}<span class="caret">▾</span></button>
      {open && (
        <>
          <div class="menu-bg" onClick={onClose} />
          <div class="menu-list" role="listbox">
            <div class="menu-title">{title}</div>
            {options.map(([v, l]) => <button key={v} role="option" aria-selected={v === value} class={v === value ? 'on' : ''} onClick={() => { onPick(v); onClose(); }}><span>{l}</span>{v === value && <span class="tick">✓</span>}</button>)}
          </div>
        </>
      )}
    </div>
  );
}
