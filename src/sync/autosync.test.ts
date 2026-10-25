import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Intervals.icu answers slowly with nothing, so a second call can arrive while the first runs.
let fail = false;
let served: unknown[] = [];
const calls = { rides: 0 };
vi.mock('./intervals', async (orig) => ({
  ...(await orig<typeof import('./intervals')>()),
  testConnection: vi.fn(async () => { if (fail) throw new Error('offline'); return {}; }),
  fetchRides: vi.fn(async () => { calls.rides++; await new Promise((r) => setTimeout(r, 20)); return structuredClone(served); }),
  fetchWellness: vi.fn(async () => []),
  fetchPowerCurve: vi.fn(async () => []),
}));
vi.mock('../data/devicesync', async (orig) => ({ ...(await orig<typeof import('../data/devicesync')>()), schedulePush: vi.fn(), syncDevices: vi.fn(async () => {}) }));

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const { db, setSetting } = await import('../data/db');
const { addDays, today } = await import('../engine/load');
const { autoSync, autoSyncDue, AUTO_SYNC_GAP_MS, lastSyncAt, syncAll, syncRunning } = await import('./syncService');

const now = Date.parse('2026-10-25T15:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

describe('when an automatic pull is due', () => {
  const base = { connected: true, running: false, online: true, now };
  it('pulls on a device that has never pulled', () => expect(autoSyncDue({ ...base })).toBe(true));
  it('skips within ten minutes of the last pull', () => expect(autoSyncDue({ ...base, last: ago(AUTO_SYNC_GAP_MS - 1000) })).toBe(false));
  it('pulls at ten minutes and after', () => {
    expect(autoSyncDue({ ...base, last: ago(AUTO_SYNC_GAP_MS) })).toBe(true);
    expect(autoSyncDue({ ...base, last: ago(9 * 3600_000) })).toBe(true);
  });
  it('never without a connection, while one runs, or offline', () => {
    expect(autoSyncDue({ ...base, connected: false })).toBe(false);
    expect(autoSyncDue({ ...base, running: true })).toBe(false);
    expect(autoSyncDue({ ...base, online: false })).toBe(false);
  });
});

describe('the automatic pull', () => {
  beforeEach(async () => {
    fail = false; served = []; calls.rides = 0;
    await db.delete(); await db.open();
    await setSetting('intervals', { athleteId: 'i1', apiKey: 'k' });
    await db.profile.put({ id: 'me', name: 'T', ftp: 200, lthr: 160 } as never);
  });

  it('runs once, then skips for ten minutes', async () => {
    expect(await autoSync()).toBe(true);
    expect(await lastSyncAt()).toBeTruthy();
    const after = calls.rides;
    expect(await autoSync()).toBe(false);
    expect(calls.rides).toBe(after);
  });

  it('never runs two pulls at once: a second call shares the first', async () => {
    const a = syncAll();
    expect(syncRunning()).toBe(true);
    const b = syncAll();
    expect(b).toBe(a);
    expect(await autoSync()).toBe(false);   // one is running
    await a;
    expect(syncRunning()).toBe(false);
  });

  it('is silent on failure, and records when it failed', async () => {
    fail = true;
    await expect(autoSync()).resolves.toBe(true);
    const s = await db.sync.get('intervals');
    expect(s?.lastError).toBe('offline');
    expect(s?.lastErrorAt).toBeTruthy();
    expect(s?.lastActivitySync).toBeUndefined();
  });

  it('a later success clears the failure', async () => {
    fail = true; await autoSync();
    fail = false; await autoSync();
    const s = await db.sync.get('intervals');
    expect(s?.lastErrorAt).toBeUndefined();
    expect(s?.lastActivitySync).toBeTruthy();
  });

  it('hands new activities to the coach step only when there are some', async () => {
    const after = vi.fn(async () => {});
    await autoSync(after);
    expect(after).not.toHaveBeenCalled();   // first pull: nothing counts as new
    // A ride arrives; the next due pull passes it on.
    served = [{ id: 'r9', date: today(), type: 'Ride', sport: 'ride', name: 'Morning ride', seconds: 3600, averageHr: 130 }];
    await db.sync.update('intervals', { lastActivitySync: new Date(Date.now() - AUTO_SYNC_GAP_MS - 1000).toISOString() });
    await autoSync(after);
    expect(after).toHaveBeenCalledWith(['r9']);
    // A failing coach step does not make the pull look failed.
    served.push({ id: 'r10', date: addDays(today(), -1), type: 'Ride', sport: 'ride', name: 'Ride', seconds: 3600, averageHr: 130 });
    await db.sync.update('intervals', { lastActivitySync: new Date(Date.now() - AUTO_SYNC_GAP_MS - 1000).toISOString() });
    await expect(autoSync(async () => { throw new Error('coach down'); })).resolves.toBe(true);
    expect((await db.sync.get('intervals'))?.lastErrorAt).toBeUndefined();
  });

  it('the coach step reviews only when the coach setting is on', async () => {
    const { coachReviewAfterSync } = await import('../ui/planService');
    const coach = await import('../coach/claude');
    const spy = vi.spyOn(coach, 'reviewAfterSync').mockResolvedValue({ text: 'ok', reason: '', applyChanges: 'all', skip: [] } as never);
    const data = { profile: { id: 'me', name: 'T', ftp: 200, lthr: 160 }, rides: [], wellness: [], planned: [], dayNotes: [], mine: [], edits: [] } as never;
    await setSetting('claudeKey', 'k');
    await setSetting('coachAuto', false);
    expect(await coachReviewAfterSync(data, ['r9'])).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
