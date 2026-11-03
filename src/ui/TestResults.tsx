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
import { CoachZones, ZoneCompare, breathTopsOf } from './ThresholdAdvice';
import { useHasKey } from './thresholdService';
import { zonesFromTest, type BreathTest, type VtPoint } from '../engine/breathThresholds';
import { BREATH_ZONE_NAMES, ladderPcts, ladderTops, rideHrZones, ridePowerZones } from '../engine/zones';
import { applyZones } from './testService';

export function TestResults({ result, profile, onChange, compact }: { result: TestResult; profile: Profile; onChange: (r: TestResult) => void; compact?: boolean }) {
  const r = result;
  const ramp = r.kind === 'ramp';
  const hasKey = useHasKey();
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

      {ramp && r.breath && <BreathSection b={r.breath} />}

      {r.lthrEstimate != null && (
        <div class="test-row">
          {ramp ? <p class="test-lead">Your heart rate at your second breathing threshold was <b class="num">{r.lthrEstimate} bpm</b>: a good threshold heart rate.</p>
            : <p class="test-lead">Your heart rate over the last fifteen minutes averaged <b class="num">{r.lthrEstimate} bpm</b>: a good threshold heart rate.</p>}
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
      {ramp && r.hrAtFtp != null && r.lthrEstimate == null && <p class="muted small test-row" style="margin:0">Heart rate when you passed your new FTP: <b class="num">{r.hrAtFtp} bpm</b>.</p>}
      {ramp && r.breath && <TestZones r={r} profile={profile} onChange={onChange} hasKey={hasKey} />}
      {hasKey && r.ftpEstimate != null && (
        <div class="test-row">
          <p class="small" style="margin:0">{ramp && r.breath?.vt1 && r.breath.vt2 ? 'Want the coach to check these zones against your recent riding before you decide?' : 'Want the coach to check your zones against this test?'}</p>
          <CoachZones profile={profile} label={ramp && r.breath?.vt1 && r.breath.vt2 ? 'Check them against my riding' : 'Analyse my zones with this test'} />
        </div>
      )}
    </div>
  );
}

/** What a missing threshold means, in words the rider can act on. */
const MISSING: Record<NonNullable<BreathTest['missing']>, string> = {
  'no-breathing': 'There was breathing but no power to read it against, so the breathing thresholds couldn’t be worked out.',
  patchy: 'The breathing strap’s readings had gaps through the ramp, so the breathing thresholds couldn’t be read. Check the strap is snug and repeat the test when it suits you.',
  'too-short': 'The ramp was too short to read breathing thresholds from. They need at least five minutes of ramp.',
  none: 'Your breathing didn’t show a clear bend on this ramp, so there are no breathing thresholds from it. Repeating the test, ridden until you truly can’t turn the pedals, usually shows them.',
  'no-vt1': 'Your first breathing threshold didn’t show clearly. Choosing a smaller step on the next ramp gives it more room to appear.',
  'no-vt2': 'Your second breathing threshold didn’t show: the test may have ended before your breathing turned sharply upward. Riding the next one until you truly can’t turn the pedals should reveal it.',
};

function VtRow({ name, sub, v }: { name: string; sub: string; v: VtPoint }) {
  return (
    <div class="vt-row">
      <div><b>{name}</b> <span class="faint small">{sub}</span></div>
      <div class="vt-nums">
        <span><b class="num">{v.watts}</b> W</span>
        {v.hr != null && <span><b class="num">{v.hr}</b> bpm</span>}
        <span><b class="num">{Math.round(v.ve)}</b> L/min</span>
        {v.certainty === 'unsure' && <span class="pill">less certain</span>}
      </div>
    </div>
  );
}

/** The two breathing thresholds the ramp showed, or why one is missing. */
function BreathSection({ b }: { b: BreathTest }) {
  const unsure = b.vt1?.certainty === 'unsure' || b.vt2?.certainty === 'unsure';
  return (
    <div class="test-row">
      <p class="test-lead" style="margin-bottom:6px">Your breathing thresholds</p>
      {b.vt1 && <VtRow name="First threshold (VT1)" sub="the top of all-day endurance riding" v={b.vt1} />}
      {b.vt2 && <VtRow name="Second threshold (VT2)" sub="the most you can sustain for long" v={b.vt2} />}
      {b.missing && b.missing !== 'none' || (!b.vt1 && !b.vt2) ? <p class="small" style="margin:6px 0 0">{MISSING[b.missing ?? 'none']}</p> : null}
      {unsure && <p class="muted small" style="margin:6px 0 0">A threshold marked less certain was a gentle bend in your breathing; a repeat test would firm it up.</p>}
      {b.peakVe != null && b.missing !== 'patchy' && <p class="muted small" style="margin:6px 0 0">Peak breathing: <b class="num">{b.peakVe} L/min</b>{b.peakBr != null ? `, ${b.peakBr} breaths a minute` : ''}. Compare it from test to test as a marker of your aerobic fitness.</p>}
      {(b.vt1 || b.vt2) && <p class="faint small" style="margin:6px 0 0">These stand in for your lactate thresholds (LT1 and LT2), which only a blood test measures.</p>}
    </div>
  );
}

/**
 * The zones this test suggests, anchored on its breathing thresholds, beside
 * the rider's current ones: Use these zones or Keep my zones.
 */
function TestZones({ r, profile, onChange, hasKey }: { r: TestResult; profile: Profile; onChange: (r: TestResult) => void; hasKey: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const z = zonesFromTest(r.breath, { ftp: r.ftpEstimate ?? profile.ftp, lthr: r.lthrEstimate ?? profile.lthr, maxHr: profile.maxHr, powerPcts: ladderPcts(ridePowerZones(profile)), hrPcts: ladderPcts(rideHrZones(profile)) });
  if (!z.powerTops && !z.hrTops && !z.breathPcts) return null;
  const nowP = ladderTops(ridePowerZones(profile), profile.ftp);
  const nowH = ladderTops(rideHrZones(profile), profile.lthr);
  const nowB = breathTopsOf(profile);
  const nextB = z.breathPcts && z.vt2Ve ? z.breathPcts.map((x) => Math.round((x / 100) * z.vt2Ve! * 10) / 10) : undefined;
  const use = async () => {
    setBusy(true);
    const res = await applyZones(z.powerTops, z.hrTops, z.breathPcts ? { vt1Ve: z.vt1Ve, vt2Ve: z.vt2Ve, pcts: z.breathPcts } : undefined);
    setMsg(res);
    if (res.ok) onChange({ ...r, zonesAction: 'applied' });
    setBusy(false);
  };
  return (
    <div class="test-row">
      <p class="test-lead" style="margin-bottom:2px">Zones from this test</p>
      <p class="muted small" style="margin:0">In the power and heart-rate tables, zone 2 ends at your first threshold and zone 4 at your second; the zones above keep the shares of threshold you have now. In the breathing table, zones 2 and 3 end at your two thresholds.{hasKey ? '' : ' Antogo can also check them against your recent riding when a coach key is added in Settings.'}</p>
      <div class="coach-tables">
        {z.powerTops && <ZoneCompare title="Power zones (top of each, watts)" now={nowP} next={z.powerTops} unit="W" />}
        {z.hrTops && <ZoneCompare title="Heart-rate zones (top of each, bpm)" now={nowH} next={z.hrTops} unit="bpm" />}
        {nextB && <ZoneCompare title="Breathing zones (top of each, litres a minute)" now={nowB} next={nextB} unit="L/min" names={BREATH_ZONE_NAMES} />}
      </div>
      {r.zonesAction === 'applied' ? <p class="small" style="margin:8px 0 0"><span class="rd-state on">Updated</span> {msg?.text ?? 'You’re using the zones from this test.'}</p>
        : <>
          <div class="row wrap" style="gap:8px;margin-top:10px">
            <button class="btn" disabled={busy} onClick={() => void use()}>Use these zones</button>
            {r.zonesAction !== 'kept' && <button class="btn quiet" disabled={busy} onClick={() => onChange({ ...r, zonesAction: 'kept' })}>Keep my zones</button>}
          </div>
          {r.zonesAction === 'kept' && <p class="muted small" style="margin:6px 0 0">You kept your zones.</p>}
          {msg && !msg.ok && <p class="small" style="margin:8px 0 0;color:var(--bad)">{msg.text}</p>}
        </>}
    </div>
  );
}
