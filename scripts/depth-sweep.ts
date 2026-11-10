// The developers' depth sweep (9 Nov 2026): npx vite-node scripts/depth-sweep.ts
// Writes docs/library-depth.md. Nothing here is part of the app.
import { writeFileSync } from 'node:fs';
import { FULL_GRID } from '../src/engine/sweep';
import { runDepth, p90, wanted, BANDS, type Group } from '../src/engine/depth';
import { PURPOSE_LABEL, type Purpose } from '../src/library/tags';

const t0 = Date.now();
const r = runDepth(FULL_GRID, (n) => { if (n % 10000 === 0) console.log(`${n} plans, ${Math.round((Date.now() - t0) / 1000)} s`); });
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`;
const bandIdx = (b: string) => BANDS.findIndex(([n]) => n === b);
const what = (g: Group) => (g.kind === 'ride' || g.kind === 'walk' || g.kind === 'run' ? PURPOSE_LABEL[g.what as Purpose] ?? g.what : g.what);
const L: string[] = [];

L.push(`# Antogo Library depth sweep (${new Date().toISOString().slice(0, 10)})`, '');
L.push('Developers\' working document, never shown in the app. The same 96,000 plans as the 30 Oct gap sweep (every goal × 6–20 weeks × 4–12 hours × 3–6 days × five equipment sets × walks/runs on or off × power or heart rate × a beginner and a fit masters rider). Re-run with `npx vite-node scripts/depth-sweep.ts`.', '');
L.push('## Headline', '');
L.push(`- Plans: ${r.plans.toLocaleString()}; sessions: ${r.sessions.toLocaleString()}; rides: ${r.rideSessions.toLocaleString()}.`);
L.push(`- Rides that repeat a ride the same plan already gave: ${pct(r.rideRepeats, r.rideSessions)}.`);
L.push(`- Hard rides (tempo and up) that repeat the same ride within two weeks: ${pct(r.hardRideRepeats2w, r.hardRideSessions)}.`);
L.push(`- Plans of 12 weeks or more (${r.long.plans.toLocaleString()}): ${Math.round(r.long.rides / r.long.plans)} rides each on average, only ${Math.round(r.long.distinct / r.long.plans)} different ones; the most any one plan gave a single ride is ${r.long.maxSame} times.`);
L.push(`- Rides on outdoor days: ${r.outdoorRides.toLocaleString()}; rated rides well outdoors ${pct(r.outdoorByRating.well, r.outdoorRides)}, adjusted for outdoors ${pct(r.outdoorByRating.adjustable, r.outdoorRides)}, indoors only ${pct(r.outdoorByRating.indoor, r.outdoorRides)}.`, '');

L.push('## How to read the shopping list', '');
L.push('A **kind of day** is what the plan picked a workout for: its purpose, its length, and (rides) the basis; strength also by equipment. **Should have** is enough that a plan of the 90th-percentile size for that kind of day gives each workout at most twice, and never fewer than three. **To add** is the difference.', '');

function table(title: string, gs: Group[], cols: 'ride' | 'strength' | 'other') {
  L.push(`## ${title}`, '');
  const head = cols === 'strength' ? '| Quality (focus) | Length | Equipment | Sessions | Repeats | Library has | Should have | To add |' : cols === 'ride' ? '| Purpose | Length | Basis | Sessions | Repeats | Library has | Should have | To add |' : '| Kind | Purpose | Length | Sessions | Repeats | Library has | Should have | To add |';
  L.push(head, '|---|---|---|---|---|---|---|---|');
  for (const g of gs) {
    const add = Math.max(0, wanted(g) - g.candidates);
    const c3 = cols === 'strength' ? g.equipment : cols === 'ride' ? g.basis : g.band;
    const c1 = cols === 'other' ? g.kind : what(g);
    const c2 = cols === 'other' ? what(g) : g.band;
    L.push(`| ${c1} | ${c2} | ${c3} | ${g.picks.toLocaleString()} | ${pct(g.repeats, g.picks)} | ${g.candidates} | ${wanted(g)} | ${add || ''} |`);
  }
  L.push('');
}
const order = (a: Group, b: Group) => (Math.max(0, wanted(b) - b.candidates) - Math.max(0, wanted(a) - a.candidates)) || b.repeats - a.repeats || bandIdx(a.band) - bandIdx(b.band);
const rides = r.groups.filter((g) => g.kind === 'ride' && g.what !== 'test').sort(order);
table('Rides', rides, 'ride');
const strength = r.groups.filter((g) => g.kind === 'strength').sort(order);
table('Strength', strength, 'strength');
table('Mobility, walks and runs', r.groups.filter((g) => g.kind === 'mobility' || g.kind === 'walk' || g.kind === 'run').sort(order), 'other');

// Totals by purpose (rides, both bases merged by taking the larger need per band), for the brief's counts.
const byPurpose = new Map<string, number>();
const seen = new Map<string, number>();
for (const g of rides) { const k = `${g.what}|${g.band}`; seen.set(k, Math.max(seen.get(k) ?? 0, Math.max(0, wanted(g) - g.candidates))); }
for (const [k, v] of seen) { const p = k.split('|')[0]; byPurpose.set(p, (byPurpose.get(p) ?? 0) + v); }
L.push('## Rides to add by purpose (the larger of the power and heart-rate needs per length)', '', '| Purpose | To add |', '|---|---|');
let tot = 0;
for (const [p, v] of [...byPurpose].sort((a, b) => b[1] - a[1])) { L.push(`| ${PURPOSE_LABEL[p as Purpose] ?? p} | ${v} |`); tot += v; }
L.push(`| **Total** | **${tot}** |`, '');
L.push(`(p90 sessions per plan, for reference, top ride kinds: ${rides.slice(0, 8).map((g) => `${what(g)} ${g.band} ${g.basis} ${p90(g.perPlan)}`).join('; ')}.)`);

writeFileSync(new URL('../docs/library-depth.md', import.meta.url), L.join('\n') + '\n');
console.log(L.join('\n'));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s`);
