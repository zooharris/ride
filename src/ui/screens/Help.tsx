import { APP_NAME } from '../../appName';
import { PageHead } from '../PageHead';

/**
 * The manual, written for someone opening the app for the first time: what it
 * is and what you need, setting it up step by step, the first week, then one
 * section per screen, the numbers explained, and what to do when something
 * looks wrong. Keep it in step with the app: a screen that changes changes here.
 */
const SECTIONS: Array<{ id: string; title: string; body: preact.JSX.Element }> = [
  {
    id: 'overview', title: 'What it does, and what you need', body: (
      <>
        <p>{APP_NAME} is a training coach for road cycling, with strength, mobility and walking alongside the riding. It looks at your own rides, sleep and heart-rate data, builds a plan around the hours you have, sends each session to your Garmin, reads back what you actually did, and adjusts the plan as you go.</p>
        <p>It runs in your web browser, on a laptop or a phone, and can be installed on a phone's home screen like any other app. There is no account to create with {APP_NAME} and no server: your data lives on your own devices and in your own Intervals.icu account.</p>
        <p><b>You need:</b></p>
        <ul>
          <li><b>A free Intervals.icu account.</b> Intervals.icu is the link between the app and Garmin. Garmin does not let individual apps talk to its devices directly, so sessions go from {APP_NAME} to Intervals.icu, which sends them to Garmin Connect and on to your device; your recordings come back the same way.</li>
          <li><b>A Garmin bike computer or watch</b> connected to Garmin Connect, ideally one that records heart rate overnight (for sleep and HRV) and a power meter on the bike. Neither is essential: heart rate alone works for planning and scoring, and without overnight data the readiness score falls back to fitness and fatigue.</li>
          <li><b>Optionally, an Anthropic API key</b> if you want a written daily note and reviews from Claude. The app does everything else without it.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'setup', title: 'Setting it up, step by step', body: (
      <>
        <ol>
          <li><b>Make an Intervals.icu account</b> at intervals.icu (free). The quickest way is to sign up with Garmin.</li>
          <li><b>Connect Garmin inside Intervals.icu.</b> In Intervals.icu, open Settings and connect Garmin, letting it import your activities and wellness (sleep, HRV, resting heart rate). Then tick <b>Upload planned workouts</b> on the same page and approve it in Garmin Connect. That one tick is what lets sessions from this app reach your device. If you use an Oura ring or Strava, connect them there as well. Give it a little while to bring in your history.</li>
          <li><b>Check your numbers in Intervals.icu.</b> Your FTP and threshold heart rate should be set in its cycling sport settings. If they are blank, set your best estimate; the app keeps them in step from then on.</li>
          <li><b>Get your athlete ID and API key.</b> Still in Intervals.icu Settings, scroll to the Developer section. Your athlete ID is shown there (it starts with i), and a button makes an API key. Copy both.</li>
          <li><b>Open {APP_NAME}</b> at its web address. The first screen asks for the athlete ID and API key; paste them and press Connect. (The same screen has a short version of these steps under "New to Intervals.icu?".) The key stays on this device and is only ever sent to Intervals.icu.</li>
          <li><b>Check your numbers</b> on the next screen: name, FTP, threshold heart rate, max heart rate, weight, power or heart rate, miles or kilometres. They came from Intervals.icu; correct anything out of date. Press Start.</li>
          <li><b>The first sync</b> runs by itself and brings in the last 120 days of activities and wellness. After that, press <b>Sync</b> on Today whenever you have ridden; every later sync brings the last two weeks, which catches late uploads and edits.</li>
          <li><b>Load older history</b> (optional, recommended): Settings → History → Back one year (or two). This fills the long ranges on Progress and gives a power curve and fitness number built on your whole record.</li>
          <li><b>Install it on your phone</b>: open the same address in Safari on an iPhone (or Chrome on Android), tap Share → Add to Home Screen. Connect it with the same athlete ID and an API key (paste it once; keys are never copied between devices). Your plans, calendar and notes arrive by themselves; see Settings below.</li>
          <li><b>Set up your watch for strength and mobility</b> (only if you will do those with the watch). Garmin shows the text of each step only in a bike activity, so for now these sessions are sent as rides. On the watch, make a copy of the <b>Indoor Bike</b> activity profile, name it (for example "{APP_NAME}"), and give it one data screen with heart rate, laps, lap time, timer and heart-rate zone. Start strength and mobility sessions from that profile; press lap at the end of each set. The app recognises the recording by its name and files it as the strength or mobility session it was.</li>
          <li><b>Add the coach</b> (optional): get an API key from console.anthropic.com and paste it in Settings → Coach.</li>
        </ol>
        <p>Today shows a <b>Getting started</b> checklist that ticks itself off as you go: connect, sync, plan, send, ride and review.</p>
      </>
    ),
  },
  {
    id: 'firstweek', title: 'Your first week', body: (
      <ol>
        <li><b>Make a plan</b> (Plan). Choose a goal (an event on a date, a higher FTP, longer rides, weight, or general fitness), give the hours you have on each day of the week, where you can ride each day, and your equipment. Press <b>Plan my training</b>, read the result, and press <b>Put it on the calendar</b> when you like it. Nothing reaches the calendar before that.</li>
        <li><b>Send the week</b> (Calendar). <b>Send N to Garmin</b> on the week's heading sends every session not yet sent. Garmin Connect passes them to your device on its next sync; on an Edge they are under Training → Workouts, on a watch under the activity's training menu as today's workout.</li>
        <li><b>Do the session</b> from the device as usual. Ride the steps; the device shows the targets and beeps at each change.</li>
        <li><b>Sync</b> (Today) after the recording has reached Garmin Connect. The recording is matched to the planned session, which turns into one row marked Done with what you recorded.</li>
        <li><b>Look at it</b> (Activities). A ride done from a plan gets a verdict (nailed it, done, partial, over-cooked) and an interval-by-interval comparison.</li>
        <li><b>Let the plan adjust.</b> Each day after a sync the plan re-checks itself against what you did and what your body says, and offers changes as tick boxes on Today. Nothing changes until you press Apply.</li>
      </ol>
    ),
  },
  {
    id: 'today', title: 'Today', body: (
      <>
        <p>The app always opens here. On a phone, Settings and Help are the two icons at the top; on a laptop they are at the bottom of the left-hand menu.</p>
        <ul>
          <li><b>The week strip</b> across the top is this week, a cell per day. Each coloured bar is a session (blue ride, pink strength, amber walk, green mobility); taller is longer, faint means still to do, solid means done, striped means missed. Today is outlined in orange. Under it, the week's training load done against planned, sessions done, and hours. Tap a day to open that week on the Calendar.</li>
          <li><b>Today's session</b>: the workout's shape (each block coloured by zone), its length and load, and <b>Send to Garmin</b> (or Send again). <b>Steps and targets</b> opens the step table right here, with every target in watts or heart rate; <b>Details</b> opens the workout's page; the <b>⋯</b> button replaces, moves or removes it. Strength, mobility and walks for the day are listed under it; tap one for the exercises and to log it if you did it without the watch.</li>
          <li><b>Next up</b> is the next session on the calendar.</li>
          <li><b>Readiness</b> is a score out of 100 on a dial, with what it means in words (Ready, Ease off a little, Keep it easy, Rest) and a sentence of advice written for whatever is on today's calendar. Under the dial, HRV, sleep, resting heart rate and form each show this morning's value, a line of the last two weeks, and how today compares with your two-week normal (green better, red worse). It needs overnight data in Intervals.icu; without it the score is built from form alone.</li>
          <li><b>Your note about today</b> (under readiness) tells the coach what the numbers cannot: a late glass of wine, travel, a cold coming on. The coach reads your notes before the numbers and keeps three months of them in mind. The tick box under the note is only for nights the watch was not measuring you at all (sleep mode off, left on the nightstand): it leaves that day's HRV, sleep and resting heart rate out of the score and out of every average the planner uses. Real numbers with a reason behind them stay in; just write the note.</li>
          <li><b>Fitness</b>: today's fitness, fatigue and form with their change over the last seven days, and the chart, with a 6-week to 1-year range (remembered). The dashed lines carry fitness and form forward over what is on your calendar, to the plan's end; today and your event are marked.</li>
          <li><b>The plan card</b> names the plan in force and the days to your event. After each sync it reviews last week (done, cut short, missed) and lists the changes it would now make, each with a tick box. Changes to sessions the plan made are ticked; suggestions touching sessions you changed or added yourself are not. Untick anything you want left alone, then Apply.</li>
          <li><b>Coach</b>: if a Claude key is set, a short note on the day, and after a sync with new activities (if you turned that on) a review of them.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'calendar', title: 'Calendar', body: (
      <ul>
        <li><b>List or Calendar</b> view, remembered. The list shows two weeks; each week's heading shows hours and training load done against planned, and a small bar split by kind of session (solid done, faint still to do). The arrows move a week at a time; <b>This week</b> comes back.</li>
        <li><b>Every row</b> carries a mark at its left edge and a word at its right: a green tick for <b>Done</b> (the line under the name then shows what was recorded, not what was planned), an empty ring for <b>To do</b>, a ring with an arrow for <b>On Garmin</b>, a grey ring with a dash for <b>Missed</b>. A recording with no session behind it shows a tick and "unscheduled". The same marks appear on Today and in the month view.</li>
        <li><b>+ Add</b> on any day from today on puts a ride, strength session, mobility routine or walk on it from the library. On a laptop the Add button shows when you point at the day.</li>
        <li><b>⋯</b> on any session: <b>replace</b> it with another workout of any kind (a longer ride on a free Saturday, a ride instead of strength when the weather is too good), <b>move</b> it to another day, or <b>remove</b> it (after a confirmation). Anything already on the Garmin comes off it; send the new one when you are ready. A plan session you change stays changed; the daily re-check may still suggest something for that day, which you accept or ignore.</li>
        <li><b>Send N to Garmin</b> sends every unsent session in the week. Rides go as cycling workouts with power or heart-rate steps. Walks go with a heart-rate target. Strength goes step by step: each step names the exercise with its reps and load, each set ends when you press lap, rests count down. Mobility goes as timed holds, a step a side. Strength and mobility are sent as rides for now, so start them from the bike profile you set up (see Setting it up, step 10). Garmin cannot take exercises from outside apps, so there is no rep counting or animation; the session's page shows exactly what the watch will show.</li>
        <li><b>The month view</b> shows each ride's workout shape and a coloured edge for other sessions; recovery weeks of your plan are lightly shaded, and on a laptop each row ends with the week's training load.</li>
      </ul>
    ),
  },
  {
    id: 'activities', title: 'Activities', body: (
      <>
        <p>Everything Intervals.icu has recorded, however it got there: rides from the Edge, walks and strength from a watch, sessions you logged here. List or month view.</p>
        <ul>
          <li><b>The list</b> is grouped by week, each week with its count, hours, training load and a bar split by kind. Each row shows the kind of session, the date and length, a small bar of its time in each zone, and its training load. A ride done from a plan has a coloured edge and a word for its verdict: <b>Nailed it</b> (green), <b>Done</b> (blue), <b>Partial</b> (amber), <b>Over-cooked</b> (orange), <b>Missed</b> (red).</li>
          <li><b>Against plan</b>, at the top of a planned ride: the verdict and the reason, and further down an interval-by-interval table of target against what you rode.</li>
          <li><b>The recording.</b> The map is at the top, with the route in teal, a green dot at the start and a red one at the finish. Under it are charts of power, heart rate, cadence, speed, elevation and temperature, by time or by distance. As you scroll, the map stays pinned under the page title and the charts move up beneath it, so any chart can sit right under the map. Move the mouse (or a finger) across any chart: the line under the map reads out every value at that point, and an orange marker on the map shows where you were. Moving along the route on the map moves the charts. On a planned ride the targets for each step are shaded on the power and heart-rate charts. Heart rate, cadence and speed fill their chart's height; power starts at zero, so coasting shows.</li>
          <li><b>Time in zone</b>: power zones and heart-rate zones side by side, each zone with its share of the ride and its time. Heart rate lags power, so short hard efforts show more in the power zones.</li>
          <li><b>Power distribution</b>: minutes spent in each 25-watt band, coloured by zone, with your FTP marked. A steady endurance ride is one tall hump; an interval session shows two.</li>
          <li><b>Laps and intervals</b>: the laps you pressed and the efforts Intervals.icu found. Each bar is the lap's average power (or heart rate, without power), coloured by its zone; the upright tick on every bar is your FTP (or threshold heart rate), and the figure beside it is the lap as a percentage of it. Labels like "Work" and "Recovery" are Intervals.icu's guess from the recording, so a lap called Recovery can still sit in zone 3.</li>
          <li><b>Numbers</b>: everything else about the activity, each with a line saying what it means.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'progress', title: 'Progress', body: (
      <>
        <p>The long view. The range at the top (6 weeks, 3 months, 6 months, a year, or everything) applies to every chart on the page and is remembered. If the range reaches past the history on this device, a line says so and links to Settings → History to load more. Hover any chart to read its values.</p>
        <dl class="defs">
          <dt>Fitness, fatigue and form</dt><dd>The same chart as on Today, over the chosen range, with the shaded form bands (fresh, neutral, building, overreaching) and the dashed lines carrying fitness and form forward over your calendar.</dd>
          <dt>Weekly training load</dt><dd>Training load done each week, stacked by kind of session (rides, strength, walks, mobility). The dashed outline behind each bar is what the calendar had planned for that week, so you can see at a glance which weeks fell short or ran over.</dd>
          <dt>Time in zone by week</dt><dd>Ride time in each zone, week by week, in hours or as shares (the switch at the top right). Most of it in zones 1–2 with a little at 4 and above is the "polarised" pattern most riders improve best on; a thick band of zone 3 is the "grey zone", hard enough to tire you but not hard enough to raise the ceiling.</dd>
          <dt>Power curve</dt><dd>Your best average power for every length of effort, from a 1-second sprint to two hours. The solid line is the best within the range; the dashed line the best of everything synced. FTP is marked. Where the solid line sits on the dashed one, you are as good now as you have been; a gap shows where you have lost (or not yet tested) something. Hover for watts and watts per kilogram. The first time you open Progress it reads the power data of each ride from Intervals.icu, newest first, and says how far it has got; after that it is stored and instant.</dd>
          <dt>Aerobic fitness</dt><dd>Two charts on the same dates, for steady rides of an hour or more. <b>Efficiency factor</b> (watts per heartbeat) should rise as your aerobic base grows; <b>heart-rate drift</b> (how much your heart rate crept up in the second half for the same power) should fall, and under 5% on a long ride is a solid base. Dots are single rides; the line is the average of the last five.</dd>
          <dt>Wellness</dt><dd>HRV, resting heart rate and sleep, each morning's reading as a dot and the 7-day average as a line. Higher HRV and lower resting heart rate than your normal mean you are recovered. Days you marked as not real measurements are left out.</dd>
          <dt>Consistency</dt><dd>A year of days as a grid, darker for more training load; empty squares are rest days or days nothing was recorded. Beside it, how many weeks in a row you have trained and how many days you have been active this year.</dd>
          <dt>Totals by month</dt><dd>Hours, distance, climbing and number of sessions for each of the last twelve months. The current month is hatched because it is not over yet.</dd>
          <dt>Weight and power to weight</dt><dd>Body weight from your wellness data (dots, with the 7-day average), and your FTP divided by it in watts per kilogram, using the FTP on record each day. Shown only when weight is recorded.</dd>
        </dl>
      </>
    ),
  },
  {
    id: 'library', title: 'Library and New workout', body: (
      <ul>
        <li><b>Rides</b>: eighty-odd workouts by type (recovery, endurance, tempo, sweet spot, threshold, VO2max, anaerobic, tests), from thirty minutes to six hours. Each card shows its type, the workout's shape (each block coloured by zone; taller is harder), its name, what it is ("Sweet Spot 3 × 12"), and its length, training load and intensity. "Power or HR" means it can be sent on either; VO2max and above are power only, because heart rate lags too much for short efforts. Search, filter by type and length, and sort. On a laptop, pointing at a card shows <b>Ride today</b> and <b>Pick a date</b>; on a phone, open the card for both.</li>
        <li><b>The names</b>: every ride is named for a place, so you can talk about "Oatlands" the way you would a route. It is where you would turn around on an out-and-back from Old Town Herndon at that ride's intensity: outdoor-shaped rides go west on the W&OD into Loudoun (long rides named for the trail towns, interval rides for the roads off the trail), core rides go east toward Washington, indoor rides take the loops near home. The descriptive name always sits underneath and goes to the Garmin with the place name. Tests keep their plain names.</li>
        <li><b>Strength, Mobility, Walks</b>: ready-made sessions built for your equipment, the same ones the planner uses. Each names the exercises or stretches, sets, reps, holds and why. <b>Add to a date</b> puts one on the calendar.</li>
        <li><b>New workout</b> asks what kind of session, then opens the builder for it: steps and intervals for a ride; exercises for your equipment with sets, reps and load for strength; stretches and hold times for mobility; minutes, pack weight and a heart-rate target for a walk. Every builder shows the estimated training load as you edit. A low of 0 means no minimum, so a recovery session can be as easy as you like (Garmin needs two ends to a target, so it receives a floor nothing moving falls under). Saved sessions appear under "My …" at the top of each tab and can be edited or deleted. <b>Copy and edit</b> on any library workout makes your own version.</li>
      </ul>
    ),
  },
  {
    id: 'plan', title: 'Plan', body: (
      <>
        <p>The planner does not apply a template. It reads your own rides and wellness (fitness, how fast it is rising, your longest ride, how you recover after long rides, hard rides and strength, whether your FTP looks current), works out what the goal asks of you, and fits sessions into the hours you give it.</p>
        <ul>
          <li><b>What your data say</b>: the findings the plan is built on, each with a dot: green well supported, amber thin evidence, grey a guess with no data behind it yet. They firm up as rides and wellness come in.</li>
          <li><b>Goal</b>: an event with a date (century, gran fondo, climb, race, group ride), or raise FTP, ride longer comfortably, lose weight, or general fitness. For an event the planner estimates what the day will cost and the fitness you need for it.</li>
          <li><b>Your week</b>: for each day, the hours you have; where you can ride (Outdoors shapes rides for the road, Indoors for the trainer, No bike means no ride that day though strength, a walk or mobility can still go there); and a commitment. Leave the commitment on "App decides" unless the day really is fixed: "Always a ride", "Always strength", "Always a walk", "Always mobility" or "Always rest" are kept every week and everything else is arranged around them. Also your equipment. <b>Masters (more recovery)</b> starts with a recovery week every third week and a gentler climb in fitness; your own data loosens or tightens both.</li>
          <li><b>The result</b>: a verdict (on track, close, short) with advice; <b>the plan's shape</b>, a strip of weeks coloured by phase (base, build, peak, taper; short cells are recovery weeks; today marked; the event flagged); the fitness projection, with the fitness the goal needs as a dashed line; <b>weekly load</b>, the planned training load of every week as bars; the decisions in plain sentences; and every week with every session and the reason for it.</li>
          <li><b>Your plans</b>: every plan you have placed, with its dates, its shape, Re-check, Print and Cancel. Plans follow one another and never overlap. <b>Print</b> makes a US Letter landscape sheet (calendar or list) that the print dialog can save as a PDF. <b>Cancel plan</b> removes only future, undone sessions the plan created; anything you added or changed by hand stays.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'settings', title: 'Settings, other devices and backup', body: (
      <ul>
        <li><b>Appearance</b>: Dark, Light, or System (follows your phone or computer). Changes at once.</li>
        <li><b>Intervals.icu</b>: athlete ID and API key, and <b>Run connection checks</b>, which tries each thing the app does with Intervals.icu and reports what passed. FTP, threshold heart rate and max heart rate stay in step both ways: change them here and they go to Intervals.icu; change them there (or let Garmin detect a new FTP) and the next sync brings them here.</li>
        <li><b>History</b>: how far back this device's activities go, and buttons to load one or two years more, or from a date you choose. It loads in two-month pieces with a progress bar; you can keep using the app; if it stops part-way, what arrived is kept and pressing again carries on. Fitness and the charts count up to two years back.</li>
        <li><b>You</b>: name, FTP, threshold, max and resting heart rate, weight, hours a week, birth year, power or heart rate as the basis for workouts you send (Garmin takes one kind of target per workout), miles or kilometres, the day your week starts on, masters recovery, and the days you can ride. <b>Zones</b> lists your power and heart-rate zones from those numbers.</li>
        <li><b>Coach</b> (optional): an Anthropic API key lets the app ask Claude for a short note each day and, if you turn it on, a review each time new activities arrive. The coach reads everything on the day's calendar and your day notes first. It can recommend plan changes but never makes them; you apply or dismiss.</li>
        <li><b>Across your devices</b>: your plans, calendar, workouts, day notes and settings stay in step between every phone and browser connected to the same Intervals.icu account, through a private note in that account (on 31 December 2099, named "App backup"). Each device merges with it when the app opens, when it comes back to the front, after a sync, and a few seconds after any change; the newest change to each item wins and deletions carry across. Your API keys never go into the note: each device keeps its own. <b>Sync now</b> merges on demand.</li>
        <li><b>Encryption of the note</b>: choose a passphrase and a question whose answer gets you back in if you forget it; Intervals.icu then holds only a scrambled copy. Every other device asks once for the passphrase or the answer, and until it has one it neither sends nor receives changes (nothing is lost). You can change the passphrase or turn encryption off.</li>
        <li><b>Backup file</b>: save everything, keys included, to a file, and restore from one on any device.</li>
        <li><b>Giving the app to someone else</b>: they open the same address and connect their own Intervals.icu account. Each install holds only its own person's data; nothing mixes.</li>
      </ul>
    ),
  },
  {
    id: 'numbers', title: 'The numbers, explained', body: (
      <dl class="defs">
        <dt>TSS, training load</dt><dd>How much a session cost. An hour flat out at FTP is 100. Rides compute it from power (or heart rate); strength, mobility and walks are estimated from duration and effort, and a logged effort rating replaces the estimate.</dd>
        <dt>FTP</dt><dd>Functional threshold power: the highest power you can hold for about an hour. Every power zone is a share of it.</dd>
        <dt>LTHR, threshold heart rate</dt><dd>The heart rate that goes with FTP. Heart-rate zones are shares of it; walks use shares of max heart rate instead.</dd>
        <dt>Zones</dt><dd>Seven zones (1 recovery, 2 endurance, 3 tempo, 4 threshold, 5 VO2max, 6 anaerobic, 7 sprint), by power as shares of FTP and by heart rate as shares of threshold heart rate, always in the same colours: grey, blue, green, yellow, orange, red, purple. Intervals.icu may report heart-rate zones of its own on an activity; those are shown as it gives them.</dd>
        <dt>Normalized power</dt><dd>What a ride felt like in steady watts; surges count more than coasting.</dd>
        <dt>Intensity factor (IF)</dt><dd>Normalized power over FTP. 0.70 is endurance, 1.00 is threshold.</dd>
        <dt>Fitness</dt><dd>A 42-day weighted average of daily training load. It rises slowly with consistent training and is what a goal needs on the day.</dd>
        <dt>Fatigue</dt><dd>A 7-day weighted average of daily training load. It rises fast after hard days and falls fast with rest.</dd>
        <dt>Form</dt><dd>Fitness minus fatigue. Fitness only rises while fatigue is above it, so form is negative through any build: −10 to −30 is the productive "building" band, below −30 is overreaching and a rest week is due, −10 to +5 is neutral (recovery weeks), and +5 to +25 is fresh, where you want to be on an event day but not for long. The charts shade these bands.</dd>
        <dt>Ramp rate</dt><dd>How many fitness points a week you are adding. The planner caps it (4 a week for a masters rider, more with evidence you recover well).</dd>
        <dt>Power curve, W/kg</dt><dd>Your best average power held for each length of effort; watts per kilogram divides it by your weight, the fairer way to compare climbing ability.</dd>
        <dt>Efficiency factor</dt><dd>Normalized power per heartbeat. Rising over months on the same kind of ride means aerobic fitness is improving.</dd>
        <dt>Heart-rate drift</dt><dd>How much heart rate rose for the same power in the second half of a ride. Under 5% on a long ride is a sign of a good aerobic base.</dd>
        <dt>HRV</dt><dd>Heart-rate variability overnight, in milliseconds. Higher than your normal usually means recovered; lower means stress, fatigue or illness.</dd>
        <dt>Readiness</dt><dd>HRV (40%), sleep (30%), resting heart rate (15%) and form (15%), each against your own two-week normal, as a score out of 100: 75 and up Ready, 55–74 Ease off a little, 35–54 Keep it easy, under 35 Rest.</dd>
        <dt>Effort (RPE)</dt><dd>How hard a session felt, 1–10. Used when you log a session by hand and to estimate strength load.</dd>
      </dl>
    ),
  },
  {
    id: 'trouble', title: 'If something looks wrong', body: (
      <ul>
        <li><b>A workout did not reach the device</b>: it must show "On Garmin" here. Then Garmin Connect has to pass it on (open the Connect app, or let the Edge sync over Wi-Fi). In Intervals.icu Settings, Garmin must be connected with <b>Upload planned workouts</b> ticked.</li>
        <li><b>An activity is missing</b>: press Sync. Activities reach Intervals.icu a few minutes after Garmin Connect has them. Older than two weeks and never synced here? Load it with Settings → History.</li>
        <li><b>A session shows twice after you did it</b>: the planned session and its recording should become one row marked Done. Sync pairs them by Garmin's own link, then by day and name (the watch names the recording after the workout), then by day and kind. If it still shows twice, the names or dates differ; open the recording and check the date Intervals.icu gave it.</li>
        <li><b>Training load does not match Intervals.icu</b>: check the FTP the ride used (under Numbers on the activity). If the app and Intervals.icu disagree on FTP, correct it in Settings.</li>
        <li><b>The plan says "short"</b>: it is honest about what the hours allow. More hours on the long-ride day, a later goal, or accepting a hard day would help; the advice under the verdict says which helps most.</li>
        <li><b>Older history stops short</b> after Settings → History: the app can only load what Intervals.icu holds. Look at your Intervals.icu calendar for the missing months. If they are not there, Intervals.icu never had them: its Garmin link fetches at most a year from before you connected it, and <b>Import all Garmin Data</b> in its Garmin settings brings older years; then load again here. If they are there but marked as from Strava, Intervals.icu does not pass Strava-sourced activities to other apps; upload the files from Garmin instead.</li>
        <li><b>The map is blank</b>: the map needs an internet connection; the route still draws without one.</li>
        <li><b>The power curve stopped part-way</b>: it says why on the chart. Usually the connection dropped; it carries on the next time you open Progress.</li>
        <li><b>Phone and laptop disagree</b>: open Settings on each and press Sync now; the newest change to each item wins. A device asking for a passphrase is waiting to unlock the encrypted note.</li>
        <li><b>Everything gone after clearing the browser</b>: connect Intervals.icu again and the note brings your plans and calendar back; press Sync for activities; or restore a backup file.</li>
      </ul>
    ),
  },
];

export function Help() {
  return (
    <div>
      <PageHead title="Help" />
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
