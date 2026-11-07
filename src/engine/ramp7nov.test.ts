/**
 * Acceptance (7 Nov 2026): Todd's second real ramp test, three days after the
 * first, with power, heart rate and the Tymewear VitalPro. Warm-up to 304 s,
 * 20 W a minute from 130 W, stopped by the rider at 905 s, one second into the
 * 330 W stage. The strap streamed throughout. Settings: FTP 238, threshold heart
 * rate 154, max 180, 107.4 kg.
 *
 * The strap compresses breath size, so ventilation rose only 29% while power
 * more than doubled (the app had called that "flat"), while breathing rate held
 * under 35 a minute to about 230 W and then climbed to 56. The second threshold
 * is read from the breathing rate; the first cannot be.
 */
import { describe, expect, it } from 'vitest';
import { breathThresholds, findBends } from './breathThresholds';
import { RAMP_7NOV_CSV } from './fixtures/ramp7Nov';
import { ramp4Nov } from './ramp4nov.test';

export function ramp7Nov() {
  const rows = RAMP_7NOV_CSV.trim().split('\n').slice(1).map((l) => l.split(','));
  const n = (x: string) => (x === '' ? NaN : Number(x));
  return {
    time: rows.map((r) => n(r[0])), watts: rows.map((r) => n(r[1])), hr: rows.map((r) => n(r[2])),
    ve: rows.map((r) => n(r[3])), br: rows.map((r) => n(r[4])), tv: rows.map((r) => n(r[5])),
    from: 304, to: 905,
  };
}
export const SETTINGS_7NOV = { ftp: 238, lthr: 154, maxHr: 180, weightKg: 107.4 };

describe('the 7 Nov ramp', () => {
  it('reads the second threshold from breathing rate, at about 232 W, and no first', () => {
    const f = ramp7Nov();
    const b = breathThresholds({ ...f, peakWatts: 330, stepWatts: 20, endedBy: 'rider', ...SETTINGS_7NOV })!;
    expect(b.judge?.allOut).toBe('yes');
    expect(b.judge?.pastVt2).toBe('yes');
    expect(b.flat).toBeUndefined();
    expect(b.readBy).toBe('br');
    expect(b.vt2).toBeDefined();
    expect(b.vt2!.watts).toBeGreaterThanOrEqual(225);
    expect(b.vt2!.watts).toBeLessThanOrEqual(245);
    expect(b.vt2!.hr).toBeGreaterThanOrEqual(150);
    expect(b.vt2!.hr).toBeLessThanOrEqual(160);
    expect(b.vt2!.certainty).toBe('clear');
    expect(b.vt1).toBeUndefined();
    expect(b.missing).toBe('no-vt1');
    expect(b.brCapped).toBe(true);
  });

  it('finds the same bend on the 4 Nov ramp, read by breathing rate (the app still reports none there: the strap stopped)', () => {
    const f = ramp4Nov();
    // The 4 Nov bins, as breathThresholds makes them, read by breathing rate alone.
    const b = breathThresholds({ ...f, peakWatts: 319, stepWatts: 20, endedBy: 'rider', ftp: 210, lthr: 154, maxHr: 180 })!;
    expect(b.missing).toBe('strap-stopped');
    expect(b.vt2).toBeUndefined();
  });

  it('a flat start does not make a bend out of a straight line', () => {
    const xs = Array.from({ length: 30 }, (_, i) => 120 + i * 6);
    expect(findBends(xs, xs.map((x) => 20 + 0.05 * x), { flatStart: true, oneBend: true })).toEqual({});
    expect(findBends(xs, xs.map(() => 28), { flatStart: true, oneBend: true })).toEqual({});
  });

  it('through the player: FTP 232 from the best minute with the second threshold agreeing, VO2max about 37', async () => {
    const { buildTimeline } = await import('../player/timeline');
    const { RideEngine } = await import('../player/engine');
    const { rampResult, ftpBasisWords } = await import('../player/tests');
    const { LIBRARY } = await import('../library/workouts');
    const f = ramp7Nov();
    const profile = { name: 'T', ...SETTINGS_7NOV, restingHr: 50, basis: 'power' as const, masters: true, units: 'imperial' as const, rideDays: [], hoursPerWeek: 8 };
    const tl = buildTimeline(LIBRARY.find((w) => w.id === 'lib-ramp')!, profile, { rampStep: 20 });
    const e = new RideEngine({ timeline: tl, ftp: 238, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
    const at = new Map(f.time.map((t, i) => [t, i]));
    const num = (x: number) => (isNaN(x) ? undefined : x);
    let t = 1;
    for (; t <= 904; t++) {
      const i = at.get(t);
      e.tick(t * 1000, i == null ? { watts: 0, cadence: 90 } : { watts: f.watts[i], cadence: 90, bpm: f.hr[i], ve: num(f.ve[i]), br: num(f.br[i]), tv: num(f.tv[i]) });
    }
    e.endTest(t * 1000, 'rider');
    const r = rampResult({ samples: e.samples, rampStep: 20, rampEndAt: e.rampEndAt, events: e.events }, tl, 107.4, { ftp: 238, lthr: 154, maxHr: 180 });
    expect(r.bestMinuteWatts).toBe(309);
    expect(r.ftpFromBestMinute).toBe(232);
    expect(r.ftpEstimate).toBe(232);
    expect(r.ftpDisagree).toBeUndefined();
    expect(ftpBasisWords(r)).toContain('second breathing threshold');
    expect(r.breath?.readBy).toBe('br');
    expect(r.breath?.vt2?.watts).toBe(232);
    expect(r.breath?.vt1).toBeUndefined();
    expect(r.lthrEstimate).toBe(152);
    expect(Math.round(r.vo2maxMlKgMin!)).toBe(37);
    expect(r.hrAtFtp).toBe(155);
    expect(r.ftpHrAgrees).toBe(true);
  });
});
