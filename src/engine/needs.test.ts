import { describe, expect, it } from 'vitest';
import { planNeeds, type NeedsInput } from './needs';
import { demand, type Goal } from './goals';
import { normalizeAvailability, phaseSequence } from './planner';
import { availabilityOf, EQUIPMENT_SETS, riderAssessment } from './sweep';
import type { Assessment } from './assessment';
import type { Profile } from './types';

const profile: Profile = { name: 'S', ftp: 230, lthr: 158, maxHr: 178, restingHr: 52, weightKg: 82, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const START = '2026-11-02';

function needsFor(goal: Goal, weeks: number, opts: { a?: Assessment; hours?: number; masters?: boolean } = {}) {
  const a = opts.a ?? riderAssessment('masters');
  const av = normalizeAvailability(availabilityOf(opts.hours ?? 8, 5, EQUIPMENT_SETS['dumbbells+bench'], { walk: false, run: false }));
  const d = demand(goal, profile, a);
  const masters = opts.masters ?? true;
  const { seq } = phaseSequence(weeks, d, a, goal, masters);
  const slots = [0, 1, 2, 3, 4, 5, 6].filter((i) => av.hours[i] > 0);
  const inp: NeedsInput = { goal, demand: d, assessment: a, availability: av, seq, masters, start: START, pastWeeks: 0, awayDays: seq.map(() => 0),
    capMinutes: slots.reduce((s, i) => s + av.hours[i] * 60, 0), rideDays: slots.length, bigSlots: slots.map((i) => av.hours[i] * 60).sort((x, y) => y - x), daysWithTime: slots.length, footMinutes: 0 };
  return { ...planNeeds(inp), seq };
}
const quality = (m: Record<string, number>) => m.tempo + m.sweetspot + m.threshold + m.vo2 + m.anaerobic;
const event = (eventType: Extract<Goal, { kind: 'event' }>['eventType'], weeks: number): Goal => ({ kind: 'event', name: 'E', eventType, priority: 'A', date: new Date(Date.parse(START) + (weeks * 7 + 5) * 864e5).toISOString().slice(0, 10) });

describe('the plan engine: what each week needs', () => {
  it('raise FTP: sweet spot and threshold climb to the destination; VO2 arrives only in the last third', () => {
    const { weeks, seq } = needsFor({ kind: 'ftp', weeks: 12, targetWatts: 260 }, 12);
    const loading = weeks.filter((w) => ['base', 'build', 'peak'].includes(w.label));
    const first = loading[0], last = loading[loading.length - 1];
    expect(first.minutes.threshold).toBeLessThan(last.minutes.threshold);
    expect(first.minutes.vo2).toBe(0);
    expect(last.minutes.vo2).toBeGreaterThan(0);
    expect(loading.filter((w) => w.loadingProgress < 0.6).every((w) => w.minutes.vo2 === 0)).toBe(true);
    expect(seq.includes('taper')).toBe(false);
    expect(last.strength.quality).toBe('heavy');
  });

  it('a century: the long ride grows toward its share of the event, tempo and sweet spot lead, strength moves heavy → power → endurance', () => {
    const { weeks } = needsFor(event('century', 16), 16, { hours: 14 });
    const loading = weeks.filter((w) => ['base', 'build', 'peak'].includes(w.label));
    expect(loading[0].longRideSeconds).toBeLessThan(loading[loading.length - 1].longRideSeconds);
    const last = loading[loading.length - 1];
    expect(last.minutes.tempo + last.minutes.sweetspot).toBeGreaterThan(last.minutes.threshold + last.minutes.vo2);
    expect(loading[0].strength.quality).toBe('heavy');
    expect(loading[Math.floor(loading.length / 2)].strength.quality).toBe('power');
    expect(last.strength.quality).toBe('endurance');
    const taper = weeks.filter((w) => w.label === 'taper');
    expect(taper.length).toBeGreaterThan(0);
    expect(taper[taper.length - 1].openers).toBe(true);
    for (const t of taper) expect(t.budgetTss).toBeLessThan(last.budgetTss);
  });

  it('recovery weeks: about 60% of the load, little quality, light strength, an extra rest day', () => {
    const { weeks } = needsFor(event('gran-fondo', 12), 12);
    const rec = weeks.find((w) => w.label === 'recovery')!;
    const before = weeks[rec.index - 1];
    expect(rec.budgetTss / before.budgetTss).toBeCloseTo(0.6, 1);
    expect(quality(rec.minutes)).toBeLessThan(quality(before.minutes) * 0.5);
    expect(rec.strength.dose).toBe('light');
    expect(rec.restDays).toBe(before.restDays + 1);
  });

  it('lose weight: no taper, strength twice a week at Build dose through the loading weeks, tempo not threshold', () => {
    const noLimiter: Assessment = { ...riderAssessment('masters'), limiters: ['base'] };
    const { weeks, seq } = needsFor({ kind: 'weight', weeks: 10 }, 10, { a: noLimiter });
    expect(seq.includes('taper')).toBe(false);
    const loading = weeks.filter((w) => ['base', 'build', 'peak'].includes(w.label));
    for (const w of loading.filter((x) => x.index >= 4)) { expect(w.strength.count).toBe(2); expect(w.strength.dose).toBe('build'); }
    expect(weeks.every((w) => w.minutes.threshold === 0 && w.minutes.vo2 === 0)).toBe(true);
  });

  it('raise VO2max: three weeks of base tune-up, then VO2 work most of the block', () => {
    const { weeks } = needsFor({ kind: 'vo2max', weeks: 10 }, 10);
    const loading = weeks.filter((w) => ['base', 'build', 'peak'].includes(w.label));
    expect(loading.slice(0, 3).every((w) => w.minutes.vo2 <= 5)).toBe(true);
    expect(loading.slice(3).every((w) => w.minutes.vo2 >= 15)).toBe(true);
    expect(loading.every((w) => w.strength.quality === 'power')).toBe(true);
  });

  it('the limiter the data flag gets a quarter more of its ability', () => {
    const base = riderAssessment('masters');
    const goal: Goal = { kind: 'ftp', weeks: 10, targetWatts: 260 };
    const plain = needsFor(goal, 10, { a: { ...base, limiters: ['base'] } }).weeks;
    const limited = needsFor(goal, 10, { a: { ...base, limiters: ['threshold'] } }).weeks;
    const i = plain.findIndex((w) => w.minutes.threshold >= 20 && quality(w.minutes) < 100);
    expect(limited[i].minutes.threshold).toBeGreaterThan(plain[i].minutes.threshold);
  });

  it('never more quality than the hours can carry, and fewer hard days when there are few ride days', () => {
    const { weeks } = needsFor({ kind: 'ftp', weeks: 10, targetWatts: 260 }, 10, { hours: 4 });
    for (const w of weeks) expect(quality(w.minutes)).toBeLessThanOrEqual(Math.max(25, w.budgetHours * 60 * 0.22) + 8);
    expect(weeks.every((w) => w.hardSessions <= 3)).toBe(true);
  });

  it('a beginner starts gently: lower budget and less quality than a fit rider in week 1', () => {
    const goal: Goal = { kind: 'general', weeks: 8 };
    const b = needsFor(goal, 8, { a: riderAssessment('beginner') }).weeks[0];
    const m = needsFor(goal, 8, { a: riderAssessment('masters') }).weeks[0];
    expect(b.budgetTss).toBeLessThan(m.budgetTss);
    expect(b.longRideSeconds).toBeLessThanOrEqual(m.longRideSeconds);
  });
});
