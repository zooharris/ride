import { describe, expect, it } from 'vitest';
import { GARMIN_BASE, resultsText, runGarminTest, TOKEN_PATH, unzipFirst } from './garminPersonal';
import { encodeFitActivity } from '../export/activityFiles';
import type { Ride } from '../engine/types';

/** A ZIP holding one file, stored without compression, as the test's stand-in for Garmin's download. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const n = new TextEncoder().encode(name);
  const local = new Uint8Array(30 + n.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 0, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, n.length, true);
  local.set(n, 30); local.set(data, 30 + n.length);
  const cd = new Uint8Array(46 + n.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, 0, true);
  cd.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, 1, true); ev.setUint32(12, cd.length, true); ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + cd.length + end.length);
  out.set(local, 0); out.set(cd, local.length); out.set(end, local.length + cd.length);
  return out;
}

const fit = (() => {
  const t = Array.from({ length: 600 }, (_, i) => i);
  return encodeFitActivity({ id: 'a', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'Test', type: 'Ride', sport: 'ride', seconds: 600 } as Ride, { time: t, watts: t.map(() => 200), heartrate: t.map(() => 140) });
})();
const KEY = 'secret-key-value-123456';
const exp = Math.floor(Date.now() / 1000) + 86400;
const jwt = `x.${btoa(JSON.stringify({ exp }))}.y`;

function garmin(over: Record<string, (init?: RequestInit) => Response> = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const path = url.replace(GARMIN_BASE, '');
    for (const [k, f] of Object.entries(over)) if (path.startsWith(k)) return f(init);
    if (path === TOKEN_PATH) return new Response(jwt, { status: 200 });
    if (path.startsWith('/userprofile-service')) return Response.json({ id: 1, measurementSystem: 'statute' });
    if (path.startsWith('/activitylist-service')) return path.includes('start=0') ? Response.json([{ activityId: 9, activityName: 'Long ride', startTimeLocal: '2026-11-21 08:00:00', activityType: { typeKey: 'cycling' } }, { activityId: 8, activityName: 'Walk', startTimeLocal: '2019-03-02 08:00:00' }]) : Response.json([]);
    if (path.startsWith('/download-service')) return new Response(storedZip('9_ACTIVITY.fit', fit) as unknown as BodyInit, { headers: { 'content-type': 'application/zip' } });
    if (path.startsWith('/hrv-service')) return Response.json({ hrvSummaries: [{ calendarDate: '2026-11-20' }] });
    return Response.json([]);
  }) as unknown as typeof fetch;
}

describe('the Garmin personal key test', () => {
  it('reports each step in plain words, with the oldest activity and the file read', async () => {
    const steps = await runGarminTest(KEY, () => {}, garmin());
    expect(steps.map((s) => s.name)).toEqual(['The key accepted', 'Your profile', 'Activities', 'An original file', 'Wellness, last week', 'How far back wellness goes']);
    expect(steps[0].ok).toBe(true);
    expect(steps[2].words).toContain('from 2019-03-02 to 2026-11-21');
    expect(steps[3].words).toMatch(/10 minutes, with power, heart rate/);
  });
  it('a web page Garmin will not answer is said plainly, and the test stops there', async () => {
    const steps = await runGarminTest(KEY, () => {}, (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect(steps).toHaveLength(1);
    expect(steps[0].words).toMatch(/does not allow its key to be used from a browser/);
  });
  it('the installed app, which Garmin does answer, never speaks of web pages; with no connection it says so', async () => {
    const ok = await runGarminTest(KEY, () => {}, garmin(), new Date(), 'app');
    expect(ok[0].ok).toBe(true);
    expect(ok.map((s) => s.words).join(' ')).not.toMatch(/web page|browser/);
    const off = await runGarminTest(KEY, () => {}, (async () => { throw new TypeError('net::ERR_INTERNET_DISCONNECTED'); }) as unknown as typeof fetch, new Date(), 'app');
    expect(off).toHaveLength(1);
    expect(off[0].words).toMatch(/could not be reached\. Check the internet connection on this computer/);
    expect(resultsText(ok, new Date(), 'from the Mac app')).toMatch(/^Garmin personal key test, from the Mac app,/);
  });
  it('a refused key is said plainly', async () => {
    const steps = await runGarminTest(KEY, () => {}, garmin({ [TOKEN_PATH]: () => new Response('bad key', { status: 401 }) }));
    expect(steps[0].words).toMatch(/refused the key \(401\)/);
  });
  it('sends the key only to Garmin, and never puts it in the results', async () => {
    const seen: string[] = [];
    const f = garmin();
    const steps = await runGarminTest(KEY, () => {}, (async (u: string, i?: RequestInit) => { seen.push(u); return f(u, i); }) as unknown as typeof fetch);
    expect(seen.every((u) => u.startsWith(GARMIN_BASE))).toBe(true);
    expect(resultsText(steps)).not.toContain(KEY);
    expect(resultsText(steps)).not.toContain(jwt);
  });
  it('opens the file inside Garmin\'s ZIP', async () => {
    expect((await unzipFirst(storedZip('a.fit', fit)))!.length).toBe(fit.length);
  });
});
