import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile, Ride } from '../engine/types';

// The data service, stood in for: what each activity's original file and record are, and how often it is asked.
const calls: string[] = [];
let originals: Record<string, Uint8Array | number> = {};
let records: Record<string, unknown> = {};
let flaky: Record<string, number> = {};
vi.mock('../sync/intervals', async (orig) => {
  const real = await orig<typeof import('../sync/intervals')>();
  return {
    ...real,
    fetchActivityFile: vi.fn(async (_c: unknown, id: string) => {
      calls.push(`file ${id}`);
      if (flaky[id]) { flaky[id]--; throw new real.IntervalsError('Intervals.icu answered 503.', 503); }
      const o = originals[id];
      if (typeof o === 'number') throw new real.IntervalsError(`Intervals.icu answered ${o}.`, o);
      return o;
    }),
    fetchStreams: vi.fn(async (_c: unknown, id: string) => {
      calls.push(`streams ${id}`);
      const r = records[id];
      if (!r) throw new real.IntervalsError('Intervals.icu answered 404.', 404);
      return r;
    }),
  };
});

const { activityFile, patiently } = await import('./activity');
const { runBulk } = await import('./bulk');
const { encodeFitActivity } = await import('./activityFiles');
const { unzip } = await import('./zip');
const { IntervalsError } = await import('../sync/intervals');

const profile: Profile = { name: '', ftp: 250, lthr: 165, maxHr: 182, restingHr: 52, weightKg: 70, basis: 'power', masters: true, units: 'metric', rideDays: [1], hoursPerWeek: 6 };
const cred = { athleteId: 'i1', apiKey: 'k' };
const ride = (id: string, extra: Partial<Ride> = {}): Ride => ({ id, date: '2026-11-08', startTime: '2026-11-08T09:00:00', name: 'Ride', type: 'Ride', sport: 'ride', seconds: 120, distanceM: 1000, ...extra });
const stream = (n: number) => ({ time: Array.from({ length: n }, (_, i) => i), watts: Array.from({ length: n }, () => 200), heartrate: Array.from({ length: n }, () => 140), intervals: [] });

beforeEach(() => { calls.length = 0; originals = {}; records = {}; flaky = {}; });

describe('one activity', () => {
  it('an original FIT goes out byte for byte', async () => {
    const orig = encodeFitActivity(ride('a'), stream(30));
    originals.a = orig;
    const got = await activityFile(cred, ride('a'), 'fit', { antogo: false, source: 'Garmin' });
    expect(got.how).toBe('original');
    expect(Array.from(got.file.data as Uint8Array)).toEqual(Array.from(orig));
  });
  it('a gzipped original is opened first', async () => {
    const orig = encodeFitActivity(ride('g'), stream(10));
    const gz = new Uint8Array(await new Response(new Blob([orig.slice().buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    originals.g = gz;
    const got = await activityFile(cred, ride('g'), 'fit', { antogo: false, source: 'Garmin' });
    expect(got.how).toBe('original');
    expect(Array.from(got.file.data as Uint8Array)).toEqual(Array.from(orig));
  });
  it('asked for TCX, it is written from the record', async () => {
    originals.b = encodeFitActivity(ride('b'), stream(30));
    records.b = stream(30);
    const got = await activityFile(cred, ride('b'), 'tcx', { antogo: false, source: 'Garmin' });
    expect(got.how).toBe('record');
    expect(got.file.name.endsWith('.tcx')).toBe(true);
  });
  it('no original, but a record: written from the record', async () => {
    originals.c = 404;
    records.c = stream(30);
    expect((await activityFile(cred, ride('c'), 'fit', { antogo: false, source: 'x' })).how).toBe('record');
  });
  it('only a summary: a summary, never a pretend recording', async () => {
    originals.d = 404;
    const got = await activityFile(cred, ride('d'), 'fit', { antogo: false, source: 'x' });
    expect(got.how).toBe('summary');
    expect(got.file.name.endsWith('.txt')).toBe(true);
    expect(String(got.file.data)).toMatch(/Only a summary/);
  });
  it('.gpx without a route is unavailable, with the reason', async () => {
    originals.e = 404;
    records.e = stream(30);
    const got = await activityFile(cred, ride('e'), 'gpx', { antogo: false, source: 'x' });
    expect(got.unavailable).toMatch(/no route/);
  });
  it('a busy answer is tried again; "not found" is not', async () => {
    let n = 0;
    await expect(patiently(async () => { n++; throw new IntervalsError('no', 404); })).rejects.toThrow();
    expect(n).toBe(1);
  }, 20000);
});

describe('many activities', () => {
  it('leaves out nothing unless asked; an item that keeps failing is listed and the rest carry on', async () => {
    originals.ok1 = encodeFitActivity(ride('ok1'), stream(20));
    originals.ok2 = encodeFitActivity(ride('ok2'), stream(20));
    originals.bad = 500;
    const items = ['ok1', 'bad', 'ok2'].map((id) => ({ kind: 'activity' as const, ride: ride(id, { name: `Ride ${id}` }), origin: { antogo: false, source: 'Garmin' } }));
    const res = await runBulk({ items, actFormat: 'fit', wkFormat: 'fit', unfit: 'fallback', profile, table: {}, credentials: cred, gapMs: 0 });
    expect(res.done).toBe(2);
    expect(res.failed.map((f) => f.name)).toEqual(['Ride bad']);
    expect(calls.filter((c) => c === 'file bad')).toHaveLength(3);
    const files = unzip(res.parts[0].data as Uint8Array).map((f) => f.name);
    expect(files.filter((n) => n.endsWith('.fit'))).toHaveLength(2);
    const note = new TextDecoder().decode(unzip(res.parts[0].data as Uint8Array).find((f) => f.name.endsWith('Read me first.txt'))!.data);
    expect(note).toMatch(/COULD NOT BE EXPORTED/);
    expect(note).toMatch(/2 from Garmin/);
  }, 60000);
  it('a slow service answers on the second try', async () => {
    originals.f = encodeFitActivity(ride('f'), stream(20));
    flaky.f = 1;
    const res = await runBulk({ items: [{ kind: 'activity', ride: ride('f'), origin: { antogo: false, source: 'Garmin' } }], actFormat: 'fit', wkFormat: 'fit', unfit: 'fallback', profile, table: {}, credentials: cred, gapMs: 0 });
    expect(res.done).toBe(1);
    expect(res.how.original).toBe(1);
  }, 20000);
});
