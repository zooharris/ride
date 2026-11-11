import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';

type Cue = NonNullable<WorkoutStep['cues']>[number];

/**
 * In-ride cues for the Library's first 96 rides (10 Nov 2026, Part C batch 2), so every Library ride speaks in
 * the player. Written from each step's own effort and length, and only where a step has none: a ride's
 * hand-written cues always win. The words are general coaching, never a rider's number.
 */
const LABELLED: Array<[RegExp, string]> = [
  [/^warm/i, 'Ease in. Let the legs warm up before anything is asked of them.'],
  [/^pickup/i, 'A short pickup. Lift the pace, then settle back.'],
  [/^burst/i, 'Burst! Short and sharp.'],
  [/^surge/i, 'Surge: a hard push, then hold on.'],
  [/^hard start/i, 'A hard start to get the breathing up, then settle.'],
  [/^sprint/i, 'Sprint! Everything, all the way through.'],
  [/^blow out/i, 'Blow the legs out: hard to the end.'],
  [/^high cadence|^spin-up/i, 'Spin it up: a quick cadence at an easy effort. Smooth, no bouncing.'],
  [/^climb/i, 'A climb. Seated, steady pressure to the top.'],
  [/^finish/i, 'The finish. Bring it home.'],
  [/^test, lap/i, 'The test. As hard as you can hold evenly to the end. Press lap at ten minutes.'],
  [/^test/i, 'The test. As hard as you can hold evenly to the end.'],
  [/^step \d|^stage \d/i, 'A step up. Hold it steady until the next one.'],
  [/^zone 2 for the rest|^zone 2 home/i, 'Zone 2 for the rest of the ride. Steady and easy.'],
  [/^tempo finish/i, 'Tempo to finish. Steady pressure.'],
  [/^tempo in the bunch/i, 'Tempo in the bunch. Stay near the front, smooth.'],
];

function byEffort(s: WorkoutStep, afterWork: boolean, first: boolean, last: boolean): string {
  const x = s.intensity;
  if (x < 0.6) {
    if (first) return 'Ease in. Let the legs warm up before anything is asked of them.';
    if (last) return 'The work is done. Spin it out easy.';
    return afterWork ? 'Recover. Easy spin; let the breathing settle.' : 'Easy. Keep the legs turning lightly.';
  }
  if (x < 0.76) return first ? 'Ease in at zone 2.' : 'Zone 2. Steady and conversational.';
  if (x < 0.84) return 'Tempo: steady pressure, breathing deeper but controlled.';
  if (x < 0.91) return 'Sweet spot: firm but sustainable. Smooth pedalling, relaxed shoulders.';
  if (x < 1.06) return s.seconds < 120 ? 'A short hard effort. Lift the pace and hold it.' : 'Threshold: hard and steady. Settle in; do not spike it.';
  if (x < 1.2) return s.seconds < 60 ? 'Hard and short. Go.' : 'VO2max: breathing hard. Hold it even; do not start too fast.';
  return s.seconds <= 20 ? 'Sprint! Everything, all the way through.' : 'Very hard. Commit to it, then hold on.';
}

const isWork = (s: WorkoutStep) => s.intensity >= 0.76;

function cuesFor(s: WorkoutStep, afterWork: boolean, first: boolean, last: boolean, inRepeat: number): Cue[] {
  const label = s.label ?? '';
  const text = LABELLED.find(([re]) => re.test(label))?.[1] ?? byEffort(s, afterWork, first, last);
  const out: Cue[] = [{ at: 0, text }];
  if (isWork(s) && s.seconds >= 8 * 60) out.push({ at: -60, text: 'Last minute. Hold it to the end.' });
  if (isWork(s) && inRepeat >= 3 && s.seconds >= 60) out.push({ at: 0, text: 'The last one. Finish it as well as the first.', rep: 'last' });
  return out;
}

/** The ride with a cue on every step that had none. */
export function withAutoCues(w: Workout): Workout {
  if (w.kind !== 'ride') return w;
  const n = w.blocks.length;
  let prevWork = false;
  const blocks: WorkoutBlock[] = w.blocks.map((b, bi) => {
    if (b.kind === 'step') {
      const s = b.cues?.length ? b : { ...b, cues: cuesFor(b, prevWork, bi === 0, bi === n - 1, 0) };
      prevWork = isWork(b);
      return s;
    }
    // Inside a repeat, the step before the first is the set's last step (from the second round on).
    const steps = b.steps.map((s, si) => {
      const before = si > 0 ? b.steps[si - 1] : b.steps[b.steps.length - 1];
      const afterWork = si > 0 ? isWork(before) : prevWork || (b.times > 1 && isWork(before));
      // "The last one" goes on the set's last hard step only, so an over-under says it once.
      const lastWork = b.steps.map(isWork).lastIndexOf(true);
      return s.cues?.length ? s : { ...s, cues: cuesFor(s, afterWork, false, false, si === lastWork ? b.times : 0) };
    });
    prevWork = isWork(b.steps[b.steps.length - 1]);
    return { ...b, steps };
  });
  return { ...w, blocks };
}
