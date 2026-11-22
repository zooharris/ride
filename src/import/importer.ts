import { db, getSetting, type KeptFile } from '../data/db';
import type { Profile, Ride, Wellness } from '../engine/types';
import { durationFor, sportOf, uploadActivityFile } from '../sync/intervals';
import { readActivityFile, type ParsedActivity } from './readers';
import { zipEntries, zipRead, type ZipEntry } from './zip';
import { fillDays, wellnessFile, wellnessFromJson } from './wellnessExport';
import { withOwn } from '../engine/ownNumbers';
import { workOut } from '../sync/ownService';

/**
 * Bringing activities and wellness in from files (Stage 1, 22 Nov 2026): one file, many, a folder, or a whole-account
 * export. Nothing is sent anywhere unless the rider has asked for files to be added to their Intervals.icu too. An
 * activity already here is never added twice (the duplicate rule below); its file is kept with it instead.
 */

/** The setting: also add files brought in to the rider's Intervals.icu (off unless the rider turns it on). */
export const UPLOAD_IMPORTS = 'uploadImports';

/** The duplicate rule: the same kind, starting within 2 minutes, lasting within 10% of each other. */
export function sameActivity(a: Pick<Ride, 'sport' | 'startTime' | 'seconds' | 'elapsedSeconds'>, b: Pick<Ride, 'sport' | 'startTime' | 'seconds' | 'elapsedSeconds'>): boolean {
  if (a.sport !== b.sport) return false;
  const ta = Date.parse(a.startTime), tb = Date.parse(b.startTime);
  if (!isFinite(ta) || !isFinite(tb) || Math.abs(ta - tb) > 120_000) return false;
  const da = a.elapsedSeconds || a.seconds, dbb = b.elapsedSeconds || b.seconds;
  return Math.abs(da - dbb) <= Math.max(da, dbb) * 0.1;
}

const PART: Array<[number, string]> = [[5, 'Night'], [12, 'Morning'], [17, 'Afternoon'], [21, 'Evening'], [24, 'Night']];
const NOUN: Record<Ride['sport'], string> = { ride: 'ride', walk: 'walk', run: 'run', strength: 'strength session', mobility: 'mobility session', other: 'activity' };

/** An activity from a file, as the app holds activities. */
export function rideFromParsed(p: ParsedActivity): Ride {
  const avg = p.distanceM && (p.movingS || p.elapsedS) ? p.distanceM / (p.movingS || p.elapsedS) : undefined;
  const type = p.type === 'Ride' && p.streams && !p.streams.lat && !p.distanceM ? 'VirtualRide' : p.type;
  const sport = sportOf(type, avg);
  const hour = Number(p.startLocal.slice(11, 13));
  const part = PART.find(([h]) => hour < h)?.[1] ?? 'Morning';
  return {
    id: `file-${p.startUnix}-${type}`, date: p.startLocal.slice(0, 10), startTime: p.startLocal,
    name: `${part} ${NOUN[sport]}`, type, sport,
    seconds: durationFor(sport, p.movingS, p.elapsedS), movingSeconds: p.movingS, elapsedSeconds: p.elapsedS,
    distanceM: p.distanceM, elevationM: p.ascentM != null ? Math.round(p.ascentM) : undefined, elevationLossM: p.descentM != null ? Math.round(p.descentM) : undefined,
    calories: p.calories, averageSpeedMs: avg, device: p.device, source: 'file',
  };
}

export interface ImportItem { name: string; read: () => Promise<Uint8Array> }
export interface ImportResult { added: number; already: number; wellnessDays: number; unreadable: Array<{ name: string; why: string }>; notRead: string[] }
export interface ImportState { running: boolean; done: number; total: number; result?: ImportResult; error?: string }

let state: ImportState = { running: false, done: 0, total: 0 };
const listeners = new Set<(s: ImportState) => void>();
const emit = (patch: Partial<ImportState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export function watchImport(fn: (s: ImportState) => void): () => void { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
let cancelled = false;
export function cancelImport() { cancelled = true; }

const ACTIVITY = /\.(fit|fit\.gz|tcx|tcx\.gz|gpx|gpx\.gz)$/i;

/**
 * What a picked set of files holds: activity files, ZIPs (an archive of activities, or a whole-account export whose
 * own archives of activities are opened in turn), and the export's wellness files.
 */
export async function itemsOf(files: File[]): Promise<{ activities: ImportItem[]; wellness: ImportItem[]; skipped: string[] }> {
  const activities: ImportItem[] = [], wellness: ImportItem[] = [], skipped: string[] = [];
  const fromZip = async (blob: Blob, label: string, depth = 0): Promise<void> => {
    let entries: ZipEntry[];
    try { entries = await zipEntries(blob); } catch { skipped.push(label); return; }
    for (const e of entries) {
      if (e.name.endsWith('/')) continue;
      const nm = `${label} › ${e.name}`;
      if (ACTIVITY.test(e.name)) activities.push({ name: nm, read: () => zipRead(blob, e) });
      else if (/\.zip$/i.test(e.name) && depth < 2) { const inner = new Blob([await zipRead(blob, e) as unknown as BlobPart]); await fromZip(inner, nm, depth + 1); }
      else if (wellnessFile(e.name)) wellness.push({ name: nm, read: () => zipRead(blob, e) });
    }
  };
  for (const f of files) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (ACTIVITY.test(f.name)) activities.push({ name: path, read: async () => new Uint8Array(await f.arrayBuffer()) });
    else if (/\.zip$/i.test(f.name)) await fromZip(f, f.name);
    else if (wellnessFile(path)) wellness.push({ name: path, read: async () => new Uint8Array(await f.arrayBuffer()) });
    else skipped.push(path);
  }
  return { activities, wellness, skipped };
}

/** Bring files in. One run at a time; the screens are told when activities change. */
export async function importFiles(files: File[], onChanged: () => void): Promise<ImportResult> {
  if (state.running) throw new Error('An import is already running.');
  cancelled = false;
  const result: ImportResult = { added: 0, already: 0, wellnessDays: 0, unreadable: [], notRead: [] };
  emit({ running: true, done: 0, total: 0, result: undefined, error: undefined });
  try {
    const { activities, wellness, skipped } = await itemsOf(files);
    result.notRead.push(...skipped);
    emit({ total: activities.length + wellness.length });
    const p = await db.profile.get('me');
    const upload = await getSetting<boolean>(UPLOAD_IMPORTS, false);
    const fresh: Ride[] = [];
    let n = 0;
    for (const item of activities) {
      if (cancelled) break;
      try {
        const bytes = await item.read();
        const parsed = await readActivityFile(item.name, bytes);
        if (!parsed) { result.unreadable.push({ name: item.name, why: 'not an activity file this app can read' }); continue; }
        const r = await addActivity(parsed, bytes, p ?? undefined);
        if (r === 'already') result.already++;
        else { result.added++; fresh.push(r); if (upload) await sendOn(r, bytes, item.name); }
      } catch (e) { result.unreadable.push({ name: item.name, why: (e as Error).message }); }
      emit({ done: ++n });
      if (n % 20 === 0) { onChanged(); await new Promise((res) => setTimeout(res, 0)); }
    }
    // Wellness: every file's days, then added where the device lacks them.
    const found = new Map<string, Partial<Wellness>>();
    for (const item of wellness) {
      if (cancelled) break;
      try {
        const json = JSON.parse(new TextDecoder().decode(await item.read()));
        const days = wellnessFromJson(json);
        if (!days.size) result.notRead.push(item.name);
        for (const [d, m] of days) found.set(d, { ...(found.get(d) ?? {}), ...m });
      } catch { result.notRead.push(item.name); }
      emit({ done: ++n });
    }
    if (found.size) {
      const have = new Map((await db.wellness.toArray()).map((w) => [w.date, w]));
      const add = fillDays(have, found);
      await db.wellness.bulkPut(add);
      result.wellnessDays = add.length;
    }
    if (fresh.length) await pairNew(fresh, p ?? undefined);
    onChanged();
    emit({ running: false, result });
    return result;
  } catch (e) {
    emit({ running: false, error: (e as Error).message, result });
    throw e;
  }
}

/** Add one parsed activity, or attach its file to the one already here. */
export async function addActivity(parsed: ParsedActivity, bytes: Uint8Array, p: Profile | undefined): Promise<Ride | 'already'> {
  const ride = rideFromParsed(parsed);
  const day = ride.date;
  const near = await db.rides.where('date').between(prevDay(day), nextDay(day), true, true).toArray();
  const same = near.find((x) => sameActivity(x, ride));
  const file = (id: string, date: string): KeptFile => ({ id, date, status: 'kept', bytes, size: bytes.byteLength, at: new Date().toISOString() });
  if (same) {
    const kept = await db.files.get(same.id);
    if (kept?.status !== 'kept') await db.files.put(file(same.id, same.date));
    return 'already';
  }
  await db.files.put(file(ride.id, ride.date));
  let out = ride;
  if (p) {
    const rec = await workOut(ride, p, parsed.streams ? { ...parsed.streams, id: ride.id } : undefined);
    if (rec) out = withOwn(ride, rec.nums);
    const { scoreActivity } = await import('../sync/syncService');
    scoreActivity(out, p);
  }
  await db.rides.put(out);
  return out;
}

const prevDay = (d: string) => new Date(Date.parse(d) - 864e5).toISOString().slice(0, 10);
const nextDay = (d: string) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);

/** Match activities brought in to planned sessions, by the rules the app already uses. */
async function pairNew(rides: Ride[], p: Profile | undefined): Promise<void> {
  try {
    const { applyPairing, workoutLookupFor } = await import('../sync/syncService');
    const from = rides.reduce((m, r) => (r.date < m ? r.date : m), rides[0].date), to = rides.reduce((m, r) => (r.date > m ? r.date : m), rides[0].date);
    const planned = await db.planned.where('date').between(prevDay(from), nextDay(to), true, true).toArray();
    await applyPairing(rides, planned, await workoutLookupFor(), null, p ?? null, {});
  } catch { /* pairing is a convenience: the activities are in either way */ }
}

/** Also add a file brought in to the rider's Intervals.icu, when they have asked for that. */
async function sendOn(r: Ride, bytes: Uint8Array, name: string): Promise<void> {
  try {
    const { credentials } = await import('../sync/syncService');
    const c = await credentials();
    if (!c) return;
    await uploadActivityFile(c, bytes, { name: r.name, externalId: r.id, fileName: name.split(/[\\/›]/).pop()!.trim() || `${r.id}.fit` });
  } catch { /* the activity is here either way; the next sync brings Intervals.icu's copy, which merges with it */ }
}

/**
 * A file brought in that has since arrived from the data service too becomes one activity: the data service's (it
 * carries the id the rider's other devices and the calendar know), with the kept file, the planned session it was
 * matched to and the rider's edits moved over to it.
 */
export async function mergeFileCopies(): Promise<number> {
  const fileRides = (await db.rides.toArray()).filter((r) => r.source === 'file');
  let merged = 0;
  for (const f of fileRides) {
    const near = await db.rides.where('date').between(prevDay(f.date), nextDay(f.date), true, true).toArray();
    const twin = near.find((x) => x.source !== 'file' && sameActivity(x, f));
    if (!twin) continue;
    const kept = await db.files.get(f.id);
    const twinFile = await db.files.get(twin.id);
    if (kept?.status === 'kept' && twinFile?.status !== 'kept') await db.files.put({ ...kept, id: twin.id, date: twin.date });
    for (const pl of (await db.planned.toArray()).filter((x) => x.activityId === f.id)) await db.planned.update(pl.id, { activityId: twin.id });
    const edit = await db.activityEdits.get(f.id);
    if (edit && !(await db.activityEdits.get(twin.id))) await db.activityEdits.put({ ...edit, id: twin.id });
    await db.activityEdits.delete(f.id);
    await Promise.all([db.rides.delete(f.id), db.files.delete(f.id), db.own.delete(f.id), db.powerCurves.delete(f.id), db.streams.delete(f.id), db.thumbs.delete(f.id), db.reads.delete(f.id)]);
    merged++;
  }
  return merged;
}
