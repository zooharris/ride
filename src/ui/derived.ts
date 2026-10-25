import type { Fitness, PlannedWorkout, Profile, Ride, Wellness } from '../engine/types';
import { addDays, fitnessSeries, historyStart, isoDate, today } from '../engine/load';
import { readiness, type Readiness } from '../engine/readiness';

/** Fitness series from stored activities, from the start of the history (see historyStart) to today. */
export function fitnessFromRides(rides: Ride[], to = today()): Fitness[] {
  const from = historyStart(rides.map((r) => r.date), to);
  const loads = rides.filter((r) => r.date >= from).map((r) => ({ date: r.date, tss: r.tss ?? 0 }));
  return fitnessSeries(loads, from, to);
}

export function fitnessOn(series: Fitness[], date: string): Fitness | undefined {
  return series.find((f) => f.date === date) ?? series[series.length - 1];
}

export function readinessToday(wellness: Wellness[], fitness: Fitness | undefined, date = today()): Readiness {
  const todayW = wellness.find((w) => w.date === date);
  const baseline = wellness.filter((w) => w.date < date && w.date >= addDays(date, -14));
  return readiness(todayW, baseline, fitness?.tsb ?? 0);
}

/** The rider's first day of the week (0 Sunday, 1 Monday), set from the profile when it loads. */
let FIRST_DAY: 0 | 1 = 1;
export function setFirstDay(d: 0 | 1): void { FIRST_DAY = d; }
export function firstDay(): 0 | 1 { return FIRST_DAY; }
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekday numbers (JS style, 0 = Sunday) in the rider's display order. */
export function dayOrder(): number[] { return [0, 1, 2, 3, 4, 5, 6].map((i) => (i + FIRST_DAY) % 7); }

export function weekStart(date: string, first: number = FIRST_DAY): string {
  const d = new Date(date + 'T00:00:00');
  const diff = (d.getDay() - first + 7) % 7;
  return addDays(date, -diff);
}

export function plannedOn(planned: PlannedWorkout[], date: string, kindOf?: (workoutId: string) => string): PlannedWorkout[] {
  const order: Record<string, number> = { ride: 0, walk: 1, strength: 2, mobility: 3, other: 4 };
  const list = planned.filter((p) => p.date === date);
  return kindOf ? list.sort((a, b) => (order[kindOf(a.workoutId)] ?? 0) - (order[kindOf(b.workoutId)] ?? 0)) : list;
}

export function missedThisWeek(planned: PlannedWorkout[], date = today()): number {
  const ws = weekStart(date);
  return planned.filter((p) => p.date >= ws && p.date < date && p.status === 'missed').length;
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }): string {
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, opts);
}

export function distance(m: number | undefined, profile: Profile): string {
  if (!m) return '';
  return profile.units === 'imperial' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}

export function elevation(m: number | undefined, profile: Profile): string {
  if (!m) return '';
  return profile.units === 'imperial' ? `${Math.round(m * 3.281)} ft` : `${Math.round(m)} m`;
}


/**
 * The days offered as one-tap moves for a session on `current`: today, tomorrow
 * and the days after, `n` in all, leaving out the day it is already on.
 */
export function quickMoveDays(current: string, n = 6, from = today()): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < n && i < n + 1; i++) { const d = addDays(from, i); if (d !== current) out.push(d); }
  return out;
}

/** A short label for a one-tap move: Today, Tomorrow, then "Thu 22". */
export function quickMoveLabel(date: string, from = today()): string {
  if (date === from) return 'Today';
  if (date === addDays(from, 1)) return 'Tomorrow';
  return `${DAY_SHORT[new Date(date + 'T00:00:00').getDay()]} ${Number(date.slice(8))}`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * When this device last pulled from Intervals.icu, in words for Today's header:
 * "10:47" today, "yesterday 18:02", "Thu 21 Oct" when older. Undefined when never.
 */
export function whenText(iso: string | undefined, now: Date): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return undefined;
  const day = isoDate(t), todayIso = isoDate(now);
  if (day === todayIso) return clock(t);
  if (day === addDays(todayIso, -1)) return `yesterday ${clock(t)}`;
  return `${WEEKDAY[t.getDay()]} ${t.getDate()} ${MONTH[t.getMonth()]}`;
}

/** The line under Today's Sync button, and whether to show it in the error colour. */
export function syncLine(s: { last?: string; errorAt?: string; running: boolean }, now: Date): { text: string; failed: boolean } {
  if (s.running) return { text: 'Syncing…', failed: false };
  const when = whenText(s.last, now);
  const failed = !!s.errorAt && (!s.last || s.errorAt > s.last);
  if (!when) return { text: failed ? 'Not synced yet · the latest attempt failed' : 'Not synced yet', failed };
  return { text: `Last synced ${when}${failed ? ' · the latest attempt failed' : ''}`, failed };
}

const MISSING_WORD: Record<'HRV' | 'Sleep' | 'Resting HR', string> = { HRV: 'HRV', Sleep: 'sleep', 'Resting HR': 'resting heart rate' };
const listWords = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The sentence the readiness panel shows when the score does not rest on every input:
 * set aside by the rider's note, waiting for the morning's numbers, or missing some of them.
 * Undefined when nothing is missing.
 */
export function missingText(r: { missing: Array<'HRV' | 'Sleep' | 'Resting HR'>; formOnly: boolean }, setAside: boolean): string | undefined {
  if (setAside) return "Today's numbers are set aside (your note). This score is from form alone.";
  if (!r.missing.length) return undefined;
  const words = r.missing.map((m) => MISSING_WORD[m]);
  const verb = words.length === 1 ? "hasn't" : "haven't";
  if (r.formOnly) return `This morning's ${listWords(words)} ${verb} arrived yet. This score is from form alone.`;
  return `${capital(listWords(words))} ${verb} arrived yet; the score uses the rest.`;
}

/**
 * How Today lays out the day: the first undone ride as the big card (the first ride when every
 * ride is done), and everything else, other rides first, under Also today. `rideCount` lets the
 * page say "Ride 1 of 2" when there is more than one.
 */
export function splitToday<T extends { p: { status: string }; w?: { kind: string } }>(withW: T[]): { hero?: T; rest: T[]; rideCount: number } {
  const rides = withW.filter((x) => x.w?.kind === 'ride');
  const hero = rides.find((x) => x.p.status !== 'completed') ?? rides[0];
  const rest = withW.filter((x) => x !== hero);
  const ordered = [...rest.filter((x) => x.w?.kind === 'ride'), ...rest.filter((x) => x.w?.kind !== 'ride')];
  return { hero, rest: ordered, rideCount: rides.length };
}

/** "today's", "tomorrow's", or "Thu 29 Oct's": for "… is already on today's calendar." */
export function dayPossessive(date: string, from = today()): string {
  if (date === from) return "today's";
  if (date === addDays(from, 1)) return "tomorrow's";
  const d = new Date(date + 'T00:00:00');
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}'s`;
}
