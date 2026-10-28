/**
 * Riding by heart rate with your gears (brief C1.1): after twenty seconds
 * outside the step's zone the screen says "Reduce intensity" or "Increase
 * intensity", and clears as soon as heart rate is back inside. A recovery step
 * (no minimum) never says increase. A soft tone marks a new cue, at most once a
 * minute. Pure: the controller calls it once a second with the 10-second
 * average heart rate.
 */
export type Cue = 'over' | 'under';

export interface CueState {
  /** The side heart rate is on now, and since when (seconds). */
  side?: Cue;
  since?: number;
  /** The cue on screen. */
  shown?: Cue;
  /** When the last tone sounded (seconds). */
  lastTone?: number;
}

export const CUE_HOLD_S = 20;
export const CUE_TONE_GAP_S = 60;

export function hrCue(st: CueState, bpm: number | undefined, band: { low: number; high: number }, noFloor: boolean, nowS: number): { state: CueState; cue?: Cue; tone: boolean } {
  const side: Cue | undefined = bpm == null ? undefined : bpm > band.high ? 'over' : !noFloor && bpm < band.low ? 'under' : undefined;
  if (!side) return { state: { lastTone: st.lastTone }, tone: false };
  const since = side === st.side && st.since != null ? st.since : nowS;
  let shown = st.shown === side ? side : undefined;
  let tone = false;
  let lastTone = st.lastTone;
  if (!shown && nowS - since >= CUE_HOLD_S) {
    shown = side;
    if (lastTone == null || nowS - lastTone >= CUE_TONE_GAP_S) { tone = true; lastTone = nowS; }
  }
  return { state: { side, since, shown, lastTone }, cue: shown, tone };
}

export const CUE_WORDS: Record<Cue, { head: string; how: string }> = {
  over: { head: 'Reduce intensity', how: 'Shift to an easier gear or soften your pedalling until your heart rate drops into the zone.' },
  under: { head: 'Increase intensity', how: 'Shift to a harder gear or pedal a little faster until your heart rate rises into the zone.' },
};
