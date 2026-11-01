import { describe, expect, it } from 'vitest';
import { learnNormal, todayOffset, veAtPower } from './breathOffset';
import { breathingOf } from './breathFreeze';

const FTP = 250;
/** A ride at 1 Hz from pieces of [seconds, watts]; ventilation follows power: 12 + 0.12 × watts, times `scale`, with a little noise. */
function ride(pieces: Array<[number, number]>, scale = 1) {
  const time: number[] = [], watts: number[] = [], ve: number[] = [], br: number[] = [];
  let t = 0;
  for (const [sec, w] of pieces) for (let k = 0; k < sec; k++) { time.push(t); watts.push(w); ve.push((12 + 0.12 * w) * scale + ((t * 7) % 5) * 0.1); br.push(20 + ((t * 3) % 7) * 0.2); t++; }
  return { time, watts, ve, br };
}
const z2 = ride([[600, 120], [2400, 160], [1200, 200]]);   // the first 10 minutes are not counted

describe('2A: the strap\'s day-to-day offset', () => {
  it('one ride: median ventilation in each band of FTP, after minute 10', () => {
    const b = veAtPower(z2.time, z2.watts, z2.ve, FTP);
    expect(b.map((x) => [x.lo, x.seconds])).toEqual([[0.6, 2400], [0.8, 1200]]);
    expect(b[0].ve).toBeCloseTo(12 + 0.12 * 160, 0);
  });
  it('the normal: the rides of the last 12 weeks, weighted by time in each band', () => {
    const rides = [
      { date: '2026-10-20', veAtPower: veAtPower(z2.time, z2.watts, z2.ve, FTP) },
      { date: '2026-10-25', veAtPower: veAtPower(z2.time, z2.watts, ride([[600, 120], [2400, 160], [1200, 200]], 1.04).ve, FTP) },
      { date: '2026-06-01', veAtPower: [{ lo: 0.6, hi: 0.7, seconds: 9999, ve: 99 }] },   // older than 12 weeks: left out
    ];
    const n = learnNormal(rides, FTP, '2026-10-31')!;
    expect(n.rides).toBe(2);
    expect(n.bands.find((x) => x.lo === 0.6)!.seconds).toBe(4800);
    expect(n.bands.find((x) => x.lo === 0.6)!.ve).toBeLessThan(35);
    expect(learnNormal([], FTP, '2026-10-31')).toBeUndefined();
  });
  it('a frozen stretch is left out of the learning', () => {
    const r = ride([[600, 120], [3600, 160]]);
    const frozenVe = r.ve.map((v, i) => (i >= 1200 ? 80 : v)), frozenBr = r.br.map((v, i) => (i >= 1200 ? 30 : v));
    const cut = breathingOf({ time: r.time, ve: frozenVe, br: frozenBr });
    const b = veAtPower(r.time, r.watts, cut.ve, FTP);
    expect(b[0].seconds).toBe(600);   // only minutes 10 to 20 count
    expect(b[0].ve).toBeLessThan(40);
  });
  const normal = learnNormal([{ date: '2026-10-25', veAtPower: veAtPower(z2.time, z2.watts, z2.ve, FTP) }], FTP, '2026-10-31');
  it("today's offset: a strap sitting tighter reads 8% high", () => {
    const today = ride([[240, 100], [900, 160]], 1.08);
    expect(todayOffset(today.time, today.watts, today.ve, normal, FTP)).toBeCloseTo(1.08, 1);
    const same = ride([[240, 100], [900, 160]]);
    expect(todayOffset(same.time, same.watts, same.ve, normal, FTP)).toBeCloseTo(1, 1);
  });
  it('clamped to 0.85–1.15', () => {
    const r = ride([[240, 100], [900, 160]], 1.4);
    expect(todayOffset(r.time, r.watts, r.ve, normal, FTP)).toBe(1.15);
  });
  it('undefined with under 6 minutes of steady riding, or at a power the normal has no band for', () => {
    const short = ride([[240, 100], [300, 160]]);
    expect(todayOffset(short.time, short.watts, short.ve, normal, FTP)).toBeUndefined();
    const hard = ride([[240, 100], [900, 280]]);   // 1.12 of FTP: the normal never saw it
    expect(todayOffset(hard.time, hard.watts, hard.ve, normal, FTP)).toBeUndefined();
    expect(todayOffset(short.time, short.watts, short.ve, undefined, FTP)).toBeUndefined();
  });
});
