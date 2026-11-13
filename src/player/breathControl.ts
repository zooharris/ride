/**
 * Riding by breathing with the trainer adjusting (Step 5, 11 Nov 2026). Modelled on riding by heart rate
 * (hrControl): a slow loop moves the trainer's watts a little at a time so the rider's ventilation sits in each
 * step's breathing range. Breathing answers a change of effort faster than heart rate (well under a minute
 * against one to two), so the waits are shorter. Short steps are held at the watts learned for their zone.
 *
 * The signal is ventilation averaged over 30 seconds, divided by today's strap offset once that is known (how
 * tight a strap sits shifts its reading a few percent from day to day). Until then each step is held at its
 * starting watts: the warm-up covers it.
 *
 * Every timing and step size below is a general setting chosen from how breathing responds to effort, not from
 * any one rider's data. Pure: the controller calls `breathTick` once a second and keeps the state.
 */
import type { Profile } from '../engine/types';
import type { HrPowerEntry } from './hrControl';

/** The watts that kept breathing in each breathing zone (1–5) on earlier rides: synced, like the heart-rate table. */
export type BreathPowerTable = Record<number, HrPowerEntry>;
export const BREATH_TABLE = 'breathPowerTable';

export interface BreathStep {
  seconds: number;
  noFloor: boolean;
  /** The breathing zone of the range's middle. */
  zone: number;
  /** Ventilation, L/min (low 0 for a step with no floor). */
  low: number;
  high: number;
  /** The step's planned watts: where it starts before anything is learned. */
  plannedWatts: number;
  /** The step's heart-rate range, for the safety ease-off (when heart rate is connected). */
  hrHigh?: number;
}

export interface BreathCtl {
  startWatts: number;
  learned: boolean;
  target: number;
  ceiling: number;
  maxW: number;
  lastChangeS: number;
  lastDelta?: number;
  raisedAtS?: number;
  loweredAtS?: number;
  /** Ventilation 20 seconds ago and now, for "rising" or "falling". */
  vePrev?: number;
  veMark?: number;
  veMarkS?: number;
  overSince?: number;
  easedAtS?: number;
  asking: boolean;
  kept: boolean;
  inSince?: number;
}

/** Steps shorter than this are held, not steered: breathing needs about a minute to settle on a new effort. */
export const BREATH_SHORT_S = 120;
/** At most one change every 20 seconds. */
export const BREATH_GAP_S = 20;
/** After a rise, no further rise for a minute: breathing is still catching up. */
export const BREATH_RISE_WAIT_S = 60;
/** Into an easier step, no lowering for 45 seconds: breathing is still coming down. */
export const BREATH_FALL_WAIT_S = 45;
/** The same ceiling riding by heart rate uses: a quarter above the start watts, unless the rider allows more. */
export const BREATH_CEILING = 1.25;
export const BREATH_MORE = 0.15;
/** Breathing well outside the range: a tenth of the range's top beyond it. */
export const BREATH_FAR = 0.1;
/**
 * Each change is a share of the rider's FTP (12 Nov 2026): 2%, or 4% when breathing is well outside the range,
 * in whole watts and never less than 5 W. The same for every rider in proportion, not the same watts for all.
 */
export const BREATH_NEAR_SHARE = 0.02;
export const BREATH_FAR_SHARE = 0.04;
export const BREATH_MIN_CHANGE_W = 5;
export const breathChange = (ftp: number, far: boolean): number => Math.max(BREATH_MIN_CHANGE_W, Math.round(ftp * (far ? BREATH_FAR_SHARE : BREATH_NEAR_SHARE)));
/** Heart rate this far over the step's zone for 20 seconds eases straight to four fifths of the start. */
export const BREATH_SAFE_BPM = 10;
export const BREATH_SAFE_S = 20;
export const BREATH_SAFE_TO = 0.8;
/** A step teaches the table when it was five minutes or more and in range for its last three. */
export const BREATH_LEARN_MIN_S = 300;
export const BREATH_LEARN_LAST_S = 180;
/** With no earlier rides to learn the strap's normal from, today's reading is taken as it is after this long. */
export const BREATH_OFFSET_FALLBACK_S = 600;
const MIN_W = 40;

const round5 = (w: number) => Math.round(w / 5) * 5;

/**
 * Where a step starts: the watts the table holds for its zone; else a neighbouring zone's, scaled (×1.15 per
 * zone up, ×0.87 per zone down, as for heart rate); else the step's planned watts.
 */
export function breathStartWatts(table: BreathPowerTable, zone: number, plannedWatts: number): { watts: number; learned: boolean } {
  const own = table[zone];
  if (own) return { watts: round5(own.watts), learned: true };
  const zones = Object.keys(table).map(Number).filter((z) => table[z]?.watts > 0);
  const lower = Math.max(-Infinity, ...zones.filter((z) => z < zone));
  const higher = Math.min(Infinity, ...zones.filter((z) => z > zone));
  if (Number.isFinite(lower) && (!Number.isFinite(higher) || zone - lower <= higher - zone)) return { watts: round5(table[lower].watts * 1.15 ** (zone - lower)), learned: false };
  if (Number.isFinite(higher)) return { watts: round5(table[higher].watts * 0.87 ** (higher - zone)), learned: false };
  return { watts: round5(plannedWatts), learned: false };
}

export function breathStepStart(start: { watts: number; learned: boolean }, maxW = 2000, prevTarget?: number): BreathCtl {
  const w = Math.min(maxW, Math.max(MIN_W, start.watts));
  const st: BreathCtl = { startWatts: w, learned: start.learned, target: w, ceiling: Math.min(maxW, Math.round(w * BREATH_CEILING)), maxW, lastChangeS: 0, asking: false, kept: false };
  if (prevTarget != null) { if (w >= prevTarget) st.raisedAtS = 0; else st.loweredAtS = 0; }
  return st;
}

export function breathResumed(st: BreathCtl): BreathCtl {
  return { ...st, raisedAtS: undefined, loweredAtS: undefined, overSince: undefined, inSince: undefined };
}

export function breathAnswer(st: BreathCtl, answer: 'harder' | 'keep'): BreathCtl {
  if (answer === 'keep') return { ...st, asking: false, kept: true };
  return { ...st, asking: false, ceiling: Math.min(st.maxW, Math.round(st.ceiling + st.startWatts * BREATH_MORE)) };
}

/**
 * One second. `ve` is the 30-second ventilation already corrected for today's offset; undefined while it is
 * not usable (missing, frozen, or the offset not yet known): the target holds. `bpm` is heart rate, if any.
 */
export function breathTick(st: BreathCtl, step: BreathStep, inS: number, ve: number | undefined, bpm: number | undefined, ftp: number): { state: BreathCtl; easedNow: boolean } {
  const s: BreathCtl = { ...st };
  // Safety by heart rate works on every step, steered or held.
  if (bpm != null && step.hrHigh != null && bpm > step.hrHigh + BREATH_SAFE_BPM) {
    s.overSince = st.overSince ?? inS;
    if (inS - s.overSince >= BREATH_SAFE_S) {
      s.overSince = inS;
      const to = Math.max(MIN_W, Math.round(s.startWatts * BREATH_SAFE_TO));
      if (s.target > to) { s.lastDelta = to - s.target; s.target = to; s.lastChangeS = inS; s.easedAtS = inS; s.raisedAtS = inS; s.asking = false; return { state: s, easedNow: true }; }
    }
  } else s.overSince = undefined;
  if (step.seconds < BREATH_SHORT_S || ve == null) return { state: s, easedNow: false };
  if (s.veMarkS == null || inS - s.veMarkS >= 20) { s.vePrev = s.veMark; s.veMark = ve; s.veMarkS = inS; }
  const inBand = ve <= step.high && (step.noFloor || ve >= step.low);
  s.inSince = inBand ? st.inSince ?? inS : undefined;
  if (s.kept || inS - s.lastChangeS < BREATH_GAP_S) return { state: s, easedNow: false };
  const far = step.high * BREATH_FAR;
  if (ve > step.high) {
    if (s.loweredAtS != null && inS - s.loweredAtS < BREATH_FALL_WAIT_S) return { state: s, easedNow: false };
    const to = Math.max(MIN_W, s.target - breathChange(ftp, ve > step.high + far));
    if (to !== s.target) { s.lastDelta = to - s.target; s.target = to; s.lastChangeS = inS; s.asking = false; }
  } else if (!step.noFloor && ve < step.low) {
    if (s.raisedAtS != null && inS - s.raisedAtS < BREATH_RISE_WAIT_S) return { state: s, easedNow: false };
    if (s.target >= s.ceiling) { s.asking = true; return { state: s, easedNow: false }; }
    const to = Math.min(s.ceiling, s.target + breathChange(ftp, ve < step.low - far));
    s.lastDelta = to - s.target; s.target = to; s.lastChangeS = inS; s.raisedAtS = inS;
  }
  return { state: s, easedNow: false };
}

/** Breathing over the last 20 seconds: rising, falling, or neither (for the words under the target bar). */
export function breathTrend(st: BreathCtl): 'rising' | 'falling' | undefined {
  if (st.vePrev == null || st.veMark == null) return undefined;
  const d = st.veMark - st.vePrev;
  const step = Math.max(1, st.veMark * 0.04);
  return d > step ? 'rising' : d < -step ? 'falling' : undefined;
}

const ago = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s / 5) * 5)} s ago` : '1 min ago');

/** One line for the screen: what the trainer is doing and why. */
export function breathStatus(st: BreathCtl, step: BreathStep, inS: number, ve: number | undefined, offsetKnown: boolean): string {
  const t = st.target;
  if (step.seconds < BREATH_SHORT_S) return st.learned ? `Holding ${t} W, the watts that usually keep your breathing in zone ${step.zone}. Short efforts aren't steered by breathing.` : `Holding ${t} W for this short step. Short efforts aren't steered by breathing.`;
  if (!offsetKnown) return `Holding ${t} W while Antogo reads your strap for today.`;
  if (st.asking) return 'At the limit for this step.';
  if (st.kept) return `Holding ${t} W for the rest of this step, as you chose.`;
  if (st.easedAtS != null && inS - st.easedAtS < 60) return `Eased to ${t} W: your heart rate was well above the zone.`;
  if (ve == null) return `Holding ${t} W until your breathing comes through.`;
  if (st.lastDelta != null && st.lastDelta < 0 && inS - st.lastChangeS < 60) return `Eased ${-st.lastDelta} W ${ago(inS - st.lastChangeS)} to bring your breathing down.`;
  if (ve > step.high) return `Holding ${t} W. Your breathing is above zone ${step.zone}, so the trainer eases off in small steps.`;
  if (!step.noFloor && ve < step.low) return `Building up: ${t} W, waiting for your breathing to settle.`;
  return `Trainer is holding ${t} W to keep your breathing in zone ${step.zone}.`;
}

export function breathLearns(st: BreathCtl, step: BreathStep, riddenS: number): boolean {
  return step.seconds >= BREATH_LEARN_MIN_S && riddenS >= BREATH_LEARN_MIN_S && !st.kept && st.inSince != null && riddenS - st.inSince >= BREATH_LEARN_LAST_S
    && (st.easedAtS == null || riddenS - st.easedAtS >= BREATH_LEARN_LAST_S);
}

export function breathLearn(table: BreathPowerTable, zone: number, observed: number, date: string): BreathPowerTable {
  const old = table[zone];
  const watts = Math.round(old ? 0.7 * observed + 0.3 * old.watts : observed);
  return { ...table, [zone]: { watts, at: date, n: (old?.n ?? 0) + 1 } };
}

/** Whether the rider can ride by breathing at all: breathing zones set. */
export function hasBreathZones(p: Pick<Profile, 'vt2Ve'>): boolean { return !!p.vt2Ve && p.vt2Ve > 0; }
