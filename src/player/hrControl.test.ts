import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimRider } from './sim';
import { hrAnswer, hrLearn, hrLearns, hrResumed, hrStatus, hrStepStart, hrTick, startWatts, HR_CEILING, HR_GAP_S, HR_RISE_WAIT_S, type HrCtl, type HrPowerTable, type HrStep } from './hrControl';

// A rider whose zone 2 sits near 100 W, so a first ride from 90 W can find it under the 1.25 ceiling.
const rider = { ftp: 130, lthr: 160, restingHr: 55, maxHr: 185 };
const z2: HrStep = { seconds: 2400, noFloor: false, zone: 2, low: 131, high: 142 };
const noFtp = { ftp: 200 };

let seed = 1;
beforeEach(() => { seed = 1; vi.spyOn(Math, 'random').mockImplementation(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }); });
afterEach(() => vi.restoreAllMocks());

/** Ride one step on the simulated rider; returns each second's state, heart rate and 30-s average. */
function ride(step: HrStep, st0: HrCtl, sim = new SimRider(rider), opts: { answer?: (s: HrCtl) => 'harder' | 'keep' | undefined; bpm?: (i: number, real: number) => number } = {}) {
  let st = st0;
  const hrs: number[] = [];
  const out: { st: HrCtl; bpm: number; avg: number; eased: boolean }[] = [];
  for (let i = 0; i < step.seconds; i++) {
    sim.target = st.target;
    const r = sim.tick(1);
    const bpm = opts.bpm ? opts.bpm(i, r.bpm) : r.bpm;
    hrs.push(bpm);
    const last = hrs.slice(-30);
    const avg = Math.round(last.reduce((a, b) => a + b, 0) / last.length);
    const t = hrTick(st, step, i, avg);
    st = t.state;
    const a = st.asking ? opts.answer?.(st) : undefined;
    if (a) st = hrAnswer(st, a);
    out.push({ st, bpm, avg, eased: t.easedNow });
  }
  return { out, sim, last: st };
}

describe('the trainer steering heart rate (C2)', () => {
  it('a 40-minute zone-2 step from 90 W settles inside the zone within 6 minutes and stays there', () => {
    const start = startWatts({}, 2, noFtp);
    expect(start.watts).toBe(90);
    const { out } = ride(z2, hrStepStart(start));
    const inBand = (o: { avg: number }) => o.avg >= z2.low - 1 && o.avg <= z2.high + 1;
    const firstIn = out.findIndex(inBand);
    expect(firstIn).toBeGreaterThan(-1);
    expect(firstIn).toBeLessThan(360);
    expect(out.slice(firstIn + 60).every(inBand)).toBe(true);
  });

  it('a second ride, starting from what the first one learned, is in the zone within 90 seconds', () => {
    const first = ride(z2, hrStepStart(startWatts({}, 2, noFtp)));
    expect(hrLearns(first.last, z2, z2.seconds)).toBe(true);
    const lastWatts = first.out.slice(-180).map((o) => o.st.target);
    const table = hrLearn({}, 2, lastWatts.reduce((a, b) => a + b, 0) / lastWatts.length, '2026-10-28');
    const start = startWatts(table, 2, noFtp);
    expect(start.learned).toBe(true);
    // A rider who has warmed up: heart rate already near the zone's foot when the step starts.
    const sim = new SimRider(rider);
    sim.bpm = 128;
    const { out } = ride(z2, hrStepStart(start), sim);
    expect(out.findIndex((o) => o.avg >= z2.low && o.avg <= z2.high)).toBeLessThan(90);
  });

  it('never goes above 1.25 × the start; a heart rate that will not rise asks once, and the answers work', () => {
    const low = (st0: HrCtl, answer?: (s: HrCtl) => 'harder' | 'keep' | undefined) => ride(z2, st0, new SimRider(rider), { bpm: () => 100, answer });
    const st0 = hrStepStart({ watts: 100, learned: true });
    const plain = low(st0);
    expect(Math.max(...plain.out.map((o) => o.st.target))).toBe(Math.round(100 * HR_CEILING));
    expect(plain.out.filter((o, i) => o.st.asking && !plain.out[i - 1]?.st.asking)).toHaveLength(1);
    let asked = 0;
    const harder = low(st0, () => (asked++ === 0 ? 'harder' : undefined));
    expect(Math.max(...harder.out.map((o) => o.st.target))).toBe(140);
    const keep = low(st0, () => 'keep');
    const at = keep.out.findIndex((o) => o.st.kept);
    expect(at).toBeGreaterThan(0);
    expect(new Set(keep.out.slice(at).map((o) => o.st.target)).size).toBe(1);
    expect(keep.out.slice(at).every((o) => !o.st.asking)).toBe(true);
    expect(hrLearns(keep.last, z2, z2.seconds)).toBe(false);
  });

  it('a 2-minute step never changes its target', () => {
    const short: HrStep = { ...z2, seconds: 120 };
    const { out } = ride(short, hrStepStart({ watts: 150, learned: true }), new SimRider(rider), { bpm: () => 170 });
    expect(out.every((o) => o.st.target === 150)).toBe(true);
    expect(hrStatus(out[5].st, short, 5, 170)).toMatch(/usually keep you in zone 2/);
  });

  it('a spike well above the zone eases to 0.8 × the start within 20 seconds', () => {
    const st0 = { ...hrStepStart({ watts: 120, learned: true }), lastChangeS: 0 };
    const { out } = ride(z2, st0, new SimRider(rider), { bpm: (i) => (i >= 60 ? z2.high + 15 : 136) });
    const eased = out.findIndex((o) => o.eased);
    expect(eased).toBeGreaterThan(60);
    expect(eased - 60).toBeLessThanOrEqual(20 + 30); // the 30-second average has to climb past +10 first
    expect(out[eased].st.target).toBe(96);
    expect(hrStatus(out[eased].st, z2, eased, z2.high + 15)).toMatch(/Eased to 96 W/);
  });

  it('a recovery step (no floor) never raises', () => {
    const rec: HrStep = { seconds: 600, noFloor: true, zone: 1, low: 0, high: 120 };
    const { out } = ride(rec, hrStepStart({ watts: 60, learned: true }), new SimRider(rider), { bpm: () => 90 });
    expect(out.every((o) => o.st.target <= 60)).toBe(true);
  });

  it('changes at most every 30 seconds, and never rises within 2 minutes of a rise', () => {
    const { out } = ride(z2, hrStepStart({ watts: 90, learned: false }));
    const changes = out.map((o, i) => ({ i, d: o.st.target - (out[i - 1]?.st.target ?? 90) })).filter((c) => c.d !== 0);
    for (let k = 1; k < changes.length; k++) {
      expect(changes[k].i - changes[k - 1].i).toBeGreaterThanOrEqual(HR_GAP_S);
      if (changes[k].d > 0) {
        const lastRise = [...changes.slice(0, k)].reverse().find((c) => c.d > 0);
        if (lastRise) expect(changes[k].i - lastRise.i).toBeGreaterThanOrEqual(HR_RISE_WAIT_S);
      }
    }
  });

  it('after a pause it may rise again at once (no two-minute wait)', () => {
    const st = { ...hrStepStart({ watts: 100, learned: true }), raisedAtS: 100, lastChangeS: 100 };
    expect(hrTick(st, z2, 140, 120).state.target).toBe(100);
    expect(hrTick(hrResumed(st), z2, 140, 120).state.target).toBe(110);
  });
});

describe('the learned table', () => {
  it('blends 70 % new with 30 % old and counts', () => {
    const t1 = hrLearn({}, 2, 140, '2026-10-27');
    expect(t1[2]).toEqual({ watts: 140, at: '2026-10-27', n: 1 });
    expect(hrLearn(t1, 2, 150, '2026-10-28')[2]).toEqual({ watts: 147, at: '2026-10-28', n: 2 });
  });
  it('learns only from a steady step of 5 minutes or more, in the zone for its last 3', () => {
    const st = { ...hrStepStart({ watts: 140, learned: true }), inSince: 2400 - 200 };
    expect(hrLearns(st, z2, 2400)).toBe(true);
    expect(hrLearns({ ...st, inSince: 2400 - 120 }, z2, 2400)).toBe(false);
    expect(hrLearns({ ...st, inSince: undefined }, z2, 2400)).toBe(false);
    expect(hrLearns(st, { ...z2, seconds: 240 }, 240)).toBe(false);
  });
  it('starts a step from its own zone, a neighbour scaled, the FTP, or 90 W', () => {
    const table: HrPowerTable = { 2: { watts: 140, at: '', n: 3 } };
    expect(startWatts(table, 2, noFtp)).toEqual({ watts: 140, learned: true });
    expect(startWatts(table, 3, noFtp).watts).toBe(160); // 140 × 1.15
    expect(startWatts({ 3: { watts: 160, at: '', n: 1 } }, 2, noFtp).watts).toBe(140); // 160 × 0.87
    expect(startWatts({}, 2, { ftp: 240 }).watts).toBe(155); // the middle of power zone 2 (55–75 % of 240)
    expect(startWatts({}, 2, noFtp).watts).toBe(90);
  });
});

describe('a step change is a change of effort (heart rate takes time to answer)', () => {
  const tempo: HrStep = { seconds: 720, noFloor: false, zone: 3, low: 141, high: 144 };
  const recovery: HrStep = { seconds: 240, noFloor: true, zone: 1, low: 0, high: 115 };
  it('tempo → recovery: no lowering in the first 90 seconds while heart rate comes down', () => {
    // 8 bpm over the recovery band (under the safety margin of 10) for 100 seconds.
    let st = hrStepStart({ watts: 90, learned: true }, 2000, 170);
    const targets: number[] = [];
    for (let i = 0; i < 150; i++) { st = hrTick(st, { ...recovery, seconds: 600 }, i, i < 100 ? 123 : 110).state; targets.push(st.target); }
    expect(targets.slice(0, 90).every((t) => t === 90)).toBe(true);
    expect(targets[95]).toBeLessThan(90);   // after 90 seconds it may ease
  });
  it('the safety ease-off still acts in that window', () => {
    let st = hrStepStart({ watts: 90, learned: true }, 2000, 170);
    let eased = -1;
    for (let i = 0; i < 60 && eased < 0; i++) { const r = hrTick(st, { ...recovery, seconds: 600 }, i, 140); st = r.state; if (r.easedNow) eased = i; }
    expect(eased).toBeGreaterThanOrEqual(20);
    expect(eased).toBeLessThan(30);
    expect(st.target).toBe(72);
  });
  it('recovery → tempo: no rise in the first 2 minutes while heart rate climbs', () => {
    let st = hrStepStart({ watts: 170, learned: true }, 2000, 90);
    const targets: number[] = [];
    for (let i = 0; i < 100; i++) { st = hrTick(st, tempo, i, 120).state; targets.push(st.target); }
    expect(targets.every((t) => t === 170)).toBe(true);
    for (let i = 100; i < 160; i++) { st = hrTick(st, tempo, i, 120).state; targets.push(st.target); }
    expect(targets[119]).toBe(170);
    expect(Math.max(...targets)).toBeGreaterThan(170);   // after two minutes it may rise
  });
  it('the first step of a ride is unchanged (no step before it)', () => {
    const st = hrStepStart({ watts: 90, learned: false });
    expect(st.raisedAtS).toBeUndefined();
    expect(st.loweredAtS).toBeUndefined();
  });
  it('the status line says heart rate is coming down on a recovery step', () => {
    const st = { ...hrStepStart({ watts: 90, learned: true }), lastDelta: -5, lastChangeS: 100 };
    expect(hrStatus(st, recovery, 120, 118)).toMatch(/while your heart rate comes down/);
    expect(hrStatus(st, z2, 120, 145)).toMatch(/as your heart rate crept up/);
  });
  it('with a learned table, zone 2 then zone 3 each hold near their learned watts after the first two minutes', () => {
    // Learn both zones from a first, long ride of each.
    const z3: HrStep = { seconds: 2400, noFloor: false, zone: 3, low: 142, high: 150 };
    const learn = (step: HrStep) => { const r = ride(step, hrStepStart({ watts: 90, learned: false }, 2000)); const ws = r.out.slice(-180).map((o) => o.st.target); return ws.reduce((a, b) => a + b, 0) / ws.length; };
    let table: HrPowerTable = {};
    table = hrLearn(table, 2, learn(z2), '2026-10-28');
    table = hrLearn(table, 3, learn({ ...z3, seconds: 2400 }), '2026-10-28');
    // The second ride: 10 minutes of each, the rider carrying on from one step to the next.
    const sim = new SimRider(rider);
    sim.bpm = 128;
    const a = ride({ ...z2, seconds: 600 }, hrStepStart(startWatts(table, 2, noFtp)), sim);
    const s3 = startWatts(table, 3, noFtp);
    const b = ride({ ...z3, seconds: 600 }, hrStepStart(s3, 2000, a.last.target), a.sim);
    const near = (out: { st: HrCtl }[], w: number) => out.slice(120).every((o) => Math.abs(o.st.target - w) <= 10);
    expect(near(a.out, table[2].watts)).toBe(true);
    expect(near(b.out, table[3].watts)).toBe(true);
  });
});
