import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting } from '../data/db';
import { chooseDevices, DEVICE_CHOICE, DEVICES_ASK, onDeviceSync, type DeviceChoice, type DeviceSyncState } from '../data/devicesync';
import type { IntervalsCredentials } from '../sync/intervals';
import { APP_SHORT_NAME } from '../appName';
import { thisDevice } from '../shell';
import { notify, subscribe } from './store';

/**
 * Asked at once (25 Nov 2026): a backup file has just been restored on this device, and Antogo has found its saved
 * copy from the rider's other devices. The rider is not left to find the choice in Settings. Nothing is combined
 * until they answer; "Decide later" leaves the notice on Today and the choice in Settings.
 */
export function DevicesQuestion() {
  const [waiting, setWaiting] = useState<DeviceSyncState['waiting'] | null>(null);
  const [busy, setBusy] = useState(false);
  const look = async () => {
    const [ask, choice, st] = await Promise.all([getSetting<boolean>(DEVICES_ASK, false), getSetting<string | null>(DEVICE_CHOICE, null), getSetting<DeviceSyncState | null>('deviceSync', null)]);
    setWaiting(ask && !choice && st?.waiting ? st.waiting : null);
  };
  useEffect(() => { void look(); const a = onDeviceSync(() => void look()); const b = subscribe(() => void look()); return () => { a(); b(); }; }, []);
  if (!waiting) return null;
  const Device = thisDevice().replace(/^t/, 'T');
  async function answer(choice: DeviceChoice | null) {
    setBusy(true);
    try {
      await setSetting(DEVICES_ASK, false);
      if (choice) await chooseDevices(choice, await getSetting<IntervalsCredentials | null>('intervals', null));
      notify();
    } finally { setBusy(false); setWaiting(null); }
  }
  return (
    <div class="bt-back">
      <div class="bt-sheet panel" role="dialog" aria-modal="true" aria-label="Your other devices" style="max-width:560px">
        <h2 style="margin:0 0 6px">Your other devices</h2>
        <p class="small" style="margin:0 0 10px">You restored a backup on {thisDevice()}. <b>{APP_SHORT_NAME} has also found its saved copy from your other devices</b> in your Intervals.icu account, last saved {new Date(waiting.savedAt).toLocaleString()}{waiting.device ? ` by ${waiting.device}` : ''}. Nothing has been combined.</p>
        <div class="stack" style="gap:14px">
          <div>
            <button class="btn primary" onClick={() => answer('sync')} disabled={busy}>Keep this device in step with my others</button>
            <p class="muted small" style="margin:6px 0 0">What you restored and the saved copy are combined. Where both hold the same thing, the newer version is kept, whichever it came from, so nothing on your other devices is put back to an older state. What you have deleted on them since the backup stays deleted. From then on, a change on any device reaches the others.</p>
          </div>
          <div>
            <button class="btn" onClick={() => answer('separate')} disabled={busy}>Keep this device separate</button>
            <p class="muted small" style="margin:6px 0 0">{Device} keeps what you restored and never reads or changes the saved copy. Your other devices carry on without it.</p>
          </div>
          <div>
            <button class="btn quiet" onClick={() => answer(null)} disabled={busy}>Decide later</button>
            <p class="faint small" style="margin:6px 0 0">Nothing is combined meanwhile. The choice stays in Settings, under Across your devices, and backup.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
