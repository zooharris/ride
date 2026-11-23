import type { ActivityEdit, Profile, Ride } from './types';
import { footLthr } from './zones';
import { ftpFor, lthrFor, type FtpScoring, type ThresholdHistory, type Used } from './thresholdHistory';

/**
 * What every activity's scoring reads (22 Nov 2026): Antogo's FTP history, its threshold heart-rate histories, the
 * rider's choice of which FTP scores rides, and their corrections to single activities. Held here once, read without
 * waiting, and read again from storage whenever any of it changes (data/thresholds).
 */
export const FTP_HISTORY = 'ftpHistory';
export const LTHR_HISTORY = 'lthrHistory';
export const FOOT_LTHR_HISTORY = 'footLthrHistory';
export const HISTORY_KEYS = [FTP_HISTORY, LTHR_HISTORY, FOOT_LTHR_HISTORY] as const;
export type HistoryKey = typeof HISTORY_KEYS[number];
/** The setting: 'antogo' (the default) or 'device'. */
export const FTP_SCORING = 'ftpScoring';

export interface ThresholdCtx {
  ftp?: ThresholdHistory;
  lthr?: ThresholdHistory;
  footLthr?: ThresholdHistory;
  scoring: FtpScoring;
  edits: Map<string, ActivityEdit>;
}

let ctx: ThresholdCtx | undefined;
export function setThresholdCtx(c: ThresholdCtx | undefined): void { ctx = c; }
export function getThresholdCtx(): ThresholdCtx | undefined { return ctx; }

type P = Pick<Profile, 'ftp' | 'lthr'> & Partial<Profile>;
type R = Pick<Ride, 'id' | 'date' | 'sport'> & Partial<Pick<Ride, 'ftpDevice' | 'ftpAtRide'>>;

/**
 * The FTP and threshold heart rate an activity is scored with, and why. Before Antogo's history exists on this device
 * (it is filled in once, after the first merge with the rider's other devices), an activity keeps the FTP it came
 * with, as it always did.
 */
export function thresholdsOf(r: R, p: P | undefined | null, c: ThresholdCtx | undefined = ctx): { ftp?: Used; lthr?: Used } {
  const edit = c?.edits.get(r.id);
  const onFoot = r.sport === 'walk' || r.sport === 'run';
  const nowLthr = p ? (onFoot ? footLthr(p as Profile) : p.lthr) : 0;
  let ftp: Used | undefined;
  if (c?.ftp) ftp = ftpFor(r.date, { history: c.ftp, scoring: c.scoring, device: r.ftpDevice, own: edit?.ftp, now: p?.ftp });
  else if (edit?.ftp) ftp = { value: edit.ftp, why: { kind: 'you' } };
  else { const v = r.ftpAtRide || p?.ftp; ftp = v ? { value: v, why: { kind: 'now' } } : undefined; }
  // On foot: the foot history when the rider has one; otherwise the bike's, as the setting itself falls back.
  const hist = onFoot && c?.footLthr?.entries.length ? c.footLthr : onFoot && p?.footLthr ? undefined : c?.lthr;
  const lthr = lthrFor(r.date, { history: hist, own: edit?.lthr, now: nowLthr || undefined });
  return { ftp, lthr };
}
