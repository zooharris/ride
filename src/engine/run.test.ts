import { describe, expect, it } from 'vitest';
import { generatePlan, type Availability, type PlanRequest } from './planner';
import { generateRun } from './sessions';
import { runMinutes, runSeconds, runStepsLine, paceHint, parsePace, formatPace } from './run';
import { runEvent } from '../sync/intervals';
import { assess } from './assessment';
import { addDays } from './load';
import type { Profile, Ride, Wellness } from './types';

const profile: Profile = { name: 'T', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 90, basis: 'power', masters: true, units: 'imperial', rideDays: [0, 6], hoursPerWeek: 7 };
const today = '2026-10-19';   // a Monday

const rides: Ride[] = []; const wellness: Wellness[] = [];
for (let i = 84; i >= 1; i--) {
  const d = addDays(today, -i), dw = new Date(d + 'T00:00:00').getDay();
  const r = (h: number, IF: number): Ride => ({ id: d + h, date: d, startTime: d, name: 'r', type: 'Ride', sport: 'ride', seconds: h * 3600, tss: Math.round(h * 3600 * IF * IF / 36), normalizedPower: IF * 250, averageHr: 140, intensityFactor: IF });
  if (dw === 6) rides.push(r(1.75, 0.82));
  if (dw === 0) rides.push(r(2.75, 0.68));
  if (dw === 3) rides.push(r(1.25, 0.72));
  wellness.push({ date: d, hrv: 50, restingHr: 50, sleepSeconds: 7 * 3600 });
}
const assessment = assess({ today, profile, rides, wellness, planned: [] });

// Sun 4 h, Mon 0.5, Tue 0.5, Wed 1.5, Thu 0.5, Fri 0, Sat 4: three short days a ride cannot use.
const week = (over: Partial<Availability> = {}): Availability => ({
  hours: [4, 0.5, 0.5, 1.5, 0.5, 0, 4], outdoor: [true, false, false, false, false, false, true], noBike: [false, false, false, false, false, false, false],
  equipment: ['dumbbells', 'bench', 'bodyweight', 'outdoor-walk'], pins: [], ...over,
});
const req = (av: Availability, over: Partial<PlanRequest> = {}): PlanRequest => ({
  start: today, goal: { kind: 'event', date: '2027-02-06', name: 'Spring century', eventType: 'century', distanceKm: 161, climbingM: 900, priority: 'A' },
  availability: av, basis: 'power', masters: true, profile, assessment, ...over,
});
const dowOf = (d: string) => new Date(d + 'T00:00:00').getDay();
const QUALITY = ['sweetspot', 'threshold', 'vo2max', 'anaerobic'];

describe('runs: the generator', () => {
  it('every kind adds up: minutes are the steps, strides six of 20 s, tempo three of 8 min', () => {
    for (const kind of ['easy', 'long', 'strides', 'tempo', 'hills'] as const) {
      const w = generateRun({ kind, minutes: kind === 'long' ? 60 : 35, where: 'outdoor', reason: 'r' });
      expect(w.kind).toBe('run');
      expect(w.minutes).toBe(runMinutes(w.run));
      expect(w.estimatedTss).toBeGreaterThan(0);
    }
    const strides = generateRun({ kind: 'strides', minutes: 35, where: 'outdoor', reason: 'r' });
    expect(strides.minutes).toBe(35);
    const s = strides.run!.steps.find((x) => x.repeat)!;
    expect([s.repeat, s.seconds]).toEqual([6, 20]);
    const tempo = generateRun({ kind: 'tempo', minutes: 44, where: 'outdoor', reason: 'r' });
    const t = tempo.run!.steps.find((x) => x.repeat)!;
    expect([t.repeat, t.seconds]).toEqual([3, 480]);
    expect(runSeconds(tempo.run)).toBe((10 + 24 + 6 + 5) * 60);
    expect(runStepsLine(tempo)).toMatch(/3 × 8 min at upper zone 3 into zone 4 \(tempo\), 3 min easy between/);
    expect(runStepsLine(tempo, { lthr: 154, maxHr: 186, footLthr: 158, footHrZoneMode: 'abs', footHrZoneTops: [120, 135, 148, 158, 170, 178] })).toMatch(/8 min at upper zone 3 into zone 4 \(143–158 bpm\)/);
  });
  it('pace is a hint from the threshold pace, in the rider’s units', () => {
    const t = parsePace('8:00', true)!;            // 8:00 a mile
    expect(formatPace(t, true)).toBe('8:00');
    expect(paceHint('easy', t, true)).toMatch(/per mile$/);
    expect(paceHint('walk', t, true)).toBeUndefined();
    expect(paceHint('easy', undefined, true)).toBeUndefined();
  });
});

describe('runs: to the Garmin', () => {
  it('one line per step, repeats as a block, bands as shares of the foot threshold read off the foot table', () => {
    const w = generateRun({ kind: 'tempo', minutes: 44, where: 'outdoor', reason: 'Tempo.' });
    const ev = runEvent(w, '2026-10-25', { maxHr: 180, lthr: 160 });   // no foot table: the standard shares
    expect(ev.type).toBe('Run');
    expect(ev.description).toMatch(/- 10m 82-89% LTHR/);           // easy = zone 2 = 82–89% of threshold
    expect(ev.description).toMatch(/tempo 3x\n- 8m 92-100% LTHR\n- 3m 82-89% LTHR/);
    const strides = runEvent(generateRun({ kind: 'strides', minutes: 35, where: 'outdoor', reason: 'S.' }), '2026-10-25', { maxHr: 180, lthr: 160 });
    expect(strides.description).toMatch(/stride 6x\n- 20s 100-106% LTHR\n- 1m 20-86% LTHR/);
    // with a foot table of the rider's own, the shares come from it: zone 2 = 121–135 of 158
    const own = runEvent(w, '2026-10-25', { maxHr: 186, lthr: 154, footLthr: 158, footHrZoneMode: 'abs', footHrZoneTops: [120, 135, 148, 158, 170, 178] });
    expect(own.description).toMatch(/- 10m 76-86% LTHR/);
  });
});

describe('runs: the planner', () => {
  const sessions = (av: Availability, over: Partial<PlanRequest> = {}) => generatePlan(req(av, over)).weeks;
  it('with runs on, short days become easy runs, never the day before a quality ride or the day after the long ride, within the caps', () => {
    const weeks = sessions(week({ may: { strength: true, walk: true, run: true, mobility: true } }));
    let seen = 0;
    for (const w of weeks) {
      const runs = w.sessions.filter((s) => s.kind === 'run');
      seen += runs.length;
      const cap = w.phase === 'base' ? 2 : w.phase === 'taper' ? 0 : 1;
      expect(runs.length).toBeLessThanOrEqual(cap);
      for (const r of runs) {
        const next = w.sessions.find((s) => s.kind === 'ride' && s.date === addDays(r.date, 1));
        expect(QUALITY.includes(next?.type ?? '')).toBe(false);
        const before = w.sessions.find((s) => s.kind === 'ride' && s.date === addDays(r.date, -1));
        expect(before?.type).not.toBe('long');
        expect(r.workout.name).toMatch(/easy run|long run|^Strides/);   // the planner never places tempo or hills
      }
    }
    expect(seen).toBeGreaterThan(0);
    // none in the last seven days before the event
    expect(weeks.flatMap((w) => w.sessions).filter((s) => s.kind === 'run' && s.date > addDays('2027-02-06', -7))).toHaveLength(0);
  });
  it('with runs off nothing changes, and a saved week without the switches plans exactly as before', () => {
    const before = sessions(week());
    const off = sessions(week({ may: { strength: true, walk: true, run: false, mobility: true } }));
    const sig = (ws: typeof before) => ws.flatMap((w) => w.sessions.map((s) => `${s.date}|${s.kind}|${s.workout.name}`)).join(';');
    expect(sig(off)).toBe(sig(before));
    expect(before.flatMap((w) => w.sessions).some((s) => s.kind === 'run')).toBe(false);
  });
  it('runs on: identical to runs off apart from the days that became runs', () => {
    const off = sessions(week({ may: { strength: true, walk: true, run: false, mobility: true } }));
    const on = sessions(week({ may: { strength: true, walk: true, run: true, mobility: true } }));
    const runDates = new Set(on.flatMap((w) => w.sessions).filter((s) => s.kind === 'run').map((s) => s.date));
    const rest = (ws: typeof on) => ws.flatMap((w) => w.sessions).filter((s) => !runDates.has(s.date) && s.kind !== 'ride').map((s) => `${s.date}|${s.kind}|${s.workout.name}`).join(';');
    expect(rest(on)).toBe(rest(off));
  });
  it('strength off: none in any week; never strength on Saturday: none on Saturday, the count kept elsewhere', () => {
    const noStrength = sessions(week({ may: { strength: false, walk: true, run: false, mobility: true } }));
    expect(noStrength.flatMap((w) => w.sessions).filter((s) => s.kind === 'strength')).toHaveLength(0);
    const base = sessions(week({ hours: [4, 1, 1, 1.5, 1, 1, 4] }));
    const notSat = sessions(week({ hours: [4, 1, 1, 1.5, 1, 1, 4], never: [{ dow: 6, kind: 'strength' }] }));
    const strength = (ws: typeof base) => ws.flatMap((w) => w.sessions).filter((s) => s.kind === 'strength');
    expect(strength(notSat).filter((s) => dowOf(s.date) === 6)).toHaveLength(0);
    expect(strength(notSat).length).toBe(strength(base).length);
  });
  it('never a ride on Wednesday: no ride on Wednesday; a pin beats a never for the same day and kind', () => {
    const noWed = sessions(week({ never: [{ dow: 3, kind: 'ride' }] }));
    expect(noWed.flatMap((w) => w.sessions).filter((s) => s.kind === 'ride' && dowOf(s.date) === 3)).toHaveLength(0);
    const pinned = sessions(week({ pins: [{ dow: 3, kind: 'ride' }], never: [{ dow: 3, kind: 'ride' }] }));
    expect(pinned.flatMap((w) => w.sessions).filter((s) => s.kind === 'ride' && dowOf(s.date) === 3).length).toBeGreaterThan(0);
  });
  it('a day pinned to a run always gets one, even with runs off', () => {
    const w = sessions(week({ pins: [{ dow: 2, kind: 'run' }] }));
    const loading = w.filter((x) => x.phase === 'base');
    for (const wk of loading) expect(wk.sessions.some((s) => s.kind === 'run' && dowOf(s.date) === 2)).toBe(true);
  });
});

describe('the swing goes first', () => {
  it('every Library strength session with a swing in it starts with the swing', async () => {
    const { readyMadeSessions } = await import('../library/sessions');
    const all = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars']).filter((w) => w.kind === 'strength');
    let seen = 0;
    for (const w of all) {
      const ex = w.exercises!.map((e) => e.name);
      const i = ex.findIndex((n) => /swing/i.test(n));
      if (i >= 0) { seen++; expect(i, w.name).toBe(0); }
    }
    expect(seen).toBeGreaterThan(3);
  });
});

describe('runs: load and mornings', () => {
  it('a run scores from heart rate first, and at 55 an hour without heart rate or Intervals load', async () => {
    const { scoreActivity } = await import('../sync/syncService');
    const withHr: Ride = { id: 'r1', date: '2026-10-20', startTime: '', name: 'Run', type: 'Run', sport: 'run', seconds: 3600, averageHr: 130, icuLoad: 99 };
    scoreActivity(withHr, profile);
    expect(withHr.tssBasis).toBe('heart-rate');
    const bare: Ride = { id: 'r2', date: '2026-10-20', startTime: '', name: 'Run', type: 'Run', sport: 'run', seconds: 1800 };
    scoreActivity(bare, profile);
    expect([bare.tss, bare.tssBasis]).toEqual([28, 'estimate']);
  });
  it('a 40-minute run at 90% of threshold heart rate is a hard day; a 30-minute easy run is "the morning after a run"', async () => {
    const { dayKind, DAY_KIND_PHRASE, morningsAfter } = await import('./mornings');
    const hard: Ride = { id: 'h', date: '2026-10-20', startTime: '', name: 'Run', type: 'Run', sport: 'run', seconds: 2400, averageHr: 144 };
    const easy: Ride = { id: 'e', date: '2026-10-21', startTime: '', name: 'Run', type: 'Run', sport: 'run', seconds: 1800, averageHr: 120 };
    expect(dayKind([hard], 160)).toBe('hard');
    expect(DAY_KIND_PHRASE[dayKind([easy], 160)]).toBe('the morning after a run');
    const rows = morningsAfter([easy], [{ date: '2026-10-22', hrv: 40 }, { date: '2026-10-23', hrv: 50 }], '2026-10-01', '2026-10-31', 160);
    expect(rows.find((r) => r.kind === 'run')?.n).toBe(1);
  });
});
