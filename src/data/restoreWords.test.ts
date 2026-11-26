import { describe, expect, it } from 'vitest';
import { ageWords, backupMade } from './restoreWords';

describe('how old a backup is, in words', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  const ago = (days: number) => new Date(now - days * 864e5).toISOString();
  it('says today, yesterday, days, months and years', () => {
    expect(ageWords(ago(0), now)).toBe('today');
    expect(ageWords(ago(1), now)).toBe('yesterday');
    expect(ageWords(ago(13), now)).toBe('13 days ago');
    expect(ageWords(ago(91), now)).toBe('about 3 months ago');
    expect(ageWords(ago(800), now)).toBe('about 2 years ago');
  });
  it('leads with the date and the age, and says so when a backup has no date', () => {
    expect(backupMade(ago(13), now)).toMatch(/^This backup was made on .+ \(13 days ago\)\.$/);
    expect(backupMade(undefined, now)).toBe('This backup does not say when it was made.');
  });
});
