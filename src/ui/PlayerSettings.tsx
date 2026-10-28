import { useEffect, useState } from 'preact/hooks';
import { getSetting, setSetting } from '../data/db';
import { forget, removeSimulated, savedDevices, SIM_KEY, type SavedDevice } from '../player/hub';
import { KIND_WORD } from '../player/sources';
import { bluetoothAvailable } from '../player/ble/web';

/**
 * Settings → Ride player: the trainer and sensors this computer remembers, and
 * practice mode. Both belong to this computer only and save at once.
 */
export function PlayerSettings() {
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [sim, setSim] = useState(false);
  const load = () => { savedDevices().then(setDevices); getSetting<boolean>(SIM_KEY, false).then(setSim); };
  useEffect(load, []);

  const setPractice = async (on: boolean) => {
    await setSetting(SIM_KEY, on);
    if (!on) removeSimulated();
    setSim(on);
  };
  const drop = async (d: SavedDevice) => {
    if (!confirm(`Forget ${d.name} on this computer?\n\nIt disconnects now. To use it again, add it again on the ride screen.`)) return;
    await forget(d.id);
    load();
  };

  return (
    <section class="section">
      <h2>Ride player</h2>
      <p class="muted small" style="margin-bottom:12px">Riding a workout indoors with a smart trainer, from <b>Ride indoors on the trainer</b> on Today or on a ride's page. It needs Chrome or Edge on a computer{bluetoothAvailable() ? '' : ' (this browser can’t reach Bluetooth)'}. Everything here belongs to this computer only.</p>
      <div class="panel">
        <b class="small">Your trainer and sensors on this computer</b>
        {devices.length ? (
          <div class="stack" style="gap:0;margin-top:6px">
            {devices.map((d) => (
              <div key={d.id} class="row between" style="padding:8px 0;border-top:1px solid var(--line)">
                <span class="small"><b>{d.name}</b> <span class="faint">· {KIND_WORD[d.kind]}</span></span>
                <button class="btn sm quiet" onClick={() => void drop(d)}>Forget</button>
              </div>
            ))}
          </div>
        ) : <p class="faint small" style="margin:6px 0 0">None yet. Add them on the ride screen; they're remembered here for the next ride.</p>}
      </div>
      <div class="field" style="margin-top:14px"><label>Practice with a simulated trainer</label>
        <div class="seg"><button class={sim ? 'on' : ''} aria-pressed={sim} onClick={() => void setPractice(true)}>On</button><button class={!sim ? 'on' : ''} aria-pressed={!sim} onClick={() => void setPractice(false)}>Off</button></div>
        <p class="faint small" style="margin-top:6px">On: the ride screen's Add a device also offers a simulated trainer, power meter and heart rate, so you can try the player without the bike. A simulated rider pedals for you.</p></div>
    </section>
  );
}
