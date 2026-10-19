# VeloIQ 2.0 — how it works

Written 18 October 2026, at the point the app reached usable form; updated the same night after the plan, library and print work. This is the reference for anyone (including a future Claude session) who needs to understand the app without reading the code: what it is for, how it is built, how the training engine thinks, and the standing requirements that shaped it.

## What it is

A personal cycling-training app for a masters road rider, run entirely in the browser as an installable web app (PWA). It plans training around the rider's own data, sends rides to a Garmin Edge, reads back what was done, and recommends strength, mobility and walking alongside the riding.

Live at https://zooharris.github.io/ride/ (source: github.com/zooharris/ride). Anyone can open the address and connect their own Intervals.icu account; each install holds only its own person's data.

## The one outside service

Garmin's developer programme is closed to individuals and Apple Health has no web API, so **Intervals.icu is the single pipe**:

- Workouts sent from the app become Intervals.icu calendar events, which Intervals.icu pushes to Garmin Connect and so to the Edge.
- Any activity recorded to Intervals.icu — from the Edge, a watch, a manual entry — comes back to the app on Sync, whatever device recorded it. The app never assumes a particular device.
- Wellness (HRV, sleep, resting HR) comes from Intervals.icu too, from whatever writes it there (Garmin, Oura, by hand).
- FTP, threshold HR and max HR are kept in step both ways.
- **Sync across devices** (`src/data/devicesync.ts`): the app's own data (profile, settings, plans, calendar entries, workouts) lives in a private note in the rider's own Intervals.icu calendar (31 Dec 2099, gzip+base64). Every write stamps `updatedAt` and every delete leaves a tombstone (Dexie hooks in db.ts, `untracked()` for applying remote records); each device merges with the note on launch, on return to the foreground (≤ once a minute), after every Intervals sync, and ~4 s after any local change (`notify()` → `schedulePush`). Newest record wins, deletions carry, unstamped legacy records union. The same note is the backup a new device restores from; a file backup remains. No server; each account's note is its own, so nothing mixes.

Map tiles come from OpenStreetMap (free, no key). Claude (Anthropic API) is optional and off unless a key is entered.

## Technology

Vite 5 + Preact 10 + TypeScript. IndexedDB via Dexie for storage. Hash routing. vite-plugin-pwa for offline. Leaflet for maps. Vitest for the engine tests (47). Hosted on GitHub Pages from `main` via GitHub Actions; every push deploys in about two minutes. No server of any kind.

```
src/
  appName.ts        the app name, in one place (renaming = one edit)
  engine/           pure TypeScript, no UI, fully tested
    zones.ts        Coggan power zones; Friel-style HR zones mapped by zone position
    workout.ts      workout model (steps, repeats, blocks as fractions of threshold), stats, Intervals.icu text rendering
    load.ts         TSS (power), hrTSS, strength TSS, fitness/fatigue/form series
    compliance.ts   verdict for a ride against its planned workout
    readiness.ts    HRV/sleep/RHR/form vs the rider's own 2-week baseline
    assessment.ts   what the rider's data says (see Engine below)
    goals.ts        goal → demand (event hours, TSS, required fitness, longest ride, emphasis)
    generate.ts     ride session generators by type (endurance … VO2max, tests)
    sessions.ts     strength / mobility / walk generators; shared TSS estimator
    planner.ts      availability + goal + assessment → weekly plan with reasons
    adapt.ts        last-week review, re-plan diff
    analysis.ts     planned-vs-actual from recorded streams
  library/          ride workouts (core, outdoor, indoor), exercises, stretches, ready-made sessions
  sync/             intervals.ts (the adapter), syncService.ts (pull everything), selfTest.ts (connection checks)
  data/             db.ts (Dexie schema), backup.ts (file + Intervals note backups)
  coach/claude.ts   optional daily note and post-sync review
  ui/               screens, components, planService.ts, store.ts (app data + change bus)
```

## Data model (IndexedDB, one database per browser profile)

- **profile**: name, FTP, LTHR, max/resting HR, weight, units, default basis (power/HR), masters flag.
- **settings**: key/value — Intervals credentials, Claude key, `plans` (the list of named plans), plan request, view preferences, tour state, `deviceSync` state and `deviceId` (local only).
- **tombstones**: `${table}:${id}` + time, for deletions to carry across devices.
- **workouts**: hand-built (`source: 'mine'`) and generated copies (`source: 'generated'`); the library itself is code.
- **planned**: calendar entries — date, workoutId, basis, status (planned → sent → completed, or missed), Intervals event id, matched activity id, planId if a plan created it.
- **rides**: every activity from Intervals.icu with the app's own TSS; `sport` is ride | strength | mobility | walk | other.
- **wellness**: per-day HRV, resting HR, sleep, weight.
- **streams**: cached recordings (time, power, HR, cadence, distance, altitude, speed, temperature, GPS).

Workout model: a workout is blocks of steps; each step is a duration and a target as a *fraction of threshold* (plus an optional cadence note). The same workout renders as %FTP or %LTHR depending on the basis it is sent on, because Garmin accepts one target type per workout. VO2max and above are power-only (HR lags too much for short efforts).

## The engine

**Load.** TSS = seconds × IF² / 36 from power; hrTSS from HR zones when there is no power; strength from planned/logged effort (RPE² × 50/49 per hour); walks from the HR target as Intervals.icu would credit them; mobility a flat 8/h. Fitness (CTL) is a 42-day exponential average of daily TSS, fatigue (ATL) 7-day, form = fitness − fatigue.

**Assessment** (`assess()`): from rides, wellness and the power curve it derives fitness and ramp rate, weekly hours and TSS, longest ride, aerobic decoupling and efficiency trend, power profile by duration, how the rider responds after strength / long rides / hard rides (from wellness and next-day output), whether FTP looks fresh, stale, likely higher or likely lower (eFTP signal), compliance, and the limiters. Every value carries a confidence (none / thin / good) and a sentence of evidence.

**Demand** (`demand()`): the goal turned into numbers — for an event, the estimated duration and intensity, the TSS of the day, the fitness needed, the longest training ride wanted, and the emphasis (durability / threshold / VO2 / recovery). Other goals (FTP, endurance, weight, general) have their own demand shapes.

**Planning** (`generatePlan()`): the rider gives only **hours per day**, where they can ride each day (outdoors / indoors / no bike), their equipment, and standing commitments (a day pinned to a ride, strength, a walk, mobility or rest, honoured every week; a pinned day is kept clear of anything else). The planner decides, for every other day, ride / strength / mobility / walk / rest:

- Phase sequence from weeks available and the goal: base → build → peak → taper, proportioned by what the goal rewards and what the data flags as the limiter.
- Sessions generated to fit each slot (an endurance ride sized to the slot, intervals by phase and progression), named and explained.
- An allocator with soft costs, scaled by the rider's measured recovery responses — nothing is a hard rule. A hard ride the day after strength costs more if the data show that rider recovers poorly from lifting, less if they recover well. Two long rides in one week are allowed when two long slots exist, the goal rewards durability, and the after-long-ride penalty is low.
- Ramp capped (4 fitness points a week for a masters rider, raised with recovery evidence). Recovery rhythm starts at every third week for masters; fatigue evidence inside a week discounts load and puts easy days after hard ones.
- FTP tests only when the FTP looks stale.
- Strength count and level by phase; mobility after the long ride and after strength; walks for windows under 45 minutes or no-bike days when a treadmill or outdoor walking is available.
- Output: weeks of sessions with reasons, a fitness projection, verdict (on track / close / short), advice, and a list of decisions in sentences. Plan weeks start on Monday; nothing before today.

**Adaptation**: every day after a sync the plan is regenerated from today, diffed against the calendar, and last week is reviewed (done / missed / over-cooked). Each change is a tick box: changes to plan-made sessions are ticked, suggestions touching sessions the rider replaced or moved (`userEdited`, `movedFrom` on the calendar entry) are unticked; only ticked changes apply, unchanged sessions are kept. Cancelling a plan removes only future, undone sessions the plan created.

**Pairing**: on every sync a recording is matched to its planned session by Intervals.icu's `paired_event_id`, else the same day and kind, else the same day and name (the watch names the recording after the workout). A recording paired to a planned walk or strength session takes that kind whatever type the device gave it (a treadmill walk often arrives as a Run; a Run slower than 7 km/h is a walk anyway) and is scored for it. The calendar then shows one row, marked done with the recorded time, load and heart rate, and a link to the recording.

**Compliance** (`scoreRide`, `analyseRide`): a ride matched to its planned workout (by Intervals event id, else date + kind) gets a verdict and an interval-by-interval comparison laid along elapsed time from the recording.

**Readiness**: HRV 40%, sleep 30%, resting HR 15%, form 15%, each against the rider's own 2-week baseline → a score and a band (go / ease / easy / rest).

## Screens

- **Today**: getting-started checklist (first run), today's ride with Send to Garmin, other sessions, next up, readiness with explanations, fitness chart with form bands, the plan's daily re-check (per-change tick boxes), the coach review. The app always opens here.
- **Plan** (its own tab, "Plan my training"): the list of plans (name, dates, current / upcoming / finished; Re-check on the current one, Print and Cancel per plan); the new-plan form with name, start date, goal, your week (hours; Outdoors / Indoors / No bike; a commitment per day: App decides / Always a ride / strength / walk / mobility / rest), equipment, masters toggle → result with verdict, projection chart with shaded form bands, decisions, weeks; Put on calendar / Discard. Plans never overlap; a clash is refused with the reason. Plans without an event end on a recovery week.
- **Print** (`#/print/<planId>`): US Letter landscape with its own `@page` rules; calendar layout (one row per week, one column per day, done/missed marks, recovery weeks tinted, weekly hours and TSS) or list layout; 12 weeks comfortably and 16 tightly on one page, longer plans paginate with the header repeated. Verified by printing to PDF in headless Chromium.
- **Calendar**: list (two weeks) or month; + Add any kind; ⋯ on any session to replace it with another workout of any kind, move it to another date, or remove it (confirm); Send N to Garmin.
- **Library**: Rides with a filter toolbar (search, Type menu, Length menu, Sort menu; dropdowns on a laptop, bottom sheets on a phone); Strength / Mobility / Walks ready-made for the rider's equipment; My … sections; "New workout" → chooser → ride, strength, mobility or walk builder, each showing estimated TSS live. Walks carry a heart-rate target (% of max, shown in bpm; a low of 0 = no minimum, the Recovery preset). Recovery-family rides and any step built with a low of 0 enforce no floor (`noFloor` on the step; sent to the device as 10% FTP / 20% LTHR because Garmin needs two ends) and can be sent to the Garmin as walking workouts (Intervals.icu type Walk, target as % LTHR).
- **Ride names**: every library ride is named for a place (src/library/names.ts): where you would turn around on an out-and-back from Old Town Herndon at the ride's intensity. Outdoor-shaped rides go west on the W&OD (long rides = trail towns, interval rides = roads off the trail), core rides go east toward Washington, indoor rides take the loops near home; tests keep plain names. The descriptive name is the subtitle and goes to the Garmin with the place name. The file lists unused names for future rides.
- **Activities**: list or month; detail with verdict, route map, stacked interactive charts (shared cursor with the map; mouse or touch), time in zone, numbers with descriptions.
- **Settings**: Intervals credentials + connection checks; your numbers; zones; week starts on Monday or Sunday (calendar, lists, plan rows and printout follow); coach key and auto-review toggle; across your devices (last merge, Sync now, Replace this device with the note) / file backup.
- **Help**: one section per screen, the numbers explained, backup and other devices, troubleshooting.

## Standing requirements (from the rider)

- Every number gets a clear descriptive label; charts have labelled axes and hover explanations.
- Any delete asks "are you sure?"; every place a change can be abandoned has Cancel / Reset.
- The planner assesses the rider's own data; no blanket rules; assumptions questioned.
- The rider specifies only hours and constraints; the app decides the kind of session.
- Strength sessions name real exercises, sets, reps and load for the rider's equipment; mobility sessions name stretches and holds; walking is a session kind.
- No stopgaps or templates.
- Any calendared session, plan-made or not, can be replaced (any kind), moved or removed by the rider; the plan keeps the rider's change and may only suggest otherwise.
- Library rides have unique, memorable place names (Virginia, around the W&OD from Herndon) with the descriptive name as subtitle; the library offers a range of durations up to six hours and can be filtered by length.
- No device assumed; Intervals.icu is the single source of completed activities; app-logged sessions are written back to it.
- Must run without Claude; Claude is optional and never changes the plan without the rider's OK.
- Giveable to others with no mixing of data.
- Must look like a professionally designed, commercially available app.
- The rider never touches git; API keys are pasted into the app, never shared in chat.

## Parked

- **Workout player** (receive sensor data, control a trainer in ERG mode, record and upload): parked 18 Oct 2026. Feasible on a laptop in Chrome/Edge via Web Bluetooth; impossible in iPhone browsers (Apple allows no Web Bluetooth), so the phone version would need a native shell. Note the KICKR ROLLR has no power meter of its own.
- Optional Sunday narrative from Claude.

## Verification still owed by the rider (needs his key and devices)

Run the connection checks in Settings; ride one planned workout end to end; install on the iPhone; back up then restore on a second browser; add the Claude key and read a daily note and a post-sync review.
