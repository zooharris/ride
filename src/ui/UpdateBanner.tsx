import { useEffect, useState } from 'preact/hooks';
import { applyUpdate, onUpdateReady, updateReady } from './update';
import { appKind, appUpdate, inApp, MAC_DOWNLOAD, type MacUpdate } from '../shell';
import { fraction, updateWords } from './macUpdateWords';
import { APP_SHORT_NAME } from '../appName';

/** How the Mac app's own download stands, kept current. */
export function useMacUpdate(): MacUpdate {
  const [s, set] = useState<MacUpdate>(appUpdate.now());
  useEffect(() => appUpdate.watch(set), []);
  return s;
}

/**
 * The Mac app's newer version (26 Nov 2026): one press starts one download, by the app itself. The words and the
 * button change at once and say how far it has got; when the whole file has arrived and been checked, Open shows it.
 */
export function MacUpdateLine({ compact }: { compact?: boolean }) {
  const s = useMacUpdate();
  const w = updateWords(s, APP_SHORT_NAME);
  const f = fraction(s);
  const going = s.state === 'starting' || s.state === 'downloading' || s.state === 'checking';
  return (
    <>
      <span class="small mac-update-words" aria-live="polite">
        <b>{w.head}</b>{w.text && <> <span class="muted">{w.text}</span></>}
        {going && <span class={`mac-update-bar${f == null ? ' unknown' : ''}`} role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f == null ? undefined : Math.round(f * 100)}><i style={f == null ? undefined : `width:${(f * 100).toFixed(1)}%`} /></span>}
      </span>
      {s.state === 'idle' && <button class="btn primary sm" onClick={() => { void applyUpdate(); }}>{compact ? 'A newer version is ready: download' : 'Download'}</button>}
      {going && <button class="btn sm" disabled={s.state === 'checking'} onClick={() => { void appUpdate.cancel(); }}>Cancel</button>}
      {s.state === 'done' && <button class="btn primary sm" onClick={() => { void appUpdate.open(); }}>Quit and open the installer</button>}
      {s.state === 'failed' && <button class="btn primary sm" onClick={() => { void applyUpdate(); }}>Try again</button>}
      {/* Whatever stopped it, the old way still works: the same file, through the rider's browser. */}
      {s.state === 'failed' && <button class="btn sm" onClick={() => { window.open(MAC_DOWNLOAD, '_blank'); }}>Download in my browser</button>}
    </>
  );
}

/** "A new version is ready", with the button that switches to it. */
export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady());
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  const mac = useMacUpdate();
  if (appKind() === 'ios' || (!ready && mac.state === 'idle')) return null;
  // The installed app never changes by itself: a newer version is a new file, downloaded in the rider's browser.
  if (inApp()) return appUpdate.can() ? (
    <div class="panel accent row between wrap update-banner" role="status"><MacUpdateLine /></div>
  ) : (
    <div class="panel accent row between wrap update-banner" role="status">
      <span class="small"><b>A newer {APP_SHORT_NAME} for the Mac is ready.</b> <span class="muted">Download it, then replace this one in Applications. Your data stays.</span></span>
      <button class="btn primary sm" onClick={() => { void applyUpdate(); }}>Download</button>
    </div>
  );
  return (
    <div class="panel accent row between wrap update-banner" role="status">
      <span class="small"><b>A new version of the app is ready.</b> <span class="muted">Reload to use it before you sync.</span></span>
      <button class="btn primary sm" disabled={busy} onClick={() => { setBusy(true); void applyUpdate(); }}>{busy ? 'Updating…' : 'Reload'}</button>
    </div>
  );
}
