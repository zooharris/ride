import type { KeptPacket } from './ble/native';

/**
 * Taking a ride back up after the app was not in front (26 Nov 2026). On an iPhone or iPad the app's pages are
 * stopped when the app leaves the screen; the app's own side keeps everything the devices send, each with its time.
 * Back in front, the ride is run through the time it missed one second at a time, each kept reading handed over at
 * the moment it arrived, so the recording has every second and the workout is where the clock says it should be.
 *
 * This is the order of events only; what a reading means, and what a second of riding does, belong to the callers.
 */
export interface CatchUp {
  /** The last second the ride ran, and now (milliseconds). */
  from: number;
  to: number;
  packets: KeptPacket[];
  /** Hand one kept reading to whatever listens for that device. */
  deliver(p: KeptPacket): void;
  /** Run one second of the ride, as of `at`. */
  second(at: number): void;
  /** Make "now" read as `ms` for everything that asks, or give the real clock back with null. */
  setClock(ms: number | null): void;
}

export function catchUp(c: CatchUp): { seconds: number; delivered: number; stillGone: string[] } {
  // Readings already handed over live (before the pages stopped, or as they started again) are not handed over twice.
  const packets = c.packets.filter((p) => p.t > c.from && !p.sent).sort((a, b) => a.t - b.t);
  const gone = new Set<string>();
  let i = 0, seconds = 0, delivered = 0;
  const upTo = (t: number) => {
    for (; i < packets.length && packets[i].t <= t; i++) {
      const p = packets[i];
      if (p.gone) { gone.add(p.id); continue; }
      if (p.back) { gone.delete(p.id); continue; }
      c.setClock(p.t);
      c.deliver(p);
      delivered++;
    }
  };
  try {
    for (let at = c.from + 1000; at <= c.to; at += 1000) {
      upTo(at);
      c.setClock(at);
      c.second(at);
      seconds++;
    }
    // What arrived in the last part-second belongs to the second now beginning.
    upTo(c.to);
  } finally {
    c.setClock(null);
  }
  return { seconds, delivered, stillGone: [...gone] };
}
