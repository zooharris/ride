/**
 * Breathing for an activity's page, on any device (Step 3, 30 Oct 2026). In
 * order: the player's own recording on this computer; the custom streams
 * Intervals.icu made of the FIT's developer fields; failing those, the
 * activity's original file downloaded and read here. No Intervals.icu
 * Supporter subscription is needed for any of them.
 */
import { getSetting, setSetting, STREAMS_VERSION, type StreamSet } from '../data/db';
import type { Recording } from './types';
import { breathStreams, maybeGunzip, readFitBreathing } from './fitRead';

type Breath = Pick<StreamSet, 've' | 'br' | 'tv'>;

/** Breathing from the player's own recording, laid against the activity's time stream. */
export function breathFromRecording(rec: Recording, time: number[]): Breath | undefined {
  if (!rec.samples.some((x) => x.ve != null)) return undefined;
  const at = new Map(rec.samples.map((x) => [x.t, x]));
  const pick = (k: 've' | 'br' | 'tv') => time.map((t) => { const x = at.get(Math.round(t)); return x?.[k] ?? NaN; });
  return { ve: pick('ve'), br: pick('br'), tv: pick('tv') };
}

/**
 * The breathing a stream set is missing, if it can be had. `local` is this
 * computer's recording of the activity, if any; `file` fetches the original
 * file (only called when nothing else has it).
 */
export async function fillBreathing(set: StreamSet, local: Recording | undefined, file: () => Promise<Uint8Array>): Promise<StreamSet> {
  if (local) { const b = breathFromRecording(local, set.time); if (b) return { ...set, ...b }; }
  if (set.ve?.some((x) => x != null && isFinite(x))) return set;
  try {
    const b = breathStreams(readFitBreathing(await maybeGunzip(await file())), set.time);
    return b ? { ...set, ...b } : set;
  } catch {
    return set;
  }
}

/** Whether a stream set has breathing to chart. */
export const hasBreathing = (s: Pick<StreamSet, 've'> | null | undefined) => !!s?.ve?.some((x) => x != null && isFinite(x) && x > 0);

/** The first day any ride in the account had breathing (31 Oct): rides from then on are read again once for it. */
export const FIRST_BREATHING_KEY = 'firstBreathingDate';

/** Note that a ride of this date had breathing; the earliest such date is kept. */
export async function noteBreathingDate(date: string): Promise<void> {
  const cur = await getSetting<string | undefined>(FIRST_BREATHING_KEY, undefined);
  if (!cur || date < cur) await setSetting(FIRST_BREATHING_KEY, date);
}

/**
 * Whether an activity's cached streams can be shown as they are (2D, 31 Oct).
 * The current version always can. An older set can, unless: a player ride with
 * a strap is cached from before breathing was read (v2); or the set has no
 * breathing and the ride is on or after the first day any ride had breathing
 * (a Garmin ride with Tymewear's field, cached before breathing was asked for
 * on every ride). Rides before that day are never read again for it.
 */
export function cachedStreamsUsable(cached: Pick<StreamSet, 'v' | 've'> | undefined, o: { playerBreathing: boolean; date: string; firstBreathingDate?: string }): boolean {
  if (!cached) return false;
  if (cached.v === STREAMS_VERSION) return true;
  if (cached.v !== 2 && cached.v !== 3) return false;
  if (hasBreathing(cached)) return true;
  if (o.playerBreathing && cached.v === 2) return false;
  return !(o.firstBreathingDate && o.date >= o.firstBreathingDate);
}
