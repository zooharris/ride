import { describe, expect, it } from 'vitest';
import { quickMoveDays, quickMoveLabel } from './derived';

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
