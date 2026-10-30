import { describe, expect, it } from 'vitest';
import { ftpCheck } from './ftpCheck';

const T = '2026-10-29';
const base = { ftp: 225, ftpSetOn: '2026-10-01', state: {}, today: T };

describe('Today’s FTP check', () => {
  it('speaks when the rider’s efforts prove an FTP 3% or more above the setting', () => {
    expect(ftpCheck({ ...base, proven: 232 })).toEqual({ kind: 'up', estimate: 232 });
    expect(ftpCheck({ ...base, proven: 231 })).toBeUndefined();
  });
  it('never speaks for a lower FTP from riding', () => {
    expect(ftpCheck({ ...base, proven: 200 })).toBeUndefined();
  });
  it('says nothing with no trustworthy fit (an easy block)', () => {
    expect(ftpCheck({ ...base, proven: undefined })).toBeUndefined();
  });
  it('Keep quiets it until the efforts prove another 3% above what was kept', () => {
    const state = { keptEstimate: 240, keptAt: '2026-10-20' };
    expect(ftpCheck({ ...base, proven: 244, state })).toBeUndefined();
    expect(ftpCheck({ ...base, proven: 248, state })).toEqual({ kind: 'up', estimate: 248 });
  });
  it('an FTP unchanged for six weeks with no test suggests a test, not a number', () => {
    expect(ftpCheck({ ...base, ftpSetOn: '2026-09-10' })).toEqual({ kind: 'stale', setOn: '2026-09-10' });
    expect(ftpCheck({ ...base, ftpSetOn: '2026-09-25' })).toBeUndefined();
  });
  it('a recent test, or a recent dismissal, quiets the stale line; an unknown date never raises it', () => {
    expect(ftpCheck({ ...base, ftpSetOn: '2026-09-10', lastTestDate: '2026-10-20' })).toBeUndefined();
    expect(ftpCheck({ ...base, ftpSetOn: '2026-09-10', state: { staleDismissedAt: '2026-10-15' } })).toBeUndefined();
    expect(ftpCheck({ ...base, ftpSetOn: undefined })).toBeUndefined();
  });
  it('a proven rise takes precedence over the stale line', () => {
    expect(ftpCheck({ ...base, ftpSetOn: '2026-09-10', proven: 240 })?.kind).toBe('up');
  });
});
