import { describe, expect, it } from 'vitest';
import { durability, ftpGoal, helpful, lateEfforts, lateKj, planDone, ramp, records, enduranceBreathRate, strengthBalance, sessionsPerWeek, zoneMix } from './progressMore';
import { CURVE_SECONDS } from './progress';

/** A ride at a steady power with one harder block placed where asked. */
function ride(seconds: number, base: number, blocks: Array<{ at: number; len: number; w: number }>) {
  const time: number[] = [], watts: number[] = [];
  for (let t = 0; t < seconds; t++) {
    time.push(t);
    const b = blocks.find((x) => t >= x.at && t < x.at + x.len);
    watts.push(b ? b.w : base);
  }
  return { time, watts };
}

describe('durability: the late point is set by the rider', () => {
  it('is one hour of work at FTP, in kilojoules', () => {
    expect(lateKj(250)).toBe(900);
    expect(lateKj(180)).toBe(648);
  });
  it('finds best efforts before and after the point, each wholly on its own side', () => {
    // 200 W steady: 250 W FTP means 900 kJ, reached after 4500 s at 200 W.
    const r = ride(9000, 200, [{ at: 1000, len: 300, w: 320 }, { at: 6000, len: 300, w: 290 }]);
    const late = lateEfforts(r.time, r.watts, 250);
    expect(late.at).toBe(900);
    expect(late.b5).toBe(320);
    expect(late.a5).toBe(290);
    expect(late.b20).toBeGreaterThan(200);
    expect(late.a20).toBeGreaterThan(200);
  });
  it('gives nothing after the point when the ride never reaches it', () => {
    const r = ride(1800, 150, []);
    const late = lateEfforts(r.time, r.watts, 250);
    expect(late.a5).toBeUndefined();
    expect(late.b5).toBeUndefined();
  });
  it('a lower FTP reaches the point sooner on the same ride', () => {
    const r = ride(9000, 200, [{ at: 3200, len: 300, w: 330 }]);
    // FTP 250: point at 4500 s, the block is before it. FTP 160: point at 2880 s, the block is after it.
    expect(lateEfforts(r.time, r.watts, 250).b5).toBe(330);
    expect(lateEfforts(r.time, r.watts, 160).a5).toBe(330);
  });
  it('needs three rides before it gives a headline, and reports the fade', () => {
    const c = (id: string, date: string, b5: number, a5: number) => ({ id, date, late: { v: 1, at: 800, b5, a5 } });
    const two = durability([c('a', '2026-10-01', 300, 270), c('b', '2026-10-08', 305, 280)], '2026-09-01', '2026-11-01', 300);
    expect(two.enough).toBe(false);
    const three = durability([c('a', '2026-10-01', 300, 270), c('b', '2026-10-08', 305, 280), c('c', '2026-10-15', 310, 290)], '2026-09-01', '2026-11-01', 300);
    expect(three.enough).toBe(true);
    expect(three.before).toBe(310);
    expect(three.after).toBe(290);
    expect(three.fade).toBeCloseTo(6.5, 1);
  });
});

describe('records', () => {
  const w = (v: number) => CURVE_SECONDS.map(() => v);
  it('marks new only when the range best is the all-time best and history began before the range', () => {
    const curves = [{ id: 'old', date: '2026-03-01', w: w(300) }, { id: 'new', date: '2026-10-20', w: w(310) }];
    const r = records(curves, '2026-09-01', '2026-11-11', '2026-01-01');
    expect(r[0].range).toBe(310);
    expect(r[0].rangeRide).toBe('new');
    expect(r[0].isNew).toBe(true);
    expect(r[0].year).toBe(310);
  });
  it('does not call a first sync new', () => {
    const r = records([{ id: 'x', date: '2026-10-20', w: w(310) }], '2026-09-01', '2026-11-11', '2026-10-20');
    expect(r[0].isNew).toBe(false);
  });
  it('is not new when an older ride holds the all-time best', () => {
    const r = records([{ id: 'old', date: '2025-03-01', w: w(330) }, { id: 'new', date: '2026-10-20', w: w(310) }], '2026-09-01', '2026-11-11', '2025-01-01');
    expect(r[0].isNew).toBe(false);
    expect(r[0].all).toBe(330);
    expect(r[0].year).toBe(310);
  });
});

describe('plan done and ramp', () => {
  it('counts done sessions at their recorded load and missed ones as nothing', () => {
    const p = planDone([
      { date: '2026-11-02', status: 'completed', plannedTss: 60, doneTss: 66 },
      { date: '2026-11-04', status: 'missed', plannedTss: 80 },
      { date: '2026-11-06', status: 'completed', plannedTss: 50 },
      { date: '2026-11-20', status: 'planned', plannedTss: 90 },
    ], '2026-11-01', '2026-11-11');
    expect(p).toEqual({ done: 116, planned: 190, share: 61 });
  });
  it('has no share with nothing planned', () => {
    expect(planDone([], '2026-11-01', '2026-11-11').share).toBeUndefined();
  });
  it('ramp is the slope of the last weeks', () => {
    expect(ramp([300, 310, 320, 330, 340, 350])).toBe(10);
    expect(ramp([400, 400])).toBeUndefined();
  });
});

describe('zone mix', () => {
  it('calls a mostly easy mix with a little hard work polarised', () => {
    const m = zoneMix([{ seconds: [3600, 6000, 400, 800, 300, 50, 10] }])!;
    expect(m.polarised).toBe(true);
    expect(m.easy).toBeGreaterThanOrEqual(75);
  });
  it('does not when zone 3 outweighs the hard work', () => {
    expect(zoneMix([{ seconds: [3000, 5000, 2000, 300, 100, 0, 0] }])!.polarised).toBe(false);
  });
});

describe('colouring changes', () => {
  it('colours only numbers training is meant to move, and only the helpful way', () => {
    expect(helpful('fitness', 5)).toBe(true);
    expect(helpful('rhr', -2)).toBe(true);
    expect(helpful('rhr', 2)).toBe(false);
    expect(helpful('weight', -1)).toBeUndefined();
    expect(helpful('fatigue', 9)).toBeUndefined();
  });
});

describe('whole body', () => {
  it('counts sessions a week by kind and leaves out kinds never recorded', () => {
    const s = sessionsPerWeek([
      { date: '2026-11-02', kind: 'strength' }, { date: '2026-11-04', kind: 'strength' }, { date: '2026-11-05', kind: 'ride' },
      { date: '2026-11-10', kind: 'mobility' },
    ], ['2026-11-02', '2026-11-09']);
    expect(s.kinds).toEqual(['strength', 'mobility']);
    expect(s.weeks[0].strength).toBe(2);
    expect(s.average.strength).toBe(1);
  });
  it('needs four matched sessions for the balance and names the smallest group', () => {
    const few = strengthBalance([{ patterns: ['push', 'pull'] }], 2);
    expect(few.enough).toBe(false);
    const s = strengthBalance(Array.from({ length: 4 }, () => ({ patterns: ['push', 'push', 'pull', 'hinge', 'squat', 'trunk'] })), 1);
    expect(s.enough).toBe(true);
    expect(s.shares!.push).toBe(40);
    expect(s.balanced).toBe(true);
    const lop = strengthBalance(Array.from({ length: 4 }, () => ({ patterns: ['push', 'push', 'push', 'pull', 'hinge', 'hinge', 'trunk', 'trunk', 'trunk', 'trunk'] })), 0);
    expect(lop.balanced).toBe(false);
    expect(lop.smallest).toBe('pull');
  });
});

describe('the FTP goal', () => {
  const hist = [{ date: '2026-07-01', ftp: 200 }, { date: '2026-09-01', ftp: 205 }, { date: '2026-10-20', ftp: 212 }];
  it('compares the rate needed with the rider’s own', () => {
    const g = ftpGoal(hist, '2026-11-11', 212, 225, '2027-03-01');
    expect(g.needed).toBe(13);
    expect(g.daysLeft).toBe(110);
    expect(g.neededPerWeek).toBeCloseTo(0.8, 1);
    expect(g.ownPerWeek).toBeCloseTo(1.0, 1);
    expect(g.verdict).toBe('ahead');
    const slow = ftpGoal([{ date: '2026-07-01', ftp: 208 }, { date: '2026-10-20', ftp: 212 }], '2026-11-11', 212, 225, '2027-03-01');
    expect(slow.ownPerWeek).toBeCloseTo(0.3, 1);
    expect(slow.verdict).toBe('behind');
  });
  it('gives no verdict on one FTP value', () => {
    expect(ftpGoal([{ date: '2026-10-01', ftp: 212 }], '2026-11-11', 212, 225, '2027-03-01').verdict).toBeUndefined();
  });
});

describe('breathing rate at endurance power', () => {
  it('weights the endurance bands by time and needs five minutes', () => {
    expect(enduranceBreathRate([{ lo: 0.55, hi: 0.6, seconds: 200, br: 16 }, { lo: 0.6, hi: 0.65, seconds: 200, br: 18 }])).toBe(17);
    expect(enduranceBreathRate([{ lo: 0.55, hi: 0.6, seconds: 100, br: 16 }])).toBeUndefined();
    expect(enduranceBreathRate([{ lo: 0.9, hi: 0.95, seconds: 900, br: 30 }])).toBeUndefined();
  });
});
