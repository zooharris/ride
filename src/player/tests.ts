/**
 * Fitness tests in the ride player: the rules that run during a test, and (Part C)
 * the arithmetic that turns its recording into results. Pure, so it is tested.
 */

/** Below this share of the step's target, held for ten seconds, the ramp has given out. */
export const RAMP_GIVE_OUT = 0.85;

/**
 * Whether the Ramp Test should end by itself now: from the second ramp step on,
 * at least five seconds into the step, the last ten seconds' average power under
 * 85% of the step's target. A cadence collapse in ERG shows here too (the
 * trainer eases off and the power falls). Ten seconds with fewer than eight
 * power readings (a sensor dropping out) decide nothing.
 */
export function rampGaveOut(last10: Array<number | undefined>, target: number, secondsIntoStep: number, rampStep: number): boolean {
  if (rampStep < 2 || secondsIntoStep < 5 || target <= 0) return false;
  const ws = last10.slice(-10).filter((w): w is number => w != null);
  if (ws.length < 8) return false;
  return ws.reduce((a, b) => a + b, 0) / ws.length < RAMP_GIVE_OUT * target;
}
