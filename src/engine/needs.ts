import type { Assessment } from './assessment';
import type { Demand, EventType, Goal } from './goals';
import type { Availability, Phase } from './planner';
import type { StrengthDose, StrengthQuality } from './types';
import { zeroMinutes, QUALITY_ABILITIES, type Ability, type Minutes } from './contribution';

/**
 * The plan engine, step one (30 Oct 2026): what each week needs.
 *
 * A week has a load budget and a shopping list of amounts: easy hours, minutes
 * at tempo, sweet spot, threshold, VO2 and anaerobic, the longest ride,
 * strength (which quality, how much), mobility, foot work and rest. The goal
 * sets the destination and how the list changes week to week; the rider's
 * data set the start and the safe rate of climb; the rider's week shapes what
 * fits. The shopper (shop.ts) then fills the list from the Library.
 *
 * Every number a person might want to change is in the tables below.
 */

export interface WeekNeeds {
  index: number;               // 0-based week of the plan
  start: string;               // its Monday
  label: Phase;                // descriptive only: base, build, peak, taper, recovery
  budgetTss: number;
  budgetHours: number;
  /** Minutes at each ability: quality work (and easy, as what is left of the budget at an easy pace). */
  minutes: Minutes;
  longRideSeconds: number;     // 0 when none wanted
  /** A second long ride, when two big days exist, the goal rewards durability and long days cost the rider little. */
  secondLongRideSeconds: number;
  /** How many hard ride days the week can carry. */
  hardSessions: number;
  /** A test this week (FTP not verified), carried by the first hard day. */
  test: boolean;
  /** Openers the day before the event (the final taper week). */
  openers: boolean;
  strength: { quality: StrengthQuality; dose: StrengthDose; count: number };
  mobilityMinutes: number;
  pairedMobility: { afterLongRide: boolean; afterStrength: boolean };
  /** Walk or run minutes that may stand in for easy riding on days the bike is out. */
  footAerobicMinutes: number;
  restDays: number;
  /** How far the specific work has come, 0.3 at the start of the loading weeks to 1 at the end. */
  specificity: number;
  /** Share of the loading weeks behind this one, 0..1. */
  loadingProgress: number;
  /** Most of the week is away: kept light. */
  mostlyAway: boolean;
}

// ---------------------------------------------------------------------------
// Destinations. For each goal: the weekly quality minutes the last loading
// weeks should reach, any that arrive only late in the block, and the strength
// quality by block position (first, middle and last third of the loading weeks).

interface Destination {
  /** Weekly minutes at each ability by the end of the loading weeks, for a rider with the time. */
  dest: Partial<Minutes>;
  /** Added only from `lateFrom` of the way through the loading weeks. */
  late?: Partial<Minutes>;
  lateFrom?: number;
  /** What the first loading weeks lean on before the specific work takes over. */
  base?: Partial<Minutes>;
  /** Strength quality in the first, middle and last third of the loading weeks. */
  strength: [StrengthQuality, StrengthQuality, StrengthQuality];
  /** Specificity held fixed (general fitness), or switched on after a tune-up (VO2max). */
  fixedSpecificity?: number;
  tuneUpWeeks?: number;
  /** Strength sessions a week in loading weeks, overriding the phase rule (weight loss keeps two throughout). */
  strengthCount?: number;
  /** Strength dose in loading weeks, overriding the phase rule. */
  strengthDose?: StrengthDose;
}

const BASE: Partial<Minutes> = { tempo: 25, sweetspot: 30 };

export const EVENT_DESTINATIONS: Record<EventType, Destination> = {
  century:      { dest: { tempo: 40, sweetspot: 40, threshold: 10 },                      strength: ['heavy', 'power', 'endurance'] },
  'gran-fondo': { dest: { tempo: 30, sweetspot: 40, threshold: 30 }, late: { vo2: 12 },    strength: ['heavy', 'power', 'endurance'] },
  climbing:     { dest: { tempo: 20, sweetspot: 30, threshold: 45 }, late: { vo2: 15 },    strength: ['heavy', 'power', 'endurance'] },
  'time-trial': { dest: { tempo: 20, sweetspot: 30, threshold: 50 }, late: { vo2: 12 },    strength: ['heavy', 'power', 'endurance'] },
  'group-ride': { dest: { tempo: 30, threshold: 25, vo2: 15 }, late: { vo2: 5, anaerobic: 8 }, strength: ['heavy', 'power', 'power'] },
  'multi-day':  { dest: { tempo: 45, sweetspot: 30, threshold: 10 },                      strength: ['heavy', 'power', 'endurance'] },
  other:        { dest: { tempo: 25, sweetspot: 35, threshold: 25 }, late: { vo2: 10 },    strength: ['heavy', 'power', 'endurance'] },
};

export const GOAL_DESTINATIONS: Record<Exclude<Goal['kind'], 'event' | 'general'>, Destination> = {
  // Raise FTP: threshold and sweet spot, with VO2 in the last third to lift the ceiling.
  ftp:       { dest: { sweetspot: 40, threshold: 50 }, late: { vo2: 12 }, lateFrom: 0.67, strength: ['heavy', 'heavy', 'heavy'] },
  // Raise VO2max: three weeks of base, then VO2 work most weeks.
  vo2max:    { dest: { sweetspot: 20, threshold: 15, vo2: 28, anaerobic: 5 }, tuneUpWeeks: 3, strength: ['power', 'power', 'power'] },
  // Ride longer: the long ride grows; tempo makes the pace feel easy.
  endurance: { dest: { tempo: 40, sweetspot: 20, threshold: 10 }, strength: ['heavy', 'heavy', 'endurance'] },
  // Lose weight: easy hours as many as the budget holds, some tempo; strength twice a week throughout.
  weight:    { dest: { tempo: 30, sweetspot: 20 }, base: { tempo: 30 }, strength: ['heavy', 'heavy', 'heavy'], strengthCount: 2, strengthDose: 'build' },
};

/** General fitness: a balanced mix that rotates every three weeks, at a steady climb. */
const GENERAL_ROTATION: Array<Partial<Minutes>> = [
  { tempo: 25, sweetspot: 30 },
  { sweetspot: 20, threshold: 30 },
  { threshold: 15, vo2: 15, anaerobic: 4 },
];
const GENERAL_STRENGTH: StrengthQuality[] = ['heavy', 'power', 'stability', 'endurance'];

/** The limiter the data flag gets a quarter more of its own ability. */
const LIMITER_ABILITY: Partial<Record<Assessment['limiters'][number], Ability>> = { threshold: 'threshold', vo2max: 'vo2', anaerobic: 'anaerobic' };

/** Share of a week's hours that may be quality work, and the bounds. */
const QUALITY_SHARE = 0.22, QUALITY_MIN = 25, QUALITY_MAX = 130;
/** TSS per minute of easy riding (intensity 0.65). */
export const EASY_TSS_PER_MIN = 0.65 * 0.65 * 100 / 60;

export function destinationOf(goal: Goal): Destination {
  if (goal.kind === 'event') return EVENT_DESTINATIONS[goal.eventType];
  if (goal.kind === 'general') return { dest: GENERAL_ROTATION[0], strength: ['heavy', 'power', 'stability'], fixedSpecificity: 0.6 };
  return GOAL_DESTINATIONS[goal.kind];
}

export interface NeedsInput {
  goal: Goal;
  demand: Demand;
  assessment: Assessment;
  availability: Availability;   // normalized
  seq: Phase[];
  masters: boolean;
  start: string;                 // Monday of week 0
  /** Weeks already gone (re-check): they count for where each block stands but are not budgeted. */
  pastWeeks: number;
  /** Days away per week. */
  awayDays: number[];
  /** Minutes of riding the rider can give each week (the rideable slots). */
  capMinutes: number;
  /** Rideable days, and the two biggest, in minutes. */
  rideDays: number;
  bigSlots: number[];
  /** Days with any time, for foot work and rest. */
  daysWithTime: number;
  footMinutes: number;
}

export interface NeedsResult { weeks: WeekNeeds[]; decisions: string[]; ramp: number; maxRamp: number; needRamp: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/** The week-by-week list for the whole plan. Weeks before `pastWeeks` are present but empty (budget 0). */
export function planNeeds(inp: NeedsInput): NeedsResult {
  const { goal, demand: d, assessment: a, seq, masters } = inp;
  const av = inp.availability;
  const decisions: string[] = [];
  const dest = destinationOf(goal);

  // Load trajectory. Fitness moves by (daily load - fitness) / 42 each day, so a week averaging D a day moves
  // it by about (D - fitness) / 6; to climb by Δ in a week needs D = fitness + 6Δ. The climb is capped for
  // safety and raised a little when the evidence says the rider absorbs load well.
  const ctl0 = a.fitness.ctl;
  const isLoading = (p: Phase) => p === 'base' || p === 'build' || p === 'peak';
  const loadingWeeks = seq.filter(isLoading).length;
  const loadingLeft = seq.slice(inp.pastWeeks).filter(isLoading).length;
  let maxRamp = masters ? 4 : 6;
  if (a.afterLongRide.confidence !== 'none' && a.afterLongRide.value < 0.2 && a.compliance.value >= 0.8) maxRamp += 1;
  if (a.rampRate.confidence === 'good' && a.rampRate.value > maxRamp) maxRamp = Math.min(maxRamp + 2, a.rampRate.value);
  const needRamp = d.requiredCtl ? (d.requiredCtl - ctl0) / Math.max(1, loadingLeft) : 2.5;
  const ramp = Math.max(1, Math.min(maxRamp, needRamp));
  const capTss = inp.capMinutes / 60 * 62;
  const flat = a.afterLongRide.confidence === 'good' && a.afterLongRide.value >= 0.6 && a.afterHardRide.confidence === 'good' && a.afterHardRide.value >= 0.6;
  const loadScale = flat ? 0.9 : 1;

  const startLongest = Math.max(90, Math.round((a.longestRide.confidence === 'none' ? 7200 : a.longestRide.value) / 60));
  const targetLongest = d.requiredLongest ? Math.round(d.requiredLongest / 60) : Math.round(Math.max(startLongest, inp.bigSlots[0] ?? 60));
  const afterLongPenalty = a.afterLongRide.confidence === 'none' ? 0.3 : a.afterLongRide.value;
  const limiter = LIMITER_ABILITY[a.limiters[0]];

  const weeks: WeekNeeds[] = [];
  let ctl = ctl0;
  let lastLoading = Math.max(a.weeklyTss.value, ctl0 * 7);
  let loadingSeen = 0;
  let phaseIdx = 0;
  let lastPhase: Phase | null = null;
  const taperCount = seq.filter((p) => p === 'taper').length;

  seq.forEach((phase, i) => {
    phaseIdx = phase === lastPhase ? phaseIdx + 1 : 0;
    lastPhase = phase;
    const start = addDaysIso(inp.start, i * 7);
    const loadingProgress = loadingWeeks > 1 ? loadingSeen / (loadingWeeks - 1) : 1;
    if (i < inp.pastWeeks) {
      if (isLoading(phase)) loadingSeen++;
      weeks.push(emptyWeek(i, start, phase, loadingProgress));
      return;
    }
    const awayDays = inp.awayDays[i] ?? 0;
    const mostlyAway = awayDays >= 5 || (awayDays > 0 && inp.daysWithTime - awayDays <= 2);

    let budgetTss: number;
    if (mostlyAway && phase !== 'recovery' && phase !== 'taper') budgetTss = lastLoading * 0.6;
    else if (phase === 'recovery') budgetTss = lastLoading * 0.6;
    else if (phase === 'taper') budgetTss = lastLoading * (phaseIdx === 0 && taperCount === 2 ? 0.55 : 0.45);
    else { ctl += ramp; budgetTss = Math.min(capTss, 7 * (ctl + 6 * ramp)) * loadScale; lastLoading = budgetTss; loadingSeen++; }
    const budgetHours = Math.min(inp.capMinutes / 60, budgetTss / 55);

    // Specificity: how far the work has moved from general (tempo, sweet spot) to what the goal rewards.
    let specificity = dest.fixedSpecificity ?? 0.3 + 0.7 * loadingProgress;
    if (dest.tuneUpWeeks != null) specificity = loadingSeen <= dest.tuneUpWeeks ? 0.15 : 1;

    // Quality minutes.
    const minutes = zeroMinutes();
    const target = goal.kind === 'general' ? GENERAL_ROTATION[Math.floor(i / 3) % GENERAL_ROTATION.length] : dest.dest;
    const base = dest.base ?? BASE;
    for (const ab of QUALITY_ABILITIES) minutes[ab] = lerp(base[ab] ?? 0, target[ab] ?? 0, specificity);
    if (dest.late && loadingProgress >= (dest.lateFrom ?? 0.5)) for (const ab of QUALITY_ABILITIES) minutes[ab] += dest.late[ab] ?? 0;
    // The limiter the data flag: a quarter more of its ability, or, when the goal asks for none of it, a little
    // from a third of the way in (a higher FTP makes every easy ride cheaper, whatever the goal).
    if (limiter) {
      if (minutes[limiter] > 0) minutes[limiter] *= 1.25;
      else if (loadingProgress >= 0.3) minutes[limiter] = limiter === 'threshold' ? 20 : 10;
    }
    if (ctl0 < 30) for (const ab of QUALITY_ABILITIES) minutes[ab] *= lerp(0.75, 1, loadingProgress);
    if (phase === 'recovery' || mostlyAway) for (const ab of QUALITY_ABILITIES) minutes[ab] *= 0.3;
    if (phase === 'taper') for (const ab of QUALITY_ABILITIES) minutes[ab] *= 0.45;
    // Never more quality than the week's hours can carry.
    const cap = Math.max(QUALITY_MIN, Math.min(QUALITY_MAX, budgetHours * 60 * QUALITY_SHARE));
    const total = QUALITY_ABILITIES.reduce((s, ab) => s + minutes[ab], 0);
    if (total > cap) for (const ab of QUALITY_ABILITIES) minutes[ab] *= cap / total;
    for (const ab of QUALITY_ABILITIES) { minutes[ab] = Math.round(minutes[ab]); if (minutes[ab] < 8) minutes[ab] = 0; }
    const quality = QUALITY_ABILITIES.reduce((s, ab) => s + minutes[ab], 0);

    // Hard days: by how much quality there is, never more than the ride days allow around the long ride.
    const test = i === 0 && a.ftpStatus.value !== 'fresh' && goal.kind !== 'weight';
    let hard = quality <= 0 ? 0 : quality <= 45 ? 1 : quality <= 100 ? 2 : 3;
    if (hard === 3 && (masters || inp.rideDays < 5)) hard = 2;
    hard = Math.min(hard, Math.max(inp.rideDays <= 3 ? 1 : 0, inp.rideDays - 2));
    if (phase === 'recovery' || phase === 'taper') hard = Math.min(hard, 1);
    if (test) hard = Math.max(1, hard);
    const openers = phase === 'taper' && goal.kind === 'event' && phaseIdx === taperCount - 1;

    // The long ride grows from where the rider is toward what the goal wants.
    let longMin = phase === 'recovery' ? Math.min(100, startLongest) : phase === 'taper' ? Math.min(120, targetLongest * 0.5) : Math.round(lerp(startLongest, targetLongest, loadingProgress));
    longMin = Math.min(longMin, inp.bigSlots[0] ?? 0);
    if (mostlyAway) longMin = Math.min(longMin, 120);
    const twoLongs = (inp.bigSlots[1] ?? 0) >= 120 && d.emphasis.durability >= 0.8 && afterLongPenalty < 0.45 && phase !== 'taper' && phase !== 'recovery' && !mostlyAway;
    const secondLong = twoLongs ? Math.round(Math.min(inp.bigSlots[1], longMin * (1 - afterLongPenalty))) : 0;

    // Strength: how many, how heavy, and what kind.
    const may = av.may!;
    let count = !may.strength ? 0 : phase === 'base' ? 2 : phase === 'build' ? (masters ? 2 : 1) : phase === 'peak' ? 1 : phase === 'taper' ? (phaseIdx === 0 ? 1 : 0) : 1;
    let dose: StrengthDose = phase === 'base' ? (phaseIdx < 2 && i < 4 ? 'foundation' : 'build') : phase === 'build' ? (hard >= 2 ? 'maintain' : 'build') : phase === 'recovery' || phase === 'taper' ? 'light' : 'maintain';
    if (dest.strengthCount && may.strength && isLoading(phase)) count = dest.strengthCount;
    if (dest.strengthDose && isLoading(phase) && dose !== 'foundation') dose = dest.strengthDose;
    const third = Math.min(2, Math.floor(loadingProgress * 3));
    const sQuality: StrengthQuality = goal.kind === 'general' ? GENERAL_STRENGTH[Math.floor(i / 3) % GENERAL_STRENGTH.length] : dest.strength[third];

    // Easy: what is left of the budget once the quality, the long ride and the strength are counted, at an easy pace.
    const qualityTss = quality * 1.25 + hard * 20;   // the work and each hard day's warm-up and cool-down
    const longTss = (longMin + secondLong) * EASY_TSS_PER_MIN;
    const strengthTss = count * 25;
    minutes.easy = Math.max(0, Math.round((budgetTss - qualityTss - longTss - strengthTss) / EASY_TSS_PER_MIN));

    const restBase = masters ? 2 : 1;
    const restDays = Math.min(3, restBase + (phase === 'recovery' || phase === 'taper' ? 1 : 0));

    weeks.push({
      index: i, start, label: phase, budgetTss: Math.round(budgetTss), budgetHours: Math.round(budgetHours * 10) / 10, minutes,
      longRideSeconds: Math.max(0, Math.round(longMin * 60)), secondLongRideSeconds: secondLong * 60, hardSessions: hard, test, openers,
      strength: { quality: sQuality, dose, count },
      mobilityMinutes: may.mobility ? 30 : 0,
      pairedMobility: { afterLongRide: may.mobility && phase !== 'taper', afterStrength: may.mobility },
      footAerobicMinutes: may.walk || may.run ? inp.footMinutes : 0,
      restDays, specificity: Math.round(specificity * 100) / 100, loadingProgress, mostlyAway,
    });
  });

  decisions.push(`Fitness ${d.requiredCtl ? `needs to rise from ${Math.round(ctl0)} toward ${d.requiredCtl}` : `starts at ${Math.round(ctl0)}`}; the plan climbs about ${ramp.toFixed(1)} points a week (cap ${maxRamp}${maxRamp > (masters ? 4 : 6) ? ', raised because your recovery data look good' : ''}).`);
  if (needRamp > maxRamp) decisions.push(`The goal would want ${needRamp.toFixed(1)} a week, which is more than is safe; the verdict below says what that means.`);
  if (flat) decisions.push(`Weekly load is set 10% under what the climb would ask: your mornings after long rides (score ${a.afterLongRide.value.toFixed(2)}) and after hard rides (${a.afterHardRide.value.toFixed(2)}) are clearly flatter than your baseline, and easy days follow hard ones. If those scores improve, the plan removes the discount when it re-checks.`);
  return { weeks, decisions, ramp, maxRamp, needRamp };
}

function emptyWeek(index: number, start: string, label: Phase, loadingProgress: number): WeekNeeds {
  return { index, start, label, budgetTss: 0, budgetHours: 0, minutes: zeroMinutes(), longRideSeconds: 0, secondLongRideSeconds: 0, hardSessions: 0, test: false, openers: false,
    strength: { quality: 'heavy', dose: 'light', count: 0 }, mobilityMinutes: 0, pairedMobility: { afterLongRide: false, afterStrength: false }, footAerobicMinutes: 0, restDays: 0,
    specificity: 0, loadingProgress, mostlyAway: false };
}

function addDaysIso(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DOSE_LABEL: Record<StrengthDose, string> = { foundation: 'Foundation', build: 'Build', maintain: 'Maintain', light: 'Light' };
