import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, setSetting } from '../data/db';
import { setThresholdCtx } from '../engine/thresholdCtx';
import { encodeFitActivity } from '../export/activityFiles';
import type { Profile, Ride, Wellness } from '../engine/types';
import { GARMIN_BASE, TOKEN_PATH } from './garminPersonal';
import { forgetGarminPass, GARMIN_ON, gmtMoment, layWellness, readProgress, runGarmin, setGarminOn, type GarminDeps, type Listed } from './garminSource';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const profile: Profile = { name: 'Sam Example', ftp: 250, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };
const KEY = 'secret-key-value-123456';
const NOW = new Date('2026-11-23T15:00:00Z');
const jwt = `x.${btoa(JSON.stringify({ exp: Math.floor(NOW.getTime() / 1000) + 86400 }))}.y`;

/** A made-up ride's file, starting at a moment in time. */
function fit(startUtc: string, seconds = 1200): Uint8Array {
  const t = Array.from({ length: seconds }, (_, i) => i);
  const local = startUtc.slice(0, 19);
  return encodeFitActivity({ id: 'a', date: local.slice(0, 10), startTime: local, name: 'x', type: 'Ride', sport: 'ride', seconds } as Ride, { time: t, watts: t.map(() => 200), heartrate: t.map(() => 140) });
}
/** As Garmin lists it: the start in the rider's own time, and as a moment (GMT). `startUtc` here is the rider's clock time, as the made-up file has it. */
const listed = (id: number, startUtc: string, name: string, seconds = 1200): Listed => ({ activityId: id, activityName: name, startTimeLocal: startUtc.slice(0, 19).replace('T', ' '), startTimeGMT: new Date(startUtc).toISOString().slice(0, 19).replace('T', ' '), duration: seconds, elapsedDuration: seconds, movingDuration: seconds, activityType: { typeKey: 'road_biking' } });

interface Standin { list: Listed[]; files: Record<string, Uint8Array | number>; days: Record<string, { hrv?: number; sleep?: number; steps?: number; rhr?: number }>; asked: string[]; refuse?: boolean; slowAfter?: number }
function garmin(s: Standin): typeof fetch {
  let downloads = 0;
  return (async (url: string, init?: RequestInit) => {
    const path = String(url).replace(GARMIN_BASE, '');
    s.asked.push(path.split('?')[0]);
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    if (path === TOKEN_PATH) return s.refuse || auth !== `ApiKey ${KEY}` ? new Response('bad key', { status: 401 }) : new Response(jwt);
    if (auth !== `Bearer ${jwt}`) return new Response('no', { status: 401 });
    if (path.startsWith('/activitylist-service')) { const start = Number(new URL(GARMIN_BASE + path).searchParams.get('start')); return Response.json(s.list.slice(start, start + 100)); }
    if (path.startsWith('/download-service')) {
      if (s.slowAfter != null && downloads++ >= s.slowAfter) return new Response('', { status: 429 });
      const f = s.files[path.split('/').pop()!];
      return typeof f === 'number' || !f ? new Response('', { status: typeof f === 'number' ? f : 404 }) : new Response(f as unknown as BodyInit, { headers: { 'content-type': 'application/octet-stream' } });
    }
    const span = (a: string, b: string) => Object.entries(s.days).filter(([d]) => d >= a && d <= b);
    if (path.startsWith('/hrv-service')) { const [a, b] = path.split('/').slice(-2); return Response.json({ hrvSummaries: span(a, b).filter(([, v]) => v.hrv).map(([d, v]) => ({ calendarDate: d, lastNightAvg: v.hrv })) }); }
    const q = new URL(GARMIN_BASE + path).searchParams, a = q.get('startDate')!, b = q.get('endDate')!;
    if (path.startsWith('/sleep-service')) return Response.json(span(a, b).filter(([, v]) => v.sleep).map(([d, v]) => ({ calendarDate: d, sleepTimeSeconds: v.sleep })));
    if (path.startsWith('/usersummary-service')) return Response.json(span(a, b).filter(([, v]) => v.steps || v.rhr).map(([d, v]) => ({ calendarDate: d, totalSteps: v.steps, restingHeartRate: v.rhr })));
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}
const deps = (s: Standin, over: Partial<GarminDeps> = {}): GarminDeps => ({ fetch: garmin(s), key: async () => KEY, changed: () => {}, settle: async () => {}, gapMs: 0, wellnessGapMs: 0, now: () => NOW, ...over });
const standin = (over: Partial<Standin> = {}): Standin => ({ list: [], files: {}, days: {}, asked: [], ...over });

beforeEach(async () => {
  setThresholdCtx(undefined);
  forgetGarminPass();
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.profile.put({ ...profile, id: 'me' });
});

describe('Garmin as a source', () => {
  it('fetches nothing until the rider says so', async () => {
    const s = standin({ list: [listed(1, '2026-11-20T08:00:00', 'Morning loop')], files: { 1: fit('2026-11-20T08:00:00') } });
    await runGarmin(deps(s));
    expect(s.asked).toEqual([]);
    expect(await db.rides.count()).toBe(0);
  });

  it('adds what is new with Garmin\'s name, worked out from its file, and never twice', async () => {
    const s = standin({ list: [listed(2, '2026-11-21T09:00:00', 'Hill repeats'), listed(1, '2026-11-20T08:00:00', 'Morning loop')], files: { 1: fit('2026-11-20T08:00:00'), 2: fit('2026-11-21T09:00:00') } });
    await setGarminOn(true);
    const st = await runGarmin(deps(s));
    expect(st.phase).toBe('idle');
    expect(st.added).toBe(2);
    const rides = (await db.rides.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(rides.map((r) => r.name)).toEqual(['Morning loop', 'Hill repeats']);
    expect(rides.every((r) => r.via === 'garmin' && r.source === 'file' && r.ownNumbers && r.tss! > 0)).toBe(true);
    expect((await db.files.toArray()).filter((f) => f.status === 'kept')).toHaveLength(2);
    // A second run asks for the list and wellness only: no file again, nothing added.
    s.asked.length = 0;
    const again = await runGarmin(deps(s));
    expect(s.asked.filter((p) => p.startsWith('/download-service'))).toEqual([]);
    expect(again.added).toBe(2);
    expect(await db.rides.count()).toBe(2);
  });

  it('an activity already here with its file is recognised without a download; one without its file gains it', async () => {
    // Here from a file already.
    const s = standin({ list: [listed(2, '2026-11-21T09:00:00', 'Hill repeats'), listed(1, '2026-11-20T08:00:00', 'Morning loop')], files: { 1: fit('2026-11-20T08:00:00'), 2: fit('2026-11-21T09:00:00') } });
    await setGarminOn(true);
    await runGarmin(deps(s));
    await setSetting('garminProgress', { seen: {} });   // as on a device that never asked Garmin
    s.asked.length = 0;
    const st = await runGarmin(deps(s));
    expect(s.asked.filter((p) => p.startsWith('/download-service'))).toEqual([]);
    expect(st.already).toBe(2);
    expect(await db.rides.count()).toBe(2);
    // Here from the data service, with no file kept: the file is fetched and kept with it, and it stays one activity.
    await db.rides.clear(); await db.files.clear(); await db.own.clear();
    await setSetting('garminProgress', { seen: {} });
    await db.rides.put({ id: 'i77', date: '2026-11-20', startTime: '2026-11-20T08:00:00', name: 'From the service', type: 'Ride', sport: 'ride', seconds: 1200, movingSeconds: 1200, elapsedSeconds: 1200 } as Ride);
    s.list = [listed(1, '2026-11-20T08:00:00', 'Morning loop')];
    const st2 = await runGarmin(deps(s));
    expect(await db.rides.count()).toBe(1);
    expect((await db.rides.get('i77'))!.name).toBe('From the service');
    expect((await db.files.get('i77'))?.status).toBe('kept');
    expect(st2.already).toBe(1);
  });

  it('an activity with no file at Garmin, and a file that is no activity, are counted and not asked for again', async () => {
    const s = standin({ list: [listed(3, '2026-11-22T09:00:00', 'By hand'), listed(4, '2026-11-22T12:00:00', 'Odd')], files: { 4: new Uint8Array([1, 2, 3, 4, 5]) } });
    await setGarminOn(true);
    const st = await runGarmin(deps(s));
    expect([st.noFile, st.unread, st.added]).toEqual([1, 1, 0]);
    s.asked.length = 0;
    await runGarmin(deps(s));
    expect(s.asked.filter((p) => p.startsWith('/download-service'))).toEqual([]);
  });

  it('a run cut short carries on where it stopped, through the whole list', async () => {
    const list = Array.from({ length: 5 }, (_, i) => listed(10 + i, `2026-11-1${i}T08:00:00`, `Ride ${i}`)).reverse();
    const files = Object.fromEntries(list.map((a) => [String(a.activityId), fit(`${a.startTimeLocal!.replace(' ', 'T')}`)]));
    const s = standin({ list, files, slowAfter: 2 });
    await setGarminOn(true);
    const st = await runGarmin(deps(s));
    expect(st.phase).toBe('waiting');
    expect(st.error).toMatch(/slow down/);
    expect(await db.rides.count()).toBe(2);
    s.slowAfter = undefined;
    const st2 = await runGarmin(deps(s));
    expect(st2.phase).toBe('idle');
    expect(await db.rides.count()).toBe(5);
    expect((await readProgress()).whole).toBe(true);
  });

  it('a refused key is said plainly, and nothing more is asked until the key changes', async () => {
    const s = standin({ refuse: true, list: [listed(1, '2026-11-20T08:00:00', 'Morning loop')] });
    await setGarminOn(true);
    const st = await runGarmin(deps(s));
    expect(st.phase).toBe('refused');
    expect(st.error).toMatch(/Garmin refused the key/);
    expect((await readProgress()).refused).toBeTruthy();
    expect(s.asked).toEqual([TOKEN_PATH]);
  });

  it('wellness fills in what is missing, back until Garmin has no more, and never replaces what is here', async () => {
    const days: Standin['days'] = {};
    for (let i = 0; i < 60; i++) { const d = new Date(NOW.getTime() - i * 864e5).toISOString().slice(0, 10); days[d] = { hrv: 50 + (i % 5), sleep: 25000 + i, steps: 5000 + i, rhr: 50 }; }
    await db.wellness.put({ date: '2026-11-10', hrv: 99, restingHr: 47 } as Wellness);
    const s = standin({ days });
    await setGarminOn(true);
    const st = await runGarmin(deps(s));
    expect(st.phase).toBe('idle');
    expect(await db.wellness.count()).toBe(60);
    const kept = (await db.wellness.get('2026-11-10'))!;
    expect([kept.hrv, kept.restingHr]).toEqual([99, 47]);      // what was here stays
    expect(kept.sleepSeconds).toBeGreaterThan(0);               // what was missing is filled in
    expect((await readProgress()).wellnessWhole).toBe(true);
    expect(st.days).toBe(60);
    // The next run asks only for the last week.
    s.asked.length = 0;
    await runGarmin(deps(s));
    expect(s.asked.filter((p) => p.startsWith('/hrv-service'))).toHaveLength(1);
  });

  it('a number Garmin supplied within the last week is refreshed by Garmin; anyone else\'s, and older ones, are not', () => {
    const have = new Map<string, Wellness>([
      ['2026-11-23', { date: '2026-11-23', steps: 3000, hrv: 61 }],
      ['2026-11-10', { date: '2026-11-10', steps: 4000 }],
    ]);
    const found = new Map<string, Partial<Wellness>>([
      ['2026-11-23', { steps: 9000, hrv: 40, sleepSeconds: 26000 }],
      ['2026-11-10', { steps: 12000 }],
    ]);
    const laid = layWellness(have, found, { '2026-11-23': ['steps'], '2026-11-10': ['steps'] }, '2026-11-23');
    const today = laid.put.find((w) => w.date === '2026-11-23')!;
    expect(today.steps).toBe(9000);          // Garmin's own, refreshed
    expect(today.hrv).toBe(61);              // from elsewhere: kept
    expect(today.sleepSeconds).toBe(26000);  // missing: filled in
    expect(laid.put.find((w) => w.date === '2026-11-10')).toBeUndefined();   // older than a week: left alone
    expect(laid.supplied['2026-11-23'].sort()).toEqual(['sleepSeconds', 'steps']);
  });

  it('turning it off stops asking; Garmin\'s times are read as moments', async () => {
    const s = standin({ list: [listed(1, '2026-11-20T08:00:00', 'Morning loop')], files: { 1: fit('2026-11-20T08:00:00') } });
    await setGarminOn(true);
    await setGarminOn(false);
    await runGarmin(deps(s));
    expect(s.asked).toEqual([]);
    expect(await db.settings.get(GARMIN_ON)).toMatchObject({ value: false });
    expect(gmtMoment('2026-11-21 18:02:20')).toBe(Date.parse('2026-11-21T18:02:20Z'));
    expect(gmtMoment(undefined)).toBeUndefined();
  });
});
