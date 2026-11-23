import { useEffect, useState } from 'preact/hooks';
import { appBluetooth, type FoundDevice } from '../shell';

/**
 * The installed app's own list for choosing a Bluetooth device (23 Nov 2026). In a browser, the browser shows this
 * list; the app has to show its own. It opens when the player asks for a device, fills as devices are found, and
 * connects to nothing until one is picked. Cancel stops the search, and the player carries on as when a browser's
 * list is closed.
 */
export function BluetoothChooser() {
  const [found, setFound] = useState<FoundDevice[] | null>(null);
  useEffect(() => { appBluetooth.watch((list) => setFound(list)); }, []);
  useEffect(() => {
    if (!found) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') pick(''); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [found]);
  if (!found) return null;
  function pick(id: string) { setFound(null); void appBluetooth.choose(id); }
  // A device with no name of its own is still listed, so nothing found is hidden.
  const named = (d: FoundDevice) => (d.name && !/^Unknown or Unsupported Device/i.test(d.name) ? d.name : 'A device with no name');
  return (
    <div class="bt-back" onClick={() => pick('')}>
      <div class="bt-sheet panel" role="dialog" aria-modal="true" aria-label="Choose a device" onClick={(e) => e.stopPropagation()}>
        <h2 style="margin:0 0 4px">Choose a device</h2>
        <p class="small muted" style="margin:0 0 12px">Devices found nearby that the box you clicked can use. Wake yours if it isn't here: pedal a few strokes, or put the strap on.</p>
        {found.length > 0
          ? <ul class="bt-list">{found.map((d) => (
              <li key={d.id}><button class="bt-item" onClick={() => pick(d.id)}>{named(d)}</button></li>
            ))}</ul>
          : <p class="small" style="margin:0 0 4px">Nothing found yet.</p>}
        <p class="faint small" role="status" style="margin:10px 0 0">Still looking…</p>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onClick={() => pick('')}>Cancel</button></div>
      </div>
    </div>
  );
}
