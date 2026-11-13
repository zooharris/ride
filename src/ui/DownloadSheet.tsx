import { useEffect, useState } from 'preact/hooks';
import type { PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import { hasTwoVersions, onGarmin, sendDefault, type PlanDays, type SendBasis, type Where } from '../library/sendWhere';
import { canSendByBreath } from '../library/breathSend';
import { ACTIVITY_FORMAT_LABEL, ACTIVITY_FORMAT_WHAT, WORKOUT_FORMAT_LABEL, WORKOUT_FORMAT_WHAT, workoutExportable, workoutFile, workoutOffers, type ActivityFormat, type FileOut, type WorkoutFormat } from '../export/formats';
import { activityFile, activityOffers, originOf, type ActivityFileResult } from '../export/activity';
import { deliver, sharesFiles } from '../export/deliver';
import { sendWays, useBreathTable } from './SendButton';
import { credentials } from '../sync/syncService';
import { db } from '../data/db';
import { today } from '../engine/load';
import type { AppData } from './store';
import { toast } from './Toast';
import { knownFtp } from '../engine/known';

/**
 * Download one workout or one finished activity, at any time (12 Nov 2026). A small sheet: the format and, for a
 * ride, the same targets and version choices as Send, starting on the same defaults. A single download always
 * downloads: it asks nothing about where the file is going and leaves nothing out.
 */

const SEG: Record<SendBasis, string> = { power: 'Power', hr: 'Heart rate', breath: 'Breathing' };

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: preact.ComponentChildren }) {
  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" style="max-width:520px" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 style="margin:0 0 10px">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A choice of format: each with what it is for; one that can't be used says why and can't be picked. */
function Formats<F extends string>({ offers, value, set, label, what }: { offers: Array<{ format: F; ok: boolean; why?: string }>; value: F; set: (f: F) => void; label: Record<F, string>; what: Record<F, string> }) {
  return (
    <div class="stack" style="gap:6px" role="radiogroup" aria-label="Format">
      {offers.map((o) => (
        <label key={o.format} class={`dl-opt${o.ok ? '' : ' off'}`}>
          <input type="radio" name="dl-format" checked={value === o.format} disabled={!o.ok} onChange={() => set(o.format)} />
          <span><b>{label[o.format]}</b><span class="faint small" style="display:block">{o.ok ? what[o.format] : o.why}</span></span>
        </label>
      ))}
    </div>
  );
}

/** Download for a workout's page: rides, runs, walks, strength and mobility. */
export function DownloadWorkout({ w, entry, profile, plans, onClose }: { w: Workout; entry?: PlannedWorkout; profile: Profile; plans: PlanDays[]; onClose: () => void }) {
  const table = useBreathTable();
  const ride = w.kind === 'ride';
  const ways = ride ? sendWays(w, profile) : [];
  const breathOk = canSendByBreath(w, profile, table);
  // The same starting point as Send: what was sent for a sent entry, else the rider's default and the plan's version.
  const start = entry?.status === 'sent' && ride ? onGarmin(entry, w, plans) : sendDefault(entry ?? { date: today() }, w, profile.basis, plans, !!profile.preferBreath && breathOk);
  const [basis, setBasis] = useState<SendBasis>(start.basis);
  const [where, setWhere] = useState<Where | undefined>(start.where);
  // Watts need an FTP: with none known yet, the watts file is offered with the reason it can't be made (13 Nov 2026).
  const noFtp = (o: { format: WorkoutFormat; ok: boolean; why?: string }) => (o.format === 'erg' && o.ok && !knownFtp(profile) ? { ...o, ok: false, why: 'This file holds watts, and your FTP is not known yet. The other types hold shares of FTP.' } : o);
  const offers = workoutOffers(w, basis).map(noFtp);
  const firstOk = (b: SendBasis) => workoutOffers(w, b).map(noFtp).find((o) => o.ok)?.format;
  const [format, setFormat] = useState<WorkoutFormat | undefined>(firstOk(start.basis));
  // A change of targets keeps the format when it still works, else takes the first that does.
  useEffect(() => { if (!format || !offers.find((o) => o.format === format)?.ok) setFormat(firstOk(basis)); }, [basis]);
  const can = workoutExportable(w);
  const go = async () => {
    if (!format) return;
    try {
      const f = workoutFile(w, format, { basis, where }, profile, table, entry?.date);
      if (await deliver([f])) { toast({ ok: true, text: `Downloaded ${f.name}.` }); onClose(); }
    } catch (e) { toast({ ok: false, text: `Could not make the file: ${(e as Error).message}` }); }
  };
  return (
    <Sheet title={`Download workout file: ${w.name}`} onClose={onClose}>
      {!can.ok ? <p class="muted small">{can.why}</p> : (
        <>
          {ride && ways.length > 1 && <div class="send-row" style="margin-bottom:10px"><span class="small muted">Targets</span>
            <div class="seg" role="group" aria-label="Targets">{ways.map((b) => <button key={b} class={basis === b ? 'on' : ''} aria-pressed={basis === b} disabled={b === 'breath' && !breathOk} onClick={() => setBasis(b)}>{SEG[b]}</button>)}</div></div>}
          {ride && ways.length === 1 && <p class="faint small" style="margin:0 0 10px">{ways[0] === 'hr' ? 'This ride works by heart rate only.' : 'This ride works by power only.'}</p>}
          {ride && hasTwoVersions(w) && <div class="send-row" style="margin-bottom:10px"><span class="small muted">Version</span>
            <div class="seg" role="group" aria-label="Version">{(['outdoor', 'trainer'] as Where[]).map((x) => <button key={x} class={where === x ? 'on' : ''} aria-pressed={where === x} onClick={() => setWhere(x)}>{x === 'outdoor' ? 'Outdoor' : 'As written'}</button>)}</div></div>}
          {basis === 'breath' && <p class="faint small" style="margin:-4px 0 10px">By breathing: power targets from the watts your breathing zones match, as Send uses.</p>}
          <Formats offers={offers} value={format as WorkoutFormat} set={setFormat} label={WORKOUT_FORMAT_LABEL} what={WORKOUT_FORMAT_WHAT} />
          {format === 'erg' && <p class="faint small" style="margin:8px 0 0">Watts from your FTP today, {profile.ftp} W.</p>}
        </>
      )}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn" onClick={onClose}>Cancel</button>
        {can.ok && <button class="btn primary" disabled={!format} onClick={() => void go()}>Download</button>}
      </div>
    </Sheet>
  );
}

const HOW_LINE: Record<ActivityFileResult['how'], string> = {
  original: 'The original file, unchanged.',
  player: 'The file Antogo’s ride player made of this ride.',
  record: 'Written from the activity’s second-by-second record.',
  summary: 'Only a summary of this activity exists: no second-by-second recording was kept, so this is a short text summary, not a ride file.',
};

/** Download for a finished activity's page. */
export function DownloadActivity({ ride, data, onClose }: { ride: Ride; data: AppData; onClose: () => void }) {
  const [format, setFormat] = useState<ActivityFormat>('fit');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<ActivityFileResult | null>(null);
  const offers = activityOffers(ride, false);
  const [connected, setConnected] = useState(true);
  useEffect(() => { void credentials().then((c) => setConnected(!!c)).catch(() => {}); }, []);
  const make = async () => {
    setBusy(true);
    try {
      const recs = await db.recordings.toArray();
      const local = recs.find((x) => x.activityId === ride.id);
      const origin = originOf(ride, data.edits, data.planned, new Set(recs.map((x) => x.activityId).filter((x): x is string => !!x)));
      const got = await activityFile(await credentials(), ride, format, origin, local);
      if (got.unavailable) { toast({ ok: false, text: got.unavailable }); setBusy(false); return; }
      // A phone saves through its share sheet, which needs a fresh tap: the file is ready, then saved.
      if (sharesFiles()) { setReady(got); setBusy(false); return; }
      await save(got.file, got);
    } catch (e) { toast({ ok: false, text: `Could not get the file: ${(e as Error).message}` }); }
    setBusy(false);
  };
  const save = async (f: FileOut, got: ActivityFileResult) => {
    if (await deliver([f])) { toast({ ok: true, text: got.how === 'summary' ? 'Downloaded a summary: no recording exists for this activity.' : `Downloaded ${f.name}.` }); onClose(); }
  };
  return (
    <Sheet title={`Download ${ride.name}`} onClose={onClose}>
      {ready ? (
        <>
          <p class="small" style="margin:0 0 6px"><b>{ready.file.name}</b> is ready.</p>
          <p class="faint small" style="margin:0">{HOW_LINE[ready.how]}</p>
        </>
      ) : (
        <>
          <Formats offers={offers} value={format} set={setFormat} label={ACTIVITY_FORMAT_LABEL} what={ACTIVITY_FORMAT_WHAT} />
          {!connected && <p class="small" style="margin:10px 0 0;color:var(--warn)">This device isn't connected to your account, so unless the ride player recorded this ride here, you'll get a short summary, not a ride file. Connect in Settings first.</p>}
          <p class="faint small" style="margin:10px 0 0">The original file comes out unchanged when it is already in the format you pick; otherwise the file is written from the recording.</p>
        </>
      )}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn" onClick={onClose}>Cancel</button>
        {ready ? <button class="btn primary" onClick={() => void save(ready.file, ready)}>Save the file</button>
          : <button class="btn primary" disabled={busy} onClick={() => void make()}>{busy ? 'Getting it…' : 'Download'}</button>}
      </div>
    </Sheet>
  );
}
