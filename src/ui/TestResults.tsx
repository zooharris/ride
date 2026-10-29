/**
 * A fitness test's results, as the rider sees them after the test and on the
 * activity's page: what the test found, each suggested setting with Update
 * (the main action) or Keep, the VO2max estimate, and, once FTP is updated,
 * the offer to re-send rides already on the Garmin. Pure display plus the
 * actions; the caller keeps the result (on the recording).
 */
import { useEffect, useState } from 'preact/hooks';
import { db } from '../data/db';
import type { PlannedWorkout, Profile, Workout } from '../engine/types';
import type { TestResult } from '../player/tests';
export { testLines } from '../player/tests';
import { fmtDate } from './derived';
import { resendRides, sentRidesAhead, takeThreshold, zonesFollowFtp } from './testService';
import { toast } from './Toast';

export function TestResults({ result, profile, onChange, compact }: { result: TestResult; profile: Profile; onChange: (r: TestResult) => void; compact?: boolean }) {
  const r = result;
  const ramp = r.kind === 'ramp';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ahead, setAhead] = useState<Array<{ p: PlannedWorkout; w: Workout }>>([]);
  const [resent, setResent] = useState(false);
  const ftpNow = profile.ftp;
  const ftpEq = r.ftpEstimate != null && r.ftpEstimate === ftpNow;
  const lthrEq = r.lthrEstimate != null && r.lthrEstimate === profile.lthr;
  // Once FTP is updated: the rides already sent to the Garmin still carry the old watts.
  useEffect(() => {
    if (r.ftpAction !== 'updated') return;
    void Promise.all([db.planned.toArray(), db.workouts.toArray()]).then(([p, w]) => setAhead(sentRidesAhead(p, w)));
  }, [r.ftpAction]);

  const take = async (which: 'ftp' | 'lthr') => {
    setBusy(true);
    const before = which === 'ftp' ? ftpNow : profile.lthr;
    const res = await takeThreshold(which === 'ftp' ? { ftp: r.ftpEstimate } : { lthr: r.lthrEstimate });
    setMsg(res);
    onChange(which === 'ftp' ? { ...r, ftpAction: 'updated', ftpBefore: r.ftpBefore ?? before } : { ...r, lthrAction: 'updated', lthrBefore: r.lthrBefore ?? before });
    setBusy(false);
  };
  const keep = (which: 'ftp' | 'lthr') => onChange(which === 'ftp' ? { ...r, ftpAction: 'kept', ftpBefore: r.ftpBefore ?? ftpNow } : { ...r, lthrAction: 'kept', lthrBefore: r.lthrBefore ?? profile.lthr });
  const resend = async () => {
    setBusy(true);
    const res = await resendRides(ahead);
    toast(res);
    if (res.ok) setResent(true);
    setBusy(false);
  };
  const setOn = profile.ftpSetOn ? ` (set ${fmtDate(profile.ftpSetOn, { month: 'long', day: 'numeric' })})` : '';

  return (
    <div class={`test-res${compact ? ' compact' : ''}`}>
      <h2 class="pl-h2">{ramp ? 'Ramp test' : '20-minute FTP test'}</h2>
      {r.ftpEstimate == null ? (
        <p class="muted">{ramp ? 'There weren’t enough power readings to work out an FTP.' : 'The twenty minutes weren’t ridden in full with power, so there’s no FTP to take from this one.'}</p>
      ) : <>
        <p class="test-lead">{ramp ? <>Your best minute was <b class="num">{r.bestMinuteWatts} W</b>.</> : <>You averaged <b class="num">{r.testWatts} W</b> over the twenty minutes.</>}{r.fromStreams && ramp ? <span class="muted small"> (from the recording in Intervals.icu)</span> : null}</p>
        <p class="test-lead">That suggests an FTP of <b class="num">{r.ftpEstimate} W</b>.</p>
        {r.ftpAction === 'updated' ? (
          <p class="small"><span class="rd-state on">Updated</span> Your FTP is {ftpNow} W{r.ftpBefore != null && r.ftpBefore !== ftpNow ? ` (was ${r.ftpBefore} W)` : ''}. {zonesFollowFtp(profile) ? 'Your power zones follow your FTP, so every ride’s targets are updated.' : <>Your power zones are set in watts and stay as they are. <a href="#/settings">Review them in Settings</a>.</>}</p>
        ) : ftpEq ? (
          <p class="muted small">That matches your FTP setting.</p>
        ) : <>
          <p class="muted small">Your FTP is {ftpNow > 0 ? `currently ${ftpNow} W${setOn}` : 'not yet set'}.{r.ftpAction === 'kept' ? ' You kept it.' : ''}</p>
          <div class="row wrap" style="gap:8px;margin-top:8px">
            <button class="btn primary" disabled={busy} onClick={() => void take('ftp')}>Update my FTP to {r.ftpEstimate} W</button>
            {r.ftpAction !== 'kept' && ftpNow > 0 && <button class="btn quiet" disabled={busy} onClick={() => keep('ftp')}>Keep {ftpNow} W</button>}
          </div>
        </>}
        {msg && <p class="small" style={`margin:8px 0 0;color:${msg.ok ? 'var(--ink-2)' : 'var(--bad)'}`}>{msg.text}</p>}
        {r.ftpAction === 'updated' && ahead.length > 0 && !resent && (
          <button class="btn" style="margin-top:10px" disabled={busy} onClick={() => void resend()}>Re-send {ahead.length} ride{ahead.length === 1 ? '' : 's'} to Garmin with the new numbers</button>
        )}
      </>}

      {!ramp && r.lthrEstimate != null && (
        <div class="test-row">
          <p class="test-lead">Your heart rate over the last fifteen minutes averaged <b class="num">{r.lthrEstimate} bpm</b>: a good threshold heart rate.</p>
          {r.lthrAction === 'updated' ? <p class="small"><span class="rd-state on">Updated</span> Your threshold heart rate is {profile.lthr} bpm{r.lthrBefore != null && r.lthrBefore !== profile.lthr ? ` (was ${r.lthrBefore})` : ''}.</p>
            : lthrEq ? <p class="muted small">That matches your threshold heart rate setting.</p>
            : <>
              <p class="muted small">Yours is currently {profile.lthr} bpm.{r.lthrAction === 'kept' ? ' You kept it.' : ''}</p>
              <div class="row wrap" style="gap:8px;margin-top:8px">
                <button class={`btn${r.ftpEstimate == null ? ' primary' : ''}`} disabled={busy} onClick={() => void take('lthr')}>Update my threshold heart rate to {r.lthrEstimate} bpm</button>
                {r.lthrAction !== 'kept' && <button class="btn quiet" disabled={busy} onClick={() => keep('lthr')}>Keep {profile.lthr} bpm</button>}
              </div>
            </>}
        </div>
      )}

      {ramp && (r.vo2maxMlKgMin != null || r.vo2maxLmin != null) && (
        <div class="test-row">
          <p style="margin:0"><span class="caption">VO2max estimate</span>{' '}
            <b class="num">{r.vo2maxMlKgMin != null ? `${r.vo2maxMlKgMin}` : `${r.vo2maxLmin}`}</b> {r.vo2maxMlKgMin != null ? 'ml/kg/min' : 'litres a minute'}
            <span class="test-info" tabindex={0} title="Estimated from your peak power and weight. A lab measures it directly; this tracks your trend." aria-label="Estimated from your peak power and weight. A lab measures it directly; this tracks your trend.">i</span></p>
          <p class="faint small" style="margin:2px 0 0">Estimated from your peak power{r.peakWatts != null ? ` (${Math.round(r.peakWatts)} W)` : ''}{r.vo2maxMlKgMin != null ? ' and weight' : ''}. A lab measures it directly; this tracks your trend.{r.vo2maxMlKgMin == null ? <> <a href="#/settings">Add your weight in Settings</a> to see it per kilo.</> : null}</p>
        </div>
      )}
      {ramp && r.hrAtFtp != null && <p class="muted small test-row" style="margin:0">Heart rate when you passed your new FTP: <b class="num">{r.hrAtFtp} bpm</b>.</p>}
    </div>
  );
}
