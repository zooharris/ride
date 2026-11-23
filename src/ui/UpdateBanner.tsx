import { useEffect, useState } from 'preact/hooks';
import { applyUpdate, onUpdateReady, updateReady } from './update';
import { inApp } from '../shell';
import { APP_SHORT_NAME } from '../appName';

/** "A new version is ready", with the button that switches to it. */
export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady());
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  // The installed app never changes by itself: a newer version is a new file, downloaded in the rider's browser.
  if (inApp()) return (
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
