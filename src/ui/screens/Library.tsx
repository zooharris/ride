import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { allWorkouts, alreadyText, findWorkout, scheduleWorkout } from '../store';
import { runBandText } from '../../engine/run';
import { WorkoutProfile } from '../Profile';
import { clock, workoutStats } from '../../engine/workout';
import { PURPOSE_LABEL, tagsOf } from '../../library/tags';
import type { Profile, SessionKind, Workout } from '../../engine/types';
import { KIND_LABEL, KindDot } from './Plan';
import { KIND_ICON } from '../icons';
import { addDays, today } from '../../engine/load';
import { fmtDate } from '../derived';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';
import { GLOSSARY } from '../glossary';
import { PictureStrip, picturedCount } from '../ExercisePictures';
import { applyFilters, FilterBar, lastDoneWords, NothingMatches, SortLine, sortIn, useFilters, type Filters, type Mine } from '../LibraryFilters';
import { libraryKey } from '../favorites';
import { useNarrow } from '../Glance';
import { useMine } from '../favorites';
import { Star } from '../Star';
import { playerOffered } from '../../player/platform';
import { TrainerOnlyTag } from '../Thumbs';
import { StrengthLibrary } from '../StrengthLibrary';
import { readQuery, useUrlSync } from '../router';

type Tab = 'ride' | 'strength' | 'mobility' | 'walk' | 'run';
const TABS: Array<[Tab, string]> = [['ride', 'Rides'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['walk', 'Walks'], ['run', 'Runs']];

export function Library({ data }: { data: AppData }) {
  // The tab and the filters live in the address (`k`, then the filters' own keys), so Back from a
  // workout returns to the list as it was left (8 Nov 2026).
  const [tab, setTab] = useState<Tab>(() => TABS.find(([t]) => t === readQuery().get('k'))?.[0] ?? 'ride');
  useUrlSync({ k: tab !== 'ride' ? tab : undefined });
  const [adding, setAdding] = useState<Workout | null>(null);
  const [f, setF] = useFilters({ url: true });
  const mineSets = useMine(data.planned, (id) => findWorkout(data.mine, id), data);
  const list = applyFilters(allWorkouts(data.mine).filter((w) => w.kind === tab && w.source !== 'generated'), f, tab, mineSets);
  const mine = list.filter((w) => w.source === 'mine');
  const ready = list.filter((w) => w.source === 'library');
  // On a phone, rides are compact rows under folding headings (10 Nov 2026); a laptop keeps the cards.
  const phone = useNarrow(520);
  const rows = phone && tab === 'ride';
  return (
    <div>
      <PageHead title="Library" help="library">
        {tab === 'ride' && playerOffered() && <a class="btn sm" href="#/play/free">Free ride on the trainer</a>}<a class="btn sm" href="#/plan">Plan my training</a><a class="btn sm primary" href="#/build">New workout</a>
      </PageHead>
      <div class="row wrap" style="gap:10px;margin-bottom:12px">
        <div class="seg kinds">
          {TABS.map(([t, l]) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{KIND_ICON[t]({ size: 15 })}<span>{l}</span></button>)}
        </div>
      </div>
      <FilterBar kind={tab} f={f} set={setF} />
      {tab !== 'strength' && <SortLine kind={tab} f={f} set={setF} count={list.length} noun={tab === 'ride' ? ['ride', 'rides'] : ['session', 'sessions']} />}
      {rows ? <RideRows mine={mine} ready={ready} empty={<NothingMatches f={f} />} f={f} have={mineSets} /> : <>
      {mine.length > 0 && (
        <section style="margin-bottom:22px">
          <h2 style="margin-bottom:10px">My {tab === 'ride' ? 'workouts' : KIND_LABEL[tab].toLowerCase() + ' sessions'}</h2>
          <div class="grid">
            {mine.map((w) => tab === 'ride' ? <Card key={w.id} w={w} basis={data.profile?.basis ?? 'power'} profile={data.profile ?? undefined} onPick={() => setAdding(w)} f={f} have={mineSets} /> : <SessionCard key={w.id} w={w} onAdd={() => setAdding(w)} profile={data.profile ?? undefined} f={f} have={mineSets} />)}
          </div>
        </section>
      )}

      {tab === 'ride' ? (
        <>
          {ready.length === 0 && mine.length === 0 && <NothingMatches f={f} />}
          <div class="grid">{ready.map((w) => <Card key={w.id} w={w} basis={data.profile?.basis ?? 'power'} profile={data.profile ?? undefined} onPick={() => setAdding(w)} f={f} have={mineSets} />)}</div>
        </>
      ) : tab === 'strength' ? (
        <StrengthLibrary f={f} mine={mineSets} onAdd={setAdding} sortLine={(n: number) => <SortLine kind="strength" f={f} set={setF} count={n} noun={['session', 'sessions']} />} />
      ) : (
        <>
          <p class="muted small" style="margin:0 0 14px;max-width:62ch">
            {tab === 'mobility' && 'Stretching routines by what cycling tightens. Each one names the stretches and how long to hold them. Add one to any date, or make your own with New workout.'}
            {tab === 'walk' && 'Walks for days the bike is out, treadmill or outdoors, with or without a pack. Most are easy (no minimum, up to the top of zone 2); the Zone 2, Brisk, Hill and Incline walks get the heart rate up with speed or grade. Add one to any date, or make your own with New workout.'}
            {tab === 'run' && 'Runs by heart rate, sent to your devices as running workouts: easy, long, strides, tempo and hills. Add one to any date, whether or not your plan schedules runs; the plan itself only ever places the easy ones. With a threshold pace in Settings, each run also shows the pace its bands imply, as a guide.'}
          </p>
          {ready.length === 0 && mine.length === 0 && <NothingMatches f={f} />}
          <div class="grid">{ready.map((w) => <SessionCard key={w.id} w={w} onAdd={() => setAdding(w)} profile={data.profile ?? undefined} f={f} have={mineSets} />)}</div>
        </>
      )}

      </>}
      {adding && <AddToDate w={adding} basis={data.profile?.basis ?? 'power'} onClose={() => setAdding(null)} />}
    </div>
  );
}

/**
 * A ride in the library: family and basis, the workout's shape, its place name
 * and descriptive name, then length, load and intensity, and on a computer a
 * row of its own: Schedule (today, tomorrow, a date) and Ride now. On a
 * phone, tapping the card opens the workout's page, which has them all.
 */
function Card({ w, basis, profile, onPick, f, have }: { w: Workout; basis: 'power' | 'hr'; profile?: Profile; onPick: () => void; f: Filters; have: Mine }) {
  const hi = (k: Filters['sort']) => (sortIn(f, 'ride') === k ? ' sorted-by' : '');
  const s = workoutStats(w.blocks);
  const t = tagsOf(w);
  const [menu, setMenu] = useState(false);
  const add = async (date: string, day: string) => {
    setMenu(false);
    const r = await scheduleWorkout(w, date, basis);
    toast(r === 'already' ? { ok: false, text: alreadyText(w.name, date) } : { ok: true, text: `${w.name} is on ${day} calendar.` });
  };
  return (
    <div class="wcard ride">
      <a class="wcard-main" href={`#/workout/${w.id}?from=library`}>
        <div class="row between">
          <span class="row" style="gap:6px"><span class="tag" style={`--c:var(--z${s.dominantZone})`}>{PURPOSE_LABEL[t.purpose]}</span>{w.trainerOnly && <TrainerOnlyTag />}</span>
          <span class="row" style="gap:8px">{!w.trainerOnly && <span class="faint small" style="white-space:nowrap">{w.bases.includes('hr') ? 'power or HR' : 'power only'}</span>}<Star w={w} /></span>
        </div>
        <div class="profile"><WorkoutProfile blocks={w.blocks} height={56} targets={profile ? { profile, basis } : undefined} /></div>
        <h3>{w.name}</h3>
        <p class="wc-sub small">{w.subtitle ?? '\u00a0'}</p>
        <p class="wc-stats"><span><b class={`num${hi('length')}`}>{clock(s.seconds)}</b> time</span><span><b class={`num${hi('tss')}`}>{s.tss}</b> TSS</span><span title={`Intensity: ${GLOSSARY.intensity.short}`}><b class={`num${hi('intensity')}`}>{s.intensityFactor.toFixed(2)}</b> intensity</span>{sortIn(f, 'ride') === 'last' && <span class="sorted-by">done {lastDoneWords((have.last ?? have.recent).get(libraryKey(w)))}</span>}{t.outdoor === 'indoor' && !w.trainerOnly ? <span>indoors only</span> : w.setting !== 'any' && <span>{w.setting === 'outdoor' ? 'outdoors' : 'indoor'}</span>}</p>
      </a>
      <div class="wcard-actions">
        <div class="menu">
          <button class="btn sm" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>Schedule <span aria-hidden="true">▾</span></button>
          {menu && <>
            <div class="menu-bg" onClick={() => setMenu(false)} />
            <div class="menu-list" role="menu">
              <button role="menuitem" onClick={() => void add(today(), "today's")}>Today</button>
              <button role="menuitem" onClick={() => void add(addDays(today(), 1), "tomorrow's")}>Tomorrow</button>
              <button role="menuitem" onClick={() => { setMenu(false); onPick(); }}>Pick a date…</button>
            </div>
          </>}
        </div>
        {playerOffered() && <a class="btn sm" href={`#/play/workout/${w.id}`}>Ride now</a>}
      </div>
    </div>
  );
}

function SessionCard({ w, onAdd, profile, f, have }: { w: Workout; onAdd: () => void; profile?: Profile; f?: Filters; have?: Mine }) {
  const n = w.exercises?.length ?? 0;
  const detail = w.kind === 'walk'
    ? `${w.walk?.minutes ?? w.minutes} min · ${w.walk?.packKg ? `${Math.round(w.walk.packKg * 2.2)} lb pack` : 'no pack'} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : w.kind === 'run' ? `${w.minutes ?? '–'} min · ${runBandText(w, profile)} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}`;
  return (
    <div class="wcard" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between"><span class="row" style="gap:8px"><KindDot kind={w.kind as SessionKind} big /><span class="faint small">{KIND_LABEL[w.kind]}</span></span><span class="row" style="gap:8px"><span class="faint small" title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does.">{w.estimatedTss ? `≈ ${w.estimatedTss} TSS, estimated` : ''}</span><Star w={w} /></span></div>
      <a href={`#/workout/${w.id}?from=library`} style="color:inherit;text-decoration:none"><h3 style="margin:0">{w.name}</h3></a>
      <p class={`muted small${f?.sort === 'length' ? ' sorted-line' : ''}`} style="margin:0">{detail}</p>
      {f?.sort === 'tss' && <p class="small sorted-by" style="margin:0">≈ {w.estimatedTss ?? 0} TSS</p>}
      {f?.sort === 'last' && have && <p class="small sorted-by" style="margin:0">Done {lastDoneWords((have.last ?? have.recent).get(libraryKey(w)))}</p>}
      {w.exercises && (w.kind === 'strength' || w.kind === 'mobility') && picturedCount(w.exercises) >= 2 ? <PictureStrip exercises={w.exercises} max={4} fill /> : w.exercises && <p class="faint small" style="margin:0;line-height:1.4">{w.exercises.slice(0, 4).map((e) => e.name).join(' · ')}{n > 4 ? ` · +${n - 4}` : ''}</p>}
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
            <button class="btn primary" onClick={async () => { if (await scheduleWorkout(w, date, basis) === 'already') toast({ ok: false, text: alreadyText(w.name, date) }); else setDone(true); }}>Add to {date === today() ? 'today' : fmtDate(date)}</button>
            <button class="btn quiet" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * Rides on a phone (10 Nov 2026): a compact row each, in one list (your own first), in the list's own order. The
 * filters, folded behind one button, narrow it.
 */
function RideRows({ mine, ready, empty, f, have }: { mine: Workout[]; ready: Workout[]; empty: preact.ComponentChildren; f: Filters; have: Mine }) {
  if (!mine.length && !ready.length) return <>{empty}</>;
  // Your own first under Suggested; under any other sort, one list in that order.
  const list = sortIn(f, 'ride') === 'suggested' ? [...mine, ...ready] : applyFilters([...mine, ...ready], { ...f, query: '', purpose: 'all', outdoor: false, hrOnly: false, duration: 'all', show: 'all' }, 'ride', have);
  return <div class="ride-rows">{list.map((w) => <RideRow key={w.id} w={w} f={f} have={have} />)}</div>;
}

/** One ride as a row: its shape, name, one line of what it is, and the star. Tapping it opens the ride. */
function RideRow({ w, f, have }: { w: Workout; f: Filters; have: Mine }) {
  const s = workoutStats(w.blocks);
  const oneWay = w.trainerOnly ? 'trainer only' : w.bases.length > 1 ? '' : w.bases[0] === 'hr' ? 'heart rate only' : 'power only';
  // Length first and the one-way note next, so a long description is what gets cut short, never those.
  const mins = Math.round(s.seconds / 60);
  const length = mins >= 60 ? `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  // It leads with what the list is sorted by, in brighter text (10 Nov 2026); the length follows when it isn't the lead.
  const by = sortIn(f, 'ride');
  const lead = by === 'tss' ? `${s.tss} TSS` : by === 'intensity' ? `${s.intensityFactor.toFixed(2)} intensity` : by === 'last' ? `done ${lastDoneWords((have.last ?? have.recent).get(libraryKey(w)))}` : length;
  const rest = [lead === length ? '' : length, oneWay, w.subtitle ?? PURPOSE_LABEL[tagsOf(w).purpose]].filter(Boolean).join(' · ');
  return (
    <div class="ride-row">
      <a href={`#/workout/${w.id}?from=library`} class="ride-row-main">
        <span class="ride-row-shape"><WorkoutProfile blocks={w.blocks} height={30} ratio={2.2} /></span>
        <span class="ride-row-t"><b>{w.name}</b><span><span class="ride-row-lead">{lead}</span>{rest ? ` · ${rest}` : ''}</span></span>
      </a>
      <Star w={w} />
    </div>
  );
}
