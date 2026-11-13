import type { Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { amountWords, SKILL_NAME, SYSTEM, trainsOf } from '../library/trains';
import { workoutStats, clock } from '../engine/workout';

/**
 * A ride's page (12 Nov 2026, brief B2): what it trains, measured from its steps, in one line; why its efforts come in the order they do; and its family, every level with what it changes.
 */
export function RideTrains({ w }: { w: Workout }) {
  if (w.kind !== 'ride' || w.family === 'test') return null;
  const t = trainsOf(w);
  const seriesId = w.tags?.series?.id ?? (w.libraryId ? LIBRARY.find((x) => x.id === w.libraryId)?.tags?.series?.id : undefined);
  const levels = seriesId ? LIBRARY.filter((x) => x.tags?.series?.id === seriesId).sort((a, b) => a.tags!.series!.rung - b.tags!.series!.rung) : [];
  const here = w.libraryId ?? w.id;
  // One plain line (13 Nov 2026): only what counts, with how much of it. The bars and the "too little" rows are gone.
  const low = (n: string) => n.toLowerCase().replace('vo2max', 'VO2max');
  const got = t.parts.filter((p) => p.counts).map((p) => `${low(SYSTEM[p.sys].name)}, ${amountWords(p)}`);
  const said = got.length === 0
    ? (w.skills?.length ? 'a skill rather than an energy system' : 'nothing hard or long enough to count: an easy ride')
    : got.length === 1 ? got[0] : got.length === 2 ? `${got[0]}, and ${got[1]}` : `${got.slice(0, -1).join('; ')}; and ${got[got.length - 1]}`;
  return (
    <>
      <section class="section">
        <p style="margin:0"><b>Trains:</b> {said}{said.endsWith('.') ? '' : '.'}</p>
        {w.skills?.length ? <div class="chips" style="margin-top:8px" aria-label="Skills">{w.skills.map((s) => <span key={s} class="chip sm static">{SKILL_NAME[s]}</span>)}</div> : null}
      </section>
      {w.why && (
        <section class="section">
          <h2>Why it is built this way</h2>
          <p style="margin:4px 0 0">{w.why}</p>
        </section>
      )}
      {levels.length > 1 && (
        <section class="section">
          <h2>Its family</h2>
          <p class="faint small" style="margin:4px 0 8px">The same ride at {levels.length} levels; each changes one thing from the one before.</p>
          <ol class="fam" role="list">
            {levels.map((x) => {
              const s = workoutStats(x.blocks);
              const on = x.id === here;
              const what = x.levelChange ? x.levelChange.charAt(0).toUpperCase() + x.levelChange.slice(1) : x.tags!.series!.rung === levels[0].tags!.series!.rung ? 'Where it starts' : x.subtitle ?? '';
              return (
                <li key={x.id} class={`fam-row${on ? ' on' : ''}`}>
                  {on ? <span class="fam-l"><b>Level {x.tags!.series!.rung}</b> · this ride</span>
                    : <a class="fam-l" href={`#/workout/${x.id}?from=library`}><b>Level {x.tags!.series!.rung}</b> · {x.name.replace(/, level \d+$/, '')}</a>}
                  <span class="fam-what small">{what}</span>
                  <span class="fam-n faint small">{clock(s.seconds)} · {s.tss} TSS</span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}
