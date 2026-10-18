import { useState } from 'preact/hooks';
import type { AppData } from '../store';
import { allWorkouts } from '../store';
import { WorkoutProfile } from '../Profile';
import { clock, workoutStats } from '../../engine/workout';
import { FAMILY_LABEL } from '../../library/workouts';
import type { Family } from '../../engine/types';

const ORDER: Family[] = ['recovery', 'endurance', 'tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'];

export function Library({ data }: { data: AppData }) {
  const [family, setFamily] = useState<Family | 'all'>('all');
  const list = allWorkouts(data.mine).filter((w) => family === 'all' || w.family === family);
  return (
    <div>
      <div class="page-head">
        <h1>Library</h1>
        <span class="muted small">{list.length} workouts</span>
      </div>
      <div class="chips" style="margin-bottom:18px">
        <button class={`chip${family === 'all' ? ' on' : ''}`} onClick={() => setFamily('all')}>All</button>
        {ORDER.map((f) => <button key={f} class={`chip${family === f ? ' on' : ''}`} onClick={() => setFamily(f)}>{FAMILY_LABEL[f]}</button>)}
      </div>
      <div class="grid">
        {list.map((w) => {
          const s = workoutStats(w.blocks);
          return (
            <a class="wcard" key={w.id} href={`#/workout/${w.id}?from=library`}>
              <div class="row between">
                <span class="tag" style={`background:var(--z${s.dominantZone})`}>{FAMILY_LABEL[w.family]}</span>
                <span class="faint small">{w.bases.includes('hr') ? 'power or HR' : 'power only'}</span>
              </div>
              <WorkoutProfile blocks={w.blocks} height={56} />
              <h3>{w.name}</h3>
              <p class="muted small">{clock(s.seconds)} · {s.tss} TSS · IF {s.intensityFactor.toFixed(2)}</p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
