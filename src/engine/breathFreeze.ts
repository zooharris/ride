/**
 * A breathing strap that froze mid-ride (Step 3 Part 2, 2E, 31 Oct 2026).
 * A Garmin data field can lose the strap at an auto-pause and keep showing its last
 * number to the end (first seen on a ride of 31 Oct 2026): on that ride the field lost the strap at an
 * auto-pause and kept writing its last values for the rest of the ride: a flat
 * line that is not breathing. Real breathing never holds ventilation and
 * breathing rate to the hundredth for two minutes, so a run like that, lasting
 * to the end of the recording, is a freeze. Pure.
 */

/** Seconds a flat run must last to count as a freeze. */
export const FREEZE_SECONDS = 120;
const SAME = 0.01;

const ok = (v: number | undefined): v is number => typeof v === 'number' && isFinite(v);

/**
 * The second from which breathing is frozen: ventilation and breathing rate both
 * stay the same (to 0.01) from there to the end of the stream, for 120 seconds
 * or more of the ride. A flat run that later changes again is not a freeze (the
 * strap came back). Seconds with no breathing at all don't break a run.
 */
export function findBreathFreeze(time: number[], ve?: number[], br?: number[]): { at: number; index: number } | undefined {
  if (!ve || !br) return undefined;
  const n = Math.min(time.length, ve.length, br.length);
  let last = -1;
  for (let i = n - 1; i >= 0; i--) if (ok(ve[i]) && ok(br[i])) { last = i; break; }
  if (last < 0) return undefined;
  const v = ve[last], b = br[last];
  let first = last;
  for (let i = last - 1; i >= 0; i--) {
    if (!ok(ve[i]) || !ok(br[i])) continue;
    if (Math.abs(ve[i] - v) > SAME || Math.abs(br[i] - b) > SAME) break;
    first = i;
  }
  // A frozen strap keeps sending its value: a run of a few seconds followed by no readings at all is a strap
  // that stopped, not one that froze (Part A, 4 Nov 2026), and those seconds are real breathing.
  if (time[last] - time[first] < 30) return undefined;
  // The run lasts to the end of the ride, not only to the last breathing value.
  const end = time[time.length - 1];
  if (end - time[first] < FREEZE_SECONDS) return undefined;
  return { at: time[first], index: first };
}

export interface Breathing { ve?: number[]; br?: number[]; tv?: number[]; frozenAt?: number }

/**
 * An activity's breathing as everything downstream may use it: cut at a
 * freeze (NaN from that second on, all three together), with the freeze's
 * second. Streams without breathing come back unchanged.
 */
export function breathingOf<T extends { time: number[]; ve?: number[]; br?: number[]; tv?: number[] }>(s: T): T & { frozenAt?: number } {
  const f = findBreathFreeze(s.time, s.ve, s.br);
  if (!f) return s;
  const cut = (a?: number[]) => (a ? a.map((x, i) => (i >= f.index ? NaN : x)) : a);
  return { ...s, ve: cut(s.ve), br: cut(s.br), tv: cut(s.tv), frozenAt: f.at };
}
