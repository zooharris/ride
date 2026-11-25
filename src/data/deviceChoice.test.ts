import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getSetting } from './db';
import { chooseDevices, deviceStanding, localDoc, syncDevices, type DeviceSyncState } from './devicesync';

/**
 * Whether a device joins the rider's others is the rider's choice (25 Nov 2026): a saved copy found by a device that
 * has never been in step is not combined until they say; a device kept separate neither reads nor writes it; a device
 * that was in step before the choice existed stays in step.
 */
(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const C = { athleteId: 'i1', apiKey: 'k' };
const NAME = 'App backup (do not edit)';
type Event = { id: number; name: string; description: string };
let events: Event[] = [];
let asked: string[] = [];

/** Intervals.icu's calendar, as far as the note needs it. */
function calendar() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    asked.push(`${method} ${new URL(url).pathname}`);
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (method === 'GET') return reply(events);
    const body = JSON.parse(String(init?.body ?? '{}')) as Event;
    const m = /\/events\/(\d+)$/.exec(new URL(url).pathname);
    if (method === 'PUT' && m) { events = events.map((e) => (e.id === Number(m[1]) ? { ...e, ...body } : e)); return reply({}); }
    const e = { ...body, id: events.length + 1 }; events.push(e); return reply(e);
  }));
}
const plannedRow = (id: string) => ({ id, date: '2026-12-01', workoutId: 'lib-spin-30', basis: 'power' as const, status: 'planned' as const });
const writes = () => asked.filter((a) => !a.startsWith('GET'));

/** Another device's saved copy, already in the account: one calendar entry this device does not have. */
async function otherDeviceWroteANote() {
  await db.planned.put(plannedRow('from-the-other-device'));
  await syncDevices(C);
  expect(events.filter((e) => e.name === NAME)).toHaveLength(1);
  await db.delete(); await db.open();
  asked = [];
}

beforeEach(async () => { await db.delete(); await db.open(); events = []; asked = []; calendar(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('this device and the rider’s others', () => {
  it('with no saved copy in the account, the first device writes one and is in step', async () => {
    expect(await deviceStanding()).toBe('none');
    const st = await syncDevices(C);
    expect(st.last).toBeTruthy();
    expect(events).toHaveLength(1);
    expect(await deviceStanding()).toBe('sync');
  });

  it('a device that has never been in step finds a saved copy: nothing is combined or written until the rider chooses', async () => {
    await otherDeviceWroteANote();
    await db.planned.put(plannedRow('made-here'));
    const st = await syncDevices(C);
    expect(st.waiting?.savedAt).toBeTruthy();
    expect(st.last).toBeUndefined();
    expect(writes()).toEqual([]);
    expect((await db.planned.toArray()).map((p) => p.id)).toEqual(['made-here']);
    expect(await deviceStanding()).toBe('waiting');
    // Asked again (the app comes back to the front, a change is made): still nothing.
    await syncDevices(C);
    expect(writes()).toEqual([]);
  });

  it('"in step": what is here and the saved copy are combined, and the note then holds both', async () => {
    await otherDeviceWroteANote();
    await db.planned.put(plannedRow('made-here'));
    await syncDevices(C);
    const st = await chooseDevices('sync', C);
    expect(st.last).toBeTruthy();
    expect(st.waiting).toBeUndefined();
    expect((await db.planned.toArray()).map((p) => p.id).sort()).toEqual(['from-the-other-device', 'made-here']);
    expect(writes().length).toBeGreaterThan(0);
    expect(await deviceStanding()).toBe('sync');
    expect((await localDoc()).planned.map((p) => p.id).sort()).toEqual(['from-the-other-device', 'made-here']);
  });

  it('"separate": the device neither reads nor writes the saved copy, whoever asks for a round', async () => {
    await otherDeviceWroteANote();
    await db.planned.put(plannedRow('made-here'));
    await syncDevices(C);
    asked = [];
    await chooseDevices('separate', C);
    await syncDevices(C);
    await syncDevices(C);
    expect(asked).toEqual([]);
    expect((await db.planned.toArray()).map((p) => p.id)).toEqual(['made-here']);
    expect(await deviceStanding()).toBe('separate');
    expect((await getSetting<DeviceSyncState | null>('deviceSync', null))?.waiting).toBeUndefined();
  });

  it('a device kept separate can be put in step later, and one in step can be made separate', async () => {
    await otherDeviceWroteANote();
    await chooseDevices('separate', C);
    await chooseDevices('sync', C);
    expect((await db.planned.toArray()).map((p) => p.id)).toEqual(['from-the-other-device']);
    await chooseDevices('separate', C);
    asked = [];
    await db.planned.put(plannedRow('after-separating'));
    await syncDevices(C);
    expect(asked).toEqual([]);
  });

  it('a device that was in step before the choice existed stays in step without being asked', async () => {
    await otherDeviceWroteANote();
    await db.settings.put({ key: 'deviceSync', value: { last: '2026-11-20T10:00:00.000Z' } });
    const st = await syncDevices(C);
    expect(st.waiting).toBeUndefined();
    expect((await db.planned.toArray()).map((p) => p.id)).toEqual(['from-the-other-device']);
    expect(await deviceStanding()).toBe('sync');
  });

  it('the choice belongs to the device: it does not travel in the saved copy', async () => {
    await chooseDevices('sync', C);
    expect((await localDoc()).settings.map((s) => s.key)).not.toContain('deviceChoice');
  });
});
