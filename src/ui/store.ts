import { useEffect, useState } from 'preact/hooks';
import { db, getSetting, loadProfile } from '../data/db';
import type { ActivityEdit, DayNote, Equipment, PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { newId } from '../engine/workout';
import { dayPossessive, setFirstDay } from './derived';
import { onDeviceSync, schedulePush } from '../data/devicesync';
import { credentials, onSyncRunning, recheckMatches, syncRunning } from '../sync/syncService';
import { setLastWeightLookup } from '../sync/intervals';
import { lastDone, weightText } from '../engine/record';
import { today } from '../engine/load';

/** A tiny change bus: screens re-read from IndexedDB after any write. */
const listeners = new Set<() => void>();
export function notify(): void { listeners.forEach((l) => l()); schedulePush(credentials); }
// Changes merged in from another device re-read the screens without scheduling a push of their own.
onDeviceSync(() => listeners.forEach((l) => l()));

export interface AppData {
  profile: Profile | null;
  planned: PlannedWorkout[];
  /** Activities that count as training: a drive or a recording under five minutes (see `notTraining`) is left out everywhere but `ridesAll`. */
  rides: Ride[];
  /** Every synced activity, the ones that are not training included (the Activities list can show them; a recording page opens any of them). */
  ridesAll: Ride[];
  /** Wellness the rider has not disowned: days flagged in a day note as wrong are already left out. */
  wellness: Wellness[];
  /** Every wellness day as synced, flagged ones included (Settings and the readiness panel show what was set aside). */
  wellnessAll: Wellness[];
  dayNotes: DayNote[];
  mine: Workout[];
  /** The rider's edits to recorded activities. */
  edits: ActivityEdit[];
  loaded: boolean;
}

/**
 * Every record of what was done, for "last time": the calendar's done sessions and
 * the records the rider gave unplanned activities, in one list of calendar-like entries.
 */
export function doneHistory(planned: PlannedWorkout[], edits: ActivityEdit[]): PlannedWorkout[] {
  return [...planned, ...edits.filter((e) => e.done).map((e): PlannedWorkout => ({ id: `edit:${e.id}`, date: e.date, workoutId: '', basis: 'power', status: 'completed', done: e.done }))];
}

/** Wellness with the days the rider marked as wrong taken out. The flag lives on the morning's date. */
export function trustedWellness(wellness: Wellness[], notes: DayNote[]): Wellness[] {
  const bad = new Set(notes.filter((n) => n.badWellness).map((n) => n.date));
  return bad.size ? wellness.filter((w) => !bad.has(w.date)) : wellness;
}

let rechecked = false;

/** Everything the screens read, as it is in storage now. Also used by the automatic pull to give the coach the same picture. */
export async function loadAppData(): Promise<AppData> {
  const [profile, planned, ridesAll, wellnessAll, mine, dayNotes, edits] = await Promise.all([
    loadProfile(),
    db.planned.toArray(),
    db.rides.orderBy('date').reverse().toArray(),
    db.wellness.orderBy('date').toArray(),
    db.workouts.toArray(),
    db.dayNotes.toArray(),
    db.activityEdits.toArray(),
  ]);
  setFirstDay(profile?.weekStartsOn === 0 ? 0 : 1);
  // "last 35 lb" in the step text sent to the Garmin comes from the calendar's done records.
  const history = doneHistory(planned, edits);
  setLastWeightLookup((name) => { const l = lastDone(name, history, today()); return l ? weightText(l) : undefined; });
  return { profile, planned, rides: ridesAll.filter((r) => !r.notTraining), ridesAll, wellness: trustedWellness(wellnessAll, dayNotes), wellnessAll, dayNotes, mine, edits, loaded: true };
}

export function useAppData(): AppData {
  const [data, setData] = useState<AppData>({ profile: null, planned: [], rides: [], ridesAll: [], wellness: [], wellnessAll: [], dayNotes: [], mine: [], edits: [], loaded: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await loadAppData();
      if (alive) setData(next);
    };
    load();
    listeners.add(load);
    // Once per launch: apply the matching rules to what this device already has, so a rule
    // change, a deleted recording or a refused match shows without waiting for a Sync.
    if (!rechecked) { rechecked = true; recheckMatches().then((n) => { if (n) notify(); }).catch(() => {}); }
    return () => { alive = false; listeners.delete(load); };
  }, []);
  return data;
}

/** Ready-made strength, mobility and walk sessions, built for the equipment the rider told the planner about. */
const readyCache = new Map<string, Workout[]>();
export const DEFAULT_EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'outdoor-walk'];
export function readyMade(equipment: Equipment[] = currentEquipment): Workout[] {
  const key = [...equipment].sort().join(',');
  if (!readyCache.has(key)) readyCache.set(key, readyMadeSessions(equipment));
  return readyCache.get(key)!;
}
let currentEquipment: Equipment[] = DEFAULT_EQUIPMENT;
export function setCurrentEquipment(e: Equipment[]): void { if (e.length) currentEquipment = e; }
export function getCurrentEquipment(): Equipment[] { return currentEquipment; }
getSetting<{ availability?: { equipment?: Equipment[] } } | null>('planRequest', null).then((s) => { if (s?.availability?.equipment?.length) setCurrentEquipment(s.availability.equipment); }).catch(() => {});

export function allWorkouts(mine: Workout[]): Workout[] {
  return [...mine, ...LIBRARY, ...readyMade()];
}

export function findWorkout(mine: Workout[], id: string): Workout | undefined {
  // A session the rider's equipment does not allow (shown under "Everything, gym included") is still found.
  return mine.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id) ?? readyMade().find((w) => w.id === id) ?? readyMade(EVERY_EQUIPMENT).find((w) => w.id === id);
}
const EVERY_EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk'];

/**
 * Put a workout on a date. A ready-made session is stored as its own copy
 * first, so the calendar entry keeps exactly what was chosen even if the
 * rider's equipment changes later.
 */
export async function scheduleWorkout(w: Workout, date: string, basis: 'power' | 'hr'): Promise<'added' | 'already'> {
  // The same workout cannot go on a day twice while its first entry there is still to do (Batch 10 B).
  if (await alreadyOnDay(w, date)) return 'already';
  let id = w.id;
  if (w.source === 'library' && w.kind !== 'ride') {
    id = `gen-${newId()}`;
    await db.workouts.put({ ...w, id, source: 'generated', libraryId: w.libraryId ?? w.id });
  }
  await db.planned.put({ id: newId(), date, workoutId: id, basis: w.bases.includes(basis) ? basis : w.bases[0], status: 'planned' });
  notify();
  return 'added';
}

/**
 * Whether this workout is already on `date` and not yet done: the same workout, or (for a
 * ready-made strength, mobility, walk or run session, which goes on the calendar as a copy)
 * a copy with the same name and kind. A different workout, or one already done, does not count.
 * `except` leaves out one entry: the one being replaced.
 */
export async function alreadyOnDay(w: Workout, date: string, except?: string): Promise<boolean> {
  const entries = (await db.planned.where('date').equals(date).toArray()).filter((p) => p.status !== 'completed' && p.id !== except);
  if (entries.some((p) => p.workoutId === w.id)) return true;
  if (w.source !== 'library' || w.kind === 'ride') return false;
  for (const p of entries) {
    const c = await db.workouts.get(p.workoutId);
    if (c && c.source === 'generated' && c.kind === w.kind && c.name === w.name) return true;
  }
  return false;
}

/** The message when a workout is already on that day. */
export function alreadyText(name: string, date: string): string {
  return `${name} is already on ${dayPossessive(date)} calendar.`;
}

/** Save the rider's note for a date; an empty note with nothing flagged is removed. */
export async function saveDayNote(date: string, note: { text?: string; badWellness?: boolean }): Promise<void> {
  const text = note.text?.trim() || undefined;
  if (!text && !note.badWellness) await db.dayNotes.delete(date);
  else await db.dayNotes.put({ date, text, badWellness: note.badWellness || undefined });
  notify();
}

/**
 * Where a calendar session opens. Once done with a recording behind it, the
 * recording (what happened); otherwise the session as planned. A recording
 * this device has not synced yet falls back to the session page.
 */
export function sessionHref(p: { status: string; activityId?: string }, workoutId: string, from: string, date: string, rides: Array<{ id: string }>): string {
  if (p.status === 'completed' && p.activityId && rides.some((r) => r.id === p.activityId)) return `#/rides/${p.activityId}`;
  return `#/workout/${workoutId}?from=${from}&date=${date}`;
}

/** This device's pull from Intervals.icu: when it last succeeded, when it last failed, and whether one is running now. */
export function useSyncState(): { last?: string; errorAt?: string; running: boolean } {
  const [state, setState] = useState<{ last?: string; errorAt?: string; running: boolean }>({ running: syncRunning() });
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const s = await db.sync.get('intervals');
      if (alive) setState({ last: s?.lastActivitySync, errorAt: s?.lastErrorAt, running: syncRunning() });
    };
    read();
    listeners.add(read);
    const off = onSyncRunning(read);
    return () => { alive = false; listeners.delete(read); off(); };
  }, []);
  return state;
}
