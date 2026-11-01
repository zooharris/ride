import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { cachedStreamsUsable, FIRST_BREATHING_KEY, noteBreathingDate } from './breathRead';
import { getSetting, setSetting } from '../data/db';

const none = { v: 3, ve: undefined };
const withBreath = { v: 3, ve: [30, 31, 32] };

describe('2D: a cached ride read again once for breathing', () => {
  it('the current version is always used', () => {
    expect(cachedStreamsUsable({ v: 4 }, { playerBreathing: false, date: '2026-10-31', firstBreathingDate: '2026-10-31' })).toBe(true);
  });
  it('before any ride had breathing, nothing is read again', () => {
    expect(cachedStreamsUsable(none, { playerBreathing: false, date: '2026-10-31' })).toBe(true);
  });
  it('rides before the first breathing day are not read again', () => {
    expect(cachedStreamsUsable(none, { playerBreathing: false, date: '2026-10-20', firstBreathingDate: '2026-10-31' })).toBe(true);
  });
  it('a ride on or after it, cached without breathing, is read again once', () => {
    expect(cachedStreamsUsable(none, { playerBreathing: false, date: '2026-10-31', firstBreathingDate: '2026-10-31' })).toBe(false);
    expect(cachedStreamsUsable({ v: 2 }, { playerBreathing: false, date: '2026-11-02', firstBreathingDate: '2026-10-31' })).toBe(false);
  });
  it('a set that already has breathing is kept', () => {
    expect(cachedStreamsUsable(withBreath, { playerBreathing: true, date: '2026-11-02', firstBreathingDate: '2026-10-31' })).toBe(true);
  });
  it('a player ride with a strap cached before breathing was read (v2) is read again', () => {
    expect(cachedStreamsUsable({ v: 2 }, { playerBreathing: true, date: '2026-10-20' })).toBe(false);
  });
  it('the earliest breathing day is kept', async () => {
    await setSetting(FIRST_BREATHING_KEY, undefined);
    await noteBreathingDate('2026-11-02');
    await noteBreathingDate('2026-10-31');
    await noteBreathingDate('2026-11-05');
    expect(await getSetting(FIRST_BREATHING_KEY, '')).toBe('2026-10-31');
  });
});
