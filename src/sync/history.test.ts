import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Intervals.icu answers with nothing; what matters here is which span is asked for.
const asked: Array<[string, string]> = [];
vi.mock('./intervals', async (orig) => ({
  ...(await orig<typeof import('./intervals')>()),
  fetchRides: vi.fn(async (_c: unknown, from: string, to: string) => { asked.push([from, to]); return []; }),
  fetchWellness: vi.fn(async () => []),
}));
vi.mock('../data/devicesync', async (orig) => ({ ...(await orig<typeof import('../data/devicesync')>()), schedulePush: vi.fn() }));

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const { db, getSetting, setSetting } = await import('../data/db');
const { loadHistory, matchHistory } = await import('./syncService');
const { localDoc } = await import('../data/devicesync');
const { addDays, today } = await import('../engine/load');

const ride = (id: string, date: string) => ({ id, date, type: 'Ride', sport: 'ride' as const, name: 'Ride', seconds: 3600, tss: 50 });

beforeEach(async () => {
  asked.length = 0;
  await db.delete();
  await db.open();
  await setSetting('intervals', { athleteId: 'i1', apiKey: 'k' });
});

describe('every device holds the same history', () => {
  it('a device that has loaded further back moves the shared date back', async () => {
    const back = addDays(today(), -400);
    await loadHistory(back, () => {});
    expect(await getSetting('historyFrom', null)).toBe(back);
    expect(await getSetting('historyLoadedFrom', null)).toBe(back);
    // The shared date travels in the note; this device's own date does not.
    const keys = (await localDoc()).settings.map((s) => s.key);
    expect(keys).toContain('historyFrom');
    expect(keys).not.toContain('historyLoadedFrom');
  });

  it('a device with less history loads back to the shared date by itself', async () => {
    await setSetting('historyLoadedFrom', addDays(today(), -120));
    const shared = addDays(today(), -730);
    await setSetting('historyFrom', shared);   // as merged from the note
    const r = await matchHistory();
    expect(r?.from).toBe(shared);
    expect(asked[0][0]).toBe(shared);
    expect(await getSetting('historyLoadedFrom', null)).toBe(shared);
    asked.length = 0;
    expect(await matchHistory()).toBeNull();   // level now: nothing more to load
    expect(asked).toHaveLength(0);
  });

  it('a device from before the shared date was kept is judged by what it holds', async () => {
    const held = addDays(today(), -500);
    await db.rides.put(ride('r1', held) as never);
    expect(await matchHistory()).toBeNull();
    expect(await getSetting('historyFrom', null)).toBe(held);
    expect(asked).toHaveLength(0);
  });

  it('a device that has never synced loads nothing', async () => {
    await setSetting('historyFrom', addDays(today(), -365));
    expect(await matchHistory()).toBeNull();
    expect(asked).toHaveLength(0);
  });
});
