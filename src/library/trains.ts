import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';

/**
 * What a ride trains, measured from its own steps (12 Nov 2026, the ride design guide, section 1; brief B1). Seven
 * systems, each with a band of FTP and the least that counts; warm-up, cool-down and easy spells never count; sprints
 * count as efforts; a short on-off set counts whole as VO2max; a system present but short of its minimum is shown as
 * "too little". The numbers are the same for every rider: shares of FTP and plain minutes.
 */

export type System = 'sprint' | 'anaerobic' | 'vo2' | 'threshold' | 'sweetspot' | 'tempo' | 'endurance';

export interface SystemDef {
  id: System;
  name: string;
  /** The least that counts: efforts for sprints, seconds for the rest. */
  min: number;
  /** What a full session of it holds, for the bar on a ride's page (same unit as `min`). */
  full: number;
  unit: 'efforts' | 'seconds';
}

/** Hardest first: the order a ride's label is built in, and the default order of efforts in a ride. */
export const SYSTEMS: SystemDef[] = [
  { id: 'sprint', name: 'Sprint', min: 3, full: 8, unit: 'efforts' },
  { id: 'anaerobic', name: 'Anaerobic', min: 120, full: 480, unit: 'seconds' },
  { id: 'vo2', name: 'VO2max', min: 300, full: 960, unit: 'seconds' },
  { id: 'threshold', name: 'Threshold', min: 480, full: 1800, unit: 'seconds' },
  { id: 'sweetspot', name: 'Sweet spot', min: 600, full: 2700, unit: 'seconds' },
  { id: 'tempo', name: 'Tempo', min: 720, full: 2700, unit: 'seconds' },
  { id: 'endurance', name: 'Endurance', min: 1500, full: 3600, unit: 'seconds' },
];
export const SYSTEM: Record<System, SystemDef> = Object.fromEntries(SYSTEMS.map((s) => [s.id, s])) as Record<System, SystemDef>;

/** Skills a ride can teach (guide, section 12). */
export type Skill = 'leg-speed' | 'low-cadence' | 'smooth' | 'single-leg' | 'standing' | 'steady-power' | 'sprint-starts' | 'breathing';
export const SKILL_NAME: Record<Skill, string> = {
  'leg-speed': 'Leg speed', 'low-cadence': 'Low-cadence strength', smooth: 'Smooth pedalling', 'single-leg': 'Single-leg work',
  standing: 'Standing and seated climbing', 'steady-power': 'Holding power steady', 'sprint-starts': 'Sprint starts', breathing: 'Breathing control',
};

/** The longest an all-out effort can be and still be a sprint; a longer one is anaerobic work. */
export const SPRINT_MAX_S = 20;
/** What an all-out step counts as when a ride's load is estimated before it is ridden: a stand-in for the sums only, never a target. */
export const ALL_OUT_STANDIN = 1.8;

/** Which system a step's effort is in, by the middle of its target; undefined below endurance. */
export function bandOf(st: WorkoutStep): Exclude<System, 'sprint'> | 'sprint' | undefined {
  if (st.allOut) return st.seconds <= SPRINT_MAX_S ? 'sprint' : 'anaerobic';
  const i = st.intensityHigh ? (st.intensity + st.intensityHigh) / 2 : st.intensity;
  // A very hard short step with a percentage target (older rides): a sprint in all but name.
  if (i >= 1.5 && st.seconds <= SPRINT_MAX_S) return 'sprint';
  if (i > 1.2) return 'anaerobic';
  if (i > 1.05) return 'vo2';
  if (i >= 0.95) return 'threshold';
  if (i >= 0.88) return 'sweetspot';
  if (i >= 0.75) return 'tempo';
  if (i >= 0.55) return 'endurance';
  return undefined;
}

const WARM_COOL = /warm|cool/i;
const EASY_LABEL = /easy|recover|rest|between|spin it out/i;
const isWork = (st: WorkoutStep) => !!st.allOut || (st.intensityHigh ? (st.intensity + st.intensityHigh) / 2 : st.intensity) >= 0.75;

interface Flat { st: WorkoutStep; inWorkSet: boolean; top: boolean }

function flat(blocks: WorkoutBlock[]): Flat[] {
  const out: Flat[] = [];
  for (const b of blocks) {
    if (b.kind === 'step') { out.push({ st: b, inWorkSet: false, top: true }); continue; }
    const work = b.steps.some(isWork);
    for (let i = 0; i < b.times; i++) for (const st of b.steps) out.push({ st, inWorkSet: work, top: false });
  }
  return out;
}

export interface TrainsPart { sys: System; amount: number; counts: boolean }
export interface Trains {
  /** Every system present, hardest first, with how much and whether it reaches the least that counts. */
  parts: TrainsPart[];
  /** The systems that count, hardest first. */
  counted: System[];
  /** More than three count: the guide's limit is three (listed in the report, never changed silently). */
  overThree: boolean;
  /** "Sprint, VO2max and threshold"; for a ride where nothing counts, "Recovery" or "A skill ride". */
  label: string;
}

/** How much of each system a ride's steps hold, and which count. */
export function trainsOf(w: Pick<Workout, 'blocks' | 'family' | 'skills'>): Trains {
  const steps = flat(w.blocks);
  const amount: Record<System, number> = { sprint: 0, anaerobic: 0, vo2: 0, threshold: 0, sweetspot: 0, tempo: 0, endurance: 0 };
  const taken = new Set<number>();
  // A short on-off set: efforts of a minute or less at VO2max or above, each followed by a rest no longer than it
  // and below tempo; three pairs or more in a row. The whole set's length counts as VO2max.
  for (let i = 0; i + 1 < steps.length;) {
    let j = i, pairs = 0;
    while (j + 1 < steps.length) {
      const on = steps[j].st, off = steps[j + 1].st;
      const onI = on.intensityHigh ? (on.intensity + on.intensityHigh) / 2 : on.intensity;
      if (!on.allOut && onI > 1.05 && on.seconds <= 60 && !isWork(off) && off.seconds <= on.seconds) { pairs++; j += 2; } else break;
    }
    if (pairs >= 3) { for (let k = i; k < j; k++) { taken.add(k); amount.vo2 += steps[k].st.seconds; } i = j; } else i++;
  }
  // The first and last runs of easy steps are the warm-up and cool-down, whatever their labels say, in a ride with work.
  const anyWork = steps.some((x) => isWork(x.st));
  let firstWork = steps.findIndex((x) => isWork(x.st)); if (firstWork < 0) firstWork = 0;
  let lastWork = steps.length - 1; while (lastWork > 0 && !isWork(steps[lastWork].st)) lastWork--;
  steps.forEach((x, k) => {
    if (taken.has(k)) return;
    const st = x.st;
    const sys = bandOf(st);
    if (!sys) return;
    if (WARM_COOL.test(st.label ?? '')) return;
    if (sys === 'endurance') {
      // Easy spells never count: a recovery inside a set of efforts, one named as easy, or a short one between efforts.
      // A spell named as easy, or a short one inside a set of efforts, is a rest. Five minutes or more of zone 2 is
      // endurance riding wherever it sits: in a set with sprints or tempo efforts as much as on its own (13 Nov 2026).
      if (EASY_LABEL.test(st.label ?? '')) return;
      if (x.inWorkSet && st.seconds < 300) return;
      if (anyWork && (k < firstWork || k > lastWork) && x.top && st.seconds <= 900 && (k === 0 || k === steps.length - 1)) return;
      if (anyWork && k > firstWork && k < lastWork && st.seconds < 300) return;
    }
    amount[sys] += sys === 'sprint' ? 1 : st.seconds;
  });
  const parts: TrainsPart[] = SYSTEMS.filter((s) => amount[s.id] > 0).map((s) => ({ sys: s.id, amount: amount[s.id], counts: amount[s.id] >= s.min }));
  const counted = parts.filter((p) => p.counts).map((p) => p.sys);
  const name = (s: System) => SYSTEM[s].name;
  const list = counted.slice(0, 3).map((s, i) => (i === 0 ? name(s) : name(s).replace(/^(?!VO2)\w/, (c) => c.toLowerCase())));
  const label = list.length === 0 ? (w.skills?.length ? 'A skill ride' : w.family === 'recovery' ? 'Recovery' : 'Easy riding')
    : list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return { parts, counted, overThree: counted.length > 3, label };
}

/** "4 efforts", "12 min", "3 min 20". */
export function amountWords(p: Pick<TrainsPart, 'sys' | 'amount'>): string {
  if (p.sys === 'sprint') return `${p.amount} effort${p.amount === 1 ? '' : 's'}`;
  const m = Math.floor(p.amount / 60), s = Math.round(p.amount % 60);
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`;
}

/** The Library family a ride is filed under: the family of the hardest system it counts toward (sprints file under anaerobic). */
export function familyFor(t: Trains, fallback: Workout['family']): Workout['family'] {
  const top = t.counted[0];
  if (!top) return fallback;
  return top === 'sprint' || top === 'anaerobic' ? 'anaerobic' : top === 'vo2' ? 'vo2max' : top;
}
