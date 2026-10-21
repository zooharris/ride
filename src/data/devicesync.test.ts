import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { completionWins, localDoc, mergeRemote, type SyncDoc } from './devicesync';

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
    const { untracked } = await import('./db');
    await untracked(async () => { await db.planned.put({ ...planned('legacy', '2026-11-01'), updatedAt: undefined }); });
    const r = await mergeRemote(doc({ planned: [planned('other', '2026-11-02')] }));
    expect((await db.planned.toArray()).map((p) => p.id).sort()).toEqual(['legacy', 'other']);
    expect(r.localNewer).toBe(true);
  });
});

describe('day notes', () => {
  it('travel in the note like calendar entries and are left out of trusted wellness', async () => {
    const { trustedWellness, saveDayNote } = await import('../ui/store');
    await saveDayNote('2026-10-19', { text: 'watch out of sleep mode overnight', badWellness: true });
    await saveDayNote('2026-10-18', { text: 'long day of yard work' });
    const mine = await localDoc();
    expect(mine.dayNotes?.map((n) => n.date).sort()).toEqual(['2026-10-18', '2026-10-19']);
    expect(mine.dayNotes?.find((n) => n.date === '2026-10-19')?.updatedAt).toBeTruthy();
    // a note from another device arrives; an older note written before day notes existed has none
    const r = await mergeRemote(doc({ dayNotes: [{ date: '2026-10-17', text: 'flight home', updatedAt: '2026-10-17T20:00:00Z' }] }));
    expect(r.applied).toBe(1);
    expect(r.localNewer).toBe(true);
    const notes = await db.dayNotes.toArray();
    const wellness = [{ date: '2026-10-17', hrv: 60 }, { date: '2026-10-18', hrv: 58 }, { date: '2026-10-19', hrv: 31 }];
    expect(trustedWellness(wellness, notes).map((w) => w.date)).toEqual(['2026-10-17', '2026-10-18']);
    // clearing the note removes it, and the removal carries
    await saveDayNote('2026-10-19', { text: '', badWellness: false });
    await new Promise((res) => setTimeout(res, 20));
    expect(await db.dayNotes.get('2026-10-19')).toBeUndefined();
    expect((await db.tombstones.toArray()).map((t) => t.id)).toContain('dayNotes:2026-10-19');
    expect(trustedWellness(wellness, await db.dayNotes.toArray())).toHaveLength(3);
  });
});

describe('secrets stay on the device', () => {
  it('leaves the API keys out of the sync note, keeps them in a file backup, and keeps this device\'s keys on a restore from the note', async () => {
    const { makeBackup, restoreBackup } = await import('./backup');
    await db.profile.put({ id: 'me', name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 75, basis: 'power', units: 'imperial', hoursPerWeek: 8 } as never);
    await db.settings.put({ key: 'intervals', value: { athleteId: 'i1', apiKey: 'secret' } });
    await db.settings.put({ key: 'claudeKey', value: 'sk-secret' });
    await db.settings.put({ key: 'plans', value: [] });
    const note = await localDoc();
    expect(note.settings.map((s) => s.key)).toEqual(['plans']);
    const file = await makeBackup();
    expect(file.settings.map((s) => s.key).sort()).toEqual(['claudeKey', 'intervals', 'plans']);
    // a note from the other device has no keys; merging it must not leave this device forever "newer"
    const r = await mergeRemote(doc({ profile: await db.profile.get('me'), settings: [{ key: 'plans', value: [], updatedAt: '2099-01-01T00:00:00Z' }] }));
    expect(r.localNewer).toBe(false);
    // replacing this device with the note keeps the keys it already has
    await restoreBackup(JSON.stringify(note));
    expect(((await db.settings.get('intervals'))?.value as { apiKey: string }).apiKey).toBe('secret');
    expect((await db.settings.get('claudeKey'))?.value).toBe('sk-secret');
  });
  it('a deleted plan stays deleted, even when another device later wrote to its copy', async () => {
    const plan = { id: 'ghost', name: 'Old block', goal: { kind: 'weight', weeks: 12 }, availability: { equipment: ['bodyweight'] }, start: '2026-10-20', goalDate: '2027-01-09', updatedAt: '2026-10-20T20:00:00Z' };
    await db.tombstones.put({ id: 'plans:ghost', at: '2026-10-20T15:00:00Z' });          // deleted here this afternoon
    await mergeRemote(doc({ plans: [plan as never] }));                                 // an older phone re-checked its copy tonight
    expect(await db.plans.get('ghost')).toBeUndefined();
  });
});

describe('change stamps', () => {
  it('every save of a tracked record is stamped, a second put() of the same record included', async () => {
    const { setSetting } = await import('./db');
    await setSetting('historyFrom', '2026-01-01');
    const first = (await db.settings.get('historyFrom'))?.updatedAt;
    expect(typeof first).toBe('string');
    await new Promise((r) => setTimeout(r, 5));
    await setSetting('historyFrom', '2025-06-01');
    const second = (await db.settings.get('historyFrom'))?.updatedAt;
    expect(typeof second).toBe('string');
    expect(second! > first!).toBe(true);
    const { saveDayNote } = await import('../ui/store');
    await saveDayNote('2026-10-20', { text: 'one' });
    await saveDayNote('2026-10-20', { text: 'two' });
    expect(typeof (await db.dayNotes.get('2026-10-20'))?.updatedAt).toBe('string');
  });
  it('a record arriving from another device keeps its own stamp', async () => {
    const { untracked } = await import('./db');
    await untracked(async () => { await db.planned.put({ ...planned('remote', '2026-11-01'), updatedAt: '2026-01-01T00:00:00.000Z' }); });
    expect((await db.planned.get('remote'))?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('a completion beats a state a device worked out for itself', () => {
  const base = planned('s', '2026-10-20');
  it('a device that marked the session missed before hearing it was done does not win on its newer stamp', () => {
    const mine = { ...base, status: 'missed' as const, updatedAt: '2026-10-21T08:00:00Z' };
    const remote = { ...base, status: 'completed' as const, activityId: 'r1', updatedAt: '2026-10-20T20:00:00Z' };
    expect(completionWins(mine, remote)).toBe('remote');
    expect(completionWins(remote, mine)).toBe('mine');
  });
  it('the rider’s own undo is newer and explicit, so it wins', () => {
    const done = { ...base, status: 'completed' as const, activityId: 'r1', updatedAt: '2026-10-20T20:00:00Z' };
    const refused = { ...base, status: 'sent' as const, notActivityIds: ['r1'], updatedAt: '2026-10-21T08:00:00Z' };
    expect(completionWins(done, refused)).toBe('remote');
    const undone = { ...base, status: 'planned' as const, undoneAt: '2026-10-21T08:00:00Z', updatedAt: '2026-10-21T08:00:00Z' };
    expect(completionWins(done, undone)).toBe('remote');
    expect(completionWins(undone, done)).toBe('mine');
  });
  it('two completions, or two not-yet-done states, go by the stamp as before', () => {
    expect(completionWins({ ...base, status: 'completed' as const }, { ...base, status: 'completed' as const })).toBeUndefined();
    expect(completionWins({ ...base, status: 'sent' as const }, { ...base, status: 'missed' as const })).toBeUndefined();
  });
  it('merging applies the rule', async () => {
    await db.planned.put({ ...base, status: 'missed', updatedAt: '2026-10-21T08:00:00Z' });
    await mergeRemote(doc({ planned: [{ ...base, status: 'completed', activityId: 'r1', updatedAt: '2026-10-20T20:00:00Z' } as never] }));
    expect((await db.planned.get('s'))?.status).toBe('completed');
  });
});
