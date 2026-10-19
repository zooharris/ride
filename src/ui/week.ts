import type { Fitness, PlannedWorkout, Ride, SessionKind, Workout } from '../engine/types';
import { addDays, fitnessSeries } from '../engine/load';
import { workoutStats } from '../engine/workout';
import { findWorkout } from './store';

/** Planned training stress of a workout: rides from their steps, everything else from its estimate. */
export function plannedTss(w: Workout): number {
  return w.kind === 'ride' ? workoutStats(w.blocks).tss : (w.estimatedTss ?? 0);
}

/** Planned length of a workout in minutes. */
export function plannedMinutes(w: Workout): number {
  return w.kind === 'ride' ? Math.round(workoutStats(w.blocks).seconds / 60) : (w.minutes ?? w.walk?.minutes ?? 0);
}

export interface DaySession {
  kind: SessionKind;
  minutes: number;
  tss: number;
  status: 'planned' | 'sent' | 'completed' | 'missed' | 'unscheduled';
  name: string;
}

export interface WeekSummary {
  start: string;
  days: Array<{ date: string; sessions: DaySession[] }>;
  plannedTss: number;            // everything on the calendar for the week, any status
  doneTss: number;               // what was recorded (all activities in the week)
  plannedMinutes: number;
  doneMinutes: number;
  sessionsPlanned: number;
  sessionsDone: number;
  /** Done and planned TSS by kind, for the stacked bar. */
  byKind: Record<SessionKind, { done: number; planned: number }>;
}

const KINDS: SessionKind[] = ['ride', 'strength', 'walk', 'mobility', 'other'];

/**
 * One week of the calendar read as numbers: what was planned (every session on
 * the calendar, whatever happened to it) against what was done (every recorded
 * activity, planned or not). A session logged by hand with no recording counts
 * as done at its planned load.
 */
export function weekSummary(ws: string, planned: PlannedWorkout[], rides: Ride[], mine: Workout[]): WeekSummary {
  const end = addDays(ws, 6);
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { done: 0, planned: 0 }])) as WeekSummary['byKind'];
  const days: WeekSummary['days'] = [];
  let pT = 0, dT = 0, pM = 0, dM = 0, sP = 0, sD = 0;
  const weekRides = rides.filter((r) => r.date >= ws && r.date <= end);
  for (let i = 0; i < 7; i++) {
    const date = addDays(ws, i);
    const sessions: DaySession[] = [];
    for (const p of planned.filter((x) => x.date === date)) {
      const w = findWorkout(mine, p.workoutId);
      if (!w) continue;
      const tss = plannedTss(w), minutes = plannedMinutes(w);
      const rec = p.activityId ? weekRides.find((r) => r.id === p.activityId) : undefined;
      sessions.push({ kind: w.kind, minutes: rec ? Math.round(rec.seconds / 60) : (p.loggedSeconds ? Math.round(p.loggedSeconds / 60) : minutes), tss: rec?.tss ?? tss, status: p.status, name: w.name });
      pT += tss; pM += minutes; sP++;
      byKind[w.kind].planned += tss;
      if (p.status === 'completed') {
        sD++;
        if (!rec) { dT += tss; dM += p.loggedSeconds ? p.loggedSeconds / 60 : minutes; byKind[w.kind].done += tss; }
      }
    }
    for (const r of weekRides.filter((x) => x.date === date)) {
      const kind = r.sport ?? 'ride';
      dT += r.tss ?? 0; dM += r.seconds / 60; byKind[kind].done += r.tss ?? 0;
      if (!planned.some((p) => p.activityId === r.id)) { sessions.push({ kind, minutes: Math.round(r.seconds / 60), tss: r.tss ?? 0, status: 'unscheduled', name: r.name }); }
    }
    days.push({ date, sessions });
  }
  return { start: ws, days, plannedTss: Math.round(pT), doneTss: Math.round(dT), plannedMinutes: Math.round(pM), doneMinutes: Math.round(dM), sessionsPlanned: sP, sessionsDone: sD, byKind };
}

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}m`;
}

/**
 * Fitness and fatigue carried forward over what is on the calendar: every
 * session not yet done, at its planned load, from tomorrow to `to`. Starts from
 * today's values, so the dotted line picks up where the history ends.
 */
export function projectFitness(last: Fitness, planned: PlannedWorkout[], mine: Workout[], to: string): Fitness[] {
  const from = addDays(last.date, 1);
  if (to < from) return [];
  const loads = planned
    .filter((p) => p.date >= from && p.date <= to && (p.status === 'planned' || p.status === 'sent'))
    .map((p) => { const w = findWorkout(mine, p.workoutId); return { date: p.date, tss: w ? plannedTss(w) : 0 }; });
  return fitnessSeries(loads, from, to, { ctl: last.ctl, atl: last.atl });
}

/** The last date anything is planned (not yet done), or undefined. */
export function lastPlannedDate(planned: PlannedWorkout[], after: string): string | undefined {
  let last: string | undefined;
  for (const p of planned) if (p.date > after && (p.status === 'planned' || p.status === 'sent') && (!last || p.date > last)) last = p.date;
  return last;
}
