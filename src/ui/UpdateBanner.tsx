import { useEffect, useState } from 'preact/hooks';
import { applyUpdate, onUpdateReady, updateReady } from './update';

/** "A new version is ready", with the button that switches to it. */
export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady());
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  if (!ready) return null;
  return (
    <div class="panel accent row between wrap" role="status" style="gap:10px;margin-bottom:14px;padding:10px 14px">
      <span class="small"><b>A new version of the app is ready.</b> <span class="muted">Reload to use it before you sync.</span></span>
      <button class="btn primary sm" onClick={applyUpdate}>Reload</button>
    </div>
  );
}
