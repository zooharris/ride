// The developers' plan sweep (30 Oct 2026): npx vite-node scripts/plan-sweep.ts
// Writes docs/plan-gaps.md. Nothing here is part of the app.
import { writeFileSync } from 'node:fs';
import { FULL_GRID, runSweep, sweepReport } from '../src/engine/sweep';

const t0 = Date.now();
const r = runSweep(FULL_GRID, (n) => { if (n % 10000 === 0) console.log(`${n} plans, ${Math.round((Date.now() - t0) / 1000)} s`); });
const md = sweepReport(r, `Antogo plan sweep: gaps (${new Date().toISOString().slice(0, 10)})`);
writeFileSync(new URL('../docs/plan-gaps.md', import.meta.url), md + '\n');
console.log(md.split('\n').slice(0, 60).join('\n'));
