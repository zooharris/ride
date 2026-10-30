import { assess, type Assessment } from './assessment';
import { generatePlan, type Availability } from './planner';
import type { Goal, EventType } from './goals';
import type { Unmet } from './shop';
import { addDays } from './load';
import type { Basis, Equipment, Profile, Ride, Wellness } from './types';

/**
 * The developers' sweep (30 Oct 2026): plans for every plausible rider, goal and
 * week, to find where the Library cannot supply what a week needs. Its report is
 * a working document for writing Library workouts; nothing here is ever shown to
 * a rider. Run the full grid with `SWEEP=1 npx vitest run scripts/plan-sweep.test.ts`.
 */

export const EVENT_TYPES: EventType[] = ['century', 'gran-fondo', 'climbing', 'time-trial', 'group-ride', 'multi-day', 'other'];
export const GOAL_KINDS = [...EVENT_TYPES, 'ftp', 'vo2max', 'endurance', 'weight', 'general'] as const;
export type GoalKey = (typeof GOAL_KINDS)[number];

export const EQUIPMENT_SETS: Record<string, Equipment[]> = {
  bodyweight: ['bodyweight'],
  'dumbbells+bench': ['bodyweight', 'dumbbells', 'bench'],
  '+kettlebell': ['bodyweight', 'dumbbells', 'bench', 'kettlebell'],
  '+bands': ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band'],
  'full gym': ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars'],
};

export interface SweepGrid {
  goals: readonly GoalKey[];
  weeks: number[];
  hours: number[];
  days: number[];
  equipment: string[];
  foot: Array<{ walk: boolean; run: boolean }>;
  basis: Basis[];
  riders: Array<'beginner' | 'masters'>;
}

export const FULL_GRID: SweepGrid = {
  goals: GOAL_KINDS, weeks: [6, 8, 12, 16, 20], hours: [4, 6, 8, 10, 12], days: [3, 4, 5, 6], equipment: Object.keys(EQUIPMENT_SETS),
  foot: [{ walk: false, run: false }, { walk: true, run: false }, { walk: false, run: true }, { walk: true, run: true }], basis: ['power', 'hr'], riders: ['beginner', 'masters'],
};

const START = '2026-11-02';   // a Monday

function goalOf(k: GoalKey, weeks: number): Goal {
  if ((EVENT_TYPES as string[]).includes(k)) return { kind: 'event', date: addDays(START, weeks * 7 + 5), name: k, eventType: k as EventType, priority: 'A' };
  if (k === 'ftp') return { kind: 'ftp', weeks, targetWatts: 270 };
  if (k === 'endurance') return { kind: 'endurance', weeks, targetHours: 4 };
  return { kind: k as 'vo2max' | 'weight' | 'general', weeks } as Goal;
}

/** Days with time, weekend first; the weekend carries more of the hours. */
const DAY_SETS: Record<number, number[]> = { 3: [2, 4, 6], 4: [2, 4, 6, 0], 5: [1, 2, 4, 6, 0], 6: [1, 2, 3, 4, 6, 0] };
export function availabilityOf(hours: number, days: number, equipment: Equipment[], foot: { walk: boolean; run: boolean }): Availability {
  const dows = DAY_SETS[days];
  const weekend = dows.filter((d) => d === 0 || d === 6);
  const weekdays = dows.filter((d) => d !== 0 && d !== 6);
  const weekendShare = weekend.length ? (weekend.length === 2 ? 0.55 : 0.35) : 0;
  const h = [0, 0, 0, 0, 0, 0, 0];
  for (const d of weekend) h[d] = Math.max(1, Math.round(hours * weekendShare / weekend.length * 4) / 4);
  for (const d of weekdays) h[d] = Math.max(0.5, Math.round(hours * (1 - weekendShare) / weekdays.length * 4) / 4);
  const noBike = [false, false, false, false, false, false, false];
  // Foot work needs a day the bike cannot use: Friday, 45 minutes, no bike.
  if (foot.walk || foot.run) { h[5] = 0.75; noBike[5] = true; }
  const eq: Equipment[] = [...equipment, ...(foot.walk ? (['treadmill', 'outdoor-walk'] as Equipment[]) : [])];
  return { hours: h, outdoor: [true, false, false, false, false, false, true], noBike, equipment: eq, pins: [], may: { strength: true, mobility: true, walk: foot.walk, run: foot.run } };
}

const PROFILE: Profile = { name: 'S', ftp: 230, lthr: 158, maxHr: 178, restingHr: 52, weightKg: 82, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const assessCache = new Map<string, Assessment>();
export function riderAssessment(kind: 'beginner' | 'masters'): Assessment {
  if (assessCache.has(kind)) return assessCache.get(kind)!;
  const rides: Ride[] = [], wellness: Wellness[] = [];
  for (let i = 84; i >= 1; i--) {
    const d = addDays(START, -i);
    const dw = new Date(d + 'T00:00:00').getDay();
    const r = (h: number, IF: number) => rides.push({ id: d + h, date: d, startTime: d, name: 'r', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 3600 * IF * IF / 36), normalizedPower: IF * 230, averageHr: 135, intensityFactor: IF });
    if (kind === 'beginner') { if (dw === 6) r(1.25, 0.66); if (dw === 3) r(0.75, 0.65); }
    else { if (dw === 6) r(2, 0.8); if (dw === 0) r(3, 0.68); if (dw === 3) r(1.25, 0.75); if (dw === 2) r(1, 0.85); }
    wellness.push({ date: d, hrv: 50, restingHr: 52, sleepSeconds: 25200 });
  }
  const a = assess({ today: START, profile: PROFILE, rides, wellness, planned: [] });
  assessCache.set(kind, a);
  return a;
}

export interface Gap { key: string; kind: Unmet['kind']; want: string; slot: number; equipment: string; setting?: string; basis?: Basis; count: number; short: number; nearest: Map<string, number>; noCandidate: number }
export interface SweepResult { plans: number; weeks: number; metWeeks: number; byEquipment: Record<string, { weeks: number; met: number }>; gaps: Gap[]; loadShort: number }

/** Material: more than 15% of what was wanted, or nothing of the kind at all. Easy fill is load, not a Library gap, and is counted apart. */
export const material = (u: Unmet) => u.want !== 'easy' && (u.noCandidate || u.short > Math.max(3, 0.15 * u.minutes));

export function runSweep(grid: SweepGrid, onProgress?: (done: number) => void): SweepResult {
  const gaps = new Map<string, Gap>();
  const byEquipment: SweepResult['byEquipment'] = {};
  let plans = 0, weeks = 0, metWeeks = 0, loadShort = 0;
  for (const g of grid.goals) for (const n of grid.weeks) for (const hours of grid.hours) for (const days of grid.days) for (const eqName of grid.equipment) for (const foot of grid.foot) for (const basis of grid.basis) for (const rider of grid.riders) {
    const av = availabilityOf(hours, days, EQUIPMENT_SETS[eqName], foot);
    const plan = generatePlan({ start: START, goal: goalOf(g, n), availability: av, basis, masters: rider === 'masters', profile: { ...PROFILE, basis }, assessment: riderAssessment(rider) });
    plans++;
    for (const w of plan.weeks) {
      weeks++;
      const e = (byEquipment[eqName] ??= { weeks: 0, met: 0 });
      e.weeks++;
      const mat = (w.unmet ?? []).filter(material);
      if ((w.unmet ?? []).some((u) => u.want === 'easy')) loadShort++;
      if (!mat.length) { metWeeks++; e.met++; continue; }
      for (const u of mat) {
        const slot = Math.round(u.slotMinutes / 15) * 15;
        const eqKey = u.kind === 'strength' ? eqName : '';
        const key = `${u.kind}|${u.want}|${u.focus ?? ''}|${slot}|${u.setting ?? ''}|${eqKey}|${u.kind === 'ride' ? basis : ''}`;
        const gp = gaps.get(key) ?? { key, kind: u.kind, want: `${u.want}${u.focus ? ` (${u.focus})` : ''}`, slot, equipment: eqKey, setting: u.setting, basis: u.kind === 'ride' ? basis : undefined, count: 0, short: 0, nearest: new Map(), noCandidate: 0 };
        gp.count++; gp.short += u.short;
        if (u.noCandidate) gp.noCandidate++;
        if (u.nearest) gp.nearest.set(u.nearest, (gp.nearest.get(u.nearest) ?? 0) + 1);
        gaps.set(key, gp);
      }
    }
    onProgress?.(plans);
  }
  return { plans, weeks, metWeeks, byEquipment, gaps: [...gaps.values()].sort((a, b) => b.count - a.count), loadShort };
}

export function sweepReport(r: SweepResult, title: string): string {
  const pct = (a: number, b: number) => `${b ? Math.round(a / b * 1000) / 10 : 100}%`;
  const lines: string[] = [];
  lines.push(`# ${title}`, '');
  lines.push(`Plans: ${r.plans}. Weeks: ${r.weeks}. Weeks fully met: ${r.metWeeks} (${pct(r.metWeeks, r.weeks)}).`, '');
  lines.push('Material gap: a week wanted something and the Library supplied less than 85% of it, or nothing of the kind for that day. A week short of its load budget because the rider\'s hours cannot carry it is not a Library gap and is counted apart' + ` (${r.loadShort} weeks, ${pct(r.loadShort, r.weeks)}).`, '');
  lines.push('## By equipment', '', '| Equipment | Weeks | Fully met |', '|---|---|---|');
  for (const [k, v] of Object.entries(r.byEquipment)) lines.push(`| ${k} | ${v.weeks} | ${pct(v.met, v.weeks)} |`);
  lines.push('', '## Workouts to write, most wanted first', '', 'Grouped by kind, what was wanted, the day\'s minutes (to the nearest 15), setting, equipment and basis.', '', '| # | Kind | Wanted | Day (min) | Setting | Equipment | Basis | Weeks | Avg short (min) | No candidate | Nearest used |', '|---|---|---|---|---|---|---|---|---|---|---|');
  r.gaps.slice(0, 80).forEach((g, i) => {
    const near = [...g.nearest.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    lines.push(`| ${i + 1} | ${g.kind} | ${g.want} | ${g.slot} | ${g.setting ?? ''} | ${g.equipment} | ${g.basis ?? ''} | ${g.count} | ${Math.round(g.short / g.count)} | ${g.noCandidate} | ${near} |`);
  });
  if (r.gaps.length > 80) lines.push('', `…and ${r.gaps.length - 80} smaller groups.`);
  return lines.join('\n');
}
