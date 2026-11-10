# Antogo Library depth sweep (2026-11-10)

Developers' working document, never shown in the app. The same 96,000 plans as the 30 Oct gap sweep (every goal × 6–20 weeks × 4–12 hours × 3–6 days × five equipment sets × walks/runs on or off × power or heart rate × a beginner and a fit masters rider). Re-run with `npx vite-node scripts/depth-sweep.ts`.

## Headline

- Plans: 96,000; sessions: 9,974,320; rides: 4,393,410.
- Rides that repeat a ride the same plan already gave: 52%.
- Hard rides (tempo and up) that repeat the same ride within two weeks: 6%.
- Plans of 12 weeks or more (57,600): 59 rides each on average, only 25 different ones; the most any one plan gave a single ride is 28 times.
- Rides on outdoor days: 1,950,240; rated rides well outdoors 100%, adjusted for outdoors 0%, indoors only 0%.

## How to read the shopping list

A **kind of day** is what the plan picked a workout for: its purpose, its length, and (rides) the basis; strength also by equipment. **Should have** is enough that a plan of the 90th-percentile size for that kind of day gives each workout at most twice, and never fewer than three. **To add** is the difference.

## Rides

| Purpose | Length | Basis | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| Endurance | 1–1½ h | hr | 306,517 | 58% | 7 | 8 | 1 |
| Endurance | 1½–2 h | hr | 272,142 | 59% | 6 | 7 | 1 |
| Endurance | 1½–2 h | power | 271,862 | 59% | 6 | 7 | 1 |
| Recovery | under 45 min | hr | 160,312 | 56% | 6 | 7 | 1 |
| Tempo | 45–60 min | hr | 68,669 | 47% | 3 | 4 | 1 |
| Sweet spot | 3–4 h | hr | 47,982 | 53% | 4 | 5 | 1 |
| Sweet spot | 3–4 h | power | 47,605 | 53% | 4 | 5 | 1 |
| Endurance | 45–60 min | power | 306,161 | 58% | 10 | 9 |  |
| Endurance | 45–60 min | hr | 299,942 | 58% | 10 | 9 |  |
| Endurance | 1–1½ h | power | 300,398 | 57% | 8 | 8 |  |
| Endurance | 2–3 h | hr | 183,685 | 63% | 8 | 8 |  |
| Endurance | 2–3 h | power | 177,408 | 62% | 8 | 7 |  |
| Recovery | under 45 min | power | 162,882 | 55% | 7 | 6 |  |
| Sweet spot | 45–60 min | hr | 152,880 | 48% | 5 | 5 |  |
| Sweet spot | 45–60 min | power | 146,302 | 47% | 5 | 5 |  |
| Threshold | 45–60 min | hr | 134,799 | 48% | 6 | 6 |  |
| Threshold | 45–60 min | power | 91,482 | 50% | 7 | 6 |  |
| Sweet spot | 1–1½ h | hr | 77,707 | 48% | 7 | 3 |  |
| Tempo | 1½–2 h | hr | 56,184 | 58% | 4 | 4 |  |
| Tempo | 1½–2 h | power | 53,766 | 59% | 4 | 4 |  |
| Tempo | 45–60 min | power | 71,241 | 41% | 4 | 4 |  |
| VO2max | 1–1½ h | hr | 57,211 | 47% | 5 | 3 |  |
| Sweet spot | 1–1½ h | power | 59,830 | 44% | 8 | 3 |  |
| VO2max | 45–60 min | hr | 67,385 | 39% | 4 | 3 |  |
| Sweet spot | 1½–2 h | hr | 52,110 | 49% | 4 | 3 |  |
| Sweet spot | 1½–2 h | power | 50,319 | 49% | 4 | 3 |  |
| Threshold | 1–1½ h | power | 52,627 | 46% | 5 | 4 |  |
| Sweet spot | 2–3 h | hr | 42,151 | 56% | 3 | 3 |  |
| Tempo | 2–3 h | hr | 41,578 | 52% | 3 | 3 |  |
| VO2max | 1–1½ h | power | 50,405 | 42% | 8 | 3 |  |
| Endurance | 3–4 h | hr | 30,714 | 66% | 5 | 5 |  |
| Sweet spot | 2–3 h | power | 37,253 | 52% | 3 | 3 |  |
| Endurance | 3–4 h | power | 28,774 | 64% | 5 | 5 |  |
| Tempo | 2–3 h | power | 37,008 | 49% | 3 | 3 |  |
| VO2max | 45–60 min | power | 46,871 | 36% | 9 | 3 |  |
| Race and group rides | 2–3 h | power | 29,970 | 44% | 3 | 3 |  |
| Threshold | 1–1½ h | hr | 32,337 | 37% | 4 | 3 |  |
| Race and group rides | 1–1½ h | power | 37,243 | 31% | 3 | 3 |  |
| Tempo | 1–1½ h | hr | 24,448 | 37% | 3 | 3 |  |
| VO2max | 1½–2 h | power | 24,626 | 34% | 3 | 3 |  |
| VO2max | under 45 min | power | 18,338 | 31% | 3 | 3 |  |
| Threshold | 1½–2 h | hr | 18,433 | 28% | 4 | 3 |  |
| Tempo | 1–1½ h | power | 14,662 | 35% | 3 | 3 |  |
| Threshold | 1½–2 h | power | 12,923 | 26% | 4 | 3 |  |
| Anaerobic and sprints | 45–60 min | hr | 10,200 | 32% | 3 | 3 |  |
| Recovery | 45–60 min | power | 19,598 | 14% | 4 | 3 |  |
| Recovery | 45–60 min | hr | 17,751 | 14% | 4 | 3 |  |
| Anaerobic and sprints | 1–1½ h | power | 1,644 | 15% | 3 | 3 |  |
| Anaerobic and sprints | 45–60 min | power | 1,275 | 16% | 4 | 3 |  |

## Strength

| Quality (focus) | Length | Equipment | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| power (legs) | under 45 min | bodyweight | 57,623 | 56% | 1 | 5 | 4 |
| heavy (legs) | under 45 min | bodyweight | 71,983 | 55% | 1 | 4 | 3 |
| endurance (legs) | under 45 min | bodyweight | 57,488 | 58% | 1 | 4 | 3 |
| endurance (legs) | under 45 min | dumbbells+bench | 57,488 | 58% | 1 | 4 | 3 |
| endurance (legs) | under 45 min | +kettlebell | 57,486 | 58% | 1 | 4 | 3 |
| heavy (legs) | under 45 min | dumbbells+bench | 72,009 | 33% | 2 | 5 | 3 |
| heavy (legs) | under 45 min | +kettlebell | 76,114 | 30% | 2 | 5 | 3 |
| heavy (legs) | under 45 min | +bands | 76,114 | 30% | 2 | 5 | 3 |
| endurance (legs) | under 45 min | +bands | 55,897 | 38% | 1 | 4 | 3 |
| endurance (legs) | under 45 min | full gym | 55,897 | 38% | 1 | 4 | 3 |
| power (legs) | under 45 min | dumbbells+bench | 57,665 | 35% | 2 | 5 | 3 |
| power (legs) | under 45 min | +kettlebell | 56,633 | 33% | 2 | 5 | 3 |
| power (legs) | under 45 min | +bands | 56,633 | 33% | 2 | 5 | 3 |
| power (legs) | under 45 min | full gym | 56,633 | 33% | 2 | 5 | 3 |
| heavy (legs) | under 45 min | full gym | 66,700 | 28% | 2 | 4 | 2 |
| heavy (upper) | under 45 min | bodyweight | 41,075 | 42% | 1 | 3 | 2 |
| heavy (legs) | 45–60 min | bodyweight | 19,898 | 56% | 1 | 3 | 2 |
| heavy (upper) | 45–60 min | bodyweight | 10,158 | 44% | 1 | 3 | 2 |
| power (upper) | under 45 min | bodyweight | 16,088 | 27% | 1 | 3 | 2 |
| power (legs) | 45–60 min | bodyweight | 12,634 | 34% | 1 | 3 | 2 |
| power (upper) | 45–60 min | bodyweight | 6,565 | 20% | 1 | 3 | 2 |
| endurance (legs) | 45–60 min | bodyweight | 5,914 | 12% | 1 | 3 | 2 |
| endurance (legs) | 45–60 min | dumbbells+bench | 5,914 | 12% | 1 | 3 | 2 |
| endurance (legs) | 45–60 min | +kettlebell | 5,914 | 12% | 1 | 3 | 2 |
| endurance (upper) | under 45 min | bodyweight | 6,429 | 9% | 1 | 3 | 2 |
| stability (legs) | under 45 min | bodyweight | 2,720 | 18% | 1 | 3 | 2 |
| stability (legs) | under 45 min | dumbbells+bench | 2,720 | 18% | 1 | 3 | 2 |
| stability (legs) | under 45 min | +kettlebell | 2,720 | 18% | 1 | 3 | 2 |
| stability (legs) | under 45 min | +bands | 2,720 | 18% | 1 | 3 | 2 |
| stability (legs) | under 45 min | full gym | 2,720 | 18% | 1 | 3 | 2 |
| stability (legs) | 45–60 min | bodyweight | 1,440 | 33% | 1 | 3 | 2 |
| stability (legs) | 45–60 min | dumbbells+bench | 1,440 | 33% | 1 | 3 | 2 |
| stability (legs) | 45–60 min | +kettlebell | 1,440 | 33% | 1 | 3 | 2 |
| stability (legs) | 45–60 min | +bands | 1,440 | 33% | 1 | 3 | 2 |
| stability (legs) | 45–60 min | full gym | 1,440 | 33% | 1 | 3 | 2 |
| endurance (upper) | under 45 min | dumbbells+bench | 6,107 | 5% | 1 | 3 | 2 |
| endurance (upper) | under 45 min | +kettlebell | 6,109 | 5% | 1 | 3 | 2 |
| endurance (upper) | under 45 min | +bands | 6,068 | 5% | 1 | 3 | 2 |
| endurance (upper) | under 45 min | full gym | 6,062 | 5% | 1 | 3 | 2 |
| stability (upper) | under 45 min | bodyweight | 632 | 10% | 1 | 3 | 2 |
| stability (upper) | under 45 min | dumbbells+bench | 152 | 42% | 1 | 3 | 2 |
| stability (upper) | under 45 min | +kettlebell | 152 | 42% | 1 | 3 | 2 |
| stability (upper) | under 45 min | +bands | 152 | 42% | 1 | 3 | 2 |
| stability (upper) | under 45 min | full gym | 152 | 42% | 1 | 3 | 2 |
| endurance (upper) | 45–60 min | bodyweight | 2,920 | 2% | 1 | 3 | 2 |
| stability (upper) | 45–60 min | bodyweight | 614 | 0% | 1 | 3 | 2 |
| heavy (upper) | under 45 min | dumbbells+bench | 37,131 | 24% | 2 | 3 | 1 |
| heavy (upper) | under 45 min | +kettlebell | 37,110 | 24% | 2 | 3 | 1 |
| heavy (upper) | under 45 min | +bands | 37,099 | 24% | 2 | 3 | 1 |
| heavy (upper) | under 45 min | full gym | 40,021 | 18% | 2 | 3 | 1 |
| heavy (legs) | 45–60 min | dumbbells+bench | 19,872 | 29% | 2 | 3 | 1 |
| heavy (upper) | 45–60 min | dumbbells+bench | 14,102 | 28% | 2 | 3 | 1 |
| power (upper) | under 45 min | dumbbells+bench | 15,187 | 11% | 2 | 3 | 1 |
| power (upper) | under 45 min | +kettlebell | 15,153 | 11% | 2 | 3 | 1 |
| power (upper) | under 45 min | +bands | 15,153 | 11% | 2 | 3 | 1 |
| power (upper) | under 45 min | full gym | 15,193 | 11% | 2 | 3 | 1 |
| power (legs) | 45–60 min | dumbbells+bench | 12,592 | 8% | 2 | 3 | 1 |
| power (upper) | 45–60 min | dumbbells+bench | 7,466 | 8% | 2 | 3 | 1 |
| power (upper) | 45–60 min | full gym | 7,477 | 8% | 2 | 3 | 1 |
| power (upper) | 45–60 min | +kettlebell | 7,474 | 8% | 2 | 3 | 1 |
| power (upper) | 45–60 min | +bands | 7,474 | 8% | 2 | 3 | 1 |
| endurance (legs) | 45–60 min | +bands | 7,506 | 7% | 2 | 3 | 1 |
| endurance (legs) | 45–60 min | full gym | 7,506 | 7% | 2 | 3 | 1 |
| endurance (upper) | 45–60 min | dumbbells+bench | 3,242 | 1% | 2 | 3 | 1 |
| endurance (upper) | 45–60 min | +kettlebell | 3,244 | 1% | 2 | 3 | 1 |
| stability (upper) | 45–60 min | dumbbells+bench | 1,094 | 0% | 2 | 3 | 1 |
| stability (upper) | 45–60 min | +kettlebell | 1,094 | 0% | 2 | 3 | 1 |
| stability (upper) | 45–60 min | +bands | 1,094 | 0% | 2 | 3 | 1 |
| stability (upper) | 45–60 min | full gym | 1,094 | 0% | 2 | 3 | 1 |
| heavy (legs) | 45–60 min | full gym | 25,181 | 29% | 4 | 4 |  |
| heavy (legs) | 45–60 min | +kettlebell | 15,767 | 26% | 3 | 3 |  |
| heavy (legs) | 45–60 min | +bands | 15,767 | 26% | 3 | 3 |  |
| heavy (upper) | 45–60 min | +kettlebell | 14,102 | 28% | 3 | 3 |  |
| heavy (upper) | 45–60 min | +bands | 14,102 | 28% | 3 | 3 |  |
| heavy (upper) | 45–60 min | full gym | 11,185 | 32% | 4 | 3 |  |
| power (legs) | 45–60 min | +kettlebell | 13,624 | 9% | 3 | 3 |  |
| power (legs) | 45–60 min | +bands | 13,624 | 9% | 3 | 3 |  |
| power (legs) | 45–60 min | full gym | 13,624 | 9% | 3 | 3 |  |
| endurance (upper) | 45–60 min | +bands | 3,284 | 1% | 3 | 3 |  |
| endurance (upper) | 45–60 min | full gym | 3,280 | 1% | 3 | 3 |  |

## Mobility, walks and runs

| Kind | Purpose | Length | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| walk | Endurance | under 45 min | 108,320 | 79% | 6 | 22 | 16 |
| mobility | mobility | under 45 min | 3,438,253 | 84% | 17 | 30 | 13 |
| run | Endurance | under 45 min | 74,440 | 87% | 2 | 13 | 11 |
| run | Endurance | 45–60 min | 207,664 | 85% | 3 | 7 | 4 |
| walk | Recovery | under 45 min | 300 | 3% | 2 | 3 | 1 |
| walk | Endurance | 45–60 min | 181,143 | 70% | 10 | 8 |  |

## Rides to add by purpose (the larger of the power and heart-rate needs per length)

| Purpose | To add |
|---|---|
| Endurance | 2 |
| Recovery | 1 |
| Tempo | 1 |
| Sweet spot | 1 |
| Threshold | 0 |
| VO2max | 0 |
| Race and group rides | 0 |
| Anaerobic and sprints | 0 |
| **Total** | **5** |

(p90 sessions per plan, for reference, top ride kinds: Endurance 1–1½ h hr 16; Endurance 1½–2 h hr 14; Endurance 1½–2 h power 14; Recovery under 45 min hr 13; Tempo 45–60 min hr 7; Sweet spot 3–4 h hr 9; Sweet spot 3–4 h power 9; Endurance 45–60 min power 18.)
