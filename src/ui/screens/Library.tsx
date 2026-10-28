import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { allWorkouts, alreadyText, scheduleWorkout } from '../store';
import { runBandText } from '../../engine/run';
import { WorkoutProfile } from '../Profile';
import { clock, workoutStats } from '../../engine/workout';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Profile, SessionKind, Workout } from '../../engine/types';
import { KIND_LABEL, KindDot } from './Plan';
import { KIND_ICON } from '../icons';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';
import { PageHead } from '../PageHead';
import { toast } from '../Toast';
import { GLOSSARY } from '../glossary';
import { PictureStrip, picturedCount } from '../ExercisePictures';
import { applyFilters, FilterBar, useFilters } from '../LibraryFilters';

type Tab = 'ride' | 'strength' | 'mobility' | 'walk' | 'run';
const TABS: Array<[Tab, string]> = [['ride', 'Rides'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['walk', 'Walks'], ['run', 'Runs']];

export function Library({ data }: { data: AppData }) {
  const [tab, setTab] = useState<Tab>('ride');
  const [adding, setAdding] = useState<Workout | null>(null);
  const [f, setF] = useFilters();
  const list = applyFilters(allWorkouts(data.mine).filter((w) => w.kind === tab && w.source !== 'generated'), f, tab);
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
      <FilterBar kind={tab} f={f} set={setF} />
      {mine.length > 0 && (
        <section style="margin-bottom:22px">
          <h2 style="margin-bottom:10px">My {tab === 'ride' ? 'workouts' : KIND_LABEL[tab].toLowerCase() + ' sessions'}</h2>
          <div class="grid">
            {mine.map((w) => tab === 'ride' ? <Card key={w.id} w={w} basis={data.profile?.basis ?? 'power'} profile={data.profile ?? undefined} onPick={() => setAdding(w)} /> : <SessionCard key={w.id} w={w} onAdd={() => setAdding(w)} profile={data.profile ?? undefined} />)}
          </div>
        </section>
      )}

      {tab === 'ride' ? (
        <>
          {ready.length === 0 && mine.length === 0 && <div class="empty small"><b>Nothing matches.</b><span class="small muted">Widen the length, pick another type, or clear the search.</span></div>}
          <div class="grid">{ready.map((w) => <Card key={w.id} w={w} basis={data.profile?.basis ?? 'power'} profile={data.profile ?? undefined} onPick={() => setAdding(w)} />)}</div>
        </>
      ) : (
        <>
          <p class="muted small" style="margin:0 0 14px;max-width:62ch">
            {tab === 'strength' && 'Built for your equipment from the planner’s own sessions: the same lifts, sets and reps a plan would give you, at each level. Add one to any date, or make your own with New workout.'}
            {tab === 'mobility' && 'Stretching routines by what cycling tightens. Each one names the stretches and how long to hold them. Add one to any date, or make your own with New workout.'}
            {tab === 'walk' && 'Walks for days the bike is out, treadmill or outdoors, with or without a pack. Most are easy (no minimum, up to the top of zone 2); the Zone 2, Brisk, Hill and Incline walks get the heart rate up with speed or grade. Add one to any date, or make your own with New workout.'}
            {tab === 'run' && 'Runs by heart rate, sent to your Garmin as running workouts: easy, long, strides, tempo and hills. Add one to any date, whether or not your plan schedules runs; the plan itself only ever places the easy ones. With a threshold pace in Settings, each run also shows the pace its bands imply, as a guide.'}
          </p>
          <div class="grid">{ready.map((w) => <SessionCard key={w.id} w={w} onAdd={() => setAdding(w)} profile={data.profile ?? undefined} />)}</div>
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
function Card({ w, basis, profile, onPick }: { w: Workout; basis: 'power' | 'hr'; profile?: Profile; onPick: () => void }) {
  const s = workoutStats(w.blocks);
  return (
    <div class="wcard ride">
      <a class="wcard-main" href={`#/workout/${w.id}?from=library`}>
        <div class="row between">
          <span class="tag" style={`--c:var(--z${s.dominantZone})`}>{FAMILY_LABEL[w.family]}</span>
          <span class="faint small">{w.bases.includes('hr') ? 'power or HR' : 'power only'}</span>
        </div>
        <div class="profile"><WorkoutProfile blocks={w.blocks} height={56} targets={profile ? { profile, basis } : undefined} /></div>
        <h3>{w.name}</h3>
        <p class="wc-sub small">{w.subtitle ?? '\u00a0'}</p>
        <p class="wc-stats"><span><b class="num">{clock(s.seconds)}</b> time</span><span><b class="num">{s.tss}</b> TSS</span><span title={`Intensity: ${GLOSSARY.intensity.short}`}><b class="num">{s.intensityFactor.toFixed(2)}</b> intensity</span>{w.setting !== 'any' && <span>{w.setting === 'outdoor' ? 'outdoors' : 'indoor'}</span>}</p>
      </a>
      <div class="wcard-actions">
        <button class="btn sm" onClick={async () => { const r = await scheduleWorkout(w, today(), basis); toast(r === 'already' ? { ok: false, text: alreadyText(w.name, today()) } : { ok: true, text: `${w.name} is on today's calendar.` }); }}>Ride today</button>
        <button class="btn sm" onClick={onPick}>Pick a date</button>
        <a class="btn sm quiet" href={`#/play/workout/${w.id}`}>Ride it now</a>
      </div>
    </div>
  );
}

function SessionCard({ w, onAdd, profile }: { w: Workout; onAdd: () => void; profile?: Profile }) {
  const n = w.exercises?.length ?? 0;
  const detail = w.kind === 'walk'
    ? `${w.walk?.minutes ?? w.minutes} min · ${w.walk?.packKg ? `${Math.round(w.walk.packKg * 2.2)} lb pack` : 'no pack'} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : w.kind === 'run' ? `${w.minutes ?? '–'} min · ${runBandText(w, profile)} · ${w.setting === 'indoor' ? 'treadmill' : 'outdoors'}`
    : `${w.minutes ?? '–'} min · ${n} ${w.kind === 'strength' ? 'exercises' : 'stretches'}`;
  return (
    <div class="wcard" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between"><span class="row" style="gap:8px"><KindDot kind={w.kind as SessionKind} big /><span class="faint small">{KIND_LABEL[w.kind]}</span></span><span class="faint small" title="Estimated training stress (TSS) for this session; it counts toward fitness and fatigue the way a ride’s TSS does.">{w.estimatedTss ? `≈ ${w.estimatedTss} TSS, estimated` : ''}</span></div>
      <a href={`#/workout/${w.id}?from=library`} style="color:inherit;text-decoration:none"><h3 style="margin:0">{w.name}</h3></a>
      <p class="muted small" style="margin:0">{detail}</p>
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

