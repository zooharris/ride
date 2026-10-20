import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, setSetting } from './db';
import { localDoc, mergeRemote, type SyncDoc } from './devicesync';
import { changeSig, deletePlan, dismissCoachReview, getActivePlan, getCoachReview, getPlans, putPlan, rejectChanges, renamePlan, type ActivePlan } from '../ui/planService';
import { getSetting } from './db';
import { addDays, today } from '../engine/load';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const doc = (over: Partial<SyncDoc>): SyncDoc => ({ app: 'VeloIQ', schema: 2, exportedAt: '2026-10-19T00:00:00Z', profile: undefined, settings: [], workouts: [], planned: [], tombstones: [], ...over });
const av = { hours: [1, 1, 1, 1, 1, 1, 1], outdoor: [false, false, false, false, false, false, false], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] };
const plan = (id: string, over: Partial<ActivePlan> = {}): ActivePlan => ({ id, name: `Plan ${id}`, goal: { kind: 'general', weeks: 8 }, availability: av, masters: true, start: addDays(today(), -7), goalDate: addDays(today(), 50), requiredCtl: 60, projection: [], appliedAt: '2026-10-18T00:00:00Z', ...over } as ActivePlan);
const session = (id: string, date: string, planId: string, over: Record<string, unknown> = {}) => ({ id, date, workoutId: 'w', basis: 'power' as const, status: 'planned' as const, planId, ...over });

beforeEach(async () => { await db.delete(); await db.open(); });

describe('plans are one record each', () => {
  it('a fresh device asking for plans writes nothing that could overwrite the real ones', async () => {
    expect(await getPlans()).toEqual([]);
    expect(await db.plans.count()).toBe(0);
    await mergeRemote(doc({ plans: [{ ...plan('p1'), updatedAt: '2026-10-18T00:00:00Z' }] }));
    expect((await getActivePlan())?.id).toBe('p1');
  });

  it('plans kept in the old single list move into the table, unstamped', async () => {
    await setSetting('plans', [plan('old')]);
    const plans = await getPlans();
    expect(plans.map((p) => p.id)).toEqual(['old']);
    expect((await db.plans.get('old'))?.updatedAt).toBeUndefined();
  });

  it('a plan deleted here is not brought back from the old list', async () => {
    await setSetting('plans', [plan('old')]);
    await getPlans();
    await deletePlan('old');
    expect(await getPlans()).toEqual([]);
  });

  it('two devices each adding a plan both keep both after syncing', async () => {
    await putPlan(plan('mine', { start: addDays(today(), 60), goalDate: addDays(today(), 120) }));
    const remote = doc({ plans: [{ ...plan('theirs'), updatedAt: new Date().toISOString() }] });
    const r = await mergeRemote(remote);
    expect((await getPlans()).map((p) => p.id).sort()).toEqual(['mine', 'theirs']);
    expect(r.localNewer).toBe(true);                     // this device's plan goes up in the note
    expect((await localDoc()).plans?.map((p) => p.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('a stale device cannot remove a plan another device has; a deletion can', async () => {
    await putPlan(plan('p1'));
    await mergeRemote(doc({ plans: [] }));               // the other device simply lacks it
    expect(await db.plans.get('p1')).toBeDefined();
    await mergeRemote(doc({ plans: [], tombstones: [{ id: 'plans:p1', at: new Date(Date.now() + 1000).toISOString() }] }));
    expect(await db.plans.get('p1')).toBeUndefined();
  });

  it('renaming a plan names its sessions too', async () => {
    await putPlan(plan('p1'));
    await db.planned.put(session('a', addDays(today(), 2), 'p1'));
    await renamePlan('p1', 'Fall-Winter (Q4) Training Block');
    expect((await db.plans.get('p1'))?.name).toBe('Fall-Winter (Q4) Training Block');
    expect((await db.planned.get('a'))?.planName).toBe('Fall-Winter (Q4) Training Block');
  });
});

describe('rebuilding a plan whose record is missing', () => {
  it('rebuilds it from its sessions still to come, under the name stored on them', async () => {
    await setSetting('planRequest', { goal: { kind: 'weight', weeks: 12 }, availability: av, masters: true });
    await db.planned.bulkPut([
      session('a', addDays(today(), -3), 'p1', { status: 'completed', note: 'Base 1', planName: 'Fall-Winter (Q4) Training Block' }),
      session('b', addDays(today(), 4), 'p1', { note: 'Recovery', planName: 'Fall-Winter (Q4) Training Block' }),
    ]);
    const active = await getActivePlan();
    expect(active?.id).toBe('p1');
    expect(active?.name).toBe('Fall-Winter (Q4) Training Block');
    expect(active?.start).toBe(addDays(today(), -3));
    expect(active?.weeks?.some((w) => w.phase === 'recovery')).toBe(true);
    expect((await getPlans()).length).toBe(1);           // saved, not rebuilt twice
  });

  it('waits until this device has synced with the others when it is connected', async () => {
    await setSetting('intervals', { athleteId: 'i1', apiKey: 'k' });
    await db.planned.put(session('b', addDays(today(), 4), 'p1'));
    expect(await getActivePlan()).toBeNull();
    await setSetting('deviceSync', { last: new Date().toISOString() });
    expect((await getActivePlan())?.id).toBe('p1');
  });

  it('never rebuilds a plan that was deleted on purpose', async () => {
    await db.tombstones.put({ id: 'plans:p1', at: new Date().toISOString() });
    await db.planned.put(session('b', addDays(today(), 4), 'p1'));
    expect(await getActivePlan()).toBeNull();
  });

  it('a cancelled plan, with nothing left to come, is not brought back', async () => {
    await db.planned.put(session('a', addDays(today(), -3), 'p1', { status: 'completed' }));
    expect(await getActivePlan()).toBeNull();
  });
});

describe('suggestions and reviews', () => {
  it('a rejected suggestion is remembered until its day has passed; another suggestion for the day is not', async () => {
    const tomorrow = { date: addDays(today(), 1), kind: 'ride', before: 'Endurance 90', after: 'Endurance 91', note: 'changed' };
    const past = { date: addDays(today(), -2), kind: 'ride', before: 'A', after: 'B', note: 'changed' };
    await rejectChanges([tomorrow, past]);
    await rejectChanges([]);                              // prunes the past one
    const kept = await getSetting<string[]>('replanRejected', []);
    expect(kept).toContain(changeSig(tomorrow));
    expect(kept).not.toContain(changeSig(past));
    expect(changeSig({ ...tomorrow, after: 'Endurance 120' })).not.toBe(changeSig(tomorrow));
  });
  it("today's coach review is kept until dismissed", async () => {
    await setSetting('coachReview', { date: today(), text: 'Good walk.', applyChanges: false, reason: '', at: new Date().toISOString() });
    expect((await getCoachReview())?.text).toBe('Good walk.');
    await dismissCoachReview();
    expect(await getCoachReview()).toBeNull();
    await setSetting('coachReview', { date: addDays(today(), -1), text: 'Old.', applyChanges: false, reason: '' });
    expect(await getCoachReview()).toBeNull();
  });
});
