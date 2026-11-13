import type { Family, Workout, WorkoutBlock, WorkoutRepeat, WorkoutStep } from '../engine/types';
import { withTags } from './tags';

/**
 * The dullest existing rides, reworked within the ride design guide (12 Nov 2026, brief B7). Chosen by the brief's
 * measure: hard rides that count toward one system with a main set of one effort repeated unchanged, where the
 * Library has other rides of the same shape differing only in the number or length of efforts (most such siblings
 * first); and easy rides of over an hour that are one unbroken steady block. Each keeps its name, its place in
 * plans, its length (the same, to the second) and its estimated load to within 10%, and still counts toward its
 * original system. Hard rides get interest from the kinds in the guide's section 3; easy ones from gentle changes
 * of pace and cadence inside zone 2 (section 4). What each became is listed in REWORKED, for the report.
 */

type Pattern = 'build' | 'ladder' | 'fast-start' | 'easy-waves';

const REWORK: Record<string, Pattern> = {
  // Sweet spot
  'lib-ss-3x15': 'build', 'lib-ss-2x20': 'ladder', 'lib-ss-3x10': 'build', 'lib-ss-2x12': 'build', 'in-ss-2x30': 'ladder',
  'in-ss-4x8': 'ladder', 'in-ss-3x8': 'build', 'b1-ss-2x18': 'build',
  // VO2max
  'lib-vo2-4x5': 'fast-start', 'lib-vo2-5x3': 'ladder', 'in-vo2-4x4': 'fast-start', 'in-vo2-5x2': 'ladder', 'lib-vo2-hr-4x4': 'build', 'lib-vo2-hr-5x5': 'fast-start',
  // Tempo
  'lib-tempo-2x20': 'build', 'lib-tempo-3x15': 'ladder', 'lib-tempo-2x12': 'build', 'b2-tempo-3x20': 'ladder',
  // Threshold
  'lib-thr-2x20': 'build', 'lib-thr-3x12': 'ladder', 'in-thr-3x10': 'build', 'in-thr-2x12': 'build',
  // Easy rides that were one unbroken steady block
  'lib-long-150': 'easy-waves', 'lib-long-180': 'easy-waves', 'lib-long-210': 'easy-waves', 'lib-long-240': 'easy-waves', 'lib-long-300': 'easy-waves',
  'lib-z2-105': 'easy-waves', 'b2-z2-steady-100': 'easy-waves', 'b2-z2-65': 'easy-waves',
};
export const REWORK_IDS = Object.keys(REWORK);

/**
 * Two targets inside each system, their middles five points of FTP or more apart. Each is a range at least four
 * points wide, so a ride that rode well outdoors still goes to a bike computer exactly as written.
 */
const PAIR: Partial<Record<Family, [number, number]>> = { tempo: [0.78, 0.84], sweetspot: [0.9, 0.935], threshold: [0.97, 1.02], vo2max: [1.08, 1.145] };
const HALF = 0.02;
const range = (mid: number) => ({ intensity: Math.round((mid - HALF) * 1000) / 1000, intensityHigh: Math.round((mid + HALF) * 1000) / 1000 });
const SYS_WORD: Partial<Record<Family, string>> = { tempo: 'tempo', sweetspot: 'sweet spot', threshold: 'threshold', vo2max: 'VO2max' };

const WHY: Record<Pattern, string> = {
  build: 'Each effort builds in two steps: settle in first, then lift it a notch for the last part, when holding form counts most.',
  ladder: 'The efforts get shorter as the target rises, so every one is hard but possible, and the last is the sharpest.',
  'fast-start': 'Each effort opens a notch higher to bring the breathing up quickly, then settles, so more of it is spent where it counts.',
  'easy-waves': 'An easy ride stays easy: small changes of pace and cadence inside zone 2 keep the legs and the mind awake for the whole of it.',
};
const SUB: Record<Pattern, string> = { build: 'building efforts', ladder: 'a descending ladder', 'fast-start': 'fast starts', 'easy-waves': 'gentle waves of pace and cadence' };

const cue = (text: string, kind: 'focus' | 'hard' = 'focus') => ({ at: 0, text, kind });

/** What each reworked ride became, in a line, for the report. */
export const REWORKED: Record<string, string> = {};

function mainSet(w: Workout): { index: number; set: WorkoutRepeat } | undefined {
  const i = w.blocks.findIndex((b) => b.kind === 'repeat' && b.steps.length === 2 && (b.steps[0].intensityHigh ? (b.steps[0].intensity + b.steps[0].intensityHigh) / 2 : b.steps[0].intensity) >= 0.75);
  return i >= 0 ? { index: i, set: w.blocks[i] as WorkoutRepeat } : undefined;
}

function hardRework(w: Workout, p: Exclude<Pattern, 'easy-waves'>): Workout | undefined {
  const pair = PAIR[w.family];
  const ms = mainSet(w);
  if (!pair || !ms) return undefined;
  const [effort, rest] = ms.set.steps;
  const n = ms.set.times;
  const word = SYS_WORD[w.family]!;
  const label = ms.set.label ?? effort.label ?? word;
  const own = effort.cues ?? [];
  let out: WorkoutBlock[];
  if (p === 'build') {
    // Each effort: three fifths at the lower target, two fifths at the higher.
    const a = Math.round((effort.seconds * 0.6) / 30) * 30, b = effort.seconds - a;
    out = [{ ...ms.set, steps: [
      { kind: 'step', seconds: a, ...range(pair[0]), label: `${label}, settle`, cues: own.length ? own : [cue(`Settle into ${word}: smooth and steady.`)] },
      { kind: 'step', seconds: b, ...range(pair[1]), label: `${label}, lift`, cues: [cue(`Lift it a notch for the last part. Same smooth pedalling, just more pressure.`), { at: -Math.min(60, Math.round(b / 3)), text: 'Nearly there. Hold it to the end.', kind: 'hard' as const, rep: 'last' as const }] },
      rest,
    ] }];
    REWORKED[w.id] = `${n} × ${Math.round(effort.seconds / 60)} min of ${word}, each now ${Math.round(a / 60 * 10) / 10} min at ${Math.round(pair[0] * 100)}% then ${Math.round(b / 60 * 10) / 10} min at ${Math.round(pair[1] * 100)}%`;
  } else if (p === 'ladder') {
    // The same total work in efforts that shorten as the target rises: from a fifth longer to a fifth shorter.
    const total = effort.seconds * n;
    const weights = Array.from({ length: n }, (_, k) => (n === 1 ? 1 : 1.2 - (0.4 * k) / (n - 1)));
    const sum = weights.reduce((x, y) => x + y, 0);
    const lens = weights.map((x) => Math.round(((total * x) / sum) / 30) * 30);
    lens[n - 1] += total - lens.reduce((x, y) => x + y, 0);
    const tgt = (k: number) => Math.round((pair[0] + ((pair[1] - pair[0]) * k) / Math.max(1, n - 1)) * 1000) / 1000;
    out = [];
    lens.forEach((len, k) => {
      out.push({ kind: 'step', seconds: len, ...range(tgt(k)), label: `${label} ${k + 1} of ${n}`, cues: k === 0 ? (own.length ? own : [cue(`The longest and gentlest of the set. Settle in.`)]) : k === n - 1 ? [cue('The last and shortest, at the highest target. Everything steady to the end.', 'hard')] : [cue('A little shorter, a little higher. Lift the pressure, keep it smooth.')] });
      if (k < n - 1 || ms.index < w.blocks.length - 1) out.push({ ...rest, cues: rest.cues });
    });
    REWORKED[w.id] = `${n} × ${Math.round(effort.seconds / 60)} min of ${word} became a descending ladder of ${lens.map((x) => Math.round(x / 60 * 10) / 10).join(', ')} min, from ${Math.round(tgt(0) * 100)}% to ${Math.round(tgt(n - 1) * 100)}%`;
  } else {
    // Fast starts: the first minute (or the first third of a short effort) a notch higher, then settle.
    const a = Math.min(60, Math.round(effort.seconds / 3 / 15) * 15), b = effort.seconds - a;
    out = [{ ...ms.set, steps: [
      { kind: 'step', seconds: a, ...range(pair[1]), label: `${label}, fast start`, cues: [cue('Open it up: a notch higher to bring the breathing up.')] },
      { kind: 'step', seconds: b, ...range(pair[0]), label: `${label}, settle`, cues: own.length ? own : [cue(`Now settle and hold ${word} to the end.`)] },
      rest,
    ] }];
    REWORKED[w.id] = `${n} × ${Math.round(effort.seconds / 60)} min of ${word}, each now opening with ${a} s at ${Math.round(pair[1] * 100)}% then ${Math.round(b / 60 * 10) / 10} min at ${Math.round(pair[0] * 100)}%`;
  }
  const blocks = [...w.blocks.slice(0, ms.index), ...out, ...w.blocks.slice(ms.index + 1)];
  return { ...w, blocks };
}

/** Easy waves: the long steady block becomes blocks of 20, 10 and 15 minutes in turn, each a different pace or cadence inside zone 2. */
function easyRework(w: Workout): Workout | undefined {
  const i = w.blocks.findIndex((b) => b.kind === 'step' && b.seconds >= 2700 && !/warm|cool/i.test(b.label ?? ''));
  if (i < 0) return undefined;
  const block = w.blocks[i] as WorkoutStep;
  const WAVES: Array<{ min: number; lo: number; hi: number; cadence: number; text: string }> = [
    { min: 20, lo: 0.62, hi: 0.68, cadence: 90, text: 'All-day pace at 90 rpm. Full sentences, steady breathing.' },
    { min: 10, lo: 0.68, hi: 0.73, cadence: 85, text: 'A touch firmer at 85 rpm: the top of zone 2, still easy to talk.' },
    { min: 15, lo: 0.6, hi: 0.66, cadence: 95, text: 'Ease back and spin at 95. Light feet, quiet hips.' },
  ];
  const parts: WorkoutStep[] = [];
  let left = block.seconds, k = 0;
  while (left > 0) {
    const wv = WAVES[k % WAVES.length];
    let secs = Math.min(left, wv.min * 60);
    // A last piece too short to mean anything joins the one before.
    if (left - secs > 0 && left - secs < 300) secs = left;
    parts.push({ kind: 'step', seconds: secs, intensity: wv.lo, intensityHigh: wv.hi, cadence: wv.cadence, label: k % 3 === 1 ? 'Zone 2, firmer' : k % 3 === 2 ? 'Zone 2, quick feet' : 'Zone 2', cues: [{ at: 0, text: wv.text, kind: 'focus' }] });
    left -= secs; k++;
  }
  REWORKED[w.id] = `one steady block of ${Math.round(block.seconds / 60)} min became ${parts.length} blocks of ${[...new Set(parts.map((x) => Math.round(x.seconds / 60)))].join(', ')} min, moving between 62–68% at 90 rpm, 68–73% at 85 rpm and 60–66% at 95 rpm`;
  return { ...w, blocks: [...w.blocks.slice(0, i), ...parts, ...w.blocks.slice(i + 1)] };
}

/** The ride reworked, when it is one of the chosen; any other ride as it is. */
export function reworked(w: Workout): Workout {
  const p = REWORK[w.id];
  if (!p || w.kind !== 'ride') return w;
  const r = p === 'easy-waves' ? easyRework(w) : hardRework(w, p);
  if (!r) return w;
  const subtitle = w.subtitle ? `${w.subtitle}, ${SUB[p]}` : undefined;
  return withTags({ ...r, subtitle, why: WHY[p], tags: undefined }, w.tags?.series ? { series: w.tags.series } : undefined);
}
