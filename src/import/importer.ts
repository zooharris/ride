import { db, getSetting, type KeptFile } from '../data/db';
import type { Profile, Ride, Wellness } from '../engine/types';
import { durationFor, sportOf, uploadActivityFile } from '../sync/intervals';
import { NOT_ACTIVITY, readActivityFile, type ParsedActivity } from './readers';
import { zipEntries, zipRead, type ZipEntry } from './zip';
import { fillDays, wellnessFile, wellnessFromJson } from './wellnessExport';
import { applyRec, workOut } from '../sync/ownService';
import { refreshThresholds } from '../data/thresholds';
import { thresholdsOf } from '../engine/thresholdCtx';
import { periodsOf, type Period } from '../engine/thresholdHistory';

/**
 * Bringing activities and wellness in from files (Stage 1, 22 Nov 2026): one file, many, a folder, or a whole-account
 * export. Nothing is sent anywhere unless the rider has asked for files to be added to their Intervals.icu too. An
 * activity already here is never added twice (the duplicate rule below); its file is kept with it instead.
 */

/** The setting: also add files brought in to the rider's Intervals.icu (off unless the rider turns it on). */
export const UPLOAD_IMPORTS = 'uploadImports';

/** The duplicate rule: the same kind, starting within 2 minutes, lasting within 10% of each other. */
type Same = Pick<Ride, 'sport' | 'startTime' | 'seconds' | 'elapsedSeconds'> & Partial<Pick<Ride, 'startUtc' | 'startFromFile' | 'distanceM' | 'movingSeconds'>>;
/**
 * The duplicate rule: the same kind, starting within 2 minutes, lasting within 10% of each other. The start is compared
 * as a moment in time where both say it. Where one gives only a clock time (an older activity, or a file that names no
 * time zone, read on a device in another zone than the ride), the clocks may differ by a whole time-zone step; then the
 * two are the same only if they also last the same (within 1%) and went as far (within 1%).
 */
export function sameActivity(a: Same, b: Same): boolean {
  // Lasting the same, like with like: start to finish against start to finish, or time moving against time moving. One
  // copy may carry only its moving time and the other both (22 Nov 2026: on a real history, moving time set against
  // start-to-finish time on rides with long stops left second copies), so any like pair that agrees will do.
  const pairs: Array<[number | undefined, number | undefined]> = [[a.elapsedSeconds, b.elapsedSeconds], [a.movingSeconds, b.movingSeconds], [a.seconds, b.seconds], [a.seconds, b.movingSeconds], [a.movingSeconds, b.seconds]];
  const within = (f: number) => pairs.some(([x, y]) => !!x && !!y && Math.abs(x - y) <= Math.max(x, y) * f);
  const da = a.elapsedSeconds || a.seconds, dbb = b.elapsedSeconds || b.seconds;
  if (a.startUtc && b.startUtc) {
    const d = Math.abs(Date.parse(a.startUtc) - Date.parse(b.startUtc));
    // Two files that begin at the very same moment are the same recording, whatever kind each copy is now called and
    // however each counts its length.
    if (d <= 5_000 && (within(0.1) || (a.startFromFile && b.startFromFile))) return true;
    if (a.sport === b.sport && d <= 120_000 && within(0.1)) return true;
    // Both read from the activities' own files: they are different moments, and that settles it. A start from anywhere
    // else is only a hint (22 Nov 2026: trusting one that was off left second copies on a real history), so the clocks decide.
    if (a.startFromFile && b.startFromFile) return false;
  }
  if (a.sport !== b.sport) return false;
  const ta = Date.parse(a.startTime), tb = Date.parse(b.startTime);
  if (!isFinite(ta) || !isFinite(tb)) return false;
  const diff = Math.abs(ta - tb);
  if (diff <= 120_000) return within(0.1);
  // A whole time-zone step apart (zones are quarter-hours), up to 14 hours.
  const step = 900_000, off = Math.abs(diff - Math.round(diff / step) * step);
  if (diff > 14 * 3600_000 + 60_000 || off > 60_000 || !within(0.01)) return false;
  if (a.distanceM && b.distanceM) return Math.abs(a.distanceM - b.distanceM) <= Math.max(a.distanceM, b.distanceM) * 0.01;
  return !a.distanceM && !b.distanceM && Math.abs(da - dbb) <= 2;
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
    id: `file-${p.startUnix}-${type}`, date: p.startLocal.slice(0, 10), startTime: p.startLocal, startUtc: new Date(p.startUnix * 1000).toISOString(), startFromFile: true,
    name: `${part} ${NOUN[sport]}`, type, sport,
    seconds: durationFor(sport, p.movingS, p.elapsedS), movingSeconds: p.movingS, elapsedSeconds: p.elapsedS,
    distanceM: p.distanceM, elevationM: p.ascentM != null ? Math.round(p.ascentM) : undefined, elevationLossM: p.descentM != null ? Math.round(p.descentM) : undefined,
    calories: p.calories, averageSpeedMs: avg, device: p.device, source: 'file', ...(p.ftp ? { ftpDevice: p.ftp } : {}),
  };
}

export interface ImportItem { name: string; read: () => Promise<Uint8Array> }
export interface ImportResult {
  added: number; already: number; wellnessDays: number; unreadable: Array<{ name: string; why: string }>; notRead: string[];
  /** Device files that are not activities (daily monitoring, settings and the like): counted, not listed. */
  notActivities: number;
  /** This run's record, when it added anything, so it can be undone. */
  batchId?: string;
  /**
   * The files carried FTP settings from a device (Part E, 22 Nov 2026): what they say, in periods, and how the new
   * rides will be scored under the rider's setting. While `waiting`, nothing brought in has been scored yet.
   */
  ftpFound?: FtpFound;
  waiting?: boolean;
}

/** What the files brought in say the device's FTP was, and how the new rides among them will be scored. */
export interface FtpFound {
  periods: Period[];
  /** New rides scored with the FTP from their own file; with Antogo's history; and (older than the history, with no FTP in the file) with the history's first entry. */
  byDevice: number; byHistory: number; byFirst: number;
}

/**
 * One run of bringing files in, as it can be undone (22 Nov 2026): the activities it added, and for each day of
 * wellness the measures it added (and whether the day itself was new).
 */
export interface ImportBatch { id: string; at: string; label: string; rides: string[]; wellness: Array<{ date: string; keys: string[]; newDay: boolean }> }
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
  const result: ImportResult = { added: 0, already: 0, wellnessDays: 0, unreadable: [], notRead: [], notActivities: 0 };
  const batch: ImportBatch = { id: `imp-${Date.now()}`, at: new Date().toISOString(), label: files.length === 1 ? files[0].name : `${files.length} files`, rides: [], wellness: [] };
  emit({ running: true, done: 0, total: 0, result: undefined, error: undefined });
  try {
    const { activities, wellness, skipped } = await itemsOf(files);
    result.notRead.push(...skipped);
    emit({ total: activities.length + wellness.length });
    const p = await db.profile.get('me');
    const upload = await getSetting<boolean>(UPLOAD_IMPORTS, false);
    const fresh: Ride[] = [];
    // The FTP each file says the device had set, so the summary can say what was found before anything is scored (Part E).
    const deviceFtp: Array<{ date: string; value: number | undefined }> = [];
    await refreshThresholds();
    let n = 0;
    for (const item of activities) {
      if (cancelled) break;
      try {
        const bytes = await item.read();
        const parsed = await readActivityFile(item.name, bytes);
        if (parsed === NOT_ACTIVITY) result.notActivities++;
        else if (!parsed) result.unreadable.push({ name: item.name, why: 'not an activity file this app can read' });
        else {
          if (parsed.ftp) deviceFtp.push({ date: parsed.startLocal.slice(0, 10), value: parsed.ftp });
          const r = await addActivity(parsed, bytes, p ?? undefined, { defer: true });
          if (r === 'already') result.already++;
          else { result.added++; fresh.push(r); batch.rides.push(r.id); if (upload) await sendOn(r, bytes, item.name); }
        }
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
      for (const day of add) {
        const cur = have.get(day.date) as Record<string, unknown> | undefined;
        batch.wellness.push({ date: day.date, newDay: !cur, keys: Object.keys(day).filter((k) => k !== 'date' && (day as unknown as Record<string, unknown>)[k] != null && cur?.[k] == null) });
      }
      await db.wellness.bulkPut(add);
      result.wellnessDays = add.length;
    }
    if (batch.rides.length || batch.wellness.length) { await db.imports.put(batch); result.batchId = batch.id; }
    // A second copy that slipped in (an activity whose kind was changed here) becomes one with the one already here.
    try { const merged = await mergeFileCopies(); if (merged) { result.added -= merged; result.already += merged; } } catch { /* the next sync does it */ }
    const still = (await db.rides.bulkGet(fresh.map((r) => r.id))).filter((r): r is Ride => !!r);
    pending = still.map((r) => r.id);
    // Files that carry a device's FTP settings: the summary says what they say and how they will be used, and the
    // rider carries on from there, or looks at their FTP history first. Otherwise the activities are scored at once.
    const ftpFound = ftpFoundIn(deviceFtp, still, p ?? undefined);
    if (ftpFound && still.length) { result.ftpFound = ftpFound; result.waiting = true; onChanged(); emit({ running: false, result }); return result; }
    await finishImport(onChanged);
    emit({ running: false, result });
    return result;
  } catch (e) {
    emit({ running: false, error: (e as Error).message, result });
    throw e;
  }
}

let pending: string[] = [];

/** What the files say the device's FTP was, in periods, and how the new rides will be scored under the rider's setting. */
export function ftpFoundIn(points: Array<{ date: string; value: number | undefined }>, fresh: Ride[], p: Profile | undefined): FtpFound | undefined {
  const periods = periodsOf(points);
  if (!periods.length) return undefined;
  const out: FtpFound = { periods, byDevice: 0, byHistory: 0, byFirst: 0 };
  for (const r of fresh) {
    if (r.sport !== 'ride') continue;
    const k = thresholdsOf(r, p).ftp?.why.kind;
    if (k === 'device' || k === 'device-before') out.byDevice++; else if (k === 'first') out.byFirst++; else out.byHistory++;
  }
  return out;
}

/**
 * The activities brought in are worked out and scored (the second half of bringing files in). Run at once when the
 * files carry no FTP settings; otherwise when the rider carries on from the summary. Should the app be closed in
 * between, they are worked out the next time it opens, like any activity not yet on Antogo's numbers.
 */
export async function finishImport(onChanged: () => void): Promise<void> {
  const ids = pending; pending = [];
  const { startChangeOver } = await import('../sync/syncService');
  await startChangeOver();
  const fresh = (await db.rides.bulkGet(ids)).filter((r): r is Ride => !!r);
  if (fresh.length) {
    await pairNew(fresh, (await db.profile.get('me')) ?? undefined);
    await db.rides.bulkPut(fresh);
  }
  if (state.result?.waiting) emit({ result: { ...state.result, waiting: false } });
  onChanged();
}

/** Add one parsed activity, or attach its file to the one already here. With `defer`, it is kept but not yet worked out or scored. */
export async function addActivity(parsed: ParsedActivity, bytes: Uint8Array, p: Profile | undefined, opts: { defer?: boolean } = {}): Promise<Ride | 'already'> {
  const ride = rideFromParsed(parsed);
  const day = ride.date;
  const near = await withStarts(await db.rides.where('date').between(prevDay(day), nextDay(day), true, true).toArray());
  const same = near.find((x) => sameActivity(x, ride));
  const file = (id: string, date: string): KeptFile => ({ id, date, status: 'kept', bytes, size: bytes.byteLength, at: new Date().toISOString() });
  if (same) {
    const kept = await db.files.get(same.id);
    if (kept?.status !== 'kept') await db.files.put(file(same.id, same.date));
    return 'already';
  }
  await db.files.put(file(ride.id, ride.date));
  // Its FTP is the one Antogo's rule gives for its day (the history, or the device's from this file), worked out with its numbers.
  let out = ride;
  if (p && !opts.defer) {
    const rec = await workOut(ride, p, parsed.streams ? { streams: { ...parsed.streams, id: ride.id }, ftp: parsed.ftp } : undefined);
    if (rec) out = applyRec(ride, rec);
    const { rescorer } = await import('../sync/syncService');
    await rescorer()(out, p);
  }
  await db.rides.put(out);
  return out;
}

/**
 * Activities with their start as a moment in time filled in where it is missing and their original file is kept: the
 * file says exactly when it began, which is what tells a second copy of the same recording from another activity.
 */
async function withStarts(rides: Ride[]): Promise<Ride[]> {
  for (const r of rides) {
    if (r.startFromFile) continue;
    let exact: string | undefined;
    try {
      const f = await db.files.get(r.id);
      if (f?.status === 'kept' && f.bytes) {
        const parsed = await readActivityFile(r.id, f.bytes);
        if (parsed && parsed !== NOT_ACTIVITY) exact = new Date(parsed.startUnix * 1000).toISOString();
      }
    } catch { /* an unreadable file: the clock time still serves */ }
    if (exact) { r.startUtc = exact; r.startFromFile = true; await db.rides.update(r.id, { startUtc: exact, startFromFile: true }); }
    // A start that did not come from the activity's own file is not kept: it is not known to be exact.
    else if (r.startUtc) { r.startUtc = undefined; await db.rides.update(r.id, { startUtc: undefined }); }
  }
  return rides;
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
export async function mergeFileCopies(opts: { countOnly?: boolean } = {}): Promise<number> {
  const fileRides = (await db.rides.toArray()).filter((r) => r.source === 'file');
  let merged = 0;
  for (const f of fileRides) {
    try {
    const near = await withStarts((await db.rides.where('date').between(prevDay(f.date), nextDay(f.date), true, true).toArray()).filter((x) => x.source !== 'file'));
    const twin = near.find((x) => sameActivity(x, f));
    if (!twin) continue;
    if (opts.countOnly) { merged++; continue; }
    const kept = await db.files.get(f.id);
    const twinFile = await db.files.get(twin.id);
    if (kept?.status === 'kept' && twinFile?.status !== 'kept') await db.files.put({ ...kept, id: twin.id, date: twin.date });
    for (const pl of (await db.planned.toArray()).filter((x) => x.activityId === f.id)) await db.planned.update(pl.id, { activityId: twin.id });
    const edit = await db.activityEdits.get(f.id);
    if (edit && !(await db.activityEdits.get(twin.id))) await db.activityEdits.put({ ...edit, id: twin.id });
    await db.activityEdits.delete(f.id);
    await Promise.all([db.rides.delete(f.id), db.files.delete(f.id), db.own.delete(f.id), db.powerCurves.delete(f.id), db.streams.delete(f.id), db.thumbs.delete(f.id), db.reads.delete(f.id)]);
    merged++;
    } catch { /* one that can't be made one now is left for the next time; the rest carry on */ }
  }
  return merged;
}

/** The runs of bringing files in that can still be undone, newest first. */
export async function importBatches(): Promise<ImportBatch[]> {
  return (await db.imports.toArray()).sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Undo one run: the activities it added are removed from this device with everything kept for them (a planned session
 * one had completed goes back to to-do), and the wellness it added is taken out again, measure by measure. What was
 * here before the run is untouched. An activity that has since arrived from the data service as well is the data
 * service's now, and stays.
 */
export async function undoImport(id: string): Promise<{ rides: number; days: number }> {
  const b = await db.imports.get(id);
  if (!b) return { rides: 0, days: 0 };
  let rides = 0, days = 0;
  const planned = await db.planned.toArray();
  for (const rid of b.rides) {
    const r = await db.rides.get(rid);
    if (!r || r.source !== 'file') continue;
    for (const pl of planned.filter((x) => x.activityId === rid)) {
      await db.planned.update(pl.id, { status: pl.date < new Date().toISOString().slice(0, 10) ? 'missed' : pl.icuEventId ? 'sent' : 'planned', activityId: undefined, relabelled: undefined, done: undefined, rpe: undefined });
    }
    await Promise.all([db.rides.delete(rid), db.files.delete(rid), db.own.delete(rid), db.activityEdits.delete(rid), db.powerCurves.delete(rid), db.streams.delete(rid), db.thumbs.delete(rid), db.reads.delete(rid)]);
    rides++;
  }
  for (const w of b.wellness) {
    const cur = await db.wellness.get(w.date);
    if (!cur) continue;
    const next = { ...cur } as Record<string, unknown>;
    for (const k of w.keys) delete next[k];
    if (w.newDay && Object.keys(next).every((k) => k === 'date' || next[k] == null)) await db.wellness.delete(w.date);
    else await db.wellness.put(next as unknown as Wellness);
    days++;
  }
  await db.imports.delete(id);
  return { rides, days };
}
