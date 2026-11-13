import type { Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { amountWords, SKILL_NAME, SYSTEM, trainsOf } from '../library/trains';
import { workoutStats, clock } from '../engine/workout';

/**
 * A ride's page (12 Nov 2026, brief B2): what it trains, measured from its steps, with each system's bar against the
 * least that counts; why its efforts come in the order they do; and its family, every level with what it changes.
 */
export function RideTrains({ w }: { w: Workout }) {
  if (w.kind !== 'ride' || w.family === 'test') return null;
  const t = trainsOf(w);
  const seriesId = w.tags?.series?.id ?? (w.libraryId ? LIBRARY.find((x) => x.id === w.libraryId)?.tags?.series?.id : undefined);
  const levels = seriesId ? LIBRARY.filter((x) => x.tags?.series?.id === seriesId).sort((a, b) => a.tags!.series!.rung - b.tags!.series!.rung) : [];
  const here = w.libraryId ?? w.id;
  return (
    <>
      <section class="section">
        <h2>What this ride trains</h2>
        <p class="small" style="margin:4px 0 8px"><b>{t.label}.</b>{t.counted.length === 0 ? (w.skills?.length ? ' It teaches a skill rather than training an energy system.' : ' Nothing in it is long or hard enough to count toward a system: an easy ride.') : ''}</p>
        {t.parts.length > 0 && (
          <div class="trains" role="list">
            {t.parts.map((p) => {
              const d = SYSTEM[p.sys];
              const span = Math.max(d.full, p.amount, d.min * 1.2);
              return (
                <div key={p.sys} class={`trains-row${p.counts ? ' counts' : ''}`} role="listitem" aria-label={`${d.name}: ${amountWords(p)}, ${p.counts ? 'counts' : `too little; ${amountWords({ sys: p.sys, amount: d.min })} counts`}`}>
                  <span class="trains-name">{d.name}</span>
                  <span class="trains-bar" aria-hidden="true"><i style={`width:${Math.min(100, (p.amount / span) * 100)}%`} /><b style={`left:${(d.min / span) * 100}%`} title="the least that counts" /></span>
                  <span class="trains-amt">{amountWords(p)}</span>
                  <span class={`trains-says${p.counts ? ' good-t' : ' faint'}`}>{p.counts ? 'counts' : 'too little'}</span>
                </div>
              );
            })}
            <p class="faint small" style="margin:4px 0 0">The mark on each bar is the least that counts: {[...new Set(t.parts.map((p) => p.sys))].map((s) => `${SYSTEM[s].name.toLowerCase().replace('vo2max', 'VO2max')} ${amountWords({ sys: s, amount: SYSTEM[s].min })}`).join(', ')}. Warm-up, cool-down and easy spells never count.</p>
          </div>
        )}
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
