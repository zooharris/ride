import type { Basis, Equipment, Family, SessionKind, StrengthFocus, StrengthQuality, Workout } from './types';
import type { MaySchedule, PlannedSession } from './planner';
import type { SessionType } from './generate';
import type { WeekNeeds } from './needs';
import { contribution, QUALITY_ABILITIES, type Ability, type Contribution, type Minutes } from './contribution';
import { redose, DOSE_WORDS, FOCUS_WORDS } from '../library/strengthSessions';
import { QUALITY_LABEL } from '../library/strength';
import { estimateSessionTss } from './sessions';

/**
 * The plan engine, step two (30 Oct 2026): the shopper. A week's needs and the
 * rider's days go in; the week's sessions come out, every one a Library
 * workout (or the rider's own). Nothing is written, generated or adapted here
 * beyond setting a strength session's level. What the Library could not
 * supply is returned as `unmet` for the developers' sweep (scripts/plan-sweep);
 * the rider never sees it.
 *
 * Order of filling: (1) the long ride; (2) quality rides, hardest first, spaced
 * by what hard and long days cost the rider; (3) strength of the week's
 * quality, alternating focus; (4) aerobic fill: rides where the bike is
 * available, walks or runs where it is not; (5) mobility, after the long ride
 * and after strength, then up to the week's floor; (6) rest days. Then the fill
 * rides are swapped longer or shorter until the week is within 5% of its budget.
 */

export type Preference = 'prefer' | 'fine' | 'needed';
export interface Prefs { walk: Preference; run: Preference; mobility: Preference }
export const DEFAULT_PREFS: Prefs = { walk: 'fine', run: 'fine', mobility: 'fine' };

export interface Slot {
  dow: number;            // 0 = Sunday
  date: string;
  minutes: number;        // time the rider has that day
  outdoor: boolean;       // rides outdoors that day
  noBike: boolean;
  pin?: SessionKind | 'rest';
  never: SessionKind[];
}

export interface ShopLibrary { rides: Workout[]; strength: Workout[]; mobility: Workout[]; walks: Workout[]; runs: Workout[] }

export interface ShopContext {
  basis: Basis;
  equipment: Equipment[];
  may: MaySchedule;
  prefs: Prefs;
  /** What a long ride, a hard ride and a strength day cost the next morning, 0..1 (0.3 when unknown). */
  costs: { afterLong: number; afterHard: number; afterStrength: number };
  masters: boolean;
  /** Library ids picked in recent weeks, with how many weeks ago (1 = last week). */
  recent: Map<string, number>;
  library: ShopLibrary;
  /** An event's date, for the runs guard and the openers. */
  eventDate?: string;
  /** The longest ride the goal wants before the taper, seconds (0 when none). */
  requiredLongest: number;
  /** Quality families held from the calendar for this week (a re-check that keeps them). */
  heldFamilies?: Family[];
}

/** What the Library could not supply, for the sweep. Never shown to the rider. */
export interface Unmet {
  kind: 'ride' | 'strength' | 'mobility' | 'walk' | 'run';
  /** For rides: the ability wanted ('long' for the long ride, 'easy' for the fill). */
  want: Ability | 'long' | 'test' | 'openers' | StrengthQuality | 'mobility' | 'walk' | 'run';
  focus?: StrengthFocus;
  minutes: number;        // minutes wanted (at the ability, or of the session)
  short: number;          // minutes not supplied
  slotMinutes: number;
  setting?: 'outdoor' | 'indoor';
  equipment?: Equipment[];
  nearest?: string;
  noCandidate?: boolean;
}

export interface ShopResult { sessions: PlannedSession[]; unmet: Unmet[]; restDates: string[]; remaining: Minutes; tss: number }

/** The most of an ability one session can sensibly hold: a 2 × 20 at threshold, five minutes' worth of VO2 repeats, a set of sprints. */
const SESSION_CAP: Record<Ability, number> = { easy: 240, tempo: 60, sweetspot: 60, threshold: 40, vo2: 18, anaerobic: 7 };
const W: Record<Ability, number> = { easy: 0, tempo: 1, sweetspot: 1.2, threshold: 1.5, vo2: 1.8, anaerobic: 2 };
/** Easy minutes inside a hard ride (its warm-up, recoveries and cool-down) count a little toward the week's easy need. */
const W_EASY_IN_HARD = 0.25;
const HARD_FAMILIES: Family[] = ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic'];
const FAMILY_ABILITY: Partial<Record<Family, Ability>> = { tempo: 'tempo', sweetspot: 'sweetspot', threshold: 'threshold', vo2max: 'vo2', anaerobic: 'anaerobic' };
const ABILITY_FAMILY: Record<Ability, Family> = { easy: 'endurance', tempo: 'tempo', sweetspot: 'sweetspot', threshold: 'threshold', vo2: 'vo2max', anaerobic: 'anaerobic' };
const isOpeners = (w: Workout) => w.name === 'Openers' || w.subtitle === 'Openers';
const prev = (dow: number) => (dow + 6) % 7;
const next = (dow: number) => (dow + 1) % 7;

export function shopWeek(needs: WeekNeeds, slotsIn: Slot[], ctx: ShopContext): ShopResult {
  const slots = slotsIn.filter((s) => s.minutes > 0 && s.pin !== 'rest');
  const sessions: PlannedSession[] = [];
  const unmet: Unmet[] = [];
  const rem: Minutes = { ...needs.minutes };
  const usedIds = new Set<string>();
  const byDow = new Map(slots.map((s) => [s.dow, s]));
  const used = new Map<number, number>();               // minutes used per day
  const free = (s: Slot) => s.minutes - (used.get(s.dow) ?? 0);
  const take = (s: Slot, min: number) => used.set(s.dow, (used.get(s.dow) ?? 0) + min);
  const never = (s: Slot, k: SessionKind) => s.pin !== k && s.never.includes(k);
  const rideable = (s: Slot) => !s.noBike && !never(s, 'ride') && !['strength', 'walk', 'run', 'mobility'].includes(s.pin ?? '');
  const rideDays = new Set<number>();
  const longDays: number[] = [];
  const hardDays: number[] = [];
  const strengthDays: number[] = [];

  const variety = (w: Workout) => {
    const id = w.libraryId ?? w.id;
    if (usedIds.has(id)) return 40;
    const ago = ctx.recent.get(id);
    return ago == null ? 0 : ago <= 1 ? 12 : ago === 2 ? 7 : ago === 3 ? 3 : 0;
  };
  const fitsSetting = (w: Workout, s: Slot) => !s.outdoor || (w.setting !== 'indoor' && !w.trainerOnly);
  const okBasis = (w: Workout) => w.bases.includes(ctx.basis);
  const rides = ctx.library.rides.filter((w) => w.kind === 'ride');
  const place = (s: Slot, w: Workout, type: PlannedSession['type'], reason: string) => {
    const c = contribution(w);
    sessions.push({ date: s.date, kind: w.kind, type, workout: w, seconds: Math.round(c.minutes * 60), tss: Math.round(c.tss), reason });
    usedIds.add(w.libraryId ?? w.id);
    take(s, c.minutes);
    if (w.kind === 'ride') {
      rideDays.add(s.dow);
      for (const a of QUALITY_ABILITIES) rem[a] = Math.max(0, rem[a] - c.at[a]);
      rem.easy = Math.max(0, rem.easy - c.at.easy);
    }
    return c;
  };

  // ---- (0) Rest days: the days with no time count; more are taken from the days with least time, but only
  // while the days left can still carry the week's load (a rider who gives six days and needs most of them keeps them). ----
  const restDates: string[] = [];
  const timeDays = slots.length;
  let extraRest = Math.max(0, needs.restDays - (7 - timeDays));
  const restDows = new Set<number>();
  if (extraRest > 0) {
    const biggest = [...slots].sort((a, b) => b.minutes - a.minutes)[0]?.dow;
    const capacity = (except: Set<number>) => slots.filter((s) => rideable(s) && !except.has(s.dow)).reduce((t, s) => t + s.minutes * 62 / 60 * 0.8, 0);
    const cands = slots.filter((s) => !s.pin && s.dow !== biggest).sort((a, b) => a.minutes - b.minutes || (a.dow === next(biggest ?? -9) ? -1 : 1));
    for (const s of cands) {
      if (extraRest <= 0) break;
      const trial = new Set([...restDows, s.dow]);
      if (capacity(trial) < needs.budgetTss * 1.15) break;
      restDows.add(s.dow); restDates.push(s.date); extraRest--;
    }
  }
  for (let d = 0; d < 7; d++) if (!byDow.has(d)) { const date = slotsIn.find((s) => s.dow === d)?.date; if (date) restDates.push(date); }
  const open = (s: Slot) => !restDows.has(s.dow);

  // ---- (1) The long ride(s). ----
  const rideSlots = slots.filter((s) => rideable(s) && open(s));
  const bySize = [...rideSlots].sort((a, b) => b.minutes - a.minutes || a.dow - b.dow);
  const longWants = [needs.longRideSeconds, needs.secondLongRideSeconds].filter((x) => x > 0);
  longWants.forEach((wantSec, k) => {
    const s = bySize.find((x) => !rideDays.has(x.dow) && x.minutes >= 90);
    if (!s) return;
    const want = Math.min(wantSec / 60, s.minutes);
    const tempoLeft = rem.tempo + rem.sweetspot;
    const longShaped = (w: Workout) => {
      const c = contribution(w);
      if (c.minutes > s.minutes + 2 || c.minutes < 85 || c.at.easy < c.minutes * 0.55) return false;   // long-shaped: mostly easy
      return !((needs.label === 'recovery' || needs.label === 'taper') && c.work > 5);
    };
    const all = rides.filter((w) => okBasis(w) && fitsSetting(w, s) && !isOpeners(w) && w.family !== 'test' && !w.trainerOnly && longShaped(w));
    // The length comes first: a ride near the length asked for, when the Library has one; only then the tempo or the variety.
    const near = all.filter((w) => contribution(w).minutes >= want * 0.85);
    const cands = near.length ? near : all;
    let best: Workout | null = null, bestScore = -Infinity, bestC: Contribution | null = null;
    for (const w of cands) {
      const c = contribution(w);
      let score = -Math.abs(c.minutes - want) / want * 100;
      if (c.minutes > want * 1.1) score -= 15;
      // Tempo or sweet spot late in a long ride counts toward the week's tempo, once the specific work has begun.
      if (k === 0 && needs.specificity >= 0.5 && tempoLeft > 0) score += Math.min(c.at.tempo + c.at.sweetspot, tempoLeft) * 0.35;
      else score -= c.work * 0.3;
      score -= variety(w);
      if (score > bestScore) { bestScore = score; best = w; bestC = c; }
    }
    if (!best || !bestC) { unmet.push({ kind: 'ride', want: 'long', minutes: Math.round(want), short: Math.round(want), slotMinutes: s.minutes, setting: s.outdoor ? 'outdoor' : 'indoor', noCandidate: true }); return; }
    if (bestC.minutes < want * 0.85) unmet.push({ kind: 'ride', want: 'long', minutes: Math.round(want), short: Math.round(want - bestC.minutes), slotMinutes: s.minutes, setting: s.outdoor ? 'outdoor' : 'indoor', nearest: label(best) });
    const reason = longReason(needs, ctx, wantSec, bestC, k);
    place(s, best, needs.label === 'recovery' ? 'endurance' : 'long', reason);
    longDays.push(s.dow);
  });

  // ---- (2) Quality rides, hardest first, on the days that cost least. ----
  const cost = (s: Slot) => {
    let c = 0;
    const a = ctx.costs;
    if (hardDays.includes(prev(s.dow))) c += 0.5 + a.afterHard * 3;
    if (longDays.includes(prev(s.dow))) c += 0.5 + a.afterLong * 3;
    if (hardDays.includes(next(s.dow))) c += 0.5 + a.afterHard * 2;
    if (longDays.includes(next(s.dow))) c += 3;                      // never the day before the long ride, if anything else will do
    if (slotsIn.find((x) => x.dow === prev(s.dow))?.pin === 'strength') c += a.afterStrength * 3;
    if (s.minutes < 90) c += 0.5;
    return c;
  };
  for (let k = 0; k < needs.hardSessions; k++) {
    const cands = rideSlots.filter((s) => !rideDays.has(s.dow) && s.minutes >= 45);
    if (!cands.length) break;
    const s = [...cands].sort((x, y) => cost(x) - cost(y) || y.minutes - x.minutes)[0];
    if (hardDays.length > 0 && cost(s) >= 2.5) break;
    const isTest = needs.test && k === 0;
    const isOpenersDay = needs.openers && k === 0;
    let pick: Workout | null = null;
    let reason = '';
    let type: SessionType = 'endurance';
    if (isTest) {
      pick = testRide(rides, s, ctx);
      reason = 'A test first: it sets the numbers every target in the block is built on.';
      type = 'test';
    } else if (isOpenersDay) {
      const day = openersSlot(rideSlots, ctx.eventDate, rideDays) ?? s;
      pick = rides.find((w) => isOpeners(w) && contribution(w).minutes <= day.minutes + 2) ?? null;
      if (pick) {
        const eve = ctx.eventDate && addDaysIso(ctx.eventDate, -1) === day.date;
        place(day, pick, 'openers', eve ? 'The day before the event: short efforts to wake the legs without adding fatigue.' : 'Openers: short efforts that keep the legs awake for the event without adding fatigue.');
        hardDays.push(day.dow); continue;
      }
    }
    if (!pick) {
      const held = ctx.heldFamilies?.[k];
      const target = held && FAMILY_ABILITY[held] ? FAMILY_ABILITY[held]! : [...QUALITY_ABILITIES].reverse().find((a) => rem[a] >= 8);
      if (!target) break;
      const before = rem[target];
      const r = bestQuality(rides, s, target, rem, ctx, variety, okBasis, fitsSetting, sessions);
      if (!r) { unmet.push({ kind: 'ride', want: target, minutes: Math.round(before), short: Math.round(before), slotMinutes: s.minutes, setting: s.outdoor ? 'outdoor' : 'indoor', noCandidate: true }); continue; }
      pick = r;
      const c = contribution(r);
      // A Library gap only when no ride that fits the day could give what the day could hold of the ability
      // (the shopper may choose a ride that gives less of it for the week's sake; that is not a gap).
      const wanted = Math.min(before, Math.max(10, (s.minutes - 25) * 0.6), SESSION_CAP[target]);
      const bestPossible = Math.max(0, ...rides.filter((w) => HARD_FAMILIES.includes(w.family) && okBasis(w) && fitsSetting(w, s) && contribution(w).minutes <= s.minutes + 2).map((w) => contribution(w).at[target]));
      if (bestPossible < wanted * 0.85) {
        const near = rides.filter((w) => HARD_FAMILIES.includes(w.family) && okBasis(w) && fitsSetting(w, s) && contribution(w).minutes <= s.minutes + 2).sort((x, y) => contribution(y).at[target] - contribution(x).at[target])[0];
        unmet.push({ kind: 'ride', want: target, minutes: Math.round(wanted), short: Math.round(wanted - bestPossible), slotMinutes: s.minutes, setting: s.outdoor ? 'outdoor' : 'indoor', nearest: near ? label(near) : undefined });
      }
      void c;
      const what = c.dominant !== 'easy' && c.at[c.dominant] >= 5 ? c.dominant : target;
      reason = qualityReason(what, Math.max(Math.round(needs.minutes[what]), Math.round(c.at[what])));
      type = r.family as SessionType;
    }
    place(s, pick, type, reason);
    hardDays.push(s.dow);
  }

  // ---- (3) Strength, of the week's quality, alternating focus. ----
  const pinnedStrength = slots.filter((s) => s.pin === 'strength').map((s) => s.dow);
  const strengthCount = Math.max(needs.strength.count, pinnedStrength.length);
  const strengthCost = (s: Slot) => {
    let c = 0;
    const a = ctx.costs;
    if (hardDays.includes(s.dow)) c += 5;
    if (hardDays.includes(next(s.dow))) c += 1 + a.afterStrength * 3;
    if (longDays.includes(next(s.dow))) c += 0.5 + a.afterStrength * 2;
    if (longDays.includes(s.dow)) c += 2;
    if (rideDays.has(s.dow)) c += 1;
    if (strengthDays.includes(prev(s.dow)) || strengthDays.includes(next(s.dow))) c += 3;
    if (pinnedStrength.includes(s.dow)) c -= 6;
    return c;
  };
  for (let k = 0; k < strengthCount; k++) {
    const minNeed = 25;
    const cands = slots.filter((s) => !strengthDays.includes(s.dow) && !never(s, 'strength') && (ctx.may.strength || pinnedStrength.includes(s.dow)) && free(s) >= minNeed && (open(s) || pinnedStrength.includes(s.dow)));
    if (!cands.length) break;
    const s = [...cands].sort((x, y) => strengthCost(x) - strengthCost(y) || y.minutes - x.minutes)[0];
    if (strengthCost(s) >= 4 && !pinnedStrength.includes(s.dow)) break;
    const focus: StrengthFocus = k % 2 === 0 ? 'legs' : 'upper';
    const r = bestStrength(ctx, needs.strength.quality, focus, needs.strength.dose, free(s), variety);
    if (!r) { unmet.push({ kind: 'strength', want: needs.strength.quality, focus, minutes: 30, short: 30, slotMinutes: free(s), equipment: ctx.equipment, noCandidate: true }); continue; }
    if (r.mismatch) unmet.push({ kind: 'strength', want: needs.strength.quality, focus, minutes: Math.round(contribution(r.w).minutes), short: Math.round(contribution(r.w).minutes), slotMinutes: free(s), equipment: ctx.equipment, nearest: r.w.name });
    place(s, r.w, 'strength', strengthReason(r.w.strength!.quality, r.w.strength!.focus, r.w.strength!.dose ?? needs.strength.dose));
    strengthDays.push(s.dow);
  }

  // ---- (4) Aerobic fill: rides where the bike is available; walks or runs where it is not. ----
  const fills: Array<{ s: Slot; w: Workout; afterLong: boolean }> = [];
  const footOk = (s: Slot, kind: 'walk' | 'run') => {
    const pref = ctx.prefs[kind];
    if (s.pin === kind) return true;
    if (!ctx.may[kind] || never(s, kind)) return false;
    if (pref === 'needed') return s.noBike;
    return true;
  };
  for (const s of slots) {
    if (rideDays.has(s.dow) || !open(s)) continue;
    if (['walk', 'run', 'mobility', 'strength'].includes(s.pin ?? '')) continue;
    // A strength day takes an easy ride too when there is time left for one (the lifting first is fine either way).
    if (strengthDays.includes(s.dow) && free(s) < 40) continue;
    const afterLong = longDays.includes(prev(s.dow)) && ctx.costs.afterLong >= 0.4;
    const short = free(s) < 45;
    // A walk or run in place of a short ride, for a rider who prefers them.
    const walkInstead = s.minutes < 60 && s.pin !== 'ride' && ((ctx.prefs.walk === 'prefer' && ctx.may.walk && !never(s, 'walk')) || (ctx.prefs.run === 'prefer' && ctx.may.run && !never(s, 'run')));
    if (rideable(s) && (!short || s.pin === 'ride') && !walkInstead) {
      const w = fillRide(rides, { ...s, minutes: free(s) }, afterLong, 0, ctx, variety, okBasis, fitsSetting);
      if (!w) { unmet.push({ kind: 'ride', want: 'easy', minutes: s.minutes, short: s.minutes, slotMinutes: s.minutes, setting: s.outdoor ? 'outdoor' : 'indoor', noCandidate: true }); continue; }
      const reason = afterLong ? 'Easy spin the day after the long ride: long days leave a dent, so this one asks nothing.' : 'Easy riding: the rest of the week’s load, in zone 2.';
      place(s, w, w.family === 'recovery' ? 'recovery' : 'endurance', reason);
      fills.push({ s: { ...s, minutes: free(s) + contribution(w).minutes }, w, afterLong });
    }
  }

  // Foot days: runs first where allowed and safe, then walks.
  const runCap = needs.label === 'base' ? 2 : needs.label === 'taper' ? 0 : 1;
  let runs = 0;
  const qualityOn = (dow: number) => hardDays.includes(dow);
  const nearEvent = (s: Slot) => !!ctx.eventDate && s.date > addDaysIso(ctx.eventDate, -7);
  for (const s of slots) {
    if (rideDays.has(s.dow) || strengthDays.includes(s.dow) || free(s) < 20) continue;
    if (s.pin === 'mobility' || s.pin === 'strength') continue;
    const isRest = !open(s);
    if (isRest && s.pin !== 'walk' && s.pin !== 'run' && !(ctx.prefs.walk === 'prefer' && ctx.may.walk)) continue;
    const runOk = !isRest && footOk(s, 'run') && (s.pin === 'run' || (runs < runCap && !qualityOn(next(s.dow)) && !longDays.includes(prev(s.dow)) && !nearEvent(s)));
    if (runOk && (s.pin === 'run' || ctx.prefs.run !== 'needed' || s.noBike)) {
      const w = bestFoot(ctx.library.runs, Math.min(free(s), 60), variety);
      if (w) { place(s, w, 'run', footReason('run', s, w)); runs++; continue; }
      unmet.push({ kind: 'run', want: 'run', minutes: free(s), short: free(s), slotMinutes: free(s), noCandidate: true });
    }
    if (footOk(s, 'walk') || (isRest && ctx.may.walk)) {
      const recovery = isRest || longDays.includes(prev(s.dow));
      const wantPack = !recovery && needs.loadingProgress >= 0.3 && needs.label !== 'recovery' && needs.label !== 'taper';
      const w = bestWalk(ctx.library.walks, isRest ? Math.min(30, free(s)) : Math.min(free(s), 90), recovery, wantPack, variety);
      if (w) { place(s, w, 'walk', footReason('walk', s, w, isRest)); continue; }
      unmet.push({ kind: 'walk', want: 'walk', minutes: free(s), short: free(s), slotMinutes: free(s), noCandidate: true });
    }
  }

  // ---- (5) Mobility: after the long ride, after strength, then up to the week's floor. ----
  const mobilityOn = ctx.may.mobility;
  const mobilityFloor = !mobilityOn ? 0 : ctx.prefs.mobility === 'prefer' ? 45 : ctx.prefs.mobility === 'needed' ? 0 : needs.mobilityMinutes;
  let mobility = 0;
  const pairDays: Array<{ s: Slot; after: 'long' | 'strength' }> = [];
  if (needs.pairedMobility.afterLongRide) for (const d of longDays) pairDays.push({ s: byDow.get(d)!, after: 'long' });
  if (needs.pairedMobility.afterStrength) for (const d of strengthDays) pairDays.push({ s: byDow.get(d)!, after: 'strength' });
  for (const { s, after } of pairDays) {
    if (!mobilityOn || never(s, 'mobility') || sessions.some((x) => x.date === s.date && x.kind === 'mobility')) continue;
    const w = pairedMobility(ctx.library.mobility, after, variety);
    if (!w) { unmet.push({ kind: 'mobility', want: 'mobility', minutes: 12, short: 12, slotMinutes: 15, noCandidate: true }); continue; }
    mobility += contribution(w).minutes;
    sessions.push(sessionOf(s, w, 'mobility', after === 'long' ? 'Mobility after the long ride: hips, back and hamstrings while they are warm.' : 'Mobility after lifting: the hips and legs just worked.'));
    usedIds.add(w.libraryId ?? w.id);
  }
  for (const s of slots.filter((x) => x.pin === 'mobility')) {
    const w = floorMobility(ctx.library.mobility, Math.min(30, s.minutes), sessions, variety);
    if (w) { mobility += contribution(w).minutes; sessions.push(sessionOf(s, w, 'mobility', 'Your standing mobility day: the whole body, unhurried.')); usedIds.add(w.libraryId ?? w.id); take(s, contribution(w).minutes); }
  }
  // Up to the floor: rest days first, then any day with ten minutes to spare.
  const floorDays = [...slots].sort((a, b) => Number(open(a)) - Number(open(b)) || free(b) - free(a));
  for (const s of floorDays) {
    if (mobility >= mobilityFloor - 5) break;
    if (never(s, 'mobility') || sessions.some((x) => x.date === s.date && x.kind === 'mobility') || free(s) < 10) continue;
    const w = floorMobility(ctx.library.mobility, Math.min(free(s), Math.max(10, mobilityFloor - mobility + 5), 30), sessions, variety);
    if (!w) { unmet.push({ kind: 'mobility', want: 'mobility', minutes: Math.round(mobilityFloor - mobility), short: Math.round(mobilityFloor - mobility), slotMinutes: free(s), noCandidate: true }); break; }
    mobility += contribution(w).minutes;
    sessions.push(sessionOf(s, w, 'mobility', !open(s) ? 'A rest day with a little mobility: the week asks for some, and today has nothing else.' : 'Mobility: the week asks for some, and today has the time.'));
    usedIds.add(w.libraryId ?? w.id);
    take(s, contribution(w).minutes);
  }

  // ---- (6) Rebalance: swap the fill rides longer or shorter until the week is within 5% of its budget. ----
  const total = () => sessions.reduce((t, x) => t + x.tss, 0);
  for (let pass = 0; pass < 12 && fills.length && needs.budgetTss > 0; pass++) {
    const t = total();
    if (Math.abs(t - needs.budgetTss) <= needs.budgetTss * 0.05) break;
    let bestGain = 0, bestSwap: { f: (typeof fills)[number]; w: Workout } | null = null;
    for (const f of fills) {
      const cur = sessions.find((x) => x.date === f.s.date && x.workout === f.w)!;
      for (const w of fillAlternatives(rides, f.s, f.afterLong, ctx, okBasis, fitsSetting)) {
        if (w === f.w || (usedIds.has(w.id) && w.id !== f.w.id)) continue;
        const nt = t - cur.tss + Math.round(contribution(w).tss);
        const gain = Math.abs(t - needs.budgetTss) - Math.abs(nt - needs.budgetTss) - variety(w) * 0.05;
        if (gain > bestGain + 0.5) { bestGain = gain; bestSwap = { f, w }; }
      }
    }
    if (!bestSwap) break;
    const { f, w } = bestSwap;
    const i = sessions.findIndex((x) => x.date === f.s.date && x.workout === f.w);
    usedIds.delete(f.w.id); usedIds.add(w.id);
    const c = contribution(w);
    sessions[i] = { ...sessions[i], workout: w, seconds: Math.round(c.minutes * 60), tss: Math.round(c.tss), type: w.family === 'recovery' ? 'recovery' : 'endurance' };
    f.w = w;
  }
  const t = total();
  if (needs.budgetTss > 0 && t < needs.budgetTss * 0.9 && fills.length) unmet.push({ kind: 'ride', want: 'easy', minutes: Math.round((needs.budgetTss - t) / 0.7), short: Math.round((needs.budgetTss - t) / 0.7), slotMinutes: Math.max(...fills.map((f) => f.s.minutes)) });

  const order: Record<SessionKind, number> = { ride: 0, walk: 1, run: 1, strength: 2, mobility: 3, other: 4 };
  sessions.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
  return { sessions, unmet, restDates: [...new Set(restDates)].sort(), remaining: rem, tss: t };
}

// ---------------------------------------------------------------------------

function sessionOf(s: Slot, w: Workout, type: PlannedSession['type'], reason: string): PlannedSession {
  const c = contribution(w);
  return { date: s.date, kind: w.kind, type, workout: w, seconds: Math.round(c.minutes * 60), tss: Math.round(c.tss), reason };
}

const label = (w: Workout) => (w.subtitle ? `${w.name} (${w.subtitle})` : w.name);

function bestQuality(rides: Workout[], s: Slot, target: Ability, rem: Minutes, ctx: ShopContext, variety: (w: Workout) => number,
  okBasis: (w: Workout) => boolean, fitsSetting: (w: Workout, s: Slot) => boolean, already: PlannedSession[]): Workout | null {
  const lastFamily = [...already].reverse().find((x) => x.kind === 'ride' && HARD_FAMILIES.includes(x.workout.family))?.workout.family;
  const held = ctx.heldFamilies?.length ? ABILITY_FAMILY[target] : undefined;
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of rides) {
    if (!HARD_FAMILIES.includes(w.family) || isOpeners(w) || !okBasis(w) || !fitsSetting(w, s)) continue;
    if (held && w.family !== held) continue;
    const c = contribution(w);
    if (c.minutes > s.minutes + 2) continue;
    let gain = 0, over = 0;
    for (const a of QUALITY_ABILITIES) {
      gain += W[a] * Math.min(c.at[a], rem[a]);
      over += W[a] * Math.max(0, c.at[a] - rem[a]) * (a === 'tempo' || a === 'sweetspot' ? 0.5 : 1);
    }
    gain += W_EASY_IN_HARD * Math.min(c.at.easy, rem.easy);
    let score = gain - 0.6 * over + (c.dominant === target ? 12 : 0) - variety(w) - 0.04 * (s.minutes - c.minutes);
    if (c.dominant !== target && c.at[target] < 5) score -= 25;
    if (lastFamily && w.family === lastFamily) score -= 6;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function testRide(rides: Workout[], s: Slot, ctx: ShopContext): Workout | null {
  const tests = rides.filter((w) => w.family === 'test' && w.bases.includes(ctx.basis) && contribution(w).minutes <= s.minutes + 2);
  if (ctx.basis === 'hr') return tests.find((w) => w.id === 'lib-lthr-30') ?? tests[0] ?? null;
  if (s.outdoor) return tests.find((w) => w.setting !== 'indoor' && !w.trainerOnly && w.id === 'trail-20min-test') ?? tests.find((w) => !w.trainerOnly) ?? null;
  return tests.find((w) => w.test === 'ramp') ?? tests[0] ?? null;
}

function openersSlot(rideSlots: Slot[], eventDate: string | undefined, taken: Set<number>): Slot | undefined {
  if (!eventDate) return undefined;
  return [...rideSlots].filter((s) => s.date < eventDate && !taken.has(s.dow)).sort((a, b) => b.date.localeCompare(a.date))[0];
}

function fillAlternatives(rides: Workout[], s: Slot, afterLong: boolean, ctx: ShopContext, okBasis: (w: Workout) => boolean, fitsSetting: (w: Workout, s: Slot) => boolean): Workout[] {
  return rides.filter((w) => {
    if (!(w.family === 'endurance' || w.family === 'recovery') || isOpeners(w) || !okBasis(w) || !fitsSetting(w, s) || w.trainerOnly) return false;
    const c = contribution(w);
    if (c.minutes > s.minutes + 2) return false;
    if (afterLong) return w.family === 'recovery' && c.minutes <= 50;
    return c.minutes >= Math.min(30, s.minutes);
  });
}

function fillRide(rides: Workout[], s: Slot, afterLong: boolean, _want: number, ctx: ShopContext, variety: (w: Workout) => number,
  okBasis: (w: Workout) => boolean, fitsSetting: (w: Workout, s: Slot) => boolean): Workout | null {
  const alts = fillAlternatives(rides, s, afterLong, ctx, okBasis, fitsSetting);
  // Start a little under the slot (the rebalance grows or shrinks it): an easy day is not a long day.
  const target = afterLong ? 45 : Math.min(s.minutes, Math.max(45, Math.min(120, s.minutes * 0.8)));
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of alts) {
    const c = contribution(w);
    const score = -Math.abs(c.minutes - target) - variety(w) * 0.5 - (w.family === 'recovery' && !afterLong ? 10 : 0);
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best ?? (afterLong ? fillRide(rides, s, false, 0, ctx, variety, okBasis, fitsSetting) : null);
}

/** Fallback order when no session of the quality asked for exists for the rider's equipment. */
const QUALITY_FALLBACK: Record<StrengthQuality, StrengthQuality[]> = {
  heavy: ['stability', 'power', 'endurance'], power: ['heavy', 'stability', 'endurance'], endurance: ['stability', 'heavy', 'power'], stability: ['endurance', 'heavy', 'power'],
};

/**
 * The Library strength session for a quality, focus and level from the rider's equipment, avoiding
 * those in `avoid` where another will do: for moving older calendar entries onto Library sessions.
 */
export function pickStrength(library: Workout[], equipment: Equipment[], quality: StrengthQuality, focus: StrengthFocus, dose: WeekNeeds['strength']['dose'], avoid: Set<string>): Workout | null {
  const ctx = { library: { strength: library }, equipment } as unknown as ShopContext;
  return bestStrength(ctx, quality, focus, dose, 999, (w) => (avoid.has(w.id) ? 40 : 0))?.w ?? null;
}

function bestStrength(ctx: ShopContext, quality: StrengthQuality, focus: StrengthFocus, dose: WeekNeeds['strength']['dose'], freeMin: number, variety: (w: Workout) => number): { w: Workout; mismatch: boolean } | null {
  const pool = ctx.library.strength.filter((w) => w.strength && w.strength.needs.every((q) => ctx.equipment.includes(q)));
  const estimate = (minutes: number, effort: number) => estimateSessionTss({ kind: 'strength', minutes, effort });
  for (const [i, q] of [quality, ...QUALITY_FALLBACK[quality]].entries()) {
    const of = pool.filter((w) => w.strength!.quality === q);
    if (!of.length) continue;
    // The focus asked for first, then the other; within it, the session that needs the most of the rider's equipment (a barbell should be used), then variety.
    const ranked = [...of].sort((a, b) => Number(b.strength!.focus === focus) - Number(a.strength!.focus === focus) || variety(a) - variety(b) || b.strength!.needs.length - a.strength!.needs.length);
    for (const w of ranked) {
      const dosed = redose(w, dose, estimate);
      if (contribution(dosed).minutes <= freeMin + 5) return { w: { ...dosed, libraryId: w.id, id: w.id, source: 'library' }, mismatch: i > 0 || w.strength!.focus !== focus };
    }
    // Too long at this level: take the shortest level that fits rather than nothing.
    for (const lower of ['maintain', 'light'] as const) {
      const w = ranked[0];
      const dosed = redose(w, lower, estimate);
      if (contribution(dosed).minutes <= freeMin + 5) return { w: { ...dosed, libraryId: w.id, id: w.id, source: 'library' }, mismatch: true };
    }
  }
  return null;
}

function bestFoot(pool: Workout[], maxMin: number, variety: (w: Workout) => number): Workout | null {
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of pool) {
    const c = contribution(w);
    if (c.minutes > maxMin + 2 || c.work > 0) continue;               // the plan places easy runs only
    const score = -Math.abs(c.minutes - maxMin) - variety(w) * 0.5;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function bestWalk(pool: Workout[], maxMin: number, recovery: boolean, wantPack: boolean, variety: (w: Workout) => number): Workout | null {
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of pool) {
    const c = contribution(w);
    if (c.minutes > maxMin + 2) continue;
    const z = w.walk?.zoneHigh ?? 3;
    if (recovery && z > 3) continue;
    let score = -Math.abs(c.minutes - maxMin) - variety(w) * 0.5;
    if (recovery) score += c.recovery ? 10 : -5;
    else if ((w.walk?.zoneLow ?? 0) >= 2) score -= 4;                  // zone 2 and brisk walks are the rider's choice, not the plan's default
    if (wantPack && c.strengthEndurance) score += 6;
    if (!wantPack && c.packKg) score -= 3;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function pairedMobility(pool: Workout[], after: 'long' | 'strength', variety: (w: Workout) => number): Workout | null {
  const named = pool.find((w) => (after === 'long' ? /after the long ride/i : /after strength/i).test(w.name));
  if (named) return named;
  const want = after === 'long' ? ['hips', 'low-back', 'hamstrings'] : ['hips', 'glutes', 'quads'];
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of pool) {
    const c = contribution(w);
    if (c.minutes > 15) continue;
    const score = (c.targets ?? []).filter((t) => want.includes(t)).length * 3 - variety(w) - Math.abs(c.minutes - 12) * 0.3;
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

function floorMobility(pool: Workout[], maxMin: number, week: PlannedSession[], variety: (w: Workout) => number): Workout | null {
  const covered = new Set(week.filter((x) => x.kind === 'mobility').flatMap((x) => contribution(x.workout).targets ?? []));
  let best: Workout | null = null, bestScore = -Infinity;
  for (const w of pool) {
    const c = contribution(w);
    if (c.minutes > maxMin + 1 || c.minutes < Math.min(8, maxMin)) continue;
    const fresh = (c.targets ?? []).filter((t) => !covered.has(t)).length;
    const score = fresh * 3 + c.minutes * 0.3 - variety(w);
    if (score > bestScore) { bestScore = score; best = w; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One plain sentence per session, from the need. Never a word about fit, gaps or the Library.

export function hoursWords(minutes: number): string {
  const q = Math.round(minutes / 15) / 4;
  if (minutes < 55) return `${Math.round(minutes)} minutes`;
  if (q === 1) return 'an hour';
  const whole = Math.floor(q), frac = q - whole;
  const f = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
  return `${whole}${f} hours`;
}

function longReason(needs: WeekNeeds, ctx: ShopContext, wantSec: number, c: Contribution, k: number): string {
  if (needs.label === 'recovery') return 'Recovery week: the long ride stays so the body remembers, shorter and easy.';
  if (needs.label === 'taper') return 'Taper: enough riding to stay sharp, not enough to add fatigue.';
  const tempo = c.at.tempo + c.at.sweetspot >= 10 ? ', with tempo late' : '';
  const second = k ? 'The second long day of the week' : 'The long ride';
  if (ctx.requiredLongest && !k) return `${second}${tempo}: this week asks for ${hoursWords(wantSec / 60)}, building toward ${hoursWords(ctx.requiredLongest / 60)} before the taper.`;
  return `${second}${tempo}: this week asks for ${hoursWords(wantSec / 60)}. Steady zone 2, fuel from the first half hour.`;
}

function qualityReason(a: Ability, minutes: number): string {
  switch (a) {
    case 'tempo': return `Tempo: this week asks for ${minutes} minutes at tempo, brisk but sustainable.`;
    case 'sweetspot': return `Sweet spot: this week asks for ${minutes} minutes just under FTP.`;
    case 'threshold': return `Threshold work: this week asks for ${minutes} minutes at FTP.`;
    case 'vo2': return `VO2max work: this week asks for ${minutes} minutes above FTP.`;
    case 'anaerobic': return `Short, sharp efforts: this week asks for ${minutes} minutes well above FTP.`;
    default: return 'Easy riding.';
  }
}

export function strengthReason(q: StrengthQuality, focus: StrengthFocus, dose: WeekNeeds['strength']['dose']): string {
  const what = `${QUALITY_LABEL[q]}, ${FOCUS_WORDS[focus]}, at ${DOSE_WORDS[dose]} level`;
  if (dose === 'light') return `${what}: a lighter week, so nothing is lost and nothing is added to fatigue.`;
  if (dose === 'foundation') return `${what}: early in the block, moderate loads to learn the movements before the weights go up.`;
  if (dose === 'maintain') return `${what}: two sets keep what was built while the riding is hard.`;
  switch (q) {
    case 'heavy': return `${what}: heavier work while the riding is mostly steady; this is when strength is built.`;
    case 'power': return `${what}: the block is moving from heavy lifting toward speed.`;
    case 'endurance': return `${what}: late in the block, for legs and a trunk that last the whole day.`;
    default: return `${what}: one side at a time, to even out the legs.`;
  }
}

function footReason(kind: 'walk' | 'run', s: Slot, w: Workout, rest = false): string {
  const m = contribution(w).minutes;
  if (rest) return 'A recovery walk on a rest day: blood through the legs, nothing asked of them.';
  if (s.pin === kind) return kind === 'walk' ? 'Your standing walk day: easy aerobic work on foot.' : 'Your standing run day: easy, by heart rate.';
  const on = `${kind === 'walk' ? 'An easy' : 'An easy run of'} ${hoursWords(m).replace(/^an /, '')}${kind === 'walk' ? ' on foot' : ''}`;
  if (s.noBike) return `${on}: no bike today.`;
  return `${on}: too short a window for a ride worth doing.`;
}

function addDaysIso(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
