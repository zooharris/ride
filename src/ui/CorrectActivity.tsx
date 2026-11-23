import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ActivityEdit, PlannedWorkout, Ride, SessionKind, Workout } from '../engine/types';
import type { StreamSet } from '../data/db';
import { db } from '../data/db';
import { clock } from '../engine/workout';
import { fixWords, validTrim, type Fix } from '../engine/corrections';
import { getThresholdCtx, thresholdsOf } from '../engine/thresholdCtx';
import { usedWords } from '../engine/thresholdHistory';
import { today } from '../engine/load';
import { renameActivity, saveActivityEffort, saveEffort, setActivityKind, setExcluded, setFix, setFromRideOnward } from '../sync/records';
import { wholeRecordingOf } from '../sync/ownService';
import { sportOf } from '../sync/intervals';
import { APP_SHORT_NAME } from '../appName';
import { Effort } from './DoneRecord';
import { fmtDate } from './derived';
import { notify } from './store';
import type { AppData } from './store';
import { toast } from './Toast';

/**
 * Correct this activity (22 Nov 2026, Part C): everything a rider can change about one activity, under one heading.
 * The recording itself is never changed. Each correction is listed, can be undone on its own, and stays with the
 * activity through a sync, a restore and a move to another device. Nothing here is typed over a number that follows
 * from the recording (normalized power, load, time in zones): those are put right by correcting what they are
 * measured against.
 */

const KIND_CHOICES: Array<[SessionKind, string]> = [['ride', 'Ride'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['walk', 'Walk'], ['run', 'Run'], ['other', 'Other (swim, row, anything else)']];
const KIND_WORD: Record<SessionKind, string> = { ride: 'ride', strength: 'strength', mobility: 'mobility', walk: 'walk', run: 'run', other: 'other' };

/** When an activity started, as a rider would say it. */
export function whenWords(iso: string): string {
  const t = iso.slice(11, 16);
  return `${fmtDate(iso.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${t}`;
}

/** h:mm:ss or m:ss (or plain seconds) to seconds; undefined when it isn't a time. */
export function parseClock(text: string): number | undefined {
  const parts = text.trim().split(':').map((x) => x.trim());
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return undefined;
  return parts.reduce((a, x) => a * 60 + Number(x), 0);
}

/** The corrections in force, at the top of the activity's page: each said in a few words, each with its own Undo. */
export function CorrectionsInForce({ ride, edit }: { ride: Ride; edit?: ActivityEdit }) {
  const [busy, setBusy] = useState(false);
  const list = fixWords(edit, { clock, when: whenWords });
  if (!list.length) return null;
  const undo = async (key: keyof Fix, text: string) => {
    setBusy(true);
    try { await setFix(ride, { [key]: undefined }); notify(); toast({ ok: true, text: `Undone: ${text.toLowerCase()}. The activity is as it was.` }); }
    catch (e) { toast({ ok: false, text: `Not undone: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  return (
    <div class="panel fixes-on" style="margin-top:14px">
      <b class="small">Corrected by you</b> <span class="faint small">· the recording itself is unchanged</span>
      <div class="stack" style="gap:4px;margin-top:6px">
        {list.map((f) => (
          <div class="row wrap small" key={f.key} style="gap:4px 10px;justify-content:space-between;align-items:center">
            <span>{f.text}</span>
            <button class="btn quiet sm" disabled={busy} aria-label={f.key === 'trim' ? 'Restore the whole recording' : `Undo: ${f.text}`} onClick={() => void undo(f.key, f.text)}>{f.key === 'trim' ? 'Restore the whole recording' : 'Undo'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Item({ title, state, children, cls }: { title: string; state?: ComponentChildren; children: ComponentChildren; cls: string }) {
  return (
    <details class={`fix ${cls}`}>
      <summary><b style="font-weight:600">{title}</b>{state != null && <span class="faint small"> · {state}</span>}</summary>
      <div class="fix-body">{children}</div>
    </details>
  );
}

export function CorrectActivity({ ride: r, data, planned, workout, onDifferent, onUndoLogged, matchByHand }: {
  ride: Ride; data: AppData; planned?: PlannedWorkout; workout?: Workout;
  onDifferent?: () => void; onUndoLogged?: () => void; matchByHand?: ComponentChildren;
}) {
  const profile = data.profile!;
  const edit = data.edits.find((e) => e.id === r.id);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(r.name);
  useEffect(() => setName(r.name), [r.name]);
  const run = async (what: () => Promise<unknown>, ok: string, undo?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const said = await what(); notify();
      toast({ ok: true, text: typeof said === 'string' ? said : ok, action: undo ? { label: 'Undo', run: async () => { try { await undo(); notify(); toast({ ok: true, text: 'Undone.' }); } catch (e) { toast({ ok: false, text: `Not undone: ${(e as Error).message}` }); } } } : undefined });
    } catch (e) { toast({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const isRide = r.sport === 'ride';
  const onFoot = r.sport === 'walk' || r.sport === 'run';
  const hadPower = !!(r.normalizedPower || r.averagePower || r.setAside?.power?.normalizedPower || r.setAside?.power?.averagePower);
  const hadHr = !!(r.averageHr || r.setAside?.hr?.averageHr);
  const used = thresholdsOf(r, profile, getThresholdCtx());
  const t = today();
  const noun = isRide ? 'ride' : 'activity';
  const matched = !!planned;
  const excluded = !!edit?.excluded;
  const handLogged = !!planned && planned.manualActivityId === r.id;

  // C1 and C2: a figure for this activity only, or from its day onward.
  const [ftp, setFtp] = useState('');
  const [ftpScope, setFtpScope] = useState<'one' | 'onward'>('one');
  const [lthr, setLthr] = useState('');
  const [lthrScope, setLthrScope] = useState<'one' | 'onward'>('one');
  const saveThreshold = (what: 'ftp' | 'lthr') => {
    const v = Number(what === 'ftp' ? ftp : lthr), scope = what === 'ftp' ? ftpScope : lthrScope;
    const [lo, hi, unit, label] = what === 'ftp' ? [50, 600, 'W', 'FTP'] as const : [80, 220, 'bpm', 'Threshold heart rate'] as const;
    if (!(v >= lo && v <= hi)) { toast({ ok: false, text: `${label} is usually between ${lo} and ${hi}.` }); return; }
    if (scope === 'one') void run(() => setFix(r, { [what]: v }), `${label} for this ${noun} set to ${v} ${unit}. Its numbers are worked out again.`, () => setFix(r, { [what]: undefined }));
    else void run(async () => { await setFix(r, { [what]: undefined }); const res = await setFromRideOnward(r, what, v); return `${v} ${unit} from ${fmtDate(r.date)} onward is now an entry in your ${what === 'ftp' ? 'FTP' : 'threshold heart-rate'} history. ${res.rides} ${res.rides === 1 ? 'activity' : 'activities'} worked out again.`; }, 'Saved.');
    if (what === 'ftp') setFtp(''); else setLthr('');
  };
  const thresholdBody = (what: 'ftp' | 'lthr') => {
    const val = what === 'ftp' ? ftp : lthr, set = what === 'ftp' ? setFtp : setLthr, scope = what === 'ftp' ? ftpScope : lthrScope, setScope = what === 'ftp' ? setFtpScope : setLthrScope;
    const own = what === 'ftp' ? edit?.ftp : edit?.lthr;
    const unit = what === 'ftp' ? 'W' : 'bpm';
    return (
      <>
        <p class="faint small" style="margin:0 0 8px">{what === 'ftp' ? `Training load, intensity and time in power zones are measured against it. If the figure used for this ride is wrong, type the right one.` : `Heart-rate zones and heart-rate load are measured against it${onFoot ? ' (the one on foot, for a walk or run)' : ''}. If the figure used for this activity is wrong, type the right one.`}</p>
        <div class="row wrap" style="gap:8px;align-items:flex-end">
          <div class="field" style="width:130px"><label>{what === 'ftp' ? 'FTP (watts)' : 'Threshold (bpm)'}</label><input inputMode="numeric" value={val} placeholder={own ? String(own) : undefined} aria-label={what === 'ftp' ? 'FTP for this ride, in watts' : 'Threshold heart rate for this activity, in beats per minute'} onInput={(e) => set((e.target as HTMLInputElement).value.replace(/[^\d]/g, ''))} /></div>
          <div class="seg" role="radiogroup" aria-label="Applies to">
            <button role="radio" aria-checked={scope === 'one'} class={scope === 'one' ? 'on' : ''} onClick={() => setScope('one')}>This {noun} only</button>
            <button role="radio" aria-checked={scope === 'onward'} class={scope === 'onward' ? 'on' : ''} onClick={() => setScope('onward')}>From this {noun} onward</button>
          </div>
          <button class="btn sm primary" disabled={busy || !val} onClick={() => saveThreshold(what)}>Save</button>
        </div>
        <p class="faint small" style="margin:6px 0 0">{scope === 'one' ? `Only this ${noun} changes. It is labelled on this page and can be undone.` : `Adds an entry to your ${what === 'ftp' ? 'FTP' : 'threshold heart-rate'} history from ${fmtDate(r.date)}: every ${what === 'ftp' ? 'ride' : 'activity'} from then until the next entry is worked out again. You can change or remove the entry in Settings.`}</p>
        {own && <button class="btn quiet sm" style="margin-top:8px" disabled={busy} onClick={() => void run(() => setFix(r, { [what]: undefined }), `Back to what your ${what === 'ftp' ? 'FTP setting' : 'history'} gives for that day.`)}>Undo: {own} {unit} set for this {noun}</button>}
      </>
    );
  };

  // C4: when it started.
  const [start, setStart] = useState((edit?.start ?? r.startTime).slice(0, 16));
  useEffect(() => setStart((edit?.start ?? r.startTime).slice(0, 16)), [edit?.start, r.startTime]);
  const saveStart = () => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || start.slice(0, 10) > t) { toast({ ok: false, text: 'Choose a day and time, not in the future.' }); return; }
    void run(() => setFix(r, { start: `${start}:00` }), `Start moved to ${whenWords(start)}. It is on that day on the Calendar and in the week's totals.`, () => setFix(r, { start: undefined }));
  };

  return (
    <section class="section correct">
      <h2>Correct this activity</h2>
      <p class="faint small" style="margin:4px 0 10px">The recording itself is never changed. Each correction is labelled on this page, can be undone on its own, and stays with the activity through a sync, a restore and a move to another device. Corrections stay in {APP_SHORT_NAME}: they are not sent to Intervals.icu, whose own pages keep showing the activity as recorded.</p>
      <div class="panel stack" style="gap:0">
        {isRide && hadPower && <Item cls="fix-ftp" title="FTP used for this ride" state={used.ftp ? usedWords(used.ftp, 'W', t, APP_SHORT_NAME) : 'none'}>{thresholdBody('ftp')}</Item>}
        {hadHr && <Item cls="fix-lthr" title="Threshold heart rate used for this activity" state={used.lthr ? usedWords(used.lthr, 'bpm', t, APP_SHORT_NAME) : 'none'}>{thresholdBody('lthr')}</Item>}
        {(hadPower || hadHr) && (
          <Item cls="fix-leave" title="Leave out the power, or the heart rate" state={[edit?.noPower ? 'power left out' : '', edit?.noHr ? 'heart rate left out' : ''].filter(Boolean).join(', ') || 'both are used'}>
            {isRide && hadPower && (
              <label class="row" style="gap:10px;align-items:flex-start;cursor:pointer">
                <input type="checkbox" style="width:18px;height:18px;margin-top:2px;accent-color:var(--accent)" checked={!!edit?.noPower} disabled={busy} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; void run(() => setFix(r, { noPower: v || undefined }), v ? `Power left out. The ride is scored from ${hadHr && !edit?.noHr ? 'heart rate' : 'its time alone'}.` : 'Power counted again.', () => setFix(r, { noPower: v ? undefined : true })); }} />
                <span><b style="font-weight:600">Leave out the power</b><br /><span class="faint small">For a power meter that read wrong. The ride is scored from heart rate, its power numbers are hidden, and it is kept out of your power curve and records.</span></span>
              </label>
            )}
            {hadHr && (
              <label class="row" style="gap:10px;align-items:flex-start;cursor:pointer;margin-top:10px">
                <input type="checkbox" style="width:18px;height:18px;margin-top:2px;accent-color:var(--accent)" checked={!!edit?.noHr} disabled={busy} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; void run(() => setFix(r, { noHr: v || undefined }), v ? 'Heart rate left out.' : 'Heart rate counted again.', () => setFix(r, { noHr: v ? undefined : true })); }} />
                <span><b style="font-weight:600">Leave out the heart rate</b><br /><span class="faint small">For a strap that glitched. {isRide ? 'The ride is scored from its power (from its time alone if it has none), its' : 'The activity is scored from its time alone, its'} heart-rate numbers are hidden, and it is kept out of your heart-rate records.</span></span>
              </label>
            )}
          </Item>
        )}
        <Item cls="fix-start" title="When it started" state={<>{whenWords(edit?.start ?? r.startTime)}{edit?.start ? ' (moved by you)' : ''}</>}>
          <p class="faint small" style="margin:0 0 8px">For a file that named no time zone and landed on the wrong day or hour. The activity moves on the Calendar and in the week's totals.</p>
          <div class="row wrap" style="gap:8px;align-items:flex-end">
            <div class="field"><label>Date and time it started</label><input type="datetime-local" value={start} max={`${t}T23:59`} aria-label="Date and time the activity started" onInput={(e) => setStart((e.target as HTMLInputElement).value)} /></div>
            <button class="btn sm primary" disabled={busy || start === (edit?.start ?? r.startTime).slice(0, 16)} onClick={saveStart}>Save</button>
            {edit?.start && <button class="btn quiet sm" disabled={busy} onClick={() => void run(() => setFix(r, { start: undefined }), 'Back to the start as recorded.')}>Undo: back to {whenWords(r.setAside?.start?.startTime ?? r.startTime)}</button>}
          </div>
        </Item>
        <Item cls="fix-trim" title="Trim the start or the end" state={edit?.trim ? `kept ${clock(Math.round(edit.trim.from))} to ${clock(Math.round(edit.trim.to))}` : 'the whole recording is used'}>
          <TrimEditor ride={r} edit={edit} busy={busy} run={run} />
        </Item>

        <div class="fix-plain">
          <div class="row wrap" style="gap:8px;align-items:flex-end">
            <div class="field" style="flex:1;min-width:200px"><label>Name</label><input value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
            <button class="btn" disabled={busy || !name.trim() || name.trim() === r.name} onClick={() => run(() => renameActivity(r, name), 'Renamed.')}>Rename</button>
            {name !== r.name && <button class="btn quiet" disabled={busy} onClick={() => setName(r.name)}>Cancel</button>}
          </div>
        </div>
        {!matched && (
          <div class="fix-plain field">
            <label>What it was</label>
            <select value={edit?.kind ?? ''} disabled={busy} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as SessionKind | ''; const was = edit?.kind; void run(() => setActivityKind(r, v || undefined), v ? `Counted as ${KIND_CHOICES.find(([k]) => k === v)![1].toLowerCase()}.` : 'Back to what the device recorded.', async () => setActivityKind((await db.rides.get(r.id)) ?? r, was)); }}>
              <option value="">As recorded ({KIND_WORD[sportOf(r.type, r.averageSpeedMs)]})</option>
              {KIND_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span class="faint small">Correct it when the device filed it wrongly (a treadmill walk as a run, say). The training load is worked out again for that kind, and the type in Intervals.icu is corrected too.</span>
          </div>
        )}
        {(r.sport === 'strength' || r.sport === 'mobility' || r.sport === 'walk') && (!planned || (workout && workout.kind !== 'ride')) && (
          <div class="fix-plain">
            <Effort rpe={planned ? planned.rpe : edit?.rpe} kind={r.sport as 'strength' | 'mobility' | 'walk'} onEffort={async (n) => { if (planned && workout) await saveEffort(planned, workout, n, planned.done); else await saveActivityEffort(r, n); notify(); }} />
          </div>
        )}
        <div class="fix-plain">
          <label class="row" style="gap:10px;align-items:flex-start;cursor:pointer">
            <input type="checkbox" style="width:18px;height:18px;margin-top:2px;accent-color:var(--accent)" checked={excluded} disabled={busy} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; void run(() => setExcluded(r, v), v ? 'Left out of training load.' : 'Counted toward training load again.', () => setExcluded(r, !v)); }} />
            <span><b style="font-weight:600">Leave out of training load</b><br /><span class="faint small">{excluded ? `Counts 0 toward fitness, fatigue and your week (it would be ${r.uncountedTss ?? 0} TSS). It stays in your history.` : 'For something that happened but should not count, like carrying the bike or a walk to the shop. It stays in your history and counts 0 toward fitness, fatigue and your week.'}</span></span>
          </label>
        </div>
        <div class="fix-plain fix-match">
          <b style="font-weight:600">Planned session</b>
          {planned && workout ? (
            <div class="row wrap" style="gap:8px 12px;align-items:center;margin-top:4px">
              <span class="small muted" style="flex:1;min-width:200px">Matched to {workout.name}{planned.plannedFor ? `, planned for ${fmtDate(planned.plannedFor)}` : ''}.</span>
              {handLogged
                ? <button class="btn sm" disabled={busy} onClick={onUndoLogged}>Undo: not done yet</button>
                : <button class="btn sm" disabled={busy} onClick={onDifferent} title="This recording was something else; put the planned session back to to-do">This was a different workout</button>}
            </div>
          ) : matchByHand ?? <p class="faint small" style="margin:4px 0 0">Not matched to a planned session, and none within a week either side is waiting to be done.</p>}
        </div>
      </div>
      <p class="faint small" style="margin-top:8px">Normalized power, intensity, training load, time in zones, work and drift can't be typed over, on purpose: they follow from the recording and from what is set here. An activity whose load is wrong is put right by correcting what it is measured against, or by leaving it out of training load.</p>
    </section>
  );
}

/**
 * C5: the part of the recording to keep. The two ends are dragged on a small chart of the whole recording, or typed.
 * The whole recording is always kept; Restore the whole recording undoes the trim.
 */
function TrimEditor({ ride: r, edit, busy, run }: { ride: Ride; edit?: ActivityEdit; busy: boolean; run: (what: () => Promise<unknown>, ok: string, undo?: () => Promise<unknown>) => Promise<void> }) {
  const [whole, setWhole] = useState<StreamSet | null | undefined>(undefined);
  useEffect(() => { let alive = true; void wholeRecordingOf(r.id).then((s) => { if (alive) setWhole(s && s.time.length > 2 ? s : null); }).catch(() => { if (alive) setWhole(null); }); return () => { alive = false; }; }, [r.id]);
  const span = whole ? Math.round(whole.time[whole.time.length - 1]) : 0;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [fromText, setFromText] = useState('0:00');
  const [toText, setToText] = useState('0:00');
  const set = (a: number, b: number) => { setFrom(a); setTo(b); setFromText(clock(a)); setToText(clock(b)); };
  useEffect(() => { if (whole) set(Math.round(edit?.trim?.from ?? 0), Math.round(Math.min(span, edit?.trim?.to ?? span))); }, [whole, edit?.trim?.from, edit?.trim?.to]);
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<'from' | 'to' | null>(null);
  const W = 600, H = 96;
  const shape = useMemo(() => {
    if (!whole) return null;
    const series = (['watts', 'heartrate', 'velocity', 'altitude'] as const).map((k) => [k, whole[k]] as const).find(([, v]) => v?.some((x) => x != null && isFinite(x) && x > 0));
    if (!series) return { path: '', what: '' };
    const [key, v] = series;
    const N = 240, lo: number[] = new Array(N).fill(NaN);
    for (let i = 0; i < whole.time.length; i++) { const x = v![i]; if (x == null || !isFinite(x)) continue; const b = Math.min(N - 1, Math.floor((whole.time[i] / Math.max(1, span)) * N)); lo[b] = isNaN(lo[b]) ? x : Math.max(lo[b], x); }
    const vals = lo.filter((x) => !isNaN(x));
    // Drawn between its own lowest and highest, so an even effort still shows its shape.
    const lowest = Math.min(...vals), highest = Math.max(...vals, lowest + 1);
    const min = lowest - (highest - lowest) * 0.6, max = highest + (highest - lowest) * 0.15;
    let path = '', pen = false;
    lo.forEach((x, i) => { if (isNaN(x)) { pen = false; return; } const px = 12 + (i / (N - 1)) * (W - 24), py = H - 6 - ((x - min) / (max - min)) * (H - 14); path += `${pen ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`; pen = true; });
    return { path, what: { watts: 'power', heartrate: 'heart rate', velocity: 'speed', altitude: 'elevation' }[key] };
  }, [whole]);
  if (whole === undefined) return <p class="faint small" style="margin:0">Reading the recording…</p>;
  if (whole === null) return <p class="faint small" style="margin:0">Trimming works from the activity's original file, and none is kept on this device for this one. Bring the file in with Add files on Activities (it joins this activity, not a second copy), then trim it here.</p>;
  // The recording runs between two margins, so a handle at either end is whole and easy to take hold of.
  const PAD = 12;
  const x = (s: number) => PAD + (s / Math.max(1, span)) * (W - 2 * PAD);
  const at = (e: PointerEvent) => { const b = box.current!.getBoundingClientRect(); const px = ((e.clientX - b.left) / b.width) * W; return Math.round(Math.max(0, Math.min(1, (px - PAD) / (W - 2 * PAD))) * span); };
  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    const s = at(e);
    if (drag.current === 'from') set(Math.min(s, to - 10), to); else set(from, Math.max(s, from + 10));
  };
  // A press anywhere on the chart takes hold of the nearer end and moves it there; the drag carries on from that.
  const grab = (e: PointerEvent) => {
    const s = at(e);
    drag.current = Math.abs(s - from) <= Math.abs(s - to) ? 'from' : 'to';
    try { box.current?.setPointerCapture(e.pointerId); } catch { /* the drag still works while the pointer stays over the chart */ }
    e.preventDefault();
    move(e);
  };
  const typed = (which: 'from' | 'to', text: string) => {
    if (which === 'from') setFromText(text); else setToText(text);
    const s = parseClock(text);
    if (s == null) return;
    if (which === 'from') setFrom(Math.max(0, Math.min(s, to - 10))); else setTo(Math.min(span, Math.max(s, from + 10)));
  };
  const key = (which: 'from' | 'to') => (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -(e.shiftKey ? 60 : 5) : e.key === 'ArrowRight' ? (e.shiftKey ? 60 : 5) : 0;
    if (!step) return;
    e.preventDefault();
    if (which === 'from') set(Math.max(0, Math.min(from + step, to - 10)), to); else set(from, Math.min(span, Math.max(to + step, from + 10)));
  };
  const ok = validTrim({ from, to }, span);
  const same = edit?.trim && Math.round(edit.trim.from) === from && Math.round(edit.trim.to) === to;
  return (
    <div class="trim">
      <p class="faint small" style="margin:0 0 8px">For a device left running in the car, or started early. Drag the two ends on the chart of the whole recording{shape?.what ? ` (${shape.what})` : ''}, or type the times. Everything is worked out again from the part kept: duration, distance, climbing, every number, laps, the map, the power curve and the load. The original recording is kept whole.</p>
      <svg ref={box} class="trim-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`The whole recording, ${clock(span)} long. The part kept runs from ${clock(from)} to ${clock(to)}.`} onPointerDown={grab} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <rect x="0" y="0" width={W} height={H} class="trim-bg" />
        {shape?.path && <path d={shape.path} class="trim-line" />}
        <rect x="0" y="0" width={x(from)} height={H} class="trim-out" />
        <rect x={x(to)} y="0" width={Math.max(0, W - x(to))} height={H} class="trim-out" />
        {(['from', 'to'] as const).map((which) => {
          const px = x(which === 'from' ? from : to);
          return (
            <g key={which} class="trim-handle" tabIndex={0} role="slider" aria-label={which === 'from' ? 'Start of the part kept' : 'End of the part kept'} aria-valuemin={0} aria-valuemax={span} aria-valuenow={which === 'from' ? from : to} aria-valuetext={clock(which === 'from' ? from : to)} onKeyDown={key(which)}>
              <rect x={px - 14} y="0" width="28" height={H} fill="transparent" />
              <line x1={px} x2={px} y1="0" y2={H} />
              <rect x={px - 4} y={H / 2 - 14} width="8" height="28" rx="3" class="trim-grip" />
            </g>
          );
        })}
      </svg>
      <div class="row wrap" style="gap:8px;align-items:flex-end;margin-top:8px">
        <div class="field" style="width:120px"><label>Keep from</label><input value={fromText} inputMode="numeric" aria-label="Keep from this time into the recording" onInput={(e) => typed('from', (e.target as HTMLInputElement).value)} onBlur={() => setFromText(clock(from))} /></div>
        <div class="field" style="width:120px"><label>to</label><input value={toText} inputMode="numeric" aria-label="Keep to this time into the recording" onInput={(e) => typed('to', (e.target as HTMLInputElement).value)} onBlur={() => setToText(clock(to))} /></div>
        <button class="btn sm primary" disabled={busy || !ok || !!same} onClick={() => void run(() => setFix(r, { trim: { from, to } }), `Trimmed: ${clock(to - from)} of ${clock(span)} kept. Everything is worked out again from that part.`, () => setFix(r, { trim: edit?.trim }))}>Trim to this part</button>
        {edit?.trim && <button class="btn sm" disabled={busy} onClick={() => void run(() => setFix(r, { trim: undefined }), 'The whole recording is used again.')}>Restore the whole recording</button>}
      </div>
      <p class="faint small" style="margin:6px 0 0">Keeps <b class="num">{clock(Math.max(0, to - from))}</b> of {clock(span)}{from > 0 ? `, leaving out the first ${clock(from)}` : ''}{to < span ? `${from > 0 ? ' and' : ', leaving out'} the last ${clock(span - to)}` : ''}. Times are from the start of the recording, stops included.{!ok && !same ? ' Move an end to trim.' : ''}</p>
    </div>
  );
}
