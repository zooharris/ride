import { describe, expect, it } from 'vitest';
import { breathingOf, findBreathFreeze } from './breathFreeze';
import { breathStopNote } from '../ui/ActivityCharts';

const secs = (n: number) => Array.from({ length: n }, (_, t) => t);
/** Breathing that varies every second, like the real thing. */
const live = (t: number) => ({ ve: 30 + 8 * Math.sin(t / 9) + (t % 7) * 0.13, br: 22 + 3 * Math.sin(t / 13) + (t % 5) * 0.07, tv: 1.4 + (t % 3) * 0.05 });

function ride(n: number, frozen: (t: number) => boolean) {
  const time = secs(n), ve: number[] = [], br: number[] = [], tv: number[] = [];
  let held = live(0);
  for (const t of time) { const v = frozen(t) ? held : (held = live(t)); ve.push(v.ve); br.push(v.br); tv.push(v.tv); }
  return { time, ve, br, tv };
}

describe('2E: a strap that froze mid-ride', () => {
  it('flat from minute 24 to the end of a 3-hour ride: cut at 24:00', () => {
    const r = ride(3 * 3600, (t) => t > 24 * 60);
    expect(findBreathFreeze(r.time, r.ve, r.br)!.at).toBe(24 * 60);
    expect(breathStopNote(24 * 60, true)).toBe("Breathing stopped at 24:00 · the strap's link to the bike computer dropped");
  });
  it('a flat run of 90 seconds at the end is not a freeze', () => {
    const r = ride(3600, (t) => t > 3600 - 90);
    expect(findBreathFreeze(r.time, r.ve, r.br)).toBeUndefined();
  });
  it('a flat run of 5 minutes that then changes again is not a freeze (the strap came back)', () => {
    const r = ride(3600, (t) => t > 1200 && t < 1500);
    expect(findBreathFreeze(r.time, r.ve, r.br)).toBeUndefined();
  });
  it('breathing that varies throughout has no freeze', () => {
    const r = ride(3600, () => false);
    expect(findBreathFreeze(r.time, r.ve, r.br)).toBeUndefined();
  });
  it('the ride going on after the last breath value still counts toward the two minutes', () => {
    const r = ride(1000, (t) => t > 800);
    const time = [...r.time, ...secs(200).map((t) => 1000 + t)];
    const pad = (a: number[]) => [...a, ...Array(200).fill(NaN)];
    expect(findBreathFreeze(time, pad(r.ve), pad(r.br))!.at).toBe(800);
  });
  it('the helper cuts ventilation, breathing rate and breath size together', () => {
    const r = ride(1200, (t) => t > 600);
    const b = breathingOf(r);
    expect(b.frozenAt).toBe(600);
    for (const k of ['ve', 'br', 'tv'] as const) {
      expect(Number.isNaN(b[k]![600])).toBe(true);
      expect(Number.isNaN(b[k]![1199])).toBe(true);
      expect(Number.isNaN(b[k]![599])).toBe(false);
    }
  });
  it('a ride with no breathing, or with breathing that never froze, is unchanged', () => {
    const plain = { time: secs(600), watts: Array(600).fill(150) };
    expect(breathingOf(plain)).toBe(plain);
    const r = ride(600, () => false);
    expect(breathingOf(r)).toBe(r);
  });
});
