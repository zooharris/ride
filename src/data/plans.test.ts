import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, setSetting } from './db';
import { mergeRemote, type SyncDoc } from './devicesync';
import { getActivePlan, getPlans } from '../ui/planService';
import { addDays, today } from '../engine/load';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const doc = (over: Partial<SyncDoc>): SyncDoc => ({ app: 'VeloIQ', schema: 2, exportedAt: '2026-10-19T00:00:00Z', profile: undefined, settings: [], workouts: [], planned: [], tombstones: [], ...over });
const plan = { id: 'plan1', name: 'Winter block', goal: { kind: 'general', weeks: 8 }, availability: { hours: [1, 1, 1, 1, 1, 1, 1], outdoor: [false, false, false, false, false, false, false], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] }, masters: true, start: addDays(today(), -7), goalDate: addDays(today(), 50), requiredCtl: 60, projection: [], appliedAt: '2026-10-18T00:00:00Z' };

beforeEach(async () => { await db.delete(); await db.open(); });

describe('the plan record survives a new device', () => {
  it('a fresh device asking for plans writes nothing that could overwrite the real ones', async () => {
    expect(await getPlans()).toEqual([]);
    expect(await db.settings.get('plans')).toBeUndefined();
    // The note from the other device then brings the plan in.
    await mergeRemote(doc({ settings: [{ key: 'plans', value: [plan], updatedAt: '2026-10-18T00:00:00Z' }] }));
    expect((await getActivePlan())?.id).toBe('plan1');
  });
  it('a plan whose record was lost is rebuilt from its sessions still to come', async () => {
    await setSetting('plans', []);
    await setSetting('planRequest', { goal: plan.goal, availability: plan.availability, masters: true });
    await db.planned.bulkPut([
      { id: 'a', date: addDays(today(), -3), workoutId: 'w', basis: 'power', status: 'completed', planId: 'plan1', note: 'Base 1' },
      { id: 'b', date: addDays(today(), 4), workoutId: 'w', basis: 'power', status: 'planned', planId: 'plan1', note: 'Recovery' },
    ]);
    const active = await getActivePlan();
    expect(active?.id).toBe('plan1');
    expect(active?.start).toBe(addDays(today(), -3));
    expect(active?.weeks?.some((w) => w.phase === 'recovery')).toBe(true);
    expect((await getPlans()).length).toBe(1);   // saved, not rebuilt twice
  });
  it('a cancelled plan, with nothing left to come, is not brought back', async () => {
    await setSetting('plans', []);
    await db.planned.put({ id: 'a', date: addDays(today(), -3), workoutId: 'w', basis: 'power', status: 'completed', planId: 'plan1' });
    expect(await getActivePlan()).toBeNull();
  });
});
