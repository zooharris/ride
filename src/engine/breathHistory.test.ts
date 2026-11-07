import { describe, expect, it } from 'vitest';
import { breathAtPower, FINE_BANDS, type BreathAtPower } from './breathOffset';
import { breathHistory, needsSentence, historyBands } from './breathHistory';
import { RAMP_7NOV_CSV } from './fixtures/ramp7Nov';

const FTP = 238;
/**
 * A rider's fine bands from steady riding: ventilation rises gently to VT1 (share v1 of FTP), then more steeply;
 * breathing rate holds near 26 to VT1 and then climbs; breath size rises to VT1 and then levels.
 */
function bands(o: { v1: number; from?: number; to?: number; seconds?: number; flat?: boolean }): BreathAtPower[] {
  return FINE_BANDS.filter(([lo]) => lo >= (o.from ?? 0.45) && lo < (o.to ?? 1.0)).map(([lo, hi]) => {
    const x = (lo + hi) / 2;
    const over = Math.max(0, x - o.v1);
    return {
      lo, hi, seconds: o.seconds ?? 300,
      ve: o.flat ? 30 : 20 + 25 * x + 120 * over,
      br: o.flat ? 28 : 26 + 1 * x + 90 * over,
      tv: o.flat ? 1.1 : Math.min(0.9 + 1.2 * x, 0.9 + 1.2 * o.v1),
      hr: Math.round(90 + 70 * x),
    };
  });
}
const ride = (date: string, b: BreathAtPower[]) => ({ date, breathAtPower: b, ftpAtBuild: FTP, breathOffset: 1 });

describe('breathing history (Step 2c, Part B)', () => {
  it('finds a first threshold at 70% of FTP from two rides, clear when breathing rate and breath size agree', () => {
    const h = breathHistory([ride('2026-11-08', bands({ v1: 0.7 })), ride('2026-11-10', bands({ v1: 0.7 }))], FTP, '2026-11-12');
    expect(h.rides).toBe(2);
    expect(h.vt1).toBeDefined();
    expect(Math.abs(h.vt1!.watts - 0.7 * FTP)).toBeLessThanOrEqual(0.06 * FTP);
    expect(h.vt1!.certainty).toBe('clear');
    expect(h.vt1!.hr).toBeGreaterThan(130);
    expect(h.notYet).toBeUndefined();
  });

  it('finds none in a straight line, and says so plainly', () => {
    const straight = bands({ v1: 2 });
    const h = breathHistory([ride('2026-11-08', straight), ride('2026-11-10', straight)], FTP, '2026-11-12');
    expect(h.vt1).toBeUndefined();
    expect(h.notYet).toMatch(/don’t show a clear first threshold yet/);
  });

  it('a strap that never followed the breathing is called out', () => {
    const h = breathHistory([ride('2026-11-08', bands({ v1: 0.7, flat: true })), ride('2026-11-10', bands({ v1: 0.7, flat: true }))], FTP, '2026-11-12');
    expect(h.vt1).toBeUndefined();
    expect(h.notYet).toMatch(/barely changes/);
  });

  it('too thin: says how many more minutes, at which watts', () => {
    const h = breathHistory([ride('2026-11-08', bands({ v1: 0.7, from: 0.5, to: 0.7, seconds: 200 }))], FTP, '2026-11-12');
    expect(h.vt1).toBeUndefined();
    expect(h.notYet).toMatch(/^Not enough breathing data yet: \d+ more minutes of riding with the strap between \d+ and \d+ W/);
    expect(h.notYet).toMatch(/would be enough to look\.$/);
  });

  it('one long ride with 15 minutes in each band is enough on its own', () => {
    const h = breathHistory([ride('2026-11-08', bands({ v1: 0.75, seconds: 900 }))], FTP, '2026-11-12');
    expect(h.vt1).toBeDefined();
  });

  it('rides older than 12 weeks are left out', () => {
    const h = breathHistory([ride('2026-07-01', bands({ v1: 0.7 })), ride('2026-07-03', bands({ v1: 0.7 }))], FTP, '2026-11-12');
    expect(h.rides).toBe(0);
    expect(h.vt1).toBeUndefined();
  });

  it('honours an FTP change between rides: bands are laid on today’s FTP by watts', () => {
    const old = bands({ v1: 0.7 }).map((b) => ({ ...b }));
    const { bands: hb } = historyBands([{ date: '2026-11-01', breathAtPower: old, ftpAtBuild: 210 }], 238, '2026-11-12');
    // A band at 70-75% of 210 W (about 152 W) sits at about 64% of 238 W.
    const at = hb.find((b) => b.lo === 0.6);
    expect(at).toBeDefined();
  });

  it('the needs sentence joins neighbouring short bands into one range', () => {
    const s = needsSentence([], FTP);
    expect(s).toMatch(/between 119 and 226 W/);
  });

  it('Todd’s 7 Nov ramp alone is not enough (a ramp leaves under 2 minutes in most bands)', () => {
    const rows = RAMP_7NOV_CSV.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));
    const col = (k: number) => rows.map((r) => r[k]);
    const b = breathAtPower(col(0), col(1), col(3), col(4), col(5), col(2), FTP);
    const h = breathHistory([{ date: '2026-11-07', breathAtPower: b, ftpAtBuild: FTP }], FTP, '2026-11-07');
    expect(h.vt1).toBeUndefined();
    expect(h.notYet).toMatch(/^Not enough breathing data yet/);
  });
});
