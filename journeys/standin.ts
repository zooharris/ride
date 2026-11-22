import { encodeFitActivity } from '../src/export/activityFiles';
import type { Page, Route } from '@playwright/test';

/**
 * A stand-in for Intervals.icu (13 Nov 2026), so journeys run with no real account and no network: every request to
 * intervals.icu is answered here from a made-up rider, and every other request off this machine is refused. Nothing
 * here is shaped on any real rider.
 */

export type RiderKind = 'new' | 'hr' | 'power';

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

/** A made-up history: `days` back, `perWeek` rides, power or not. */
function activities(days: number, withPower: boolean): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let n = 0;
  for (let i = days; i >= 1; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (![0, 2, 4, 6].includes(dow)) continue;
    n++;
    const long = dow === 0;
    const secs = long ? 2.5 * 3600 : dow === 4 ? 3600 : 5400;
    const hard = dow === 4;
    out.push({
      id: `i${1000 + n}`, start_date_local: `${d.toISOString().slice(0, 10)}T08:00:00`, name: long ? 'Long ride' : hard ? 'Intervals' : 'Endurance', type: 'Ride',
      moving_time: secs, elapsed_time: secs + 300, distance: secs * 8, total_elevation_gain: 400, icu_training_load: long ? 140 : hard ? 85 : 70,
      average_heartrate: hard ? 152 : 132, max_heartrate: hard ? 178 : 158, average_cadence: 88, average_speed: 8,
      ...(withPower ? { icu_average_watts: hard ? 215 : 165, icu_weighted_avg_watts: hard ? 238 : 172, icu_ftp: 255, icu_intensity: hard ? 93 : 67, icu_eftp: hard ? 250 + (n % 6) : undefined } : {}),
    });
  }
  // The last two weeks also have a walk and a strength session, so an activity of each kind is on record.
  for (const [back, type, name, secs] of [[3, 'Walk', 'Evening walk', 2700], [5, 'WeightTraining', 'Strength', 2400], [10, 'Walk', 'Lunch walk', 1800]] as const) {
    const d = new Date(); d.setDate(d.getDate() - back);
    out.push({ id: `i${9000 + back}`, start_date_local: `${d.toISOString().slice(0, 10)}T18:00:00`, name, type, moving_time: secs, elapsed_time: secs + 60, distance: type === 'Walk' ? secs * 1.4 : 0, total_elevation_gain: type === 'Walk' ? 30 : 0, icu_training_load: type === 'Walk' ? 15 : 25, average_heartrate: type === 'Walk' ? 98 : 112, max_heartrate: type === 'Walk' ? 112 : 141, calories: type === 'Walk' ? 210 : 260, average_speed: type === 'Walk' ? 1.4 : 0 });
  }
  return out;
}

function wellness(days: number): Array<Record<string, unknown>> {
  return Array.from({ length: days }, (_, i) => ({ id: day(-days + i + 1), hrv: 55 + ((i * 7) % 11), restingHR: 50 + (i % 4), sleepSecs: 7 * 3600 + (i % 5) * 600, weight: 74 }));
}

interface Rider { athlete: Record<string, unknown>; connections: Record<string, boolean>; activities: Array<Record<string, unknown>>; wellness: Array<Record<string, unknown>> }

export function rider(kind: Exclude<RiderKind, 'new'>): Rider {
  if (kind === 'hr') {
    return {
      athlete: { id: 'i900001', name: 'Hana Example', icu_weight: 68, icu_resting_hr: 52,
        sportSettings: [{ id: 1, types: ['Ride', 'VirtualRide'], lthr: 162, max_hr: 184 }, { id: 2, types: ['Run'], lthr: 168, max_hr: 184 }],
        icu_garmin_upload_workouts: false, wahoo_upload_workouts: true },
      connections: { wahoo_connected: true },
      activities: activities(90, false), wellness: wellness(90),
    };
  }
  return {
    athlete: { id: 'i900002', name: 'Pat Example', icu_weight: 81, icu_resting_hr: 48,
      sportSettings: [{ id: 1, types: ['Ride', 'VirtualRide'], ftp: 255, lthr: 166, max_hr: 186, power_zones: [55, 75, 90, 105, 120, 150, 999], hr_zones: [134, 149, 156, 166, 170, 175, 186] }],
      icu_garmin_upload_workouts: true, icu_garmin_last_upload: new Date(Date.now() - 3600_000).toISOString(), wahoo_upload_workouts: true, coros_upload_workouts: false },
    connections: { garmin_training_connected: true, garmin_health_connected: true, wahoo_connected: true, coros_connected: true },
    activities: activities(365, true), wellness: wellness(365),
  };
}

/** A made-up recording for an activity: power (when it has power), heart rate, cadence, distance and elevation. */
function streamsOf(a: Record<string, unknown>): Array<{ type: string; data: number[] }> {
  const secs = Math.max(60, Number(a.moving_time ?? 600));
  const t = Array.from({ length: secs }, (_, i) => i);
  const hard = a.name === 'Intervals';
  const base = Number(a.icu_average_watts ?? 0);
  const out: Array<{ type: string; data: number[] }> = [
    { type: 'time', data: t },
    { type: 'heartrate', data: t.map((i) => Math.round(118 + Math.min(30, i / 90) + (hard && Math.floor(i / 300) % 2 === 1 ? 18 : 0))) },
    { type: 'cadence', data: t.map((i) => 84 + (i % 7)) },
    { type: 'distance', data: t.map((i) => i * 8) },
    { type: 'altitude', data: t.map((i) => Math.round((100 + 25 * Math.sin(i / 400)) * 10) / 10) },
  ];
  if (base) out.push({ type: 'watts', data: t.map((i) => Math.round(base * (hard && Math.floor(i / 300) % 2 === 1 ? 1.4 : 0.9) + 15 * Math.sin(i / 17))) });
  return out;
}
function lapsOf(a: Record<string, unknown>): Array<Record<string, unknown>> {
  const secs = Math.max(60, Number(a.moving_time ?? 600));
  const out: Array<Record<string, unknown>> = [];
  for (let s = 0, n = 1; s < secs; s += 600, n++) out.push({ type: 'WORK', label: `Lap ${n}`, start_time: s, end_time: Math.min(secs, s + 600) });
  return out;
}

/** A FIT file for a walk, made by the app's own writer. */
function walkFile(a: Record<string, unknown>): Uint8Array {
  const secs = Number(a.moving_time ?? 600);
  const t = Array.from({ length: secs }, (_, i) => i);
  return encodeFitActivity({ id: String(a.id), date: String(a.start_date_local).slice(0, 10), startTime: String(a.start_date_local), name: String(a.name), type: 'Walk', sport: 'walk', seconds: secs } as never,
    { time: t, heartrate: t.map((i) => 95 + (i % 20)), distance: t.map((i) => i * 1.4), altitude: t.map((i) => 100 + (i % 50) / 5) });
}

/** What the stand-in has been sent, for checks. */
export interface Ledger { events: Array<Record<string, unknown>>; requests: string[] }

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answer Intervals.icu from the rider; refuse everything else that leaves this machine. */
export async function standIn(page: Page, kind: RiderKind): Promise<Ledger> {
  const ledger: Ledger = { events: [], requests: [] };
  const r = kind === 'new' ? undefined : rider(kind);
  let nextId = 5000;
  // Registered first, so matched last: anything not served locally and not Intervals.icu is refused.
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort('blockedbyclient'));
  await page.route('https://intervals.icu/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = req.method();
    ledger.requests.push(`${method} ${path}`);
    if (!r) return json(route, { error: 'Unauthorized' }, 401);
    if (/^\/athlete\/[^/]+$/.test(path)) return method === 'GET' ? json(route, r.athlete) : json(route, r.athlete);
    if (/\/connections$/.test(path)) return json(route, { id: r.athlete.id, ...r.connections });
    if (/\/activities$/.test(path) && method === 'POST') {
      // A ride file from the ride player: take it, and keep a summary so the next sync finds it.
      const id = `iUP${nextId++}`;
      const name = url.searchParams.get('name') ?? 'Ride';
      r.activities.push({ id, start_date_local: new Date().toISOString().slice(0, 19), name, type: 'VirtualRide', moving_time: 600, elapsed_time: 600, external_id: url.searchParams.get('external_id') });
      ledger.requests.push(`uploaded ${name}`);
      return json(route, { id, activities: [{ id }] });
    }
    if (/\/activities$/.test(path) && method === 'GET') {
      const oldest = url.searchParams.get('oldest') ?? '0000', newest = url.searchParams.get('newest') ?? '9999';
      return json(route, r.activities.filter((a) => { const d = String(a.start_date_local).slice(0, 10); return d >= oldest && d <= newest; }));
    }
    if (/\/wellness$/.test(path)) {
      const oldest = url.searchParams.get('oldest') ?? '0000', newest = url.searchParams.get('newest') ?? '9999';
      return json(route, r.wellness.filter((w) => String(w.id) >= oldest && String(w.id) <= newest));
    }
    if (/\/events\/bulk/.test(path)) return json(route, []);
    if (/\/events$/.test(path)) {
      if (method === 'POST') { const body = JSON.parse(req.postData() ?? '{}'); const e = { ...body, id: nextId++ }; ledger.events.push(e); return json(route, e); }
      return json(route, ledger.events.filter((e) => !String(e.name ?? '').startsWith('Antogo backup')));
    }
    const ev = path.match(/\/events\/(\d+)$/);
    if (ev) {
      const id = Number(ev[1]);
      if (method === 'DELETE') { ledger.events = ledger.events.filter((e) => e.id !== id); return json(route, {}); }
      if (method === 'PUT') { const body = JSON.parse(req.postData() ?? '{}'); const i = ledger.events.findIndex((e) => e.id === id); if (i >= 0) ledger.events[i] = { ...ledger.events[i], ...body }; return json(route, ledger.events[i] ?? {}); }
      return json(route, { ...(ledger.events.find((e) => e.id === id) ?? { id }), push_errors: null });
    }
    // An activity's recording (22 Nov 2026): second by second, made up from its summary, with laps every ten minutes.
    const act = (p: string) => r.activities.find((a) => p.includes(`/activity/${String(a.id)}/`));
    // A ride the player uploaded is read from its recording on this machine, as when Intervals.icu can't give its streams.
    if (/streams/.test(path)) {
      const a = act(path);
      if (a && String(a.id).startsWith('iUP')) return json(route, { error: 'not yet processed' }, 404);
      // Stage 0 (22 Nov 2026): two activities come back with no detail, as Garmin's are expected to.
      if (a && (a.name === 'Lunch walk' || a.name === 'Evening walk')) return json(route, []);
      return json(route, a ? streamsOf(a) : []);
    }
    if (/\/intervals$/.test(path)) { const a = act(path); return json(route, { icu_intervals: a ? lapsOf(a) : [] }); }
    if (/power-curves/.test(path)) return json(route, { list: [] });
    if (/\/activity\/[^/]+$/.test(path)) return json(route, r.activities.find((a) => path.endsWith(String(a.id))) ?? {});
    // The original file: one activity has one (the evening walk); the rest have none.
    if (/\/file$/.test(path)) {
      const a = act(path);
      if (a?.name === 'Evening walk') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(walkFile(a)) });
      return route.fulfill({ status: 404, body: '' });
    }
    if (method !== 'GET') return json(route, {});
    return json(route, []);
  });
  return ledger;
}

/** Problems a rider would see: errors on the page, and requests that tried to leave the machine. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`Page error: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_BLOCKED|blockedbyclient|ERR_FAILED/.test(m.text())) problems.push(`Console error: ${m.text()}`); });
  return problems;
}
