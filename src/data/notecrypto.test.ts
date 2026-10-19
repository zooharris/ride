import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the note in Intervals.icu.
const store: { payload: string | null } = { payload: null };
vi.mock('../sync/intervals', () => ({
  readBackupNote: async () => (store.payload == null ? null : { id: 1, payload: store.payload }),
  writeBackupNote: async (_c: unknown, payload: string) => { store.payload = payload; },
}));

import { db, getSetting, setSetting } from './db';
import { clearLock, lockStatus, NoteLockedError, readRemote, setLock, syncDevices, unlockNote, writeRemote } from './devicesync';
import { isSealed, makeLock, newDataKey, normaliseAnswer, unlockWithAnswer, unlockWithPassphrase } from './notecrypto';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
const creds = { athleteId: 'i1', apiKey: 'k' };
const planned = (id: string, date: string) => ({ id, date, workoutId: 'lib-spin-30', basis: 'power' as const, status: 'planned' as const });

beforeEach(async () => {
  await db.delete();
  await db.open();
  store.payload = null;
});

describe('the lock on the note', () => {
  it('opens with the passphrase or the answer, and the answer forgives case, spacing and punctuation', async () => {
    const key = newDataKey();
    const lock = await makeLock(key, 'correct horse battery', 'First bike?', 'Raleigh Chopper');
    expect(await unlockWithPassphrase(lock, 'correct horse battery')).toBe(key);
    expect(await unlockWithPassphrase(lock, 'wrong')).toBeNull();
    expect(await unlockWithAnswer(lock, '  raleigh-chopper! ')).toBe(key);
    expect(await unlockWithAnswer(lock, 'schwinn')).toBeNull();
    expect(normaliseAnswer('Mrs. O’Brien')).toBe('mrsobrien');
    // the two wrappings are independent: the answer gives nothing about the passphrase
    expect(lock.pass.wrapped).not.toBe(lock.answer.wrapped);
  });

  it('writes the note encrypted once a lock is set, and reads it back on the same device', async () => {
    await db.planned.put(planned('a', '2026-11-01'));
    await setLock('pass phrase', 'Favourite climb?', 'Mt Weather');
    expect((await lockStatus()).question).toBe('Favourite climb?');
    await writeRemote(creds);
    expect(isSealed(store.payload!)).toBe(true);
    expect(store.payload).not.toContain('2026-11-01');
    expect(store.payload).not.toContain('lib-spin-30');
    const doc = await readRemote(creds);
    expect(doc?.planned.map((p) => p.id)).toEqual(['a']);
  });

  it('a device without the key sees the question, pushes nothing, and gets in with the answer', async () => {
    await db.planned.put(planned('laptop', '2026-11-01'));
    await setLock('pass phrase', 'Favourite climb?', 'Mt Weather');
    await writeRemote(creds);
    const sealedBefore = store.payload;
    // a second device: fresh database, its own data, no key
    await db.delete(); await db.open();
    await db.planned.put(planned('phone', '2026-11-02'));
    await expect(readRemote(creds)).rejects.toBeInstanceOf(NoteLockedError);
    const state = await syncDevices(creds);
    expect(state.locked?.question).toBe('Favourite climb?');
    expect(state.error).toBeUndefined();
    expect(store.payload).toBe(sealedBefore);                      // nothing overwritten in the clear
    expect(await unlockNote(creds, 'no idea', 'passphrase')).toBe(false);
    expect(await unlockNote(creds, 'mt weather', 'answer')).toBe(true);
    const after = await syncDevices(creds);
    expect(after.locked).toBeUndefined();
    expect((await db.planned.toArray()).map((p) => p.id).sort()).toEqual(['laptop', 'phone']);
    expect(isSealed(store.payload!)).toBe(true);                   // the merged note went back up still sealed
  });

  it('a passphrase changed on one device reaches the other through the note', async () => {
    await setLock('old pass', 'Q?', 'A');
    await writeRemote(creds);
    const key = await getSetting<string>('noteKey', '');
    await setLock('new pass', 'Q2?', 'B');                         // same data key, new wrappings
    expect(await getSetting<string>('noteKey', '')).toBe(key);
    await writeRemote(creds);
    // the other device still holds the data key, so it opens the note and adopts the new lock
    await setSetting('noteLock', null);
    await setSetting('noteKey', key);
    await readRemote(creds);
    expect((await lockStatus()).question).toBe('Q2?');
    // turning the lock off writes the note in the clear again
    await clearLock();
    await writeRemote(creds);
    expect(isSealed(store.payload!)).toBe(false);
  });
});
