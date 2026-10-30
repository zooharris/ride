/**
 * Today's FTP panel (Step 2, Part C as reworked 29 Oct). Appears only when the
 * rider's own best efforts prove a higher FTP than the setting, with Update or
 * Keep; or, when FTP hasn't changed in six weeks and no test was ridden, one
 * quiet line suggesting a ramp test. Riding alone never lowers FTP. No AI call:
 * the number is the app's own fit; with a key, the coach can be asked in Settings.
 */
import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting, db } from '../data/db';
import { ftpCheck, type FtpCheckState } from '../engine/ftpCheck';
import { today as todayIs } from '../engine/load';
import { useEvidence, useHasKey } from './thresholdService';
import { resendRides, sentRidesAhead, takeThreshold, zonesFollowFtp } from './testService';
import { fmtDate } from './derived';
import { toast } from './Toast';
import type { AppData } from './store';

export const FTP_CHECK_KEY = 'ftpCheck';

export function FtpCheckPanel({ data }: { data: AppData }) {
  const ev = useEvidence(data);
  const hasKey = useHasKey();
  const [state, setState] = useState<FtpCheckState | undefined>(undefined);
  const [done, setDone] = useState<{ text: string; ahead: number } | null>(null);
  useEffect(() => { void getSetting<FtpCheckState>(FTP_CHECK_KEY, {}).then((s) => setState(s ?? {})); }, []);
  const p = data.profile;
  if (!p || !ev || state === undefined) return null;
  if (done) return (
    <section class="panel" style="margin-top:14px;padding:12px 16px">
      <p class="small" style="margin:0">{done.text}</p>
      {done.ahead > 0 && <button class="btn sm" style="margin-top:8px" onClick={async () => { const [pl, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]); toast(await resendRides(sentRidesAhead(pl, w))); setDone({ ...done, ahead: 0 }); }}>Re-send {done.ahead} ride{done.ahead === 1 ? '' : 's'} to Garmin with the new numbers</button>}
    </section>
  );
  const lastTest = ev.tests[0]?.date;
  const check = ftpCheck({ ftp: p.ftp, ftpSetOn: p.ftpSetOn, proven: ev.proven, lastTestDate: lastTest, state, today: todayIs() });
  if (!check) return null;
  const save = async (s: FtpCheckState) => { setState(s); await setSetting(FTP_CHECK_KEY, s); };

  if (check.kind === 'stale') return (
    <section class="panel" style="margin-top:14px;padding:12px 16px">
      <div class="row between wrap" style="gap:8px;align-items:center">
        <span class="small">Your FTP was set {fmtDate(check.setOn, { month: 'long', day: 'numeric' })}. A ramp test would confirm it. <a href="#/workout/lib-ramp">Ramp Test</a></span>
        <button class="btn quiet sm" onClick={() => void save({ ...state, staleDismissedAt: todayIs() })}>Dismiss</button>
      </div>
    </section>
  );

  const fit = ev.fit!;
  const update = async () => {
    const r = await takeThreshold({ ftp: check.estimate });
    const [pl, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]);
    setDone({ text: `${r.text}${r.ok ? (zonesFollowFtp(p) ? ' Your power zones follow your FTP.' : ' Your power zones are set in watts and stay as they are.') : ''}`, ahead: r.ok ? sentRidesAhead(pl, w).length : 0 });
  };
  return (
    <section class="panel" style="margin-top:14px;padding:14px 16px;border-left:4px solid var(--good)">
      <h3 style="margin:0 0 6px;font-size:16px">Your riding shows a higher FTP</h3>
      <p class="small" style="margin:0">Your best {fit.points.map((x) => `${x.seconds / 60}-minute (${x.watts} W)`).join(', ').replace(/, ([^,]*)$/, ' and $1')} efforts in the last eight weeks line up on a sustainable level of {fit.cp} W, which puts your FTP at about <b class="num">{check.estimate} W</b>. Yours is set at {p.ftp} W.</p>
      <div class="row wrap" style="gap:8px;margin-top:10px">
        <button class="btn primary" onClick={() => void update()}>Update my FTP to {check.estimate} W</button>
        <button class="btn quiet" onClick={() => void save({ ...state, keptEstimate: check.estimate, keptAt: todayIs() })}>Keep {p.ftp} W</button>
      </div>
      {hasKey && <p class="faint small" style="margin:8px 0 0">Want a second opinion? <a href="#/settings">Estimate my FTP</a> in Settings asks the coach.</p>}
    </section>
  );
}
