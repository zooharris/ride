import type { CueKind, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { bandOf, SPRINT_MAX_S, type System } from './trains';

/**
 * Written cues of the five kinds for the Library's existing rides (12 Nov 2026, brief B5; the ride design guide,
 * section 11). A ride's own cues always win: these are added only where a ride has nothing to say at that moment.
 * Each ride gets, where it fits: a "why" line at its first hard effort; a "what comes next" line in the last half
 * minute of an easy spell before a hard effort; a word at the hard point of its last effort; and (at ride time, so
 * a rider does not see the same one twice running) a short lesson in any easy spell of three minutes or more.
 * Every line is text only, at most 110 characters, spoken plainly to the rider, promises nothing, and carries no
 * number that belongs to one rider.
 */

export const CUE_MAX = 110;

/** Short, true, general statements about training, for easy spells. One shared list; a ride never repeats one. */
export const LESSONS: string[] = [
  'Easy spells are part of the session: the next effort is only as good as this rest.',
  'Fitness is built in the recovery after training, not during the effort itself.',
  'Breathing comes down before the legs recover. Wait for both before going again.',
  'Easy riding builds the engine every harder effort runs on.',
  'Most of a good week is easy. The hard days only work because the easy ones are easy.',
  'Drink a little now. Thirst is a late signal on a trainer.',
  'A steady effort costs less than the same average ridden in surges.',
  'Relaxed shoulders and a loose grip save energy for the legs.',
  'Smooth circles waste less than stamping on the pedals.',
  'Heart rate lags the legs by a minute or more; power tells you the effort now.',
  'Cadence is a choice: higher spares the muscles, lower spares the heart and lungs.',
  'Short hard efforts teach the body to clear what it makes while still working.',
  'Sweet spot gives a lot of fitness for the recovery it costs.',
  'Threshold is the effort you could hold for about an hour, fresh and well paced.',
  'VO2max work raises the ceiling every other effort sits under.',
  'Sprints train the nerves as much as the muscles, so they need fresh legs.',
  'The first effort of a set should feel too easy. If it does not, the last will be too hard.',
  'Even pacing beats a fast start: the last effort tells you how well you paced the first.',
  'Sleep is where the training turns into fitness.',
  'Carbohydrate fuels hard efforts; eat before the hard part, not after it.',
  'A rest week is part of training, not a break from it.',
  'Consistency over weeks matters more than any single session.',
  'Long easy rides teach the body to use fat and spare its carbohydrate.',
  'A hard day ridden easy is a missed chance; an easy day ridden hard spoils the next one.',
  'Breathe out fully. A full breath out makes room for a full breath in.',
  'Keep the upper body still: movement there is power that never reaches the pedals.',
  'Pedal through the bottom of the stroke as if scraping mud off your shoe.',
  'In a long effort, settle in the first minute and judge it in the last.',
  'Riding well when tired is a skill, and it is trained by doing it.',
  'Variety in training keeps the body adapting; the same session every week stops working.',
  'Strength and mobility work off the bike keep the body able to train on it.',
  'A cool-down helps you feel better tomorrow; it is not wasted time.',
  'Feeling flat one day is normal. One session never makes or breaks a season.',
  'Fitness comes back faster than it was first built.',
  'Recovery between efforts is active: keep the legs turning lightly.',
  'The body adapts to what you ask of it, so ask clearly: easy easy, hard hard.',
  'Tempo is comfortably hard: you could talk in short sentences.',
  'Zone 2 should feel easy enough to hold a conversation the whole way.',
  'Standing shares the work with other muscles; sit back down before the effort drops.',
  'A good warm-up makes the first hard effort feel less of a shock.',
  'Look ahead and relax your face; tension spreads from the jaw to the shoulders.',
  'Hard efforts feel longer near the end than they are. Count down, not up.',
];

/** Why a hard effort matters, by the system it trains. */
const WHY: Record<System, string> = {
  sprint: 'Sprints keep the top end sharp: short, all out, and done on fresh legs.',
  anaerobic: 'Efforts this hard train the power to attack, close a gap or get over a steep rise.',
  vo2: 'Efforts well over threshold raise your ceiling, which lifts every effort under it.',
  threshold: 'Threshold work raises the power you can hold for a long climb or a hard hour.',
  sweetspot: 'Sweet spot builds the power you can hold for a long time, at a modest cost in recovery.',
  tempo: 'Tempo builds endurance at a steady, firm pace you could hold for a long time.',
  endurance: 'Steady endurance riding builds the aerobic base every harder effort depends on.',
};

const isEasy = (s: WorkoutStep) => !s.allOut && (s.intensityHigh ? (s.intensity + s.intensityHigh) / 2 : s.intensity) < 0.75;
const isHard = (s: WorkoutStep) => !!s.allOut || !isEasy(s);
const WARM = /warm|cool/i;

function mins(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/** What the next step asks, in plain words: "Next: 4 minutes at VO2max effort." */
export function nextWords(s: WorkoutStep): string {
  if (s.allOut) return 'Next: a sprint, all out. Get ready.';
  const b = bandOf(s);
  const what: Record<System, string> = { sprint: 'a sprint', anaerobic: 'well over threshold', vo2: 'at VO2max effort', threshold: 'at threshold', sweetspot: 'of sweet spot', tempo: 'of tempo', endurance: 'of steady riding' };
  if (b === 'sprint' || (s.seconds <= SPRINT_MAX_S && b === 'anaerobic')) return 'Next: a short, very hard effort. Get ready.';
  return `Next: ${mins(s.seconds)} ${b ? what[b] : 'easy'}. Settle your breathing now.`;
}

const near = (cues: WorkoutStep['cues'], seconds: number, at: number, within: number): boolean =>
  (cues ?? []).some((c) => Math.abs((c.at < 0 ? seconds + c.at : c.at) - (at < 0 ? seconds + at : at)) < within);

const add = (s: WorkoutStep, kind: CueKind, at: number, text: string, rep?: number | 'last'): WorkoutStep =>
  ({ ...s, cues: [...(s.cues ?? []), { at, text, kind, ...(rep != null ? { rep } : {}) }] });

/** A ride with "why", "next" and "hard" lines added where it fits and has nothing to say. Lessons are added at ride time. */
export function withCueKinds(w: Workout): Workout {
  if (w.kind !== 'ride' || w.family === 'test') return w;
  const has = (k: CueKind) => w.blocks.some((b) => (b.kind === 'step' ? [b] : b.steps).some((s) => s.cues?.some((c) => c.kind === k)));
  const blocks: WorkoutBlock[] = w.blocks.map((b) => (b.kind === 'step' ? { ...b } : { ...b, steps: b.steps.map((s) => ({ ...s })) }));
  // Positions in ride order: [block, step in block].
  const pos: Array<[number, number]> = [];
  blocks.forEach((b, bi) => (b.kind === 'step' ? pos.push([bi, -1]) : b.steps.forEach((_, si) => pos.push([bi, si]))));
  const get = ([bi, si]: [number, number]) => { const b = blocks[bi]; return b.kind === 'step' ? b : b.steps[si]; };
  const set = ([bi, si]: [number, number], s: WorkoutStep) => { const b = blocks[bi]; if (b.kind === 'step') blocks[bi] = s; else b.steps[si] = s; };

  // Why: at the first hard effort that is not part of the warm-up.
  if (!has('why')) {
    const k = pos.findIndex((p) => isHard(get(p)) && !WARM.test(get(p).label ?? ''));
    if (k >= 0) {
      const s = get(pos[k]);
      const sys = bandOf(s);
      const text = sys ? WHY[sys] : undefined;
      const inSet = pos[k][1] >= 0;
      if (text) {
        // Said just before the effort, in the easy spell that leads into it, so the effort's own opening line stands;
        // when there is no such spell, twenty seconds into the effort.
        const p = k > 0 ? get(pos[k - 1]) : undefined;
        if (p && isEasy(p) && p.seconds >= 90 && !near(p.cues, p.seconds, -50, 15)) set(pos[k - 1], add(p, 'why', -50, text, pos[k - 1][1] >= 0 ? 1 : undefined));
        else if (s.seconds >= 60 && !near(s.cues, s.seconds, 20, 15)) set(pos[k], add(s, 'why', 20, text, inSet ? 1 : undefined));
      }
    }
  }
  // Next: the last half-minute of an easy spell of a minute or more that comes before a hard effort.
  if (!has('next')) {
    pos.forEach((p, k) => {
      const s = get(p);
      if (!isEasy(s) || s.seconds < 60 || /cool/i.test(s.label ?? '')) return;
      const [bi, si] = p;
      const b = blocks[bi];
      if (b.kind === 'step') {
        const n = pos[k + 1] ? get(pos[k + 1]) : undefined;
        if (n && isHard(n) && !near(s.cues, s.seconds, -30, 20)) set(p, add(s, 'next', -30, nextWords(n)));
        return;
      }
      // Inside a set: the next step is the set's next one, or its first on the next repetition, or what follows the set.
      const inside = si + 1 < b.steps.length ? b.steps[si + 1] : undefined;
      if (inside) { if (isHard(inside) && !near(s.cues, s.seconds, -30, 20)) set(p, add(s, 'next', -30, nextWords(inside))); return; }
      if (near(s.cues, s.seconds, -30, 20)) return;
      const first = b.steps[0];
      let cur = s;
      if (isHard(first)) for (let r = 1; r < b.times; r++) cur = add(cur, 'next', -30, nextWords(first), r);
      const after = bi + 1 < blocks.length ? (blocks[bi + 1].kind === 'step' ? blocks[bi + 1] as WorkoutStep : (blocks[bi + 1] as { steps: WorkoutStep[] }).steps[0]) : undefined;
      if (after && isHard(after)) cur = add(cur, 'next', -30, nextWords(after), 'last');
      set(p, cur);
    });
  }
  // Hard: the last hard effort of the ride, near its end.
  if (!has('hard')) {
    for (let k = pos.length - 1; k >= 0; k--) {
      const s = get(pos[k]);
      if (!isHard(s) || WARM.test(s.label ?? '')) continue;
      const at = s.allOut || s.seconds < 40 ? 0 : -Math.min(60, Math.round(s.seconds / 3));
      if (!near(s.cues, s.seconds, at, 15)) set(pos[k], add(s, 'hard', at, at === 0 ? 'The last one. Everything you have left.' : s.seconds >= 300 ? 'The last part of the last effort. Hold it steady to the end.' : 'Last one, nearly done. Hold it to the end.', pos[k][1] >= 0 ? 'last' : undefined));
      // A line the ride already has at that moment ("Last minute. Hold it to the end.") is its word at the hard point.
      else set(pos[k], { ...s, cues: s.cues!.map((c) => (!c.kind && Math.abs((c.at < 0 ? s.seconds + c.at : c.at) - (at < 0 ? s.seconds + at : at)) < 15 ? { ...c, kind: 'hard' as const } : c)) });
      break;
    }
  }
  return { ...w, blocks };
}

/**
 * A lesson in each easy spell of three minutes or more that has nothing to say a minute in, taken in turn from
 * LESSONS starting at `start`, so a ride never repeats one and the next ride carries on where this one stopped.
 * Rides that carry their own lessons keep them. Returns the ride and how many lessons it used.
 */
export function withLessons(w: Workout, start = 0): { workout: Workout; used: number } {
  if (w.kind !== 'ride' || w.family === 'test') return { workout: w, used: 0 };
  if (w.blocks.some((b) => (b.kind === 'step' ? [b] : b.steps).some((s) => s.cues?.some((c) => c.kind === 'lesson')))) return { workout: w, used: 0 };
  let used = 0;
  const next = () => LESSONS[(start + used++) % LESSONS.length];
  const fit = (s: WorkoutStep) => isEasy(s) && s.seconds >= 180 && !WARM.test(s.label ?? '') && !near(s.cues, s.seconds, 60, 25);
  const blocks = w.blocks.map((b): WorkoutBlock => {
    if (b.kind === 'step') return fit(b) && used < LESSONS.length ? add(b, 'lesson', 60, next()) : b;
    // In a set, one lesson for each repetition, so none repeats within the ride.
    return { ...b, steps: b.steps.map((s) => { if (!fit(s)) return s; let cur = s; for (let r = 1; r <= b.times && used < LESSONS.length; r++) cur = add(cur, 'lesson', 60, next(), r); return cur; }) };
  });
  return { workout: { ...w, blocks }, used };
}
