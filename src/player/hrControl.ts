/**
 * Riding by heart rate with the trainer adjusting (brief C2). The rider sets
 * nothing: a slow loop moves the trainer's watts a little at a time so heart
 * rate sits in each step's zone. Heart rate answers a change in effort over a
 * minute or two, so the loop changes at most every 30 seconds, and after a rise
 * it waits two minutes before rising again. Short steps are not steered: they
 * are held at the watts learned for their zone.
 *
 * Across rides, a small table (synced) remembers the watts that kept heart
 * rate in each zone, so the next ride starts each step near the right watts.
 *
 * Pure: the controller calls `hrTick` once a second and keeps the state.
 */
import type { Profile } from '../engine/types';
import { ridePowerZones } from '../engine/zones';

export interface HrPowerEntry { watts: number; at: string; n: number }
export type HrPowerTable = Record<number, HrPowerEntry>;

export interface HrStep {
  /** The step's planned length, seconds. */
  seconds: number;
  noFloor: boolean;
  /** The heart-rate zone of the band's middle. */
  zone: number;
  low: number;
  high: number;
}

export interface HrCtl {
  startWatts: number;
  /** The start watts came from this zone's own entry in the table. */
  learned: boolean;
  target: number;
  ceiling: number;
  /** The trainer's top, watts. */
  maxW: number;
  /** Seconds into the step of the last change, and its size. */
  lastChangeS: number;
  lastDelta?: number;
  /** When the target last went up: for two minutes after, it may only come down. */
  raisedAtS?: number;
  /** Since when heart rate has been well above the zone. */
  overSince?: number;
  /** When the safety ease-off last acted. */
  easedAtS?: number;
  /** The "heart rate staying low" question is on screen. */
  asking: boolean;
  /** The rider chose Keep it here: the target stays put for the rest of the step. */
  kept: boolean;
  /** Since when heart rate has been inside the zone without a break. */
  inSince?: number;
}

export const HR_SHORT_S = 180;
export const HR_GAP_S = 30;
export const HR_RISE_WAIT_S = 120;
export const HR_CEILING = 1.25;
export const HR_MORE = 0.15;
export const HR_SAFE_BPM = 10;
export const HR_SAFE_S = 20;
export const HR_SAFE_TO = 0.8;
export const HR_LEARN_MIN_S = 300;
export const HR_LEARN_LAST_S = 180;
const MIN_W = 40;

const round5 = (w: number) => Math.round(w / 5) * 5;

/**
 * Where a step starts: the watts the table holds for its zone; else a
 * neighbouring zone's, scaled (×1.15 per zone up, ×0.87 per zone down); else,
 * with an FTP of the rider's own, the middle of the matching power zone;
 * else 90 W.
 */
export function startWatts(table: HrPowerTable, zone: number, profile: Pick<Profile, 'ftp' | 'powerZoneMode' | 'powerZonePcts' | 'powerZoneWatts'>): { watts: number; learned: boolean } {
  const own = table[zone];
  if (own) return { watts: round5(own.watts), learned: true };
  const zones = Object.keys(table).map(Number).filter((z) => table[z]?.watts > 0);
  const lower = Math.max(-Infinity, ...zones.filter((z) => z < zone));
  const higher = Math.min(Infinity, ...zones.filter((z) => z > zone));
  if (Number.isFinite(lower) && (!Number.isFinite(higher) || zone - lower <= higher - zone)) return { watts: round5(table[lower].watts * 1.15 ** (zone - lower)), learned: false };
  if (Number.isFinite(higher)) return { watts: round5(table[higher].watts * 0.87 ** (higher - zone)), learned: false };
  if (profile.ftp > 0 && profile.ftp !== 200) {
    const z = ridePowerZones(profile as Profile)[Math.max(0, Math.min(6, zone - 1))];
    const low = z.n === 1 ? z.high * 0.8 : z.low;
    const high = Number.isFinite(z.high) ? z.high : z.low * 1.2;
    return { watts: round5(((low + high) / 2) * profile.ftp), learned: false };
  }
  return { watts: 90, learned: false };
}

/** A step begins: hold its start watts. */
export function hrStepStart(start: { watts: number; learned: boolean }, maxW = 2000): HrCtl {
  const w = Math.min(maxW, Math.max(MIN_W, start.watts));
  return { startWatts: w, learned: start.learned, target: w, ceiling: Math.min(maxW, Math.round(w * HR_CEILING)), maxW, lastChangeS: 0, asking: false, kept: false };
}

/** After a pause: carry on from the current target, free to rise again. */
export function hrResumed(st: HrCtl): HrCtl {
  return { ...st, raisedAtS: undefined, overSince: undefined, inSince: undefined };
}

/** The rider's answer to "heart rate staying low": allow a further 15 % of the start watts, or hold where it is. */
export function hrAnswer(st: HrCtl, answer: 'harder' | 'keep'): HrCtl {
  if (answer === 'keep') return { ...st, asking: false, kept: true };
  return { ...st, asking: false, ceiling: Math.min(st.maxW, Math.round(st.ceiling + st.startWatts * HR_MORE)) };
}

/**
 * One second. `bpm` is the 30-second average heart rate (undefined while the
 * reading is missing: the target holds). `inS` is seconds into the step.
 */
export function hrTick(st: HrCtl, step: HrStep, inS: number, bpm: number | undefined): { state: HrCtl; easedNow: boolean } {
  if (step.seconds < HR_SHORT_S || bpm == null) return { state: st, easedNow: false };
  const s: HrCtl = { ...st };
  const inBand = bpm <= step.high && (step.noFloor || bpm >= step.low);
  s.inSince = inBand ? st.inSince ?? inS : undefined;

  // Safety: well above the zone for 20 seconds eases straight to four fifths of the start.
  if (bpm > step.high + HR_SAFE_BPM) {
    s.overSince = st.overSince ?? inS;
    if (inS - s.overSince >= HR_SAFE_S) {
      s.overSince = inS;
      const to = Math.max(MIN_W, Math.round(s.startWatts * HR_SAFE_TO));
      if (s.target > to) {
        s.lastDelta = to - s.target;
        s.target = to;
        s.lastChangeS = inS;
        s.easedAtS = inS;
        s.raisedAtS = inS;
        s.asking = false;
        return { state: s, easedNow: true };
      }
    }
  } else s.overSince = undefined;

  if (s.kept || inS - s.lastChangeS < HR_GAP_S) return { state: s, easedNow: false };

  if (bpm > step.high) {
    const d = bpm > step.high + 5 ? -10 : -5;
    const to = Math.max(MIN_W, s.target + d);
    if (to !== s.target) { s.lastDelta = to - s.target; s.target = to; s.lastChangeS = inS; s.asking = false; }
  } else if (!step.noFloor && bpm < step.low) {
    if (s.raisedAtS != null && inS - s.raisedAtS < HR_RISE_WAIT_S) return { state: s, easedNow: false };
    if (s.target >= s.ceiling) { s.asking = true; return { state: s, easedNow: false }; }
    const to = Math.min(s.ceiling, s.target + (bpm < step.low - 5 ? 10 : 5));
    s.lastDelta = to - s.target;
    s.target = to;
    s.lastChangeS = inS;
    s.raisedAtS = inS;
  }
  return { state: s, easedNow: false };
}

const ago = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s / 5) * 5)} s ago` : '1 min ago');

/** One line under the heart-rate hero: what the trainer is doing and why. */
export function hrStatus(st: HrCtl, step: HrStep, inS: number, bpm: number | undefined): string {
  const t = st.target;
  if (step.seconds < HR_SHORT_S) {
    return st.learned
      ? `Holding ${t} W, the watts that usually keep you in zone ${step.zone}. Short efforts aren't steered by heart rate.`
      : `Holding ${t} W for this short step. Short efforts aren't steered by heart rate.`;
  }
  if (st.asking) return 'At the limit for this step.';
  if (st.kept) return `Holding ${t} W for the rest of this step, as you chose.`;
  if (st.easedAtS != null && inS - st.easedAtS < 60) return `Eased to ${t} W: your heart rate was well above the zone.`;
  if (bpm == null) return `Holding ${t} W until your heart rate comes through.`;
  if (st.lastDelta != null && st.lastDelta < 0 && inS - st.lastChangeS < 90) return `Eased ${-st.lastDelta} W ${ago(inS - st.lastChangeS)} as your heart rate crept up.`;
  if (bpm > step.high) return `Holding ${t} W. Your heart rate is above zone ${step.zone}, so the trainer eases off in small steps.`;
  if (!step.noFloor && bpm < step.low) return `Building up: ${t} W, waiting for your heart rate to settle.`;
  return `Trainer is holding ${t} W to keep you in zone ${step.zone}.`;
}

/**
 * At the end of a step: whether it teaches the table. A steady step of five
 * minutes or more, inside its zone for its last three, and not held by
 * "Keep it here".
 */
export function hrLearns(st: HrCtl, step: HrStep, riddenS: number): boolean {
  return step.seconds >= HR_LEARN_MIN_S && riddenS >= HR_LEARN_MIN_S && !st.kept && st.inSince != null && riddenS - st.inSince >= HR_LEARN_LAST_S
    && (st.easedAtS == null || riddenS - st.easedAtS >= HR_LEARN_LAST_S);
}

/** Blend what a step showed into the table: 70 % the new, 30 % the old. */
export function hrLearn(table: HrPowerTable, zone: number, observed: number, date: string): HrPowerTable {
  const old = table[zone];
  const watts = Math.round(old ? 0.7 * observed + 0.3 * old.watts : observed);
  return { ...table, [zone]: { watts, at: date, n: (old?.n ?? 0) + 1 } };
}
