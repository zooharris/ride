import { useEffect, useState } from 'preact/hooks';
import type { Equipment, StrengthDose, StrengthQuality, Workout } from '../engine/types';
import { getSetting, setSetting } from '../data/db';
import { getCurrentEquipment, readyMade } from './store';
import { DOSE_WORDS, EQUIPMENT_WORDS, FOCUS_WORDS, hasNeeds, redose } from '../library/strengthSessions';
import { strengthTss } from '../library/sessions';
import { QUALITY_LABEL } from '../library/strength';
import { PictureStrip, picturedCount } from './ExercisePictures';
import { applyFilters, type Filters } from './LibraryFilters';

/**
 * The Library's Strength tab (30 Oct 2026): sessions by what they train, a switch
 * between the rider's equipment and everything (a gym included), and a level
 * switch that sets the sets, reps and load on every card. A session the rider's
 * equipment does not allow says what it needs and can still be added.
 */
export const ALL_EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk'];
const LEVELS: StrengthDose[] = ['foundation', 'build', 'maintain', 'light'];
const QUALITIES: StrengthQuality[] = ['heavy', 'power', 'endurance', 'stability'];
const LEAD: Record<StrengthQuality, string> = {
  heavy: 'Few reps, big lifts: the strength masters riders lose fastest and gain most from. A plan uses it early in a block, while the riding is steady.',
  power: 'Moving a load fast: swings, quick step-ups and lunges. The bridge from strength to sprints and standing climbs; a plan uses it as the riding gets harder, and late in the block for group rides.',
  endurance: 'Higher reps, carries and long holds: legs and a trunk that last. A plan uses it late in the block for a century, a long climb or a time trial.',
  stability: 'Single-leg lifts and hip control: finds and fixes the weaker side. Good after a lay-off, and on any day heavy work would cost too much.',
};
const LEVEL_NOTE: Record<StrengthDose, string> = {
  foundation: 'Foundation: 3 sets of 10–12 at a moderate weight, to learn the movements.',
  build: 'Build: 4 sets of 6–8, heavier; the level that builds strength.',
  maintain: 'Maintain: 2 sets of 8 at Build weights; keeps strength while the riding is hard.',
  light: 'Light: 2 sets of 10, light and quick; recovery and taper weeks.',
};

interface Prefs { show: 'mine' | 'all'; level: StrengthDose }
const PREFS_KEY = 'libraryStrength';

export function useStrengthPrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, setP] = useState<Prefs>({ show: 'mine', level: 'build' });
  useEffect(() => { getSetting<Prefs | null>(PREFS_KEY, null).then((v) => { if (v) setP((x) => ({ ...x, ...v })); }).catch(() => {}); }, []);
  return [p, (next) => setP((prev) => { const v = { ...prev, ...next }; void setSetting(PREFS_KEY, v).catch(() => {}); return v; })];
}

export function StrengthLibrary({ f, onAdd }: { f: Filters; onAdd: (w: Workout) => void }) {
  const [prefs, setPrefs] = useStrengthPrefs();
  const mine = getCurrentEquipment();
  const pool = readyMade(prefs.show === 'all' ? ALL_EQUIPMENT : mine).filter((w) => w.kind === 'strength' && w.source === 'library');
  const list = applyFilters(pool.map((w) => (w.strength ? redose(w, prefs.level, strengthTss) : w)), f, 'strength');
  const byQuality = (q: StrengthQuality) => list.filter((w) => w.strength?.quality === q);
  const purpose = list.filter((w) => !w.strength);
  return (
    <div>
      <div class="str-switches">
        <div class="str-switch">
          <span class="small muted">Show sessions for</span>
          <div class="seg" role="group" aria-label="Show sessions for">
            <button class={prefs.show === 'mine' ? 'on' : ''} aria-pressed={prefs.show === 'mine'} onClick={() => setPrefs({ show: 'mine' })}>My equipment</button>
            <button class={prefs.show === 'all' ? 'on' : ''} aria-pressed={prefs.show === 'all'} onClick={() => setPrefs({ show: 'all' })}>Everything, gym included</button>
          </div>
        </div>
        <div class="str-switch">
          <span class="small muted">Level</span>
          <div class="seg" role="group" aria-label="Level">
            {LEVELS.map((l) => <button key={l} class={prefs.level === l ? 'on' : ''} aria-pressed={prefs.level === l} onClick={() => setPrefs({ level: l })}>{DOSE_WORDS[l]}</button>)}
          </div>
        </div>
      </div>
      <p class="muted small" style="margin:0 0 16px;max-width:66ch">{LEVEL_NOTE[prefs.level]} {prefs.show === 'mine' ? 'Showing what your equipment allows (as ticked in your plan’s week); switch to Everything to see the gym sessions too.' : 'Showing every session; those that need equipment you have not ticked say what they need.'}</p>
      {list.length === 0 && <div class="empty small"><b>Nothing matches.</b><span class="small muted">Widen the length or clear the search.</span></div>}
      {QUALITIES.map((q) => byQuality(q).length > 0 && (
        <section key={q} class="str-group">
          <h2>{QUALITY_LABEL[q]}</h2>
          <p class="muted small str-lead">{LEAD[q]}</p>
          <div class="grid">{byQuality(q).map((w) => <StrengthCard key={w.id} w={w} have={mine} onAdd={() => onAdd(w)} />)}</div>
        </section>
      ))}
      {purpose.length > 0 && (
        <section class="str-group">
          <h2>For a purpose</h2>
          <p class="muted small str-lead">Sessions with one job each, for a particular day: a hotel room, a short trunk session, the aero position. Their sets and reps are their own; plans don’t schedule these, so add one when the day calls for it.</p>
          <div class="grid">{purpose.map((w) => <StrengthCard key={w.id} w={w} have={mine} onAdd={() => onAdd(w)} />)}</div>
        </section>
      )}
    </div>
  );
}

function StrengthCard({ w, have, onAdd }: { w: Workout; have: Equipment[]; onAdd: () => void }) {
  const missing = w.strength ? w.strength.needs.filter((q) => !have.includes(q)) : [];
  const ex = w.exercises ?? [];
  return (
    <div class="wcard" style="display:flex;flex-direction:column;gap:8px">
      <div class="row between wrap" style="gap:6px">
        <span class="faint small">Strength{w.strength ? ` · ${FOCUS_WORDS[w.strength.focus]}` : ''}</span>
        {missing.length > 0 && !hasNeeds(w.strength!.needs, have) && <span class="tag" style="--c:var(--z5)">Needs {missing.map((q) => EQUIPMENT_WORDS[q] ?? q).join(', ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>}
      </div>
      <a href={`#/workout/${w.id}?from=library`} style="color:inherit;text-decoration:none"><h3 style="margin:0">{w.name}</h3></a>
      <p class="muted small" style="margin:0">{w.subtitle ? `${w.subtitle} · ` : ''}about {w.minutes} min · {ex.length} exercises</p>
      {picturedCount(ex) >= 2 && <PictureStrip exercises={ex} max={6} fill />}
      <p class="faint small" style="margin:0;line-height:1.4">{ex.map((e) => e.name).join(' · ')}</p>
      <div class="row" style="gap:6px;margin-top:auto"><button class="btn sm" onClick={onAdd}>Add to a date</button><a class="btn sm quiet" href={`#/workout/${w.id}?from=library`}>View</a></div>
    </div>
  );
}
