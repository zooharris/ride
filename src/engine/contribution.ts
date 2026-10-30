import type { Equipment, StrengthFocus, StrengthQuality, Workout, WorkoutBlock, WorkoutStep } from './types';
import { workoutStats } from './workout';
import { EXERCISES, type Pattern } from '../library/strength';
import { MOBILITY, type Target } from '../library/mobility';

/**
 * What a Library workout gives a week (30 Oct 2026, the plan engine). Worked
 * out from the workout itself, with no hand-tagging: a ride's minutes at each
 * ability come from its steps; a strength session's qualities from its
 * exercises; a walk's or run's aerobic minutes from its length. The shopper
 * (shop.ts) fills a week's needs from these.
 */
export type Ability = 'easy' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2' | 'anaerobic';
export const ABILITIES: Ability[] = ['easy', 'tempo', 'sweetspot', 'threshold', 'vo2', 'anaerobic'];
/** Hard abilities, hardest last; easy is the fill. */
export const QUALITY_ABILITIES: Ability[] = ['tempo', 'sweetspot', 'threshold', 'vo2', 'anaerobic'];

/**
 * The bands, as shares of threshold (FTP, or threshold heart rate for a heart-rate step):
 * easy 0.56–0.75, tempo 0.76–0.87, sweet spot 0.88–0.94, threshold 0.95–1.05, VO2 1.06–1.20,
 * anaerobic above. Recovery (under 0.56) counts as easy at half weight. The edges sit
 * between the whole-percent values so a step at 0.755 is easy and one at 0.76 tempo.
 */
const EDGES: Array<[Ability | 'recovery', number]> = [['recovery', 0.555], ['easy', 0.755], ['tempo', 0.875], ['sweetspot', 0.945], ['threshold', 1.055], ['vo2', 1.205], ['anaerobic', Infinity]];

export function abilityOf(intensity: number): Ability | 'recovery' {
  for (const [a, top] of EDGES) if (intensity < top) return a;
  return 'anaerobic';
}

export type Minutes = Record<Ability, number>;
export const zeroMinutes = (): Minutes => ({ easy: 0, tempo: 0, sweetspot: 0, threshold: 0, vo2: 0, anaerobic: 0 });

/** Minutes at each ability for one step: a point target in one band; a range spread evenly across the bands it spans. */
function stepMinutes(s: WorkoutStep, out: Minutes, times = 1): void {
  const min = (s.seconds / 60) * times;
  const add = (a: Ability | 'recovery', m: number) => { if (a === 'recovery') out.easy += m * 0.5; else out[a] += m; };
  // No floor: the rider may go as easy as they like; the step is ridden around its expected effort.
  if (s.intensityHigh == null || s.noFloor || s.intensityHigh <= s.intensity) { add(abilityOf(s.intensity), min); return; }
  const lo = s.intensity, hi = s.intensityHigh, span = hi - lo;
  let from = lo;
  for (const [a, top] of EDGES) {
    if (from >= hi) break;
    const to = Math.min(hi, top);
    if (to > from) add(a, min * (to - from) / span);
    from = Math.max(from, to);
  }
}

export function rideMinutes(blocks: WorkoutBlock[]): Minutes {
  const out = zeroMinutes();
  for (const b of blocks) {
    if (b.kind === 'step') stepMinutes(b, out);
    else for (const s of b.steps) stepMinutes(s, out, b.times);
  }
  return out;
}

export interface Contribution {
  kind: Workout['kind'];
  minutes: number;          // whole session
  tss: number;
  /** Ride minutes at each ability; walks and runs carry their aerobic equivalent as easy. */
  at: Minutes;
  /** The hardest ability with real work in it (five minutes or more); 'easy' for a ride with none. */
  dominant: Ability;
  /** Minutes above easy, all abilities together. */
  work: number;
  // strength
  quality?: StrengthQuality;
  qualities?: Partial<Record<StrengthQuality, number>>;
  focus?: StrengthFocus;
  patterns?: Pattern[];
  needs?: Equipment[];
  // mobility
  targets?: Target[];
  // walks and runs
  packKg?: number;
  /** A pack of 6 kg or more counts toward strength endurance. */
  strengthEndurance?: boolean;
  /** A walk or ride easy enough to count as recovery. */
  recovery?: boolean;
}

const cache = new Map<string, Contribution>();

/** Memoised by id for Library workouts (their content never changes in a session); anything else is computed each time. */
export function contribution(w: Workout): Contribution {
  const key = w.source === 'library' ? `${w.id}|${w.strength?.dose ?? ''}` : '';
  if (key && cache.has(key)) return cache.get(key)!;
  const c = compute(w);
  if (key) cache.set(key, c);
  return c;
}

const LEG_PATTERNS: Pattern[] = ['squat', 'hinge', 'single-leg', 'hip'];

function compute(w: Workout): Contribution {
  if (w.kind === 'ride') {
    const st = workoutStats(w.blocks);
    const at = rideMinutes(w.blocks);
    const work = QUALITY_ABILITIES.reduce((s, a) => s + at[a], 0);
    const dominant = [...QUALITY_ABILITIES].reverse().find((a) => at[a] >= 5) ?? (work >= 5 ? QUALITY_ABILITIES.reduce((b, a) => (at[a] > at[b] ? a : b), 'tempo' as Ability) : 'easy');
    return { kind: 'ride', minutes: st.seconds / 60, tss: st.tss, at, dominant, work, recovery: w.family === 'recovery' && w.subtitle !== 'Openers' && w.name !== 'Openers' };
  }
  const minutes = w.walk?.minutes ?? w.minutes ?? 0;
  const tss = w.estimatedTss ?? 0;
  const at = zeroMinutes();
  if (w.kind === 'walk') {
    const pack = w.walk?.packKg ?? 0;
    at.easy = minutes * (pack >= 6 ? 0.65 : 0.5);
    const recovery = (w.walk?.zoneHigh ?? 3) <= 2;
    return { kind: 'walk', minutes, tss, at, dominant: 'easy', work: 0, packKg: pack || undefined, strengthEndurance: pack >= 6, recovery };
  }
  if (w.kind === 'run') {
    // A run's aerobic work counts at one and a half times its minutes, and so does what it costs to recover from.
    const hard = (w.run?.steps ?? []).some((s) => s.band === 'tempo' || s.band === 'hard');
    at.easy = minutes * 1.5;
    return { kind: 'run', minutes, tss, at, dominant: 'easy', work: hard ? minutes * 0.3 : 0 };
  }
  if (w.kind === 'mobility') {
    const targets = new Set<Target>();
    for (const e of w.exercises ?? []) { const m = MOBILITY.find((x) => x.name === e.name); if (m) targets.add(m.target); }
    return { kind: 'mobility', minutes, tss, at, dominant: 'easy', work: 0, targets: [...targets], recovery: true };
  }
  if (w.kind === 'strength') {
    const qualities: Partial<Record<StrengthQuality, number>> = {};
    const patterns: Pattern[] = [];
    const needs = new Set<Equipment>();
    for (const e of w.exercises ?? []) {
      const d = EXERCISES.find((x) => x.name === e.name);
      if (!d) continue;
      patterns.push(d.pattern);
      d.qualities.forEach((q, i) => { qualities[q] = (qualities[q] ?? 0) + (i === 0 ? 1 : 0.5); });
      for (const q of e.equipment ?? d.equipment) if (q !== 'bodyweight') needs.add(q);
    }
    const quality = w.strength?.quality ?? (Object.entries(qualities).sort((a, b) => b[1] - a[1])[0]?.[0] as StrengthQuality | undefined);
    const legs = patterns.filter((p) => LEG_PATTERNS.includes(p)).length / Math.max(1, patterns.length);
    const upper = patterns.filter((p) => p === 'push' || p === 'pull').length / Math.max(1, patterns.length);
    const focus: StrengthFocus = w.strength?.focus ?? (upper >= 0.4 ? 'upper' : legs >= 0.5 ? 'legs' : 'full');
    return { kind: 'strength', minutes, tss, at, dominant: 'easy', work: 0, quality, qualities, focus, patterns, needs: w.strength?.needs ?? [...needs] };
  }
  return { kind: w.kind, minutes, tss, at, dominant: 'easy', work: 0 };
}
