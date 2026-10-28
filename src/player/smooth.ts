/**
 * Calming the power marker on the riding screen (Todd, 27 Oct: it jumped
 * about with every pedal stroke). The big number keeps the rider's chosen
 * average; the marker follows a smoother, recency-weighted average, and the
 * On target / Under / Over label changes only after a few seconds on the new
 * side. Pure, so it is tested.
 */

/** One second of an exponentially weighted average; `tau` seconds is how long it takes to move about two thirds of the way to a new level. */
export function ewma(prev: number | undefined, x: number, dtS = 1, tau = 4): number {
  return prev == null ? x : prev + (x - prev) * (1 - Math.exp(-dtS / tau));
}

export type BandState = 'on' | 'under' | 'over';

export function bandOf(w: number, low: number, high: number): BandState {
  return w < low ? 'under' : w > high ? 'over' : 'on';
}

export interface Settled { state?: BandState; pending?: BandState; count: number }

/** The label moves to a new state only after `need` seconds in a row there; the first reading sets it at once. */
export function settle(prev: Settled, now: BandState, need = 3): Settled {
  if (!prev.state) return { state: now, count: 0 };
  if (now === prev.state) return { state: prev.state, count: 0 };
  const count = prev.pending === now ? prev.count + 1 : 1;
  return count >= need ? { state: now, count: 0 } : { state: prev.state, pending: now, count };
}
