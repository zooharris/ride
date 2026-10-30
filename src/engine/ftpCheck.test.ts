import { describe, expect, it } from 'vitest';
import { ftpCheck as check, type FtpCheck } from './ftpCheck';
const ftpCheck = (o: Parameters<typeof check>[0]) => check(o) as (FtpCheck & { reason?: string }) | undefined;

const T = '2026-10-29';
const base = { ftp: 225, ftpSetOn: '2026-10-01', everTested: true, lastTestDate: '2026-10-01', state: {}, today: T };

describe('message one: "Antogo estimates your FTP is now X"', () => {
  it('when the best efforts point 3% or more above the setting', () => {
    expect(ftpCheck({ ...base, estimate: 232 })).toEqual({ kind: 'up', estimate: 232 });
    expect(ftpCheck({ ...base, estimate: 231 })).toBeUndefined();
  });
  it('never lower', () => { expect(ftpCheck({ ...base, estimate: 200 })).toBeUndefined(); });
  it('not when recent hard sessions fell short; allowed when there were none', () => {
    expect(ftpCheck({ ...base, estimate: 240, signs: { sessionsOk: false } })).toBeUndefined();
    expect(ftpCheck({ ...base, estimate: 240, signs: {} })?.kind).toBe('up');
  });
  it('Keep quiets it until the estimate rises another 3%', () => {
    const state = { keptEstimate: 240, keptAt: '2026-10-20' };
    expect(ftpCheck({ ...base, estimate: 244, state })).toBeUndefined();
    expect(ftpCheck({ ...base, estimate: 248, state })).toEqual({ kind: 'up', estimate: 248 });
  });
  it('wins over the test reminder', () => {
    expect(ftpCheck({ ...base, ftpSetOn: '2026-06-01', lastTestDate: undefined, everTested: false, estimate: 240 })?.kind).toBe('up');
  });
});

describe('message two: "Time for a ramp test?"', () => {
  it('stale: FTP unchanged twelve weeks with no test in that time', () => {
    expect(ftpCheck({ ...base, ftpSetOn: '2026-08-01', lastTestDate: '2026-07-01' })).toEqual({ kind: 'test', setOn: '2026-08-01', reason: 'stale' });
    expect(ftpCheck({ ...base, ftpSetOn: '2026-08-10', lastTestDate: '2026-07-01' })).toBeUndefined();
    expect(ftpCheck({ ...base, ftpSetOn: '2026-08-01', lastTestDate: '2026-09-01' })).toBeUndefined();
  });
  it('untested: never tested and six weeks old', () => {
    expect(ftpCheck({ ...base, everTested: false, lastTestDate: undefined, ftpSetOn: '2026-09-15' })?.reason).toBe('untested');
    expect(ftpCheck({ ...base, everTested: false, lastTestDate: undefined, ftpSetOn: '2026-09-20' })).toBeUndefined();
  });
  it('signs: two of three agree (sessions off, steady power dropped, never tested)', () => {
    expect(ftpCheck({ ...base, signs: { sessionsOff: true, steadyDropped: true } })?.reason).toBe('signs');
    expect(ftpCheck({ ...base, everTested: false, lastTestDate: undefined, signs: { sessionsOff: true } })?.reason).toBe('signs');
    expect(ftpCheck({ ...base, signs: { sessionsOff: true } })).toBeUndefined();
    expect(ftpCheck({ ...base, signs: { steadyDropped: true } })).toBeUndefined();
  });
  it('easy weeks say nothing', () => { expect(ftpCheck({ ...base, signs: {} })).toBeUndefined(); });
  it('no date known: the date reasons never fire; signs still can', () => {
    expect(ftpCheck({ ...base, ftpSetOn: undefined, everTested: false, lastTestDate: undefined })).toBeUndefined();
    expect(ftpCheck({ ...base, ftpSetOn: undefined, signs: { sessionsOff: true, steadyDropped: true } })).toEqual({ kind: 'test', setOn: undefined, reason: 'signs' });
  });
});

describe('Not now', () => {
  const stale = { ...base, ftpSetOn: '2026-08-01', lastTestDate: '2026-07-01' };
  it('a month when the reason is only the date', () => {
    expect(ftpCheck({ ...stale, state: { notNowAt: '2026-10-05' } })).toBeUndefined();
    expect(ftpCheck({ ...stale, state: { notNowAt: '2026-10-01' } })?.kind).toBe('test');
  });
  it('two weeks when the riding shows signs, even after a Not now on the date', () => {
    const signs = { sessionsOff: true, steadyDropped: true };
    expect(ftpCheck({ ...stale, signs, state: { notNowAt: '2026-10-20' } })).toBeUndefined();
    expect(ftpCheck({ ...stale, signs, state: { notNowAt: '2026-10-15' } })?.reason).toBe('signs');
  });
  it('an older dismissal counts as Not now', () => {
    expect(ftpCheck({ ...stale, state: { staleDismissedAt: '2026-10-20' } })).toBeUndefined();
  });
  it('a test ridden since clears the silence', () => {
    const signs = { sessionsOff: true, steadyDropped: true };
    expect(ftpCheck({ ...base, signs, lastTestDate: '2026-10-25', state: { notNowAt: '2026-10-20' } })?.reason).toBe('signs');
  });
});
