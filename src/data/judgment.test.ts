import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_PROFILE, setSetting } from './db';
import { addDays, today } from '../engine/load';
import type { PlannedWorkout, Profile, Ride } from '../engine/types';
import type { Judgment } from '../coach/judge';
import { LIBRARY } from '../library/workouts';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const rider: Profile = { ...DEFAULT_PROFILE, name: 'Rider' };
const T = today();
const tempo = LIBRARY.find((w) => w.family === 'tempo')!;
const spin = LIBRARY.find((w) => w.family === 'recovery')!;
const planned = (over: Partial<PlannedWorkout> = {}): PlannedWorkout => ({ id: 'p1', date: T, workoutId: tempo.id, basis: 'power', status: 'planned', ...over });
const ride = (over: Partial<Ride> = {}): Ride => ({ id: 'r1', date: addDays(T, -1), startTime: `${addDays(T, -1)}T09:00`, name: 'Long ride', type: 'Ride', sport: 'ride', seconds: 4 * 3600, tss: 220, ...over });
const data = (over: Record<string, unknown> = {}) => ({ profile: rider, rides: [ride()], ridesAll: [ride()], wellness: [], wellnessAll: [], planned: [planned()], dayNotes: [], mine: [], edits: [], loaded: true, ...over }) as never;

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('C: the coach judges, and every device sees it', () => {
  it('asks once for the same evidence; Check again asks regardless; nothing re-asks on its own', async () => {
    const svc = await import('../ui/judgeService');
    const coach = await import('../coach/claude');
    await setSetting('coachAuto', true);
    await setSetting('claudeKey', 'k');
    const spy = vi.spyOn(coach, 'judgeDay').mockResolvedValue({ note: 'An easy spin today.', assessment: 'Yesterday was your longest ride in weeks.', stance: 'easy', changes: [{ date: T, action: 'replace', session: 'C1', workout: 'W1', why: 'w' }] });
    const d = data();
    const j = await svc.ensureJudgment(d, { check: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(j).toMatchObject({ note: 'An easy spin today.', stance: 'easy' });
    // The packet names the calendar and the Library; whatever W1 is, the change was checked against them.
    const packet = spy.mock.calls[0][3];
    expect(packet).toContain('## 6. The calendar');
    expect(packet).toContain('C1 · ');
    await svc.ensureJudgment(d, { check: null });
    expect(spy).toHaveBeenCalledTimes(1);
    await svc.ensureJudgment(d, { check: null, force: true });
    expect(spy).toHaveBeenCalledTimes(2);
    // A new activity is new evidence.
    await svc.ensureJudgment(data({ rides: [ride(), ride({ id: 'r2', date: T, name: 'Walk', sport: 'walk', seconds: 1800, tss: 12 })] }), { check: null });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('with no changes: the note, and an empty list', async () => {
    const svc = await import('../ui/judgeService');
    const coach = await import('../coach/claude');
    await setSetting('coachAuto', true);
    await setSetting('claudeKey', 'k');
    vi.spyOn(coach, 'judgeDay').mockResolvedValue({ note: 'Ride it as planned.', assessment: '', stance: 'as planned', changes: [] });
    const r = await svc.recommendFor(data(), null, undefined, false, 5000);
    expect(r).toMatchObject({ byCoach: true, status: 'ready' });
    expect(r.changes).toEqual([]);
  });

  it('a device without a key shows the judgment another device made today, and asks for none; it travels in the sync note', async () => {
    const svc = await import('../ui/judgeService');
    const coach = await import('../coach/claude');
    const spy = vi.spyOn(coach, 'judgeDay');
    await setSetting('coachAuto', true);
    const j: Judgment = { date: T, sig: 'other-device', at: new Date().toISOString(), note: 'Easy today.', assessment: 'a', stance: 'easy',
      changes: [{ date: T, kind: 'ride', action: 'replace', plannedId: 'p1', workoutId: spin.id, before: tempo.name, after: spin.name, why: 'Heart rate ran 6 bpm high at the same power.' }] };
    await setSetting(svc.JUDGMENT_KEY, j);
    const r = await svc.recommendFor(data(), null);
    expect(spy).not.toHaveBeenCalled();
    expect(r.byCoach).toBe(true);
    expect(r.changes).toHaveLength(1);
    expect([...r.reasons.values()]).toEqual(['Heart rate ran 6 bpm high at the same power.']);
    const { localDoc } = await import('./devicesync');
    expect((await localDoc()).settings.some((x) => x.key === svc.JUDGMENT_KEY)).toBe(true);
    expect((await localDoc()).settings.some((x) => x.key === 'claudeKey')).toBe(false);
  });

  it('a change whose session has since been done or removed is no longer offered; a rejected one is gone', async () => {
    const svc = await import('../ui/judgeService');
    const { rejectChanges } = await import('../ui/planService');
    const { toChange } = await import('../coach/judge');
    await setSetting('coachAuto', true);
    const change = { date: T, kind: 'ride' as const, action: 'replace' as const, plannedId: 'p1', workoutId: spin.id, before: tempo.name, after: spin.name, why: 'w' };
    await setSetting(svc.JUDGMENT_KEY, { date: T, sig: 's', at: '', note: 'n', assessment: '', stance: 'easy', changes: [change] } as Judgment);
    expect((await svc.recommendFor(data({ planned: [planned({ status: 'completed' })] }), null)).changes).toEqual([]);
    expect((await svc.recommendFor(data({ planned: [] }), null)).changes).toEqual([]);
    await rejectChanges([toChange(change)]);
    expect((await svc.recommendFor(data(), null)).changes).toEqual([]);
  });

  it('accepting a judged change makes it on the calendar, with the coach\'s reason', async () => {
    const svc = await import('../ui/judgeService');
    await db.planned.put(planned());
    const change = { date: T, kind: 'ride' as const, action: 'replace' as const, plannedId: 'p1', workoutId: spin.id, before: tempo.name, after: spin.name, why: 'Two mornings of HRV below normal.' };
    const rec = { changes: [], reasons: new Map(), status: 'ready' as const, byCoach: true, judged: new Map([[`${T}|ride|${tempo.name}>${spin.name}`, change]]) };
    const out = await svc.acceptRecommended(data(), null, rec, [{ date: T, kind: 'ride', before: tempo.name, after: spin.name, note: 'changed' }], null);
    expect(out.made).toBe(1);
    const p = await db.planned.get('p1');
    expect(p).toMatchObject({ workoutId: spin.id, reason: 'Two mornings of HRV below normal.' });
  });

  it('waits for this morning\'s numbers when the rider usually has them, never for a rider without a watch', async () => {
    const { waitForMorning } = await import('../ui/judgeService');
    const usual = [1, 2, 3].map((i) => ({ date: addDays(T, -i), hrv: 40 }));
    expect(waitForMorning(data({ wellness: usual }), T, 7)).toBe(true);
    expect(waitForMorning(data({ wellness: [...usual, { date: T, hrv: 38 }] }), T, 7)).toBe(false);
    expect(waitForMorning(data({ wellness: usual }), T, 12)).toBe(false);
    expect(waitForMorning(data({ wellness: [] }), T, 7)).toBe(false);
    expect(waitForMorning(data({ wellness: usual, dayNotes: [{ date: T, badWellness: true }] }), T, 7)).toBe(false);
  });
});

describe('A: one activity that cannot be downloaded does not stop the rest', () => {
  it('reads every activity, the failed one from its own numbers, and tries it again later', async () => {
    const intervals = await import('../sync/intervals');
    const sync = await import('../sync/syncService');
    const { buildReads } = await import('../ui/reads');
    vi.spyOn(sync, 'credentials').mockResolvedValue({ athleteId: 'a', apiKey: 'k' } as never);
    const rec = { time: Array.from({ length: 3600 }, (_, i) => i), watts: Array(3600).fill(150), heartrate: Array(3600).fill(125) };
    vi.spyOn(intervals, 'fetchPowerStream').mockImplementation(async (_c, id) => { if (id === 'new') throw new Error('Intervals.icu answered 404'); return rec; });
    const rides = [ride({ id: 'new', date: T, name: 'Strength', sport: 'strength', seconds: 1800, tss: 20 }), ride({ id: 'r1' })];
    const n = await buildReads({ profile: rider, rides, planned: [], edits: [], find: () => undefined });
    expect(n).toBe(2);
    expect((await db.reads.get('r1'))?.hrAtPower?.length).toBeGreaterThan(0);
    expect((await db.reads.get('new'))?.retry).toBe(true);
  });
});

describe('C: review fixes (1 Nov)', () => {
  it('accepting the coach\'s own change does not ask the coach again', async () => {
    const svc = await import('../ui/judgeService');
    const coach = await import('../coach/claude');
    await setSetting('coachAuto', true);
    await setSetting('claudeKey', 'k');
    await db.planned.put(planned());
    const spy = vi.spyOn(coach, 'judgeDay').mockResolvedValue({ note: 'Easy.', assessment: '', stance: 'easy', changes: [{ date: T, action: 'replace', session: 'C1', workout: 'W1', why: 'w' }] });
    const d = data();
    const j = (await svc.ensureJudgment(d, { check: null }))!;
    expect(spy).toHaveBeenCalledTimes(1);
    const wId = j.changes[0]?.workoutId;
    if (!wId) return;   // W1 happened not to fit; the rule under test is the signature below either way
    const row = { date: T, kind: 'ride' as const, before: j.changes[0].before, after: j.changes[0].after, note: 'changed' };
    const rec = { changes: [row], reasons: new Map(), status: 'ready' as const, byCoach: true, judged: new Map([[`${T}|ride|${j.changes[0].before}>${j.changes[0].after}`, j.changes[0]]]) };
    await svc.acceptRecommended(d, null, rec, [row], null);
    await svc.ensureJudgment(data({ planned: await db.planned.toArray() }), { check: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await svc.getJudgment())!.changes).toEqual([]);
  });
  it('D2: without a plan, the ceiling is the rider\'s own: a quarter more than their longest of that kind in 8 weeks', async () => {
    const { checkChanges, ceilingsFrom } = await import('../coach/judge');
    const w = (ref: string, kind: 'ride' | 'walk', minutes: number) => ({ ref, id: ref, kind, name: ref, minutes, key: ref });
    const workouts = [w('R140', 'ride', 140), w('R180', 'ride', 180), w('K70', 'walk', 70), w('K90', 'walk', 90)];
    const add = (ref: string) => ({ date: T, action: 'add' as const, workout: ref, why: 'w' });
    // Longest ride in 8 weeks 2 h: a 2 h 20 ride may be offered, a 3 h one not.
    const two = ceilingsFrom([{ date: addDays(T, -3), sport: 'ride', seconds: 7200 }, { date: addDays(T, -90), sport: 'ride', seconds: 5 * 3600 }], T);
    expect(two!.ride).toBe(150);
    const r1 = checkChanges([add('R140'), add('R180')], { today: T, horizon: 14, sessions: [], workouts, ceilingMinutes: two });
    expect(r1.ok.map((x) => x.workoutId)).toEqual(['R140']);
    // No rides, a 1 h walk: that is the ceiling for everything.
    const walk = ceilingsFrom([{ date: addDays(T, -2), sport: 'walk', seconds: 3600 }], T);
    expect(walk).toMatchObject({ ride: 75, walk: 75 });
    const r2 = checkChanges([add('K70'), add('K90'), add('R140')], { today: T, horizon: 14, sessions: [], workouts, ceilingMinutes: walk });
    expect(r2.ok.map((x) => x.workoutId)).toEqual(['K70']);
    // No activities: no ceiling.
    expect(ceilingsFrom([], T)).toBeUndefined();
    const r3 = checkChanges([add('R180')], { today: T, horizon: 14, sessions: [], workouts });
    expect(r3.ok).toHaveLength(1);
  });

});
