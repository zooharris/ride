import { useEffect, useRef, useState } from 'preact/hooks';
import { cancelImport, importFiles, UPLOAD_IMPORTS, watchImport, type ImportState } from '../import/importer';
import { getSetting, setSetting } from '../data/db';
import { credentials } from '../sync/syncService';
import { notify } from './store';
import { toast } from './Toast';

/**
 * Add activity files (Stage 1, 22 Nov 2026): bring in one file, many, a folder, or a device maker's whole-account
 * export. An activity already here is never added twice. The import carries on in the background if the sheet is
 * closed; opening it again shows where it has got.
 */
export function AddFilesButton({ label = 'Add activity files', primary = false }: { label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class={`btn sm${primary ? ' primary' : ''}`} onClick={() => setOpen(true)}>{label}</button>
      {open && <AddFilesSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function AddFilesSheet({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<ImportState>({ running: false, done: 0, total: 0 });
  const [connected, setConnected] = useState(false);
  const [upload, setUpload] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  useEffect(() => watchImport(setSt), []);
  useEffect(() => {
    void credentials().then((c) => setConnected(!!c)).catch(() => {});
    void getSetting<boolean>(UPLOAD_IMPORTS, false).then(setUpload);
  }, []);
  const go = async (list: FileList | null) => {
    if (!list?.length) return;
    try { await importFiles([...list], notify); }
    catch (e) { toast({ ok: false, text: `Stopped: ${(e as Error).message} What arrived is kept.` }); }
  };
  const r = st.result;
  return (
    <div class="modal-bg" onClick={onClose}>
      <div class="modal" style="max-width:560px" role="dialog" aria-label="Add activity files" onClick={(e) => e.stopPropagation()}>
        <h2 style="margin:0 0 8px">Add activity files</h2>
        <p class="small muted" style="margin:0 0 10px">Bring in activities straight from their files: .fit (also zipped), .tcx or .gpx, from any device or app, one at a time or years at once. A whole-account export from your device's maker (Garmin's, for one) can be chosen as it came, as one .zip: its activities and its daily wellness (sleep, HRV, resting heart rate) come in together. An activity already here is never added twice; Antogo keeps the file with it and works out every number from it.</p>
        {!st.running && (
          <div class="row wrap" style="gap:8px">
            <button class="btn primary" onClick={() => files.current?.click()}>Choose files</button>
            <button class="btn" onClick={() => folder.current?.click()}>Choose a folder</button>
            <input ref={files} type="file" multiple accept=".fit,.gz,.zip,.tcx,.gpx,.json,application/zip,application/octet-stream" style="display:none" aria-label="Activity files" onChange={(e) => { void go((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
            <input ref={folder} type="file" multiple {...{ webkitdirectory: '' }} style="display:none" aria-label="A folder of activity files" onChange={(e) => { void go((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
          </div>
        )}
        {connected && !st.running && (
          <label class="row small" style="gap:8px;margin-top:12px;cursor:pointer;align-items:flex-start">
            <input type="checkbox" checked={upload} onChange={() => { const v = !upload; setUpload(v); void setSetting(UPLOAD_IMPORTS, v); }} />
            <span>Also add files I bring in to my Intervals.icu <span class="faint">(off unless you turn it on; they're in Antogo either way)</span></span>
          </label>
        )}
        {st.running && (
          <div style="margin-top:10px">
            <div class="ws-track"><div class="ws-fill" style={`width:${st.total ? (st.done / st.total) * 100 : 3}%`} /></div>
            <p class="faint small" style="margin:6px 0 8px">{st.total ? `Reading ${st.done} of ${st.total}…` : 'Opening the files…'} You can close this and keep using the app.</p>
            <button class="btn quiet sm" onClick={cancelImport}>Cancel</button>
          </div>
        )}
        {r && !st.running && (
          <div class="panel import-result" style="margin-top:12px" aria-live="polite">
            <p class="small" style="margin:0"><b>{r.added}</b> new {r.added === 1 ? 'activity' : 'activities'}{r.already ? `, ${r.already} already here (their files are now kept with them)` : ''}{r.wellnessDays ? `, ${r.wellnessDays} ${r.wellnessDays === 1 ? 'day' : 'days'} of wellness added or filled in` : ''}.</p>
            {r.unreadable.length > 0 && (
              <details style="margin-top:6px"><summary class="small">{r.unreadable.length} couldn't be read</summary>
                <ul class="faint small" style="margin:4px 0 0;padding-left:18px">{r.unreadable.slice(0, 50).map((u) => <li key={u.name}>{u.name}: {u.why}</li>)}</ul></details>
            )}
            {r.notRead.length > 0 && (
              <details style="margin-top:6px"><summary class="small">{r.notRead.length} other {r.notRead.length === 1 ? 'file' : 'files'} not used</summary>
                <p class="faint small" style="margin:4px 0">Files that aren't activities, or wellness files this app doesn't recognise. Nothing was guessed from them.</p>
                <ul class="faint small" style="margin:4px 0 0;padding-left:18px">{r.notRead.slice(0, 50).map((n) => <li key={n}>{n}</li>)}</ul></details>
            )}
          </div>
        )}
        {st.error && <p class="small" style="color:var(--bad);margin-top:10px">{st.error}</p>}
        <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn quiet" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
