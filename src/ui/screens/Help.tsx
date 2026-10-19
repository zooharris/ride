import { APP_NAME } from '../../appName';

/**
 * The manual: one section per screen, then the numbers the app shows and
 * what they mean, then backup, the coach and troubleshooting. Written for
 * someone opening the app for the first time, in plain words.
 */
const SECTIONS: Array<{ id: string; title: string; body: preact.JSX.Element }> = [
  {
    id: 'start', title: 'Getting started', body: (
      <>
        <p>{APP_NAME} plans your training, sends each ride to your bike computer, and reads back what you did. It runs entirely in your browser; your data lives on your devices and is kept in step between them through your own Intervals.icu account.</p>
        <ol>
          <li><b>Connect Intervals.icu</b> (Settings). Intervals.icu is the pipe between the app and Garmin: workouts you send go to Intervals.icu, which Garmin Connect picks up and puts on your Edge; rides you record flow back the same way. Your athlete ID and API key are on the Intervals.icu website under Settings → Developer. The app never sends them anywhere but Intervals.icu.</li>
          <li><b>Check your numbers</b> (Settings). FTP, threshold heart rate, max heart rate and weight are pulled from Intervals.icu when you connect. Every zone and every TSS depends on them, so correct them if they are stale; the app pushes changes back so the two stay in step.</li>
          <li><b>Sync</b> (Today). Pulls your activities and wellness (sleep, HRV, resting heart rate, from whatever you record them with). Do this before building a plan so the planner has something to assess.</li>
          <li><b>Plan my training</b> (the Plan tab). Give it a goal, your hours for each day of the week, your equipment and any standing commitments. It assesses your own data and decides what each day should be. Put it on the calendar when you like what you see.</li>
          <li><b>Send the week</b> (Calendar). One tap sends every ride for the week to your Garmin. Ride it from the Edge's Training menu, sync as usual, then tap Sync here to see how it went.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'today', title: 'Today', body: (
      <>
        <p>The day's plan and how ready you are for it. On the phone, Settings and Help are the two icons in the header; on a laptop they sit at the bottom of the left rail.</p>
        <ul>
          <li><b>The main card</b> is today's ride with its profile, duration and training load, and the Send to Garmin button. Strength, mobility and walks for the day sit under "Also today"; tap one for the exercises and to log it.</li>
          <li><b>Next up</b> shows the next scheduled session when today is a rest day.</li>
          <li><b>Readiness</b> blends HRV, sleep, resting heart rate and form against your own recent normal into one score with a sentence of advice. Hover any part for what it means. It needs wellness data in Intervals.icu; without it the score falls back to form alone. Under it, <b>Your note about today</b> is where you tell the coach what the numbers cannot: a late glass of wine, travel, a cold coming on. The coach reads your notes before the numbers and keeps three months of them in mind, so a cause that keeps coming up gets noticed. The switch beneath the note is for nights the watch was not measuring you at all (sleep mode off, on the nightstand): it drops that day's HRV, sleep and resting heart rate from the score and from every average the planner uses. Notes sync to your other devices with everything else.</li>
          <li><b>Fitness</b> is the last three months of fitness, fatigue and form (explained under Numbers below). Hover for any day.</li>
          <li><b>The plan card</b> re-checks the plan every day after a sync: what you did last week against what was planned, and any changes the planner would now make. Nothing changes until you tap Apply.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'calendar', title: 'Calendar', body: (
      <>
        <ul>
          <li><b>List or Calendar</b> view, remembered between visits. The list shows two weeks with each day's sessions and the week's planned and completed load; the calendar shows a month.</li>
          <li><b>+ Add</b> on any future day puts a ride, strength session, mobility routine or walk on it from the library, or lets you build one.</li>
          <li><b>Send N to Garmin</b> sends every unsent session in the week. Rides go as cycling workouts with power or heart-rate steps; walks as walking workouts with the heart-rate target (and the pack weight in the notes); strength sessions as step-by-step strength workouts (the watch names each exercise with its reps and load, each set ends when you press lap, each rest counts down); mobility as timed stretching routines (each hold counts down, a step a side). Garmin cannot take exercises as such from outside, so there is no rep counting or animation; the session page shows exactly what the watch will show. Start a sent session from the watch's Training menu; the recording comes back through Intervals.icu and is matched to the session. A session done without the watch can still be logged by hand on its page. Sessions show "not sent", "on Garmin" or "done".</li>
          <li><b>⋯</b> on any session: replace it with another workout of any kind (a longer ride for a free Saturday, a ride instead of the strength session when the weather is too good), move it to another day, or remove it (after a confirmation). Anything on the Garmin comes off it; send the new one when ready. A plan session you change stays changed; the daily re-check may suggest something for that day, which you accept or ignore.</li>
          <li><b>Plan my training</b> opens the planner (its own tab; also here for convenience).</li>
        </ul>
      </>
    ),
  },
  {
    id: 'plan', title: 'Plan', body: (
      <>
        <p>The planner does not apply a template. It assesses your own rides and wellness (fitness, ramp rate, longest ride, how you recover after long rides, hard rides and strength, whether your FTP looks current), works out what the goal demands, and then fits sessions into the hours you give it.</p>
        <ul>
          <li><b>Goal</b>: an event with a date (century, gran fondo, climb, race, group ride), or raise FTP, build endurance, lose weight, or general fitness. For an event the planner estimates what it will cost and the fitness you need on the day.</li>
          <li><b>Your week</b>: for each day, the hours you have; where you can ride (Outdoors shapes rides for the road or trail, Indoors for the trainer, No bike means no ride that day though strength, a walk or mobility can still go there); and a commitment. Leave the commitment on "App decides" unless the day is truly fixed: "Always strength", "Always a ride", "Always a walk", "Always mobility" or "Always rest" are kept every week, and the plan arranges everything else around them. Also your equipment (bench, dumbbells, bands, treadmill, somewhere to walk). For every other day the planner decides ride, strength, mobility, walk or rest.</li>
          <li><b>Masters rider</b> starts the recovery rhythm at every third week and caps the fitness ramp. Your own data moves both: good recovery evidence loosens them, poor evidence tightens them.</li>
          <li><b>The result</b> shows a verdict (on track, close, short), the fitness projection, a list of decisions in plain sentences, and every week with every session and the reason for it. Nothing is placed on the calendar until you tap "Put on calendar".</li>
          <li><b>Your plans</b>: every plan you have placed, with its name and dates. Plans follow one another and never overlap; a new one that would collide is refused with the clash explained. <b>Print</b> opens the plan as a US Letter landscape sheet, calendar or list layout, up to 16 weeks a page, and the browser's print dialog can save it as a PDF.</li>
          <li><b>Re-check</b> compares last week's plan to what happened and regenerates from today. Each proposed change is a tick box: changes to sessions the plan made are ticked, suggestions for sessions you changed yourself are not; untick anything you want left alone, then Apply. <b>Cancel plan</b> removes only future, undone sessions the plan created; anything you added or changed by hand stays.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'library', title: 'Library and New workout', body: (
      <>
        <ul>
          <li><b>Rides</b>: eighty-odd workouts by family (recovery, endurance, tempo, sweet spot, threshold, VO2max, anaerobic, tests), from thirty minutes to six hours, each with its purpose, the physiology behind it, and the steps. "Power or HR" means it can be sent on either basis; VO2max and above are power only, because heart rate lags too much for short efforts. Filter by length, search by name or purpose, and sort by type or duration.</li>
          <li><b>The names</b>: every ride is named for a place, so you can talk about "Oatlands" the way you would a route. The rule: it is where you would turn around on an out-and-back from Old Town Herndon at that ride's intensity. Outdoor-shaped rides go west on the W&OD into Loudoun (long rides named for the trail towns, interval rides for the roads off the trail); core rides go east toward Washington; indoor rides take the loops near home. The descriptive name ("Sweet Spot 3 × 12") is always shown underneath, and goes to the Garmin with the place name. Tests keep their plain names.</li>
          <li><b>Strength, Mobility, Walks</b>: ready-made sessions built for your equipment, the same ones the planner uses, plus themed sessions. Each names the exercises or stretches, sets, reps, holds and why. "Add to a date" puts one on the calendar.</li>
          <li><b>New workout</b> asks what kind of session, then opens the builder for it: steps and intervals for a ride; exercises for your equipment with sets, reps and load for strength; stretches and hold times for mobility; minutes, pack weight and heart-rate target for a walk. Every builder shows the estimated TSS as you edit. A low of 0 means no minimum: the step or walk is "up to" its ceiling, so a recovery session can be as easy as you like. Every ride in the recovery family works that way already. Garmin needs a range with two ends, so a no-minimum target reaches the device with a floor nothing moving falls under (about 30 bpm or 20 W). Saved sessions appear under "My …" at the top of each tab and can be edited or deleted.</li>
          <li><b>Copy and edit</b> on any library workout makes your own version.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'activities', title: 'Activities', body: (
      <>
        <p>Everything Intervals.icu has recorded, however it got there: rides from the Edge, walks from a watch, strength sessions logged here. List or month view.</p>
        <ul>
          <li><b>Against plan</b>: a ride done from a planned workout gets a verdict (nailed it, done, partial, over-cooked, missed) with the reason, and an interval-by-interval table of target against ridden.</li>
          <li><b>Route</b>: the GPS track on a map; start in green, finish in red.</li>
          <li><b>The recording</b>: power, heart rate, cadence, speed, elevation and temperature through the activity, by time or by distance. Move the mouse over any chart to read every value at that point; the marker on the map follows, and moving along the route moves the charts.</li>
          <li><b>Time in zone</b> and <b>Numbers</b>, each with a line saying what it means.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'numbers', title: 'The numbers, explained', body: (
      <>
        <dl class="defs">
          <dt>TSS, training load</dt><dd>How much a session cost. An hour flat out at FTP is 100. Rides compute it from power (or heart rate); strength, mobility and walks are estimated from duration and effort, and when you log one with an effort rating the logged figure replaces the estimate.</dd>
          <dt>FTP</dt><dd>Functional threshold power: the highest power you can hold for about an hour. Every power zone is a share of it.</dd>
          <dt>LTHR</dt><dd>Lactate threshold heart rate: the heart rate that goes with FTP. Heart-rate zones are shares of it; walks use shares of max heart rate instead.</dd>
          <dt>Normalized power</dt><dd>What a ride felt like in steady watts; surges count more than coasting.</dd>
          <dt>Intensity factor</dt><dd>Normalized power over FTP. 0.70 is endurance, 1.00 is threshold.</dd>
          <dt>Fitness</dt><dd>A 42-day weighted average of daily TSS. It rises slowly with consistent training and is what the goal needs on the day.</dd>
          <dt>Fatigue</dt><dd>A 7-day weighted average of daily TSS. It rises fast after hard days and falls fast with rest.</dd>
          <dt>Form</dt><dd>Fitness minus fatigue. Fitness can only rise while fatigue is above it, so form is negative through any build: −10 to −30 is the productive "building" band, below −30 is overreaching and a rest week is due, −10 to +5 is neutral (recovery weeks), and +5 to +25 is fresh, where you want to be on an event day but not for long. The charts shade these bands.</dd>
          <dt>Ramp rate</dt><dd>How many fitness points a week you are adding. The planner caps it (4 a week for a masters rider, more with evidence you recover well).</dd>
          <dt>Efficiency factor</dt><dd>Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving.</dd>
          <dt>Heart-rate drift (decoupling)</dt><dd>How much heart rate rose for the same power in the second half of a ride. Under 5% on a long ride is a sign of a good aerobic base.</dd>
          <dt>Readiness</dt><dd>HRV (40%), sleep (30%), resting heart rate (15%) and form (15%), each compared with your own two-week baseline. Green is better than your normal, red worse.</dd>
          <dt>Effort (RPE)</dt><dd>How hard a session felt, 1–10. Used when you log strength and to estimate its TSS.</dd>
        </dl>
      </>
    ),
  },
  {
    id: 'settings', title: 'Settings, backup and other devices', body: (
      <>
        <ul>
          <li><b>Intervals.icu</b>: athlete ID and API key, and a connection test that tries each call the app makes and reports what passed.</li>
          <li><b>Your numbers</b>: FTP, LTHR, max and resting heart rate, weight, units, power or heart rate as the default basis for sending workouts, and which day your week starts on (Monday or Sunday) for the calendar, the lists, the plan and the printout. Garmin accepts one target type per workout, so each one is sent on one basis.</li>
          <li><b>Across your devices</b>: your plans, calendar, workouts, day notes and settings are kept in step between every phone and browser signed in to the same Intervals.icu account, through a private note in that account (31 Dec 2099, named "App backup"). Your API keys never go into the note: each device keeps its own, so on a new device you paste the Intervals.icu key (and the Claude key, if you use one) once. The note can be <b>encrypted</b> (Settings, "Encryption of the note"): you choose a passphrase, which stays in your browser, and a question whose answer gets you back in if you forget it. Intervals.icu then holds only the scrambled copy. Each other device asks once for the passphrase or the answer; until it has one, it neither receives nor sends changes, and nothing is lost. Each device merges with the note when the app opens, comes back to the front, syncs, and a few seconds after any change; the newest change to each item wins and deletions carry across, so a plan made on the laptop is on the phone the next time you open it. A new device: connect Intervals.icu and everything else arrives. "Sync now" in Settings runs a merge on demand; "Replace this device with the note" is the heavy option if a merge has gone wrong. You can also download a backup file and restore from a file.</li>
          <li><b>Someone else's data</b> never mixes with yours: each device merges only with the Intervals.icu account it is connected to.</li>
          <li><b>Giving the app to someone else</b>: they open the same address and connect their own Intervals.icu account. Each install holds only its own person's data; nothing is shared.</li>
          <li><b>Coach</b>: optionally, an Anthropic API key lets the app ask Claude for a short daily note and, if you turn it on, a review each time new activities arrive. The review can recommend plan changes but never makes them; you apply or dismiss. Both the daily note and the review see everything on today's calendar, whether the plan put it there or you did, and read your day notes first.</li>
          <li><b>On a phone</b>: open the address in Safari (iPhone) or Chrome (Android), use Share → Add to Home Screen, and it runs as an app, offline included.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'trouble', title: 'If something looks wrong', body: (
      <>
        <ul>
          <li><b>A workout did not reach the Edge</b>: it must show "on Garmin" here; then Garmin Connect has to sync it to the device (open the Connect app, or sync the Edge over Wi-Fi). Intervals.icu must be connected to Garmin under its own Settings.</li>
          <li><b>A ride is missing</b>: tap Sync. Rides arrive in Intervals.icu a few minutes after Garmin Connect has them.</li>
          <li><b>A session shows twice after you did it</b>: the planned entry and its recording should merge into one row marked done, with the recorded time, load and heart rate and a Recording link. Sync pairs them by the Garmin's own pairing, then by the day and kind, then by the day and name (the watch names the recording after the workout). A treadmill walk the watch files as a run is treated as a walk when its pace is walking pace. If a session still shows twice, the names or dates differ; open the recording and check the date Intervals.icu gave it.</li>
          <li><b>TSS does not match Intervals.icu</b>: check the FTP the ride used (shown under Numbers on the activity). The app and Intervals.icu share the same FTP when the app pushes yours; if they differ, fix it in Settings.</li>
          <li><b>The planner's verdict says "short"</b>: it is honest about what the hours allow. Give it more hours on the long-ride day, move the goal, or accept a hard day; the advice under the verdict says which would help most.</li>
          <li><b>Data gone after clearing the browser</b>: connect Intervals.icu again and the note brings everything back; or restore from a backup file.</li>
          <li><b>Phone and laptop disagree</b>: open Settings on each and tap Sync now; the newest change to each item wins. If something is still wrong, "Replace this device with the note" on the device that is behind.</li>
        </ul>
      </>
    ),
  },
];

export function Help() {
  return (
    <div>
      <div class="page-head"><h1>Help</h1></div>
      <div class="help">
        <nav class="help-toc panel">
          {SECTIONS.map((s) => <a key={s.id} href={`#/help?s=${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{s.title}</a>)}
        </nav>
        <div class="help-body">
          {SECTIONS.map((s) => (
            <section class="section" id={`help-${s.id}`} key={s.id}>
              <h2>{s.title}</h2>
              <div class="prose">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The first-run checklist on Today: ticks itself as each step gets done. */
export function GettingStarted({ connected, synced, planned, sent, reviewed, onDismiss }: { connected: boolean; synced: boolean; planned: boolean; sent: boolean; reviewed: boolean; onDismiss: () => void }) {
  const steps: Array<[boolean, string, string, string]> = [
    [connected, 'Connect Intervals.icu', 'Settings', '#/settings'],
    [synced, 'Sync your activities and wellness', 'Today', '#/today'],
    [planned, 'Plan my training and put it on the calendar', 'Plan', '#/plan'],
    [sent, 'Send the week to your Garmin', 'Calendar', '#/calendar'],
    [reviewed, 'Ride, sync, and open the activity', 'Activities', '#/rides'],
  ];
  const done = steps.filter(([ok]) => ok).length;
  return (
    <section class="panel accent" style="margin-bottom:14px">
      <div class="row between"><b>Getting started · {done} of {steps.length}</b><button class="btn sm quiet" onClick={onDismiss}>Dismiss</button></div>
      <ol class="checklist" style="margin:10px 0 0">
        {steps.map(([ok, text, where, href]) => <li key={text} class={ok ? 'done' : ''}><span class="tick">{ok ? '✓' : ''}</span><span>{text}</span>{!ok && <a href={href} class="faint small">{where} ›</a>}</li>)}
      </ol>
      <p class="faint small" style="margin:10px 0 0">The <a href="#/help">Help</a> page explains every screen and every number.</p>
    </section>
  );
}
