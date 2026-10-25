import { describe, expect, it } from 'vitest';
import { missingText, splitToday, quickMoveDays, quickMoveLabel, syncLine, whenText } from './derived';

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

describe('the readiness panel says what the score rests on', () => {
  it('nothing missing: no sentence', () => expect(missingText({ missing: [], formOnly: false }, false)).toBeUndefined());
  it('one missing', () => expect(missingText({ missing: ['Sleep'], formOnly: false }, false)).toBe("Sleep hasn't arrived yet; the score uses the rest."));
  it('two missing', () => expect(missingText({ missing: ['HRV', 'Sleep'], formOnly: false }, false)).toBe("HRV and sleep haven't arrived yet; the score uses the rest."));
  it('all three: form alone', () => expect(missingText({ missing: ['HRV', 'Sleep', 'Resting HR'], formOnly: true }, false)).toBe("This morning's HRV, sleep and resting heart rate haven't arrived yet. This score is from form alone."));
  it('set aside by the rider', () => expect(missingText({ missing: ['HRV', 'Sleep', 'Resting HR'], formOnly: true }, true)).toBe("Today's numbers are set aside (your note). This score is from form alone."));
});

describe('how Today lays out the day', () => {
  const x = (id: string, kind: string, status = 'planned') => ({ id, p: { status }, w: { kind } });
  it('a ride and a strength session: the ride is the card', () => {
    const r = splitToday([x('a', 'ride'), x('b', 'strength')]);
    expect(r.hero?.id).toBe('a'); expect(r.rest.map((y) => y.id)).toEqual(['b']); expect(r.rideCount).toBe(1);
  });
  it('two rides and mobility: the first undone ride is the card, the other ride heads the rest', () => {
    const r = splitToday([x('a', 'ride', 'completed'), x('m', 'mobility'), x('b', 'ride')]);
    expect(r.hero?.id).toBe('b'); expect(r.rest.map((y) => y.id)).toEqual(['a', 'm']); expect(r.rideCount).toBe(2);
  });
  it('two rides, both done: the first is the card', () => {
    const r = splitToday([x('a', 'ride', 'completed'), x('b', 'ride', 'completed')]);
    expect(r.hero?.id).toBe('a'); expect(r.rest.map((y) => y.id)).toEqual(['b']);
  });
  it('no rides: no card, everything below', () => {
    const r = splitToday([x('s', 'strength'), x('w', 'walk')]);
    expect(r.hero).toBeUndefined(); expect(r.rest).toHaveLength(2); expect(r.rideCount).toBe(0);
  });
});
