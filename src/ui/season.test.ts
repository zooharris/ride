import { describe, expect, it } from 'vitest';
import { activeSeason, contrast, guessHemisphere, mix, seasonFor, seasonVars, SEASONS, SEASON_COLOURS, SURFACES } from './season';

const d = (s: string) => new Date(s + 'T00:00:00');

describe('which season', () => {
  it('switches on the first of March, June, September and December in the north', () => {
    expect(seasonFor(d('2026-02-28'), 'north')).toBe('winter');
    expect(seasonFor(d('2026-03-01'), 'north')).toBe('spring');
    expect(seasonFor(d('2026-05-31'), 'north')).toBe('spring');
    expect(seasonFor(d('2026-06-01'), 'north')).toBe('summer');
    expect(seasonFor(d('2026-08-31'), 'north')).toBe('summer');
    expect(seasonFor(d('2026-09-01'), 'north')).toBe('autumn');
    expect(seasonFor(d('2026-11-30'), 'north')).toBe('autumn');
    expect(seasonFor(d('2026-12-01'), 'north')).toBe('winter');
    expect(seasonFor(d('2027-01-15'), 'north')).toBe('winter');
  });
  it('runs the other way round in the south', () => {
    expect(seasonFor(d('2026-03-01'), 'south')).toBe('autumn');
    expect(seasonFor(d('2026-06-01'), 'south')).toBe('winter');
    expect(seasonFor(d('2026-09-01'), 'south')).toBe('spring');
    expect(seasonFor(d('2026-12-01'), 'south')).toBe('summer');
    expect(seasonFor(d('2026-11-30'), 'south')).toBe('spring');
  });
  it('a chosen season stays all year', () => {
    for (const s of SEASONS) {
      expect(activeSeason(s, 'north', d('2026-01-10'))).toBe(s);
      expect(activeSeason(s, 'south', d('2026-07-10'))).toBe(s);
    }
    expect(activeSeason('auto', 'north', d('2026-07-10'))).toBe('summer');
  });
});

describe('hemisphere from the time zone', () => {
  it('northern zones', () => {
    for (const z of ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles', 'Africa/Lagos', 'Asia/Singapore', 'Pacific/Honolulu', 'UTC']) expect(guessHemisphere(z)).toBe('north');
  });
  it('southern zones', () => {
    for (const z of ['Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Santiago', 'Africa/Johannesburg', 'Asia/Jakarta', 'Indian/Mauritius']) expect(guessHemisphere(z)).toBe('south');
  });
  it('an unknown or missing zone is taken as northern', () => {
    expect(guessHemisphere(undefined)).toBe('north');
    expect(guessHemisphere('Nowhere/Else')).toBe('north');
  });
});

describe('every season reads, by day and by night', () => {
  for (const season of SEASONS) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${season}, ${mode === 'light' ? 'day' : 'night'}`, () => {
        const v = seasonVars(season, mode);
        const S = SURFACES[mode];
        const surfaces = [S.panel, S.sub, v['--bg']];
        for (const b of surfaces) {
          expect(contrast(v['--accent'], b)).toBeGreaterThanOrEqual(4.5);    // links and focus
          expect(contrast(v['--today'], b)).toBeGreaterThanOrEqual(4.5);     // today is text
          for (const k of ['--info', '--fat', '--aqua']) expect(contrast(v[k], b)).toBeGreaterThanOrEqual(3);   // lines and marks
          // the fixed text colours on the tinted page background
          const inks = mode === 'light' ? ['#14181F', '#454D5A', '#5F6775'] : ['#EEF1F6', '#B5BCCA', '#8B94A6'];
          for (const ink of inks) expect(contrast(ink, b)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(v['--accent-ink'], v['--accent'])).toBeGreaterThanOrEqual(4.5);   // the main button's own text
        expect(contrast(v['--sel-ink'], mix(v['--accent'], 15, S.panel))).toBeGreaterThanOrEqual(4.5);   // selected chips
      });
    }
  }
});

describe('the logo takes the season', () => {
  it('uses the three colours as they are at night', () => {
    for (const s of SEASONS) {
      const [lead, second, third] = SEASON_COLOURS[s];
      const v = seasonVars(s, 'dark');
      expect([v['--logo-blue'], v['--logo-teal'], v['--logo-orange'], v['--logo-go']]).toEqual([lead, second, third, lead]);
      expect(v['--logo-anto']).toBe('#EEF1F6');
    }
  });
  it('darkens them by day, with the wordmark in the page ink', () => {
    for (const s of SEASONS) {
      const [lead] = SEASON_COLOURS[s];
      const v = seasonVars(s, 'light');
      expect(v['--logo-blue']).toBe(mix(lead, 86, '#000000'));
      expect(v['--logo-anto']).toBe('#14181F');
    }
  });
  it('ride and the other session kinds are not seasonal', () => {
    for (const s of SEASONS) for (const m of ['light', 'dark'] as const) for (const k of ['--ride', '--strength', '--walk', '--run', '--mobility']) expect(seasonVars(s, m)[k]).toBeUndefined();
  });
  it('the four seasons look different', () => {
    const accents = new Set(SEASONS.map((s) => seasonVars(s, 'dark')['--accent']));
    expect(accents.size).toBe(4);
  });
});
