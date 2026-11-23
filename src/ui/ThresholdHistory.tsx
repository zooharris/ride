import { useEffect, useRef, useState } from 'preact/hooks';
import { startChangeOver } from '../sync/syncService';
import { db } from '../data/db';
import { devicePeriods, ftpScoring, readHistory } from '../data/thresholds';
import { today } from '../engine/load';
import { FOOT_LTHR_HISTORY, FTP_HISTORY, LTHR_HISTORY, type HistoryKey } from '../engine/thresholdCtx';
import { entryOn, firstEntry, periodWords, sorted, sourceWords, suggestions, type FtpScoring, type Suggestion, type ThresholdEntry, type ThresholdHistory } from '../engine/thresholdHistory';
import { changeHistoryEntry, removeHistoryEntry, setFtpScoring, setHistoryEntry, useDevicePeriod } from '../sync/records';
import { watchChangeOver, type ChangeOverState } from '../sync/ownService';
import { APP_SHORT_NAME } from '../appName';
import { fmtDate } from './derived';
import { notify } from './store';
import { toast } from './Toast';

/**
 * Antogo's own history of a threshold, in Settings beside its number (22 Nov 2026): a dated list the rider can see and
 * correct, the past included. For FTP it also shows what the rider's device had set, as suggestions, and holds the
 * one setting: score rides with Antogo's history, or with the device's FTP of the day.
 */
const KINDS = {
  ftp: { key: FTP_HISTORY as HistoryKey, title: 'Your FTP history', unit: 'W', what: 'FTP', lo: 50, hi: 600, scores: 'Each ride is scored with the entry in force on its day.' },
  lthr: { key: LTHR_HISTORY as HistoryKey, title: 'Your threshold heart-rate history, on the bike', unit: 'bpm', what: 'threshold heart rate', lo: 80, hi: 220, scores: "Each ride's heart-rate zones and heart-rate load use the entry in force on its day. An activity older than the first entry uses the first." },
  footLthr: { key: FOOT_LTHR_HISTORY as HistoryKey, title: 'Your threshold heart-rate history, on foot', unit: 'bpm', what: 'threshold heart rate on foot', lo: 80, hi: 220, scores: 'Each walk and run uses the entry in force on its day. With no entries here, the bike\'s history is used, as the number above falls back to the bike\'s.' },
} as const;

const day = (d: string) => fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
const rides = (n: number) => `${n} ${n === 1 ? 'activity' : 'activities'}`;

/** What a change did, said once it is done: how many activities were worked out again, and the setting that followed. */
function done(what: string, r: { rides: number; now?: number }, unit: string) {
  toast({ ok: true, text: `${what} ${r.rides ? `${rides(r.rides)} worked out again.` : 'No activity is affected.'}${r.now ? ` Your ${unit === 'W' ? 'FTP' : 'threshold heart rate'} in Settings is now ${r.now} ${unit}, as the history says for today.` : ''}` });
}

export function ThresholdHistoryPanel({ kind, stamp, onChanged, open }: { kind: keyof typeof KINDS; /** Changes when the profile is saved elsewhere, so the list is read again. */ stamp?: string; onChanged?: () => void; /** Opened, and brought into view, when the rider came here for it. */ open?: boolean }) {
  const K = KINDS[kind];
  const [h, setH] = useState<ThresholdHistory | undefined | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [scoring, setScoring] = useState<FtpScoring>('antogo');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ from: today(), value: '' });
  const [work, setWork] = useState<ChangeOverState>({ running: false, done: 0, total: 0 });
  const [waiting, setWaiting] = useState(0);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (open && h !== null) box.current?.scrollIntoView({ block: 'start' }); }, [open, h === null]);
  const load = async () => {
    const cur = await readHistory(K.key);
    setH(cur);
    if (kind === 'ftp') setWaiting(await waitingCount());
    if (kind === 'ftp') { setSugg(suggestions(cur, await devicePeriods(), today())); setScoring(await ftpScoring()); }
  };
  useEffect(() => { void load(); }, [stamp]);
  useEffect(() => watchChangeOver((s) => { setWork(s); if (!s.running) void load(); }), []);
  if (h === null) return null;
  const list = sorted(h).reverse();
  const act = async (what: string, f: () => Promise<{ rides: number; now?: number }>) => {
    setBusy(true);
    try { const r = await f(); await load(); notify(); onChanged?.(); done(what, r, K.unit); }
    catch (e) { toast({ ok: false, text: `Not saved: ${(e as Error).message}` }); }
    finally { setBusy(false); setEditing(null); }
  };
  const check = (from: string, value: number): string | undefined => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > today() || from < '1990-01-01') return 'Choose a day, today or earlier.';
    if (!(value >= K.lo && value <= K.hi)) return `${K.what[0].toUpperCase()}${K.what.slice(1)} is usually between ${K.lo} and ${K.hi}.`;
    return undefined;
  };
  const save = (was: string | null) => {
    const v = Number(draft.value);
    const bad = check(draft.from, v);
    if (bad) { toast({ ok: false, text: bad }); return; }
    if (was == null && list.some((e) => e.from === draft.from) && !confirm(`There is already an entry from ${day(draft.from)}. Replace it?`)) return;
    void act(was == null ? `Added: ${v} ${K.unit} from ${day(draft.from)}.` : `Changed to ${v} ${K.unit} from ${day(draft.from)}.`, () => (was == null ? setHistoryEntry(K.key, draft.from, v) : changeHistoryEntry(K.key, was, draft.from, v)));
  };
  const remove = (e: ThresholdEntry) => {
    if (!confirm(`Remove the entry "${e.value} ${K.unit} from ${day(e.from)}"?\n\nActivities from that day on are then scored with the entry before it${list.length === 1 ? ' (there is none: your setting now is used)' : ''}. You can add it again.`)) return;
    void act('Removed.', () => removeHistoryEntry(K.key, e.from));
  };
  const use = (s: Suggestion) => {
    const inside = sorted(h).filter((e) => e.from > s.from && (!s.to || e.from <= s.to)).length;
    const open = !s.to ? `\n\nThis stretch has no end yet, so every entry of ${APP_SHORT_NAME}'s from ${day(s.from)} on is replaced, and your FTP in Settings becomes ${s.value} W.` : '';
    if (!confirm(`Use your device's ${s.value} W ${periodWords(s, day)}?\n\n${APP_SHORT_NAME}'s history takes ${s.value} W for that stretch${inside ? `, in place of the ${inside === 1 ? 'entry' : `${inside} entries`} inside it` : ''}, and carries on after it as it was.${open} The rides in it are worked out again.`)) return;
    void act(`${s.value} W used ${periodWords(s, day)}.`, () => useDevicePeriod(s));
  };
  const choose = async (v: FtpScoring) => {
    if (v === scoring) return;
    setBusy(true);
    try { const n = await setFtpScoring(v); setScoring(v); notify(); toast({ ok: true, text: `Rides are now scored with ${v === 'antogo' ? `${APP_SHORT_NAME}'s FTP history` : 'the FTP your device had set that day'}. ${n ? `${rides(n)} worked out again.` : 'No activity changed.'}` }); }
    finally { setBusy(false); }
  };
  const now = entryOn(h, today());
  const first = firstEntry(h);
  const row = (was: string | null) => (
    <div class="row wrap th-edit" style="gap:8px;align-items:flex-end">
      <div class="field" style="min-width:150px"><label>From</label><input type="date" max={today()} value={draft.from} aria-label="From this day" onInput={(e) => setDraft({ ...draft, from: (e.target as HTMLInputElement).value })} /></div>
      <div class="field" style="width:110px"><label>{K.unit === 'W' ? 'FTP (watts)' : 'bpm'}</label><input inputMode="numeric" value={draft.value} aria-label={K.unit === 'W' ? 'FTP in watts' : 'Threshold heart rate in beats per minute'} onInput={(e) => setDraft({ ...draft, value: (e.target as HTMLInputElement).value.replace(/[^\d]/g, '') })} /></div>
      <button class="btn sm primary" disabled={busy || !draft.value} onClick={() => save(was)}>{was == null ? 'Add entry' : 'Save'}</button>
      <button class="btn sm quiet" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
    </div>
  );
  return (
    <details ref={box} open={open || undefined} class={`th-history th-${kind}`} style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
      <summary><b class="small">{K.title}</b> <span class="faint small">{list.length ? `${list.length} ${list.length === 1 ? 'entry' : 'entries'}${now ? ` · ${now.value} ${K.unit} since ${day(now.from)}` : ''}` : 'no entries yet'}</span></summary>
      <p class="muted small" style="margin:8px 0 10px">"From this day, my {K.what} was this." {K.scores} {APP_SHORT_NAME} keeps this list itself; you can add, change or remove any entry, in the past too, and it travels to your other devices and into Back up everything.</p>
      {list.length === 0 && <p class="faint small" style="margin:0 0 8px">{kind === 'footLthr' ? 'No entries: the bike\'s history is used for walks and runs.' : `No entries yet: your ${K.what} isn't known. Setting it above, or a test, adds the first.`}</p>}
      <div class="th-list stack" style="gap:4px">
        {list.map((e) => editing === e.from ? <div key={e.from}>{row(e.from)}</div> : (
          <div class="th-row row wrap small" key={e.from} style="gap:4px 10px;align-items:center;justify-content:space-between">
            <span><b class="num">{e.value} {K.unit}</b> from {day(e.from)}{first && e.from === first.from && kind !== 'ftp' ? ' (and for anything older)' : ''} <span class="faint">· {sourceWords(e, APP_SHORT_NAME)}</span></span>
            <span class="row" style="gap:6px">
              <button class="btn quiet sm" disabled={busy} aria-label={`Change the entry from ${day(e.from)}`} onClick={() => { setDraft({ from: e.from, value: String(e.value) }); setEditing(e.from); }}>Change</button>
              <button class="btn quiet sm" disabled={busy} aria-label={`Remove the entry from ${day(e.from)}`} onClick={() => remove(e)}>Remove</button>
            </span>
          </div>
        ))}
      </div>
      {editing === '' ? <div style="margin-top:8px">{row(null)}</div> : <button class="btn sm" style="margin-top:8px" disabled={busy} onClick={() => { setDraft({ from: today(), value: '' }); setEditing(''); }}>Add an entry</button>}

      {kind === 'ftp' && sugg.length > 0 && (
        <div class="th-device" style="margin-top:14px">
          <p class="small" style="margin:0 0 4px"><b>What your device had set</b> <span class="faint">· suggestions, from your activities' own files</span></p>
          <div class="stack" style="gap:6px">
            {sugg.map((s) => (
              <div class="row wrap small" key={s.from} style="gap:4px 10px;align-items:center;justify-content:space-between">
                <span>Your device had <b class="num">{s.value} W</b> {periodWords(s, day)} <span class="faint">({s.rides} ride {s.rides === 1 ? 'file' : 'files'}). {APP_SHORT_NAME}'s history has {s.antogo.length ? s.antogo.map((v) => `${v} W`).join(', then ') : 'nothing'} for that stretch.</span></span>
                <button class="btn sm" disabled={busy} onClick={() => use(s)}>Use the device's for this period</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {kind === 'ftp' && (
        <div class="th-scoring" style="margin-top:14px">
          <p class="small" style="margin:0 0 6px"><b>Score my rides with</b></p>
          <div class="seg wrap" role="radiogroup" aria-label="Score my rides with">
            <button role="radio" aria-checked={scoring === 'antogo'} class={scoring === 'antogo' ? 'on' : ''} disabled={busy} onClick={() => void choose('antogo')}>{APP_SHORT_NAME}'s FTP history</button>
            <button role="radio" aria-checked={scoring === 'device'} class={scoring === 'device' ? 'on' : ''} disabled={busy} onClick={() => void choose('device')}>The FTP my device had set that day</button>
          </div>
          <p class="faint small" style="margin:6px 0 0">{scoring === 'antogo'
            ? <>Each ride uses the entry above in force on its day. A ride older than the first entry{first ? ` (${day(first.from)})` : ''} uses the FTP its own file says your device had set, and the first entry if its file has none.</>
            : <>A ride whose file carries the FTP your device had set that day uses that. A ride whose file has none uses the history above. Choose this only if you kept your device's FTP up to date.</>} Each ride's page lists the FTP it used; where it came from is under Correct this activity there.</p>
        </div>
      )}
      {kind === 'ftp' && waiting > 0 && !work.running && (
        <p class="small th-waiting" style="margin:10px 0 0">{rides(waiting)} brought in from files {waiting === 1 ? 'is' : 'are'} waiting to be scored. <button class="btn sm" disabled={busy} onClick={() => void act('Scored.', async () => ({ rides: await startChangeOver() }))}>Score them now</button></p>
      )}
      {(work.running && work.total > 0) ? <p class="faint small th-work" style="margin:10px 0 0" aria-live="polite">Working out the activities this affects: {work.done} of {work.total}.</p>
        : work.last ? <p class="faint small th-work" style="margin:10px 0 0">Last worked out again: {rides(work.last.changed)}, at {new Date(work.last.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Only activities a change affects are worked out again.</p> : null}
    </details>
  );
}

/** How many activities still wait to be worked out (brought in from files and not yet scored), for the line that says so. */
export async function waitingCount(): Promise<number> {
  return (await db.rides.filter((r) => r.source === 'file' && r.tss == null && !r.notTraining).count());
}
