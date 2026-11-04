/**
 * Part A acceptance (4 Nov 2026): Todd's first real ramp test with power, heart
 * rate and the Tymewear VitalPro. Warm-up to 304 s, 20 W a minute from 120 W,
 * stopped by the rider at 970 s. The strap's last real reading was at 815 s;
 * 816-830 are placeholders (breath size 1.00, ventilation equal to breathing rate);
 * nothing after. Settings at the time: FTP 210, threshold heart rate 154, max 180.
 */
import { describe, expect, it } from 'vitest';
import { breathThresholds } from './breathThresholds';
import { judgeRamp } from './rampJudge';
import { RAMP_4NOV_CSV } from './fixtures/ramp4Nov';

export function ramp4Nov() {
  const rows = RAMP_4NOV_CSV.trim().split('\n').slice(1).map((l) => l.split(','));
  const n = (x: string) => (x === '' ? NaN : Number(x));
  return {
    time: rows.map((r) => n(r[0])), watts: rows.map((r) => n(r[1])), hr: rows.map((r) => n(r[2])),
    ve: rows.map((r) => n(r[3])), br: rows.map((r) => n(r[4])), tv: rows.map((r) => n(r[5])),
    from: 304, to: 970,
  };
}
export const SETTINGS_4NOV = { ftp: 210, lthr: 154, maxHr: 180, weightKg: 107.4 };

describe('the 4 Nov ramp', () => {
  it('judges the test all-out and past the second threshold', () => {
    const f = ramp4Nov();
    const j = judgeRamp({ ...f, peakWatts: 319, stepWatts: 20, endedBy: 'rider', ...SETTINGS_4NOV });
    expect(j.allOut).toBe('yes');
    expect(j.pastVt2).toBe('yes');
    expect(j.lines.length).toBeGreaterThanOrEqual(3);
  });

  it('reports no thresholds because the strap stopped, with when', () => {
    const f = ramp4Nov();
    const b = breathThresholds({ ...f, peakWatts: 319, stepWatts: 20, endedBy: 'rider', ...SETTINGS_4NOV })!;
    expect(b.missing).toBe('strap-stopped');
    expect(b.vt2).toBeUndefined();
    expect(b.breathEndAt).toBe(815);
    expect(b.rampEndAt).toBe(970);
    // 18 in the real readings around the stop (804-805, 809, 816-830); the 5-second fixture adds a few elsewhere.
    expect(b.placeholders).toBeGreaterThanOrEqual(18);
    expect(b.judge?.allOut).toBe('yes');
  });
});

describe('the 4 Nov ramp, as the player records it', () => {
  it('gives FTP 238 with heart-rate agreement, VO2max about 38 with a range, and no peak breathing', async () => {
    const { buildTimeline } = await import('../player/timeline');
    const { RideEngine } = await import('../player/engine');
    const { rampResult, breathCoveredRamp, ftpBasisWords } = await import('../player/tests');
    const { LIBRARY } = await import('../library/workouts');
    const f = ramp4Nov();
    const profile = { name: 'T', ftp: 210, lthr: 154, maxHr: 180, restingHr: 50, weightKg: 107.4, basis: 'power' as const, masters: true, units: 'imperial' as const, rideDays: [], hoursPerWeek: 8 };
    const tl = buildTimeline(LIBRARY.find((w) => w.id === 'lib-ramp')!, profile, { rampStep: 20 });
    const e = new RideEngine({ timeline: tl, ftp: 210, basis: 'power', mode: 'erg', autoPause: false, guard: false }, 0);
    for (let t = 1; t <= 3; t++) e.tick(t * 1000, { watts: 0, cadence: 90 });
    const at = new Map(f.time.map((t, i) => [t, i]));
    const num = (x: number) => (isNaN(x) ? undefined : x);
    let t = 4;
    for (; t < 970; t++) {
      const i = at.get(t);
      const live = i == null ? { watts: 0, cadence: 90 } : { watts: f.watts[i], cadence: 90, bpm: f.hr[i], ve: num(f.ve[i]), br: num(f.br[i]), tv: num(f.tv[i]) };
      e.tick(t * 1000, live);
    }
    e.endTest(t * 1000, 'rider');
    const rec = { samples: e.samples, rampStep: 20, rampEndAt: e.rampEndAt, events: e.events };
    const r = rampResult(rec, tl, profile.weightKg, { ftp: 210, lthr: 154, maxHr: 180 });
    expect(r.judge?.allOut).toBe('yes');
    expect(r.judge?.pastVt2).toBe('yes');
    expect(r.breath?.missing).toBe('strap-stopped');
    expect(r.breath?.vt1).toBeUndefined();
    expect(r.breath?.vt2).toBeUndefined();
    expect(Math.abs(r.ftpEstimate! - 238)).toBeLessThanOrEqual(1);
    expect(r.ftpDisagree).toBeUndefined();
    expect(ftpBasisWords(r)).toBe('75% of the best minute');
    expect(Math.abs(r.hrAtFtp! - 154)).toBeLessThanOrEqual(4);
    expect(r.ftpHrAgrees).toBe(true);
    expect(Math.round(r.vo2maxMlKgMin!)).toBe(38);
    expect(r.vo2maxRange).toEqual([35, 41]);
    expect(r.vo2maxAtLeast).toBeUndefined();
    expect(breathCoveredRamp(r.breath!)).toBe(false);
  });
});

describe('Part A pieces', () => {
  it('A1: a ramp that stopped with heart rate well short of its highest is judged not all-out and not past the second threshold', () => {
    const f = ramp4Nov();
    // The same ride cut off at 600 s (about 200 W, heart rate about 138).
    const j = judgeRamp({ ...f, to: 600, peakWatts: 200, stepWatts: 20, endedBy: 'rider', ...SETTINGS_4NOV });
    expect(j.allOut).toBe('no');
    expect(j.pastVt2).toBe('no');
  });
  it('A1: with nothing to judge by, there is no judgement', () => {
    const f = ramp4Nov();
    expect(judgeRamp({ ...f }).allOut).toBeUndefined();
  });
  it('A3: witnesses weighed together; far apart, the best-minute figure is offered', async () => {
    const { reconcileFtp } = await import('../player/tests');
    const yes = { allOut: 'yes' as const, pastVt2: 'yes' as const, lines: [] };
    const vt2 = (watts: number, certainty: 'clear' | 'unsure') => ({ vt2: { watts, ve: 80, certainty } });
    expect(reconcileFtp(240, vt2(250, 'clear'), yes).ftpEstimate).toBe(245);
    expect(reconcileFtp(240, vt2(250, 'unsure'), yes).ftpEstimate).toBe(243);
    expect(reconcileFtp(240, vt2(250, 'clear'), { ...yes, allOut: 'no' }).ftpEstimate).toBe(240);
    const far = reconcileFtp(240, vt2(270, 'clear'), yes);
    expect(far.ftpEstimate).toBe(240);
    expect(far.ftpDisagree).toBe(true);
    expect(reconcileFtp(240, undefined, undefined, 246).ftpEstimate).toBe(242);
  });
  it('A6: a steeper ramp is corrected down, a gentler one up; the range is ±8%', async () => {
    const { vo2maxFromPeak } = await import('../player/tests');
    const at20 = vo2maxFromPeak(319, 107.4, 20), at30 = vo2maxFromPeak(319, 107.4, 30), at10 = vo2maxFromPeak(319, 107.4, 10);
    expect(at30.mlKgMin!).toBeLessThan(at20.mlKgMin!);
    expect(at10.mlKgMin!).toBeGreaterThan(at20.mlKgMin!);
    expect(at20.range).toEqual([35, 41]);
  });
  it('A9: a test is never partial or short of plan', async () => {
    const { scoreRide } = await import('./compliance');
    const { LIBRARY } = await import('../library/workouts');
    const ramp = LIBRARY.find((w) => w.id === 'lib-ramp')!;
    const c = scoreRide(ramp, { id: 'x', date: '2026-11-04', startTime: '', name: 'Ramp Test', type: 'VirtualRide', sport: 'ride', seconds: 965, tss: 22 } as never);
    expect(c.verdict).toBe('done');
    expect(c.reason).not.toMatch(/Short of plan/);
  });
});
