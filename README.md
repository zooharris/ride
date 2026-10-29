# AntoVelo (formerly VeloIQ) 2.0

A personal cycling training app for masters riders: plan the week, send each ride to a Garmin, pull the results back, and adapt the plan. Runs entirely in the browser; installs on an iPhone home screen as a PWA.

- Hosted from this repository with GitHub Pages at `https://<owner>.github.io/ride/`.
- Intervals.icu is the only outside service: it pushes planned workouts to Garmin Connect and receives finished rides. One free account, one API key, entered once in Settings.
- All data lives on the device (IndexedDB). Settings has a one-tap backup file and restore.
- An optional Claude API key adds a daily coach note; without it the app runs the same.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/` | Pure training maths with tests: zones, workout model and Intervals.icu text rendering, TSS and hrTSS, fitness/fatigue/form, compliance scoring, readiness |
| `src/sync/intervals.ts` | The one module that talks to Intervals.icu; field-name findings from 1.0 are codified here |
| `src/library/workouts.ts` | The workout library (intensities as fractions of threshold) |
| `src/data/` | IndexedDB schema (Dexie) and backup export/import |
| `src/ui/` | Screens: Today, Calendar, Library, Workout, Rides, Settings, Onboarding |
| `src/appName.ts` | The app's name, in one place |

## Working on it

```
npm install
npm run dev      # local dev server
npm test         # engine tests
npm run build    # type-check and production build
```

Pushing to `main` builds, runs the tests and deploys to Pages.
