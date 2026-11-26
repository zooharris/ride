import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { chooseDevices, deviceStanding, readRemote, syncDevices } from './devicesync';
import { makeBackup, restoreBackup } from './backup';

/**
 * Restoring, and joining the rider's other devices, in every order (25 Nov 2026). An older backup once came in marked
 * as changed at the moment of the restore, so a device that then joined the others replaced their newer data with it.
 * Now a restore brings each item in at the age the backup records, the newer version of each item wins when devices
 * are combined, and replacing newer data everywhere is its own deliberate action.
 */
(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const C = { athleteId: 'i1', apiKey: 'k' };
type Event = { id: number; name: string; description: string };
let events: Event[] = [];
let asked: string[] = [];
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
const tick = () => new Promise((r) => setTimeout(r, 8));
const workout = (id: string, name: string) => ({ id, name, kind: 'ride', setting: 'any', steps: [] }) as never;
const planned = (id: string) => ({ id, date: '2026-12-01', workoutId: 'w', basis: 'power', status: 'planned' }) as never;
const nameOf = async (id: string) => (await db.workouts.get(id))?.name;
const noteNameOf = async (id: string) => (await readRemote(C))?.workouts.find((w) => w.id === id)?.name;
/** A new device: nothing on it. The account (the saved copy) is untouched. */
const newDevice = async () => { await db.delete(); await db.open(); asked = []; };

/**
 * The rider's first device, in step. It holds a workout and a calendar entry, and a backup is made ("the old file").
 * Then the workout is renamed, the entry deleted and another added, and the saved copy carries all three changes.
 */
async function anOldFileThenLaterChanges(): Promise<string> {
  await db.profile.put({ id: 'me', units: 'metric' } as never);
  await db.workouts.put(workout('w', 'As it was'));
  await db.planned.put(planned('deleted-since'));
  await syncDevices(C);
  const old = JSON.stringify(await makeBackup());
  await tick();
  await db.workouts.put(workout('w', 'As it is now'));
  await db.planned.delete('deleted-since');
  await db.planned.put(planned('added-since'));
  await syncDevices(C);
  expect(await noteNameOf('w')).toBe('As it is now');
  return old;
}

beforeEach(async () => { await db.delete(); await db.open(); events = []; asked = []; calendar(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('restoring a backup, and joining the rider’s other devices', () => {
  it('an old file, then joining the others: the newer data wins, and what was deleted since stays deleted', async () => {
    const old = await anOldFileThenLaterChanges();
    await newDevice();
    await restoreBackup(old);
    expect(await nameOf('w')).toBe('As it was');
    // nothing is combined until the rider chooses
    expect((await syncDevices(C)).waiting).toBeTruthy();
    expect(asked.filter((a) => !a.startsWith('GET'))).toEqual([]);
    await chooseDevices('sync', C);
    expect(await nameOf('w')).toBe('As it is now');
    expect(await db.planned.get('deleted-since')).toBeUndefined();
    expect(await db.planned.get('added-since')).toBeTruthy();
    // and the saved copy the other devices read is not put back to the old file
    expect(await noteNameOf('w')).toBe('As it is now');
    expect((await readRemote(C))?.planned.map((p) => p.id)).toEqual(['added-since']);
  });

  it('a restore keeps each item at the age the backup records', async () => {
    await db.profile.put({ id: 'me', units: 'metric' } as never);
    await db.workouts.put(workout('w', 'As it was'));
    const before = (await db.workouts.get('w'))!.updatedAt;
    const file = JSON.stringify(await makeBackup());
    await tick();
    await newDevice();
    await restoreBackup(file);
    expect((await db.workouts.get('w'))!.updatedAt).toBe(before);
    expect((await db.workouts.get('w') as { restoredAt?: string }).restoredAt).toBeUndefined();
  });

  it('in step, then an old file restored the ordinary way: nothing newer is replaced', async () => {
    const old = await anOldFileThenLaterChanges();
    await restoreBackup(old, 'add');
    expect(await nameOf('w')).toBe('As it is now');
    expect(await db.planned.get('deleted-since')).toBeUndefined();
    expect(await db.planned.get('added-since')).toBeTruthy();
    await syncDevices(C);
    expect(await noteNameOf('w')).toBe('As it is now');
  });

  it('in step, then "put everything back as it was": the backup wins on every device, and what was deleted since comes back', async () => {
    const old = await anOldFileThenLaterChanges();
    await tick();
    await restoreBackup(old, 'everywhere');
    await syncDevices(C);
    expect(await nameOf('w')).toBe('As it was');
    expect(await db.planned.get('deleted-since')).toBeTruthy();
    const note = await readRemote(C);
    expect(note?.workouts.find((w) => w.id === 'w')?.name).toBe('As it was');
    expect(note?.planned.map((p) => p.id).sort()).toEqual(['added-since', 'deleted-since']);
  });

  it('an old file on a device kept separate: the device has the file’s data and the saved copy is never touched', async () => {
    const old = await anOldFileThenLaterChanges();
    await newDevice();
    await restoreBackup(old);
    await chooseDevices('separate', C);
    await syncDevices(C);
    expect(asked).toEqual([]);
    expect(await nameOf('w')).toBe('As it was');
    expect(await deviceStanding()).toBe('separate');
  });

  it('a file newer than the saved copy: its newer data reaches the others', async () => {
    await db.profile.put({ id: 'me', units: 'metric' } as never);
    await db.workouts.put(workout('w', 'As it was'));
    await syncDevices(C);
    await tick();
    // changed with no connection, then backed up to a file: the saved copy never heard of it
    await db.workouts.put(workout('w', 'Changed offline'));
    const newer = JSON.stringify(await makeBackup());
    await newDevice();
    await restoreBackup(newer);
    await syncDevices(C);
    await chooseDevices('sync', C);
    expect(await nameOf('w')).toBe('Changed offline');
    expect(await noteNameOf('w')).toBe('Changed offline');
  });

  it('two devices restored from different files, then joined: each item’s newer version, and everything either had', async () => {
    await db.profile.put({ id: 'me', units: 'metric' } as never);
    await db.workouts.put(workout('w', 'First file'));
    await db.workouts.put(workout('only-in-first', 'Only in the first'));
    const first = JSON.stringify(await makeBackup());
    await tick();
    await db.workouts.put(workout('w', 'Second file'));
    await db.workouts.delete('only-in-first');
    await db.tombstones.clear();
    await db.workouts.put(workout('only-in-second', 'Only in the second'));
    const second = JSON.stringify(await makeBackup());

    await newDevice();
    await restoreBackup(first);
    await syncDevices(C);                 // no saved copy yet: this device writes the first
    expect(await deviceStanding()).toBe('sync');

    await newDevice();
    await restoreBackup(second);
    expect((await syncDevices(C)).waiting).toBeTruthy();
    await chooseDevices('sync', C);
    expect(await nameOf('w')).toBe('Second file');
    expect(await db.workouts.get('only-in-first')).toBeTruthy();
    expect(await db.workouts.get('only-in-second')).toBeTruthy();
    const note = await readRemote(C);
    expect(note?.workouts.map((w) => w.id).sort()).toEqual(['only-in-first', 'only-in-second', 'w']);
    expect(note?.workouts.find((w) => w.id === 'w')?.name).toBe('Second file');
  });
});
