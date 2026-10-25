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
