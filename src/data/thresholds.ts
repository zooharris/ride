import { db, getSetting, untracked } from './db';
import type { Profile, Ride } from '../engine/types';
import { knownFtp, knownLthr } from '../engine/known';
import { FOOT_LTHR_HISTORY, FTP_HISTORY, FTP_SCORING, LTHR_HISTORY, setThresholdCtx, type HistoryKey, type ThresholdCtx } from '../engine/thresholdCtx';
import { earlierSeed, EMPTY_HISTORY, periodsOf, sameHistory, seedFtp, sorted, withEntry, type FtpScoring, type Period, type ThresholdHistory } from '../engine/thresholdHistory';

/**
 * Antogo's own threshold histories on this device (22 Nov 2026): read, written, and filled in once for a rider who
 * already has activities. They are settings, so they travel to the rider's other devices in the note and into Back up
 * everything; two devices' copies are merged day by day (data/devicesync), never one over the other.
 */

/** What the app fills in is dated before anything the rider does, so in a merge of two devices it never wins over their own entry or removal. */
const FILLED_IN = '1970-01-01T00:00:00.000Z';

const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function readHistory(key: HistoryKey): Promise<ThresholdHistory | undefined> {
  const s = await db.settings.get(key);
  const v = s?.value as ThresholdHistory | undefined;
  return v && Array.isArray(v.entries) ? v : undefined;
}
/** Save a history the rider changed: stamped, so it reaches their other devices. */
export async function writeHistory(key: HistoryKey, h: ThresholdHistory): Promise<void> {
  await db.settings.put({ key, value: { entries: sorted(h), ...(h.removed && Object.keys(h.removed).length ? { removed: h.removed } : {}) } });
}

export async function ftpScoring(): Promise<FtpScoring> {
  return (await getSetting<FtpScoring | undefined>(FTP_SCORING, undefined)) === 'device' ? 'device' : 'antogo';
}

/** Read everything scoring needs from storage, and hold it for the scoring to read. */
export async function refreshThresholds(): Promise<ThresholdCtx> {
  const [ftp, lthr, foot, scoring, edits] = await Promise.all([readHistory(FTP_HISTORY), readHistory(LTHR_HISTORY), readHistory(FOOT_LTHR_HISTORY), ftpScoring(), db.activityEdits.toArray()]);
  const c: ThresholdCtx = { ftp, lthr, footLthr: foot, scoring, edits: new Map(edits.map((e) => [e.id, e])) };
  setThresholdCtx(c);
  return c;
}

/** The FTP the data service kept with an activity, from before Antogo kept its own: the one record of what Antogo's FTP was that day. */
function serviceFtpOf(r: Ride, rec: { serviceFtp?: number } | undefined, first: boolean): number | undefined {
  // An activity from before the two were told apart carries it as its FTP, until the first scoring by Antogo's own
  // rule (which keeps it aside as `ftpService` before writing its own): so that reading is good the first time only.
  return rec?.serviceFtp ?? r.ftpService ?? (first && r.source !== 'file' && r.ftpFrom !== 'device' && !r.ftpDevice ? r.ftpAtRide : undefined);
}

/** The tests done in Antogo whose FTP the rider took, with the day each was ridden. */
async function testsTaken(rides: Map<string, Ride>): Promise<Array<{ date: string; value: number; name: string }>> {
  const out: Array<{ date: string; value: number; name: string }> = [];
  const rows = await db.settings.filter((s) => s.key.startsWith('testResult:')).toArray();
  for (const s of rows) {
    const t = s.value as { kind?: string; ftpAction?: string; ftpEstimate?: number } | null;
    const r = rides.get(s.key.slice('testResult:'.length));
    if (t?.ftpAction === 'updated' && t.ftpEstimate && r) out.push({ date: r.date, value: t.ftpEstimate, name: t.kind === '20min' ? '20-minute test' : 'Ramp Test' });
  }
  return out;
}

/** The FTP history the rider's activities point to (A3), without saving it. */
export async function ftpSeed(p: Profile, first = false): Promise<ThresholdHistory> {
  const rides = await db.rides.toArray();
  const recs = new Map((await db.own.toArray()).map((x) => [x.id, x]));
  const points = rides.filter((r) => r.sport === 'ride' && !r.notTraining).map((r) => ({ date: r.setAside?.start?.date ?? r.date, value: serviceFtpOf(r, recs.get(r.id), first) }));
  const ftp = p.unsure?.ftp ? undefined : knownFtp(p);
  return seedFtp({ points, tests: await testsTaken(new Map(rides.map((r) => [r.id, r]))), now: ftp ? { value: ftp, setOn: p.ftpSetOn } : undefined, today: localDay(), at: FILLED_IN });
}

/** The FTP each activity's own file says the device had set, as periods (A5, E1). */
export async function devicePeriods(ids?: Set<string>): Promise<Period[]> {
  const rides = (await db.rides.toArray()).filter((r) => r.sport === 'ride' && (!ids || ids.has(r.id)));
  const recs = new Map((await db.own.toArray()).map((x) => [x.id, x]));
  return periodsOf(rides.map((r) => ({ date: r.date, value: r.ftpDevice ?? recs.get(r.id)?.deviceFtp })));
}

const startOf = (value: number | undefined, setOn: string | undefined): ThresholdHistory =>
  value ? withEntry(EMPTY_HISTORY, { from: setOn ?? localDay(), value, source: 'start', at: FILLED_IN }) : EMPTY_HISTORY;

/**
 * Make sure the histories exist on this device (A3, D2). Filled in once per rider: a device connected to the rider's
 * others waits until it has merged with them (so it takes the history they already have), and what is filled in is
 * left unstamped, so it never wins over a history the rider has changed elsewhere. Later, activities older than the
 * history's first entry (a longer history loaded since) are added in front. Returns whether anything changed.
 */
export async function ensureHistories(): Promise<boolean> {
  const p = await db.profile.get('me');
  if (!p) return false;
  const connected = await getSetting<{ apiKey?: string } | null>('intervals', null);
  const sync = await getSetting<{ last?: string; locked?: unknown } | null>('deviceSync', null);
  if (connected?.apiKey && !sync?.last && !sync?.locked) return false;
  let changed = false;
  const put = (key: HistoryKey, h: ThresholdHistory) => untracked(() => db.settings.put({ key, value: h })).then(() => { changed = true; });
  const ftp = await readHistory(FTP_HISTORY);
  if (!ftp) await put(FTP_HISTORY, await ftpSeed(p, true));
  else {
    const more = earlierSeed(ftp, await ftpSeed(p));
    if (!sameHistory(more, ftp)) { await writeHistory(FTP_HISTORY, more); changed = true; }
  }
  if (!(await readHistory(LTHR_HISTORY))) await put(LTHR_HISTORY, startOf(p.unsure?.lthr ? undefined : knownLthr(p), p.lthrSetOn));
  if (!(await readHistory(FOOT_LTHR_HISTORY))) await put(FOOT_LTHR_HISTORY, startOf(p.footLthr, undefined));
  if (changed) await refreshThresholds();
  return changed;
}
