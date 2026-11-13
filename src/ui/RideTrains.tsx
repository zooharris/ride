import type { Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { amountWords, SKILL_NAME, SYSTEM, trainsOf } from '../library/trains';
import { workoutStats, clock } from '../engine/workout';

/**
 * A ride's page (12 Nov 2026, brief B2): what it trains, measured from its steps, in one line; why its efforts come in the order they do; and its family, every level with what it changes.
 */
export function RideTrains({ w }: { w: Workout }) {
  if (w.kind !== 'ride' || w.family === 'test') return null;
  const seriesId = w.tags?.series?.id ?? (w.libraryId ? LIBRARY.find((x) => x.id === w.libraryId)?.tags?.series?.id : undefined);
  const levels = seriesId ? LIBRARY.filter((x) => x.tags?.series?.id === seriesId).sort((a, b) => a.tags!.series!.rung - b.tags!.series!.rung) : [];
  const here = w.libraryId ?? w.id;
  return (
    <>
      <section class="section">
        <TrainsLine w={w} />
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

/**
 * "Trains: sweet spot, 40 min, and endurance, 30 min." with "Also touches: …" where it applies (13 Nov 2026: shared by a
 * ride's page and Copy and edit, where it follows the steps as they are edited). Measured from the steps, with the
 * same least-that-counts minimums everywhere.
 */
export function TrainsLine({ w }: { w: Pick<Workout, 'blocks' | 'family' | 'skills'> }) {
  const t = trainsOf(w);
  const low = (n: string) => n.toLowerCase().replace('vo2max', 'VO2max');
  const got = t.parts.filter((p) => p.counts).map((p) => `${low(SYSTEM[p.sys].name)}, ${amountWords(p)}`);
  const listed = (xs: string[]) => (xs.length === 1 ? xs[0] : xs.length === 2 ? `${xs[0]}, and ${xs[1]}` : `${xs.slice(0, -1).join('; ')}; and ${xs[xs.length - 1]}`);
  const touched = t.touches.length ? listed(t.touches.map((p) => `${low(SYSTEM[p.sys].name)}, ${amountWords(p)}`)) : '';
  const said = got.length === 0
    ? (w.skills?.length ? 'a skill rather than an energy system' : 'nothing hard or long enough to count: an easy ride')
    : listed(got);
  return <p class="trains-line" style="margin:0"><b>Trains:</b> {said}.{touched ? <> <span class="muted"><b>Also touches:</b> {touched}.</span></> : null}</p>;
}
