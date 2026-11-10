import { generatePlan } from './planner';
import { availabilityOf, EQUIPMENT_SETS, riderAssessment, type SweepGrid, type GoalKey } from './sweep';
import { addDays } from './load';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { tagsOf, type OutdoorRating } from '../library/tags';
import type { Goal, EventType } from './goals';
import type { Basis, Profile, Workout } from './types';

/**
 * The developers' depth sweep (9 Nov 2026, "the Library grows up", Part A). The 30 Oct sweep
 * asked whether the Library could supply every week a plan wants; after its additions it
 * can (every week of 96,000 plans met). This one asks the next question: how many
 * different workouts a plan can choose from for each kind of day, and so how often it
 * has to hand a rider the same one again. Its report is the shopping list for the new
 * rides and sessions. Never shown in the app. Run: `npx vite-node scripts/depth-sweep.ts`.
 */

const START = '2026-11-02';
const EVENT_TYPES: EventType[] = ['century', 'gran-fondo', 'climbing', 'time-trial', 'group-ride', 'multi-day', 'other'];
const PROFILE: Profile = { name: 'S', ftp: 230, lthr: 158, maxHr: 178, restingHr: 52, weightKg: 82, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };

function goalOf(k: GoalKey, weeks: number): Goal {
  if ((EVENT_TYPES as string[]).includes(k)) return { kind: 'event', date: addDays(START, weeks * 7 + 5), name: k, eventType: k as EventType, priority: 'A' };
  if (k === 'ftp') return { kind: 'ftp', weeks, targetWatts: 270 };
  if (k === 'endurance') return { kind: 'endurance', weeks, targetHours: 4 };
  return { kind: k as 'vo2max' | 'weight' | 'general', weeks } as Goal;
}

/** Length bands the way a rider thinks of a day: minutes, upper bound. */
export const BANDS: Array<[string, number]> = [['under 45 min', 45], ['45–60 min', 61], ['1–1½ h', 91], ['1½–2 h', 121], ['2–3 h', 181], ['3–4 h', 241], ['4 h and up', 1e9]];
export const bandOf = (min: number) => BANDS.find(([, hi]) => min < hi)![0];

/** A kind of day: what the plan picked a workout to do. */
export interface DayKind { key: string; kind: Workout['kind']; what: string; band: string; outdoor?: boolean; basis?: Basis; equipment?: string }

export interface Group extends DayKind {
  picks: number;           // sessions of this kind across all plans
  repeats: number;         // of those, a workout the same plan had already given for this kind of day
  plans: number;           // plans that asked for it at all
  maxInPlan: number;       // most sessions of this kind in one plan
  perPlan: number[];       // sessions of this kind in each plan that asked (for the 90th percentile)
  used: Set<string>;       // distinct workouts the planner used for it
  candidates: number;      // Library workouts that could serve it
}

export interface DepthResult {
  plans: number;
  sessions: number;
  rideSessions: number; rideRepeats: number;
  hardRideSessions: number; hardRideRepeats2w: number;
  outdoorRides: number; outdoorByRating: Record<OutdoorRating, number>;
  /** Over plans of 12 weeks or more: rides per plan, distinct rides per plan, the most times one ride appears. */
  long: { plans: number; rides: number; distinct: number; maxSame: number };
  groups: Group[];
}

const HARD = new Set(['tempo', 'sweetspot', 'threshold', 'vo2', 'anaerobic', 'mixed']);

function dayKind(w: Workout, date: string, basis: Basis, eqName: string, outdoorDays: Set<number>): DayKind {
  const t = tagsOf(w);
  const band = bandOf(t.minutes);
  if (w.kind === 'ride') {
    const outdoor = outdoorDays.has(new Date(date + 'T00:00:00').getDay());
    return { key: `ride|${t.purpose}|${band}|${basis}`, kind: 'ride', what: t.purpose, band, outdoor, basis };
  }
  if (w.kind === 'strength') {
    const q = w.strength ? `${w.strength.quality} (${w.strength.focus})` : 'themed';
    return { key: `strength|${q}|${band}|${eqName}`, kind: 'strength', what: q, band, equipment: eqName };
  }
  return { key: `${w.kind}|${t.purpose}|${band}`, kind: w.kind, what: t.purpose, band };
}

function countCandidates(g: DayKind, pools: Map<string, Workout[]>): number {
  if (g.kind === 'ride') return LIBRARY.filter((w) => { const t = tagsOf(w); return t.purpose === g.what && bandOf(t.minutes) === g.band && w.bases.includes(g.basis!); }).length;
  const pool = g.kind === 'strength' ? pools.get(g.equipment!) ?? [] : pools.get('full gym') ?? [];
  return pool.filter((w) => {
    if (w.kind !== g.kind) return false;
    const t = tagsOf(w);
    if (bandOf(t.minutes) !== g.band) return false;
    if (g.kind === 'strength') return (w.strength ? `${w.strength.quality} (${w.strength.focus})` : 'themed') === g.what;
    return t.purpose === g.what;
  }).length;
}

export function runDepth(grid: SweepGrid, onProgress?: (n: number) => void): DepthResult {
  const groups = new Map<string, Group>();
  const pools = new Map<string, Workout[]>();
  for (const [name, eq] of Object.entries(EQUIPMENT_SETS)) pools.set(name, readyMadeSessions([...eq, 'treadmill', 'outdoor-walk']));
  const r: DepthResult = { plans: 0, sessions: 0, rideSessions: 0, rideRepeats: 0, hardRideSessions: 0, hardRideRepeats2w: 0, outdoorRides: 0, outdoorByRating: { well: 0, adjustable: 0, indoor: 0 }, long: { plans: 0, rides: 0, distinct: 0, maxSame: 0 }, groups: [] };
  for (const g of grid.goals) for (const n of grid.weeks) for (const hours of grid.hours) for (const days of grid.days) for (const eqName of grid.equipment) for (const foot of grid.foot) for (const basis of grid.basis) for (const rider of grid.riders) {
    const av = availabilityOf(hours, days, EQUIPMENT_SETS[eqName], foot);
    const outdoorDays = new Set(av.outdoor!.flatMap((o, i) => (o ? [i] : [])));
    const plan = generatePlan({ start: START, goal: goalOf(g, n), availability: av, basis, masters: rider === 'masters', profile: { ...PROFILE, basis }, assessment: riderAssessment(rider) });
    r.plans++;
    const seenByGroup = new Map<string, Set<string>>();
    const inPlan = new Map<string, number>();
    const rideCount = new Map<string, number>();
    const lastHard = new Map<string, string>();      // ride id → last date given
    let rides = 0;
    for (const w of plan.weeks) for (const s of w.sessions) {
      const wk = s.workout;
      const id = wk.libraryId ?? wk.id;
      const dk = dayKind(wk, s.date, basis, eqName, outdoorDays);
      const gp = groups.get(dk.key) ?? { ...dk, picks: 0, repeats: 0, plans: 0, maxInPlan: 0, perPlan: [], used: new Set<string>(), candidates: -1 };
      const seen = seenByGroup.get(dk.key) ?? new Set<string>();
      gp.picks++;
      if (seen.has(id)) gp.repeats++;
      seen.add(id); seenByGroup.set(dk.key, seen);
      gp.used.add(id);
      groups.set(dk.key, gp);
      inPlan.set(dk.key, (inPlan.get(dk.key) ?? 0) + 1);
      r.sessions++;
      if (wk.kind === 'ride') {
        const t = tagsOf(wk);
        rides++;
        r.rideSessions++;
        if ((rideCount.get(id) ?? 0) > 0) r.rideRepeats++;
        rideCount.set(id, (rideCount.get(id) ?? 0) + 1);
        if (HARD.has(t.purpose)) {
          r.hardRideSessions++;
          const last = lastHard.get(id);
          if (last && addDays(last, 14) > s.date) r.hardRideRepeats2w++;
          lastHard.set(id, s.date);
        }
        if (dk.outdoor) { r.outdoorRides++; r.outdoorByRating[t.outdoor ?? 'well']++; }
      }
    }
    for (const [k, c] of inPlan) { const gp = groups.get(k)!; gp.plans++; gp.perPlan.push(c); gp.maxInPlan = Math.max(gp.maxInPlan, c); }
    if (plan.weeks.length >= 12) {
      r.long.plans++; r.long.rides += rides; r.long.distinct += rideCount.size;
      r.long.maxSame = Math.max(r.long.maxSame, ...rideCount.values(), 0);
    }
    onProgress?.(r.plans);
  }
  for (const gp of groups.values()) gp.candidates = countCandidates(gp, pools);
  r.groups = [...groups.values()].sort((a, b) => b.repeats - a.repeats);
  return r;
}

/** The 90th-percentile number of sessions of a kind in one plan: what the Library must have depth for. */
export function p90(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0;
}

/**
 * How many workouts a kind of day should have so that a plan of the 90th-percentile size gives
 * each one at most twice: half its sessions, rounded up, and never fewer than three where a plan
 * asks for it at all. Rides only count those that work on the basis in question.
 */
export const wanted = (g: Group) => Math.max(3, Math.ceil(p90(g.perPlan) / 2));
