import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { localDoc, mergeRemote, type SyncDoc } from './devicesync';
import { makeBackup, restoreBackup } from './backup';
import { applyPlan, ensureFindings, getPlans, putPlan, type ActivePlan } from '../ui/planService';
import { assess } from '../engine/assessment';
import { changedSince, FINDING_KEYS, findingsAsOf, findingsOf, limiterChanged, moved, pastTense, type Finding, type PlanFindings } from '../engine/findings';
import { addDays, today } from '../engine/load';
import type { Profile, Ride, Wellness } from '../engine/types';
import type { AppData } from '../ui/store';
import type { Plan } from '../engine/planner';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const profile: Profile = { name: 'Sam Example', ftp: 240, lthr: 160, maxHr: 182, restingHr: 52, weightKg: 75, basis: 'power', masters: false, units: 'metric', rideDays: [], hoursPerWeek: 6 };
const T = today();
const act = (id: string, daysAgo: number, sport: Ride['sport'], seconds: number, extra: Partial<Ride> = {}): Ride =>
  ({ id, date: addDays(T, -daysAgo), startTime: `${addDays(T, -daysAgo)}T08:00:00`, name: id, type: sport === 'ride' ? 'Ride' : 'Walk', sport, seconds, tss: Math.round(seconds / 60), ...extra } as unknown as Ride);
/** Rides on every fourth day, an hour each, back `days`; walks on the days between when asked. */
function history(days: number, walks = false): Ride[] {
  const out: Ride[] = [];
  for (let d = days; d >= 1; d--) {
    if (d % 4 === 0) out.push(act(`r${d}`, d, 'ride', 3600, { ftpAtRide: 230 }));
    else if (walks && d % 4 === 2) out.push(act(`w${d}`, d, 'walk', 3600));
  }
  return out;
}
const wellness = (days: number): Wellness[] => Array.from({ length: days }, (_, i) => ({ date: addDays(T, -days + i + 1), hrv: 55, restingHr: 50 } as Wellness));

const av = { hours: [1, 1, 1, 1, 1, 1, 1], outdoor: [false, false, false, false, false, false, false], noBike: [false, false, false, false, false, false, false], equipment: ['bodyweight'], pins: [] };
const appData = (rides: Ride[]): AppData => ({ profile, rides, ridesAll: rides, wellness: wellness(120), planned: [], mine: [], edits: [] } as unknown as AppData);
const emptyPlan = (): Plan => ({ weeks: [{ start: T, phase: 'base', label: 'Week 1', tss: 300, targetTss: 300, sessions: [] }], goalDate: addDays(T, 55), requiredCtl: 50, projection: [], verdict: 'on-track', advice: '', decisions: [], demand: { why: '' } } as unknown as Plan);

beforeEach(async () => { await db.delete(); await db.open(); });

describe('the hours line says what it counts (B2)', () => {
  it('riding, then all training in brackets', () => {
    const a = assess({ today: T, profile, rides: history(60, true), wellness: [], planned: [] });
    expect(a.weeklyHours.note).toMatch(/^About [\d.]+ hours of riding a week \([\d.]+ hours of training in all\) over the last four weeks\.$/);
    expect(a.trainingHours).toBeGreaterThan(a.weeklyHours.value);
  });
  it('said once when the two are the same', () => {
    const a = assess({ today: T, profile, rides: history(60), wellness: [], planned: [] });
    expect(a.weeklyHours.note).toMatch(/^About [\d.]+ hours of riding a week over the last four weeks\.$/);
    expect(a.weeklyHours.note).not.toContain('in all');
  });
  it('no riding at all, but other training', () => {
    const a = assess({ today: T, profile, rides: [act('w', 3, 'walk', 3600), act('w2', 10, 'walk', 3600)], wellness: [], planned: [] });
    expect(a.weeklyHours.note).toMatch(/^No rides in the last four weeks \(about [\d.]+ hours? of other training a week/);
    expect(a.weeklyHours.value).toBe(0);
  });
  it('what the plan does with riding hours is unchanged: the figure is riding only', () => {
    const a = assess({ today: T, profile, rides: history(60, true), wellness: [], planned: [] });
    const b = assess({ today: T, profile, rides: history(60), wellness: [], planned: [] });
    expect(a.weeklyHours.value).toBe(b.weeklyHours.value);
  });
  it('compliance counts every planned session, and says so', () => {
    const planned = [{ id: 'p', date: addDays(T, -3), workoutId: 'strength', basis: 'power', status: 'completed' }, { id: 'q', date: addDays(T, -5), workoutId: 'ride', basis: 'power', status: 'planned' }] as never;
    expect(assess({ today: T, profile, rides: [], wellness: [], planned }).compliance.note).toBe('1 of 2 planned sessions completed in six weeks.');
  });
});

describe('what has moved since the plan was built (B4)', () => {
  const f = (figure: Finding['figure'], confidence: Finding['confidence'] = 'good'): Finding => ({ key: 'weeklyHours', note: 'x', figure, confidence });
  it('a dot that changed has moved', () => expect(moved(f(5, 'thin'), f(5, 'good'))).toBe(true));
  it('a figure that moved by a tenth or more has moved; less has not', () => {
    expect(moved(f(5), f(5.4))).toBe(false);
    expect(moved(f(5), f(5.6))).toBe(true);
    expect(moved(f(0), f(0))).toBe(false);
    expect(moved(f([5, 8]), f([5, 9]))).toBe(true);       // all training hours moved, riding did not
    expect(moved(f('fresh'), f('stale'))).toBe(true);
  });
  it('lists only the lines that moved, with the plan\'s line', () => {
    const built = findingsOf(assess({ today: T, profile, rides: history(60), wellness: [], planned: [] }));
    const nowF = findingsOf(assess({ today: T, profile, rides: [...history(60), act('extra', 1, 'ride', 4 * 3600)], wellness: [], planned: [] }));
    const changed = changedSince(built, nowF);
    expect(changed.has('weeklyHours')).toBe(true);
    expect(changed.has('longestRide')).toBe(true);
    expect(changed.has('afterStrength')).toBe(false);
    expect(changed.get('weeklyHours')!.note).toBe(built.lines[0].note);
  });
  it('a changed first limiter is named; the same one is not', () => {
    const a: PlanFindings = { date: T, lines: [], limiters: ['base', 'threshold'] };
    expect(limiterChanged(a, { ...a, limiters: ['durability'] })).toBe('base');
    expect(limiterChanged(a, a)).toBeUndefined();
    expect(limiterChanged({ ...a, limiters: undefined }, a)).toBeUndefined();
  });
  it('reads the saved list in the past tense where the sentence allows', () => {
    expect(pastTense('Recent hard rides agree with the FTP in use; no test needed yet.')).toBe('Recent hard rides agreed with the FTP in use; no test needed yet.');
    expect(pastTense('Heart-rate drift on steady long rides averages 4.1%, a sign the aerobic base is solid.')).toBe('Heart-rate drift on steady long rides averaged 4.1%, a sign the aerobic base was solid.');
    expect(pastTense('Longest ride in eight weeks: 2h30.')).toBe('Longest ride in eight weeks: 2h30.');
  });
});

describe('findings kept with the plan (B3)', () => {
  it('saved when a plan is built, kept by a re-check, replaced when an edit rebuilds it', async () => {
    const d1 = appData(history(60));
    await applyPlan(d1, emptyPlan(), { kind: 'general', weeks: 8 } as never, av as never, false, undefined, { name: 'P', saveFindings: true });
    const [p] = await getPlans();
    expect(p.findings?.date).toBe(T);
    expect(p.findings?.lines.map((l) => l.key)).toEqual([...FINDING_KEYS]);
    expect(p.findings?.limiters?.length).toBeGreaterThan(0);
    const firstNote = p.findings!.lines[0].note;
    // The daily re-check applies changes without saving findings: the plan's stay.
    const d2 = appData([...history(60), act('big', 1, 'ride', 5 * 3600)]);
    await applyPlan(d2, emptyPlan(), p.goal, p.availability, false, new Set(), { planId: p.id });
    expect((await getPlans())[0].findings!.lines[0].note).toBe(firstNote);
    // An edit that rebuilds it saves today's.
    await applyPlan(d2, emptyPlan(), p.goal, p.availability, false, new Set(), { planId: p.id, saveFindings: true });
    expect((await getPlans())[0].findings!.lines[0].note).not.toBe(firstNote);
  });

  it('travel to the rider\'s other devices and into Back up everything', async () => {
    const findings = findingsOf(assess({ today: T, profile, rides: history(60), wellness: [], planned: [] }));
    const plan = { id: 'p1', name: 'P', goal: { kind: 'general', weeks: 8 }, availability: av, masters: false, start: addDays(T, -7), goalDate: addDays(T, 50), requiredCtl: 50, projection: [], appliedAt: new Date().toISOString(), findings } as unknown as ActivePlan;
    await db.profile.put({ id: 'me', ...profile } as never);
    await putPlan(plan);
    const note = await localDoc();
    expect(note.plans?.[0].findings).toEqual(findings);
    const file = JSON.stringify(await makeBackup());
    await db.delete(); await db.open();
    await mergeRemote({ app: 'Antogo Cycling', schema: 2, exportedAt: new Date().toISOString(), profile: undefined, settings: [], workouts: [], planned: [], tombstones: [], plans: note.plans } as SyncDoc);
    expect((await db.plans.get('p1'))?.findings).toEqual(findings);
    await db.delete(); await db.open();
    await restoreBackup(file);
    expect((await db.plans.get('p1'))?.findings).toEqual(findings);
  });
});

describe('plans built before this build (B5)', () => {
  it('worked out once from the history as it stood on the plan\'s first day, marked as worked out afterwards', async () => {
    const rides = history(200);
    const start = addDays(T, -20);
    const plan = { id: 'old', name: 'Old', goal: { kind: 'general', weeks: 8 }, availability: av, masters: false, start, goalDate: addDays(T, 30), requiredCtl: 50, projection: [], appliedAt: new Date().toISOString() } as unknown as ActivePlan;
    await putPlan(plan);
    const got = await ensureFindings(appData(rides), plan);
    expect(got.findings?.afterwards).toBe(true);
    expect(got.findings?.date).toBe(start);
    expect(got.findings?.lines.map((l) => l.key)).not.toContain('powerProfile');   // the power curve of that day is not on record
    expect(got.findings?.limiters).toBeUndefined();
    expect((await db.plans.get('old'))?.findings).toEqual(got.findings);
    // Once only: a second call changes nothing.
    const again = await ensureFindings(appData([...rides, act('new', 1, 'ride', 9000)]), got);
    expect(again.findings).toEqual(got.findings);
  });

  it('leaves out a line whose window reaches back before the history, never guesses it', () => {
    const rides = history(40);
    const day = addDays(T, -10);
    const f = findingsAsOf({ profile, rides, wellness: wellness(40), planned: [] }, day, addDays(T, -40));
    const keys = f.lines.map((l) => l.key);
    expect(keys).toContain('weeklyHours');            // four weeks before the day are on record
    expect(keys).not.toContain('longestRide');        // eight weeks are not
    expect(keys).not.toContain('rampRate');
    expect(keys).toContain('ftpStatus');               // a ride before the day carries its FTP
    // Only activities before the day count.
    expect(f.lines.find((l) => l.key === 'weeklyHours')!.figure).toEqual(findingsAsOf({ profile, rides: rides.filter((r) => r.date < day), wellness: [], planned: [] }, day, addDays(T, -40)).lines.find((l) => l.key === 'weeklyHours')!.figure);
  });
});
