import type { ComponentChildren } from 'preact';
import { phoneScreen } from '../../player/platform';
import { APP_SHORT_NAME, BACKUP_FILE_PREFIX } from '../../appName';
import { appKind, inApp, thisDevice } from '../../shell';
import { Flow } from './Flow';
import { CheckSetup, GetHelp } from './guides';
import { Facts, Note, Step, Steps } from './parts';
import { Shot, type ShotName } from './Shot';
import { NewsList, WHATS_NEW } from './whatsNew';

/**
 * Help's articles (26 Nov 2026). Help is a set of short pages, one task or one screen each, grouped into a few
 * topics: a sentence of what the page is for, numbered steps with the screen beside each, a few notes, and links on
 * to what a rider is likely to want next. The long account of each screen is kept in reference.tsx and folded away at
 * the foot of the article it belongs to.
 *
 * Writing one: say what to do, not everything that is true. One idea to a step. If a step needs more than two
 * sentences, it is two steps or a note. Describe what the app does today on every version, and name no maker's
 * device unless it is the only one supported.
 */

export interface Topic { id: string; title: string; text: string; icon: 'start' | 'plan' | 'ride' | 'after' | 'devices' | 'fix' }
export interface Article {
  id: string;
  topic: Topic['id'];
  title: string;
  /** One line, shown on the article's card and under its title. */
  summary: string;
  /** The picture on its card. */
  thumb?: ShotName;
  /** Made when shown, so it speaks for the version in the rider's hand. */
  body: () => ComponentChildren;
  /** The long account folded away at its foot, by its id in reference.tsx. */
  detail?: string;
  related?: string[];
}

export const TOPICS: Topic[] = [
  { id: 'start', title: 'Getting started', text: 'What the app does, and your first week.', icon: 'start' },
  { id: 'training', title: 'Your training', text: 'Today, your plan, the calendar and your workouts.', icon: 'plan' },
  { id: 'riding', title: 'Riding', text: 'Indoors on the trainer, outdoors, and sending to your device.', icon: 'ride' },
  { id: 'after', title: 'After the ride', text: 'Your activities, your progress and what the numbers mean.', icon: 'after' },
  { id: 'devices', title: 'Your devices and data', text: 'More than one device, backup, restore and settings.', icon: 'devices' },
  { id: 'fix', title: 'Fix a problem', text: 'Step-by-step fixes for what goes wrong most.', icon: 'fix' },
];

const ios = () => appKind() === 'ios';
const mac = () => appKind() === 'mac';
const touch = () => ios() || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
const tap = () => (touch() ? 'Tap' : 'Click');
const Device = () => thisDevice().replace(/^t/, 'T');
const A = ({ to, children }: { to: string; children: ComponentChildren }) => <a href={`#/help/${to}`}>{children}</a>;

export const ARTICLES: Article[] = [
  // ---- Getting started -----------------------------------------------------------------------------------------------
  {
    id: 'start', topic: 'start', title: `What ${APP_SHORT_NAME} does`, summary: 'A coach for your cycling, on your own device.', thumb: 'today',
    related: ['first-run', 'first-week'],
    body: () => (
      <>
        <p class="h-lead">{APP_SHORT_NAME} plans your training around the hours you have, takes you through each session, reads back what you did, and adjusts the plan as you go.</p>
        <Shot name="today" alt="Today: the day's session, the week so far and your readiness" />
        <Facts items={[
          { title: 'It plans', text: 'Rides, strength, mobility and walking, around your goal and your week.' },
          { title: 'It rides with you', text: 'Indoors it runs the session on your trainer. Outdoors it sends it to your bike computer or watch.' },
          { title: 'It learns', text: 'It reads each ride and your recovery, and changes the plan when you need it changed.' },
        ]} />
        <Note title="Your data stays with you">There is no account to make. Everything is kept on {thisDevice()}, not with us. {APP_SHORT_NAME} contacts another service only when you connect one.</Note>
        <Facts items={[
          { title: 'iPhone and iPad', text: `The ${APP_SHORT_NAME} app, with the device's own Bluetooth for your trainer.` },
          { title: 'Mac', text: 'The app for the Mac. It is signed by its maker and checked by Apple, so it opens with a double-click. Download it from Settings, at the foot, in the browser version.' },
          { title: 'A web browser', text: 'The same app as a page. Riding with a trainer needs Chrome or Edge on a computer.' },
        ]} />
        <p>Each copy keeps its own data. <A to="devices">Using more than one device</A> explains how to have the same data on all of them.</p>
      </>
    ),
  },
  {
    id: 'first-run', topic: 'start', title: `Set up ${APP_SHORT_NAME}`, summary: 'A few questions, then your first plan.', thumb: 'welcome',
    related: ['first-week', 'connect-intervals', 'backup'],
    body: () => (
      <>
        <p class="h-lead">You need nothing but the app. Setup takes a few minutes.</p>
        <Steps>
          <Step title={`${tap()} Set up ${APP_SHORT_NAME}`} shot="welcome" alt="The first screen">The offers below the button are optional. Each is also in Settings later.</Step>
          <Step title="Answer a few questions about you" shot="setup-you" alt="The questions about you">Where you don't know a number, such as your FTP, choose <b>I don't know</b>. The app says how it will find out, and makes nothing up.</Step>
          <Step title="Plan your training" shot="plan-new" alt="Plan my training">On Plan, give your goal, the hours you have each day and your equipment. Read the plan, then put it on your calendar.</Step>
          <Step title="Open Today" shot="today" alt="Today">Your first session is there.</Step>
        </Steps>
        <Note kind="tip" title="Used it before, or use Intervals.icu?">On the first screen, <b>Choose a backup file</b> brings back a backup, and <b>Connect Intervals.icu</b> brings your history and fills in your numbers. See <A to="backup">Back up and restore</A> and <A to="connect-intervals">Connect Intervals.icu</A>.</Note>
      </>
    ),
  },
  {
    id: 'first-week', topic: 'start', title: 'Your first week', summary: 'What to do each day, and what to expect.', thumb: 'calendar', detail: 'firstweek',
    related: ['today', 'trainer', 'activities'],
    body: () => (
      <>
        <p class="h-lead">One habit carries the whole app: open Today, do what it shows, and look at it afterwards.</p>
        <Steps>
          <Step title="Each morning, open Today" shot="today">It shows the day's session and how ready you are for it. If the plan has changed, it says why.</Step>
          <Step title="Do the session" shot="workout" alt="A ride's page">Indoors: <b>Ride indoors on the trainer</b>. Outdoors: <b>Send to my devices</b>, with Intervals.icu connected, or follow it from its page.</Step>
          <Step title="Look at what you did" shot="activity" alt="An activity's page">A ride from the ride player is saved by itself. Others arrive at the next Sync, or from their files.</Step>
          <Step title="Check the week on the Calendar" shot="calendar">Move a session to another day if you need to. The plan re-checks itself around what you change.</Step>
        </Steps>
        <Note>The first week has less to go on. Fitness, readiness and the coach's view sharpen as rides come in.</Note>
      </>
    ),
  },
  {
    id: 'connect-intervals', topic: 'start', title: 'Connect Intervals.icu', summary: 'Optional: your history, your devices and sync.', thumb: 'settings-intervals', detail: 'setup',
    related: ['sending', 'devices', 'fix-intervals'],
    body: () => (
      <>
        <p class="h-lead">Intervals.icu is a free service many riders already use. {APP_SHORT_NAME} works without it. Connected, it adds three things.</p>
        <Facts items={[
          { title: 'Your history', text: 'Past rides and wellness, from the makers you have connected there.' },
          { title: 'Your devices', text: 'Sessions sent to your bike computer or watch, and recordings brought back.' },
          { title: 'Sync', text: `${APP_SHORT_NAME} kept in step between your own devices.` },
        ]} />
        <Steps>
          <Step title="Make an Intervals.icu account">At intervals.icu. It is free.</Step>
          <Step title="Connect your device's maker there">In Intervals.icu's Settings: Garmin, Wahoo, Polar, COROS, Suunto and others. Tick <b>Upload planned workouts</b> if you want sessions sent to the device.</Step>
          <Step title="Find your athlete ID and API key">In Intervals.icu's Settings, in the Developer section near the bottom. The ID starts with the letter i.</Step>
          <Step title={`Enter them in ${APP_SHORT_NAME}`} shot="settings-intervals" alt="Settings, Intervals.icu">On a new installation: <b>Connect Intervals.icu</b> on the first screen. Otherwise: Settings, Intervals.icu. Then press Connect.</Step>
        </Steps>
        <Note>The key is kept on {thisDevice()} and sent only to Intervals.icu.</Note>
      </>
    ),
  },

  // ---- Your training -------------------------------------------------------------------------------------------------
  {
    id: 'today', topic: 'training', title: 'Today', summary: 'What to do today, and how ready you are.', thumb: 'today', detail: 'today',
    related: ['coach', 'calendar', 'changing'],
    body: () => (
      <>
        <p class="h-lead">Today is the screen to open each day. It answers three questions.</p>
        <Shot name="today" alt="Today" />
        <Facts items={[
          { title: 'What should I do?', text: 'The day\'s session, with a button to ride it or send it.' },
          { title: 'Am I ready for it?', text: 'Your readiness, from your recent training and, where you have it, sleep and heart-rate data.' },
          { title: 'How is the week going?', text: 'What is done and what is left.' },
        ]} />
        <Note kind="tip">If the plan was changed overnight, Today says what changed and why. You can always undo it.</Note>
      </>
    ),
  },
  {
    id: 'plan', topic: 'training', title: 'Plan your training', summary: 'A plan built around your goal and your hours.', thumb: 'plan', detail: 'plan',
    related: ['changing', 'calendar', 'library'],
    body: () => (
      <>
        <p class="h-lead">A plan is a run of weeks built toward a goal, around the days and hours you have.</p>
        <Steps>
          <Step title="Open Plan and choose Plan my training" shot="plan-new" alt="Plan my training">Say what you are training for, and by when if there is a date.</Step>
          <Step title="Give your week">The hours you have on each day, where you ride, and the equipment you have for strength.</Step>
          <Step title="Read the plan" shot="plan" alt="Your plans">You see every week before anything is put on the calendar. Change the answers and build it again as often as you like.</Step>
          <Step title="Put it on the calendar" shot="calendar">Sessions appear on their days, and Today starts showing them.</Step>
        </Steps>
        <Note>The plan checks itself every day against how you are recovering and what you did, and changes when it should. See <A to="changing">Change your plan</A>.</Note>
      </>
    ),
  },
  {
    id: 'changing', topic: 'training', title: 'Change your plan', summary: 'Move a session, miss a day, start again.', thumb: 'calendar', detail: 'changing',
    related: ['plan', 'calendar', 'today'],
    body: () => (
      <>
        <p class="h-lead">Plans meet real weeks. Change yours whenever you need to.</p>
        <Facts items={[
          { title: 'Move a session', text: 'On the Calendar, drag it to another day with a mouse, or use Move to another day on the session.' },
          { title: 'Did it on another day', text: 'It is matched to the session by itself, or you can match it on the activity\'s page.' },
          { title: 'Missed it', text: 'It stays on its day, marked as missed. Move it to today or later to do it after all; otherwise the plan takes the miss into account.' },
          { title: 'Everything has changed', text: 'On Plan, build a new plan from today. Your history stays.' },
        ]} />
        <Shot name="calendar" alt="The Calendar" />
        <Note kind="tip">You never need to tidy up after yourself. The daily check works from what actually happened.</Note>
      </>
    ),
  },
  {
    id: 'calendar', topic: 'training', title: 'The Calendar', summary: 'Your weeks: what is planned and what is done.', thumb: 'calendar', detail: 'calendar',
    related: ['changing', 'library', 'today'],
    body: () => (
      <>
        <p class="h-lead">The Calendar shows every day's sessions, done and still to do.</p>
        <Shot name="calendar" alt="The Calendar: the month, with each day's sessions" />
        <Facts items={[
          { title: 'Open a session', text: `${tap()} it to see its steps, ride it or send it.` },
          { title: 'Move it', text: 'Drag it to another day with a mouse, or use Move to another day on the session.' },
          { title: 'Add one', text: '+ Add, on any day from today on, puts a session from the Library on it.' },
        ]} />
      </>
    ),
  },
  {
    id: 'library', topic: 'training', title: 'Workouts and the Library', summary: 'Ready-made sessions, and building your own.', thumb: 'library', detail: 'library',
    related: ['calendar', 'trainer', 'sending'],
    body: () => (
      <>
        <p class="h-lead">The Library holds every kind of session: rides, strength, mobility and walks. Use them as they are, or build your own.</p>
        <Steps>
          <Step title="Browse or search the Library" shot="library" alt="The Library">Sessions are grouped by kind and by what they train.</Step>
          <Step title="Open one" shot="workout" alt="A ride's page">You see its steps and targets, worked out from your own numbers.</Step>
          <Step title="Ride it, schedule it or send it">Ride it now on the trainer, put it on a day, or send it to your device.</Step>
          <Step title="Build your own">New workout starts an empty one. Any session can also be copied and changed.</Step>
        </Steps>
      </>
    ),
  },
  {
    id: 'coach', topic: 'training', title: 'The coach', summary: 'A written view of your training, and answers.', detail: 'coach',
    related: ['today', 'fix-ai-key', 'settings'],
    body: () => (
      <>
        <p class="h-lead">The plan checks itself every day by its own rules, with its reasons shown. The coach adds a written view and answers your questions, using an AI service you choose.</p>
        <Steps>
          <Step title="Get a key from an AI provider">Anthropic, OpenAI or Google. You pay the provider for what you use; it is usually a small amount.</Step>
          <Step title="Enter it in Settings, under Coach">Then press <b>Test</b>, which asks the provider one short question to prove the key.</Step>
          <Step title="Read the coach's view on Today">Ask it anything about your training from there.</Step>
        </Steps>
        <Note title="What the provider receives">Your profile, summaries of your training and wellness, and what you type. It goes from {thisDevice()} straight to the provider, never to us.</Note>
        <Note kind="warn">An AI can be wrong. The coach is general training information, not medical advice.</Note>
      </>
    ),
  },

  // ---- Riding --------------------------------------------------------------------------------------------------------
  {
    id: 'trainer', topic: 'riding', title: 'Connect your trainer and sensors', summary: 'Smart trainer, power, heart rate and more, over Bluetooth.', thumb: 'device-boxes',
    related: ['riding', 'fix-bluetooth', 'fix-trainer-busy'],
    body: () => (
      <>
        <p class="h-lead">{ios() ? `${APP_SHORT_NAME} uses ${thisDevice()}'s own Bluetooth.` : mac() ? `${APP_SHORT_NAME} uses this Mac's Bluetooth.` : 'In a browser this needs Chrome or Edge on a computer. The apps for the Mac, iPhone and iPad have Bluetooth of their own.'}</p>
        <Steps>
          <Step title="Wake your devices">Pedal a few strokes. Put your heart-rate strap on. Close any other app connected to them, on any device.</Step>
          <Step title="Open a ride" shot="player-devices" alt="The ride screen before the ride">On Today or any ride's page: <b>Ride indoors on the trainer</b>. For no workout: Library, Rides, <b>Free ride on the trainer</b>.</Step>
          <Step title={`${tap()} a device box`} shot="device-boxes" alt="The device boxes">One box for the trainer, and one for each number: power, heart rate, cadence, speed and breathing.</Step>
          <Step title="Choose your device" shot="choose-device" alt="The list of devices found nearby">The list shows only devices that box can use.{ios() ? ` The first time, your device asks whether ${APP_SHORT_NAME} may use Bluetooth: allow it.` : ''}</Step>
          <Step title="Watch its numbers appear">Repeat for each device. A trainer that measures power fills the power box too.</Step>
        </Steps>
        <Note kind="tip" title="Next time">{Device()} remembers your devices and reconnects them when you open the ride screen.</Note>
        <Note title="One app at a time">Most trainers accept one Bluetooth connection. If another app holds yours, {APP_SHORT_NAME} cannot. See <A to="fix-trainer-busy">The trainer says another app is connected</A>.</Note>
        <Note kind="tip" title="No bike to hand?">Settings, Ride player, <b>Practice with a simulated trainer</b> lets you try the whole thing.</Note>
      </>
    ),
  },
  {
    id: 'riding', topic: 'riding', title: 'Ride indoors', summary: 'The session on your trainer, step by step.', thumb: 'riding', detail: 'player',
    related: ['trainer', 'activities', 'fix-bluetooth'],
    body: () => (
      <>
        <p class="h-lead">The ride player runs the session on your trainer and records the ride.</p>
        <Steps>
          <Step title="Press Start ride" shot="player-devices" alt="Before the ride">Start appears once the ride has what it needs. Until then the panel says what is missing.</Step>
          <Step title="Ride to the target" shot="riding" alt="The riding screen">The big number is your power. In ERG the trainer holds each step's target for you; just pedal.</Step>
          <Step title="Change things as you go">Make the whole session harder or easier, skip a step, pause, or switch the trainer out of ERG.</Step>
          <Step title="Press End ride" shot="ride-summary" alt="After the ride">The ride is saved in {APP_SHORT_NAME} by itself, with a summary of how it went against the plan.</Step>
        </Steps>
        {ios() ? (
          <Note title={`${APP_SHORT_NAME} does not have to stay in front`}>Switch to another app or lock the screen and the ride carries on: every reading is kept and the trainer keeps to its targets. When you return, the screen catches up. A ride steered by heart rate or breathing holds its last target while you are away.</Note>
        ) : mac() ? (
          <Note title={`${APP_SHORT_NAME} does not have to stay in front`}>The ride carries on when the window is hidden or behind another.</Note>
        ) : (
          <Note title="In a browser">The ride carries on in a tab that is not in front, keeping time by your devices' readings. Do not close the tab.</Note>
        )}
        {phoneScreen() && <Note title="On a phone, the ride is two pages">Ride and Workout each fit the screen, upright or on its side. Swipe sideways, or press a page's name at the foot. Ride has the big number, the step you are on with its time left in a ring, your other readings and the ride so far. Workout has the ride's profile, every step, the trainer's controls and Skip this step. When the ride ends, Ride complete is two pages in the same way: Summary, where you save the ride, and Details, with each effort and what the cues said.</Note>}
        <Note kind="tip">With auto-pause on, the ride pauses when you stop pedalling and carries on when you start again.</Note>
      </>
    ),
  },
  {
    id: 'sending', topic: 'riding', title: 'Send a session to your device', summary: 'Bike computers and watches, through Intervals.icu.', thumb: 'send', detail: 'sending',
    related: ['connect-intervals', 'outdoors', 'fix-intervals'],
    body: () => (
      <>
        <p class="h-lead">{APP_SHORT_NAME} puts the session on your Intervals.icu calendar. Intervals.icu passes it to your device's maker, and the maker delivers it.</p>
        <Flow label="How a session reaches your device, and comes back" steps={[
          { title: `${APP_SHORT_NAME}`, text: 'Send to my devices puts the session on your Intervals.icu calendar.' },
          { title: 'Intervals.icu', text: 'Passes it to each maker you connected with Upload planned workouts ticked.' },
          { title: "Your device's maker", text: "Delivers it at the device's next sync with its own app." },
          { kind: 'end', title: 'Your device', text: 'Shows each step and target. The recording comes back the same way.' },
        ]} />
        <Steps>
          <Step title="Open the session" shot="workout" alt="A ride's page">From Today, the Calendar or the Library.</Step>
          <Step title="Press Send to my devices" shot="send" alt="Send to my devices">The line beneath says where Intervals.icu will pass it.</Step>
          <Step title="Sync your device with its own app">The session appears among the device's workouts.</Step>
        </Steps>
        <Note>Sending needs Intervals.icu connected. Without it, a session's page offers the session as a file to load yourself.</Note>
      </>
    ),
  },
  {
    id: 'outdoors', topic: 'riding', title: 'Ride a workout outdoors', summary: 'On your bike computer or watch, or by feel.', thumb: 'workout', detail: 'outdoors',
    related: ['sending', 'activities'],
    body: () => (
      <>
        <p class="h-lead">Any ride can be ridden outdoors: followed on your device, or from its steps.</p>
        <Facts items={[
          { title: 'On your device', text: <>Send it, and the device shows each step and target. See <A to="sending">Send a session to your device</A>.</> },
          { title: 'By feel', text: 'Each step also says how it should feel, so you can ride it with no numbers at all.' },
          { title: 'Afterwards', text: 'The recording comes in at the next Sync, or from its file, and is matched to the session.' },
        ]} />
        <Note kind="warn">Obey traffic laws, and keep your eyes on the road, not on a screen.</Note>
      </>
    ),
  },

  // ---- After the ride ------------------------------------------------------------------------------------------------
  {
    id: 'activities', topic: 'after', title: 'Activities', summary: 'Every ride and workout you have done.', thumb: 'activity', detail: 'activities',
    related: ['progress', 'numbers', 'export'],
    body: () => (
      <>
        <p class="h-lead">Activities lists what you have done. Open one to see how it went.</p>
        <Steps>
          <Step title="Open Activities" shot="activities" alt="The list of activities">Newest first.</Step>
          <Step title="Open an activity" shot="activity" alt="An activity's page">Its chart, its numbers, and how it compared with the session planned.</Step>
        </Steps>
        <Facts items={[
          { title: 'From the ride player', text: 'Saved by itself when you end the ride.' },
          { title: 'From your device', text: 'At the next Sync, with Intervals.icu or a Garmin key connected.' },
          { title: 'From a file', text: 'Settings, History, Add activity files.' },
        ]} />
        <Note kind="tip">Wrong numbers in an activity can be corrected on its page.</Note>
      </>
    ),
  },
  {
    id: 'progress', topic: 'after', title: 'Progress', summary: 'Fitness, fatigue and form over time.', thumb: 'progress', detail: 'progress',
    related: ['numbers', 'activities'],
    body: () => (
      <>
        <p class="h-lead">Progress shows where your training is taking you.</p>
        <Shot name="progress" alt="Progress: fitness, fatigue and form over time" />
        <Facts items={[
          { title: 'Fitness', text: 'How much training you have absorbed over about six weeks.' },
          { title: 'Fatigue', text: 'How much you have done in the last week.' },
          { title: 'Form', text: 'The gap between them: how fresh you are.' },
        ]} />
        <Note kind="tip">{tap()} any chart to open it large.</Note>
      </>
    ),
  },
  {
    id: 'insights', topic: 'after', title: 'Insights and the Lab', summary: 'Your questions answered, and every figure behind the answers.',
    related: ['progress', 'numbers'],
    body: () => (
      <>
        <p class="h-lead">Insights answers the questions riders ask. The Lab holds every figure behind the answers.</p>
        <Facts items={[
          { title: 'Insights', text: 'One card for each question that can be answered for you today, with the answer in a sentence and how strong the evidence is.' },
          { title: 'Why it says so', text: 'Open a card to see the evidence for the answer and any against it. Each piece has See the data.' },
          { title: 'The Lab', text: 'Every chart and every measure, over any period. Search it, pin what you use most, and open any measure large to lay others over it.' },
        ]} />
        <Note kind="tip">A measure you have no data for stays empty and says what it needs. Nothing is filled in from other riders.</Note>
      </>
    ),
  },
  {
    id: 'numbers', topic: 'after', title: 'The numbers, explained', summary: 'FTP, TSS, zones and the rest, in plain words.', detail: 'numbers',
    related: ['progress', 'activities'],
    body: () => (
      <>
        <p class="h-lead">Every number in the app, in plain words. Wherever a number appears, {touch() ? 'tapping' : 'clicking'} its name explains it there too.</p>
        <Facts items={[
          { title: 'FTP', text: 'The power you could hold for about an hour. Your power targets are set from it.' },
          { title: 'Zones', text: 'Bands of effort, from easy to all-out, by power or by heart rate.' },
          { title: 'Load', text: 'How much a ride took out of you: how hard, for how long.' },
        ]} />
        <p>The full list is under All the detail, below.</p>
      </>
    ),
  },
  {
    id: 'export', topic: 'after', title: 'Download and export', summary: 'Your rides and workouts, as files.', detail: 'export',
    related: ['backup', 'activities'],
    body: () => (
      <>
        <p class="h-lead">Everything you make and record in {APP_SHORT_NAME} is yours to take out, at any time.</p>
        <Facts items={[
          { title: 'A ride', text: 'From its page, as a file other apps and services read.' },
          { title: 'A workout', text: 'From its page, as a file for a bike computer or another app.' },
          { title: 'Many at once', text: 'Export, in Settings and at the top of Activities.' },
          { title: 'Everything', text: <>A backup file. See <A to="backup">Back up and restore</A>.</> },
        ]} />
      </>
    ),
  },

  // ---- Your devices and data -----------------------------------------------------------------------------------------
  {
    id: 'devices', topic: 'devices', title: 'Use more than one device', summary: 'The same data on your phone, tablet and computer.', thumb: 'other-devices',
    related: ['backup', 'new-device', 'fix-in-step'],
    body: () => (
      <>
        <p class="h-lead">Each copy of {APP_SHORT_NAME} keeps its own data on its own device. Connect the same Intervals.icu account on each, and they keep in step by themselves.</p>
        <Steps>
          <Step title="Connect Intervals.icu on each device" shot="settings-intervals" alt="Settings, Intervals.icu">The same athlete ID and API key on all of them.</Step>
          <Step title="Choose for each device" shot="other-devices" alt="Your other devices">The first time a device finds your saved copy, it asks. Nothing is combined until you answer.</Step>
        </Steps>
        <Facts items={[
          { title: 'Keep in step', text: 'A change on any device reaches the others. The newest change to each thing wins.' },
          { title: 'Keep separate', text: 'The device keeps its own data and never reads or changes the saved copy.' },
        ]} />
        <Note title="Where the saved copy is">A private note in your own Intervals.icu calendar, dated 31 December 2099. It holds your profile, settings, plans, calendar, workouts and day notes.</Note>
        <Note title="What does not travel">Activities and recordings: each device fetches its own. Your keys: each device keeps its own.</Note>
        <Note kind="tip">Change your mind at any time in Settings, under Across your devices, and backup.</Note>
      </>
    ),
  },
  {
    id: 'backup', topic: 'devices', title: 'Back up and restore', summary: 'One file with everything, and what a restore does.', thumb: 'restore',
    related: ['devices', 'new-device', 'fix-restore'],
    body: () => (
      <>
        <p class="h-lead">A backup is one file with everything that is yours in the app, activities and recordings included.</p>
        <Steps>
          <Step title="Open Settings, Across your devices, and backup" shot="settings-devices" alt="Settings: Across your devices, and backup" />
          <Step title="Press Back up everything" shot="restore" alt="Back up everything, and Restore">Save the file anywhere you like: iCloud Drive, OneDrive, Google Drive, Dropbox, or the device itself.</Step>
          <Step title="To restore, press Restore from a backup">You are shown when the backup was made, how old it is and what it holds, before anything happens.</Step>
        </Steps>
        <Note kind="warn" title="The file contains your keys">Keep it where you keep passwords.</Note>
        <p><b>What a restore does</b> depends on how the device stands:</p>
        <Flow label="What restoring a backup does" steps={[
          { kind: 'ask', title: 'Is this device kept in step with your others?', paths: [
            { answer: 'No', steps: [{ kind: 'end', title: 'This device is replaced with the backup', text: `As it was then. No other device is changed. If ${APP_SHORT_NAME} then finds your saved copy, it asks at once, and keeping in step keeps the newer of each thing.` }] },
            { answer: 'Yes', steps: [{ kind: 'end', title: 'Nothing newer is replaced', text: 'The backup is combined with what you have. What you deleted since stays deleted.' }] },
          ] },
        ]} />
        <Note title="Put everything back as it was">A separate button, on a device in step, for undoing a mistake. The backup then wins on every device. It warns first.</Note>
        <Note kind="tip">Activities, wellness, original files and recordings in a backup are only ever added. A restore never removes them.</Note>
      </>
    ),
  },
  {
    id: 'new-device', topic: 'devices', title: 'Move to a new device', summary: 'A new phone, tablet or computer, or the app installed again.', thumb: 'welcome',
    related: ['backup', 'devices', 'trainer'],
    body: () => (
      <>
        <p class="h-lead">Two ways, depending on whether your devices use Intervals.icu.</p>
        <Flow label="Setting up a new device" steps={[
          { kind: 'ask', title: 'Do your other devices use Intervals.icu?', paths: [
            { answer: 'Yes', steps: [
              { title: 'Connect Intervals.icu on the first screen' },
              { kind: 'end', title: 'Keep this device in step with my others', text: 'It opens with your plan and settings.' },
            ] },
            { answer: 'No', steps: [
              { title: 'On the old device: Back up everything' },
              { kind: 'end', title: 'On the new one: Choose a backup file', text: 'On the first screen.' },
            ] },
          ] },
        ]} />
        <Shot name="welcome" alt="The first screen, with Choose a backup file and Connect Intervals.icu" />
        <Note kind="tip" title="Make a backup file either way">It is the only thing that carries your ride recordings and original activity files. On a device in step, restoring it replaces nothing newer.</Note>
        <Note title="Do again on the new device">Enter your Garmin key, and choose your trainer and sensors on the ride screen. Each device keeps those for itself.</Note>
        <Note>The browser version and the apps are separate copies. Moving between them is the same: back up in one, restore in the other.</Note>
      </>
    ),
  },
  {
    id: 'settings', topic: 'devices', title: 'Settings', summary: 'You, your connections, the ride player and the look.', thumb: 'settings', detail: 'settings',
    related: ['connect-intervals', 'backup', 'garmin-key'],
    body: () => (
      <>
        <p class="h-lead">Settings holds everything about you and how the app behaves, in sections that open when pressed.</p>
        <Shot name="settings" alt="Settings" />
        <Facts items={[
          { title: 'You, and Thresholds and zones', text: 'Your numbers and your week. Change them and press Save.' },
          { title: 'Coach', text: 'Your AI provider and key. Optional.' },
          { title: 'Intervals.icu', text: 'Connect, disconnect and check the connection.' },
          { title: 'Across your devices, and backup', text: 'How this device stands, Back up and Restore.' },
          { title: 'History', text: 'Bring in older activities, files and a Garmin key.' },
          { title: 'Ride player', text: 'Your remembered devices and how the player behaves.' },
          { title: 'Appearance', text: 'Light, dark, or as your device is set.' },
        ]} />
      </>
    ),
  },
  {
    id: 'garmin-key', topic: 'devices', title: 'Garmin, with a personal key', summary: 'Your activities straight from Garmin.', thumb: 'garmin-key',
    related: ['fix-garmin-key', 'connect-intervals'],
    body: () => (
      <>
        <p class="h-lead">A personal key from Garmin lets {APP_SHORT_NAME} bring your activities and wellness straight from Garmin. {inApp() ? '' : `It needs the ${APP_SHORT_NAME} app for the Mac, iPhone or iPad: Garmin does not answer a web browser.`}</p>
        <Steps>
          <Step title="Make a personal key in Garmin Connect">Copy it somewhere you can find it again.</Step>
          <Step title="Open Settings, History, Garmin, with your personal key" shot="garmin-key" alt="The Garmin key page" />
          <Step title="Paste the key and save">The page has a test that asks Garmin with it.</Step>
        </Steps>
        <Note title="Where the key is kept">In {thisDevice()}'s own password store. It is never in a backup, and it goes only to Garmin. Each device needs it entered once.</Note>
      </>
    ),
  },

  // ---- Fix a problem -------------------------------------------------------------------------------------------------
  {
    id: 'fix-bluetooth', topic: 'fix', title: 'A trainer or sensor is not found, or drops out', summary: 'Work down these; most are the first two.', thumb: 'choose-device',
    related: ['trainer', 'fix-trainer-busy', 'check'],
    body: () => (
      <>
        <Steps>
          <Step title="Wake it">Pedal a few strokes for a trainer or power meter. Put a heart-rate strap on, with its contacts damp.</Step>
          <Step title="Free it from other apps">A device connected to another app, on any device, usually cannot be found. Close that app completely.</Step>
          <Step title="Check Bluetooth is on and allowed">{ios()
            ? <>In the Settings app: Bluetooth on (Control Centre only pauses it), and under {APP_SHORT_NAME}, Bluetooth on.</>
            : mac() ? <>System Settings, Bluetooth: on. Privacy and Security, Bluetooth: {APP_SHORT_NAME} on.</>
            : <>The browser must be Chrome or Edge on a computer. On a Mac: System Settings, Privacy and Security, Bluetooth, with your browser on.</>}</Step>
          <Step title="Use the right box" shot="device-boxes" alt="The device boxes">The list shows only devices that box can use. A heart-rate strap is not listed under Smart trainer.</Step>
          <Step title="Bring it closer, and check its battery">A coin cell near its end connects and then drops.</Step>
          <Step title="Start afresh">Close and reopen {APP_SHORT_NAME}. If a remembered device will not reconnect: Settings, Ride player, forget it, then add it again.</Step>
        </Steps>
        <Note title="If it drops during a ride">{APP_SHORT_NAME} keeps reaching for it by itself, and the ride keeps recording with what it has. A trainer that returns is given its target again.</Note>
      </>
    ),
  },
  {
    id: 'fix-trainer-busy', topic: 'fix', title: 'The trainer says another app is connected', summary: 'A trainer gives control to one app at a time.',
    related: ['trainer', 'fix-bluetooth'],
    body: () => (
      <>
        <p class="h-lead">The trainer's numbers show, but {APP_SHORT_NAME} cannot set its resistance. Another app has control.</p>
        <Steps>
          <Step title="Find the other app">A training app or the trainer maker's own app: on a computer, phone, tablet, bike computer or TV box, perhaps in another room.</Step>
          <Step title="Close it completely">Or turn Bluetooth off on that device for the ride.</Step>
          <Step title={`${tap()} the trainer box and choose the trainer again`}>The box says when {APP_SHORT_NAME} has control.</Step>
          <Step title="Still not?">Switch the trainer off and on, then connect {APP_SHORT_NAME} first.</Step>
        </Steps>
        <Note kind="tip">You can still ride meanwhile. The ride records the trainer's numbers and you set the effort yourself.</Note>
      </>
    ),
  },
  {
    id: 'fix-garmin-key', topic: 'fix', title: 'The Garmin key is refused, has run out, or is asked for again', summary: 'What each means, and what to do.', thumb: 'garmin-key',
    related: ['garmin-key', 'check'],
    body: () => (
      <>
        <Facts items={[
          { title: 'Refused', text: 'Copy the key again from Garmin Connect, whole, with no space before or after. Still refused: make a new key there.' },
          { title: 'Run out', text: 'A key can carry an end date. Make a new one in Garmin Connect and enter it.' },
          { title: 'Asked for again', text: 'A key is readable only by the copy of the app that saved it. A reinstalled app, a new device or a new version of the app\'s signature means entering it once more.' },
        ]} />
        <Shot name="garmin-key" alt="The Garmin key page" />
        <Note kind="tip">Keep the key where you can copy it again, such as a password manager if you use one.</Note>
      </>
    ),
  },
  {
    id: 'fix-intervals', topic: 'fix', title: 'Intervals.icu is not syncing', summary: 'Find out why, then put it right.', thumb: 'settings-intervals',
    related: ['connect-intervals', 'check', 'sending'],
    body: () => (
      <>
        <Steps>
          <Step title="Read what it says">Today, under Sync, says when the last sync was and why it failed. <A to="check">Check my setup</A> asks Intervals.icu now.</Step>
          <Step title="Run the connection checks" shot="settings-intervals" alt="Settings, Intervals.icu">Settings, Intervals.icu, <b>Run connection checks</b> says which part fails.</Step>
          <Step title="Check the ID and key">The athlete ID starts with the letter i. If you made a new API key in Intervals.icu, the old one stopped working: paste the new one and press Connect.</Step>
          <Step title="Check the internet connection, then press Sync" />
        </Steps>
        <Note title="An activity is missing, but the sync worked">Activities reach Intervals.icu a few minutes after your device's own app has them. Older ones: Settings, History.</Note>
        <Note title="A session did not reach your device">Open the session and use <b>Not on your device?</b> on its page.</Note>
      </>
    ),
  },
  {
    id: 'fix-ai-key', topic: 'fix', title: "The coach's AI key is refused", summary: 'Usually the wrong provider, or billing.',
    related: ['coach', 'check'],
    body: () => (
      <>
        <Steps>
          <Step title="Press Test">Settings, Coach, <b>Test</b> shows the provider's answer or refusal in its own words.</Step>
          <Step title="Check the provider matches the key">A key from one provider is refused by another.</Step>
          <Step title="Copy the key again">Whole, with no space before or after.</Step>
          <Step title="Check your account with the provider">Most other refusals are billing: no payment method, no credit left, or a spending limit reached.</Step>
          <Step title="Check the model">If you typed a model name of your own, go back to <b>Most capable</b>.</Step>
        </Steps>
        <Note>Without a working key the rest of {APP_SHORT_NAME} carries on. The plan still checks itself every day.</Note>
      </>
    ),
  },
  {
    id: 'fix-restore', topic: 'fix', title: 'A backup will not restore, or restored the wrong thing', summary: 'What each message and result means.', thumb: 'restore',
    related: ['backup', 'devices'],
    body: () => (
      <>
        <Facts items={[
          { title: '"This is not a backup file this app can read"', text: `The file was not made by Back up everything. Backups are named ${BACKUP_FILE_PREFIX}-backup- and the date.` },
          { title: 'The file is greyed out', text: `It may not be downloaded to ${thisDevice()} yet. Open your cloud storage app, let it download, and choose it again.` },
          { title: 'The data is old', text: 'A backup holds what the device had when it was made. The question before a restore shows that date.' },
          { title: `${APP_SHORT_NAME} asks about your other devices`, text: 'It found your saved copy. Keep in step combines the two and keeps the newer of each thing.' },
          { title: 'Nothing changed', text: 'On a device in step, a restore replaces nothing newer. To go back on purpose, use Put everything back as it was.' },
          { title: 'I want to undo Put everything back', text: 'Use it again with a backup made just before. This is why it asks you to make one first.' },
        ]} />
      </>
    ),
  },
  {
    id: 'fix-in-step', topic: 'fix', title: 'My devices disagree', summary: 'See how each stands, then sync.', thumb: 'settings-devices',
    related: ['devices', 'check'],
    body: () => (
      <>
        <Steps>
          <Step title="See how each device stands" shot="settings-devices" alt="Settings: Across your devices, and backup">It says In step, Separate, or that a choice is needed. Only a device in step receives changes.</Step>
          <Step title="Press Sync now on each">The one with the newer data first.</Step>
          <Step title="Does one ask for a passphrase?">Your saved copy is encrypted. Until that device has the passphrase, it neither sends nor receives.</Step>
          <Step title="Check they use the same Intervals.icu account" />
        </Steps>
        <Note title="Activities differ">Activities do not travel in the saved copy. Press Sync on Today on the device that is behind.</Note>
        <Note title="Readiness differs first thing in the morning">One device looked before your watch's maker had finished the night's numbers. Press Sync a few minutes later.</Note>
      </>
    ),
  },
  {
    id: 'trouble', topic: 'fix', title: 'Something else looks wrong', summary: 'Other things that puzzle people, and their answers.', detail: 'trouble',
    related: ['check', 'contact'],
    body: () => (
      <>
        <p class="h-lead">Start with <A to="check">Check my setup</A>: it finds most connection problems and says how to fix each.</p>
        <p>The answers to other common puzzles are under All the detail, below. If none fits, see <A to="contact">Get help</A>.</p>
      </>
    ),
  },

  // ---- On the home page, not in a topic ------------------------------------------------------------------------------
  {
    id: 'check', topic: 'tools', title: 'Check my setup', summary: 'Test each connection you have made.', thumb: 'check',
    related: ['fix-bluetooth', 'fix-intervals', 'contact'],
    body: () => (
      <>
        <p class="h-lead">One button tries each connection and reads how {thisDevice()} stands. It changes nothing and spends nothing.</p>
        <CheckSetup />
      </>
    ),
  },
  {
    id: 'new', topic: 'tools', title: "What's new", summary: 'What changed, newest first.',
    body: () => <NewsList entries={WHATS_NEW} />,
  },
  {
    id: 'contact', topic: 'tools', title: 'Get help', summary: 'A report to send when you ask someone.',
    related: ['check', 'trouble'],
    body: () => (
      <>
        <p class="h-lead">A support address for {APP_SHORT_NAME} is not set up yet. This is a test version: ask the person who gave it to you, and send them a report.</p>
        <Facts items={[
          { title: 'It holds', text: 'The version, the kind of device, and what Check my setup found.' },
          { title: 'It never holds', text: 'Your keys, account names, or any training or health number.' },
          { title: 'Nothing is sent', text: 'You read it, change it if you like, and copy it yourself.' },
        ]} />
        <GetHelp />
      </>
    ),
  },
];

/**
 * Older names for Help's sections, from before it was pages: every "?" in the app and every link still leads somewhere.
 */
export const OLD_NAMES: Record<string, string> = {
  setup: 'connect-intervals', firstweek: 'first-week', player: 'riding',
  'guide-start': 'start', 'guide-trainer': 'trainer', 'guide-devices': 'devices', 'fix-new-device': 'new-device',
};
export const articleFor = (id: string | null | undefined): Article | undefined => (id ? ARTICLES.find((a) => a.id === (OLD_NAMES[id] ?? id)) : undefined);
