import { db, getSetting, setSetting, type KeptFile } from '../data/db';
import { addDays, today } from '../engine/load';
import { fetchActivityFile, fetchRides, fetchWellness, IntervalsError, type IntervalsCredentials } from './intervals';

/**
 * Stage 0 (22 Nov 2026): protect what the rider has. Garmin has changed its terms and Intervals.icu expects to stop
 * passing Garmin detail on to apps, so while it still can, this device keeps the rider's whole history: every
 * activity and day of wellness Intervals.icu holds, as far back as it goes, and each activity's original file.
 * It runs in the background after a sync, gently (one file at a time, with a pause between), and carries on from
 * where it stopped the next time the app is open. Nothing here changes what the rider sees until it is needed.
 */

/** A pause between files, so a long history never crowds the data service. */
export const FILE_GAP_MS = 1500;
/** When the data service says to slow down, wait this long before carrying on. */
export const BACKOFF_MS = 60_000;
/** Years with nothing at all, one after another, before the search for the start of the history stops (a year or two off the bike, and off the watch, happens). */
const EMPTY_YEARS = 3;
/** The furthest back the search goes. */
const MAX_YEARS = 30;

export interface KeepState {
  phase: 'idle' | 'history' | 'files' | 'waiting' | 'done' | 'stopped';
  /** Files kept and activities with no file, against all activities on this device. */
  kept: number; none: number; total: number; bytes: number;
  /** Where the whole history starts, once found. */
  from?: string;
  error?: string;
}

let state: KeepState = { phase: 'idle', kept: 0, none: 0, total: 0, bytes: 0 };
const listeners = new Set<(s: KeepState) => void>();
const emit = (patch: Partial<KeepState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export function watchKeeping(fn: (s: KeepState) => void): () => void { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export const keepState = () => state;

/** What this device holds, counted afresh. */
export async function keepCounts(): Promise<Pick<KeepState, 'kept' | 'none' | 'total' | 'bytes'>> {
  const total = await db.rides.count();
  let kept = 0, none = 0, bytes = 0;
  await db.files.each((f) => { if (f.status === 'kept') { kept++; bytes += f.size ?? 0; } else none++; });
  return { kept, none, total, bytes };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Where the rider's history in Intervals.icu begins: a year at a time back from the earliest day this device holds,
 * until three years in a row have no activity and no wellness at all.
 */
export async function findHistoryStart(c: IntervalsCredentials, earliestHere: string, fetch = { rides: fetchRides, wellness: fetchWellness }): Promise<string> {
  let earliest = earliestHere;
  let empty = 0;
  let to = addDays(earliestHere, -1);
  for (let y = 0; y < MAX_YEARS && empty < EMPTY_YEARS; y++) {
    const from = addDays(to, -364);
    const [rides, well] = await Promise.all([fetch.rides(c, from, to), fetch.wellness(c, from, to)]);
    const dates = [...rides.map((r) => r.date), ...well.filter((w) => hasAnyWellness(w)).map((w) => w.date)];
    if (dates.length) { empty = 0; earliest = dates.reduce((m, d) => (d < m ? d : m), earliest); } else empty++;
    to = addDays(from, -1);
  }
  return earliest;
}
const hasAnyWellness = (w: object) => Object.entries(w).some(([k, v]) => k !== 'date' && k !== 'id' && v != null && v !== 0);

/** What to do with a file the data service would not give. */
export function fileRefusal(e: unknown): { kind: 'none' | 'slow' | 'stop'; why: string } {
  const status = e instanceof IntervalsError ? e.status : undefined;
  if (status === 404 || status === 422 || status === 400) return { kind: 'none', why: 'Intervals.icu has no original file for this activity (entered by hand, or shared only by another service).' };
  if (status === 429) return { kind: 'slow', why: 'Intervals.icu asked to slow down.' };
  if (status === 401 || status === 403) return { kind: 'stop', why: 'Intervals.icu refused the key.' };
  return { kind: 'stop', why: (e as Error)?.message ?? 'Could not reach Intervals.icu.' };
}

let running: Promise<void> | null = null;

/** Keep the whole history, then every activity's file. One run at a time; safe to call after every sync. */
export function keepHistory(c: IntervalsCredentials, deps: { loadHistory: (back: string) => Promise<unknown>; gapMs?: number } ): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      emit({ ...(await keepCounts()), error: undefined });
      // 1. The whole history, once: activities and wellness back to where Intervals.icu's record starts.
      const whole = await getSetting<{ from: string; at: string } | null>('historyWhole', null);
      if (!whole) {
        emit({ phase: 'history' });
        const firstR = await db.rides.orderBy('date').first();
        const firstW = await db.wellness.orderBy('date').first();
        const here = [firstR?.date, firstW?.date, today()].filter((d): d is string => !!d).sort()[0];
        const from = await findHistoryStart(c, here);
        if (from < here) await deps.loadHistory(from);
        await setSetting('historyWhole', { from, at: new Date().toISOString() });
        emit({ from, ...(await keepCounts()) });
      } else emit({ from: whole.from });
      // 2. Each activity's original file, newest first.
      emit({ phase: 'files' });
      const have = new Set((await db.files.toCollection().primaryKeys()) as string[]);
      const todo = (await db.rides.orderBy('date').reverse().toArray()).filter((r) => !have.has(r.id) && !r.id.startsWith('local-'));
      for (const r of todo) {
        try {
          const bytes = await fetchActivityFile(c, r.id);
          const f: KeptFile = { id: r.id, date: r.date, status: 'kept', bytes, size: bytes.byteLength, at: new Date().toISOString() };
          await db.files.put(f);
          emit({ kept: state.kept + 1, bytes: state.bytes + bytes.byteLength });
        } catch (e) {
          const why = fileRefusal(e);
          if (why.kind === 'none') { await db.files.put({ id: r.id, date: r.date, status: 'none', at: new Date().toISOString(), why: why.why }); emit({ none: state.none + 1 }); }
          else if (why.kind === 'slow') { emit({ phase: 'waiting' }); await sleep(BACKOFF_MS); emit({ phase: 'files' }); continue; }
          else { emit({ phase: 'stopped', error: why.why }); return; }
        }
        await sleep(deps.gapMs ?? FILE_GAP_MS);
      }
      emit({ phase: 'done', ...(await keepCounts()) });
    } catch (e) {
      emit({ phase: 'stopped', error: (e as Error).message });
    } finally { running = null; }
  })();
  return running;
}

/** A kept file, for showing an activity whose detail did not come from the data service. */
export async function keptFile(id: string): Promise<Uint8Array | undefined> {
  const f = await db.files.get(id);
  return f?.status === 'kept' ? f.bytes : undefined;
}
