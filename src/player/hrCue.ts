/**
 * Riding by heart rate with your gears (brief C1.1, revised 10 Nov 2026): after twenty seconds outside the step's
 * zone without moving toward it, the screen says "Reduce intensity" or "Increase intensity". While heart rate is
 * closing on the zone (on its way after a change of effort) the count waits, because the rider has already done the
 * right thing and heart rate simply lags. The cue clears as soon as heart rate is back inside, or starts closing
 * again. A recovery step (no minimum) never says increase. A soft tone marks a new cue, at most once a minute.
 * Pure: the controller calls it once a second with the 10-second average heart rate.
 */
export type Cue = 'over' | 'under';

export interface CueState {
  /** The side heart rate is on now, and since when the count has run (seconds). */
  side?: Cue;
  since?: number;
  /** The cue on screen. */
  shown?: Cue;
  /** When the last tone sounded (seconds). */
  lastTone?: number;
  /** Recent 10-second averages, [seconds, bpm], kept across steps so a new step can tell a rise already under way. */
  hist?: Array<[number, number]>;
  /** Heart rate is out of the zone and moving toward it. */
  closing?: boolean;
}

/** How long heart rate stays out of the zone, not moving toward it, before an instruction (seconds). */
export const CUE_HOLD_S = 20;
export const CUE_TONE_GAP_S = 60;
/**
 * "Closing": the 10-second average is at least CLOSING_BPM nearer the zone than it was CLOSING_WINDOW_S earlier.
 * Both are general allowances for ordinary strap and watch noise (a steady heart rate wanders a beat or so either
 * way over twenty seconds), not settings for any one rider.
 */
export const CLOSING_BPM = 2;
export const CLOSING_WINDOW_S = 20;

/** Outside distance from the zone on the given side (positive = outside). */
const gap = (bpm: number, side: Cue, band: { low: number; high: number }) => side === 'over' ? bpm - band.high : band.low - bpm;

export function hrCue(st: CueState, bpm: number | undefined, band: { low: number; high: number }, noFloor: boolean, nowS: number): { state: CueState; cue?: Cue; tone: boolean; closing?: boolean } {
  let hist = st.hist ?? [];
  if (bpm != null) hist = [...hist.filter(([t]) => t >= nowS - CLOSING_WINDOW_S - 5), [nowS, bpm]];
  const side: Cue | undefined = bpm == null ? undefined : bpm > band.high ? 'over' : !noFloor && bpm < band.low ? 'under' : undefined;
  if (!side || bpm == null) return { state: { lastTone: st.lastTone, hist }, tone: false };
  // The reading from CLOSING_WINDOW_S ago (the latest at or before it); with less history than that, not closing.
  let then: number | undefined;
  for (const [t, v] of hist) if (t <= nowS - CLOSING_WINDOW_S) then = v;
  const closing = then != null && gap(then, side, band) - gap(bpm, side, band) >= CLOSING_BPM;
  if (closing) return { state: { side, lastTone: st.lastTone, hist, closing: true }, tone: false, closing: true };
  const since = side === st.side && st.since != null ? st.since : nowS;
  let shown = st.shown === side ? side : undefined;
  let tone = false;
  let lastTone = st.lastTone;
  if (!shown && nowS - since >= CUE_HOLD_S) {
    shown = side;
    if (lastTone == null || nowS - lastTone >= CUE_TONE_GAP_S) { tone = true; lastTone = nowS; }
  }
  return { state: { side, since, shown, lastTone, hist }, cue: shown, tone };
}

export const CUE_WORDS: Record<Cue, { head: string; how: string; short: string }> = {
  over: { head: 'Reduce intensity', how: 'Shift to an easier gear or soften your pedalling until your heart rate drops into the zone.', short: 'easier gear or softer legs' },
  under: { head: 'Increase intensity', how: 'Shift to a harder gear or pedal a little faster until your heart rate rises into the zone.', short: 'harder gear or faster legs' },
};

/**
 * What the heart-rate card's message slot holds (10 Nov 2026, one message line): an instruction when heart rate
 * has been out of the zone long enough (the 20-second rule above), the trainer's own account of what it is doing
 * when it steers, or nothing. Nothing else: the status pill and the words under the bar say where heart rate is,
 * and the dial's message line belongs to the workout.
 */
export type HrSlot = { kind: 'signal'; cue: Cue } | { kind: 'status'; text: string } | { kind: 'none' };
export function hrSlot(o: { adjusting: boolean; status?: string; cue?: Cue }): HrSlot {
  if (o.adjusting) return { kind: 'status', text: o.status || 'The trainer starts each step at the watts that usually keep you in its zone.' };
  return o.cue ? { kind: 'signal', cue: o.cue } : { kind: 'none' };
}

/**
 * Where heart rate sits against the zone, in the words under the bar: "7 bpm below", "4 bpm above", "In the zone";
 * while it is closing on the zone, which way it is going too: "40 bpm below, rising", "12 bpm above, falling".
 */
export function zoneWords(bpm: number | undefined, band: { low: number; high: number } | undefined, closing?: boolean): string {
  if (bpm == null || !band) return '';
  if (bpm > band.high) return `${Math.round(bpm - band.high)} bpm above${closing ? ', falling' : ''}`;
  if (band.low && bpm < band.low) return `${Math.round(band.low - bpm)} bpm below${closing ? ', rising' : ''}`;
  return 'In the zone';
}
