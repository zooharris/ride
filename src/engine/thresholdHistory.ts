/**
 * Antogo's own dated history of a threshold (22 Nov 2026): "from this day, it was this". FTP has one; threshold heart
 * rate has one on the bike and one on foot. Each activity is scored by the entry in force on its day. The rider can
 * add, change and remove entries, the past included. Pure: storage and screens live elsewhere.
 *
 * Nothing here is shaped on any rider or any maker of device: a device's figure is whatever an activity's own file
 * carried, and is only ever a suggestion.
 */

/** How an entry got there, said on the page beside it. */
export type EntrySource = 'test' | 'settings' | 'service' | 'activities' | 'device' | 'typed' | 'start';

export interface ThresholdEntry {
  /** The first day it applies, YYYY-MM-DD. One entry a day. */
  from: string;
  value: number;
  source: EntrySource;
  /** A word more on the source: the test's name ("Ramp Test"), say. */
  note?: string;
  /** When this entry was last written (ISO): the newer of two devices' copies of one day wins. */
  at: string;
}

export interface ThresholdHistory {
  entries: ThresholdEntry[];
  /** Days whose entry the rider removed, and when, so a removal carries to their other devices. */
  removed?: Record<string, string>;
}

export const EMPTY_HISTORY: ThresholdHistory = { entries: [] };

const byDay = (a: ThresholdEntry, b: ThresholdEntry) => a.from.localeCompare(b.from);
export const sorted = (h: ThresholdHistory | undefined | null): ThresholdEntry[] => [...(h?.entries ?? [])].sort(byDay);

/** The entry in force on a day: the latest that starts on or before it. Undefined before the first. */
export function entryOn(h: ThresholdHistory | undefined | null, day: string): ThresholdEntry | undefined {
  let found: ThresholdEntry | undefined;
  for (const e of sorted(h)) { if (e.from <= day) found = e; else break; }
  return found;
}
export const firstEntry = (h: ThresholdHistory | undefined | null): ThresholdEntry | undefined => sorted(h)[0];

/** Add an entry, or change the one already on that day. */
export function withEntry(h: ThresholdHistory | undefined | null, e: Omit<ThresholdEntry, 'at'> & { at?: string }): ThresholdHistory {
  const at = e.at ?? new Date().toISOString();
  const entries = (h?.entries ?? []).filter((x) => x.from !== e.from);
  entries.push({ from: e.from, value: Math.round(e.value), source: e.source, ...(e.note ? { note: e.note } : {}), at });
  const removed = { ...(h?.removed ?? {}) };
  delete removed[e.from];
  return { entries: entries.sort(byDay), ...(Object.keys(removed).length ? { removed } : {}) };
}

/** Remove the entry on a day. */
export function withoutEntry(h: ThresholdHistory | undefined | null, day: string, at = new Date().toISOString()): ThresholdHistory {
  if (!(h?.entries ?? []).some((x) => x.from === day)) return h ?? EMPTY_HISTORY;
  return { entries: (h?.entries ?? []).filter((x) => x.from !== day).sort(byDay), removed: { ...(h?.removed ?? {}), [day]: at } };
}

/**
 * Two devices' copies made one. Day by day: a removal newer than the entry removes it; of two entries for one day the
 * newer wins, except that two saying the same figure keep the older (the one that says how it first got there).
 */
export function mergeHistories(a: ThresholdHistory | undefined | null, b: ThresholdHistory | undefined | null): ThresholdHistory {
  const removed: Record<string, string> = { ...(a?.removed ?? {}) };
  for (const [d, at] of Object.entries(b?.removed ?? {})) if (!removed[d] || removed[d] < at) removed[d] = at;
  const days = new Map<string, ThresholdEntry>();
  for (const e of [...(a?.entries ?? []), ...(b?.entries ?? [])]) {
    const cur = days.get(e.from);
    if (!cur) days.set(e.from, e);
    else if (cur.value === e.value) { if (e.at < cur.at) days.set(e.from, e); }
    else if (e.at > cur.at) days.set(e.from, e);
  }
  const entries: ThresholdEntry[] = [];
  for (const e of days.values()) { if (removed[e.from] && removed[e.from] >= e.at) continue; delete removed[e.from]; entries.push(e); }
  return { entries: entries.sort(byDay), ...(Object.keys(removed).length ? { removed } : {}) };
}

export const sameHistory = (a: ThresholdHistory | undefined | null, b: ThresholdHistory | undefined | null): boolean =>
  JSON.stringify({ e: sorted(a), r: Object.entries(a?.removed ?? {}).sort() }) === JSON.stringify({ e: sorted(b), r: Object.entries(b?.removed ?? {}).sort() });

/** A figure that held over a stretch of days: from its first day to its last (open when it still holds). */
export interface Period { value: number; from: string; to?: string; rides: number }

/**
 * A dated figure per activity turned into periods: each change of figure starts a new one. A period runs from the
 * first activity that carried the figure to the last that did (what lay between two periods is not known, and is
 * claimed by neither); the last period is open, as the figure still holds.
 */
export function periodsOf(points: Array<{ date: string; value: number | undefined }>): Period[] {
  const pts = points.filter((p): p is { date: string; value: number } => !!p.value && p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  const out: Period[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.value === p.value) { last.rides++; last.to = p.date; continue; }
    if (last && last.from === p.date) { last.value = p.value; last.rides++; continue; }   // two figures on one day: the later ride's stands
    out.push({ value: p.value, from: p.date, to: p.date, rides: 1 });
  }
  if (out.length) delete out[out.length - 1].to;
  return out;
}

export function dayBefore(d: string): string { return shift(d, -1); }
export function dayAfter(d: string): string { return shift(d, 1); }
function shift(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * The history filled in for a rider who already has activities (A3): each change in the FTP the data service kept
 * with their activities becomes an entry. A change that matches a test whose result the rider took is dated on the
 * test's day and says so. It ends on the rider's FTP as it is now.
 */
export function seedFtp(o: { points: Array<{ date: string; value: number | undefined }>; tests?: Array<{ date: string; value: number; name: string }>; now?: { value: number; setOn?: string }; today: string; at?: string }): ThresholdHistory {
  const at = o.at ?? new Date().toISOString();
  let h: ThresholdHistory = EMPTY_HISTORY;
  const periods = periodsOf(o.points);
  periods.forEach((p, i) => {
    // The test that set this figure, if one did: on or before the first ride with it, and after the figure before it began.
    const test = i > 0 ? (o.tests ?? []).filter((t) => t.value === p.value && t.date <= p.from && t.date > periods[i - 1].from).sort((a, b) => b.date.localeCompare(a.date))[0] : undefined;
    h = test ? withEntry(h, { from: test.date, value: p.value, source: 'test', note: test.name, at }) : withEntry(h, { from: p.from, value: p.value, source: 'activities', at });
  });
  const last = sorted(h).pop();
  if (o.now?.value && last?.value !== o.now.value) {
    const test = (o.tests ?? []).filter((t) => t.value === o.now!.value && (!last || t.date > last.from)).sort((a, b) => b.date.localeCompare(a.date))[0];
    const day = test?.date ?? (o.now.setOn && (!last || o.now.setOn > last.from) ? o.now.setOn : last ? (o.today > last.from ? o.today : dayAfter(last.from)) : o.now.setOn ?? o.today);
    h = withEntry(h, { from: day, value: o.now.value, source: test ? 'test' : last ? 'settings' : 'start', ...(test ? { note: test.name } : {}), at });
  }
  return h;
}

/** Earlier entries a fuller record of activities would add, in front of a history whose first entry was itself filled in from activities. */
export function earlierSeed(h: ThresholdHistory, seed: ThresholdHistory): ThresholdHistory {
  const first = firstEntry(h);
  if (!first || first.source !== 'activities') return h;
  let out = h;
  const add = sorted(seed).filter((e) => e.from < first.from && e.source === 'activities' && !h.removed?.[e.from]);
  for (const e of add) out = withEntry(out, e);
  // The old first entry only repeats the one now before it: it goes, so one figure is one entry.
  const s = sorted(out);
  const i = s.findIndex((e) => e.from === first.from);
  // Recorded as a removal, so a merge with another device's copy does not bring it back.
  if (add.length && i > 0 && s[i - 1].value === first.value) out = withoutEntry(out, first.from);
  return out;
}

/** A device's figure over a stretch, where it differs from the history's for some of that stretch (A5). */
export interface Suggestion extends Period { /** The history's figures over the stretch, in order, for saying what would change. */ antogo: number[] }

export function suggestions(h: ThresholdHistory | undefined | null, device: Period[], today: string): Suggestion[] {
  const out: Suggestion[] = [];
  const first = firstEntry(h);
  for (const p of device) {
    // A stretch wholly older than the history's first entry: those rides already use the figure in their own files.
    if (first && p.to && p.to < first.from) continue;
    const end = p.to ?? today;
    const inForce = [entryOn(h, p.from)?.value, ...sorted(h).filter((e) => e.from > p.from && e.from <= end).map((e) => e.value)];
    const values = inForce.filter((v, i) => i === 0 || v !== inForce[i - 1]);
    if (values.every((v) => v === p.value)) continue;
    out.push({ ...p, antogo: values.filter((v): v is number => v != null) });
  }
  return out;
}

/**
 * "Use the device's for this period": the stretch takes the device's figure, and the history carries on after it as it
 * was. Entries inside the stretch are replaced. For the stretch that still holds, everything from its first day on is.
 */
export function usePeriod(h: ThresholdHistory | undefined | null, p: Period, at = new Date().toISOString()): ThresholdHistory {
  const after = p.to ? dayAfter(p.to) : undefined;
  const resume = after ? entryOn(h, after) : undefined;
  let out: ThresholdHistory = h ?? EMPTY_HISTORY;
  for (const e of sorted(h)) if (e.from >= p.from && (!p.to || e.from <= p.to)) out = withoutEntry(out, e.from, at);
  out = withEntry(out, { from: p.from, value: p.value, source: 'device', at });
  // What was in force the day after carries on from that day (unless an entry already starts there).
  if (after && resume && !sorted(out).some((e) => e.from === after) && resume.value !== p.value) out = withEntry(out, { from: after, value: resume.value, source: resume.source, note: resume.note, at });
  if (after && !resume && !sorted(out).some((e) => e.from >= after)) { /* nothing was in force before or after: the device's figure simply carries on */ }
  return out;
}

/** Which figure scores rides: Antogo's history (the default), or the one the device had set that day. */
export type FtpScoring = 'antogo' | 'device';

/** Why a figure was used for an activity, for the line on its page. */
export type Why =
  | { kind: 'you' }                                   // set by the rider for this activity only
  | { kind: 'history'; entry: ThresholdEntry }        // the entry in force that day
  | { kind: 'device' }                                // the device's setting that day (the rider's choice)
  | { kind: 'device-before' }                         // the device's, because the activity is older than the history
  | { kind: 'first'; entry: ThresholdEntry }          // older than the history, and its file carried none
  | { kind: 'now' };                                  // no history yet: the figure in Settings

export interface Used { value: number; why: Why }

/**
 * The FTP an activity is scored with (Part B). `own` is the rider's correction for that activity alone; `device` the
 * FTP its own file carried; `now` the FTP in Settings, used only while there is no history at all.
 */
export function ftpFor(day: string, o: { history?: ThresholdHistory | null; scoring?: FtpScoring; device?: number; own?: number; now?: number }): Used | undefined {
  if (o.own) return { value: o.own, why: { kind: 'you' } };
  const inForce = entryOn(o.history, day), first = firstEntry(o.history);
  const fromHistory = (): Used | undefined => inForce ? { value: inForce.value, why: { kind: 'history', entry: inForce } } : undefined;
  if (o.scoring === 'device') {
    if (o.device) return { value: o.device, why: { kind: 'device' } };
    return fromHistory() ?? (first ? { value: first.value, why: { kind: 'first', entry: first } } : o.now ? { value: o.now, why: { kind: 'now' } } : undefined);
  }
  return fromHistory()
    ?? (o.device ? { value: o.device, why: { kind: 'device-before' } } : undefined)
    ?? (first ? { value: first.value, why: { kind: 'first', entry: first } } : o.now ? { value: o.now, why: { kind: 'now' } } : undefined);
}

/** The threshold heart rate an activity is scored with (Part D): Antogo's history only; before its first entry, the first. */
export function lthrFor(day: string, o: { history?: ThresholdHistory | null; own?: number; now?: number }): Used | undefined {
  if (o.own) return { value: o.own, why: { kind: 'you' } };
  const inForce = entryOn(o.history, day), first = firstEntry(o.history);
  if (inForce) return { value: inForce.value, why: { kind: 'history', entry: inForce } };
  if (first) return { value: first.value, why: { kind: 'first', entry: first } };
  return o.now ? { value: o.now, why: { kind: 'now' } } : undefined;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "7 Nov", with the year when it is not this one. */
export function dayWords(d: string, today?: string): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}${today && today.slice(0, 4) === String(y) ? '' : ` ${y}`}`;
}

/** How an entry got there, in the words the page uses (A4). */
export function sourceWords(e: Pick<ThresholdEntry, 'source' | 'note'>, app = 'Antogo'): string {
  switch (e.source) {
    case 'test': return `${e.note ?? 'A test'} in ${app}`;
    case 'settings': return 'set in Settings';
    case 'service': return 'from Intervals.icu';
    case 'activities': return 'filled in from your activities';
    case 'device': return 'from your device';
    case 'start': return 'your setting when this list began';
    default: return 'typed by you';
  }
}

/** The line under "FTP used for this ride" (B5), or the threshold heart-rate one: "251 W · Antogo's history (Ramp Test, 7 Nov)". */
export function usedWords(u: Used, unit: 'W' | 'bpm', today: string, app = 'Antogo'): string {
  const v = `${u.value} ${unit}`;
  const what = unit === 'W' ? 'ride' : 'activity';
  switch (u.why.kind) {
    case 'you': return `${v} · set by you for this ${what}`;
    case 'device': return `${v} · your device's setting that day`;
    case 'device-before': return `${v} · your device's setting that day (older than ${app}'s history)`;
    case 'history': { const e = u.why.entry; const how = e.source === 'test' ? (e.note ?? 'a test') : e.source === 'typed' ? 'typed by you' : sourceWords(e, app); return `${v} · ${app}'s history (${how}, ${dayWords(e.from, today)})`; }
    case 'first': return `${v} · ${app}'s history: its first entry (${dayWords(u.why.entry.from, today)}), as this ${what} is older`;
    default: return `${v} · your setting now`;
  }
}

/** A stretch in words: "from 3 June 2026 to 6 November 2026", or "since 7 November 2026". */
export function periodWords(p: Pick<Period, 'from' | 'to'>, fmt: (d: string) => string): string {
  return p.to ? (p.to === p.from ? `on ${fmt(p.from)}` : `from ${fmt(p.from)} to ${fmt(p.to)}`) : `since ${fmt(p.from)}`;
}

const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (d: string) => `${MONTH_FULL[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')}${xs.length > 2 ? ',' : ''} then ${xs[xs.length - 1]}` : xs[0] ?? '');
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/**
 * What the summary of files brought in says about the FTP settings they carry (Part E): what was found, in periods,
 * and plainly how they will be used under the rider's setting, before anything is scored.
 */
export function importFtpWords(found: { periods: Period[]; byDevice: number; byHistory: number; byFirst: number }, scoring: FtpScoring, history: ThresholdHistory | undefined | null, app = 'Antogo'): { found: string; used: string } {
  const said = `Your files say your FTP was ${list(found.periods.map((p) => `${p.value} W from ${monthYear(p.from)}`))}.`;
  const first = firstEntry(history);
  const rides = found.byDevice + found.byHistory + found.byFirst;
  if (!rides) return { found: said, used: 'None of the new activities is a ride, so nothing is scored with them.' };
  if (scoring === 'device') {
    const rest = found.byHistory + found.byFirst;
    return { found: said, used: `Your setting is to score rides with the FTP your device had set that day. ${n(found.byDevice, 'new ride carries', 'new rides carry')} one in ${found.byDevice === 1 ? 'its' : 'their'} file and will use it.${rest ? ` The other ${rest} will use ${app}'s FTP history.` : ''}` };
  }
  if (!first) return { found: said, used: `Your setting is to score rides with ${app}'s FTP history, which has no entries yet. ${n(found.byDevice, 'new ride', 'new rides')} will use the figure from ${found.byDevice === 1 ? 'its' : 'their'} own file${found.byHistory + found.byFirst ? `, and the other ${found.byHistory + found.byFirst} your FTP in Settings` : ''}.` };
  const parts = [
    found.byHistory ? `${n(found.byHistory, 'new ride is', 'new rides are')} from ${dayWords(first.from)} or later, where ${app}'s history begins, and will use the history` : '',
    found.byDevice ? `${n(found.byDevice, 'is', 'are')} older than that and will use the figure from ${found.byDevice === 1 ? 'its' : 'their'} own file` : '',
    found.byFirst ? `${n(found.byFirst, 'older one whose file carries none', 'older ones whose files carry none')} will use the history's first entry (${first.value} W)` : '',
  ].filter(Boolean);
  return { found: said, used: `Your setting is to score rides with ${app}'s FTP history. ${parts.join('; ')}.` };
}
