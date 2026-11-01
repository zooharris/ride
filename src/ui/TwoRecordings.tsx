import { useState } from 'preact/hooks';
import { keepAntogoChoice, keepGarminChoice, pendingChoices, type PendingChoice } from '../player/garmin';
import { clock } from '../engine/workout';
import type { ActivityEdit, Ride } from '../engine/types';
import { APP_SHORT_NAME as APP_NAME } from '../appName';
import { swapToast } from './garminWatch';
import { notify } from './store';
import { toast } from './Toast';

/**
 * "Two recordings of <ride>" (Step 3 Part 2, 2B, 31 Oct): Antogo's recording
 * has the rider's breathing and the Garmin's doesn't, so the rider chooses which
 * to keep. Shown on Today and on both activities' pages until they do. `only`
 * limits it to the choice involving that activity.
 */
export function TwoRecordings({ edits, rides, only, top }: { edits: ActivityEdit[]; rides: Ride[]; only?: string; top?: boolean }) {
  const list = pendingChoices(edits, rides).filter((c) => !only || c.playerId === only || c.garminId === only);
  if (!list.length) return null;
  return <>{list.map((c) => <Choice key={c.playerId} c={c} top={top} />)}</>;
}

/** Which of power and heart rate a recording has, in words. */
function has(r: Ride): string {
  const parts = [r.averagePower ? `power ${Math.round(r.averagePower)} W` : '', r.averageHr ? `heart rate ${Math.round(r.averageHr)} bpm` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'no power or heart rate';
}

function Choice({ c, top }: { c: PendingChoice; top?: boolean }) {
  const [busy, setBusy] = useState(false);
  const secs = (r: Ride) => clock(r.elapsedSeconds ?? r.seconds);
  const keepAntogo = async () => {
    setBusy(true);
    try { await keepAntogoChoice(c.playerId); notify(); toast({ ok: true, text: `Kept ${APP_NAME}'s recording of ${c.name}, with your breathing. Your Garmin's stays in Garmin Connect, left out of training load so the ride counts once.` }); }
    catch (e) { toast({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const keepGarmin = async () => {
    setBusy(true);
    try { const s = await keepGarminChoice(c.playerId); notify(); swapToast(s); }
    catch (e) { toast({ ok: false, text: `Not done yet: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const mark = (who: 'antogo' | 'garmin') => (c.recommend.keep === who ? <span class="tag" style="--c:var(--good);margin-left:6px">Recommended</span> : null);
  return (
    <section class="panel two-recs" style={`margin-bottom:14px;padding:12px 16px${top ? ';margin-top:14px' : ''}`} aria-label={`Two recordings of ${c.name}`}>
      <b>Two recordings of {c.name}</b>
      <div class="two-recs-rows">
        <div class="two-recs-row"><span class="small"><b>{APP_NAME}</b>{mark('antogo')}</span><span class="small muted">{secs(c.antogo)} · {has(c.antogo)}, breathing</span></div>
        <div class="two-recs-row"><span class="small"><b>Garmin</b>{mark('garmin')}</span><span class="small muted">{secs(c.garmin)} · {has(c.garmin)}</span></div>
      </div>
      <p class="small" style="margin-top:6px">{APP_NAME}'s has your breathing; the Garmin's doesn't. Keeping the Garmin's loses it from this ride.{c.recommend.stoppedEarly ? ` ${APP_NAME}'s recording stopped early.` : ''}</p>
      <div class="row wrap" style="gap:8px;margin-top:10px">
        <button class="btn sm" disabled={busy} onClick={keepAntogo}>Keep {APP_NAME}'s</button>
        <button class="btn sm" disabled={busy} onClick={keepGarmin}>Keep Garmin's</button>
      </div>
    </section>
  );
}
