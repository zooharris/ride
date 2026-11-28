import { describe, expect, it } from 'vitest';
import { assess } from './assessment';
import { addDays, fitnessSeries } from './load';
import { readiness } from './readiness';
import { compare, enough, event, fitter, goal, health, insights, judge, mix, plan, profile, ready, usualWeeklyMove, type InsightFacts, type InsightPlan, type Piece } from './insights';
import type { Ride, Wellness } from './types';

const T = '2026-11-27';
const ws = (d: string) => { const x = new Date(d + 'T00:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
const P = (points: Piece['points'], support: Piece['support'] = 'good', indirect = false): Piece => ({ id: `${points}${Math.random()}`, points, support, indirect, title: '', text: '' });

/** A rider who trains four days a week for `days`, with load growing by `grow` a week. */
function rides(days: number, o: { power?: boolean; tss?: number; grow?: number; zones?: number[] } = {}): Ride[] {
  const out: Ride[] = [];
  for (let k = days; k >= 1; k--) {
    const date = addDays(T, -k), dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (![0, 2, 4, 6].includes(dow)) continue;
    const tss = (o.tss ?? 60) + (o.grow ?? 0) * ((days - k) / 7);
    out.push({ id: date, date, startTime: date, name: 'Ride', type: 'Ride', sport: 'ride', seconds: 5400, tss, averageHr: 135, ...(o.power ? { normalizedPower: 190, averagePower: 175, intensityFactor: 0.75, powerZoneSeconds: o.zones ?? [600, 3900, 300, 400, 200, 0, 0] } : { hrZoneSeconds: o.zones ?? [600, 3900, 300, 400, 200] }) });
  }
  return out;
}
function facts(r: Ride[], over: Partial<InsightFacts> = {}, wellness: Wellness[] = []): InsightFacts {
  const from = r.length ? r[0].date : T;
  const series = fitnessSeries(r.map((x) => ({ date: x.date, tss: x.tss ?? 0 })), from, T);
  const profile = { id: 'me', ftp: 250, lthr: 160, maxHr: 185, weightKg: 75 } as never;
  const assessment = assess({ today: T, profile, rides: r, wellness, planned: [], powerCurve: over.curves?.length ? [5, 60, 300, 1200, 3600].map((s, k) => ({ seconds: s, watts: Math.max(...over.curves!.map((c) => c.w?.[[1, 4, 6, 8, 10][k]] ?? 0)) })) : undefined });
  const last = series[series.length - 1];
  return { today: T, rides: r, wellness, series, assessment, readiness: last ? readiness(wellness.find((w) => w.date === T), wellness.filter((w) => w.date < T && w.date >= addDays(T, -28)), last.tsb) : undefined, curves: [], tests: [], ftpHistory: [], ftp: 250, lthr: 160, plan: null, planned: [], weekStartOf: ws, ...over };
}
const mornings = (days: number, rhr: (k: number) => number, extra: (k: number) => Partial<Wellness> = () => ({})): Wellness[] => Array.from({ length: days }, (_, i) => ({ date: addDays(T, -(days - 1 - i)), restingHr: rhr(days - 1 - i) + (i % 3) - 1, hrv: 60 + (i % 5) - 2, sleepSeconds: 7.2 * 3600 + (i % 4) * 300, ...extra(days - 1 - i) }));
const w = (b20: number, date: string, b5 = 320) => ({ id: date, date, w: [900, 800, 600, 500, 420, 380, b5, 290, b20, 240, 230, 0, 0] });

describe('the rules: how strong a conclusion is', () => {
  it('clear: two well-supported pieces the same way, none contra', () => {
    expect(judge([P('yes'), P('yes')])).toMatchObject({ strength: 'clear', lean: 'yes' });
    expect(judge([P('no'), P('no'), P('level')])).toMatchObject({ strength: 'clear', lean: 'no' });
  });
  it('likely: one well-supported piece, or thin ones, or indirect ones, or a thin piece contra; and it says which', () => {
    expect(judge([P('yes')])).toMatchObject({ strength: 'likely', lean: 'yes', why: 'it rests on one piece of evidence.' });
    expect(judge([P('yes'), P('yes', 'thin')]).why).toBe('only one piece of the evidence is well supported.');
    expect(judge([P('yes', 'thin'), P('yes', 'thin')])).toMatchObject({ strength: 'likely', why: 'the evidence for it is thin.' });
    expect(judge([P('yes', 'good', true), P('yes', 'good', true)])).toMatchObject({ strength: 'likely', why: 'it is judged indirectly.' });
    expect(judge([P('yes'), P('yes'), P('no', 'thin')])).toMatchObject({ strength: 'likely', lean: 'yes' });
    expect(judge([P('yes'), P('yes'), P('no', 'thin')]).why).toContain('one piece of thinner evidence points the other way');
  });
  it('mixed: a well-supported piece each way', () => {
    expect(judge([P('yes'), P('no')]).strength).toBe('mixed');
    expect(judge([P('yes'), P('yes'), P('no')])).toMatchObject({ strength: 'mixed', lean: 'yes' });
  });
  it('nothing moved: "no change", clear only on two well-supported pieces', () => {
    expect(judge([P('level'), P('level')])).toMatchObject({ strength: 'clear', lean: 'level' });
    expect(judge([P('level')])).toMatchObject({ strength: 'likely', lean: 'level' });
  });
  it('two averages differ only beyond twice the uncertainty of their difference, and only with a week of readings each', () => {
    const a = [50, 51, 49, 50, 52, 48, 50, 51], b = [46, 47, 45, 46, 48, 44, 46, 47];
    expect(compare(a, b)).toMatchObject({ moved: true, enough: true });
    expect(compare(a, [50, 52, 49, 51, 50, 48, 51, 50]).moved).toBe(false);
    expect(compare(a.slice(0, 5), b)).toMatchObject({ moved: false, enough: false });
  });
  it('a rider’s usual weekly movement in fitness comes from their own series', () => {
    const flat = Array.from({ length: 100 }, (_, k) => ({ date: addDays(T, k - 99), ctl: 50, atl: 50, tsb: 0 }));
    expect(usualWeeklyMove(flat, T)).toBe(0);
    expect(usualWeeklyMove(flat.map((f, k) => ({ ...f, ctl: 50 + k / 7 })), T)).toBeCloseTo(1, 5);
  });
});

describe('Am I getting fitter?', () => {
  it('too early for a rider with three rides: says what is needed, and what can be said so far', () => {
    const three = [1, 3, 5].map((k) => ({ id: `${k}`, date: addDays(T, -k), startTime: '', name: 'Ride', type: 'Ride', sport: 'ride' as const, seconds: 3600, tss: 50 }));
    const a = fitter(facts(three));
    expect(a.strength).toBe('early');
    expect(a.needs).toContain('six weeks');
    expect(a.needs).toContain('3 activities');
    expect(a.supporting).toEqual([]);
    expect(a.soFar).toMatch(/fitness figure today/);
  });
  it('clear, with power: fitness up beyond its usual movement and a higher best 20 minutes', () => {
    const r = rides(140, { power: true, grow: 4 });
    const a = fitter(facts(r, { curves: [w(240, addDays(T, -60)), w(252, addDays(T, -10))] }));
    expect(a.strength).toBe('clear');
    expect(a.answer).toMatch(/^Yes/);
    expect(a.supporting.map((p) => p.id)).toEqual(['fitness', 'best20']);
    expect(a.contra).toEqual([]);
    expect(a.supporting[1].see).toEqual({ chart: 'power', label: 'the power curve' });
  });
  it('mixed: fitness up but the best 20 minutes down by more than a meter’s accuracy', () => {
    const a = fitter(facts(rides(140, { power: true, grow: 4 }), { curves: [w(260, addDays(T, -60)), w(240, addDays(T, -10))] }));
    expect(a.strength).toBe('mixed');
    expect(a.supporting.map((p) => p.id)).toEqual(['fitness']);
    expect(a.contra.map((p) => p.id)).toEqual(['best20']);
  });
  it('a best 20 minutes within 2% says nothing either way', () => {
    const a = fitter(facts(rides(140, { power: true, grow: 4 }), { curves: [w(250, addDays(T, -60)), w(253, addDays(T, -10))] }));
    expect(a.strength).toBe('likely');
    expect(a.contra).toEqual([]);
  });
  it('likely for a rider with no power: judged from heart rate, and it says so', () => {
    const a = fitter(facts(rides(140, { grow: 4 })));
    expect(a.strength).toBe('likely');
    expect(a.why).toContain('without a power meter');
    expect(a.supporting[0].indirect).toBe(true);
    // a lower resting heart rate adds a second piece, but both are indirect: still likely
    const b = fitter(facts(rides(140, { grow: 4 }), {}, mornings(90, (k) => (k < 42 ? 50 : 55))));
    expect(b.supporting.map((p) => p.id)).toEqual(['fitness', 'rhr']);
    expect(b.strength).toBe('likely');
  });
  it('steady training reads as holding steady, not as a gain', () => {
    const a = fitter(facts(rides(200, { power: true })));
    expect(a.answer).toBe('You are holding steady.');
    expect(a.supporting[0].points).toBe('level');
  });
});

describe('Am I ready to train hard today?', () => {
  it('too early without a week of training', () => { expect(ready(facts(rides(5))).strength).toBe('early'); });
  it('on training load alone it is only likely, and says why', () => {
    const a = ready(facts(rides(120)));
    expect(a.strength).toBe('likely');
    expect(a.why).toContain('training load alone');
    expect(a.supporting[0].id).toBe('form');
  });
  it('clear when the overnight readings and the form agree', () => {
    const a = ready(facts(rides(120), {}, mornings(40, () => 50)));
    expect(a.strength).toBe('clear');
    expect(a.answer).toMatch(/^Yes/);
    expect(a.supporting.length).toBeGreaterThanOrEqual(3);
  });
});

describe('What am I good at, and what holds me back?', () => {
  it('is not shown without a power meter, and the reason is given', () => {
    const a = profile(facts(rides(120)));
    expect('reason' in a && a.reason).toContain('power meter');
  });
  it('names the limiter from the rider’s own efforts against their own FTP; an old best makes it only likely', () => {
    const fresh = profile(facts(rides(140, { power: true }), { curves: [w(262, addDays(T, -10), 270)] }));
    expect('strength' in fresh && fresh.strength).toBe('clear');
    expect('strength' in fresh && fresh.answer).toContain('What holds you back most is');
    const old = profile(facts(rides(140, { power: true }), { curves: [w(262, addDays(T, -80), 270)] }));
    expect('strength' in old && old.strength).toBe('likely');
    expect('strength' in old && old.why).toContain('more than six weeks old');
  });
});

describe('Am I riding enough, and regularly?', () => {
  it('too early for a rider with three rides', () => {
    const three = [1, 3, 5].map((k) => ({ id: `${k}`, date: addDays(T, -k), startTime: '', name: 'Ride', type: 'Ride', sport: 'ride' as const, seconds: 3600, tss: 50 }));
    const a = enough(facts(three));
    expect(a.strength).toBe('early');
    expect(a.card).toEqual({ value: '3', label: 'activities so far' });
  });
  it('clear for four rides a week without a blank week', () => {
    const a = enough(facts(rides(120)));
    expect(a).toMatchObject({ strength: 'clear' });
    expect(a.answer).toMatch(/^Yes\./);
    expect(a.supporting.map((p) => p.id)).toEqual(['who', 'regular']);
  });
  it('mixed for long rides with blank weeks between', () => {
    const r = rides(120).filter((x) => Math.round((Date.parse(ws(T)) - Date.parse(ws(x.date))) / 864e5 / 7) % 2 === 0).map((x) => ({ ...x, seconds: 4 * 3600 }));
    const a = enough(facts(r));
    expect(a.strength).toBe('mixed');
    expect(a.answer).toBe('Enough, but not regularly.');
  });
});

describe('questions that depend on a plan or a goal', () => {
  const planOf = (goalKind: InsightPlan['goal'], r: Ride[], shift = 0): InsightPlan => {
    const series = fitnessSeries(r.map((x) => ({ date: x.date, tss: x.tss ?? 0 })), r[0].date, T);
    return { goal: goalKind, start: addDays(T, -56), goalDate: addDays(T, 60), requiredCtl: 30, projection: [...series.filter((s) => s.date >= addDays(T, -56)).map((s) => ({ ...s, ctl: s.ctl + shift })), { date: addDays(T, 60), ctl: series[series.length - 1].ctl + 8 + shift, atl: 0, tsb: 0 }] };
  };
  it('a rider with no plan is asked about the mix, never about a plan, an event or a goal', () => {
    const f = facts(rides(120, { power: true }));
    expect(plan(f)).toBeUndefined(); expect(event(f)).toBeUndefined(); expect(goal(f)).toBeUndefined();
    const m = mix(f)!;
    expect(m.strength).toBe('clear');
    expect(m.answer).toMatch(/^Yes/);
    const ids = insights(f).answers.map((a) => a.id);
    expect(ids).toContain('mix');
    expect(ids).not.toContain('plan');
  });
  it('the mix is mixed when most riding is easy but none is hard', () => {
    const m = mix(facts(rides(120, { power: true, zones: [600, 4200, 600, 0, 0, 0, 0] })))!;
    expect(m.strength).toBe('mixed');
    expect(m.supporting.map((p) => p.id)).toEqual(['easy']);
    expect(m.contra.map((p) => p.id)).toEqual(['hard', 'mid']);
  });
  it('a rider with a plan is asked about the plan, not the mix; too early until six sessions have come due', () => {
    const r = rides(120, { power: true });
    const pl = planOf({ kind: 'general', weeks: 12 }, r);
    const f = facts(r, { plan: pl, planned: [{ date: addDays(T, -3), status: 'completed' }] });
    expect(mix(f)).toBeUndefined();
    expect(plan(f)!.strength).toBe('early');
    const due = Array.from({ length: 12 }, (_, k) => ({ date: addDays(T, -2 - k * 3), status: k % 6 === 0 ? 'missed' : 'completed' }));
    const g = plan(facts(r, { plan: pl, planned: due }))!;
    expect(g.supporting.map((p) => p.id)).toContain('done');
    expect(g.strength).toBe('clear');
    // a general goal has no finish line: listed at the foot with the reason, not shown as a card
    const all = insights(facts(r, { plan: pl, planned: due }));
    expect(all.notShown.map((n) => n.id)).toEqual(['goal', 'health']);
  });
  it('the plan is mixed when the sessions are done but fitness is behind the plan’s line', () => {
    const r = rides(120, { power: true });
    const due = Array.from({ length: 12 }, (_, k) => ({ date: addDays(T, -2 - k * 3), status: 'completed' }));
    const g = plan(facts(r, { plan: planOf({ kind: 'general', weeks: 12 }, r, 15), planned: due }))!;
    expect(g.strength).toBe('mixed');
    expect(g.contra.map((p) => p.id)).toEqual(['line']);
  });
  it('an event: on the plan’s line and the line reaches what the event needs, but a forecast is never more than likely', () => {
    const r = rides(120, { power: true });
    const a = event(facts(r, { plan: planOf({ kind: 'event', date: addDays(T, 60), name: 'Spring Fondo', eventType: 'gran-fondo', priority: 'A' }, r) }))!;
    expect(a.strength).toBe('likely');
    expect(a.why).toContain('forecast');
    expect(a.answer).toMatch(/^Probably/);
    expect(a.card!.label).toContain('days to Spring Fondo');
    const short = event(facts(r, { plan: { ...planOf({ kind: 'event', date: addDays(T, 60), name: 'Spring Fondo', eventType: 'gran-fondo', priority: 'A' }, r), requiredCtl: 90 } }))!;
    expect(short.strength).toBe('mixed');
  });
  it('a rider with a weight goal: too early without weighings; then judged on the trend and the rate', () => {
    const r = rides(120);
    const pl = planOf({ kind: 'weight', weeks: 12, targetKg: 78 }, r);
    expect((goal(facts(r, { plan: pl })) as { strength: string }).strength).toBe('early');
    const falling = mornings(56, () => 50, (k) => ({ weightKg: 80 + k * 0.06 + (k % 3) * 0.1 }));
    const a = goal(facts(r, { plan: pl }, falling)) as ReturnType<typeof fitter>;
    expect(a.id).toBe('goal');
    expect(a.supporting.map((p) => p.id)).toContain('trend');
    expect(a.strength).toBe('likely');
    expect(a.card!.label).toContain('goal 78.0 kg');
    const level = mornings(56, () => 50, (k) => ({ weightKg: 82 + (k % 3) * 0.2 }));
    expect((goal(facts(r, { plan: pl }, level)) as ReturnType<typeof fitter>).answer).toContain('holding level');
    // in pounds for a rider who uses them
    expect((goal(facts(r, { plan: pl, pounds: true }, falling)) as ReturnType<typeof fitter>).card!.value).toMatch(/lb$/);
  });
});

describe('Is my health improving?', () => {
  it('is not shown without body readings', () => { const a = health(facts(rides(120))); expect('reason' in a && a.reason).toContain('body readings'); });
  it('likely on one reading that fell beyond chance, however active the rider; always with its caution', () => {
    const a = health(facts(rides(120), {}, mornings(90, (k) => (k < 42 ? 50 : 55)))) as ReturnType<typeof fitter>;
    expect(a.supporting.map((p) => p.id)).toEqual(['rhr', 'who']);
    expect(a.strength).toBe('likely');   // one reading; being active is not a reading that changed
    expect(a.caution).toContain('not a medical device');
  });
  it('holding steady when nothing moved beyond the rider’s own variation', () => {
    const a = health(facts([], {}, mornings(90, () => 52))) as ReturnType<typeof fitter>;
    expect(a.answer).toBe('It is holding steady.');
    expect(a.strength).toBe('clear');
  });
});

describe('every question for a rider', () => {
  it('a rider with three rides gets "too early" answers and reasons, never a guess', () => {
    const three = [1, 3, 5].map((k) => ({ id: `${k}`, date: addDays(T, -k), startTime: '', name: 'Ride', type: 'Ride', sport: 'ride' as const, seconds: 3600, tss: 50 }));
    const all = insights(facts(three));
    expect(all.answers.map((a) => [a.id, a.strength])).toEqual([['fitter', 'early'], ['ready', 'early'], ['enough', 'early'], ['mix', 'early']]);
    expect(all.notShown.map((n) => n.id)).toEqual(['profile', 'health']);
    for (const a of all.answers) { expect(a.needs!.length).toBeGreaterThan(20); expect(a.supporting).toEqual([]); }
  });
});
