import { useEffect, useState } from 'preact/hooks';
import type { PlannedWorkout } from '../engine/types';
import { credentials } from '../sync/syncService';
import { destinationWords, fetchDestinations, fetchPushErrors, lastUploadWords, pushErrorWords, type Destinations, type PushError } from '../sync/destinations';
import { fmtDate } from './derived';

/**
 * Sending, said honestly (13 Nov 2026). Send puts a workout on the rider's Intervals.icu calendar; Intervals.icu
 * passes it to the makers connected there with uploads on. These pieces say which, before and after sending.
 */

export const SEND_LABEL = 'Send to my devices';
export const SEND_GENERAL = 'Goes to your Intervals.icu calendar, which passes it to the devices you\'ve connected there.';

export type DestState = { kind: 'none' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; d: Destinations };

/** Who receives a sent workout, read when a Send is shown (kept five minutes). Never blocks sending: an error is just "unknown". */
export function useDestinations(enabled = true, again = 0): DestState {
  const [s, setS] = useState<DestState>({ kind: 'loading' });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setS({ kind: 'loading' });
    void credentials().then((c) => {
      if (!c) { if (alive) setS({ kind: 'none' }); return; }
      return fetchDestinations(c, again > 0).then((d) => { if (alive) setS({ kind: 'ok', d }); });
    }).catch(() => { if (alive) setS({ kind: 'error' }); });
    return () => { alive = false; };
  }, [enabled, again]);
  return s;
}

/** The steps to have Intervals.icu upload workouts, in a few lines. */
export function UploadSteps() {
  return (
    <ol class="small muted dest-steps">
      <li>On <b>intervals.icu</b>, open <b>Settings</b>.</li>
      <li>Find your bike computer's or watch's maker (Garmin, Wahoo, Coros, Suunto, Zwift and others) and connect it, if it isn't already.</li>
      <li>Tick <b>Upload planned workouts</b> for it, and approve it if the maker asks.</li>
      <li>Come back here and send again. <a href="#/help?s=sending">How sending works</a></li>
    </ol>
  );
}

/** The line under a Send button: where it will go, or the general line when that can't be read. */
export function SendWhereLine({ state, date }: { state: DestState; date?: string }) {
  if (state.kind !== 'ok') return <span class="send-where faint small">{SEND_GENERAL}</span>;
  const w = destinationWords(state.d, date);
  return (
    <span class="send-where small">
      <span class={w.none ? '' : 'faint'}>{w.line}</span>
      {w.extra.map((x) => <span key={x} class="faint" style="display:block">{x}</span>)}
    </span>
  );
}

/**
 * In place of the Send button when nothing is set to receive workouts: what to change in Intervals.icu, and a quiet
 * way to put it on the calendar anyway.
 */
export function NothingReceives({ state, onAnyway, busy }: { state: DestState & { kind: 'ok' }; onAnyway: () => void; busy?: boolean }) {
  const w = destinationWords(state.d);
  return (
    <span class="dest-none">
      <b class="small">{w.line}</b>
      {w.extra.map((x) => <span key={x} class="small muted" style="display:block">{x}</span>)}
      <UploadSteps />
      <button class="btn sm quiet" disabled={busy} onClick={onAnyway}>{busy ? 'Sending…' : 'Put it on my Intervals.icu calendar anyway'}</button>
    </span>
  );
}

/** "Sent to Intervals.icu, Fri, Nov 13." */
export const sentWords = (entry: Pick<PlannedWorkout, 'sentOn'>): string => `Sent to Intervals.icu${entry.sentOn ? `, ${fmtDate(entry.sentOn)}` : ''}.`;

/**
 * After sending: what Intervals.icu reports for this workout, read when its page is opened (not in the background).
 * Any delivery error, in Intervals.icu's own words; the last upload time; and "Not on your device?".
 */
export function AfterSend({ entry }: { entry: PlannedWorkout }) {
  const [errors, setErrors] = useState<PushError[] | null>(null);
  const [open, setOpen] = useState(false);
  const dest = useDestinations(entry.status === 'sent');
  useEffect(() => {
    if (entry.status !== 'sent' || !entry.icuEventId) return;
    let alive = true;
    void credentials().then((c) => (c ? fetchPushErrors(c, entry.icuEventId!) : [])).then((e) => { if (alive) setErrors(e); }).catch(() => { if (alive) setErrors([]); });
    return () => { alive = false; };
  }, [entry.icuEventId, entry.status]);
  if (entry.status !== 'sent') return null;
  const last = dest.kind === 'ok' ? lastUploadWords(dest.d) : [];
  return (
    <div class="after-send">
      {(errors ?? []).map((x, i) => { const w = pushErrorWords(x); return <p key={i} class="msg err small" style="margin:6px 0 0"><b>{w.head}</b> {w.message}</p>; })}
      {last.map((x) => <p key={x} class="faint small" style="margin:4px 0 0">{x}</p>)}
      <button class="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>Not on your device?</button>
      {open && <NotOnDevice state={dest} date={entry.date} />}
    </div>
  );
}

/** The short list of what keeps a sent workout off a device, most likely first, with what was found for the first. */
export function NotOnDevice({ state, date }: { state: DestState; date: string }) {
  const found = state.kind === 'ok' ? destinationWords(state.d, date) : undefined;
  return (
    <ol class="small dest-check">
      <li><b>The maker isn't connected in Intervals.icu, or uploads to it are off.</b> {found ? (found.none ? found.line : `${found.line}${found.extra.filter((x) => /is off|are off/.test(x)).map((x) => ` ${x}`).join('')}`) : 'The app couldn\'t read your Intervals.icu settings just now.'}</li>
      <li><b>An upload filter.</b> {found?.extra.some((x) => /filter/.test(x)) ? found.extra.find((x) => /filter/.test(x)) : 'Intervals.icu can be set to upload only some workouts (indoor or outdoor, rides only). Check its settings for the maker.'}</li>
      <li><b>Too far ahead.</b> Intervals.icu uploads about a week ahead{date ? `; this one is on ${fmtDate(date)}` : ''}.</li>
      <li><b>The device hasn't synced with its maker's app yet.</b> Open the maker's app on your phone, or sync the device.</li>
    </ol>
  );
}
