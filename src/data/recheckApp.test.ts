import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_PROFILE } from './db';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };
afterEach(() => { vi.useRealTimers(); });

describe('the steady re-check, through the app (placed on a Friday, as Todd placed his)', () => {
  it('the next mornings recommend nothing, with every session done as planned', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-30T12:00:00'));
    await db.profile.put({ ...DEFAULT_PROFILE, id: 'me' } as never);
    // Twelve weeks of a steady rider's history before the plan, as Todd has (rides on Saturday, Sunday and Wednesday).
    for (let i = 84; i >= 1; i--) {
      const d = new Date(Date.parse('2026-10-30T12:00:00') - i * 864e5); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const h = d.getDay() === 6 ? 1.75 : d.getDay() === 0 ? 2.75 : d.getDay() === 3 ? 1.25 : 0;
      if (h) await db.rides.put({ id: `h${date}`, date, startTime: `${date}T08:00:00`, name: 'Ride', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 55), averageHr: 135 } as never);
    }
    const { loadAppData } = await import('../ui/store');
    const { applyPlan, buildPlan, replan } = await import('../ui/planService');
    const av = { hours: [3, 1, 1.5, 1, 1.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false], equipment: ['dumbbells', 'bench', 'bodyweight', 'kettlebell', 'band'] as never, pins: [], may: { strength: true, mobility: true, walk: false, run: false } };
    const goal = { kind: 'event' as const, date: '2027-01-22', name: 'Century', eventType: 'century' as const, distanceKm: 161, climbingM: 900, priority: 'A' as const };
    const data = await loadAppData();
    const plan = await buildPlan(data, goal, av, true);
    await applyPlan(data, plan, goal, av, true);
    for (const day of ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05', '2026-11-09', '2026-11-12']) {
      vi.setSystemTime(new Date(`${day}T07:00:00`));
      // Everything before today done as planned and synced: fitness follows the plan's line.
      for (const w of plan.weeks) for (const x of w.sessions) if (x.date < day && !(await db.rides.get(`r${x.date}${x.kind}`))) {
        await db.rides.put({ id: `r${x.date}${x.kind}`, date: x.date, startTime: `${x.date}T08:00:00`, name: x.workout.name, type: x.kind === 'ride' ? 'Ride' : 'WeightTraining', sport: x.kind, seconds: x.seconds, tss: x.tss } as never);
      }
      const check = await replan(await loadAppData());
      expect(check!.changes.map((c) => `${day}: ${c.date} ${c.kind} ${c.before ?? '-'} → ${c.after ?? '-'}`)).toEqual([]);
      expect((check!.later ?? []).map((c) => `${day} later: ${c.date} ${c.kind} ${c.before ?? '-'} → ${c.after ?? '-'}`)).toEqual([]);
    }
  }, 60000);
});
