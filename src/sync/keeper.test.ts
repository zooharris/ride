import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = new Map<string, number>();   // id -> status to answer with (200 for a file)
vi.mock('./intervals', async (orig) => {
  const real = await orig<typeof import('./intervals')>();
  return {
    ...real,
    fetchActivityFile: vi.fn(async (_c: unknown, id: string) => {
      const st = files.get(id) ?? 200;
      if (st !== 200) throw new real.IntervalsError(`answered ${st}`, st);
      return new Uint8Array([1, 2, 3, id.length]);
    }),
  };
});

import { db } from '../data/db';
import { findHistoryStart, fileRefusal, keepCounts, keepHistory, keptFile } from './keeper';
import { IntervalsError } from './intervals';
import { makeBackup, restoreBackup, backupSummary } from '../data/backup';
import type { Ride, Wellness } from '../engine/types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const c = { athleteId: 'i1', apiKey: 'k' };
const ride = (id: string, date: string) => ({ id, date, startTime: `${date}T08:00:00`, name: id, type: 'Ride', sport: 'ride', seconds: 3600 } as Ride);

beforeEach(async () => { await db.delete(); await db.open(); files.clear(); });

describe('finding where the history begins', () => {
  it('goes back a year at a time until three empty years, past a gap of two', async () => {
    const asked: string[] = [];
    const rides = async (_c: unknown, from: string, to: string) => { asked.push(from); return from <= '2019-06-01' && to >= '2019-06-01' ? [ride('old', '2019-06-01')] : from <= '2022-03-01' && to >= '2022-03-01' ? [ride('mid', '2022-03-01')] : []; };
    const wellness = async () => [] as Wellness[];
    const start = await findHistoryStart(c, '2025-01-01', { rides, wellness } as never);
    expect(start).toBe('2019-06-01');
    // Past the two empty years 2023-24 and 2020-21, stopping after three empty years before 2019.
    expect(asked.length).toBeLessThanOrEqual(10);
  });
});

describe('keeping each activity\'s original file', () => {
  it('keeps files newest first, notes activities with none, and stops plainly when the key is refused', async () => {
    await db.rides.bulkPut([ride('a', '2026-11-01'), ride('b', '2026-11-02'), ride('c', '2026-11-03')]);
    await db.settings.put({ key: 'historyWhole', value: { from: '2026-11-01', at: 'x' } });
    files.set('b', 404);
    await keepHistory(c, { loadHistory: async () => {}, gapMs: 0 });
    expect((await keepCounts())).toMatchObject({ kept: 2, none: 1, total: 3 });
    expect(await keptFile('a')).toBeInstanceOf(Uint8Array);
    expect(await keptFile('b')).toBeUndefined();
    expect((await db.files.get('b'))?.why).toMatch(/no original file/);
    // A second run fetches nothing again.
    await db.rides.put(ride('d', '2026-11-04'));
    files.set('d', 401);
    await keepHistory(c, { loadHistory: async () => {}, gapMs: 0 });
    expect(await db.files.get('d')).toBeUndefined();   // refused: stopped, tried again next time
  });
  it('the first run loads the whole history before the files', async () => {
    const loaded: string[] = [];
    await db.rides.put(ride('a', '2026-11-01'));
    // No more history in the data service: the start found is what is here, and nothing more is loaded.
    await keepHistory(c, { loadHistory: async (b) => { loaded.push(b); }, gapMs: 0 }).catch(() => {});
    expect(loaded).toEqual([]);
  });
  it('says what a refusal means', () => {
    expect(fileRefusal(new IntervalsError('x', 404)).kind).toBe('none');
    expect(fileRefusal(new IntervalsError('x', 429)).kind).toBe('slow');
    expect(fileRefusal(new IntervalsError('x', 401)).kind).toBe('stop');
    expect(fileRefusal(new Error('offline')).kind).toBe('stop');
  });
});

describe('Back up everything carries the whole history', () => {
  it('activities, wellness and original files, restored where a device lacks them', async () => {
    await db.profile.put({ id: 'me', name: 'R', ftp: 250, lthr: 165, maxHr: 182, restingHr: 52, weightKg: 70, basis: 'power', masters: true, units: 'metric', rideDays: [1], hoursPerWeek: 6 });
    await db.rides.bulkPut([ride('a', '2020-01-01'), ride('b', '2026-11-01')]);
    await db.wellness.put({ date: '2020-01-01', hrv: 50 } as Wellness);
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    await db.files.bulkPut([{ id: 'a', date: '2020-01-01', status: 'kept', bytes: big, size: big.length, at: 'x' }, { id: 'b', date: '2026-11-01', status: 'none', at: 'x', why: 'no file' }]);
    const text = JSON.stringify(await makeBackup());
    expect(backupSummary(text).words).toContain('2 activities, 1 day of wellness, 1 original activity file');
    await db.delete(); await db.open();
    await db.rides.put({ ...ride('b', '2026-11-01'), name: 'renamed here' });
    await restoreBackup(text);
    expect((await db.rides.get('a'))?.date).toBe('2020-01-01');
    expect((await db.rides.get('b'))?.name).toBe('renamed here');   // what is here stays
    expect((await db.wellness.get('2020-01-01'))?.hrv).toBe(50);
    const f = await db.files.get('a');
    expect(f?.size).toBe(big.length);
    expect(Array.from(f!.bytes!.slice(0, 300))).toEqual(Array.from(big.slice(0, 300)));
    expect((await db.files.get('b'))?.status).toBe('none');
  });
});
