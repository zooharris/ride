import { db, getSetting } from '../../data/db';
import { deviceStanding, type DeviceSyncState } from '../../data/devicesync';
import { ageWords } from '../../data/restoreWords';
import { testConnection, type IntervalsCredentials } from '../../sync/intervals';
import { appBluetoothStanding, appKey, appKind, inApp, thisDevice } from '../../shell';
import { bluetoothAvailable } from '../../player/ble/web';
import { platform } from '../../player/platform';
import { KEY_SETTING, PROVIDER_SETTING } from '../coachConfig';
import { APP_NAME, APP_SHORT_NAME } from '../../appName';
import { buildTime } from '../update';

/**
 * Check my setup (25 Nov 2026): each connection the rider has made, tried or read, with the result in words and
 * where to go when something is wrong. Nothing here costs money or changes anything: an AI key is not spent on a
 * test question (Settings has Test for that), and Bluetooth is read without asking for permission.
 */
export interface SetupLine {
  what: string;
  /** 'ok' works; 'note' is fine but worth knowing; 'bad' needs the rider; 'off' is not set up, which is allowed. */
  state: 'ok' | 'note' | 'bad' | 'off';
  words: string;
  /** A Help section that explains or fixes it. */
  help?: string;
  /** A screen where it is set. */
  go?: { label: string; href: string };
}

const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI (ChatGPT)', google: 'Google (Gemini)' };

export async function checkSetup(now = Date.now()): Promise<SetupLine[]> {
  const out: SetupLine[] = [];
  const Device = thisDevice().replace(/^t/, 'T');

  // 1. Where the data is, and whether the device will keep it.
  if (inApp()) {
    out.push({ what: 'Your data', state: 'ok', words: `Kept on ${thisDevice()}, inside the ${APP_SHORT_NAME} app. Deleting the app deletes it, so keep a backup file.`, help: 'guide-devices' });
  } else {
    const kept = await navigator.storage?.persisted?.().catch(() => false);
    out.push(kept
      ? { what: 'Your data', state: 'ok', words: 'Kept in this browser, which has agreed to keep it for good.' }
      : { what: 'Your data', state: 'note', words: 'Kept in this browser, which has not agreed to keep it for good: it may clear it if the device runs short of room or the site goes unused for some weeks. Install the app, or add it to your home screen, and keep a backup file.', help: 'guide-devices' });
  }

  // 2. Intervals.icu.
  const c = await getSetting<IntervalsCredentials | null>('intervals', null);
  if (!c?.apiKey) {
    out.push({ what: 'Intervals.icu', state: 'off', words: `Not connected. ${APP_SHORT_NAME} works without it; connected, it brings your history, sends sessions to your devices, and can keep your devices in step.`, go: { label: 'Settings', href: '#/settings' } });
  } else {
    try {
      const a = await testConnection(c);
      out.push({ what: 'Intervals.icu', state: 'ok', words: `Connected${a.name ? ` as ${a.name}` : ''}, and it answered just now.` });
    } catch (e) {
      out.push({ what: 'Intervals.icu', state: 'bad', words: `It did not answer as expected: ${(e as Error).message}`, help: 'fix-intervals', go: { label: 'Settings', href: '#/settings' } });
    }
    const sync = await db.sync.get('intervals');
    if (sync?.lastError && sync.lastErrorAt && (!sync.lastActivitySync || sync.lastErrorAt > sync.lastActivitySync)) {
      out.push({ what: 'The last sync', state: 'bad', words: `Failed ${ageWords(sync.lastErrorAt, now)}: ${sync.lastError}`, help: 'fix-intervals' });
    } else if (sync?.lastActivitySync) {
      out.push({ what: 'The last sync', state: 'ok', words: `Worked, ${new Date(sync.lastActivitySync).toLocaleString()}.` });
    }
  }

  // 3. This device and the rider's others.
  if (c?.apiKey) {
    const standing = await deviceStanding();
    const st = await getSetting<DeviceSyncState | null>('deviceSync', null);
    const failed = st?.error && (!st.last || st.error > st.last);
    out.push(standing === 'waiting'
      ? { what: 'Your other devices', state: 'bad', words: `${APP_SHORT_NAME} found its saved copy from another device, and is waiting for you to choose: keep ${thisDevice()} in step, or keep it separate.`, help: 'guide-devices', go: { label: 'Choose in Settings', href: '#/settings' } }
      : standing === 'separate'
        ? { what: 'Your other devices', state: 'note', words: `${Device} is kept separate: it does not read or write your saved copy.`, help: 'guide-devices' }
        : st?.locked
          ? { what: 'Your other devices', state: 'bad', words: `Your saved copy is encrypted and ${thisDevice()} has not been given the passphrase.`, help: 'fix-in-step', go: { label: 'Settings', href: '#/settings' } }
          : failed
            ? { what: 'Your other devices', state: 'bad', words: `The last attempt to keep in step failed: ${st!.error!.replace(/^\S+ /, '')}`, help: 'fix-in-step' }
            : st?.last
              ? { what: 'Your other devices', state: 'ok', words: `In step through Intervals.icu. Last combined ${new Date(st.last).toLocaleString()}.`, help: 'guide-devices' }
              : { what: 'Your other devices', state: 'note', words: 'Not combined with a saved copy yet.', help: 'guide-devices' });
  }

  // 4. The last backup file.
  const lastBackup = await getSetting<string | null>('lastBackup', null);
  out.push(lastBackup
    ? { what: 'Backup file', state: now - Date.parse(lastBackup) > 60 * 864e5 ? 'note' : 'ok', words: `The last backup file from ${thisDevice()} was made ${ageWords(lastBackup, now)}.`, go: { label: 'Back up in Settings', href: '#/settings' } }
    : { what: 'Backup file', state: 'note', words: `No backup file has been made from ${thisDevice()}.`, help: 'guide-devices', go: { label: 'Back up in Settings', href: '#/settings' } });

  // 5. Garmin, with a personal key (the installed apps only).
  if (inApp()) {
    const unreadable = await appKey.unreadable();
    const key = unreadable ? null : await appKey.read().catch(() => null);
    out.push(unreadable
      ? { what: 'Garmin personal key', state: 'bad', words: `A key is kept, but this copy of ${APP_SHORT_NAME} cannot read it. Enter the key once more, or make a new one in Garmin Connect.`, help: 'fix-garmin-key', go: { label: 'The key page', href: '#/garmin-key' } }
      : !key
        ? { what: 'Garmin personal key', state: 'off', words: 'None saved. It is only needed to bring activities straight from Garmin.', go: { label: 'The key page', href: '#/garmin-key' } }
        : key.expires && Date.parse(key.expires) < now
          ? { what: 'Garmin personal key', state: 'bad', words: `The saved key ran out on ${new Date(key.expires).toLocaleDateString()}. Make a new one in Garmin Connect.`, help: 'fix-garmin-key', go: { label: 'The key page', href: '#/garmin-key' } }
          : { what: 'Garmin personal key', state: 'ok', words: `A key is saved on ${thisDevice()}${key.expires ? `, good until ${new Date(key.expires).toLocaleDateString()}` : ''}. The key page has a test that asks Garmin with it.`, go: { label: 'The key page', href: '#/garmin-key' } });
  }

  // 6. The coach's AI key.
  const aiKey = await getSetting<string>(KEY_SETTING, '');
  const provider = await getSetting<string>(PROVIDER_SETTING, 'anthropic');
  out.push(aiKey
    ? { what: 'Coach', state: 'ok', words: `A key for ${PROVIDERS[provider] ?? provider} is saved on ${thisDevice()}. Test, in Settings under Coach, asks the provider one short question to prove it.`, help: 'fix-ai-key', go: { label: 'Settings', href: '#/settings' } }
    : { what: 'Coach', state: 'off', words: `No AI key saved. The coach's written view and answers need one; everything else works without.`, help: 'coach' });

  // 7. Bluetooth, for the ride player.
  const bt = await appBluetoothStanding();
  if (appKind() === 'ios' && bt) {
    out.push(bt === 'on' ? { what: 'Bluetooth', state: 'ok', words: `Turned on, and ${APP_SHORT_NAME} is allowed to use it.`, help: 'guide-trainer' }
      : bt === 'notAsked' ? { what: 'Bluetooth', state: 'note', words: `Not asked for yet. The first time you choose a trainer or sensor, you are asked whether ${APP_SHORT_NAME} may use Bluetooth.`, help: 'guide-trainer' }
      : bt === 'denied' ? { what: 'Bluetooth', state: 'bad', words: `${APP_SHORT_NAME} is not allowed to use Bluetooth. Open the Settings app, find ${APP_SHORT_NAME} in the list of apps, and turn Bluetooth on.`, help: 'fix-bluetooth' }
      : bt === 'off' ? { what: 'Bluetooth', state: 'bad', words: 'Bluetooth is turned off. Turn it on in the Settings app.', help: 'fix-bluetooth' }
      : { what: 'Bluetooth', state: 'bad', words: `${Device} has no Bluetooth that ${APP_SHORT_NAME} can use.`, help: 'fix-bluetooth' });
  } else if (bluetoothAvailable()) {
    out.push({ what: 'Bluetooth', state: 'ok', words: `${inApp() ? 'The app' : 'This browser'} can reach Bluetooth for the ride player.`, help: 'guide-trainer' });
  } else {
    const p = platform();
    out.push({ what: 'Bluetooth', state: inApp() ? 'bad' : 'note', words: inApp()
      ? `The app can't reach Bluetooth on ${thisDevice()}. Check that it is turned on and that ${APP_SHORT_NAME} is allowed to use it.`
      : p === 'iphone' || p === 'ipad' ? `A browser on ${p === 'iphone' ? 'an iPhone' : 'an iPad'} can't reach Bluetooth. The ${APP_SHORT_NAME} app for iPhone and iPad can.`
      : 'This browser can\'t reach Bluetooth. Chrome and Edge on a computer can, and so can the app for the Mac.', help: 'fix-bluetooth' });
  }

  // 8. The version.
  out.push({ what: 'This version', state: 'ok', words: `${APP_NAME}${appKind() === 'mac' ? ' for the Mac' : appKind() === 'ios' ? ' for iPhone and iPad' : ', in a browser'}, built ${buildTime()}.` });
  return out;
}

/**
 * The report a rider can read, edit and send when asking for help. It names no key, no account and no health number:
 * what version this is, what kind of device, what is connected (yes or no), and what Check my setup found.
 */
export async function diagnosticReport(lines?: SetupLine[]): Promise<string> {
  const l = lines ?? await checkSetup();
  const counts = await Promise.all([db.rides.count(), db.planned.count(), db.workouts.count(), db.plans.count()]).catch(() => [0, 0, 0, 0]);
  return [
    `${APP_NAME} report, ${new Date().toLocaleString()}`,
    `Version: ${appKind() === 'mac' ? 'the Mac app' : appKind() === 'ios' ? 'the iPhone and iPad app' : 'a browser'}, built ${buildTime()}`,
    `Device: ${navigator.userAgent}`,
    `Window: ${innerWidth} by ${innerHeight}`,
    `On this device: ${counts[0]} activities, ${counts[1]} calendar entries, ${counts[2]} of my own workouts, ${counts[3]} plans`,
    '',
    'Check my setup found:',
    ...l.map((x) => `- ${x.what}: ${x.state === 'ok' ? 'fine' : x.state === 'bad' ? 'PROBLEM' : x.state === 'off' ? 'not set up' : 'note'}. ${x.words}`),
    '',
    'What I was doing, and what happened:',
    '',
  ].join('\n');
}
