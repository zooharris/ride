import type { Fitness, PlannedWorkout, Profile, Ride, Wellness } from '../engine/types';
import { addDays, fitnessSeries, today } from '../engine/load';
import { readiness, type Readiness } from '../engine/readiness';

/** Fitness series from stored rides, from 120 days ago to today. */
export function fitnessFromRides(rides: Ride[], to = today()): Fitness[] {
  const from = addDays(to, -120);
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

export function weekStart(date: string, firstDay = 1): string {
  const d = new Date(date + 'T00:00:00');
  const diff = (d.getDay() - firstDay + 7) % 7;
  return addDays(date, -diff);
}

export function plannedOn(planned: PlannedWorkout[], date: string): PlannedWorkout[] {
  return planned.filter((p) => p.date === date);
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

