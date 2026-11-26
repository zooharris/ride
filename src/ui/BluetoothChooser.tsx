import { useEffect, useState } from 'preact/hooks';
import { appBluetooth, appKind, thisDevice, type FoundDevice } from '../shell';
import { chooserBus, type BluetoothProblem } from '../player/ble/chooserBus';
import { APP_SHORT_NAME } from '../appName';

/**
 * The installed app's own list for choosing a Bluetooth device (23 Nov 2026). In a browser, the browser shows this
 * list; the app has to show its own. It opens when the player asks for a device, fills as devices are found, and
 * connects to nothing until one is picked. Cancel stops the search, and the player carries on as when a browser's
 * list is closed.
 */
export function BluetoothChooser() {
  const [found, setFound] = useState<FoundDevice[] | null>(null);
  // iPhone and iPad: why a search could not start, said in words with what to do.
  const [problem, setProblem] = useState<BluetoothProblem | null>(null);
  useEffect(() => { appBluetooth.watch((list) => setFound(list)); chooserBus.watchProblems(setProblem); }, []);
  useEffect(() => {
    if (!found) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') pick(''); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [found]);
  if (problem) return <BluetoothProblemSheet problem={problem} onClose={() => setProblem(null)} />;
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

/** Bluetooth can't be used right now (iPhone and iPad): what is wrong and how to put it right. */
function BluetoothProblemSheet({ problem, onClose }: { problem: BluetoothProblem; onClose: () => void }) {
  const ios = appKind() === 'ios';
  const [head, text] = problem === 'denied'
    ? [`${APP_SHORT_NAME} isn't allowed to use Bluetooth`, ios
      ? `To reach your trainer and sensors, ${APP_SHORT_NAME} needs your permission. Open the Settings app on ${thisDevice()}, find ${APP_SHORT_NAME} in the list of apps, turn Bluetooth on there, then come back and try again.`
      : `Allow ${APP_SHORT_NAME} to use Bluetooth in this device's settings, then try again.`]
    : problem === 'off'
      ? ['Bluetooth is turned off', `Turn Bluetooth on in the Settings app${ios ? ` on ${thisDevice()}` : ''} (not only in Control Centre, which pauses it rather than turning it on), then try again.`]
      : ['Bluetooth isn\'t available here', `${thisDevice().replace(/^t/, 'T')} has no Bluetooth that ${APP_SHORT_NAME} can use.`];
  return (
    <div class="bt-back" onClick={onClose}>
      <div class="bt-sheet panel" role="dialog" aria-modal="true" aria-label={head} onClick={(e) => e.stopPropagation()}>
        <h2 style="margin:0 0 6px">{head}</h2>
        <p class="small" style="margin:0 0 4px">{text}</p>
        <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" onClick={onClose}>OK</button></div>
      </div>
    </div>
  );
}
