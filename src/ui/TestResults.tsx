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
import { breathCoveredRamp, clockOf, ftpBasisWords, spanWords, type TestResult } from '../player/tests';
export { testLines } from '../player/tests';
import { fmtDate } from './derived';
import { resendRides, sentRidesAhead, takeThreshold, zonesFollowFtp } from './testService';
import { toast } from './Toast';
import { CoachZones, ZoneCompare, breathTopsOf } from './ThresholdAdvice';
import { useHasKey } from './thresholdService';
import { zonesFromTest, type BreathTest, type VtPoint } from '../engine/breathThresholds';
import { BREATH_ZONE_NAMES, ladderPcts, ladderTops, rideHrZones, ridePowerZones } from '../engine/zones';
import { applyZones } from './testService';
import { maxHrInUse, useMaxHrSeen } from './maxHrSeen';

export function TestResults({ result, profile, onChange, compact }: { result: TestResult; profile: Profile; onChange: (r: TestResult) => void; compact?: boolean }) {
  // Diagnostics brief, Part B (7 Nov 2026): Estimate anyway shows the best estimate from imperfect data in place of the
  // strict read. It is kept only when the rider acts on something (the result passed to onChange then carries it).
  const [estimating, setEstimating] = useState(false);
  const est = estimating && result.breathEstimate ? result.breathEstimate : undefined;
  const shown: TestResult = est ? { ...result, breath: est, lthrEstimate: est.vt2?.hr ?? result.lthrEstimate } : result;
  // Review fix (7 Nov): the estimate is saved only by an action that uses it (Use these zones, Set my second threshold,
  // Update threshold heart rate from its second threshold); any other button saves the strict reading as it was.
  const save = (x: TestResult) => {
    const uses = !!est && ((x.zonesAction === 'applied' && result.zonesAction !== 'applied') || (x.vt2Action === 'set' && result.vt2Action !== 'set') || (x.lthrAction === 'updated' && result.lthrAction !== 'updated' && !!est.vt2));
    onChange(est && !uses ? { ...x, breath: result.breath, lthrEstimate: result.lthrEstimate } : x);
  };
  const r = shown;
  const ramp = r.kind === 'ramp';
  const hasKey = useHasKey();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ahead, setAhead] = useState<Array<{ p: PlannedWorkout; w: Workout }>>([]);
  const [resent, setResent] = useState(false);
  const [why, setWhy] = useState(false);
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
    save(which === 'ftp' ? { ...r, ftpAction: 'updated', ftpBefore: r.ftpBefore ?? before } : { ...r, lthrAction: 'updated', lthrBefore: r.lthrBefore ?? before });
    setBusy(false);
  };
  const keep = (which: 'ftp' | 'lthr') => save(which === 'ftp' ? { ...r, ftpAction: 'kept', ftpBefore: r.ftpBefore ?? ftpNow } : { ...r, lthrAction: 'kept', lthrBefore: r.lthrBefore ?? profile.lthr });
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
        <p class="test-lead">That suggests an FTP of <b class="num">{r.ftpEstimate} W</b>.<FtpWhy open={why} onToggle={() => setWhy(!why)} /></p>
        {why && <p class="small test-why-text">{FTP_WHY}</p>}
        {ramp && r.ftpWitnesses && r.ftpWitnesses.length > 1 && !r.ftpDisagree && <p class="muted small" style="margin:2px 0 0">From {ftpBasisWords(r)}.</p>}
        {ramp && r.ftpDisagree && <p class="muted small" style="margin:2px 0 0">{disagreeWords(r)}</p>}
        {ramp && r.hrAtFtp != null && r.lthrEstimate == null && <p class="muted small" style="margin:2px 0 0">{r.ftpHrAgrees ? <>Your heart rate when the ramp reached it was <b class="num">{r.hrAtFtp} bpm</b>, in line with your threshold heart rate.</> : <>Your heart rate when the ramp reached it was <b class="num">{r.hrAtFtp} bpm</b>.</>}</p>}
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

      {ramp && <Imperfect r={result} />}
      {ramp && r.breath && <BreathSection b={r.breath} allOut={r.judge?.allOut} />}
      {ramp && result.breathEstimate && !result.breath?.estimated && (
        <div class="test-row" style="border-top:0;padding-top:0">
          {!estimating
            ? <><button class="btn sm" onClick={() => setEstimating(true)}>Estimate anyway</button>
              <p class="faint small" style="margin:6px 0 0">Antogo will do its best with the breathing it has. Anything it finds is marked as an estimate.</p></>
            : <>{!est?.vt1 && !est?.vt2 && <p class="small" style="margin:0">Antogo looked again with what the strap sent and still couldn’t read a breathing threshold from it.</p>}
              <button class="btn quiet sm" style="margin-top:6px" onClick={() => setEstimating(false)}>Show the strict reading</button></>}
        </div>
      )}

      {r.lthrEstimate != null && (
        <div class="test-row">
          {ramp ? <p class="test-lead">Your heart rate at your second breathing threshold was <b class="num">{r.lthrEstimate} bpm</b>: {r.breath?.vt2?.certainty === 'unsure' ? 'a fair guide to your threshold heart rate, though that bend was less certain' : 'a good threshold heart rate'}.</p>
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
            {r.vo2maxAtLeast ? 'at least ' : 'about '}<b class="num">{r.vo2maxMlKgMin != null ? `${Math.round(r.vo2maxMlKgMin)}` : `${r.vo2maxLmin}`}</b> {r.vo2maxMlKgMin != null ? 'ml/kg/min' : 'litres a minute'}
            {r.vo2maxRange && !r.vo2maxAtLeast ? <span class="muted"> (likely {r.vo2maxRange[0]}–{r.vo2maxRange[1]})</span> : null}</p>
          <p class="faint small" style="margin:2px 0 0">{r.vo2maxAtLeast ? 'The test looks like it ended before you were all-out, so this is a floor rather than an estimate. ' : ''}Estimated from your peak power{r.peakWatts != null ? ` (${Math.round(r.peakWatts)} W)` : ''}{r.vo2maxMlKgMin != null ? ' and weight' : ''}. A lab measures it directly; this tracks your trend.{r.vo2maxMlKgMin == null ? <> <a href="#/settings">Add your weight in Settings</a> to see it per kilo.</> : null}</p>
        </div>
      )}
      {ramp && r.breath && <TestZones r={r} profile={profile} onChange={save} hasKey={hasKey} />}
      {hasKey && r.ftpEstimate != null && (
        <div class="test-row">
          <p class="small" style="margin:0">{ramp && r.breath?.vt1 && r.breath.vt2 ? 'Want the coach to check these zones against your recent riding before you decide?' : 'Want the coach to check your zones against this test?'}</p>
          <CoachZones profile={profile} label={ramp && r.breath?.vt1 && r.breath.vt2 ? 'Check them against my riding' : 'Analyse my zones with this test'} />
        </div>
      )}
    </div>
  );
}

/** What a missing threshold means, in words the rider can act on. Part A2: the reason given is the one the readings show. */
function missingWords(b: BreathTest, allOut?: string): string {
  const notAllOut = allOut === 'no';
  switch (b.missing) {
    case 'no-breathing': return 'There was breathing but no power to read it against, so the breathing thresholds couldn’t be worked out.';
    case 'strap-stopped': return b.breathEndAt != null && b.rampEndAt != null
      ? `Your breathing strap stopped sending readings at ${clockOf(b.breathEndAt)}, ${spanWords(b.rampEndAt - b.breathEndAt)} before you stopped, so the test’s last minutes have no breathing and the second threshold couldn’t be found. Check the strap is snug before the next test.`
      : 'Your breathing strap stopped sending readings before the ramp ended, so the second threshold couldn’t be found. Check the strap is snug before the next test.';
    case 'patchy': return 'The breathing strap’s readings had gaps through the ramp, so the breathing thresholds couldn’t be read. Check the strap is snug before your next test, whenever it suits you.';
    case 'flat': return 'Your breathing barely rose with the effort on this ramp, neither how much air you moved nor how fast you breathed, which usually means the strap wasn’t snug enough to follow your breathing. Tighten it before your next test, whenever it suits you.';
    case 'too-short': return 'The ramp was too short to read breathing thresholds from. They need at least five minutes of ramp.';
    case 'no-vt1': return b.readBy === 'br'
      ? 'Your first breathing threshold didn’t show: it appears in how much air you move, which this strap records only faintly. Rides with the strap at easy and steady efforts give Antogo another way to find it.'
      : 'Your first breathing threshold didn’t show clearly. Choosing a smaller step on the next ramp gives it more room to appear.';
    case 'no-vt2': return notAllOut ? 'Your second breathing threshold didn’t show: the test ended before your breathing turned sharply upward. Riding your next one, whenever it suits you, until you truly can’t turn the pedals should reveal it.' : 'Your second breathing threshold didn’t show clearly on this ramp.';
    default: return notAllOut ? 'Your breathing didn’t show a clear bend on this ramp, so there are no breathing thresholds from it. A later test, whenever it suits you, ridden until you truly can’t turn the pedals, usually shows them.' : 'Your breathing didn’t show a clear bend on this ramp, so there are no breathing thresholds from it.';
  }
}

/** Diagnostics brief, Part B (7 Nov 2026): what was imperfect during the ramp, one plain line per stream, only when true. */
function Imperfect({ r }: { r: TestResult }) {
  const lines: string[] = [];
  const b = r.breath;
  if (b?.missing === 'patchy' && b.missingSeconds) lines.push(`Your breathing strap’s readings had gaps adding up to about ${spanWords(b.missingSeconds)} of the ramp.`);
  if (r.gaps?.hr) lines.push(`Heart rate was missing for ${spanWords(r.gaps.hr)} of the ramp.`);
  if (r.gaps?.power) lines.push(`Power was missing for ${spanWords(r.gaps.power)} of the ramp.`);
  if (!lines.length) return null;
  return <div class="test-row">{lines.map((l) => <p key={l} class="small" style="margin:0 0 2px">{l}</p>)}</div>;
}

/** Part A10 (4 Nov 2026): why Antogo's FTP may differ from other apps'. The same words for every rider; nothing more. */
export const FTP_WHY = 'Antogo’s FTP is built from more than one source of your own data when they are available: your test, your heart rate, your breathing thresholds and your recent rides, weighed together. Many apps and devices use power alone, and each uses its own rule, so their figures can differ from Antogo’s and from each other’s.';

function FtpWhy({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return <button type="button" class="test-info test-why" aria-expanded={open} aria-label="How Antogo works out your FTP" title="How Antogo works out your FTP" onClick={onToggle}>?</button>;
}

/** Part A3: the witnesses disagreed, in one sentence. */
function disagreeWords(r: TestResult): string {
  const vt2 = r.ftpWitnesses?.find((x) => x.source === 'vt2'), riding = r.ftpWitnesses?.find((x) => x.source === 'riding');
  const other = vt2 ? `your second breathing threshold pointed to ${vt2.watts} W` : riding ? `your recent riding points to ${riding.watts} W` : '';
  return `Your best minute points to ${r.ftpFromBestMinute ?? r.ftpEstimate} W${other ? ` and ${other}` : ''}; these are far enough apart that Antogo offers the best-minute figure.`;
}

function VtRow({ name, sub, v, estimated }: { name: string; sub: string; v: VtPoint; estimated?: boolean }) {
  return (
    <div class="vt-row">
      <div><b>{name}</b> <span class="faint small">{sub}</span></div>
      <div class="vt-nums">
        <span><b class="num">{v.watts}</b> W</span>
        {v.hr != null && <span><b class="num">{v.hr}</b> bpm</span>}
        <span><b class="num">{Math.round(v.ve)}</b> L/min</span>
        {v.certainty === 'unsure' && <span class="pill">{estimated ? 'estimated from imperfect data' : 'less certain'}</span>}
      </div>
    </div>
  );
}

/** The two breathing thresholds the ramp showed, or why one is missing. */
function BreathSection({ b, allOut }: { b: BreathTest; allOut?: string }) {
  const unsure = !b.estimated && (b.vt1?.certainty === 'unsure' || b.vt2?.certainty === 'unsure');
  return (
    <div class="test-row">
      <p class="test-lead" style="margin-bottom:6px">Your breathing thresholds</p>
      {b.vt1 && <VtRow name="First threshold (VT1)" sub="the top of all-day endurance riding" v={b.vt1} estimated={b.estimated} />}
      {b.vt2 && <VtRow name="Second threshold (VT2)" sub="the most you can sustain for long" v={b.vt2} estimated={b.estimated} />}
      {b.missing && b.missing !== 'none' || (!b.vt1 && !b.vt2) ? <p class="small" style="margin:6px 0 0">{missingWords(b, allOut)}</p> : null}
      {b.readBy === 'br' && (b.vt1 || b.vt2) && <p class="muted small" style="margin:6px 0 0">Read from how fast you breathed: this strap records how much air you move only faintly, so the litres a minute barely rose, while the quickening of your breathing showed the threshold clearly.</p>}
      {unsure && <p class="muted small" style="margin:6px 0 0">A threshold marked less certain was a gentle or unsteady bend in your breathing, or the strap missed some readings beside it; a later test, whenever it suits you, would firm it up{b.vt1?.certainty === 'unsure' ? ' (a smaller step gives the first threshold more room to show)' : ''}.</p>}
      {b.peakVe != null && breathCoveredRamp(b) && <p class="muted small" style="margin:6px 0 0">Peak breathing: <b class="num">{b.peakVe} L/min</b>{b.brCapped ? ', breathing rate at the strap’s ceiling of 60 a minute' : b.peakBr != null ? `, ${b.peakBr} breaths a minute` : ''}. Compare it from test to test as a marker of your aerobic fitness.</p>}
      {(b.vt1 || b.vt2) && <p class="faint small" style="margin:6px 0 0">These stand in for your lactate thresholds (LT1 and LT2), which only a blood test measures.</p>}
    </div>
  );
}

/**
 * The zones this test suggests, anchored on its breathing thresholds, beside
 * the rider's current ones: Use these zones or Keep my zones.
 */
/**
 * Step 2c, Part C (7 Nov 2026): a test that found the second breathing threshold but not the first (a strap that
 * compresses breath size) can still set the second, so a breathing table exists, provisional until the rider's
 * rides with the strap find the first. Only the breathing threshold is set; power and heart-rate zones are untouched.
 */
function SecondOnly({ r, profile, onChange }: { r: TestResult; profile: Profile; onChange: (r: TestResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const v = r.breath!.vt2!;
  const ve = Math.round(v.ve * 10) / 10;
  const same = profile.vt2Ve != null && Math.abs(profile.vt2Ve - ve) < 0.1;
  const set = async () => {
    setBusy(true);
    const res = await applyZones(undefined, undefined, { vt2Ve: ve });
    setMsg(res);
    if (res.ok) onChange({ ...r, vt2Action: 'set' });
    setBusy(false);
  };
  const pcts = [60, 75, 100, 115];
  return (
    <div class="test-row">
      <p class="test-lead" style="margin-bottom:2px">Your breathing zones</p>
      <p class="muted small" style="margin:0">This test found your second breathing threshold ({ve} L/min at {v.watts} W) but not your first. Setting the second gives you a breathing table now: provisional until your first threshold is found, which your easy and steady rides with the strap will do. Your power and heart-rate zones stay as they are.</p>
      <p class="faint small" style="margin:6px 0 0">Zone tops as shares of the second threshold: {pcts.map((x, i) => `Z${i + 1} ${x}% (${Math.round((x / 100) * ve * 10) / 10} L/min)`).join(' · ')}; Z5 above.</p>
      {r.vt2Action === 'set' || same ? <p class="small" style="margin:8px 0 0"><span class="rd-state on">Set</span> {msg?.text ?? `Your second breathing threshold is ${profile.vt2Ve ?? ve} L/min.`}</p>
        : <>
          <div class="row wrap" style="gap:8px;margin-top:10px">
            <button class="btn" disabled={busy} onClick={() => void set()}>Set my second breathing threshold from this test</button>
            {r.vt2Action !== 'kept' && <button class="btn quiet" disabled={busy} onClick={() => onChange({ ...r, vt2Action: 'kept' })}>Keep {profile.vt2Ve ? `${profile.vt2Ve} L/min` : 'it unset'}</button>}
          </div>
          {r.vt2Action === 'kept' && <p class="muted small" style="margin:6px 0 0">You kept it as it was.</p>}
          {msg && !msg.ok && <p class="small" style="margin:8px 0 0;color:var(--bad)">{msg.text}</p>}
        </>}
    </div>
  );
}

function TestZones({ r, profile, onChange, hasKey }: { r: TestResult; profile: Profile; onChange: (r: TestResult) => void; hasKey: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Part A5: heart rate is capped at the highest seen in the rider's rides when that is above the setting.
  const seen = useMaxHrSeen();
  const z = zonesFromTest(r.breath, { ftp: r.ftpEstimate ?? profile.ftp, lthr: r.lthrEstimate ?? profile.lthr, maxHr: maxHrInUse(profile.maxHr, seen ?? undefined), powerPcts: ladderPcts(ridePowerZones(profile)), hrPcts: ladderPcts(rideHrZones(profile)) });
  if (!z.powerTops && !z.hrTops && !z.breathPcts) return r.breath?.vt2 && !r.breath.vt1 ? <SecondOnly r={r} profile={profile} onChange={onChange} /> : null;
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
      <p class="muted small" style="margin:0">In the power and heart-rate tables, zone 2 ends at your first threshold and zone 4 at your second; the zones above keep the shares of threshold you have now. In the breathing table, zones 2 and 3 end at your two thresholds.{r.breath?.vt1?.certainty === 'unsure' || r.breath?.vt2?.certainty === 'unsure' ? ' A threshold here was less certain, so these are a first draft until a later test confirms it.' : ''}{hasKey ? '' : ' Antogo can also check them against your recent riding when a coach key is added in Settings.'}</p>
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
