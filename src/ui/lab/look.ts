/**
 * The Lab's colours (28 Nov 2026), as approved in the "Antogo Lab charts" designs: gold for fitness and for this
 * season, violet for fatigue, one colour for each kind of work from recovery grey to sprint red, cyan and red for
 * the overnight readings. Each is a variable set in lab.css, with a darker set for the light theme so every one
 * still reads on a pale page.
 */
export const C = {
  gold: 'var(--lc-gold)', violet: 'var(--lc-violet)', good: 'var(--lc-good)', watch: 'var(--lc-watch)',
  rec: 'var(--lc-rec)', end: 'var(--lc-end)', tempo: 'var(--lc-tempo)', thr: 'var(--lc-thr)', vo2: 'var(--lc-vo2)', sprint: 'var(--lc-sprint)',
  cyan: 'var(--lc-cyan)', purple: 'var(--lc-purple)', sleep: 'var(--lc-sleep)', balanced: 'var(--lc-balanced)',
  grey: 'var(--lc-grey)', grey2: 'var(--lc-grey2)', bar: 'var(--lc-bar)', white: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)',
} as const;

/** The seven power zones in the Lab's colours: recovery, endurance, tempo, threshold, VO2max, then the two above it. */
export const ZC = [C.rec, C.end, C.tempo, C.thr, C.vo2, C.sprint, C.purple];
/** The five heart-rate zones. */
export const HZC = [C.rec, C.end, C.tempo, C.thr, C.sprint];
/** Form's four named zones, lowest first. */
export const FORM_C = [C.sprint, C.gold, C.balanced, C.good];

export type Kind = 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'vo2' | 'sprint' | 'run' | 'strength' | 'walk' | 'mobility' | 'other';
export const KIND_C: Record<Kind, string> = { recovery: C.rec, endurance: C.end, tempo: C.tempo, threshold: C.thr, vo2: C.vo2, sprint: C.sprint, run: C.purple, strength: 'var(--strength)', walk: 'var(--walk)', mobility: 'var(--mobility)', other: C.grey };
export const KIND_NAME: Record<Kind, string> = { recovery: 'Recovery', endurance: 'Endurance', tempo: 'Tempo', threshold: 'Threshold', vo2: 'VO2max', sprint: 'Sprint', run: 'Run', strength: 'Strength', walk: 'Walk', mobility: 'Mobility', other: 'Other' };
