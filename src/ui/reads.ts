import { db, getSetting } from '../data/db';
import { readActivity, readWords, READ_DAYS, READ_VERSION, type ActivityRead, type Streams } from '../engine/reads';
import type { BreathNormal } from '../engine/breathOffset';
import { addDays, today } from '../engine/load';
import type { RideLap } from '../engine/analysis';
import type { ActivityEdit, PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import { fetchIntervals, fetchPowerStream } from '../sync/intervals';
import { breathFromRecording, hasBreathing } from '../player/breathRead';
import { credentials } from '../sync/syncService';
import { BREATH_NORMAL_KEY } from './powerCurves';
import { findWorkout } from './store';

/**
 * The re-check thinks (1 Nov 2026), Part A: every activity of the last 12 weeks
 * is read once, planned or not, whatever its kind, from whatever its recording
 * holds (time, power, heart rate, breathing in one small download, or the full
 * recording when this device has it). One at a time, in the background, after
 * the power curves. A read is done again when its version changes, when the
 * activity is matched to a different session, or when FTP or threshold heart
 * rate has changed since.
 */
export interface ReadsInput {
  profile: Profile | null;
  rides: Ride[];
  planned: PlannedWorkout[];
  edits: ActivityEdit[];
  find: (id: string) => Workout | undefined;
}

/** The builder's input from the app's data. */
export function readsInput(d: { profile: Profile | null; rides: Ride[]; planned: PlannedWorkout[]; edits: ActivityEdit[]; mine: Workout[] }): ReadsInput {
  return { profile: d.profile, rides: d.rides, planned: d.planned, edits: d.edits, find: (id) => findWorkout(d.mine, id) };
}

let running: Promise<number> | null = null;
const listeners = new Set<() => void>();
export function onReadsBuilt(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export function buildReads(input: ReadsInput): Promise<number> {
  if (!running) running = run(input).finally(() => { running = null; });
  return running;
}

/** Which planned session an activity completed, if any. */
function sessionMap(input: ReadsInput): Map<string, PlannedWorkout> {
  return new Map(input.planned.filter((p) => p.activityId && p.status === 'completed').map((p) => [p.activityId!, p]));
}

/** Reads that are missing or out of date for these activities. */
export function readsToDo(rides: Ride[], have: Map<string, ActivityRead>, sessionOf: (id: string) => string | undefined, profile: Profile, from: string): Ride[] {
  return rides.filter((r) => r.date >= from && !r.notTraining).filter((r) => {
    const h = have.get(r.id);
    if (!h) return true;
    if (h.v !== READ_VERSION) return true;
    if (h.retry) return true;
    if ((h.planned?.workoutId ?? undefined) !== sessionOf(r.id)) return true;
    if (h.kind !== r.sport) return true;
    return h.ftpAtRead !== profile.ftp || h.lthrAtRead !== profile.lthr;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

async function run(input: ReadsInput, only?: string): Promise<number> {
  const profile = input.profile;
  if (!profile) return 0;
  const have = new Map((await db.reads.toArray()).map((r) => [r.id, r]));
  const sessions = sessionMap(input);
  const from = addDays(today(), -READ_DAYS);
  const todo = readsToDo(input.rides.filter((r) => !only || r.id === only), have, (id) => sessions.get(id)?.workoutId, profile, from);
  if (!todo.length) return 0;
  const c = await credentials();
  const recordings = await db.recordings.toArray();
  const edits = new Map(input.edits.map((e) => [e.id, e]));
  let done = 0;
  for (const r of todo) {
    // One activity whose recording can't be downloaded (none in Intervals.icu, say) must not stop the rest:
    // it is read from its own numbers and tried again on a later pass. Only being offline stops the pass.
    let s: Streams | undefined;
    let retry = false;
    const full = await db.streams.get(r.id);
    try {
      s = full?.time?.length ? { time: full.time, watts: full.watts, heartrate: full.heartrate, ve: full.ve, br: full.br, tv: full.tv }
        : c ? await fetchPowerStream(c, r.id) : undefined;
    } catch {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      retry = true;
    }
    if (!s && !c) retry = true;
    try {
      if (s && !s.time.length) s = undefined;
      const local = recordings.find((x) => x.activityId === r.id);
      if (s && local?.breathing && !hasBreathing(s)) { const b = breathFromRecording(local, s.time); if (b) s = { ...s, ...b }; }
      const p = sessions.get(r.id);
      const w = p ? input.find(p.workoutId) : undefined;
      // Judged by the targets it was ridden to (10 Nov 2026 evening): the player's choice for a trainer ride, else the session's.
      const session = p && w ? { workout: w, basis: local?.basis ?? p.basis, byBreath: local ? !!local.byBreath : !!p.rodeByBreath } : undefined;
      let laps: RideLap[] | undefined;
      if (session && w?.kind === 'ride' && s) { try { laps = full?.intervals ?? (c ? await fetchIntervals(c, r.id) : undefined); } catch { laps = undefined; } }
      const effort = p?.rpe ?? edits.get(r.id)?.rpe;
      const read = readActivity(r, s, { profile, session, laps, effort });
      // A matched session that is not a ride still carries its name.
      if (p && w && !read.planned) read.planned = { workoutId: w.id, name: w.name, steps: [] };
      if (retry) read.retry = true;
      await db.reads.put(read);
      done++;
    } catch { /* this one is tried again next pass */ }
  }
  if (done) listeners.forEach((l) => l());
  return done;
}

/** Read one activity now, if it has not been (its page opened before the background pass reached it). */
export async function readOne(id: string, input: ReadsInput): Promise<boolean> {
  if (running) await running.catch(() => 0);
  return (await run(input, id)) > 0;
}

/** Everything the words need, from this device's store. */
export async function readsContext(): Promise<{ reads: ActivityRead[]; breathNormal?: BreathNormal }> {
  const [reads, breathNormal] = await Promise.all([db.reads.toArray(), getSetting<BreathNormal | undefined>(BREATH_NORMAL_KEY, undefined)]);
  return { reads, breathNormal };
}

/** The plain sentences for one activity, or none when it has not been read yet. */
export async function activityWords(id: string): Promise<string[]> {
  const ctx = await readsContext();
  const r = ctx.reads.find((x) => x.id === id);
  return r ? readWords(r, ctx) : [];
}
