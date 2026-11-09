import { describe, expect, it } from 'vitest';
import { checkChanges, judgeSig, plainWords, readJudge, toChange, type CheckContext, type JudgedChange } from './judge';
import { buildPacket, type PacketInput } from './packet';
import type { Availability } from '../engine/planner';

const T = '2026-11-02';   // a Monday
// Mon 1 h, Tue 1.5 h indoors, Wed none, Thu 1 h, Fri 1 h no bike, Sat 4 h, Sun 2 h.
const av: Availability = {
  hours: [2, 1, 1.5, 0, 1, 1, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, true, false],
  equipment: ['bodyweight', 'dumbbells'], pins: [], never: [{ dow: 4, kind: 'strength' }], may: { strength: true, mobility: true, walk: true, run: false },
};
const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  today: T, horizon: 14, availability: av, away: [{ from: '2026-11-12', to: '2026-11-13' }],
  sessions: [
    { ref: 'C1', id: 'p1', date: T, kind: 'ride', name: 'Tempo 60', minutes: 60, done: false, handPlaced: false, workoutKey: 'tempo-60' },
    { ref: 'C2', id: 'p2', date: '2026-11-03', kind: 'strength', name: 'Heavy legs', minutes: 45, done: false, handPlaced: true, workoutKey: 'str-1' },
    { ref: 'C3', id: 'p3', date: '2026-11-01', kind: 'ride', name: 'Long', minutes: 180, done: true, handPlaced: false, workoutKey: 'long' },
    { ref: 'C4', id: 'p4', date: '2026-11-07', kind: 'ride', name: 'Long 3 h', minutes: 180, done: false, handPlaced: false, workoutKey: 'long-180' },
  ],
  workouts: [
    { ref: 'W1', id: 'rec-30', kind: 'ride', name: 'Easy spin 30', minutes: 30, key: 'rec-30' },
    { ref: 'W2', id: 'end-120', kind: 'ride', name: 'Endurance 2 h', minutes: 120, key: 'end-120' },
    { ref: 'W3', id: 'run-30', kind: 'run', name: 'Easy run', minutes: 30, key: 'run-30' },
    { ref: 'W4', id: 'str-1', kind: 'strength', name: 'Heavy legs', minutes: 45, key: 'str-1' },
    { ref: 'W5', id: 'tempo-60', kind: 'ride', name: 'Tempo 60', minutes: 60, key: 'tempo-60' },
  ],
  ...over,
});
const c = (x: Partial<JudgedChange>): JudgedChange => ({ date: T, action: 'replace', why: 'w', ...x });

describe('C: the app holds the rider\'s lines', () => {
  it('a replace that fits is kept and resolved', () => {
    const { ok, dropped } = checkChanges([c({ session: 'C1', workout: 'W1', why: 'HRV two mornings below normal' })], ctx());
    expect(dropped).toEqual([]);
    expect(ok).toEqual([{ date: T, kind: 'ride', action: 'replace', plannedId: 'p1', workoutId: 'rec-30', before: 'Tempo 60', after: 'Easy spin 30', why: 'HRV two mornings below normal' }]);
  });
  it('drops each change that breaks a rule, with its reason', () => {
    const { ok, dropped } = checkChanges([
      c({ date: '2026-10-30', session: 'C1', workout: 'W1' }),                 // in the past
      c({ date: '2026-11-20', action: 'add', workout: 'W1' }),                 // beyond two weeks
      c({ session: 'C9', workout: 'W1' }),                                     // no such entry
      c({ date: '2026-11-03', session: 'C1', workout: 'W1' }),                 // the entry is on another date
      c({ session: 'C1', workout: 'W2' }),                                     // 2 h on a 1 h Monday
      c({ action: 'add', workout: 'W3' }),                                     // runs are switched off
      c({ date: '2026-11-05', action: 'add', workout: 'W4' }),                 // never strength on Thursday
      c({ date: '2026-11-06', action: 'add', workout: 'W1' }),                 // no bike on Friday
      c({ date: '2026-11-04', action: 'add', workout: 'W1' }),                 // no time on Wednesday
      c({ date: '2026-11-12', action: 'add', workout: 'W1' }),                 // away
      c({ session: 'C1', workout: 'W9' }),                                     // no such workout
      c({ date: '2026-11-07', action: 'add', workout: 'W5' }),                 // fine on its own...
    ], ctx());
    expect(dropped.map((d) => d.why)).toEqual([
      'date outside today to two weeks ahead', 'date outside today to two weeks ahead', 'no such calendar entry', 'the calendar entry is on another date',
      'does not fit the hours that day', 'run is switched off for the plan', 'never strength on that day', 'no bike that day', 'no time that day', 'the rider is away that day', 'no such Library workout',
    ]);
    expect(ok).toHaveLength(1);
  });
  it('an add may not duplicate what is on the day, and a done session cannot be changed', () => {
    const { dropped } = checkChanges([c({ date: '2026-11-03', action: 'add', workout: 'W4' }), c({ date: '2026-11-01', session: 'C3', action: 'remove' })], ctx({ today: '2026-11-01' }));
    expect(dropped.map((d) => d.why)).toEqual(['already on that day', 'the session is already done']);
  });
  it('a move must land on a permitted day with room; it is shown on the day it lands, "moves here from"', () => {
    const bad = checkChanges([c({ action: 'move', session: 'C1', toDate: '2026-11-04' })], ctx());
    expect(bad.dropped[0].why).toBe('no time that day');
    const { ok } = checkChanges([c({ action: 'move', session: 'C1', toDate: '2026-11-05', why: 'keep the tempo, two days later' })], ctx());
    expect(ok[0]).toMatchObject({ action: 'move', plannedId: 'p1', toDate: '2026-11-05' });
    expect(toChange(ok[0])).toEqual({ kind: 'ride', date: '2026-11-05', before: 'Tempo 60', after: 'Tempo 60', note: 'moved', movedFrom: T });
  });
  it('a hand-placed session can be changed, and is marked so it is offered, never pre-selected', () => {
    const { ok } = checkChanges([c({ date: '2026-11-03', action: 'remove', session: 'C2' })], ctx());
    expect(ok[0].handPlaced).toBe(true);
    expect(toChange(ok[0]).userEdited).toBe(true);
  });
  it('one change per calendar entry', () => {
    const { ok, dropped } = checkChanges([c({ session: 'C1', workout: 'W1' }), c({ session: 'C1', action: 'remove' })], ctx());
    expect(ok).toHaveLength(1);
    expect(dropped[0].why).toBe('the entry already has a change');
  });
});

describe('C: reading the reply', () => {
  it('reads a judgment, and says why it cannot', () => {
    const r = readJudge({ content: [{ type: 'text', text: JSON.stringify({ note: 'Easy today.', assessment: 'Tired.', stance: 'Easy', changes: [{ date: T, action: 'replace', session: 'C1', workout: 'W1', toDate: '', why: 'w' }] }) }] });
    expect(r).toMatchObject({ note: 'Easy today.', stance: 'easy', changes: [{ date: T, action: 'replace', session: 'C1', workout: 'W1', why: 'w' }] });
    expect('failed' in readJudge({ content: [{ type: 'text', text: 'not json' }] })).toBe(true);
    expect(readJudge({ content: [], stop_reason: 'max_tokens' })).toEqual({ failed: 'the reply was cut off before it finished' });
    expect('failed' in readJudge({ content: [{ type: 'text', text: '{"note":"","changes":[]}' }] })).toBe(true);
  });
  it('no cryptic refs reach the rider: a parenthetical of refs is dropped, a bare ref becomes the name', () => {
    const names = new Map([['C1', 'Morning Mobility'], ['C2', 'Elden Street Spin'], ['C5', 'Elden Street Spin'], ['W3', 'Sugarland Run']]);
    expect(plainWords('The only thing left is C1, the 12-minute mobility session.', names)).toBe('The only thing left is Morning Mobility, the 12-minute mobility session.');
    expect(plainWords('The Monday and Wednesday Elden Street spins (C2, C5) recover time.', names)).toBe('The Monday and Wednesday Elden Street spins recover time.');
    expect(plainWords('Ride W3 instead.', names)).toBe('Ride Sugarland Run instead.');
    expect(plainWords('Vitamin C3 is not a ref we know; it stays.', names)).toBe('Vitamin C3 is not a ref we know; it stays.');
    expect(plainWords('Plain words stay exactly as they are (even in brackets).', names)).toBe('Plain words stay exactly as they are (even in brackets).');
  });
});

describe('C: asked again only when what it is made from changes', () => {
  const base = { date: T, wellnessDate: T, activities: ['a:50:ride', 'b:30:walk'], calendar: ['p1:w:2026-11-02:planned'], notes: [] as string[] };
  it('the same parts, in any order: the same signature', () => {
    expect(judgeSig(base)).toBe(judgeSig({ ...base, activities: ['b:30:walk', 'a:50:ride'] }));
  });
  it('each trigger changes it', () => {
    const s = judgeSig(base);
    expect(judgeSig({ ...base, date: '2026-11-03' })).not.toBe(s);
    expect(judgeSig({ ...base, wellnessDate: '2026-11-01' })).not.toBe(s);
    expect(judgeSig({ ...base, activities: [...base.activities, 'c:80:ride'] })).not.toBe(s);
    expect(judgeSig({ ...base, calendar: ['p1:w:2026-11-03:planned'] })).not.toBe(s);
    expect(judgeSig({ ...base, notes: ['2026-11-02: legs heavy'] })).not.toBe(s);
  });
});

describe('B: the evidence packet', () => {
  const input = (opts = 30): PacketInput => ({
    date: T, rider: ['The rider is a road cyclist.'], morning: ['Readiness 48/100 (easy).'], notes: ['2026-11-01: legs heavy'],
    activities: [
      { date: '2026-11-01', name: 'Long ride', planned: true, words: ['3 h 40 min ride: heart rate drifted up 9%.'] },
      { date: '2026-10-25', name: 'Walk', planned: false, words: ['40 min walk.'] },
    ],
    week: ['Nothing done yet this week before today.'],
    calendar: [{ ref: 'C1', date: T, kind: 'ride', name: 'Tempo 60', minutes: 60, tss: 60, status: 'to do', handPlaced: true }],
    plan: [], params: ['Monday: 1 h available, rides indoors.'],
    days: [{ date: T, header: 'Monday 2 November: 1 h available; may hold ride.' }],
    catalogue: [{ label: 'ride · recovery', items: Array.from({ length: opts }, (_, i) => ({ ref: `W${i + 1}`, name: `Spin ${i}`, kind: 'ride' as const, minutes: 20 + i, tss: 10 })) }],
    appView: [],
  });
  it('labels every section, names refs, and reads unplanned activities like planned ones', () => {
    const p = buildPacket(input());
    for (const h of ['## 1. The rider', '## 2. This morning', "## 3. The rider's notes", '## 4. Recent activities, last 14 days', '## 5.', '## 6.', '## 7. The plan', '## 8.', '## 9.', '## 10.']) expect(p).toContain(h);
    expect(p).toContain('2026-10-25 · Walk · not on the plan · 40 min walk.');
    expect(p).toContain('C1 · 2026-11-02 · ride · Tempo 60 · 60 min · planned load 60 TSS · to do · placed or changed by the rider by hand');
    expect(p).toContain('no plan in force');
    expect(p).toContain('W1 Spin 0 (20 min, 10 TSS)');
    expect(p).toContain('W30 Spin 29');   // spread across lengths: the shortest and the longest
    expect(p.match(/Spin \d+/g)).toHaveLength(8);   // eight options per group at most
  });
  it('over budget: Library options trimmed first, then activities to 7 days', () => {
    const tight = buildPacket(input(), 260);
    expect(tight.match(/Spin \d+/g)!.length).toBeLessThan(8);
    expect(tight).toContain('2026-10-25 · Walk');
    const tighter = buildPacket(input(), 235);
    expect(tighter).toContain('last 7 days');
    expect(tighter).not.toContain('2026-10-25 · Walk');
  });
});
