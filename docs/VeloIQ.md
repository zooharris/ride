# VeloIQ 2.0 — how it works

Written 18 October 2026, at the point the app reached usable form. This is the reference for anyone (including a future Claude session) who needs to understand the app without reading the code: what it is for, how it is built, how the training engine thinks, and the standing requirements that shaped it.

## What it is

A personal cycling-training app for a masters road rider, run entirely in the browser as an installable web app (PWA). It plans training around the rider's own data, sends rides to a Garmin Edge, reads back what was done, and recommends strength, mobility and walking alongside the riding.

Live at https://zooharris.github.io/ride/ (source: github.com/zooharris/ride). Anyone can open the address and connect their own Intervals.icu account; each install holds only its own person's data.

## The one outside service

Garmin's developer programme is closed to individuals and Apple Health has no web API, so **Intervals.icu is the single pipe**:

- Workouts sent from the app become Intervals.icu calendar events, which Intervals.icu pushes to Garmin Connect and so to the Edge.
- Any activity recorded to Intervals.icu — from the Edge, a watch, a manual entry — comes back to the app on Sync, whatever device recorded it. The app never assumes a particular device.
- Wellness (HRV, sleep, resting HR) comes from Intervals.icu too, from whatever writes it there (Garmin, Oura, by hand).
- FTP, threshold HR and max HR are kept in step both ways.
- The weekly automatic backup is a private note in the rider's own Intervals.icu calendar (31 Dec 2099), so a new device restores from it right after connecting.

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
- **settings**: key/value — Intervals credentials, Claude key, active plan, plan request, view preferences, tour state.
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

**Planning** (`generatePlan()`): the rider gives only **hours per day**, which days can be outdoors, which days have no bike, their equipment, and standing commitments ("Tuesday is strength"). The planner decides, for every day, ride / strength / mobility / walk / rest:

- Phase sequence from weeks available and the goal: base → build → peak → taper, proportioned by what the goal rewards and what the data flags as the limiter.
- Sessions generated to fit each slot (an endurance ride sized to the slot, intervals by phase and progression), named and explained.
- An allocator with soft costs, scaled by the rider's measured recovery responses — nothing is a hard rule. A hard ride the day after strength costs more if the data show that rider recovers poorly from lifting, less if they recover well. Two long rides in one week are allowed when two long slots exist, the goal rewards durability, and the after-long-ride penalty is low.
- Ramp capped (4 fitness points a week for a masters rider, raised with recovery evidence). Recovery rhythm starts at every third week for masters; fatigue evidence inside a week discounts load and puts easy days after hard ones.
- FTP tests only when the FTP looks stale.
- Strength count and level by phase; mobility after the long ride and after strength; walks for windows under 45 minutes or no-bike days when a treadmill or outdoor walking is available.
- Output: weeks of sessions with reasons, a fitness projection, verdict (on track / close / short), advice, and a list of decisions in sentences. Plan weeks start on Monday; nothing before today.

**Adaptation**: every day after a sync the plan is regenerated from today, diffed against the calendar, and last week is reviewed (done / missed / over-cooked). Changes are shown and applied only on a tap; unchanged sessions are kept. Cancelling a plan removes only future, undone sessions the plan created.

**Compliance** (`scoreRide`, `analyseRide`): a ride matched to its planned workout (by Intervals event id, else date + kind) gets a verdict and an interval-by-interval comparison laid along elapsed time from the recording.

**Readiness**: HRV 40%, sleep 30%, resting HR 15%, form 15%, each against the rider's own 2-week baseline → a score and a band (go / ease / easy / rest).

## Screens

- **Today**: getting-started checklist (first run), today's ride with Send to Garmin, other sessions, next up, readiness with explanations, fitness chart, the plan's daily re-check, the coach review.
- **Calendar**: list (two weeks) or month; + Add any kind; Send N to Garmin; confirm on remove; Plan.
- **Plan**: assessment panel, goal, your week, equipment, commitments, masters toggle → result with verdict, projection chart, decisions, weeks; Put on calendar / Discard; active plan with Re-check / Cancel.
- **Library**: Rides by family; Strength / Mobility / Walks ready-made for the rider's equipment; My … sections; Build → chooser → ride, strength, mobility or walk builder, each showing estimated TSS live. Walks carry a heart-rate target (% of max, shown in bpm).
- **Activities**: list or month; detail with verdict, route map, stacked interactive charts (shared cursor with the map; mouse or touch), time in zone, numbers with descriptions.
- **Settings**: Intervals credentials + connection checks; your numbers; zones; coach key and auto-review toggle; backup now / restore from Intervals / file backup.
- **Help**: one section per screen, the numbers explained, backup and other devices, troubleshooting.

## Standing requirements (from the rider)

- Every number gets a clear descriptive label; charts have labelled axes and hover explanations.
- Any delete asks "are you sure?"; every place a change can be abandoned has Cancel / Reset.
- The planner assesses the rider's own data; no blanket rules; assumptions questioned.
- The rider specifies only hours and constraints; the app decides the kind of session.
- Strength sessions name real exercises, sets, reps and load for the rider's equipment; mobility sessions name stretches and holds; walking is a session kind.
- No stopgaps or templates.
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
