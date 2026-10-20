import { useEffect, useState } from 'preact/hooks';
import { db, getSetting, loadProfile } from '../data/db';
import type { DayNote, Equipment, PlannedWorkout, Profile, Ride, Wellness, Workout } from '../engine/types';
import { LIBRARY } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { newId } from '../engine/workout';
import { setFirstDay } from './derived';
import { onDeviceSync, schedulePush } from '../data/devicesync';
import { credentials, recheckMatches } from '../sync/syncService';
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
  rides: Ride[];
  /** Wellness the rider has not disowned: days flagged in a day note as wrong are already left out. */
  wellness: Wellness[];
  /** Every wellness day as synced, flagged ones included (Settings and the readiness panel show what was set aside). */
  wellnessAll: Wellness[];
  dayNotes: DayNote[];
  mine: Workout[];
  loaded: boolean;
}

/** Wellness with the days the rider marked as wrong taken out. The flag lives on the morning's date. */
export function trustedWellness(wellness: Wellness[], notes: DayNote[]): Wellness[] {
  const bad = new Set(notes.filter((n) => n.badWellness).map((n) => n.date));
  return bad.size ? wellness.filter((w) => !bad.has(w.date)) : wellness;
}

let rechecked = false;

export function useAppData(): AppData {
  const [data, setData] = useState<AppData>({ profile: null, planned: [], rides: [], wellness: [], wellnessAll: [], dayNotes: [], mine: [], loaded: false });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [profile, planned, rides, wellnessAll, mine, dayNotes] = await Promise.all([
        loadProfile(),
        db.planned.toArray(),
        db.rides.orderBy('date').reverse().toArray(),
        db.wellness.orderBy('date').toArray(),
        db.workouts.toArray(),
        db.dayNotes.toArray(),
      ]);
      setFirstDay(profile?.weekStartsOn === 0 ? 0 : 1);
      // "last 35 lb" in the step text sent to the Garmin comes from the calendar's done records.
      setLastWeightLookup((name) => { const l = lastDone(name, planned, today()); return l ? weightText(l) : undefined; });
      if (alive) setData({ profile, planned, rides, wellness: trustedWellness(wellnessAll, dayNotes), wellnessAll, dayNotes, mine, loaded: true });
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
let readyCache: { key: string; list: Workout[] } = { key: '', list: [] };
export const DEFAULT_EQUIPMENT: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'outdoor-walk'];
export function readyMade(equipment: Equipment[] = currentEquipment): Workout[] {
  const key = [...equipment].sort().join(',');
  if (readyCache.key !== key) readyCache = { key, list: readyMadeSessions(equipment) };
  return readyCache.list;
}
let currentEquipment: Equipment[] = DEFAULT_EQUIPMENT;
export function setCurrentEquipment(e: Equipment[]): void { if (e.length) currentEquipment = e; }
export function getCurrentEquipment(): Equipment[] { return currentEquipment; }
getSetting<{ availability?: { equipment?: Equipment[] } } | null>('planRequest', null).then((s) => { if (s?.availability?.equipment?.length) setCurrentEquipment(s.availability.equipment); }).catch(() => {});

export function allWorkouts(mine: Workout[]): Workout[] {
  return [...mine, ...LIBRARY, ...readyMade()];
}

export function findWorkout(mine: Workout[], id: string): Workout | undefined {
  return mine.find((w) => w.id === id) ?? LIBRARY.find((w) => w.id === id) ?? readyMade().find((w) => w.id === id);
}

/**
 * Put a workout on a date. A ready-made session is stored as its own copy
 * first, so the calendar entry keeps exactly what was chosen even if the
 * rider's equipment changes later.
 */
export async function scheduleWorkout(w: Workout, date: string, basis: 'power' | 'hr'): Promise<void> {
  let id = w.id;
  if (w.source === 'library' && w.kind !== 'ride') {
    id = `gen-${newId()}`;
    await db.workouts.put({ ...w, id, source: 'generated' });
  }
  await db.planned.put({ id: newId(), date, workoutId: id, basis: w.bases.includes(basis) ? basis : w.bases[0], status: 'planned' });
  notify();
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
