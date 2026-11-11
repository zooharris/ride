# Antogo Library depth sweep (2026-11-11)

Developers' working document, never shown in the app. The same 96,000 plans as the 30 Oct gap sweep (every goal × 6–20 weeks × 4–12 hours × 3–6 days × five equipment sets × walks/runs on or off × power or heart rate × a beginner and a fit masters rider). Re-run with `npx vite-node scripts/depth-sweep.ts`.

## Headline

- Plans: 96,000; sessions: 9,886,926; rides: 4,370,953.
- Rides that repeat a ride the same plan already gave: 46%.
- Hard rides (tempo and up) that repeat the same ride within two weeks: 6%.
- Plans of 12 weeks or more (57,600): 59 rides each on average, only 28 different ones; the most any one plan gave a single ride is 21 times.
- Rides on outdoor days: 1,950,240; rated rides well outdoors 99%, adjusted for outdoors 0%, indoors only 0%.

## How to read the shopping list

A **kind of day** is what the plan picked a workout for: its purpose, its length, and (rides) the basis; strength also by equipment. **Should have** is enough that a plan of the 90th-percentile size for that kind of day gives each workout at most twice, and never fewer than three. **To add** is the difference.

## Rides

| Purpose | Length | Basis | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| Endurance | 1–1½ h | power | 316,460 | 49% | 15 | 8 |  |
| Endurance | 1–1½ h | hr | 311,662 | 50% | 13 | 8 |  |
| Endurance | 1½–2 h | power | 319,630 | 48% | 9 | 8 |  |
| Endurance | 1½–2 h | hr | 318,774 | 48% | 9 | 8 |  |
| Endurance | 45–60 min | power | 271,170 | 44% | 11 | 8 |  |
| Endurance | 45–60 min | hr | 266,880 | 44% | 11 | 8 |  |
| Sweet spot | 45–60 min | hr | 190,162 | 54% | 9 | 6 |  |
| Endurance | 2–3 h | hr | 166,487 | 57% | 8 | 7 |  |
| Endurance | 2–3 h | power | 165,826 | 57% | 8 | 7 |  |
| Sweet spot | 45–60 min | power | 172,374 | 51% | 11 | 6 |  |
| Recovery | under 45 min | hr | 154,330 | 48% | 6 | 6 |  |
| Recovery | under 45 min | power | 154,666 | 47% | 7 | 6 |  |
| VO2max | 1–1½ h | hr | 80,498 | 53% | 8 | 4 |  |
| Threshold | 45–60 min | hr | 72,676 | 51% | 6 | 6 |  |
| Threshold | 45–60 min | power | 68,210 | 52% | 8 | 7 |  |
| Threshold | 1–1½ h | hr | 77,420 | 43% | 13 | 4 |  |
| Tempo | 45–60 min | power | 76,342 | 44% | 6 | 4 |  |
| Tempo | 45–60 min | hr | 67,685 | 46% | 4 | 3 |  |
| VO2max | 1–1½ h | power | 58,697 | 50% | 12 | 4 |  |
| Threshold | 1–1½ h | power | 81,315 | 32% | 19 | 5 |  |
| Threshold | 2–3 h | hr | 41,896 | 51% | 3 | 3 |  |
| Sweet spot | 3–4 h | hr | 43,611 | 48% | 5 | 5 |  |
| Tempo | 2–3 h | hr | 50,467 | 41% | 5 | 3 |  |
| Sweet spot | 3–4 h | power | 42,989 | 47% | 5 | 5 |  |
| VO2max | 45–60 min | hr | 41,262 | 48% | 4 | 4 |  |
| Tempo | 2–3 h | power | 46,600 | 41% | 5 | 3 |  |
| Threshold | 2–3 h | power | 35,646 | 52% | 3 | 3 |  |
| Endurance | 3–4 h | power | 31,841 | 53% | 7 | 5 |  |
| Endurance | 3–4 h | hr | 31,695 | 53% | 7 | 5 |  |
| Sweet spot | 2–3 h | hr | 42,473 | 38% | 4 | 3 |  |
| Recovery | 45–60 min | hr | 46,307 | 35% | 4 | 3 |  |
| Sweet spot | 1–1½ h | power | 44,722 | 36% | 9 | 3 |  |
| Recovery | 45–60 min | power | 46,349 | 34% | 4 | 3 |  |
| Sweet spot | 2–3 h | power | 39,909 | 37% | 4 | 3 |  |
| VO2max | 45–60 min | power | 36,443 | 35% | 13 | 3 |  |
| Threshold | 1½–2 h | hr | 30,585 | 40% | 5 | 3 |  |
| Sweet spot | 1–1½ h | hr | 36,590 | 32% | 7 | 3 |  |
| Threshold | 1½–2 h | power | 28,933 | 40% | 5 | 3 |  |
| Tempo | 1–1½ h | hr | 26,680 | 37% | 6 | 3 |  |
| Race and group rides | 1½–2 h | power | 17,276 | 39% | 3 | 3 |  |
| VO2max | 2–3 h | hr | 12,241 | 41% | 3 | 3 |  |
| Tempo | 1½–2 h | hr | 15,938 | 31% | 4 | 3 |  |
| Tempo | 1½–2 h | power | 13,167 | 32% | 4 | 3 |  |
| Tempo | 1–1½ h | power | 13,899 | 29% | 6 | 3 |  |
| VO2max | under 45 min | power | 10,795 | 31% | 3 | 3 |  |
| VO2max | 2–3 h | power | 9,485 | 35% | 3 | 3 |  |
| Race and group rides | 2–3 h | power | 11,727 | 25% | 3 | 3 |  |
| Anaerobic and sprints | 45–60 min | hr | 8,340 | 33% | 3 | 3 |  |
| Sweet spot | 1½–2 h | hr | 9,443 | 26% | 4 | 3 |  |
| Race and group rides | 1–1½ h | power | 12,074 | 15% | 4 | 3 |  |
| VO2max | 1½–2 h | power | 4,414 | 34% | 3 | 3 |  |
| Sweet spot | 1½–2 h | power | 6,349 | 23% | 4 | 3 |  |
| Anaerobic and sprints | 45–60 min | power | 2,421 | 24% | 8 | 3 |  |
| Anaerobic and sprints | 1–1½ h | power | 1,322 | 15% | 4 | 3 |  |

## Strength

| Quality (focus) | Length | Equipment | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| power (legs) | under 45 min | bodyweight | 55,645 | 34% | 4 | 5 | 1 |
| power (upper) | 45–60 min | bodyweight | 7,359 | 8% | 2 | 3 | 1 |
| endurance (upper) | 45–60 min | bodyweight | 2,795 | 1% | 2 | 3 | 1 |
| stability (upper) | 45–60 min | bodyweight | 614 | 0% | 2 | 3 | 1 |
| heavy (legs) | under 45 min | bodyweight | 68,374 | 32% | 4 | 4 |  |
| power (legs) | under 45 min | dumbbells+bench | 56,654 | 33% | 6 | 5 |  |
| heavy (legs) | under 45 min | dumbbells+bench | 66,733 | 27% | 6 | 4 |  |
| power (legs) | under 45 min | +kettlebell | 52,778 | 33% | 7 | 5 |  |
| power (legs) | under 45 min | +bands | 52,778 | 33% | 8 | 5 |  |
| power (legs) | under 45 min | full gym | 50,657 | 33% | 8 | 5 |  |
| heavy (legs) | under 45 min | +kettlebell | 65,325 | 25% | 7 | 4 |  |
| heavy (legs) | under 45 min | +bands | 65,325 | 25% | 7 | 4 |  |
| heavy (legs) | under 45 min | full gym | 65,325 | 25% | 8 | 4 |  |
| endurance (legs) | under 45 min | bodyweight | 57,170 | 25% | 4 | 4 |  |
| endurance (legs) | under 45 min | dumbbells+bench | 54,592 | 22% | 4 | 4 |  |
| endurance (legs) | under 45 min | +kettlebell | 54,005 | 22% | 4 | 4 |  |
| endurance (legs) | under 45 min | +bands | 54,005 | 22% | 4 | 4 |  |
| endurance (legs) | under 45 min | full gym | 54,005 | 22% | 4 | 4 |  |
| heavy (upper) | under 45 min | dumbbells+bench | 37,400 | 23% | 4 | 3 |  |
| heavy (upper) | under 45 min | +kettlebell | 37,394 | 23% | 4 | 3 |  |
| heavy (upper) | under 45 min | +bands | 37,394 | 23% | 4 | 3 |  |
| heavy (upper) | under 45 min | bodyweight | 35,706 | 24% | 3 | 3 |  |
| heavy (legs) | 45–60 min | +kettlebell | 26,593 | 29% | 8 | 4 |  |
| heavy (legs) | 45–60 min | +bands | 26,593 | 29% | 8 | 4 |  |
| heavy (legs) | 45–60 min | full gym | 26,593 | 29% | 10 | 4 |  |
| heavy (legs) | 45–60 min | dumbbells+bench | 25,185 | 29% | 6 | 4 |  |
| heavy (legs) | 45–60 min | bodyweight | 23,544 | 28% | 3 | 3 |  |
| heavy (upper) | 45–60 min | full gym | 18,480 | 29% | 8 | 4 |  |
| heavy (upper) | 45–60 min | bodyweight | 15,723 | 27% | 3 | 3 |  |
| heavy (upper) | under 45 min | full gym | 32,961 | 13% | 4 | 3 |  |
| heavy (upper) | 45–60 min | dumbbells+bench | 14,039 | 28% | 5 | 3 |  |
| heavy (upper) | 45–60 min | +kettlebell | 14,047 | 28% | 6 | 3 |  |
| heavy (upper) | 45–60 min | +bands | 14,047 | 28% | 6 | 3 |  |
| power (upper) | under 45 min | bodyweight | 15,684 | 15% | 3 | 3 |  |
| power (legs) | 45–60 min | +kettlebell | 17,503 | 9% | 8 | 3 |  |
| power (legs) | 45–60 min | +bands | 17,503 | 9% | 9 | 3 |  |
| power (legs) | 45–60 min | full gym | 19,624 | 8% | 10 | 3 |  |
| power (upper) | under 45 min | dumbbells+bench | 13,812 | 11% | 4 | 3 |  |
| power (upper) | under 45 min | +kettlebell | 13,808 | 11% | 4 | 3 |  |
| power (upper) | under 45 min | +bands | 13,808 | 11% | 4 | 3 |  |
| power (upper) | under 45 min | full gym | 11,977 | 10% | 4 | 3 |  |
| power (legs) | 45–60 min | dumbbells+bench | 13,627 | 9% | 6 | 3 |  |
| power (legs) | 45–60 min | bodyweight | 14,636 | 7% | 3 | 3 |  |
| power (upper) | 45–60 min | full gym | 11,058 | 5% | 7 | 3 |  |
| power (upper) | 45–60 min | dumbbells+bench | 9,223 | 5% | 4 | 3 |  |
| power (upper) | 45–60 min | +kettlebell | 9,228 | 5% | 5 | 3 |  |
| power (upper) | 45–60 min | +bands | 9,228 | 5% | 6 | 3 |  |
| endurance (upper) | under 45 min | bodyweight | 6,386 | 6% | 3 | 3 |  |
| stability (legs) | under 45 min | bodyweight | 2,720 | 12% | 3 | 3 |  |
| endurance (upper) | under 45 min | dumbbells+bench | 6,016 | 5% | 3 | 3 |  |
| endurance (upper) | under 45 min | +kettlebell | 6,013 | 5% | 3 | 3 |  |
| endurance (upper) | under 45 min | +bands | 6,013 | 5% | 3 | 3 |  |
| endurance (upper) | under 45 min | full gym | 6,013 | 5% | 3 | 3 |  |
| endurance (legs) | 45–60 min | dumbbells+bench | 8,809 | 2% | 5 | 3 |  |
| endurance (legs) | 45–60 min | +kettlebell | 9,395 | 2% | 6 | 3 |  |
| endurance (legs) | 45–60 min | +bands | 9,395 | 2% | 8 | 3 |  |
| endurance (legs) | 45–60 min | full gym | 9,395 | 2% | 9 | 3 |  |
| stability (legs) | under 45 min | dumbbells+bench | 2,720 | 6% | 3 | 3 |  |
| stability (legs) | under 45 min | +kettlebell | 2,240 | 7% | 3 | 3 |  |
| stability (legs) | under 45 min | +bands | 2,240 | 7% | 3 | 3 |  |
| stability (legs) | under 45 min | full gym | 2,240 | 7% | 3 | 3 |  |
| endurance (legs) | 45–60 min | bodyweight | 6,230 | 2% | 3 | 3 |  |
| stability (upper) | under 45 min | bodyweight | 632 | 10% | 3 | 3 |  |
| stability (upper) | under 45 min | dumbbells+bench | 152 | 42% | 3 | 3 |  |
| stability (upper) | under 45 min | +kettlebell | 152 | 42% | 3 | 3 |  |
| stability (upper) | under 45 min | +bands | 152 | 42% | 3 | 3 |  |
| stability (upper) | under 45 min | full gym | 152 | 42% | 3 | 3 |  |
| endurance (upper) | 45–60 min | dumbbells+bench | 3,170 | 1% | 4 | 3 |  |
| endurance (upper) | 45–60 min | +kettlebell | 3,169 | 1% | 5 | 3 |  |
| endurance (upper) | 45–60 min | +bands | 3,169 | 1% | 6 | 3 |  |
| endurance (upper) | 45–60 min | full gym | 3,169 | 1% | 7 | 3 |  |
| stability (legs) | 45–60 min | bodyweight | 1,440 | 0% | 3 | 3 |  |
| stability (legs) | 45–60 min | dumbbells+bench | 1,440 | 0% | 4 | 3 |  |
| stability (legs) | 45–60 min | +kettlebell | 1,920 | 0% | 5 | 3 |  |
| stability (legs) | 45–60 min | +bands | 1,920 | 0% | 6 | 3 |  |
| stability (legs) | 45–60 min | full gym | 1,920 | 0% | 6 | 3 |  |
| stability (upper) | 45–60 min | dumbbells+bench | 1,094 | 0% | 4 | 3 |  |
| stability (upper) | 45–60 min | +kettlebell | 1,094 | 0% | 5 | 3 |  |
| stability (upper) | 45–60 min | +bands | 1,094 | 0% | 6 | 3 |  |
| stability (upper) | 45–60 min | full gym | 1,094 | 0% | 6 | 3 |  |

## Mobility, walks and runs

| Kind | Purpose | Length | Sessions | Repeats | Library has | Should have | To add |
|---|---|---|---|---|---|---|---|
| mobility | mobility | under 45 min | 3,367,076 | 83% | 30 | 29 |  |
| run | Endurance | 45–60 min | 160,706 | 80% | 5 | 5 |  |
| walk | Endurance | 45–60 min | 157,916 | 66% | 10 | 7 |  |
| run | Endurance | under 45 min | 123,912 | 71% | 7 | 7 |  |
| walk | Endurance | under 45 min | 112,448 | 65% | 14 | 13 |  |
| walk | Recovery | under 45 min | 20,600 | 77% | 4 | 4 |  |

## Rides to add by purpose (the larger of the power and heart-rate needs per length)

| Purpose | To add |
|---|---|
| Endurance | 0 |
| Sweet spot | 0 |
| Recovery | 0 |
| VO2max | 0 |
| Threshold | 0 |
| Tempo | 0 |
| Race and group rides | 0 |
| Anaerobic and sprints | 0 |
| **Total** | **0** |

(p90 sessions per plan, for reference, top ride kinds: Endurance 1–1½ h power 16; Endurance 1–1½ h hr 16; Endurance 1½–2 h power 16; Endurance 1½–2 h hr 16; Endurance 45–60 min power 16; Endurance 45–60 min hr 16; Sweet spot 45–60 min hr 11; Endurance 2–3 h hr 13.)
