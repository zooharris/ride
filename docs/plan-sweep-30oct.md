# Antogo plan sweep: gaps (30 Oct)

Developers' working document, never shown in the app. Every goal (7 event types, raise FTP, raise VO2max, ride longer, lose weight, general) × 6/8/12/16/20 weeks × 4/6/8/10/12 hours × 3/4/5/6 days × five equipment sets (bodyweight; dumbbells and a bench; + kettlebell; + bands; full gym) × walks on/off × runs on/off × power/heart rate × two riders (a beginner, a fit masters rider): 96,000 plans, 1,190,400 weeks. Re-run with `npx vite-node scripts/plan-sweep.ts` (about 6 minutes; writes docs/plan-gaps.md).

A **material gap** is a day where no Library workout that fits could give 85% of what the day could hold (minutes at the ability, the long ride's length, a strength session of the quality, focus and level), or nothing of the kind exists. A week whose load falls short because the rider's hours can't carry the budget is not a Library gap and is counted apart.

## Before (first run, before any additions)

Weeks fully met: 87.6%. Bodyweight only 67.3%; every other equipment set 92.6%.

Top of the list it produced:

| # | Kind | Wanted | Day (min) | Setting | Equipment | Basis | Weeks | Avg short (min) | No candidate | Nearest used |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ride | vo2 | 45 | indoor |  | hr | 11940 | 10 | 0 | Lansdowne (Tempo 2 x 12) |
| 2 | strength | heavy (upper) | 60 |  | bodyweight |  | 8813 | 41 | 0 | Legs: strength, bodyweight |
| 3 | strength | heavy (upper) | 30 |  | bodyweight |  | 8380 | 30 | 0 | Legs: strength, bodyweight |
| 4 | strength | heavy (upper) | 30 |  | dumbbells+bench |  | 8260 | 30 | 0 | Heavy upper body |
| 5 | strength | heavy (upper) | 30 |  | +kettlebell |  | 8260 | 30 | 0 | Heavy upper body |
| 6 | strength | heavy (upper) | 30 |  | +bands |  | 8260 | 30 | 0 | Heavy upper body |
| 7 | strength | heavy (upper) | 30 |  | full gym |  | 8260 | 30 | 0 | Heavy upper body, gym |
| 8 | strength | heavy (upper) | 75 |  | bodyweight |  | 8178 | 41 | 0 | Legs: strength, bodyweight |
| 9 | strength | heavy (upper) | 45 |  | bodyweight |  | 6352 | 42 | 0 | Legs: strength, bodyweight |
| 10 | strength | heavy (upper) | 105 |  | bodyweight |  | 6187 | 42 | 0 | Legs: strength, bodyweight |
| 11 | strength | power (upper) | 75 |  | bodyweight |  | 4312 | 41 | 0 | Legs: power, bodyweight |
| 12 | strength | power (upper) | 60 |  | bodyweight |  | 4290 | 41 | 0 | Legs: power, bodyweight |
| 13 | ride | long | 135 | outdoor |  | hr | 4000 | 29 | 0 | Red Rock (Tempo 40) |
| 14 | ride | long | 135 | outdoor |  | power | 3905 | 29 | 0 | Red Rock (Tempo 40) |
| 15 | strength | power (upper) | 30 |  | bodyweight |  | 3809 | 30 | 0 | Legs: power, bodyweight |
| 16 | strength | heavy (legs) | 30 |  | bodyweight |  | 3482 | 30 | 0 | Legs: strength, bodyweight |
| 17 | strength | heavy (legs) | 30 |  | dumbbells+bench |  | 3482 | 30 | 0 | Heavy legs |
| 18 | strength | heavy (legs) | 30 |  | +kettlebell |  | 3482 | 30 | 0 | Heavy legs, kettlebell |
| 19 | strength | heavy (legs) | 30 |  | +bands |  | 3482 | 30 | 0 | Heavy legs, kettlebell |
| 20 | strength | heavy (legs) | 30 |  | full gym |  | 3482 | 30 | 0 | Heavy legs |

In words: (1) a VO2max ride by heart rate for a 45-minute day; (2) upper-body heavy and power strength with no equipment; (3) strength for a day with only half an hour free, at any level, every equipment set; (4) anaerobic rides for a 45-minute day, power and heart rate. Two apparent gaps (a long ride on a 135-minute outdoor day; a threshold ride on a 135-minute day) were the shopper's choice, not the Library's: it was fixed to take the length first, and the sweep now counts a gap only when no workout that fits could do the job.

## What was written

- Rides (3): Jones Point (Short VO2max 4 × 4 by heart rate, 45 min), Pimmit Run (Short anaerobic 6 × 1, 45 min, power), Chain Bridge (Short anaerobic 5 × 2 by heart rate, 45 min).
- Strength (2 full + 12 short): Upper body: strength, bodyweight; Upper body: power, bodyweight; and a four-exercise short version of each quality and focus (heavy, power: with dumbbells and bodyweight; endurance, one leg at a time: bodyweight), each fitting half an hour at any level.

## After

Plans: 96000. Weeks: 1190400. Weeks fully met: 1190400 (100%).

Material gap: a week wanted something and the Library supplied less than 85% of it, or nothing of the kind for that day. A week short of its load budget because the rider's hours cannot carry it is not a Library gap and is counted apart (373604 weeks, 31.4%).

## By equipment

| Equipment | Weeks | Fully met |
|---|---|---|
| bodyweight | 238080 | 100% |
| dumbbells+bench | 238080 | 100% |
| +kettlebell | 238080 | 100% |
| +bands | 238080 | 100% |
| full gym | 238080 | 100% |

## Workouts to write, most wanted first

Grouped by kind, what was wanted, the day's minutes (to the nearest 15), setting, equipment and basis.

| # | Kind | Wanted | Day (min) | Setting | Equipment | Basis | Weeks | Avg short (min) | No candidate | Nearest used |
|---|---|---|---|---|---|---|---|---|---|---|
