import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in Intervals.icu: keeps the uploaded file, so the read-back reads the very bytes sent. */
const box = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), n: 0 }));
vi.mock('../sync/intervals', async (orig) => ({
  ...(await orig<typeof import('../sync/intervals')>()),
  uploadActivityFile: async (_c: unknown, f: Uint8Array) => { const id = `up${++box.n}`; box.files.set(id, f); return id; },
  updateActivityEffort: async () => {},
}));
vi.mock('../sync/syncService', async (orig) => ({
  ...(await orig<typeof import('../sync/syncService')>()),
  credentials: async () => ({ athleteId: 'i1', apiKey: 'k' }),
  syncAll: async () => ({ newIds: [] }),
}));

import { db } from '../data/db';
import { uploadRide } from './rides';
import { fillBreathing, hasBreathing } from './breathRead';
import type { Recording } from './types';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const t0 = Date.UTC(2026, 9, 30, 17);
const rec = (o: Partial<Recording> = {}): Recording => ({
  id: 'rb1', status: 'finished', startedAt: '2026-10-30T18:00:00', startMs: t0, date: '2026-10-30', name: 'Free ride', basis: 'power', ftp: 220, lthr: 160,
  samples: Array.from({ length: 900 }, (_, t) => ({ t, w: 160, hr: 130, ...(t >= 60 ? { ve: 32, br: 21, tv: 1.52, ie: 0.8 } : {}) })),
  laps: [], events: [], timerSeconds: 900, distanceM: 0, savedMs: 0, breathing: true, breathSensor: 'VitalPro R 4821', ...o,
});

beforeEach(async () => { await db.delete(); await db.open(); box.files.clear(); });

describe('a ride with breathing, saved and read back on another device', () => {
  it('the upload marks the activity with the strap, for every device; the file read back has the breathing', async () => {
    await db.recordings.put(rec());
    const r = await uploadRide('rb1');
    expect(r.ok).toBe(true);
    expect(await db.activityEdits.get(r.activityId!)).toMatchObject({ source: 'veloiq', breathSensor: 'VitalPro R 4821' });
    // Another device: no recording here, Intervals.icu has no custom streams, so the original file is read.
    const set = await fillBreathing({ id: r.activityId!, time: Array.from({ length: 900 }, (_, t) => t) }, undefined, async () => box.files.get(r.activityId!)!);
    expect(hasBreathing(set)).toBe(true);
    expect(Number.isNaN(set.ve![30])).toBe(true);
    expect(set.ve![300]).toBeCloseTo(32, 3);
    expect(set.br![300]).toBeCloseTo(21, 3);
  });
  it('a ride without a strap is marked as before, with no strap', async () => {
    await db.recordings.put(rec({ samples: Array.from({ length: 900 }, (_, t) => ({ t, w: 160 })), breathing: undefined, breathSensor: undefined }));
    const r = await uploadRide('rb1');
    const e = await db.activityEdits.get(r.activityId!);
    expect(e?.source).toBe('veloiq');
    expect(e?.breathSensor).toBeUndefined();
  });
});
