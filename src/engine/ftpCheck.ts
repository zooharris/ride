/**
 * Step 2, Part C (as reworked 29 Oct): when Today should say something about FTP.
 * Upward only from riding: the rider's own best efforts must prove a higher FTP
 * (a trustworthy critical power fit at least 3% above the setting). Riding never
 * lowers it; a lower FTP comes from a test or from the rider. A stale FTP (six
 * weeks with no change and no test) gets a suggestion to ride a test, not a number.
 * Pure, tested.
 */
import { addDays } from './load';

export const RISE = 1.03;
export const STALE_DAYS = 42;

export interface FtpCheckState {
  /** The rider kept their FTP against this proven estimate. */
  keptEstimate?: number;
  keptAt?: string;
  /** The rider dismissed the stale-FTP line on this day. */
  staleDismissedAt?: string;
}

export type FtpCheck =
  | { kind: 'up'; estimate: number }
  | { kind: 'stale'; setOn: string };

export function ftpCheck(o: { ftp: number; ftpSetOn?: string; proven?: number; lastTestDate?: string; state: FtpCheckState; today: string }): FtpCheck | undefined {
  const { ftp, proven, state, today } = o;
  if (proven && ftp > 0 && proven >= ftp * RISE && !(state.keptEstimate && proven < state.keptEstimate * RISE)) {
    return { kind: 'up', estimate: proven };
  }
  const old = addDays(today, -STALE_DAYS);
  if (o.ftpSetOn && o.ftpSetOn <= old && !(o.lastTestDate && o.lastTestDate > old) && !(state.staleDismissedAt && state.staleDismissedAt > old)) {
    return { kind: 'stale', setOn: o.ftpSetOn };
  }
  return undefined;
}
