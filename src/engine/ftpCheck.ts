/**
 * Step 2b (the quiet version, 29 Oct): when Today says something about FTP.
 * Two messages only. One: "Antogo estimates your FTP is now X", when the rider's
 * best efforts point at least 3% above the setting and recent hard sessions
 * didn't fall short. Riding never lowers FTP. Two: "Time for a ramp test?", when
 * FTP is 12 weeks old with no test, 6 weeks old and never tested, or sooner when
 * two of three signs agree. The reason is never shown. Pure, tested.
 */
import { addDays } from './load';

export const RISE = 1.03;
export const STALE_DAYS = 84;
export const UNTESTED_DAYS = 42;
export const QUIET_DATE_DAYS = 28;
export const QUIET_SIGNS_DAYS = 14;

export interface FtpCheckState {
  /** The rider kept their FTP against this estimate. */
  keptEstimate?: number;
  keptAt?: string;
  /** The rider pressed Not now on the test reminder on this day. */
  notNowAt?: string;
  /** Earlier versions' dismissal of the stale line; read as a Not now. */
  staleDismissedAt?: string;
}

/** What the riding shows, from the hidden evidence (Part C). Absent means nothing to say. */
export interface FtpSigns {
  /** Two or more of the last four judged hard sessions fell short, or were held only with heart rate high. */
  sessionsOff?: boolean;
  /** Recent hard sessions are fine for a rise (none fell short, none held only with heart rate high). */
  sessionsOk?: boolean;
  /** Power at a steady heart rate has dropped 5% or more over six weeks. */
  steadyDropped?: boolean;
}

export type TestReason = 'stale' | 'untested' | 'signs';
export type FtpCheck =
  | { kind: 'up'; estimate: number }
  | { kind: 'test'; setOn?: string; reason: TestReason };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86_400_000);

export function ftpCheck(o: {
  ftp: number;
  ftpSetOn?: string;
  /** The FTP the rider's best efforts point to (a trustworthy fit), if any. */
  estimate?: number;
  /** The newest ramp or 20-minute test the app knows of. */
  lastTestDate?: string;
  /** Whether any test has ever been ridden. */
  everTested: boolean;
  signs?: FtpSigns;
  state: FtpCheckState;
  today: string;
}): FtpCheck | undefined {
  const { ftp, estimate, state, today } = o;
  const signs = o.signs ?? {};
  const sessionsOk = signs.sessionsOk !== false;

  if (estimate && ftp > 0 && estimate >= ftp * RISE && sessionsOk && !(state.keptEstimate && estimate < state.keptEstimate * RISE)) {
    return { kind: 'up', estimate };
  }

  const tested = (since: string) => !!o.lastTestDate && o.lastTestDate > since;
  const stale = !!o.ftpSetOn && o.ftpSetOn <= addDays(today, -STALE_DAYS) && !tested(addDays(today, -STALE_DAYS));
  const untested = !o.everTested && !!o.ftpSetOn && o.ftpSetOn <= addDays(today, -UNTESTED_DAYS);
  const signCount = [signs.sessionsOff, signs.steadyDropped, !o.everTested].filter(Boolean).length;
  const bySigns = signCount >= 2;
  const reason: TestReason | undefined = bySigns ? 'signs' : stale ? 'stale' : untested ? 'untested' : undefined;
  if (!reason) return undefined;

  // Not now: a month when the reason is only the date, two weeks when the riding shows signs. A test ridden since clears it.
  const notNow = state.notNowAt ?? state.staleDismissedAt;
  if (notNow && !tested(notNow) && daysBetween(notNow, today) < (bySigns ? QUIET_SIGNS_DAYS : QUIET_DATE_DAYS)) return undefined;
  return { kind: 'test', setOn: o.ftpSetOn, reason };
}
