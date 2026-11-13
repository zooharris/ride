/**
 * Where a sent workout goes (13 Nov 2026, "sending to devices through Intervals.icu, said honestly").
 *
 * Send puts a planned workout on the rider's Intervals.icu calendar, nothing more. Intervals.icu then passes it to
 * each maker the rider has connected there with "Upload planned workouts" on. A planned workout has no field that
 * picks a destination, so the app never offers to send to one maker or one device. What it can do is read, before
 * sending, which makers will receive it, and after sending, any delivery error Intervals.icu recorded.
 *
 * Established on 13 Nov 2026 against Intervals.icu's published interface description and on a live account:
 *  - GET /athlete/{id}/connections answers a yes or no per service (garmin_training_connected, wahoo_connected, …);
 *  - the athlete record carries an upload switch per maker that can receive workouts (icu_garmin_upload_workouts,
 *    wahoo_upload_workouts, coros_…, suunto_…, zwift_…, huawei_…, zepp_…), the last upload time for Garmin, Coros and
 *    Suunto, and upload filters for Garmin and Suunto;
 *  - a switch can be on while the service is not connected, so a maker receives workouts only when both hold;
 *  - each planned workout carries push_errors: a list of { service, message, date }.
 * Not seen: a filter when set, or a real delivery error. Both are shown as given, never interpreted.
 */
import { call, type IntervalsCredentials } from './intervals';
import { addDays, today } from '../engine/load';

export type Maker = 'garmin' | 'wahoo' | 'coros' | 'suunto' | 'zwift' | 'huawei' | 'zepp';

interface MakerFields { name: string; connected: string; uploads: string; last?: string; filters?: string }

/** The makers Intervals.icu can upload planned workouts to, and the fields that say so. Polar and Hammerhead have no switch. */
export const MAKERS: Record<Maker, MakerFields> = {
  garmin: { name: 'Garmin', connected: 'garmin_training_connected', uploads: 'icu_garmin_upload_workouts', last: 'icu_garmin_last_upload', filters: 'icu_garmin_upload_filters' },
  wahoo: { name: 'Wahoo', connected: 'wahoo_connected', uploads: 'wahoo_upload_workouts' },
  coros: { name: 'Coros', connected: 'coros_connected', uploads: 'coros_upload_workouts', last: 'coros_last_upload' },
  suunto: { name: 'Suunto', connected: 'suunto_connected', uploads: 'suunto_upload_workouts', last: 'suunto_last_upload', filters: 'suunto_upload_filters' },
  zwift: { name: 'Zwift', connected: 'zwift_connected', uploads: 'zwift_upload_workouts' },
  huawei: { name: 'Huawei', connected: 'huawei_connected', uploads: 'huawei_upload_workouts' },
  zepp: { name: 'Zepp', connected: 'zepp_connected', uploads: 'zepp_upload_workouts' },
};
export const MAKER_ORDER: Maker[] = ['garmin', 'wahoo', 'coros', 'suunto', 'zwift', 'huawei', 'zepp'];

export interface MakerState { maker: Maker; name: string; connected: boolean; uploads: boolean; lastUpload?: string; filtered: boolean }
export interface Destinations {
  /** Every maker with anything to say: connected, or switched on. */
  makers: MakerState[];
  /** Connected and switched on: these receive a sent workout. */
  receiving: MakerState[];
  /** Connected, switch off. */
  off: MakerState[];
  /** Receiving, with an upload filter set (not interpreted). */
  filtered: MakerState[];
  readAt: string;
}

/** Pure: the two answers from Intervals.icu read into who receives a workout. */
export function readDestinations(connections: Record<string, unknown>, athlete: Record<string, unknown>, now = new Date().toISOString()): Destinations {
  const makers: MakerState[] = [];
  for (const m of MAKER_ORDER) {
    const f = MAKERS[m];
    const connected = connections[f.connected] === true;
    const uploads = athlete[f.uploads] === true;
    if (!connected && !uploads) continue;
    const last = f.last ? athlete[f.last] : undefined;
    const filters = f.filters ? athlete[f.filters] : undefined;
    makers.push({ maker: m, name: f.name, connected, uploads, lastUpload: typeof last === 'string' && last ? last : undefined, filtered: Array.isArray(filters) && filters.length > 0 });
  }
  const receiving = makers.filter((x) => x.connected && x.uploads);
  return { makers, receiving, off: makers.filter((x) => x.connected && !x.uploads), filtered: receiving.filter((x) => x.filtered), readAt: now };
}

/** "Garmin", "Garmin and Wahoo", "Garmin, Wahoo and Coros". */
export const nameList = (xs: Array<{ name: string }>): string => (xs.length <= 1 ? xs.map((x) => x.name).join('') : `${xs.slice(0, -1).map((x) => x.name).join(', ')} and ${xs[xs.length - 1].name}`);

/** How far ahead Intervals.icu uploads: "about a week", in its developer's words. Not an exact number of days. */
export const UPLOAD_AHEAD_DAYS = 7;

/** The words around Send for a workout on this date, from what was read. All plain lines; nothing interpreted. */
export function destinationWords(d: Destinations, date?: string, todayIso = today()): { line: string; none: boolean; extra: string[] } {
  const extra: string[] = [];
  if (!d.receiving.length) {
    return { none: true, line: 'Intervals.icu isn\'t set to upload workouts to any device.', extra: d.off.length ? [`${uploadsOffWords(d.off)}`] : [] };
  }
  if (d.off.length) extra.push(uploadsOffWords(d.off));
  for (const f of d.filtered) extra.push(`Intervals.icu has an upload filter for your ${f.name}, so it may skip this workout. Check it in Intervals.icu settings.`);
  if (date && date > addDays(todayIso, UPLOAD_AHEAD_DAYS)) extra.push('Intervals.icu uploads about a week ahead, so this reaches your devices nearer the day.');
  return { none: false, line: `Intervals.icu will pass this to your ${nameList(d.receiving)}.`, extra };
}

function uploadsOffWords(off: MakerState[]): string {
  return off.length === 1
    ? `Your ${off[0].name} is connected in Intervals.icu, but uploading planned workouts to it is off.`
    : `Your ${nameList(off)} are connected in Intervals.icu, but uploading planned workouts to them is off.`;
}

/** "Intervals.icu last uploaded to Garmin today at 10:00." for each maker that has a time. */
export function lastUploadWords(d: Destinations, todayIso = today()): string[] {
  return d.receiving.filter((x) => x.lastUpload).map((x) => {
    const t = new Date(x.lastUpload!);
    if (isNaN(t.getTime())) return '';
    const day = t.toLocaleDateString('en-CA');
    const clock = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const when = day === todayIso ? `today at ${clock}` : day === addDays(todayIso, -1) ? `yesterday at ${clock}` : `${t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${clock}`;
    return `Intervals.icu last uploaded to ${x.name} ${when}.`;
  }).filter(Boolean);
}

// ── Reading, at most once every few minutes ─────────────────────────────────

const FRESH_MS = 5 * 60_000;
let cached: { key: string; at: number; value: Promise<Destinations> } | undefined;

/** Read who receives sent workouts. Two requests, kept for five minutes; `again` reads afresh (Settings' Check again). */
export function fetchDestinations(c: IntervalsCredentials, again = false): Promise<Destinations> {
  const key = `${c.athleteId}`;
  if (!again && cached && cached.key === key && Date.now() - cached.at < FRESH_MS) return cached.value;
  const value = Promise.all([
    call<Record<string, unknown>>(c, `/athlete/${c.athleteId}/connections`),
    call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`),
  ]).then(([conn, ath]) => readDestinations(conn ?? {}, ath ?? {}));
  cached = { key, at: Date.now(), value };
  value.catch(() => { if (cached?.value === value) cached = undefined; });
  return value;
}

/** For tests: forget what was read. */
export function forgetDestinations(): void { cached = undefined; }

export interface PushError { service?: string; message?: string; date?: string }

/** A sent workout's delivery errors, as Intervals.icu recorded them; none when it has none or can't be read. */
export async function fetchPushErrors(c: IntervalsCredentials, eventId: number): Promise<PushError[]> {
  const e = await call<{ push_errors?: PushError[] | null }>(c, `/athlete/${c.athleteId}/events/${eventId}`);
  return readPushErrors(e);
}

/** Pure: the errors on an event, each with a message. */
export function readPushErrors(e: { push_errors?: unknown } | null | undefined): PushError[] {
  const list = Array.isArray(e?.push_errors) ? (e!.push_errors as PushError[]) : [];
  return list.filter((x) => x && typeof x === 'object' && (x.message || x.service));
}

/** "Intervals.icu couldn't deliver this to Garmin (Fri, Nov 13): " followed by its own message, unchanged. */
export function pushErrorWords(x: PushError): { head: string; message: string } {
  const service = x.service ? (MAKERS[x.service.toLowerCase() as Maker]?.name ?? x.service) : 'a device';
  const d = x.date ? new Date(x.date) : undefined;
  const when = d && !isNaN(d.getTime()) ? ` (${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })})` : '';
  return { head: `Intervals.icu couldn't deliver this to ${service}${when}:`, message: x.message ?? '' };
}
