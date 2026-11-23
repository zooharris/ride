import { db, getSetting, setSetting } from '../data/db';
import type { Ride, Wellness } from '../engine/types';
import { addActivity, mergeFileCopies, pairAdded, withStarts } from '../import/importer';
import { NOT_ACTIVITY, readActivityFile } from '../import/readers';
import { fillDays, wellnessFromJson } from '../import/wellnessExport';
import { GARMIN_BASE, TOKEN_PATH, tokenExpiry, unzipFirst } from './garminPersonal';

/**
 * Garmin as a source (23 Nov 2026, the Mac app's step two): with the rider's own personal key and their say-so, the
 * installed app brings their activities (each one's original file) and daily wellness straight from Garmin. Nothing is
 * written to Garmin; the key only reads. An activity already here is never added twice (the rule for second copies),
 * and what the app already holds for a day of wellness is never replaced. Garmin does not publish what these answers
 * hold beyond its own client, so they are read tolerantly, by the names they are known to use; anything not understood
 * is counted and skipped, never guessed.
 */

/** The rider's say-so, and what has been done so far. Both belong to this device only. */
export const GARMIN_ON = 'garminSource';
export const GARMIN_PROGRESS = 'garminProgress';

type Seen = 'added' | 'already' | 'none' | 'unread';
export interface GarminProgress {
  /** Each Garmin activity already dealt with, by Garmin's id, so it is never asked for twice. */
  seen: Record<string, Seen>;
  /** A run has been through Garmin's whole list at least once, so later runs stop at the first page with nothing new. */
  whole?: boolean;
  /** When the last run finished. */
  last?: string;
  /** The oldest day wellness has been asked for, and whether Garmin has nothing older. */
  wellnessBack?: string;
  wellnessWhole?: boolean;
  /** Days of wellness Garmin has filled in, in all. */
  days?: number;
  /** For the last fortnight: the measures Garmin itself supplied each day, which a later reading from Garmin may refresh. */
  supplied?: Record<string, string[]>;
  /** Garmin refused the key: nothing more is asked until the key is replaced. */
  refused?: string;
}

export interface GarminState {
  on: boolean; running: boolean;
  phase: 'idle' | 'list' | 'files' | 'wellness' | 'waiting' | 'refused' | 'stopped';
  /** This run: activities Garmin listed that were new to this device, and how many are done. */
  toDo: number; done: number;
  /** In all, from the record kept. */
  added: number; already: number; noFile: number; unread: number; days: number;
  last?: string; error?: string;
}

let state: GarminState = { on: false, running: false, phase: 'idle', toDo: 0, done: 0, added: 0, already: 0, noFile: 0, unread: 0, days: 0 };
const listeners = new Set<(s: GarminState) => void>();
const emit = (patch: Partial<GarminState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l(state)); };
export function watchGarmin(fn: (s: GarminState) => void): () => void { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
export const garminState = () => state;

const totals = (p: GarminProgress) => {
  const v = Object.values(p.seen);
  return { added: v.filter((x) => x === 'added').length, already: v.filter((x) => x === 'already').length, noFile: v.filter((x) => x === 'none').length, unread: v.filter((x) => x === 'unread').length, days: p.days ?? 0, last: p.last };
};
export async function readProgress(): Promise<GarminProgress> { return { seen: {}, ...(await getSetting<Partial<GarminProgress>>(GARMIN_PROGRESS, {})) }; }

/** Show what the record says, before any run (the page's first view). */
export async function loadGarminState(): Promise<GarminState> {
  const [on, p] = await Promise.all([getSetting<boolean>(GARMIN_ON, false), readProgress()]);
  if (!state.running) emit({ on, ...totals(p), phase: p.refused ? 'refused' : state.phase === 'refused' ? 'idle' : state.phase, error: p.refused ?? (state.phase === 'refused' ? undefined : state.error) });
  return state;
}

/** One activity as Garmin lists it. Only the id is relied on; the rest is used where present. */
export interface Listed {
  activityId?: number | string; activityName?: string; startTimeLocal?: string; startTimeGMT?: string;
  duration?: number; elapsedDuration?: number; movingDuration?: number; distance?: number; activityType?: { typeKey?: string };
}

export interface GarminDeps {
  /** Asks Garmin (in the app, through the app's own side). */
  fetch: typeof fetch;
  /** The rider's key, from the computer's password store. */
  key: () => Promise<string | undefined>;
  /** Told when activities or wellness changed, so the screens re-read. */
  changed: () => void;
  /** Works out again whatever is out of step (an activity that has just gained its original file). */
  settle: () => Promise<unknown>;
  gapMs?: number; wellnessGapMs?: number; now?: () => Date;
}

class Stop extends Error { constructor(public kind: 'refused' | 'slow' | 'offline', message: string) { super(message); } }

let token: { value: string; until: number } | undefined;
/** Forget the pass (the key changed or was forgotten). */
export function forgetGarminPass(): void { token = undefined; }

async function pass(d: GarminDeps): Promise<string> {
  const now = (d.now?.() ?? new Date()).getTime();
  if (token && token.until - now > 5 * 60_000) return token.value;
  const key = await d.key();
  if (!key) throw new Stop('refused', 'No Garmin key is saved.');
  let res: Response;
  try { res = await d.fetch(GARMIN_BASE + TOKEN_PATH, { method: 'POST', headers: { Accept: '*/*', Authorization: `ApiKey ${key.trim()}` } }); }
  catch { throw new Stop('offline', 'Garmin could not be reached.'); }
  if (res.status === 401 || res.status === 403) throw new Stop('refused', 'Garmin refused the key. It may have expired or been deleted: make a new one in Garmin Connect and save it here.');
  if (res.status === 429) throw new Stop('slow', 'Garmin asked to slow down.');
  if (!res.ok) throw new Stop('offline', `Garmin answered ${res.status}.`);
  const value = (await res.text()).trim().replace(/^"|"$/g, '');
  const exp = tokenExpiry(value);
  token = { value, until: exp ? Date.parse(exp) : now + 3600_000 };
  return value;
}

/** One read from Garmin. `undefined` for "nothing there" (404) or a request Garmin will not answer (400): the caller decides what that means. */
async function get(d: GarminDeps, path: string, again = true): Promise<{ json?: unknown; bytes?: Uint8Array } | undefined> {
  const t = await pass(d);
  let res: Response;
  try { res = await d.fetch(GARMIN_BASE + path, { headers: { Accept: '*/*', Authorization: `Bearer ${t}` } }); }
  catch { throw new Stop('offline', 'Garmin could not be reached.'); }
  if (res.status === 401 && again) { token = undefined; return get(d, path, false); }
  if (res.status === 401 || res.status === 403) throw new Stop('refused', 'Garmin refused the key. It may have expired or been deleted: make a new one in Garmin Connect and save it here.');
  if (res.status === 429) throw new Stop('slow', 'Garmin asked to slow down.');
  if (res.status === 404 || res.status === 400 || res.status === 204) return undefined;
  if (!res.ok) throw new Stop('offline', `Garmin answered ${res.status}.`);
  if (/json/.test(res.headers.get('content-type') ?? '')) return { json: await res.json().catch(() => undefined) };
  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5));

/** Garmin's "2026-11-21 18:02:20" (GMT) as a moment in time. */
export function gmtMoment(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(`${s.trim().replace(' ', 'T').replace(/Z$/, '')}Z`);
  return isFinite(t) ? t : undefined;
}

/**
 * Whether an activity Garmin lists is already here with its original file kept, told without downloading anything:
 * an activity here whose own file begins at the very same moment (within five seconds) and lasts about as long. Any
 * doubt, and the file is fetched and the usual rule for second copies decides.
 */
export async function hereWithFile(a: Listed, rides: Ride[]): Promise<boolean> {
  const at = gmtMoment(a.startTimeGMT);
  const long = a.elapsedDuration ?? a.duration ?? a.movingDuration;
  if (at == null || !long) return false;
  for (const r of rides) {
    if (!r.startFromFile || !r.startUtc || Math.abs(Date.parse(r.startUtc) - at) > 5000) continue;
    const mine = [r.elapsedSeconds, r.seconds, r.movingSeconds].filter((x): x is number => !!x);
    const theirs = [a.elapsedDuration, a.duration, a.movingDuration].filter((x): x is number => !!x);
    if (!mine.some((x) => theirs.some((y) => Math.abs(x - y) <= Math.max(x, y) * 0.1))) continue;
    if ((await db.files.get(r.id))?.status === 'kept') return true;
  }
  return false;
}

/**
 * Wellness from Garmin laid over what the app holds: a day or a measure that is missing is filled in; what is here is
 * never replaced, except a measure Garmin itself supplied within the last week, which Garmin's newer reading may
 * refresh (steps grow through the day, sleep arrives in the morning). Returns the days to save and how many gained something.
 */
export function layWellness(have: Map<string, Wellness>, found: Map<string, Partial<Wellness>>, supplied: Record<string, string[]>, today: string): { put: Wellness[]; supplied: Record<string, string[]>; gained: number } {
  const out = new Map<string, Wellness>();
  const next: Record<string, string[]> = {};
  const recent = addDays(today, -7);
  let gained = 0;
  for (const w of fillDays(have, found)) { out.set(w.date, w); gained++; }
  for (const [date, m] of found) {
    const before = have.get(date) as Record<string, unknown> | undefined;
    const mine = new Set(supplied[date] ?? []);
    // What Garmin filled in this time is Garmin's.
    for (const [k, v] of Object.entries(m)) if (v != null && before?.[k] == null) mine.add(k);
    if (date >= recent) {
      const cur = { ...(out.get(date) ?? have.get(date) ?? { date }) } as Record<string, unknown>;
      let moved = false;
      for (const [k, v] of Object.entries(m)) if (v != null && mine.has(k) && cur[k] !== v) { cur[k] = v; moved = true; }
      if (moved) out.set(date, cur as unknown as Wellness);
    }
    if (date >= addDays(today, -14) && mine.size) next[date] = [...mine];
  }
  // Days not asked about this time keep their note until they are a fortnight old.
  for (const [date, keys] of Object.entries(supplied)) if (!next[date] && date >= addDays(today, -14)) next[date] = keys;
  return { put: [...out.values()], supplied: next, gained };
}

let running: Promise<GarminState> | null = null;

/** One run: the list, the files that are new, then wellness. One at a time; a second call joins the run under way. */
export function runGarmin(d: GarminDeps): Promise<GarminState> {
  if (running) return running;
  running = run(d).finally(() => { running = null; });
  return running;
}

async function run(d: GarminDeps): Promise<GarminState> {
  const on = await getSetting<boolean>(GARMIN_ON, false);
  const prog = await readProgress();
  if (!on) { emit({ on: false, running: false }); return state; }
  const save = async () => { await setSetting(GARMIN_PROGRESS, prog); emit(totals(prog)); };
  const now = () => d.now?.() ?? new Date();
  emit({ on: true, running: true, phase: 'list', toDo: 0, done: 0, error: undefined, ...totals(prog) });
  const fresh: Ride[] = [];
  let touched = false;
  try {
    // 1. The list, newest first, until a whole page is already dealt with.
    const todo: Listed[] = [];
    for (let start = 0, pages = 0; pages < 200; start += 100, pages++) {
      const r = await get(d, `/activitylist-service/activities/search/activities?start=${start}&limit=100`);
      const list = (Array.isArray(r?.json) ? r!.json : []) as Listed[];
      const unseen = list.filter((a) => a.activityId != null && !prog.seen[String(a.activityId)]);
      todo.push(...unseen);
      if (list.length < 100 || (!unseen.length && prog.whole)) break;
    }
    prog.refused = undefined;
    emit({ phase: todo.length ? 'files' : 'wellness', toDo: todo.length });
    // 2. Each one new to this device: recognised as here already, or its file fetched.
    const p = (await db.profile.get('me')) ?? undefined;
    let n = 0;
    for (const a of todo) {
      if (!(await getSetting<boolean>(GARMIN_ON, false))) break;   // turned off while running
      const id = String(a.activityId);
      const day = (a.startTimeLocal ?? '').slice(0, 10);
      // Activities around that day, each with its exact start read from its own kept file where it has one.
      const near = /^\d{4}-\d{2}-\d{2}$/.test(day) ? await withStarts(await db.rides.where('date').between(addDays(day, -1), addDays(day, 1), true, true).toArray()) : [];
      if (await hereWithFile(a, near)) prog.seen[id] = 'already';
      else {
        const r = await get(d, `/download-service/files/activity/${id}`);
        if (!r?.bytes?.length) prog.seen[id] = 'none';
        else {
          const file = (await unzipFirst(r.bytes).catch(() => undefined)) ?? r.bytes;
          const parsed = await readActivityFile(`${id}.fit`, file).catch(() => undefined);
          if (!parsed || parsed === NOT_ACTIVITY) prog.seen[id] = 'unread';
          else {
            const added = await addActivity(parsed, file, p);
            touched = true;
            if (added === 'already') prog.seen[id] = 'already';
            else {
              // Garmin's own name for it, and where it came from.
              const named: Ride = { ...added, via: 'garmin', ...(a.activityName?.trim() ? { name: a.activityName.trim() } : {}) };
              await db.rides.put(named);
              fresh.push(named);
              prog.seen[id] = 'added';
            }
          }
        }
        await sleep(d.gapMs ?? 1500);
      }
      emit({ done: ++n });
      if (n % 10 === 0) { await save(); if (touched) d.changed(); }
    }
    if (n === todo.length) prog.whole = true;
    await save();
    // 3. Wellness: the last week every time, then further back until Garmin has no more.
    emit({ phase: 'wellness' });
    const today = ymd(now());
    let size = 28;
    const chunk = async (from: string, to: string): Promise<{ found: Map<string, Partial<Wellness>>; answered: boolean }> => {
      const found = new Map<string, Partial<Wellness>>();
      let answered = false;
      for (const path of [`/hrv-service/hrv/daily/${from}/${to}`, `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${from}&endDate=${to}`, `/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${to}`]) {
        const r = await get(d, path);
        if (r?.json != null) {
          answered = true;
          for (const [day, m] of wellnessFromJson(r.json)) if (day >= from && day <= to) found.set(day, { ...(found.get(day) ?? {}), ...m });
        }
        await sleep(d.wellnessGapMs ?? 400);
      }
      return { found, answered };
    };
    const lay = async (found: Map<string, Partial<Wellness>>) => {
      if (!found.size) return;
      const have = new Map((await db.wellness.bulkGet([...found.keys()])).filter((w): w is Wellness => !!w).map((w) => [w.date, w]));
      const laid = layWellness(have, found, prog.supplied ?? {}, today);
      prog.supplied = laid.supplied;
      if (laid.put.length) { await db.wellness.bulkPut(laid.put); prog.days = (prog.days ?? 0) + laid.gained; touched = true; }
    };
    await lay((await chunk(addDays(today, -6), today)).found);
    if (!prog.wellnessBack) prog.wellnessBack = addDays(today, -6);
    await save();
    for (let empty = 0; !prog.wellnessWhole && empty < 3;) {
      if (!(await getSetting<boolean>(GARMIN_ON, false))) break;
      const to = addDays(prog.wellnessBack!, -1), from = addDays(to, -(size - 1));
      const c = await chunk(from, to);
      // A long stretch Garmin will not answer is asked again a week at a time, before it counts as nothing there.
      if (!c.answered && size > 7) { size = 7; continue; }
      await lay(c.found);
      empty = c.found.size ? 0 : empty + 1;
      prog.wellnessBack = from;
      if (empty >= 3 || from < '2005-01-01') prog.wellnessWhole = true;
      await save();
    }
    // 4. What was added is matched to planned sessions; second copies become one; anything out of step is worked out again.
    if (fresh.length) await pairAdded(fresh.map((r) => r.id));
    if (touched) { await mergeFileCopies().catch(() => 0); await d.settle().catch(() => {}); }
    prog.last = now().toISOString();
    await save();
    emit({ running: false, phase: 'idle' });
  } catch (e) {
    const stop = e instanceof Stop ? e : new Stop('offline', (e as Error).message || 'Something went wrong.');
    if (stop.kind === 'refused') prog.refused = stop.message;
    await save().catch(() => {});
    if (fresh.length) await pairAdded(fresh.map((r) => r.id)).catch(() => {});
    if (touched) await d.settle().catch(() => {});
    emit({ running: false, phase: stop.kind === 'refused' ? 'refused' : stop.kind === 'slow' ? 'waiting' : 'stopped', error: stop.kind === 'slow' ? 'Garmin asked to slow down. It carries on the next time.' : stop.kind === 'offline' ? `${stop.message} It carries on the next time.` : stop.message });
  }
  if (touched) d.changed();
  return state;
}

/** The rider's say-so, on or off. Turning it off stops a run under way at its next step; what was brought in stays. */
export async function setGarminOn(on: boolean): Promise<void> {
  await setSetting(GARMIN_ON, on);
  if (on) { const p = await readProgress(); if (p.refused) { p.refused = undefined; await setSetting(GARMIN_PROGRESS, p); } }
  emit({ on, ...(on ? { phase: 'idle' as const, error: undefined } : {}) });
}

/** A new key was saved: whatever Garmin said about the old one no longer holds. */
export async function garminKeyChanged(): Promise<void> {
  forgetGarminPass();
  const p = await readProgress();
  if (p.refused) { p.refused = undefined; await setSetting(GARMIN_PROGRESS, p); }
  if (state.phase === 'refused') emit({ phase: 'idle', error: undefined });
}
