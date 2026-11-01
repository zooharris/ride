import { describe, expect, it } from 'vitest';
import { judgeTheDay, loadSignal, type DayJudgeInput } from './dayJudge';
import { readiness } from './readiness';
import { addDays } from './load';
import type { Wellness } from './types';

const T = '2026-11-03';   // a Tuesday
const base: Wellness[] = Array.from({ length: 28 }, (_, i) => ({ date: addDays(T, -1 - i), hrv: 40 + (i % 3), restingHr: 52 + (i % 2), sleepSeconds: 7 * 3600 + (i % 4) * 600 }));
const normalMorning = readiness({ date: T, hrv: 41, restingHr: 52, sleepSeconds: 7.2 * 3600 }, base, -5);
const lowMorning = readiness({ date: T, hrv: 33, restingHr: 57, sleepSeconds: 6.5 * 3600 }, base, -5, { yesterday: { date: addDays(T, -1), hrv: 34, restingHr: 56, sleepSeconds: 6.6 * 3600 }, yesterdayBaseline: base });
/** Eight weeks of a rider riding most days around 60 TSS, with a long Saturday. */
function loads(yesterday: number): Array<{ date: string; tss: number }> {
  const out = [];
  for (let i = 2; i <= 60; i++) { const d = addDays(T, -i); const dow = new Date(d + 'T00:00:00').getDay(); out.push({ date: d, tss: dow === 6 ? 140 : dow === 5 ? 0 : 55 + (i % 3) * 5 }); }
  out.push({ date: addDays(T, -1), tss: yesterday });
  return out;
}
const tempo = { id: 'p1', date: T, kind: 'ride' as const, name: 'Floris (Tempo Hour)', family: 'tempo', minutes: 60, done: false, handPlaced: false };
const rides = [
  { id: 'end-60', name: 'Endurance 60', family: 'endurance', minutes: 60 },
  { id: 'rec-45', name: 'Easy spin 45', family: 'recovery', minutes: 45 },
  { id: 'rec-30', name: 'Easy spin 30', family: 'recovery', minutes: 30 },
  { id: 'open-30', name: 'Openers', family: 'recovery', minutes: 30 },
];
const input = (over: Partial<DayJudgeInput> = {}): DayJudgeInput => ({
  date: T, readiness: normalMorning, setAside: false, loads: loads(60), week: [tempo],
  hours: [3, 1, 1.5, 1, 1.5, 0, 4], rideAllowed: (d) => new Date(d + 'T00:00:00').getDay() !== 5, rides, ...over,
});

describe('E: the app\'s own day judge, every signal against the rider\'s own normal', () => {
  it('a normal morning after a day in the middle of the rider\'s own loads: as planned, no changes', () => {
    const j = judgeTheDay(input());
    expect(j.stance).toBe('as planned');
    expect(j.changes).toEqual([]);
  });
  it('two mornings of HRV below normal after a day at the top of the rider\'s loads: easy, and the tempo moves to the next free day', () => {
    const j = judgeTheDay(input({ readiness: lowMorning, loads: loads(230) }));
    expect(j.stance === 'easy' || j.stance === 'rest').toBe(true);
    const move = j.changes.find((c) => c.action === 'move');
    expect(move).toMatchObject({ plannedId: 'p1', toDate: '2026-11-04' });   // Wednesday: the next day with a ride allowed and the hours
    if (j.stance === 'easy') expect(j.changes.find((c) => c.action === 'add')?.workoutId).toBe('rec-45');   // the longest easy spin that fits Tuesday's hour and a half, never the openers
    expect(move!.why).toMatch(/hrv/i);
  });
  it('a set-aside morning: judged on load and performance only', () => {
    const j = judgeTheDay(input({ readiness: lowMorning, setAside: true }));
    const noMorning = judgeTheDay(input({ readiness: { ...lowMorning, formOnly: true } }));
    expect(j.score).toBe(noMorning.score);
    expect(j.reasons.join(' ')).not.toMatch(/this morning/);
    expect(judgeTheDay(input({ readiness: lowMorning })).score).toBeLessThan(j.score);   // the low morning counts when it is not set aside
  });
  it('a ride cut short with everything else normal: as planned (duration is not a signal)', () => {
    // Yesterday's ride was planned for 60 TSS and ended at 20: a light day, never a reason to ease off.
    const j = judgeTheDay(input({ loads: loads(20) }));
    expect(j.stance).toBe('as planned');
  });
  it('no overnight data: performance and load, and the rider\'s own morning-after evidence for the kind of day', () => {
    const formOnly = { ...readiness(undefined, [], -5), formOnly: true };
    const j = judgeTheDay(input({ readiness: formOnly, loads: loads(230), yesterdayKind: 'long', morningAfterCost: 0.3, performance: { hrVsNormal: { beats: 7, spread: 3 } } }));
    expect(j.stance).not.toBe('as planned');
    expect(j.reasons.join(' ')).toMatch(/mornings after a long ride usually dip/);
    expect(j.reasons.join(' ')).toMatch(/7 bpm above your usual/);
  });
  it('a lighter day takes the ride one family down, of similar length', () => {
    const j = judgeTheDay(input({ readiness: { ...normalMorning, score: 55 }, loads: loads(60) }));
    if (j.stance !== 'lighter') return;
    expect(j.changes).toEqual([expect.objectContaining({ action: 'replace', plannedId: 'p1', workoutId: 'end-60' })]);
  });
  it('the load signal is the rider\'s own: the same 230 TSS is ordinary for a rider whose days are like it', () => {
    const big = loadSignal(loads(230), T)!;
    expect(big.z).toBeLessThan(-1);
    const heavy = Array.from({ length: 60 }, (_, i) => ({ date: addDays(T, -1 - i), tss: 220 + (i % 5) * 10 }));
    expect(loadSignal(heavy, T)!.z).toBeGreaterThan(-1);
  });
});
