import type { ComponentChildren, VNode } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { APP_NAME } from '../../appName';
import { PageHead } from '../PageHead';
import { GLOSSARY, NUMBERS_ORDER } from '../glossary';

/**
 * The manual, written for someone opening the app for the first time: what it
 * is and what you need, setting it up step by step, the first week, then one
 * section per screen, the coach, changing a plan, the numbers explained, and
 * what to do when something looks wrong. Keep it in step with the app: a
 * screen that changes changes here. Each screen's "?" opens its section
 * (#/help?s=<id>), and the search box filters every item on the page.
 */

/** The search text, lower-cased; empty when not searching. Items that do not contain it hide themselves. */
const Query = createContext('');

/** The plain text of a piece of JSX, for search. */
function textOf(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const v = node as VNode<{ children?: unknown; t?: string }>;
  return `${v.props?.t ?? ''} ${textOf(v.props?.children)}`;
}
const shows = (q: string, children: unknown, extra = '') => !q || `${extra} ${textOf(children)}`.toLowerCase().includes(q);

/** A list item that hides itself when it does not contain the search text. */
function Li({ children }: { children: ComponentChildren }) {
  return shows(useContext(Query), children) ? <li>{children}</li> : null;
}
/** A paragraph that hides itself when searching and it does not match. */
function P({ children }: { children: ComponentChildren }) {
  return shows(useContext(Query), children) ? <p>{children}</p> : null;
}
/** A term and its definition, shown or hidden together. */
function Def({ t, children }: { t: string; children: ComponentChildren }) {
  return shows(useContext(Query), children, t) ? <><dt>{t}</dt><dd>{children}</dd></> : null;
}
/** How many searchable items in a section body match. */
function matches(node: unknown, q: string): number {
  if (node == null || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce((n, x) => n + matches(x, q), 0);
  const v = node as VNode<{ children?: unknown; t?: string }>;
  if (v.type === Li || v.type === P || v.type === Def) return shows(q, v.props.children, v.props.t ?? '') ? 1 : 0;
  return matches(v.props?.children, q);
}

const SECTIONS: Array<{ id: string; title: string; body: preact.JSX.Element }> = [
  {
    id: 'overview', title: 'What it does, and what you need', body: (
      <>
        <P>{APP_NAME} is a training coach for road cycling, with strength, mobility and walking alongside the riding. It looks at your own rides, sleep and heart-rate data, builds a plan around the hours you have, sends each session to your Garmin, reads back what you actually did, and adjusts the plan as you go.</P>
        <P>It runs in your web browser, on a laptop or a phone, and can be installed on a phone's home screen like any other app. There is no account to create with {APP_NAME} and no server: your data lives on your own devices and in your own Intervals.icu account.</P>
        <P><b>You need:</b></P>
        <ul>
          <Li><b>A free Intervals.icu account.</b> Intervals.icu is the link between the app and Garmin. Garmin does not let individual apps talk to its devices directly, so sessions go from {APP_NAME} to Intervals.icu, which sends them to Garmin Connect and on to your device; your recordings come back the same way.</Li>
          <Li><b>A Garmin bike computer or watch</b> connected to Garmin Connect, ideally one that records heart rate overnight (for sleep and HRV) and a power meter on the bike. Neither is essential: heart rate alone works for planning and scoring, and without overnight data the readiness score falls back to fitness and fatigue.</Li>
          <Li><b>Optionally, an Anthropic API key</b> if you want a written daily note, reviews and answers from Claude. The app does everything else without it.</Li>
        </ul>
        <P>Every screen has a <b>?</b> at the top that opens this page at its own section; the search box above finds anything on the page.</P>
        <P>Green is the one thing a screen is for. A pale teal shows what is selected; red outline means something will be removed, and asks first.</P>
      </>
    ),
  },
  {
    id: 'setup', title: 'Setting it up, step by step', body: (
      <>
        <ol>
          <Li><b>Make an Intervals.icu account</b> at intervals.icu (free). The quickest way is to sign up with Garmin.</Li>
          <Li><b>Connect Garmin inside Intervals.icu.</b> In Intervals.icu, open Settings and connect Garmin, letting it import your activities and wellness (sleep, HRV, resting heart rate). Then tick <b>Upload planned workouts</b> on the same page and approve it in Garmin Connect. That one tick is what lets sessions from this app reach your device. If you use an Oura ring or Strava, connect them there as well. Give it a little while to bring in your history.</Li>
          <Li><b>Check your numbers in Intervals.icu.</b> Your FTP and threshold heart rate should be set in its cycling sport settings. If they are blank, set your best estimate; the app keeps them in step from then on.</Li>
          <Li><b>Get your athlete ID and API key.</b> Still in Intervals.icu Settings, scroll to the Developer section. Your athlete ID is shown there (it starts with i), and a button makes an API key. Copy both.</Li>
          <Li><b>Open {APP_NAME}</b> at its web address. The first screen asks for the athlete ID and API key; paste them and press Connect. (The same screen has a short version of these steps under "New to Intervals.icu?".) The key stays on this device and is only ever sent to Intervals.icu.</Li>
          <Li><b>Check your numbers</b> on the next screen: name, FTP, threshold heart rate, max heart rate, weight, the targets sent to Garmin (power or heart rate), miles or kilometres. They came from Intervals.icu; correct anything out of date. Press Start.</Li>
          <Li><b>The first sync</b> runs by itself and brings in the last 120 days of activities and wellness. After that, VeloIQ pulls your latest activities and overnight numbers from Intervals.icu when you open it and when you come back to it, if the last pull is more than ten minutes old; Today shows when that was, under the Sync button. Press <b>Sync</b> to pull now. Every pull brings the last two weeks, which catches late uploads and edits. Two devices show the same numbers once both have synced.</Li>
          <Li><b>Load older history</b> (optional, recommended): Settings → History → Back one year (or two). This fills the long ranges on Progress and gives a power curve and fitness number built on your whole record. Do it on one device; your others follow on their own.</Li>
          <Li><b>Install it on your phone</b>: open the same address in Safari on an iPhone (or Chrome on Android), tap Share → Add to Home Screen. Connect it with the same athlete ID and an API key (paste it once; keys are never copied between devices). Your plans, calendar and notes arrive by themselves; see Settings below.</Li>
          <Li><b>Set up your watch for strength and mobility</b> (only if you will do those with the watch). Garmin shows the text of each step only in a bike activity, so for now these sessions are sent as rides. On the watch, make a copy of the <b>Indoor Bike</b> activity profile, name it (for example "{APP_NAME}"), and give it one data screen with heart rate, laps, lap time, timer and heart-rate zone. Start strength and mobility sessions from that profile; press lap at the end of each set. The app recognises the recording by its name and files it as the strength or mobility session it was.</Li>
          <Li><b>Add the coach</b> (optional): get an API key from console.anthropic.com and paste it in Settings → Coach. See The coach, below.</Li>
        </ol>
        <P>Today shows a <b>Getting started</b> checklist that ticks itself off as you go: connect, sync, plan, send, ride and review.</P>
      </>
    ),
  },
  {
    id: 'firstweek', title: 'Your first week', body: (
      <ol>
        <Li><b>Make a plan</b> (Plan). Choose a goal (an event on a date, a higher FTP, a higher VO2max, longer rides, weight, or general fitness), give the hours you have on each day of the week, where you can ride each day, and your equipment. Press <b>Build the plan</b>, read the result, and press <b>Put it on the calendar</b> when you like it. Nothing reaches the calendar before that.</Li>
        <Li><b>Send the week</b> (Calendar). <b>Send N to Garmin</b> on the week's heading sends every session not yet sent. Garmin Connect passes them to your device on its next sync; on an Edge they are under Training → Workouts, on a watch under the activity's training menu as today's workout.</Li>
        <Li><b>Do the session</b> from the device as usual. Ride the steps; the device shows the targets and beeps at each change.</Li>
        <Li><b>Sync</b> (Today) after the recording has reached Garmin Connect. The recording is matched to the planned session, which turns into one row marked Done with what you recorded. A recording only counts if it lasted at least five minutes and a fifth of the planned time, so a watch button pressed by accident completes nothing.</Li>
        <Li><b>Look at it</b> (Activities). A ride done from a plan gets a verdict (nailed it, close to plan, partial, over-cooked) and an interval-by-interval comparison.</Li>
        <Li><b>Let the plan adjust.</b> Each day the plan checks itself against what you did and what your body says. When something should change, Today shows <b>N recommended changes</b> with a <b>Review</b> button; each has <b>Accept</b> and <b>Reject</b>, and there are <b>Accept all</b> and <b>Reject all</b>. With the coach on (Settings), the coach decides what is recommended and says why beside each change; the list appears once the coach has answered ("Checking your plan…", a few seconds). With the coach off, the app's own list appears with its reasons. Today lists the next two weeks; later changes are looked at as they come near unless something has happened that needs them now, such as fitness off the plan's line, a missed session or a big unplanned ride. A session moved to another day is one change, "moves here from Saturday", with any mobility that goes with it. The plan keeps the kind of hard session already on a day (threshold or sweet spot, say) unless what decides it has really moved. A change counts only when it matters: a different kind of session, or one more than 12% (rides) or 15% (other sessions) longer or shorter or harder or easier, and never less than 10 minutes or 8 TSS. It responds from the next day: after a big unplanned ride (a long Saturday, say) the next day becomes an easy spin and the rest of the week comes down to allow for the extra load; a missed session is not crammed into the days left. The plan's phases (base, build, recovery weeks) stay where they were set when you made it. Nothing changes until you accept. (Tick boxes with <b>Save</b> are only in Edit plan › Preview changes; see Changing your plan.)</Li>
      </ol>
    ),
  },
  {
    id: 'today', title: 'Today', body: (
      <>
        <P>The app always opens here. On a phone, Settings and Help are the two icons at the top; on a laptop they are at the bottom of the left-hand menu.</P>
        <ul>
          <Li><b>The week strip</b>: each coloured bar is a session (blue ride, pink strength, amber walk, green mobility); taller is longer, faint means still to do, solid means done, striped means missed; today is outlined in orange. Tap a day to open the Calendar at that day.</Li>
          <Li><b>Today's sessions</b>: every session on the day is on this page: the first ride as the big card, and the rest, other rides included, under Also today with their own ⋯ menu. With two rides on one day the card says Ride 1 of 2. <b>Steps and targets</b> opens the step table right here; the <b>⋯</b> button moves, replaces or removes a session. Tap any session for its page: strength, mobility and walks list their exercises there. Any session, a ride included, can be logged on its page if you did it without a device: you give the minutes and how hard it was (1 easy, 10 all-out), and that sets its training load.</Li>
          <Li><b>Exercise pictures</b>: Strength and mobility sessions show a picture of each exercise: where it starts and where it finishes. Tap a picture to see it larger with its cue. Today shows a strip of them under each strength or mobility session.</Li>
          <Li><b>Readiness</b> needs overnight data in Intervals.icu; without it the score is built from form alone. Until the morning's numbers have come through from your watch, the dial is grey and says <b>Waiting</b>: the score you see is from form alone and will change when they arrive. If one of the three is missing, the panel says which, and the score uses the others. Each row compares this morning with your two-week normal: green is better than normal, red worse. Form's row shows how far it sits from its own two-week average. Tap a row (or the dial) to see that metric over time on Progress.</Li>
          <Li><b>Your note about today</b> (under readiness) tells the coach what the numbers cannot: a late glass of wine, travel, a cold coming on. The coach reads your notes before the numbers, the last three months of them. The tick box under the note is only for nights the watch was not measuring you at all (sleep mode off, left on the nightstand): it leaves that day's HRV, sleep and resting heart rate out of the score and out of every average the planner uses. Real numbers with a reason behind them stay in; just write the note.</Li>
          <Li><b>Fitness</b>: the dashed lines carry fitness, fatigue and form forward over what is on your calendar, every session done as planned; today and your event are marked. The range you choose is remembered.</Li>
          <Li><b>The plan card</b> names the plan in force and the days to your event, and shows any recommended changes with <b>Review</b>; see Changing your plan.</Li>
          <Li><b>Coach</b>: the daily note, the review after a sync, and questions; see The coach.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'coach', title: 'The coach', body: (
      <>
        <P>The coach is Claude, reading your numbers. It is optional: with no key, every other part of the app works as it does with one. It recommends; it never changes the plan or the calendar.</P>
        <ul>
          <Li><b>What it knows about you</b>: your name, your age (from the birth year in Settings), whether you train on the masters rhythm, your units, hours, FTP and threshold heart rate; the plan you are on (its goal, this week's phase, the days to the event or the plan's end) and what is on tomorrow. Change any of these in Settings and the day's note is written again; save with nothing changed and it stays.</Li>
          <Li><b>It is not a doctor</b>: if your note or question mentions illness, chest pain, dizziness, fainting, an irregular heartbeat or an injury, it recommends rest and seeing a doctor, and nothing more for that day.</Li>
          <Li><b>The daily note</b> on Today: a few sentences on the day, written when you first open Today with a key set. It reads your readiness, fitness, fatigue and form, everything on today's calendar (done or not), your last activities, and your notes from the last three months, your own note first. It is written again when the day changes: a session done or moved, a recording arriving, a note saved, or the morning's wellness arriving and moving readiness. "Written at 7:42 AM; the day has changed since then" means a newer one is on its way. <b>Fresh note</b> asks for a new one now.</Li>
          <Li><b>The coach and your plan</b> (Settings → Coach → The coach reviews your new activities and decides which plan changes to recommend): each time a sync brings new activities, the coach reads them with last week, the evidence the plan is built on and your notes from the last two weeks, and writes a short review on Today. Whenever the plan finds something to change, the coach decides which changes are worth making: only those are shown, under <b>Recommended changes</b>, each with a few words of why. You still accept or reject each one yourself. <b>Dismiss</b> hides the review; <b>Try again</b> asks again if it failed.</Li>
          <Li><b>Questions</b>: the box under the note. The coach answers from the same picture as the note (today's numbers, the calendar, your notes, your last activities) and what it has already told you today. It cannot change the plan; when a change would help, it says what, and you make it on the calendar or accept it among the recommended changes. Today's conversation is kept until the day ends. A question that gets no answer (no connection, say) shows as a red "No answer" line, never as advice, and is not kept.</Li>
          <Li><b>Ask the coach about this chart</b> (Progress, under the fitness chart): a question about the lines on screen. The coach is sent each line's first, last, lowest and highest value over the range, with the sessions in it, and answers under the chart; the last answer for each set of lines is kept.</Li>
          <Li><b>The key</b>: an Anthropic API key from console.anthropic.com, pasted in Settings → Coach. It is your own key, stored only on this device; calls go straight from the app to Anthropic, nowhere else. A day's note, a review and a few questions usually cost a few cents; the Anthropic console shows exactly what you have spent.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'calendar', title: 'Calendar', body: (
      <ul>
        <Li><b>Month or List</b>: the Calendar always opens as the month; a day tapped in Today's week strip (or "Open the calendar" after adding a session) opens the list scrolled to that day, outlined for a moment. The switch at the top changes the view for that visit. The list shows two weeks; the arrows move a week at a time; <b>This week</b> comes back.</Li>
        <Li><b>Every row</b> carries a mark at its left edge and a word at its right: a green tick for <b>Done</b> (the line under the name then shows what was recorded, not what was planned), an empty ring for <b>To do</b>, a ring with an arrow for <b>On Garmin</b>, a grey ring with a dash for <b>Missed</b>. A recording with no session behind it shows a tick and "unscheduled". A session you moved says "moved by you from…" on the line under it.</Li>
        <Li><b>+ Add</b> on any day from today on puts a ride, strength session, mobility routine or walk on it from the library. On a laptop the Add button shows when you point at the day. A workout already on a day cannot be added to that day again; the app says so. A different workout can, and a done one can be added again.</Li>
        <Li><b>⋯</b> on any session not yet done (in the list, on Today, and on a day in the month view): <b>move</b> it with one tap to <b>Tomorrow</b> or one of the next few days, or to any date; <b>replace</b> it with another session of any kind (a longer ride on a free Saturday, a ride instead of strength when the weather is too good); the Replace list has the Library's search and filters, so a shorter ride is a length filter away; or <b>remove</b> it (after a confirmation). A session's own page has <b>Move</b>, <b>Replace</b> and <b>Remove from the calendar</b> too. A missed session moved to today or later is to do again.</Li>
        <Li><b>Drag and drop</b> with a mouse: drag a session onto another day, in the month or the list. The day outlines in green when it can take it; days already past cannot. Esc cancels. On a phone use <b>⋯</b>.</Li>
        <Li>After a move or a replacement, anything already on the Garmin comes off it; send the new one when you are ready. A plan session you move, replace or add stays as you left it: undoing it is never recommended. Only Edit plan › Preview changes lists such a change, unticked, so a rebuilt plan can take the day back if you tick it.</Li>
        <Li><b>Send N to Garmin</b> sends every unsent session in the week. Rides go as cycling workouts with power or heart-rate steps. Walks go with a heart-rate target. Strength goes step by step: each step names the exercise with its reps and load, each set ends when you press lap, rests count down. Mobility goes as timed holds, a step a side. Strength and mobility are sent as rides for now, so start them from the bike profile you set up (see Setting it up, step 10). Garmin cannot take exercises from outside apps, so there is no rep counting or animation; the session's page shows exactly what the watch will show. A session already sent has <b>Send again</b> on its page (and on Today): it replaces the copy on your Garmin with the current version.</Li>
        <Li><b>The month view</b> shows each ride's workout shape and a coloured edge for other sessions; recovery weeks of your plan are lightly shaded, and on a laptop each row ends with the week's training load.</Li>
      </ul>
    ),
  },
  {
    id: 'activities', title: 'Activities', body: (
      <>
        <P>Everything Intervals.icu has recorded, however it got there: rides from the Edge, walks and strength from a watch, sessions you logged here. Month or List.</P>
        <ul>
          <Li><b>Verdicts</b>: a ride done from a plan has a coloured edge and a word: <b>Nailed it</b> (green), <b>Close to plan</b> (blue), <b>Partial</b> (amber), <b>Over-cooked</b> (orange), <b>Missed</b> (red). A strength, mobility or walk session done from the plan shows <b>Done</b>.</Li>
          <Li><b>≈ before a training load</b> means it is estimated from the time alone: the activity has neither power nor heart rate.</Li>
          <Li><b>Not training</b>: a recording under five minutes (a watch button pressed by accident) or a "ride" at car speed counts 0 and is kept out of the list. A tick box at the top shows them; open one to delete it, or, if it really was a planned session, match it by hand on its page.</Li>
          <Li><b>The recording</b>: the map (green dot start, red finish) stays pinned while the charts scroll under it; move across any chart or along the route and the other follows, and on a planned ride the targets are shaded.</Li>
          <Li><b>Time in zone</b>: power zones and heart-rate zones side by side, with the zone key underneath. Heart rate lags power, so short hard efforts show more in the power zones. "12:48 of 30:38 with heart rate" means the strap only covered part of the activity.</Li>
          <Li><b>Laps and intervals</b>: each bar is the lap's average power (or heart rate, without power), coloured by its zone; the upright tick is your FTP (or threshold heart rate), and the figure beside it is the lap as a percentage of it. On a phone the bar gives way to a small square in the zone's colour at the start of the row, the same colours as Time in zone above it, so the table fits the screen. Labels like "Work" and "Recovery" are Intervals.icu's guess from the recording, so a lap called Recovery can still sit in zone 3.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'progress', title: 'Progress', body: (
      <>
        <P>The long view. The range at the top (6 weeks, 3 months, 6 months, a year, or everything) applies to every chart on the page and is remembered. If the range reaches past the history on this device, a line says so and links to Settings → History to load more. Tap or hover over any chart to read its values.</P>
        <dl class="defs">
          <Def t="Fitness, fatigue and form">The same chart as on Today, over the chosen range, with the shaded form bands (fresh, neutral, building, overreaching) and the dashed lines carrying all three forward over your calendar. The chips under it lay anything else over the same days: daily load (bars; planned load beyond today as dotted outlines), HRV, sleep, resting heart rate, weight, efficiency and drift. Fitness, fatigue and form share the left axis; every other line is drawn on its own scale, as a shape, and the readout that follows your pointer or finger gives its number for the day, with the day's sessions and what kind of morning it was. Up to six at once; a chip with too little data in the range is greyed. Tapping a readiness row or a fitness tile on Today opens this chart with that metric on. With the coach on, <b>Ask the coach about this chart</b> under it sends the coach exactly the lines on screen.</Def>
          <Def t="Weekly training load">Training load done each week, stacked by kind of session (rides, strength, walks, mobility). The dashed outline behind each bar is what the calendar had planned for that week, so you can see at a glance which weeks fell short or ran over.</Def>
          <Def t="Time in zone by week">Ride time in each zone, week by week, in hours or as shares (the switch at the top right), with the zone key underneath. Most of it in zones 1–2 with a little at 4 and above is the "polarised" pattern most riders improve best on; a thick band of zone 3 is the "grey zone", hard enough to tire you but not hard enough to raise the ceiling.</Def>
          <Def t="Power curve">Your best average power for every length of effort, from a 1-second sprint to two hours. The solid line is the best within the range; the dashed line the best of everything synced. FTP is marked. Where the solid line sits on the dashed one, you are as good now as you have been; a gap shows where you have lost (or not yet tested) something. Tap or hover for watts and watts per kilogram. The first time you open Progress it reads the power data of each ride from Intervals.icu, newest first, and says how far it has got; after that it is stored and instant.</Def>
          <Def t="Aerobic fitness">Two charts on the same dates, for steady rides of an hour or more. <b>Efficiency factor</b> (watts per heartbeat) should rise as your aerobic base grows; <b>heart-rate drift</b> (how much your heart rate crept up in the second half for the same power) should fall, and under 5% on a long ride is a solid base. Dots are single rides; the line is the average of the last five.</Def>
          <Def t="Wellness">HRV, resting heart rate and sleep, each morning's reading as a dot and the 7-day average as a line. Higher HRV and lower resting heart rate than your normal mean you are recovered. Days you marked as not real measurements are left out.</Def>
          <Def t="The morning after">HRV, resting heart rate and sleep on the mornings after a hard ride, a long ride, strength and a rest day, each against your normal for the range, with how many mornings each row rests on. Green is better than normal, red worse; grey rows rest on fewer than six mornings. The planner uses the same evidence when it spaces hard days.</Def>
          <Def t="Consistency">A year of days as a grid (on a phone, the most recent weeks that fit the screen), darker for more training load; empty squares are rest days or days nothing was recorded. Beside it, your training streak in weeks and how many days you have been active this year.</Def>
          <Def t="Totals by month">Hours, distance, climbing and number of sessions for each of the last twelve months. The current month is hatched because it is not over yet.</Def>
          <Def t="Weight and power to weight">Body weight from your wellness data (dots, with the 7-day average), and your FTP divided by it in watts per kilogram, using the FTP on record each day. Shown only when weight is recorded.</Def>
        </dl>
      </>
    ),
  },
  {
    id: 'library', title: 'Library and New workout', body: (
      <ul>
        <Li><b>Rides</b>: ninety-odd workouts by type (recovery, endurance, tempo, sweet spot, threshold, VO2max, anaerobic, tests), from thirty minutes to six hours. Each card shows its type, the workout's shape (each block coloured by zone; taller is harder), its name, what it is ("Sweet Spot 3 × 12"), and its length, training load and intensity. "Power or HR" means it can be sent on either; VO2max and above are power only, because heart rate lags too much for short efforts (the few marked "by heart rate" have efforts long enough for it). Search, filter by type and length, and sort. On a laptop, pointing at a card shows <b>Ride today</b> and <b>Pick a date</b>; on a phone, open the card for both. Move the pointer across a ride's diagram (or press and slide on a phone, on a ride's page) to see each step's time, share of FTP, watts and heart rate.</Li>
        <Li><b>The names</b>: every ride is named for a place, so you can talk about "Oatlands" the way you would a route. It is where you would turn around on an out-and-back from Old Town Herndon at that ride's intensity: outdoor-shaped rides go west on the W&OD into Loudoun (long rides named for the trail towns, interval rides for the roads off the trail), core rides go east toward Washington, indoor rides take the loops near home. The descriptive name always sits underneath and goes to the Garmin with the place name. Tests keep their plain names.</Li>
        <Li><b>Strength, Mobility, Walks</b>: ready-made sessions built for your equipment, the same ones the planner uses, plus sessions for a purpose: kettlebell sessions (with a kettlebell), heavy legs, a hotel room, upper back, balance, hip power and the aero position; stretching before the long ride, after the trainer, for feet and ankles, a long Sunday routine and a five-minute reset; recovery strolls, hill walks, a ruck and brisk walks. Each names the exercises or stretches, sets, reps, holds and why. <b>Add to a date</b> puts one on the calendar.</Li>
        <Li><b>Exercise pictures</b>: Strength and mobility sessions show a picture of each exercise: where it starts and where it finishes. Tap a picture to see it larger with its cue. The Library's strength and mobility cards show the first few, the builder shows one beside each exercise, and so does the record of what you did.</Li>
        <Li><b>Plans are built from the library.</b> The plan decides what each day needs from your data (the kind of session, how long, how far into the block), then picks the library workout closest to it, always: it never makes a new one, so everything on your calendar can be found here, added again or swapped by name. When the closest is a poor fit (more than a quarter longer, shorter, harder or easier than the plan wanted), the plan's decisions say so; adding a workout of that kind and length to the library is the fix, and the plan will use it. Your own saved workouts are offered alongside the library's. Strength is the exception: the plan builds it, because its exercises rotate week by week.</Li>
        <Li><b>Walks are easy on purpose.</b> The plan's walks, and most in the library, have no minimum heart rate and a ceiling at the top of zone 2 on your foot table. A walk on the flat, however brisk and whatever the pack, rarely gets a trained cyclist's heart rate into zone 2: the legs, hips and back do real work while the heart rate drifts up slowly and may stay in zone 1 the whole way. That is the walk done right, and its estimated load says so. For a walk that really is zone 2, pick a Zone 2, Brisk, Hill or Incline walk: speed (4 mph or more) or a grade gets the heart rate up, far more than a heavier pack. Long walks (1:15, 1:30, 2:00) are there for a day with the time, and the plan uses them when you give a no-bike day that many hours.</Li>
        <Li><b>Runs</b>: easy, long, strides, tempo, hills, fartlek, a progression run and run-walk for starting out, each a list of steps with a heart-rate band, sent to the Garmin as a running workout. Runs go by heart rate: each band is a zone on your foot table (Settings), so it reads in beats per minute from your own numbers and follows them if they change; with a threshold run pace in Settings, each band also shows the pace it implies, as a guide only. The plan places only easy runs and strides; tempo and hills are for you to add.</Li>
        <Li><b>New workout</b> asks what kind of session, then opens the builder for it: steps and intervals for a ride; exercises for your equipment with sets, reps and load for strength; stretches and hold times for mobility; minutes, pack weight and a heart-rate band for a walk (a zone on your foot table: Easy, the default, Recovery, Zone 2, Brisk, or any low and high end you choose); steps with a heart-rate band, repeats and recoveries for a run. Every builder shows the estimated training load as you edit, and has Reset and Cancel. "No minimum" as the low end means a recovery session can be as easy as you like (Garmin needs two ends to a target, so it receives a floor nothing moving falls under). Saved sessions appear under "My …" at the top of each tab and can be edited or deleted; deleting one takes it off the calendar too, and off your Garmin where it was sent. <b>Copy and edit</b> on any library workout makes your own version.</Li>
      </ul>
    ),
  },
  {
    id: 'player', title: 'Riding with a trainer', body: (
      <>
        <P>VeloIQ can talk to a smart trainer and your sensors over Bluetooth, to ride a workout indoors. <b>Ride indoors on the trainer</b> is on Today's ride and on every ride's page (on a laptop, <b>Ride it now</b> also shows when you point at a Library card). The ride player opens across the whole window: get your trainer and sensors ready, press <b>Start ride</b>, and the trainer holds each step's power for you while the ride is recorded. Riding by heart rate arrives with a later update; for now the player rides by power.</P>
        <ul>
          <Li><b>Which browsers</b>: Chrome or Edge on a computer (Mac, Windows or Chromebook). On an iPad, the free Bluefy browser adds the Bluetooth that Safari lacks. Safari, Firefox and every iPhone browser can't reach Bluetooth, so the player explains that and goes no further.</Li>
          <Li><b>Pairing</b>: on the ride screen, <b>Connect trainer</b> (the first time) or <b>Add a device</b>, and choose what it is: smart trainer, power meter, heart rate, or a speed or cadence sensor. The browser lists the devices nearby that are that kind; pick yours. Wake each one first (pedal a few strokes; put the heart-rate strap on). A Garmin watch can be your heart-rate monitor: on the watch, turn on Broadcast heart rate (in its heart-rate settings) and it shows up under Heart rate. One of each kind at a time; adding another trainer replaces the first.</Li>
          <Li><b>Next time</b>: this computer remembers what you paired (Settings, Ride player). Where the browser allows, they reconnect on their own when you open the ride screen; where it doesn't, each waits with a <b>Connect</b> button, one click each. <b>Manage</b> lists them, with Connect and Forget.</Li>
          <Li><b>Which sensor gives which number</b>: power comes from a power meter if you have one, otherwise from the trainer; cadence from the power meter, then a cadence sensor, then the trainer; speed from the trainer, then a speed sensor; heart rate from the strap or watch. <b>Ready to ride</b> shows each of the four numbers once, live, with the device it comes from underneath; the trainer has its own line saying whether it controls the resistance. <b>All set</b> at the top means the ride can be played; otherwise the panel says what is missing.</Li>
          <Li><b>KICKR ROLLR</b>: the ROLLR has no power meter of its own. It uses your bike's, once you've linked them in the Wahoo app (Power Meter Connect, once). Then add the ROLLR as your smart trainer: its power is your power meter's, and it holds the workout's targets against it. If it's not linked, the player notices (speed but no power) and says so.</Li>
          <Li><b>Practice</b>: turn on <b>Practice with a simulated trainer</b> in Settings, Ride player. The ride screen's Add a device then also offers a simulated trainer, power meter and heart rate, and a simulated rider pedals for you.</Li>
          <Li><b>How the ride runs</b>: with a smart trainer in control, choose <b>Holds targets (ERG)</b> (the trainer sets the resistance so you produce each step's watts, whatever gear you are in), <b>Set resistance</b> (a road of a fixed steepness, levels 0 to 10, and you ride to the targets yourself) or <b>Free ride</b> (a flat road). <b>Workout intensity</b> scales every target, from 50% to 150%; you can change it, and the trainer mode, during the ride. Without trainer control (rollers, a basic trainer, a power meter only) you ride to the targets with your gears.</Li>
          <Li><b>Riding</b>: a three-second countdown, then the big number is your power (averaged over three seconds; Settings changes it) against the step's target band: green inside it. The dial counts down the step, with what comes next; three beeps sound before each change. The chart shows the whole workout with your power drawn over the targets and your heart rate beneath. <b>Skip this step</b> moves on. Keys on a laptop: Space pauses, + and − change the intensity, L marks a lap, F goes full screen, E ends the ride. The screen stays awake while you ride; keep the tab in front, because a browser slows tabs in the background.</Li>
          <Li><b>Pausing</b>: <b>Pause</b> stops the clock and lets the trainer go. If you stop pedalling for ten seconds the ride pauses by itself, and carries on when you pedal. In ERG, if your cadence sinks under 50 rpm for three seconds the trainer eases to half the target and builds back once you are over 70 rpm, so a heavy stroke never stalls you. Both can be switched off in Settings.</Li>
          <Li><b>When the workout ends</b>: the dial says so and the ride keeps recording until you press <b>End ride</b>. The summary shows the totals, the ride over its plan, each effort's power, time on target and heart rate, and a sentence on how your heart rate moved across equal efforts. Tell it how hard it felt (optional), then <b>Save to Intervals.icu</b>: the ride is uploaded, comes back like any recording, and goes on that day's calendar as a done workout: the session you started it from if it was planned for that day, otherwise a new entry. A session planned for another day stays where it is, still to do. A ride you added counts as extra training load, and the plan takes it into account when it next checks itself. <b>Download the ride file</b> gives you the file to keep or to import into Garmin Connect yourself.</Li>
          <Li><b>Nothing is lost</b>: the ride is saved on this computer every few seconds. If the upload fails (no connection), the ride waits and goes up the next time the app opens; Today says so, with <b>Try now</b>. If the browser closes in the middle of a ride, Today offers <b>Save it</b> for the part you rode.</Li>
          <Li><b>If the list of devices is empty</b>: on a Mac, Chrome (or Edge) needs permission to use Bluetooth: System Settings, Privacy and Security, Bluetooth, and switch it on for the browser. Check the sensor is awake and not connected to another app or phone. <b>If the trainer says another app is connected</b>: close Zwift, the Wahoo app or TrainerRoad (on the computer, a phone or a tablet), then press Forget and add it again. A sensor that drops out is reconnected automatically every few seconds.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'plan', title: 'Plan', body: (
      <>
        <P>The planner does not apply a template. It reads your own rides and wellness (fitness, how fast it is rising, your longest ride, how you recover after long rides, hard rides and strength, whether your FTP looks current), works out what the goal asks of you, and fits sessions into the hours you give it.</P>
        <ul>
          <Li><b>What your data say</b>: the findings the plan is built on, each with a dot: green well supported, amber thin evidence, grey a guess with no data behind it yet. They firm up as rides and wellness come in.</Li>
          <Li><b>Build a new plan</b>: with a plan under way, the form for a new one is folded away under this button.</Li>
          <Li><b>Goal</b>: an event with a date (century, gran fondo, climb, race, group ride), or raise FTP, raise VO2max, ride longer comfortably, lose weight, or general fitness. For an event the planner estimates what the day will cost and the fitness you need for it.</Li>
          <Li><b>Your week</b>: for each day, the hours you have; where you can ride (Outdoors shapes rides for the road, Indoors for the trainer, No bike means no ride that day though strength, a walk or mobility can still go there); and a commitment. Leave the commitment on "App decides" unless the day really is fixed: "Always a ride", "Always strength", "Always a walk", "Always a run", "Always mobility" or "Always rest" are kept every week and everything else is arranged around them. Under each day, <b>Never</b> keeps a kind off that day (a run never on Tuesday, strength never on Saturday); "Always" wins if both are set. Above the days, <b>The app may schedule</b> turns whole kinds on or off: strength, walks, runs, mobility (rides are always on). With Runs on, runs take the days a ride cannot use, easy and by heart rate, never the day before a hard ride or the day after the long one; at most two a week in base, one when the riding gets hard, none in the last week before an event. Also your equipment: dumbbells, a kettlebell, a bench, bands, a barbell, a pull-up bar, dip bars, or bodyweight only. Strength days cover the seven movement patterns (squat, lunge, hinge, push, pull, carry, rotate), choosing the gym version of an exercise when you have the equipment (back squat, barbell deadlift, pull-ups, dips) and the home version when you do not. <b>Masters (more recovery)</b> starts with a recovery week every third week and a gentler climb in fitness; your own data loosens or tightens both.</Li>
          <Li><b>Build the plan</b> shows the result: a verdict (on track, close, short) with advice; the fitness projection, with the fitness the goal needs as a dashed line; <b>weekly load</b>, the planned training load of every week as bars coloured by phase (base, build, peak, taper; the lower weeks are recovery weeks; today marked; the event flagged), and hovering a week names it; the decisions in plain sentences; and every week with every session and the reason for it. <b>Put it on the calendar</b> places it.</Li>
          <Li><b>Your plans</b>: every plan you have placed, with its dates and its shape. Plans follow one another and never overlap. <b>Print</b> makes a US Letter landscape sheet (calendar or list) that the print dialog can save as a PDF; it marks ✓ done and ✗ missed.</Li>
          <Li><b>Opening a plan</b>: tap its name here, or the plan line on Today. The plan's page shows its weekly load as it stands on your calendar now, your fitness against where the plan expected it, and every week's sessions with why each is there.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'changing', title: 'Changing your plan', body: (
      <ul>
        <Li><b>Recommended changes</b> (Today and the plan's page): the count of changes recommended to your plan, with <b>Review</b>. Each change has <b>Accept</b> and <b>Reject</b>; <b>Accept all</b> and <b>Reject all</b> take them together. A rejected change is not offered again. A session you moved, replaced or added yourself is never among them. With the coach on, these are the changes the coach recommends, each with its reason; with it off, the plan's own.</Li>
        <Li><b>Re-check the plan</b> (Plan): runs the same check on demand and lists the changes there, with the same Accept and Reject.</Li>
        <Li><b>Edit plan</b> (on the plan's page): change your week (hours, where you ride, commitments, equipment), the recovery rhythm, time away, the end date or event date and the target, and the start date of a plan that has not begun. The goal itself stays: a different goal is a new plan. <b>Preview changes</b> lists every session that would change, each with a tick box; untick any you want left alone, and <b>Save</b>. Only sessions still to come change: done sessions stay, and anything you added or changed by hand is offered, never replaced unasked. Unticked changes are declined and not suggested again. A changed session that was already on your Garmin comes off it; send the week again from the calendar.</Li>
        <Li><b>Time away</b>: travel or a busy stretch you know about, set when you build a plan or later in Edit plan. Nothing is planned on those days, and a week mostly away is kept light instead of crammed into the days left. Removing a stretch can be undone for a few seconds.</Li>
        <Li><b>Rename</b> (Plan, or the plan's page) opens a small sheet with the name.</Li>
        <Li><b>Cancel plan</b> removes only future, undone sessions the plan created, from the calendar, Intervals.icu and your Garmin; sessions already done, and anything you added or changed by hand, stay.</Li>
      </ul>
    ),
  },
  {
    id: 'settings', title: 'Settings, other devices and backup', body: (
      <ul>
        <Li><b>Appearance</b>: Dark, Light, or System (follows your phone or computer). Changes at once.</Li>
        <Li><b>Intervals.icu</b>: athlete ID and API key, and <b>Run connection checks</b>, which tries each thing the app does with Intervals.icu and reports what passed. FTP, threshold heart rates, max heart rate and the zone tables stay in step both ways: change them here and Save sends them to Intervals.icu; change them there and the next sync brings them here. <b>Disconnect</b> asks first, then removes the ID and key from this device.</Li>
        <Li><b>History</b>: how far back this device's activities go, and buttons to load one or two years more, or from a date you choose. It loads in two-month pieces with a progress bar; you can keep using the app; if it stops part-way, what arrived is kept and pressing again carries on. Fitness and the charts count up to two years back. Your devices keep the same history: load it on one, and each of the others loads back to the same date by itself the next time it opens (a short note says when it has), so they all show the same fitness, readiness and recommended changes.</Li>
        <Li><b>You</b>: name, resting heart rate, weight, hours a week, birth year, the targets sent to Garmin (power or heart rate; Garmin takes one kind of target per workout), miles or kilometres, the day your week starts on, masters recovery, and the days you can ride.</Li>
        <Li><b>Thresholds and zones</b>: your numbers, in two parts. <b>On the bike</b>: FTP, threshold heart rate, max heart rate, a power zone table and a heart-rate zone table. <b>On foot</b>: a threshold heart rate for runs and walks, usually a few beats above the bike's, the optional threshold run pace, and its own heart-rate table. Each table has a switch: enter the tops as shares of the threshold (% of FTP, % of threshold heart rate), and they move when the threshold changes; or enter them as watts or beats per minute, and they stay where you put them. The table always shows both. Save sends all of it to Intervals.icu, which uses the numbers for every workout it passes to your Garmin and for how it files your recordings; set the same zones on the Garmin itself once, since it keeps its own copy. "Back to standard shares" returns a table to the usual shares of threshold. Workouts in the library are written as shares of FTP, step by step; the zone tables are what turns a step into watts and into beats, so every workout shows both, whichever the Garmin is told to hold.</Li>
        <Li><b>Coach</b> (optional): the Anthropic API key, and whether to review new activities after each sync. See The coach.</Li>
        <Li><b>Across your devices</b>: your plans, calendar, workouts, day notes and settings stay in step between every phone and browser connected to the same Intervals.icu account, through a private note in that account (on 31 December 2099, named "App backup"). Each device merges with it when the app opens, when it comes back to the front, after a sync, and a few seconds after any change; the newest change to each item wins and deletions carry across. Your API keys never go into the note: each device keeps its own. <b>Sync now</b> merges on demand.</Li>
        <Li><b>Encryption of the note</b>: choose a passphrase and a question whose answer gets you back in if you forget it; Intervals.icu then holds only a scrambled copy. Every other device asks once for the passphrase or the answer, and until it has one it neither sends nor receives changes (nothing is lost). You can change the passphrase or turn encryption off.</Li>
        <Li><b>Backup file</b>: save everything, keys included, to a file, and restore from one on any device. Restoring reloads the app.</Li>
        <Li><b>Giving the app to someone else</b>: they open the same address and connect their own Intervals.icu account. Each install holds only its own person's data; nothing mixes.</Li>
      </ul>
    ),
  },
  {
    id: 'numbers', title: 'The numbers, explained', body: (
      <dl class="defs">
        {NUMBERS_ORDER.map((k) => <Def key={k} t={GLOSSARY[k].term}>{GLOSSARY[k].long}</Def>)}
      </dl>
    ),
  },
  {
    id: 'trouble', title: 'If something looks wrong', body: (
      <ul>
        <Li><b>A workout did not reach the device</b>: it must show "On Garmin" here. Then Garmin Connect has to pass it on (open the Connect app, or let the Edge sync over Wi-Fi). In Intervals.icu Settings, Garmin must be connected with <b>Upload planned workouts</b> ticked.</Li>
        <Li><b>An activity is missing</b>: press Sync. Activities reach Intervals.icu a few minutes after Garmin Connect has them. Older than two weeks and never synced here? Load it with Settings → History. Under five minutes? It is kept out of the list as not training; tick the box at the top of Activities to see it.</Li>
        <Li><b>A session was marked done by the wrong recording</b> (an extra workout the same day, with the planned one still to come): open the session (it opens the recording) and press <b>This was a different workout</b> in the box at the top. The session goes back to to-do (missed if its day has passed), the recording stays as a separate activity and still counts toward your training load, and the app never matches that recording to the session again. If the app had changed the recording's type in Intervals.icu when it matched it, the original type is put back.</Li>
        <Li><b>Editing an activity</b>: on a recording's page. <b>Was this a planned session?</b> (for a recording not matched to anything) matches it by hand to a session within a week either side, for one done on another day or that the watch named oddly; the session is marked done with it, and This was a different workout undoes it. <b>What you did</b> and the effort rating work for unplanned strength, mobility and walks too (start from an empty list and add the exercises); their weights count for "Last time". <b>About this activity</b>: rename it (in Intervals.icu too); correct <b>What it was</b> when the device filed it wrongly, which re-works the load and corrects the type in Intervals.icu; and <b>Leave out of training load</b> for something that happened but should not count, which keeps it in your history at 0 load. Those last two save at once and can be undone for a few seconds. These edits sync to your other devices.</Li>
        <Li><b>Deleting an activity</b> (an accidental recording, a duplicate): open it and press <b>Delete this activity</b> at the bottom. It is deleted from Intervals.icu and from the app, after you confirm; a planned session it had completed goes back to to-do. Garmin Connect keeps its own copy, so delete it there too if you want it gone everywhere. An activity deleted directly in Intervals.icu disappears from the app on the next Sync.</Li>
        <Li><b>What you did</b>: a done strength, mobility or walk session opens its recording, and under the result is the record of what you did: the planned exercises, sets and reps, assumed done as planned. <b>Edit</b> changes any of it: swap an exercise for another from the list, change sets, reps, weight or hold time, mark one skipped, add one you did. Weights you enter show as "Last time" on the next session with that exercise, and go to the Garmin in the step text ("last 35 lb"). The rating of how hard it was sets a strength session's training load (heart rate under-reads lifting). The record is also written into the activity's description in Intervals.icu, but only when that description is empty, so your own notes are never overwritten. A session you logged by hand has the same record on its page, with <b>Undo: not done yet</b>.</Li>
        <Li><b>Updates</b>: when a new version is published, a banner asks you to reload. One press of Reload fetches the very newest version and switches to it. The app looks for updates when it opens, every 15 minutes, and whenever you come back to it; Settings shows when your version was built and has Check for updates.</Li>
        <Li><b>A session shows twice after you did it</b>: the planned session and its recording should become one row marked Done. Sync pairs them by Garmin's own link, then by day and name (the watch names the recording after the workout), then by day and kind, the closest in length first. If it still shows twice, the names or dates differ; open the recording and check the date Intervals.icu gave it, or match it by hand.</Li>
        <Li><b>Training load does not match Intervals.icu</b>: check the FTP the ride used (under Numbers on the activity). If the app and Intervals.icu disagree on FTP, correct it in Settings. A ride with heart rate but no power is scored by heart-rate zone, which can differ from Intervals.icu's own heart-rate load.</Li>
        <Li><b>The plan says "short"</b>: it is honest about what the hours allow. More hours on the long-ride day, a later goal, or accepting a hard day would help; the advice under the verdict says which helps most.</Li>
        <Li><b>Older history stops short</b> after Settings → History: the app can only load what Intervals.icu holds. Look at your Intervals.icu calendar for the missing months. If they are not there, Intervals.icu never had them: its Garmin link fetches at most a year from before you connected it, and <b>Import all Garmin Data</b> in its Garmin settings brings older years; then load again here. If they are there but marked as from Strava, Intervals.icu does not pass Strava-sourced activities to other apps; upload the files from Garmin instead.</Li>
        <Li><b>The map is blank</b>: the map needs an internet connection; the route still draws without one.</Li>
        <Li><b>The power curve stopped part-way</b>: it says why on the chart. Usually the connection dropped; it carries on the next time you open Progress.</Li>
        <Li><b>Phone and laptop disagree</b>: check <b>Last synced</b> under the Sync button on Today on each; the one with the older time has not yet pulled the latest numbers, so press Sync there. For plans and the calendar, open Settings on each and press Sync now; the newest change to each item wins, except that a session done on one device stays done everywhere. A device asking for a passphrase is waiting to unlock the encrypted note.</Li>
        <Li><b>Everything gone after clearing the browser</b>: connect Intervals.icu again and the note brings your plans and calendar back; press Sync for activities; or restore a backup file.</Li>
      </ul>
    ),
  },
];

export function Help({ params }: { params?: URLSearchParams }) {
  const [search, setSearch] = useState('');
  const q = search.trim().length >= 2 ? search.trim().toLowerCase() : '';
  const target = params?.get('s');
  // Opened at a section (a screen's "?"): scroll there once the page is drawn, after the shell's own scroll to the top.
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => document.getElementById(`help-${target}`)?.scrollIntoView({ block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [target]);
  const shown = SECTIONS.map((s) => {
    const titleHit = !!q && s.title.toLowerCase().includes(q);
    return { s, titleHit, visible: !q || titleHit || matches(s.body, q) > 0 };
  });
  const none = q && !shown.some((x) => x.visible);
  return (
    <div>
      <PageHead title="Help" />
      <div class="row wrap help-search" style="gap:8px;margin-bottom:16px">
        <input type="search" value={search} placeholder="Search help" aria-label="Search help" onInput={(e) => setSearch((e.target as HTMLInputElement).value)} style="flex:1;min-width:200px;max-width:420px" />
        {search && <button class="btn sm quiet" onClick={() => setSearch('')}>Clear</button>}
      </div>
      <div class="help">
        <nav class="help-toc panel">
          {shown.map(({ s, visible }) => <a key={s.id} class={visible ? '' : 'dim'} href={`#/help?s=${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`help-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{s.title}</a>)}
        </nav>
        <div class="help-body">
          {none && <div class="empty small"><b>Nothing in Help matches "{search.trim()}".</b><span class="small muted">Try a shorter word, or clear the search.</span></div>}
          {shown.filter((x) => x.visible).map(({ s, titleHit }) => (
            <section class="section" id={`help-${s.id}`} key={s.id}>
              <h2>{s.title}</h2>
              <Query.Provider value={titleHit ? '' : q}>
                <div class="prose">{s.body}</div>
              </Query.Provider>
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
