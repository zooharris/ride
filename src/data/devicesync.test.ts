import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { localDoc, mergeRemote, type SyncDoc } from './devicesync';

// A minimal browser surface for the module under test.
(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const planned = (id: string, date: string, updatedAt?: string) => ({ id, date, workoutId: 'lib-spin-30', basis: 'power' as const, status: 'planned' as const, updatedAt });
const doc = (over: Partial<SyncDoc>): SyncDoc => ({ app: 'VeloIQ', schema: 2, exportedAt: '2026-10-19T00:00:00Z', profile: undefined, settings: [], workouts: [], planned: [], tombstones: [], ...over });

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('sync across devices', () => {
  it('writes stamp updatedAt and deletes leave tombstones', async () => {
    await db.planned.put(planned('a', '2026-11-01'));
    const a = await db.planned.get('a');
    expect(a?.updatedAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await db.planned.update('a', { status: 'sent' });
    expect((await db.planned.get('a'))?.updatedAt).not.toBe(a?.updatedAt);
    await db.planned.delete('a');
    await new Promise((r) => setTimeout(r, 20));
    expect((await db.tombstones.toArray()).map((t) => t.id)).toEqual(['planned:a']);
  });

  it('newest record wins, missing records are added, remote tombstones delete', async () => {
    await db.planned.put(planned('old', '2026-11-01'));          // stamped now
    await db.planned.put(planned('mine', '2026-11-02'));
    await db.planned.put(planned('gone', '2026-11-03'));
    const r = await mergeRemote(doc({
      planned: [
        planned('old', '2026-12-25', '2099-01-01T00:00:00Z'),   // remote is newer: wins
        planned('theirs', '2026-11-04', '2026-10-18T00:00:00Z'), // only remote: added
      ],
      tombstones: [{ id: 'planned:gone', at: '2099-01-01T00:00:00Z' }],
    }));
    const rows = await db.planned.toArray();
    expect(rows.find((p) => p.id === 'old')?.date).toBe('2026-12-25');
    expect(rows.map((p) => p.id).sort()).toEqual(['mine', 'old', 'theirs']);
    expect(r.applied).toBe(3);
    expect(r.localNewer).toBe(true);                               // 'mine' is not in the note yet
    // Applying remote records must not re-stamp them or leave tombstones for the clean-up.
    expect(rows.find((p) => p.id === 'old')?.updatedAt).toBe('2099-01-01T00:00:00Z');
    expect((await db.tombstones.toArray()).map((t) => t.id)).toEqual(['planned:gone']);
  });

  it('a local deletion beats an older remote copy, and the local doc carries it', async () => {
    await db.planned.put(planned('x', '2026-11-01'));
    await db.planned.delete('x');
    await new Promise((r) => setTimeout(r, 20));
    const r = await mergeRemote(doc({ planned: [planned('x', '2026-11-01', '2020-01-01T00:00:00Z')] }));
    expect(await db.planned.get('x')).toBeUndefined();
    expect(r.localNewer).toBe(true);
    const mine = await localDoc();
    expect(mine.tombstones.map((t) => t.id)).toEqual(['planned:x']);
    expect(mine.settings.some((s) => s.key === 'deviceId')).toBe(false);
  });

  it('two unstamped copies (older builds) are kept as a union', async () => {
    await db.transaction('rw', db.planned, async () => { await db.planned.put({ ...planned('legacy', '2026-11-01'), updatedAt: undefined }); });
    await db.planned.update('legacy', { updatedAt: undefined });
    const r = await mergeRemote(doc({ planned: [planned('other', '2026-11-02')] }));
    expect((await db.planned.toArray()).map((p) => p.id).sort()).toEqual(['legacy', 'other']);
    expect(r.localNewer).toBe(true);
  });
});
