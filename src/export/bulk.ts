/**
 * Many at once (12 Nov 2026, export at any time): finished activities, workouts to ride, or both, into one folder
 * (zipped, and just as usable unzipped, since most apps import files one at a time), with a plain note and a list a
 * spreadsheet opens. One item at a time, gently, so the data service is never hammered; an item that fails is tried
 * again, then listed as failed, and the rest carry on. A history too large for one folder on a phone is split into
 * numbered folders.
 */
import type { Profile, Ride, Workout } from '../engine/types';
import type { BreathPowerTable } from '../player/breathControl';
import type { Recording } from '../player/types';
import type { IntervalsCredentials } from '../sync/intervals';
import { clock, workoutStats } from '../engine/workout';
import { activityFile, type Origin } from './activity';
import { ACTIVITY_FORMAT_LABEL, WORKOUT_FORMAT_LABEL, workoutExportable, workoutFile, workoutOffers, type ActivityFormat, type FileOut, type WorkoutFormat } from './formats';
import type { SendBasis, Where } from '../library/sendWhere';
import { NameBook, safeName } from './names';
import { bytesOf, zip, type ZipEntry } from './zip';

/** `format`, when set, overrides the export's format for this activity (a .gpx export's activities without a route, taken as .fit). */
export interface ActivityItem { kind: 'activity'; ride: Ride; origin: Origin; local?: Recording; format?: ActivityFormat }
export interface WorkoutItem { kind: 'workout'; w: Workout; date?: string; choice: { basis: SendBasis; where?: Where }; from: string }
export type ExportItem = ActivityItem | WorkoutItem;

/** Above this, a folder is split, so a phone can hold and save each part. */
export const PART_BYTES = 150 * 1024 * 1024;

/** Rough size of a file before it is made, for "about 12 MB" before the export starts. */
export function estimateBytes(it: ExportItem, actFormat: ActivityFormat, wkFormat: WorkoutFormat): number {
  if (it.kind === 'workout') return wkFormat === 'text' || it.w.kind === 'strength' || it.w.kind === 'mobility' ? 2500 : 4000;
  const secs = Math.max(it.ride.elapsedSeconds ?? 0, it.ride.seconds, 60);
  const f = it.format ?? actFormat;
  return Math.round(secs * (f === 'fit' ? 32 : f === 'tcx' ? 260 : 170));
}

/** "about 3.4 MB" */
export function sizeWords(bytes: number): string {
  if (bytes < 1024 * 1024) return `about ${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The format a workout goes in when the chosen one can't carry it: the Garmin file for anything with steps, the readable list for strength and mobility. */
export function fallbackFormat(w: Workout): WorkoutFormat { return w.kind === 'strength' || w.kind === 'mobility' ? 'text' : 'fit'; }

/** Whether the chosen format can carry this workout, and if not, why. */
export function workoutFits(it: WorkoutItem, format: WorkoutFormat): { ok: boolean; why?: string } {
  const can = workoutExportable(it.w);
  if (!can.ok) return can;
  const offer = workoutOffers(it.w, it.choice.basis).find((o) => o.format === format);
  if (offer?.ok) return { ok: true };
  if (!offer && (it.w.kind === 'strength' || it.w.kind === 'mobility')) return { ok: false, why: 'Strength and mobility sessions go in a readable list; no workout format carries exercises.' };
  return { ok: false, why: offer?.why ?? `${WORKOUT_FORMAT_LABEL[format]} can't carry this ${it.w.kind}.` };
}

export interface Problem { name: string; date?: string; why: string }
export interface BulkResult {
  parts: FileOut[];
  done: number;
  failed: Problem[];
  skipped: Problem[];
  cancelled: boolean;
  /** How the activity files were made, for the note and the report. */
  how: Record<'original' | 'player' | 'record' | 'summary', number>;
}

export interface BulkOptions {
  items: ExportItem[];
  actFormat: ActivityFormat;
  wkFormat: WorkoutFormat;
  /** For workouts the chosen format can't carry: skip them, or take them in a format that can. */
  unfit: 'skip' | 'fallback';
  profile: Profile;
  table: BreathPowerTable;
  credentials: IntervalsCredentials | null;
  onProgress?: (done: number, total: number, now: string) => void;
  cancelled?: () => boolean;
  /** Milliseconds between calls to the data service (tests pass 0). */
  gapMs?: number;
  now?: Date;
  /** The size a folder is split at; PART_BYTES unless a check asks for less. */
  partBytes?: number;
}

interface Row { date: string; name: string; kind: string; length: string; load: string; from: string; file: string; how: string }

const csvCell = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s);
export function csv(rows: Row[]): string {
  const head = ['Date', 'Name', 'Kind', 'Length', 'Load (TSS)', 'Came from', 'File', 'How the file was made'];
  return [head, ...rows.map((r) => [r.date, r.name, r.kind, r.length, r.load, r.from, r.file, r.how])].map((xs) => xs.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const HOW_WORDS = { original: 'the original file, unchanged', player: 'Antogo’s ride file', record: 'written from the second-by-second record', summary: 'summary only (no recording exists)' } as const;
const KIND_WORDS: Record<string, string> = { ride: 'Ride', walk: 'Walk', run: 'Run', strength: 'Strength', mobility: 'Mobility', other: 'Other' };

/** The plain-English note at the top of the folder. */
export function readMe(o: { at: Date; part?: { n: number; of: number }; actFormat?: ActivityFormat; wkFormat?: WorkoutFormat; rows: Row[]; failed: Problem[]; skipped: Problem[]; ftp: number; ergUsed: boolean; hrUsed: boolean; how: BulkResult['how']; sources: Record<string, number> }): string {
  const acts = o.rows.filter((r) => r.how !== 'workout').length;
  const wks = o.rows.length - acts;
  const L: string[] = [];
  L.push(`Antogo export, ${o.at.toLocaleString()}${o.part ? ` (part ${o.part.n} of ${o.part.of})` : ''}`, '');
  L.push('WHAT IS IN THIS FOLDER');
  if (acts) {
    const files = acts - o.how.summary;
    L.push(`- ${acts} finished ${acts === 1 ? 'activity' : 'activities'}${o.how.summary ? `: ${files} as ${o.actFormat ? ACTIVITY_FORMAT_LABEL[o.actFormat] : 'files'}, ${o.how.summary} as short text summaries (only a summary exists)` : o.actFormat ? `, as ${ACTIVITY_FORMAT_LABEL[o.actFormat]}` : ''}.`);
  }
  if (wks) L.push(`- ${wks} ${wks === 1 ? 'workout' : 'workouts'} to ride${o.wkFormat ? `, as ${WORKOUT_FORMAT_LABEL[o.wkFormat]}` : ''}. Strength and mobility sessions are readable lists (.txt).`);
  L.push('- "List of everything.csv": one row per file, with its date, name, kind, length, training load, where it came from and its file name. Any spreadsheet opens it.', '');
  if (acts) {
    L.push('WHERE THE ACTIVITIES CAME FROM');
    for (const [k, n] of Object.entries(o.sources).sort((a, b) => b[1] - a[1])) L.push(`- ${n} from ${k}`);
    L.push('Importing an activity back into the place it came from creates a duplicate there.', '');
    const made = (Object.keys(o.how) as Array<keyof typeof HOW_WORDS>).filter((k) => o.how[k]);
    if (made.length) {
      L.push('HOW THE ACTIVITY FILES WERE MADE');
      for (const k of made) L.push(`- ${o.how[k]}: ${HOW_WORDS[k]}`);
      if (o.how.summary) L.push('Activities with only a summary are short text files: no second-by-second recording was ever kept for them.');
      L.push('');
    }
  }
  L.push('WHERE EACH KIND OF FILE CAN GO');
  L.push('- .fit (activity): Garmin Connect, Strava, TrainingPeaks and most training apps import it.');
  L.push('- .fit (workout): copy it to a Garmin bike computer or watch (into its NewFiles folder over a cable), or import it into an app that takes Garmin workouts.');
  L.push('- .zwo: Zwift (put it in Documents/Zwift/Workouts/<your number>), and many other trainer apps.');
  L.push('- .mrc and .erg: older trainer apps that import workouts.');
  L.push('- .tcx: older apps that don’t read .fit. .gpx: mapping apps; it carries the route.');
  L.push('Each app has its own import limits; check the app’s help if a file is refused.', '');
  L.push('TARGETS');
  L.push('- Power in .fit, .zwo and .mrc workouts is a share of FTP: the device or app uses its own FTP.');
  if (o.ergUsed) L.push(`- Power in .erg workouts is in watts, from an FTP of ${Math.round(o.ftp)} W, your FTP when this was exported.`);
  if (o.hrUsed) L.push('- Heart rate in .fit workouts is in beats per minute, from your heart-rate zones when this was exported.');
  L.push('');
  if (o.skipped.length) {
    L.push('LEFT OUT');
    for (const p of o.skipped) L.push(`- ${p.date ? `${p.date} ` : ''}${p.name}: ${p.why}`);
    L.push('');
  }
  if (o.failed.length) {
    L.push('COULD NOT BE EXPORTED');
    for (const p of o.failed) L.push(`- ${p.date ? `${p.date} ` : ''}${p.name}: ${p.why}`);
    L.push('Export them again later; the rest of this folder is complete.', '');
  }
  return L.join('\r\n');
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run the export. */
export async function runBulk(o: BulkOptions): Promise<BulkResult> {
  const at = o.now ?? new Date();
  const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const folder = `Antogo export ${day}`;
  const result: BulkResult = { parts: [], done: 0, failed: [], skipped: [], cancelled: false, how: { original: 0, player: 0, record: 0, summary: 0 } };
  type Part = { entries: ZipEntry[]; rows: Row[]; bytes: number; sources: Record<string, number>; book: NameBook; how: BulkResult['how']; ergUsed: boolean; hrUsed: boolean };
  const newPart = (): Part => ({ entries: [], rows: [], bytes: 0, sources: {}, book: new NameBook(), how: { original: 0, player: 0, record: 0, summary: 0 }, ergUsed: false, hrUsed: false });
  const parts: Part[] = [newPart()];
  const cur = () => parts[parts.length - 1];
  const add = (f: FileOut, row: Omit<Row, 'file'>) => {
    const size = bytesOf(f.data).length;
    if (cur().bytes + size > (o.partBytes ?? PART_BYTES) && cur().entries.length) parts.push(newPart());
    const p = cur();
    const name = p.book.take(f.name);
    p.entries.push({ name: `${folder}/${name}`, data: f.data, date: at });
    p.rows.push({ ...row, file: name });
    p.bytes += size;
  };
  const total = o.items.length;
  for (let i = 0; i < total; i++) {
    if (o.cancelled?.()) { result.cancelled = true; break; }
    const it = o.items[i];
    if (it.kind === 'workout') {
      const label = it.w.name;
      o.onProgress?.(i, total, label);
      try {
        let format = o.wkFormat;
        const fits = workoutFits(it, format);
        if (!fits.ok) {
          if (!workoutExportable(it.w).ok || o.unfit === 'skip') { result.skipped.push({ name: label, date: it.date, why: fits.why ?? '' }); continue; }
          format = fallbackFormat(it.w);
        }
        const f = workoutFile(it.w, format, it.choice, o.profile, o.table, it.date);
        const st = it.w.kind === 'ride' ? workoutStats(it.w.blocks) : undefined;
        add(f, { date: it.date ?? '', name: label, kind: KIND_WORDS[it.w.kind] ?? it.w.kind, length: st ? clock(st.seconds) : it.w.minutes ? clock(it.w.minutes * 60) : '', load: String(st?.tss ?? it.w.estimatedTss ?? ''), from: it.from, how: 'workout' });
        if (format === 'erg') cur().ergUsed = true;
        if (format === 'fit' && (it.w.kind !== 'ride' || it.choice.basis === 'hr')) cur().hrUsed = true;
        result.done++;
      } catch (e) {
        console.info('[Antogo] export: a workout file could not be written:', (e as Error).message);
        result.failed.push({ name: label, date: it.date, why: 'Its file could not be written.' });
      }
      continue;
    }
    const r = it.ride;
    o.onProgress?.(i, total, r.name);
    try {
      const got = await activityFile(o.credentials, r, it.format ?? o.actFormat, it.origin, it.local);
      if (got.unavailable) result.skipped.push({ name: r.name, date: r.date, why: got.unavailable });
      else {
        add(got.file, { date: r.date, name: r.name, kind: KIND_WORDS[r.sport] ?? r.sport, length: clock(r.seconds), load: r.tss != null ? String(Math.round(r.tss)) : '', from: it.origin.source, how: HOW_WORDS[got.how] });
        cur().sources[it.origin.source] = (cur().sources[it.origin.source] ?? 0) + 1;
        cur().how[got.how]++; result.how[got.how]++;
        result.done++;
      }
    } catch (e) {
      const p = { name: r.name, date: r.date, why: `${(e as Error).message} (tried three times)` };
      result.failed.push(p);
    }
    if (o.gapMs !== 0 && o.credentials) await wait(o.gapMs ?? 300);
  }
  o.onProgress?.(result.done + result.failed.length + result.skipped.length, total, '');
  const of = parts.length;
  // Problems are listed in every part's note, so whichever part is opened says what is missing.
  parts.forEach((p, k) => {
    const note = readMe({ at, part: of > 1 ? { n: k + 1, of } : undefined, actFormat: p.rows.some((r) => r.how !== 'workout') ? o.actFormat : undefined, wkFormat: p.rows.some((r) => r.how === 'workout') ? o.wkFormat : undefined, rows: p.rows, failed: result.failed, skipped: result.skipped, ftp: o.profile.ftp, ergUsed: p.ergUsed, hrUsed: p.hrUsed, how: p.how, sources: p.sources });
    const entries: ZipEntry[] = [{ name: `${folder}/Read me first.txt`, data: note, date: at }, { name: `${folder}/List of everything.csv`, data: '﻿' + csv(p.rows), date: at }, ...p.entries];
    result.parts.push({ name: safeName(of > 1 ? `${folder} part ${k + 1} of ${of}` : folder, 'zip'), data: zip(entries), mime: 'application/zip' });
  });
  return result;
}
