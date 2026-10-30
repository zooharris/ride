/**
 * Today's FTP panel (Step 2b, the quiet version). Two messages, nothing else:
 * "Antogo estimates your FTP is now X" with Update or Keep, or "Time for a ramp
 * test?" with the date FTP last changed. How the app decides is never shown; the
 * one link goes to Help's paragraph. Shown with or without a coach key.
 */
import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting, db } from '../data/db';
import { ftpCheck, type FtpCheckState } from '../engine/ftpCheck';
import { today as todayIs } from '../engine/load';
import { useEvidence } from './thresholdService';
import { resendRides, sentRidesAhead, takeThreshold } from './testService';
import { fmtDate } from './derived';
import { toast } from './Toast';
import type { AppData } from './store';

export const FTP_CHECK_KEY = 'ftpCheck';

export function FtpCheckPanel({ data }: { data: AppData }) {
  const ev = useEvidence(data);
  const [state, setState] = useState<FtpCheckState | undefined>(undefined);
  const [done, setDone] = useState<{ text: string; ahead: number } | null>(null);
  useEffect(() => { void getSetting<FtpCheckState>(FTP_CHECK_KEY, {}).then((s) => setState(s ?? {})); }, []);
  const p = data.profile;
  if (!p || !ev || state === undefined) return null;
  if (done) return (
    <section class="panel" style="margin-top:14px;padding:12px 16px">
      <p class="small" style="margin:0">{done.text}</p>
      {done.ahead > 0 && <button class="btn sm" style="margin-top:8px" onClick={async () => { const [pl, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]); toast(await resendRides(sentRidesAhead(pl, w))); setDone({ ...done, ahead: 0 }); }}>Re-send {done.ahead} ride{done.ahead === 1 ? '' : 's'} to Garmin with the new FTP</button>}
    </section>
  );
  const check = ftpCheck({ ftp: p.ftp, ftpSetOn: p.ftpSetOn, estimate: ev.proven, lastTestDate: ev.lastTestDate, everTested: ev.everTested, signs: ev.signs, state, today: todayIs() });
  if (!check) return null;
  const save = async (s: FtpCheckState) => { setState(s); await setSetting(FTP_CHECK_KEY, s); };

  if (check.kind === 'test') return (
    <section class="panel" style="margin-top:14px;padding:14px 16px">
      <h3 style="margin:0 0 4px;font-size:16px">Time for a ramp test?</h3>
      <p class="small" style="margin:0">{check.setOn ? `Your FTP hasn't changed since ${fmtDate(check.setOn, { month: 'long', day: 'numeric' })}.` : "Your FTP hasn't been checked with a test."}</p>
      <div class="row wrap" style="gap:8px;margin-top:10px">
        <a class="btn" href="#/workout/lib-ramp">Ramp Test</a>
        <button class="btn quiet" onClick={() => void save({ ...state, notNowAt: todayIs(), staleDismissedAt: undefined })}>Not now</button>
      </div>
    </section>
  );

  const update = async () => {
    const r = await takeThreshold({ ftp: check.estimate });
    const [pl, w] = await Promise.all([db.planned.toArray(), db.workouts.toArray()]);
    setDone({ text: r.text, ahead: r.ok ? sentRidesAhead(pl, w).length : 0 });
  };
  return (
    <section class="panel" style="margin-top:14px;padding:14px 16px">
      <h3 style="margin:0 0 4px;font-size:16px">Antogo estimates your FTP is now {check.estimate} W</h3>
      <p class="small muted" style="margin:0">Currently {p.ftp} W.</p>
      <div class="row wrap" style="gap:8px;margin-top:10px">
        <button class="btn primary" onClick={() => void update()}>Update to {check.estimate} W</button>
        <button class="btn quiet" onClick={() => void save({ ...state, keptEstimate: check.estimate, keptAt: todayIs() })}>Keep {p.ftp} W</button>
      </div>
      <p class="small" style="margin:8px 0 0"><a href="#/help?s=today">How is this worked out?</a></p>
    </section>
  );
}
