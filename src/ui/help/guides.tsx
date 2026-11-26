import { useState } from 'preact/hooks';
import { APP_SHORT_NAME, BACKUP_FILE_PREFIX } from '../../appName';
import { appKind, inApp, thisDevice } from '../../shell';
import { Flow } from './Flow';
import { Li, P } from './search';
import { Shot } from './Shot';
import { checkSetup, diagnosticReport, type SetupLine } from './setup';
import { NewsList, WHATS_NEW } from './whatsNew';

/**
 * Help's guides (25 Nov 2026): what a rider most often needs, each as a short walk-through with pictures of the app
 * as it looks on the device in their hand, a diagram where a choice is involved, and step-by-step fixes for the
 * problems that come up most. The longer reference sections (one per screen) follow them on the Help page.
 *
 * Keep them true: a guide describes what the app does today, on every version, and names no one maker's device
 * unless it is the only one supported.
 */

const ios = () => appKind() === 'ios';
const mac = () => appKind() === 'mac';
const tap = () => (ios() || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ? 'Tap' : 'Click');
const Device = () => thisDevice().replace(/^t/, 'T');

/** Check my setup: one button, each connection tried or read, each result in words with where to go next. */
function CheckSetup() {
  const [lines, setLines] = useState<SetupLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    try { setLines(await checkSetup()); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const mark = { ok: '✓', note: '•', bad: '!', off: '–' } as const;
  const said = { ok: 'Fine', note: 'Worth knowing', bad: 'Needs you', off: 'Not set up' } as const;
  return (
    <div class="setup-check">
      <button class="btn primary" onClick={run} disabled={busy}>{busy ? 'Checking…' : lines ? 'Check again' : 'Check my setup'}</button>
      {err && <div class="msg err" style="margin-top:10px">The check could not finish: {err}</div>}
      {lines && (
        <ul class="setup-lines" aria-live="polite">
          {lines.map((l) => (
            <li key={l.what} class={`s-${l.state}`}>
              <span class="setup-mark" aria-hidden="true">{mark[l.state]}</span>
              <div>
                <b>{l.what}</b> <span class="setup-said">{said[l.state]}</span>
                <p>{l.words}</p>
                {(l.help || l.go) && <p class="setup-go">{l.help && <a href={`#/help?s=${l.help}`}>{l.state === 'bad' ? 'How to fix it' : 'More about this'}</a>}{l.help && l.go && ' · '}{l.go && <a href={l.go.href}>{l.go.label}</a>}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Get help: the report a rider can read and copy, and where to send it once there is somewhere. */
function GetHelp() {
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  async function make() { setBusy(true); try { setReport(await diagnosticReport()); } finally { setBusy(false); } }
  async function copy() {
    if (!report) return;
    try { await navigator.clipboard.writeText(report); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* the text is there to select by hand */ }
  }
  return (
    <div>
      <button class="btn" onClick={make} disabled={busy}>{busy ? 'Making the report…' : report ? 'Make it again' : 'Make a report'}</button>
      {report && (
        <div style="margin-top:10px">
          <textarea class="setup-report" aria-label="The report" rows={12} value={report} onInput={(e) => setReport((e.target as HTMLTextAreaElement).value)} />
          <div class="row" style="gap:8px;margin-top:8px"><button class="btn primary sm" onClick={copy}>{copied ? 'Copied' : 'Copy the report'}</button></div>
        </div>
      )}
    </div>
  );
}

export interface HelpSection { id: string; title: string; group: 'Guides' | 'Fix a problem' | 'Every screen' | 'More'; body: preact.JSX.Element }

export const GUIDES: HelpSection[] = [
  {
    id: 'guide-start', title: 'Start here', group: 'Guides', body: (
      <>
        <P>{APP_SHORT_NAME} is a training coach for road cycling, with strength, mobility and walking alongside the riding. It builds a plan around the hours you have, lets you ride each session indoors on a trainer or send it to your bike computer or watch, reads back what you did, and adjusts the plan as you go.</P>
        <P><b>You need nothing but the app to begin.</b> There is no account to make. Your data is kept on {thisDevice()}, not with us.</P>
        <Shot name="welcome" alt="The first screen: Set up Antogo, with the optional offers below it" caption="The first screen. Set up Antogo is all you need; the rest is optional." />
        <ol>
          <Li><b>Set up {APP_SHORT_NAME}.</b> A few questions about you and your riding. Where you don't know a number, such as your FTP or your threshold heart rate, say <b>I don't know</b>: the app tells you how it will find out, and makes up nothing.</Li>
          <Li><b>Plan my training.</b> Give a goal, your hours on each day of the week and your equipment. Read the plan, then put it on the calendar.</Li>
          <Li><b>Do today's session.</b> Today shows it. Ride it indoors with <b>Ride indoors on the trainer</b>, or, with Intervals.icu connected, send it to your bike computer or watch.</Li>
          <Li><b>Look at what you did.</b> A ride from the ride player is saved by itself. Other recordings arrive by a sync or from their files (Settings, History, Add activity files).</Li>
        </ol>
        <Shot name="today" alt="Today: the day's session, the week so far and your readiness" caption="Today: what to do today, and how your week is going." />
        <P><b>Three things you can add, now or later, each in Settings:</b></P>
        <ul>
          <Li><b>A backup file,</b> if you have used {APP_SHORT_NAME} before. See <a href="#/help?s=guide-devices">Your devices, backup and restore</a>.</Li>
          <Li><b>Intervals.icu,</b> a free service many riders already use. Connected, it brings your history and your numbers, takes in recordings from many makes of bike computer and watch, sends your sessions to those devices, and can keep {APP_SHORT_NAME} in step between your own devices.</Li>
          <Li><b>A Garmin personal key,</b> to bring your activities straight from Garmin. {inApp() ? 'Settings, under History.' : `This needs the ${APP_SHORT_NAME} app for the Mac, iPhone or iPad.`}</Li>
        </ul>
        <P><b>The three versions.</b> {APP_SHORT_NAME} is the same app on iPhone and iPad, as an app for the Mac, and in a web browser. Each copy keeps its own data on its own device. {ios() ? `You are using the app for iPhone and iPad.` : mac() ? 'You are using the app for the Mac.' : 'You are using it in a browser.'}</P>
        <P>Every screen has a <b>?</b> at the top that opens Help at that screen. The search box at the top of Help looks through all of it.</P>
      </>
    ),
  },
  {
    id: 'guide-trainer', title: 'Connect your trainer and sensors', group: 'Guides', body: (
      <>
        <P>The ride player talks to a smart trainer, a power meter, a heart-rate strap, a speed or cadence sensor and a breathing strap over Bluetooth. {ios() ? `It uses ${thisDevice()}'s own Bluetooth.` : mac() ? 'It uses this Mac\'s Bluetooth.' : 'In a browser it needs Chrome or Edge on a computer; the apps for the Mac, iPhone and iPad have Bluetooth of their own.'}</P>
        <Flow label="Connecting a trainer and sensors" steps={[
          { title: 'Wake your devices', text: 'Pedal a few strokes to wake the trainer. Put the heart-rate strap on. Close any other app that is connected to them, on any device.' },
          { title: 'Open the ride', text: <>On Today, or on any ride's page: <b>Ride indoors on the trainer</b>. For no workout at all: Library, Rides, <b>Free ride on the trainer</b>.</> },
          { title: `${tap()} a device box`, text: 'There is one box for the smart trainer and one for each number: power, heart rate, cadence, speed, and breathing.' },
          ...(ios() ? [{ kind: 'ask' as const, title: `The first time: may ${APP_SHORT_NAME} use Bluetooth?`, text: 'Your device asks once.', paths: [
            { answer: 'Allow', steps: [{ title: 'The list of devices opens' }] },
            { answer: "Don't Allow", steps: [{ kind: 'end' as const, title: 'No devices can be found', text: `To change it: the Settings app, then ${APP_SHORT_NAME} in the list of apps, then Bluetooth.` }] },
          ] }] : []),
          { title: 'Choose your device from the list', text: 'The list shows only devices that box can use. It fills as devices are found.' },
          { title: 'Its numbers appear in the box', text: 'Repeat for each device you have. A trainer that measures power fills the power box too.' },
          { kind: 'end', title: 'Start ride', text: 'Start appears once the ride has what it needs. Until then, the panel in its place says what is missing.' },
        ]} />
        <Shot name="player-devices" alt="The ride screen before the ride, with a box for each device" caption="Your devices: a box for each. A connected device shows its numbers live." />
        <Shot name="choose-device" alt="The list of devices found nearby" caption="Choose a device. Nothing is connected until you pick one." />
        <ul>
          <Li><b>Next time</b>, {thisDevice()} remembers your devices and which box each was chosen for. {ios() || mac() ? 'They reconnect when you open the ride screen.' : 'Where the browser hands them back, they reconnect when you open the ride screen; where it does not, click the box and confirm the device.'} Settings, Ride player lists them, and can forget one.</Li>
          <Li><b>One app at a time.</b> Most trainers and many sensors accept one Bluetooth connection. If another app holds yours, {APP_SHORT_NAME} cannot. See <a href="#/help?s=fix-trainer-busy">The trainer says another app is connected</a>.</Li>
          {ios() && <Li><b>Keep {APP_SHORT_NAME} in front while you ride.</b> The screen stays on by itself during a ride. If you switch to another app, {APP_SHORT_NAME} cannot record until you come back.</Li>}
          <Li><b>Try it without the bike.</b> Settings, Ride player, <b>Practice with a simulated trainer</b>: each box then also offers a simulated device, and a simulated rider pedals for you.</Li>
        </ul>
        <Shot name="riding" alt="The riding screen: power as the big number, the step's target, heart rate and cadence" caption="Riding. The big number is your power; the target and what the trainer is doing are beside it." />
        <P>Everything the ride player does while you ride is in <a href="#/help?s=player">Riding with a trainer</a>.</P>
      </>
    ),
  },
  {
    id: 'guide-devices', title: 'Your devices, backup and restore', group: 'Guides', body: (
      <>
        <P><b>Each copy of {APP_SHORT_NAME} keeps its own data,</b> on the device it is on: your profile, plans, calendar, workouts, activities and recordings. Nothing is kept with us. There are two ways to have the same data on more than one device.</P>
        <P><b>1. Kept in step, by itself, through Intervals.icu.</b> If you connect the same Intervals.icu account on each device, {APP_SHORT_NAME} keeps a private saved copy there: a note in your own Intervals.icu calendar, dated 31 December 2099. Each device kept in step reads and writes it. The newest change to each thing wins, and what you delete on one device is deleted on the others.</P>
        <ul>
          <Li><b>It holds</b> your profile, settings, plans, calendar, workouts and day notes.</Li>
          <Li><b>It does not hold</b> your activities and recordings, which each device fetches for itself, or any of your keys.</Li>
          <Li><b>You choose for each device.</b> The first time a device finds the saved copy, it asks: <b>keep this device in step</b>, or <b>keep it separate</b>. A separate device never reads or changes the saved copy. You can change your mind in Settings.</Li>
        </ul>
        <Shot name="other-devices" alt="Your other devices: what the saved copy is, and the choices" caption="A saved copy found: what it is, where it is, and your choices. Nothing is combined until you choose." />
        <P><b>2. Carried by hand, with a backup file.</b> Settings, Across your devices, and backup, <b>Back up everything</b> makes one file with everything that is yours in the app, activities and recordings included. Save it anywhere your other device can reach: iCloud Drive, OneDrive, Google Drive, Dropbox, or the device itself. The file contains your keys, so keep it where you keep passwords.</P>
        <Shot name="settings-devices" alt="Settings: Across your devices, and backup" caption="Settings, Across your devices, and backup: how this device stands, Back up everything, and Restore." />
        <P><b>A new device, or the app installed again:</b></P>
        <Flow label="Setting up a new device" steps={[
          { kind: 'ask', title: 'Do your other devices use Intervals.icu?', paths: [
            { answer: 'Yes', steps: [
              { title: 'On the first screen: Connect Intervals.icu', text: 'Enter the same athlete ID and API key.' },
              { title: 'Your other devices', text: `${APP_SHORT_NAME} says it has found your saved copy and when it was last saved.` },
              { kind: 'end', title: 'Keep this device in step with my others', text: 'The device opens with your plan and settings, and stays in step from then on.' },
            ] },
            { answer: 'No', steps: [
              { title: 'On the old device: Back up everything', text: 'Save the file where the new device can reach it.' },
              { title: 'On the first screen: Choose a backup file', text: 'You are shown when the backup was made and what it holds before anything is restored.' },
              { kind: 'end', title: 'The device opens with what was in the file' },
            ] },
          ] },
        ]} />
        <P><b>What a restore does</b> depends on how the device stands. You are always shown the backup's date and age first.</P>
        <Flow label="What restoring a backup does" steps={[
          { kind: 'ask', title: 'Is this device kept in step with your others?', paths: [
            { answer: 'No', steps: [
              { title: 'Restore from a backup', text: 'What is on this device is replaced with the backup, as it was when the backup was made. Your other devices are not changed.' },
              { kind: 'ask', title: `Does ${APP_SHORT_NAME} then find a saved copy from your other devices?`, text: 'It asks at once.', paths: [
                { answer: 'Keep in step', steps: [{ kind: 'end', title: 'The two are combined', text: 'Where both hold the same thing, the newer version is kept, whichever it came from. An old backup never replaces newer data on your other devices.' }] },
                { answer: 'Keep separate', steps: [{ kind: 'end', title: 'This device keeps the backup', text: 'The saved copy is never read or changed.' }] },
              ] },
            ] },
            { answer: 'Yes', steps: [
              { kind: 'ask', title: 'Which do you want?', paths: [
                { answer: 'Restore from a backup', steps: [{ kind: 'end', title: 'Nothing newer is replaced', text: 'The backup is combined with what you have: the newer of each thing is kept, and what you have deleted since stays deleted. Activities and recordings in the backup are added where missing.' }] },
                { answer: 'Put everything back as it was', steps: [{ kind: 'end', title: 'The backup wins, on every device', text: 'For undoing a mistake. Changes made since the backup are lost and what was deleted since comes back. What you added since stays. It warns first.' }] },
              ] },
            ] },
          ] },
        ]} />
        <ul>
          <Li><b>Activities, wellness, original activity files and ride recordings</b> in a backup are only ever added where the device lacks them. A restore never removes them.</Li>
          <Li><b>Encrypting the saved copy:</b> Settings can encrypt the note with a passphrase you choose. Each other device then asks once for the passphrase.</Li>
          <Li><b>Deleting the app deletes its data</b> on that device. Make a backup file first, or check another device is in step.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'check', title: 'Check my setup', group: 'Guides', body: (
      <>
        <P>One button tries each connection you have made and reads how {thisDevice()} stands, then says what it found and where to go if something needs you. It changes nothing, and it does not spend anything on your AI key.</P>
        <CheckSetup />
      </>
    ),
  },
  {
    id: 'new', title: "What's new", group: 'Guides', body: (
      <>
        <P>What has changed in {APP_SHORT_NAME}, newest first. After an update, the newest entry is shown once when the app opens.</P>
        <NewsList entries={WHATS_NEW} />
      </>
    ),
  },

  // ---- Fix a problem ------------------------------------------------------------------------------------------------
  {
    id: 'fix-bluetooth', title: 'A trainer or sensor is not found, or drops out', group: 'Fix a problem', body: (
      <>
        <P><b>It is not in the list.</b> Work down these; most are the first two.</P>
        <ol>
          <Li><b>Wake it.</b> Pedal a few strokes for a trainer or power meter. Put a heart-rate strap on, with its contacts damp. A sensor asleep says nothing.</Li>
          <Li><b>Free it from other apps.</b> A device connected to another app, on this or any other device, usually cannot be found. Close that app completely. On a phone, that means swiping it away, not only leaving it.</Li>
          <Li><b>Check Bluetooth is on and allowed.</b> {ios()
            ? <>In the Settings app: Bluetooth turned on (Control Centre only pauses it), and under {APP_SHORT_NAME}, Bluetooth turned on.</>
            : mac() ? <>System Settings, Bluetooth: on. System Settings, Privacy and Security, Bluetooth: {APP_SHORT_NAME} switched on.</>
            : <>On a Mac: System Settings, Privacy and Security, Bluetooth, with your browser switched on. The browser must be Chrome or Edge on a computer.</>}</Li>
          <Li><b>Use the right box.</b> The list shows only devices that box can use. A heart-rate strap does not appear under Smart trainer.</Li>
          <Li><b>Bring it closer,</b> and check its battery. A coin cell near its end connects and then drops.</Li>
          <Li><b>Start afresh.</b> Close the list, {ios() ? `close ${APP_SHORT_NAME} and open it again` : 'reload the page or reopen the app'}, and try once more. If it was remembered and will not reconnect: Settings, Ride player, forget it, then add it again.</Li>
        </ol>
        <P><b>It connects, then drops out during a ride.</b> The box says so, and {APP_SHORT_NAME} keeps reaching for it by itself; the ride keeps recording with what it has. The usual causes are a weak battery, distance or something between the device and {thisDevice()}, and a second app taking the device. A trainer that drops forgets its target, so {APP_SHORT_NAME} gives it back when it returns.</P>
        <P><a href="#/help?s=check">Check my setup</a> says how Bluetooth stands on {thisDevice()}.</P>
      </>
    ),
  },
  {
    id: 'fix-trainer-busy', title: 'The trainer says another app is connected', group: 'Fix a problem', body: (
      <>
        <P>The trainer box shows the trainer's numbers but says {APP_SHORT_NAME} cannot control it. A smart trainer gives control to one app at a time, and another has it.</P>
        <ol>
          <Li><b>Find the other app.</b> A training app, or the trainer maker's own app, on a computer, a phone, a tablet, a bike computer or a TV box. It may be on a device in another room.</Li>
          <Li><b>Close it completely,</b> or turn Bluetooth off on that device for the ride.</Li>
          <Li><b>{tap()} the trainer box and choose the trainer again.</b> The box says when {APP_SHORT_NAME} has control.</Li>
          <Li><b>If it still will not give control,</b> switch the trainer off and on, then connect {APP_SHORT_NAME} first.</Li>
        </ol>
        <P>Until then you can still ride: the ride records the trainer's numbers, and you set the effort yourself.</P>
      </>
    ),
  },
  {
    id: 'fix-garmin-key', title: 'The Garmin key is refused, has run out, or is asked for again', group: 'Fix a problem', body: (
      <>
        <P>The Garmin personal key is typed into {APP_SHORT_NAME} once on each device and kept in that device's own password store. It is never in a backup and never sent anywhere but to Garmin. {inApp() ? '' : `It needs the ${APP_SHORT_NAME} app for the Mac, iPhone or iPad: Garmin does not answer a web browser.`}</P>
        <ul>
          <Li><b>Refused.</b> The key page (Settings, History) says what Garmin answered. Copy the key again from Garmin Connect, whole, with no space before or after. If it is still refused, make a new key in Garmin Connect and enter that.</Li>
          <Li><b>Run out.</b> A key can carry an end date. The key page shows it when it is known. Make a new key in Garmin Connect and enter it.</Li>
          <Li><b>Asked for again after an update or on a new device.</b> A key is readable only by the copy of the app that saved it, on that device. A reinstalled app, a new device, or a change in how the app is signed means entering it once more. Enter the same key, or make a new one.</Li>
          <Li><b>Keep the key where you can copy it again,</b> such as a password manager if you use one.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'fix-intervals', title: 'Intervals.icu is not syncing', group: 'Fix a problem', body: (
      <>
        <ol>
          <Li><b>Read what it says.</b> Today, under Sync, says when the last sync was and, if it failed, why. <a href="#/help?s=check">Check my setup</a> asks Intervals.icu now and reports its answer.</Li>
          <Li><b>Check the connection.</b> Settings, Intervals.icu, <b>Run connection checks</b> tries each thing the app does with Intervals.icu and says which passed.</Li>
          <Li><b>Check the ID and key.</b> In Intervals.icu: Settings, then the Developer section near the bottom. The athlete ID starts with the letter i. If you made a new API key there, the old one stopped working: paste the new one into {APP_SHORT_NAME}'s Settings and press Connect.</Li>
          <Li><b>Check the internet connection</b> on {thisDevice()}, then press Sync on Today.</Li>
          <Li><b>An activity is missing but the sync worked.</b> Activities reach Intervals.icu a few minutes after your device's own app has them. One older than two weeks that was never synced here: Settings, History. One under five minutes is kept out of the list as not training; a box at the top of Activities shows them.</Li>
          <Li><b>A session did not reach your bike computer or watch.</b> Open the session and use <b>Not on your device?</b> on its page. See <a href="#/help?s=sending">How sending works</a>.</Li>
        </ol>
      </>
    ),
  },
  {
    id: 'fix-ai-key', title: 'The coach\'s AI key is refused', group: 'Fix a problem', body: (
      <>
        <P>The coach's written view and answers use your own key from Anthropic, OpenAI or Google. The key stays on {thisDevice()} and goes only to that provider.</P>
        <ol>
          <Li><b>Press Test.</b> Settings, Coach, <b>Test</b> asks the provider one short question and shows its answer or its refusal, in the provider's own words.</Li>
          <Li><b>Check the provider matches the key.</b> A key from one provider is refused by another.</Li>
          <Li><b>Copy the key again,</b> whole, with no space before or after.</Li>
          <Li><b>Check your account with the provider.</b> Most refusals that are not a wrong key are about billing: no payment method, no credit left, or a spending limit reached. That is set on the provider's own website.</Li>
          <Li><b>Check the model.</b> If you typed a model name of your own, go back to <b>Most capable</b>. Providers retire older models.</Li>
        </ol>
        <P>Without a working key, everything else in {APP_SHORT_NAME} carries on: the plan checks itself each day with its own reasons.</P>
      </>
    ),
  },
  {
    id: 'fix-restore', title: 'A backup will not restore, or restored the wrong thing', group: 'Fix a problem', body: (
      <>
        <ul>
          <Li><b>"This is not a backup file this app can read."</b> The file is not one made by <b>Back up everything</b>. Backups are named {BACKUP_FILE_PREFIX}-backup- and the date, ending .zip; older ones end .json. An export of rides (Export) is a different file.</Li>
          <Li><b>The file is greyed out or missing in the picker.</b> In a cloud folder, the file may not be downloaded to {thisDevice()} yet: open the cloud app, let the file download, then choose it again.</Li>
          <Li><b>It restored, but the data is old.</b> A backup holds what the device had when the backup was made. The question before a restore shows that date and how long ago it was. To get newer data: connect Intervals.icu and keep the device in step, or make a new backup on the device that has the newer data.</Li>
          <Li><b>After restoring, {APP_SHORT_NAME} asks about your other devices.</b> It found your saved copy in Intervals.icu. <b>Keep in step</b> combines the two, keeping the newer of each thing. <b>Keep separate</b> leaves this device with the backup. See <a href="#/help?s=guide-devices">Your devices, backup and restore</a>.</Li>
          <Li><b>I restored an old backup on a device in step and nothing changed.</b> That is what an ordinary restore does there: nothing newer is replaced. To go back to the backup on purpose, use <b>Put everything back as it was</b> in Settings.</Li>
          <Li><b>I put everything back and want to undo it.</b> Use <b>Put everything back as it was</b> again with a backup made before you did it. This is why the warning asks you to make one first.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'fix-new-device', title: 'Moving to a new device', group: 'Fix a problem', body: (
      <>
        <ol>
          <Li><b>On the old device,</b> make a backup file: Settings, Across your devices, and backup, <b>Back up everything</b>. Save it where the new device can reach it. Do this even if you use Intervals.icu: the file is the only thing that carries your ride recordings and original activity files.</Li>
          <Li><b>On the new device,</b> install {APP_SHORT_NAME} and open it.</Li>
          <Li><b>If you use Intervals.icu:</b> choose <b>Connect Intervals.icu</b> on the first screen, then <b>Keep this device in step with my others</b>. Afterwards, Settings, <b>Restore from a backup</b> with your file adds the activities and recordings; on a device in step it replaces nothing newer.</Li>
          <Li><b>If you do not:</b> choose <b>Choose a backup file</b> on the first screen.</Li>
          <Li><b>Enter your keys again where asked.</b> The Garmin key is kept by each device's own password store and does not travel. The Intervals.icu key and the AI key travel in a backup file, not in the saved copy.</Li>
          <Li><b>Choose your trainer and sensors again</b> on the ride screen. Devices are remembered by each device for itself.</Li>
          <Li><b>Moving from the browser version to an app, or the other way,</b> is the same: they are separate copies. Back up in one, restore in the other.</Li>
        </ol>
      </>
    ),
  },
  {
    id: 'fix-in-step', title: 'My devices disagree', group: 'Fix a problem', body: (
      <>
        <ol>
          <Li><b>See how each device stands.</b> Settings, Across your devices, and backup, on each. It says <b>In step</b> with when it last combined, <b>Separate</b>, or that <b>a choice is needed</b>. A separate device, or one waiting for your choice, is not receiving changes.</Li>
          <Li><b>Press Sync now on each,</b> the one with the newer data first. The newest change to each thing wins, except that a session done on one device stays done everywhere.</Li>
          <Li><b>A device asks for a passphrase.</b> Your saved copy is encrypted, and that device has not been given the passphrase. Until it has, it neither sends nor receives changes. Enter it there once, or answer the question you set.</Li>
          <Li><b>Activities differ.</b> Activities do not travel in the saved copy: each device fetches its own. Press Sync on Today on the device that is behind; for older ones, Settings, History.</Li>
          <Li><b>Readiness or fitness differs first thing in the morning.</b> One device pulled before your watch's maker had finished writing the night's numbers. Press Sync on that device a few minutes later.</Li>
          <Li><b>The devices use different Intervals.icu accounts,</b> or one is not connected at all. They can only be kept in step through the same account.</Li>
        </ol>
        <P><a href="#/help?s=check">Check my setup</a> on each device says how it stands.</P>
      </>
    ),
  },

  // ---- More ---------------------------------------------------------------------------------------------------------
  {
    id: 'contact', title: 'Get help', group: 'More', body: (
      <>
        <P>Most answers are on this page: search it, or open the <b>?</b> on the screen you are stuck on. <a href="#/help?s=check">Check my setup</a> finds most connection problems.</P>
        <P><b>A support address for {APP_SHORT_NAME} is not set up yet.</b> This version is a test version, and the person who gave it to you is the one to ask. When you do, a report saves a lot of back and forth:</P>
        <ul>
          <Li><b>What it holds:</b> which version of {APP_SHORT_NAME} this is, what kind of device, how many activities and plans are on it, and what Check my setup found.</Li>
          <Li><b>What it never holds:</b> your keys, your account names, or any of your training or health numbers.</Li>
          <Li><b>Nothing is sent.</b> The report appears below for you to read and change. You copy it and send it yourself, however you like.</Li>
        </ul>
        <GetHelp />
        <P>{Device()} keeps your data whether or not you ask for help. Nothing about you reaches anyone unless you send it.</P>
      </>
    ),
  },
];
