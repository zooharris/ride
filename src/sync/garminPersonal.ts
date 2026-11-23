import { readFitRecording } from '../player/fitRecording';
import { maybeGunzip } from '../player/fitRead';

/**
 * A test of Garmin's personal key (22 Nov 2026, Stage 0): what it reads, how far back, and whether a web page may use
 * it at all. Nothing is built on it: the rule is that nothing goes into the app on a service until we know what it
 * supports. The key goes only to Garmin. Garmin's published client (garmin/connect-personal-api-python) gives the
 * addresses: the key is exchanged for a token (sent as "ApiKey <key>"), and the token (as "Bearer <token>") reads.
 */

export const GARMIN_BASE = 'https://personal.connectapi.garmin.com';
export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** The key as the rider saved it on this device, to be shown and copied again later. */
export interface SavedGarminKey { key: string; savedAt: string; /** The expiry the rider chose when making it, if they noted it. */ expires?: string }
export const GARMIN_KEY_SETTING = 'garminPersonalKey';

export type StepResult = { name: string; ok: boolean; words: string; detail?: string };

type Fetch = typeof fetch;
/** Who is asking: a web page in a browser, or the installed app's own side. */
export type From = 'page' | 'app';

/** What a failed request means, in plain words. */
export function failure(e: unknown, status?: number, body?: string, from: From = 'page'): string {
  if (status == null) return from === 'app'
    ? `Garmin could not be reached. Check this computer's internet connection and try again.${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ''}`
    : 'Garmin did not answer a request from a web page. Garmin does not allow its key to be used from a browser (the browser blocks the answer), so it can be used only from the installed app.';
  if (status === 401) return `Garmin refused the key (401). Check that it was copied whole and has not expired or been deleted.${body ? ` Garmin said: ${body.slice(0, 200)}` : ''}`;
  if (status === 403) return `Garmin refused this request (403).${body ? ` Garmin said: ${body.slice(0, 200)}` : ''}`;
  if (status === 429) return 'Garmin asked to slow down (429). Try again later.';
  return `Garmin answered ${status}.${body ? ` It said: ${body.slice(0, 200)}` : ''}${e ? '' : ''}`;
}

/** The date a token stops working, from its own contents, when it says. */
export function tokenExpiry(token: string): string | undefined {
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? new Date(json.exp * 1000).toISOString() : undefined;
  } catch { return undefined; }
}

/** The one file inside a ZIP archive (what Garmin's download gives), opened. */
export async function unzipFirst(zip: Uint8Array): Promise<Uint8Array | undefined> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (zip.length < 22) return undefined;
  if (v.getUint32(0, true) !== 0x04034b50) return zip;   // not a ZIP: the file itself
  // The central directory gives the sizes even when the local header leaves them out.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return undefined;
  const cd = v.getUint32(eocd + 16, true);
  if (v.getUint32(cd, true) !== 0x02014b50) return undefined;
  const method = v.getUint16(cd + 10, true);
  const csize = v.getUint32(cd + 20, true);
  const local = v.getUint32(cd + 42, true);
  const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
  const data = zip.subarray(start, start + csize);
  if (method === 0) return data;
  if (method !== 8 || typeof DecompressionStream === 'undefined') return undefined;
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number, now: Date) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };
const count = (x: unknown): number => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.values(x as object).find(Array.isArray)?.length ?? (Object.keys(x as object).length ? 1 : 0) : 0);

/**
 * Run the test, step by step, reporting each as it finishes. Stops at the first step a web page cannot do, since the
 * rest would fail the same way. Never sends the key anywhere but Garmin; the token is kept only for this run.
 */
export async function runGarminTest(key: string, onStep: (s: StepResult) => void, f: Fetch = fetch, now = new Date(), from: From = 'page'): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const step = (s: StepResult) => { out.push(s); onStep(s); return s; };
  // 1. The key for a token.
  let token: string;
  try {
    const res = await f(GARMIN_BASE + TOKEN_PATH, { method: 'POST', headers: { Accept: '*/*', Authorization: `ApiKey ${key.trim()}` } });
    const body = await res.text();
    if (!res.ok) { step({ name: 'The key accepted', ok: false, words: failure(null, res.status, body, from) }); return out; }
    token = body.trim().replace(/^"|"$/g, '');
    const exp = tokenExpiry(token);
    step({ name: 'The key accepted', ok: true, words: `Garmin exchanged the key for a token${exp ? `, good until ${new Date(exp).toLocaleString()}` : ''}.${from === 'app' ? '' : ' A web page can reach Garmin with it.'}` });
  } catch (e) {
    step({ name: 'The key accepted', ok: false, words: failure(e, undefined, undefined, from) });
    return out;
  }
  const get = async (path: string): Promise<{ ok: true; json: unknown; bytes?: Uint8Array } | { ok: false; words: string }> => {
    try {
      const res = await f(GARMIN_BASE + path, { headers: { Accept: '*/*', Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, words: failure(null, res.status, await res.text().catch(() => ''), from) };
      const type = res.headers.get('content-type') ?? '';
      if (/json/.test(type)) return { ok: true, json: await res.json() };
      return { ok: true, json: null, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (e) { return { ok: false, words: failure(e, undefined, undefined, from) }; }
  };
  // 2. Who: the profile's settings.
  const prof = await get('/userprofile-service/userprofile/settings');
  step(prof.ok ? { name: 'Your profile', ok: true, words: 'Read your Garmin profile settings.', detail: Object.keys((prof.json ?? {}) as object).slice(0, 12).join(', ') } : { name: 'Your profile', ok: false, words: prof.words });
  // 3. Activities: the newest, then paged back to find the oldest.
  type Act = { activityId?: number; activityName?: string; startTimeLocal?: string; activityType?: { typeKey?: string } };
  const all: Act[] = [];
  let pages = 0, stoppedEarly = false;
  for (let start = 0; ; start += 100) {
    const r = await get(`/activitylist-service/activities/search/activities?start=${start}&limit=100`);
    if (!r.ok) { if (!all.length) { step({ name: 'Activities', ok: false, words: r.words }); } stoppedEarly = true; break; }
    const list = (Array.isArray(r.json) ? r.json : []) as Act[];
    all.push(...list);
    pages++;
    if (list.length < 100) break;
    if (pages >= 60) { stoppedEarly = true; break; }
  }
  if (all.length) {
    const dates = all.map((a) => a.startTimeLocal?.slice(0, 10)).filter((d): d is string => !!d).sort();
    step({ name: 'Activities', ok: true, words: `Listed ${all.length}${stoppedEarly ? '+' : ''} activities, from ${dates[0]} to ${dates[dates.length - 1]}${stoppedEarly ? ' (the test stopped counting there; there are more)' : ''}.`, detail: `Newest: ${all[0].activityName ?? 'unnamed'} (${all[0].activityType?.typeKey ?? 'kind not given'}, ${all[0].startTimeLocal ?? ''})` });
  }
  // 4. One original file: the newest activity's, opened and read.
  const newest = all.find((a) => a.activityId);
  if (newest) {
    const r = await get(`/download-service/files/activity/${newest.activityId}`);
    if (!r.ok) step({ name: 'An original file', ok: false, words: r.words });
    else {
      const raw = r.bytes ?? new Uint8Array();
      const fit = await unzipFirst(raw).then((x) => (x ? maybeGunzip(x) : undefined)).catch(() => undefined);
      const rec = fit ? readFitRecording(fit) : undefined;
      const has = rec ? (['watts', 'heartrate', 'cadence', 'distance', 'altitude', 'lat', 've'] as const).filter((k) => rec[k]?.some((x) => x != null && isFinite(x))) : [];
      const names: Record<string, string> = { watts: 'power', heartrate: 'heart rate', cadence: 'cadence', distance: 'distance', altitude: 'elevation', lat: 'route', ve: 'breathing' };
      step(rec ? { name: 'An original file', ok: true, words: `Downloaded ${newest.activityName ?? 'the newest activity'} (${Math.round(raw.length / 1024)} KB) and read it: ${Math.round(rec.time[rec.time.length - 1] / 60)} minutes, with ${has.map((k) => names[k]).join(', ') || 'no measures'}.` }
        : { name: 'An original file', ok: false, words: `Downloaded ${Math.round(raw.length / 1024)} KB, but it could not be opened as an activity file.` });
    }
  }
  // 5. Wellness: the last week, then the same week in earlier years, to see how far back it reaches.
  const week = (back: number) => [daysAgo(back + 6, now), daysAgo(back, now)] as const;
  const [a, b] = week(0);
  const hrv = await get(`/hrv-service/hrv/daily/${a}/${b}`);
  const sleep = await get(`/sleep-service/sleep/dailySleepSummariesByDate?startDate=${a}&endDate=${b}`);
  const daily = await get(`/usersummary-service/v2/dailysummaries?startDate=${a}&endDate=${b}`);
  const said = (r: typeof hrv, what: string) => (r.ok ? `${what}: ${count(r.json)} ${count(r.json) === 1 ? 'entry' : 'entries'}` : `${what}: ${r.words}`);
  step({ name: 'Wellness, last week', ok: hrv.ok || sleep.ok || daily.ok, words: [said(hrv, 'HRV'), said(sleep, 'Sleep'), said(daily, 'Daily summaries (resting heart rate, steps, Body Battery)')].join('. ') + '.' });
  const reach: string[] = [];
  for (const years of [1, 2, 3, 5]) {
    const [x, y] = week(years * 365);
    const r = await get(`/hrv-service/hrv/daily/${x}/${y}`);
    reach.push(`${years} year${years === 1 ? '' : 's'} ago: ${r.ok ? (count(r.json) ? 'yes' : 'none') : 'refused'}`);
  }
  step({ name: 'How far back wellness goes', ok: true, words: `HRV for the same week ${reach.join('; ')}. (None can mean you weren't wearing a watch that measured it then.)` });
  return out;
}

/** The results as plain text, to paste into a message. Never includes the key or the token. */
export function resultsText(steps: StepResult[], at = new Date(), where = ''): string {
  return [`Garmin personal key test${where ? `, ${where}` : ''}, ${at.toLocaleString()}`, ...steps.map((s) => `${s.ok ? 'OK' : 'NO'} · ${s.name}: ${s.words}${s.detail ? ` (${s.detail})` : ''}`)].join('\n');
}
