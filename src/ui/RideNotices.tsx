import { useEffect, useState } from 'preact/hooks';
import { deleteRecording, sendWaitingRides, unfinishedRides, waitingRides } from '../player/rides';
import type { Recording } from '../player/types';
import { currentRide, subscribeRide } from './rideController';
import { clock } from '../engine/workout';
import { notify } from './store';
import { toast } from './Toast';

/**
 * On Today: a ride the browser closed in the middle of (save it or discard
 * it), and rides recorded on this computer that are waiting to reach
 * Intervals.icu (try now). Nothing shows when there is nothing to say.
 */
export function RideNotices() {
  const [open, setOpen] = useState<Recording[]>([]);
  const [waiting, setWaiting] = useState<Recording[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => {
    const live = currentRide()?.rec.id;
    unfinishedRides(live).then(setOpen).catch(() => {});
    waitingRides().then(setWaiting).catch(() => {});
  };
  useEffect(() => { load(); return subscribeRide(load); }, []);

  const tryNow = async () => {
    setBusy(true);
    const r = await sendWaitingRides();
    setBusy(false);
    toast({ ok: !r.left, text: r.left ? `${r.left} ride${r.left === 1 ? '' : 's'} still waiting: ${(await waitingRides())[0]?.error ?? 'try again later.'}` : `Saved ${r.sent} ride${r.sent === 1 ? '' : 's'} to Intervals.icu.` });
    load();
    notify();
  };
  const discard = async (r: Recording) => {
    if (!confirm(`Discard ${r.name}?\n\nThe part you rode won't be saved anywhere.`)) return;
    await deleteRecording(r.id);
    load();
  };
  if (!open.length && !waiting.length) return null;
  return (
    <div class="stack" style="gap:10px;margin-bottom:16px">
      {open.map((r) => (
        <div key={r.id} class="panel ride-notice">
          <div style="min-width:0">
            <b>You were recording {r.name}</b>
            <div class="muted small">Started {new Date(r.startMs).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {clock(r.samples.length)} recorded before the browser closed.</div>
          </div>
          <div class="row" style="gap:8px">
            <a class="btn primary sm" href={`#/play/recovered/${r.id}`}>Save it</a>
            <button class="btn sm danger" onClick={() => void discard(r)}>Discard…</button>
          </div>
        </div>
      ))}
      {waiting.length > 0 && (
        <div class="panel ride-notice">
          <div style="min-width:0">
            <b>{waiting.length === 1 ? `${waiting[0].name} is` : `${waiting.length} rides are`} waiting to upload</b>
            <div class="muted small">{waiting[0].error ?? 'Recorded on this computer and not yet in Intervals.icu.'}</div>
          </div>
          <button class="btn sm" disabled={busy} onClick={() => void tryNow()}>{busy ? 'Saving…' : 'Try now'}</button>
        </div>
      )}
    </div>
  );
}
