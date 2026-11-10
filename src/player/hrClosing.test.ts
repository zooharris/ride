import { describe, expect, it } from 'vitest';
import { hrCue, zoneWords, CUE_HOLD_S, type CueState } from './hrCue';

/**
 * Fixes from the review of the 9–10 Nov builds, Part C (10 Nov 2026): the yellow bar waits while heart rate is
 * closing on the zone. Traces are the 10-second average, one reading a second, fed across steps as the ride does.
 */

const hard = { low: 160, high: 172 };
const easy = { low: 0, high: 130 };
type Seg = { band: { low: number; high: number }; noFloor?: boolean; bpm: (t: number) => number; seconds: number };

/** Feeds segments one after another, keeping the history across steps as the controller does. */
function ride(segs: Seg[]) {
  let st: CueState = {};
  let now = 0;
  return segs.map((s) => {
    st = { lastTone: st.lastTone, hist: st.hist };   // a new step
    const out = [];
    for (let t = 0; t < s.seconds; t++, now++) { const r = hrCue(st, s.bpm(t), s.band, !!s.noFloor, now); st = r.state; out.push({ t, bpm: s.bpm(t), ...r }); }
    return out;
  });
}
/** Heart rate answering a change of effort: a few seconds' lag, then a smooth approach to its new level. */
const answer = (from: number, to: number, tau = 30, lag = 6) => (t: number) => t < lag ? from : to + (from - to) * Math.exp(-(t - lag) / tau);
const flat = (v: number) => () => v;

describe('the yellow bar waits while heart rate is closing', () => {
  it('1. a hard effort done right: from 100 to the zone over about 100 seconds, then steady. No instruction', () => {
    const [, effort] = ride([{ band: easy, noFloor: true, bpm: flat(100), seconds: 60 }, { band: hard, bpm: answer(100, 166, 38), seconds: 240 }]);
    expect(effort.find((o) => o.bpm >= hard.low)!.t).toBeGreaterThan(80);
    expect(effort.find((o) => o.bpm >= hard.low)!.t).toBeLessThan(120);
    expect(effort.every((o) => !o.cue)).toBe(true);
  });

  it('2. no response: flat, well below the zone. Increase at 20 seconds', () => {
    const [, effort] = ride([{ band: easy, noFloor: true, bpm: flat(120), seconds: 60 }, { band: hard, bpm: flat(120), seconds: 40 }]);
    expect(effort.slice(0, CUE_HOLD_S).every((o) => !o.cue)).toBe(true);
    expect(effort[CUE_HOLD_S].cue).toBe('under');
  });

  it('3. not enough: climbs, then levels off 8 below. Increase about 20 seconds after it levels off', () => {
    const [, effort] = ride([{ band: easy, noFloor: true, bpm: flat(110), seconds: 60 }, { band: hard, bpm: answer(110, 152, 20), seconds: 200 }]);
    const level = effort.find((o) => 152 - o.bpm < 1)!.t;         // within a beat of where it settles
    const first = effort.find((o) => o.cue)!;
    expect(first.cue).toBe('under');
    expect(first.t - level).toBeGreaterThanOrEqual(15);
    expect(first.t - level).toBeLessThanOrEqual(30);
  });

  it('4. a recovery done right: from 165 into a zone with no minimum over two minutes. No instruction', () => {
    const [, rec] = ride([{ band: hard, bpm: flat(165), seconds: 60 }, { band: easy, noFloor: true, bpm: answer(165, 115, 70), seconds: 240 }]);
    const inside = rec.find((o) => o.bpm <= easy.high)!.t;
    expect(inside).toBeGreaterThan(60);
    expect(inside).toBeLessThan(150);
    expect(rec.every((o) => !o.cue)).toBe(true);
  });

  it('5. drift: heart rate creeps above the zone during a steady step. Reduce at 20 seconds', () => {
    const [steady] = ride([{ band: hard, bpm: (t) => 168 + t * 0.05, seconds: 300 }]);
    const out = steady.find((o) => o.bpm > hard.high)!.t;
    const first = steady.find((o) => o.cue)!;
    expect(first.cue).toBe('over');
    expect(first.t - out).toBe(CUE_HOLD_S);
  });

  it('6. a late response: the bar clears while heart rate closes, and returns 20 seconds after it levels off outside', () => {
    // Flat at 130 for 40 s (the bar shows at 20), then a rise to 150 that stops dead at 70 s.
    const bpm = (t: number) => t < 40 ? 130 : t < 70 ? 130 + (t - 40) * (20 / 30) : 150;
    const [s] = ride([{ band: hard, bpm, seconds: 140 }]);
    expect(s[CUE_HOLD_S].cue).toBe('under');
    const cleared = s.find((o) => o.t > 40 && !o.cue)!.t;
    expect(cleared).toBeLessThan(46);
    // Closing ends once the reading 20 s back is within 2 bpm of now; from then, 20 s more.
    const stopped = s.find((o) => o.t > 70 && !o.closing)!.t;
    expect(s.find((o) => o.t > cleared && o.cue)!.t).toBe(stopped + CUE_HOLD_S);
  });

  it('with under 20 seconds of readings, heart rate counts as not closing', () => {
    let st: CueState = {};
    for (let t = 0; t < CUE_HOLD_S; t++) ({ state: st } = hrCue(st, 130 + t, hard, false, t));
    expect(st.closing).toBeFalsy();
  });

  it('the words under the bar add the direction while closing, and only then', () => {
    expect(zoneWords(120, hard, true)).toBe('40 bpm below, rising');
    expect(zoneWords(184, hard, true)).toBe('12 bpm above, falling');
    expect(zoneWords(120, hard, false)).toBe('40 bpm below');
    expect(zoneWords(165, hard, true)).toBe('In the zone');
  });
});
