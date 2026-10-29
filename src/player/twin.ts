/**
 * The Garmin rule (brief D): when the rider's Garmin recorded the same ride as
 * the player, the Garmin's recording is the one kept (it is the one in Garmin
 * Connect). These are the pure parts: when two recordings are the same ride,
 * and which recording is the Garmin's twin of a player ride.
 */
import type { ActivityEdit, Ride } from '../engine/types';

export interface Span { startMs: number; seconds: number }

/** Seconds two recordings share. */
export function overlapSeconds(a: Span, b: Span): number {
  const lo = Math.max(a.startMs, b.startMs);
  const hi = Math.min(a.startMs + a.seconds * 1000, b.startMs + b.seconds * 1000);
  return Math.max(0, (hi - lo) / 1000);
}

/**
 * The same ride: the Garmin's recording covers at least half of Antogo's. A
 * fragment (an Edge started late, or one that died early) is not the ride, so
 * it never replaces Antogo's full recording.
 */
export function sameRide(player: Span, garmin: Span): boolean {
  return player.seconds > 0 && overlapSeconds(player, garmin) >= player.seconds / 2;
}

/** A recording's span: its local start and its whole length (elapsed time when known). */
export function spanOf(r: Pick<Ride, 'startTime' | 'elapsedSeconds' | 'seconds'>): Span {
  return { startMs: new Date(r.startTime).getTime(), seconds: r.elapsedSeconds ?? r.seconds };
}

/** Activities the player made: marked so on their edit row (synced), or uploaded from a recording on this device. */
export function playerMade(edits: Pick<ActivityEdit, 'id' | 'source'>[], uploadedIds: Iterable<string> = []): Set<string> {
  return new Set([...edits.filter((e) => e.source === 'veloiq').map((e) => e.id), ...uploadedIds]);
}

/** The Garmin's recording of the same ride: a ride the player didn't make, covering at least half of Antogo's; the longest overlap wins. */
export function garminTwin(span: Span, rides: Ride[], mine: Set<string>): Ride | undefined {
  let best: Ride | undefined;
  let most = 0;
  for (const g of rides) {
    if (g.sport !== 'ride' || mine.has(g.id)) continue;
    const s = spanOf(g);
    if (!sameRide(span, s)) continue;
    const o = overlapSeconds(span, s);
    if (o > most) { most = o; best = g; }
  }
  return best;
}
