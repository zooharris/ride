import { describe, expect, it } from 'vitest';
import { quickMoveDays, quickMoveLabel, syncLine, whenText } from './derived';

describe('quick moves', () => {
  it("moving today's session offers tomorrow onward, never today", () => {
    expect(quickMoveDays('2026-10-20', 6, '2026-10-20')).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  });
  it('a later session can be pulled to today, and its own day is left out', () => {
    expect(quickMoveDays('2026-10-22', 6, '2026-10-20')).toEqual(['2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  });
  it('a missed session offers today onward', () => {
    expect(quickMoveDays('2026-10-18', 3, '2026-10-20')).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });
  it('crosses months and labels the days', () => {
    expect(quickMoveDays('2026-10-31', 2, '2026-10-31')).toEqual(['2026-11-01', '2026-11-02']);
    expect(quickMoveLabel('2026-10-20', '2026-10-20')).toBe('Today');
    expect(quickMoveLabel('2026-10-21', '2026-10-20')).toBe('Tomorrow');
    expect(quickMoveLabel('2026-10-22', '2026-10-20')).toBe('Thu 22');
  });
});

describe('when this device last pulled', () => {
  const now = new Date(2026, 9, 25, 11, 30);   // Sun 25 Oct, 11:30 local
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString();
  it('today as a time, yesterday with its time, older as a date, never as nothing', () => {
    expect(whenText(at(25, 10, 47), now)).toBe('10:47');
    expect(whenText(at(24, 18, 2), now)).toBe('yesterday 18:02');
    expect(whenText(at(21, 9, 0), now)).toBe('Wed 21 Oct');
    expect(whenText(undefined, now)).toBeUndefined();
  });
  it('the line under Sync', () => {
    expect(syncLine({ running: true, last: at(25, 10, 47) }, now)).toEqual({ text: 'Syncing…', failed: false });
    expect(syncLine({ running: false }, now)).toEqual({ text: 'Not synced yet', failed: false });
    expect(syncLine({ running: false, last: at(25, 10, 47) }, now)).toEqual({ text: 'Last synced 10:47', failed: false });
    expect(syncLine({ running: false, last: at(25, 10, 47), errorAt: at(25, 11, 20) }, now)).toEqual({ text: 'Last synced 10:47 · the latest attempt failed', failed: true });
    // a failure before the last success is history
    expect(syncLine({ running: false, last: at(25, 10, 47), errorAt: at(25, 9, 0) }, now).failed).toBe(false);
  });
});
