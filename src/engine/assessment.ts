import type { Fitness, PlannedWorkout, Profile, Ride, Wellness } from './types';
import { addDays, fitnessSeries, historyStart, rideIntensity } from './load';
import { isSteadyAerobicRide } from './progress';
import { rideHrZones, rideLadders } from './zones';

/**
 * What the data say about this rider. Every number carries a confidence and a
 * sentence, so the planner can show its reasoning and fall back to a prior
 * when the evidence is thin. Nothing here is a rule; it is evidence.
 */
export type Confidence = 'none' | 'thin' | 'good';

export interface Evidence<T> { value: T; confidence: Confidence; note: string }

export type PowerCurve = Array<{ seconds: number; watts: number }>;

export type Limiter = 'durability' | 'threshold' | 'vo2max' | 'anaerobic' | 'base';

export interface Assessment {
  asOf: string;
  fitness: Fitness;                                  // today
  rampRate: Evidence<number>;                        // fitness points per week over the last 6 weeks
  weeklyHours: Evidence<number>;                     // average over the last 4 weeks
  weeklyTss: Evidence<number>;
  longestRide: Evidence<number>;                     // seconds, last 8 weeks
  decoupling: Evidence<number>;                      // % on rides over 2 h, last 8 weeks
  efficiencyTrend: Evidence<number>;                 // % change in EF on endurance rides, first half vs second half of 8 weeks
  powerProfile: Evidence<{ p5s: number; p1m: number; p5m: number; p20m: number }>;  // as multiples of FTP
  afterStrength: Evidence<number>;                   // readiness penalty 0..1 the day after a strength day (0 = none seen)
  afterLongRide: Evidence<number>;                   // same, the day after a ride over 2.5 h
  afterHardRide: Evidence<number>;                   // same, the day after a ride at IF 0.85 or more
  ftpStatus: Evidence<'fresh' | 'stale' | 'likely-higher' | 'likely-lower'>;   // whether the FTP in use looks right
  compliance: Evidence<number>;                      // share of planned rides completed, last 6 weeks
  limiters: Limiter[];                               // ordered, strongest first
  summary: string[];                                 // sentences for the screen
}

export interface AssessmentInput {
  today: string;
  profile: Profile;
  rides: Ride[];
  wellness: Wellness[];
  planned: PlannedWorkout[];
  powerCurve?: PowerCurve;
}

const none = <T,>(value: T, note: string): Evidence<T> => ({ value, confidence: 'none', note });
const ev = <T,>(value: T, n: number, good: number, note: string): Evidence<T> => ({ value, confidence: n >= good ? 'good' : n > 0 ? 'thin' : 'none', note });

export function assess(inp: AssessmentInput): Assessment {
  const { today, wellness } = inp;
  const rides = inp.rides.filter((r) => r.sport === 'ride');   // riding metrics come from rides; every activity counts toward load
  const allActs = inp.rides;
  const from = historyStart(allActs.map((r) => r.date), today);
  const loads = allActs.filter((r) => r.date >= from).map((r) => ({ date: r.date, tss: r.tss ?? 0 }));
  const series = fitnessSeries(loads, from, today);
  const fitness = series[series.length - 1] ?? { date: today, ctl: 0, atl: 0, tsb: 0 };

  // Ramp rate: fitness now versus six weeks ago.
  const sixAgo = series.find((f) => f.date === addDays(today, -42));
  const rampRate = sixAgo && rides.length >= 6
    ? ev(round1((fitness.ctl - sixAgo.ctl) / 6), rides.filter((r) => r.date >= addDays(today, -42)).length, 10, `Fitness has moved ${fmtSigned(round1((fitness.ctl - sixAgo.ctl) / 6))} points a week over six weeks.`)
    : none(0, 'Not enough ride history yet to see how fast your fitness has been climbing.');

  // Hours and load, last four weeks.
  // Averaged over the weeks the synced history actually covers: two days of
  // history divided by four weeks would read as a quarter of the real volume.
  const last4 = rides.filter((r) => r.date >= addDays(today, -28));
  const oldest = rides.reduce((m, r) => (r.date < m ? r.date : m), today);
  const coveredDays = Math.min(28, Math.max(1, Math.round((Date.parse(today) - Date.parse(oldest)) / 864e5) + 1));
  const weeks = Math.max(1, coveredDays / 7);
  const span = coveredDays >= 28 ? 'over the last four weeks' : `over the last ${coveredDays} days (all the history synced so far)`;
  const hours = last4.reduce((s, r) => s + r.seconds, 0) / 3600 / weeks;
  const weeklyHours = ev(round1(hours), last4.length, 8, last4.length ? `About ${round1(hours)} hours a week ${span}.` : 'No rides in the last four weeks.');
  const tssWeek = Math.round(last4.reduce((s, r) => s + (r.tss ?? 0), 0) / weeks);
  const weeklyTss = ev(tssWeek, last4.length, 8, `About ${tssWeek} TSS a week ${span}.`);

  // Longest ride, last eight weeks.
  const last8 = rides.filter((r) => r.date >= addDays(today, -56));
  const longest = last8.reduce((m, r) => Math.max(m, r.seconds), 0);
  const longestRide = ev(longest, last8.length, 4, longest ? `Longest ride in eight weeks: ${hm(longest)}.` : 'No long rides on record yet.');

  // Aerobic decoupling on steady rides of two hours or more (the same rule as the Progress page; see isSteadyAerobicRide).
  const steady = last8.filter((r) => isSteadyAerobicRide(r, inp.profile.lthr, undefined, rideHrZones(inp.profile)));
  const longOnes = steady.filter((r) => r.seconds >= 7200 && r.decoupling != null);
  const dec = longOnes.length ? longOnes.reduce((s, r) => s + (r.decoupling ?? 0), 0) / longOnes.length : 0;
  const decoupling = ev(round1(dec), longOnes.length, 3, longOnes.length
    ? `Heart-rate drift on steady long rides averages ${round1(dec)}%${dec <= 5 ? ', a sign the aerobic base is solid' : dec <= 8 ? ', so there is some base still to build' : ', so base work will pay first'}.`
    : 'No steady rides of two hours or more with heart rate and power yet, so aerobic durability is unknown.');

  // Efficiency factor trend on steady endurance rides, first half of the window vs second.
  const endRides = steady.filter((r) => r.efficiencyFactor);
  const mid = addDays(today, -28);
  const ef = (list: Ride[]) => list.length ? list.reduce((s, r) => s + (r.efficiencyFactor ?? 0), 0) / list.length : 0;
  const efA = ef(endRides.filter((r) => r.date < mid));
  const efB = ef(endRides.filter((r) => r.date >= mid));
  const efTrend = efA && efB ? Math.round(((efB - efA) / efA) * 100) : 0;
  const efficiencyTrend = ev(efTrend, Math.min(endRides.filter((r) => r.date < mid).length, endRides.filter((r) => r.date >= mid).length), 3, efA && efB
    ? `Watts per heartbeat on endurance rides ${efTrend >= 0 ? 'up' : 'down'} ${Math.abs(efTrend)}% over the last month.`
    : 'Not enough endurance rides yet to see whether aerobic efficiency is improving.');

  // Power profile from the power curve, as multiples of FTP.
  const curve = inp.powerCurve ?? [];
  const at = (s: number) => { const p = curve.filter((c) => c.seconds <= s).sort((a, b) => b.seconds - a.seconds)[0]; return p ? p.watts / inp.profile.ftp : 0; };
  const prof = { p5s: at(5), p1m: at(60), p5m: at(300), p20m: at(1200) };
  const powerProfile = curve.length
    ? ev(prof, curve.length, 5, `Best efforts versus FTP: 5 s ×${prof.p5s.toFixed(2)}, 1 min ×${prof.p1m.toFixed(2)}, 5 min ×${prof.p5m.toFixed(2)}, 20 min ×${prof.p20m.toFixed(2)}.`)
    : none(prof, 'Power curve not synced yet; limiters are judged from ride data alone.');

  // Recovery response: readiness the day after strength days, and after long rides, against the rest.
  const hrvBase = mean(wellness.slice(-28).map((w) => w.hrv));
  const rhrBase = mean(wellness.slice(-28).map((w) => w.restingHr));
  const penaltyAfter = (isDayBefore: (d: string) => boolean): { value: number; n: number } => {
    const deltas: number[] = [];
    for (const w of wellness.slice(-56)) {
      if (!isDayBefore(addDays(w.date, -1))) continue;
      if (w.hrv && hrvBase) deltas.push((hrvBase - w.hrv) / hrvBase);
      else if (w.restingHr && rhrBase) deltas.push((w.restingHr - rhrBase) / rhrBase * 3);
    }
    const m = mean(deltas) ?? 0;
    return { value: clamp(round2(m * 4), 0, 1), n: deltas.length };
  };
  const strengthDates = new Set(allActs.filter((r) => r.sport === 'strength').map((r) => r.date));
  const afterS = penaltyAfter((d) => strengthDates.has(d));
  const afterStrength = strengthDates.size
    ? ev(afterS.value, afterS.n, 6, afterS.n ? (afterS.value < 0.15 ? 'Mornings after strength sessions look like any other morning; a hard ride after a lift costs you little.' : afterS.value < 0.4 ? 'Mornings after strength sessions are a little flatter; the plan prefers easy riding then, when it has a choice.' : 'Mornings after strength sessions are noticeably flatter; the plan keeps hard rides off those days.') : 'Strength sessions are on record but no wellness data follows them yet; assuming a mild cost.')
    : none(0.3, 'No strength sessions on record yet; assuming a mild cost the day after lifting.');
  const longDates = new Set(rides.filter((r) => r.seconds >= 9000).map((r) => r.date));
  const afterL = penaltyAfter((d) => longDates.has(d));
  const afterLongRide = ev(afterL.value, afterL.n, 4, afterL.n ? (afterL.value < 0.15 ? 'You bounce back from long rides; two long days in a row is on the table.' : afterL.value < 0.4 ? 'Long rides leave a small dent the next morning; back-to-back long days are fine with the second one easier.' : 'Long rides leave a clear dent the next morning; the plan spaces them out.') : 'No wellness data after long rides yet; assuming they cost a little.');

  const hardDates = new Set(rides.filter((r) => (rideIntensity(r, inp.profile.lthr, rideLadders(inp.profile)) ?? 0) >= 0.85 && r.seconds >= 2400).map((r) => r.date));
  const afterH = penaltyAfter((d) => hardDates.has(d));
  const afterHardRide = ev(afterH.value, afterH.n, 4, afterH.n ? (afterH.value < 0.15 ? 'Hard rides do not show in the next morning; two hard days back to back are possible.' : afterH.value < 0.4 ? 'Hard rides leave a small dent the next morning; the plan prefers a gap between them.' : 'Hard rides leave a clear dent the next morning; the plan spaces them well apart.') : 'No wellness data after hard rides yet; assuming a day between them is best.');

  // Is the FTP in use still right? Intervals.icu estimates FTP from hard rides; a
  // long gap without any hard effort, or an estimate drifting from the number in
  // use, is what makes a test worth its place.
  const recentEst = rides.filter((r) => r.date >= addDays(today, -42) && r.eftp).map((r) => r.eftp!);
  const bestEst = recentEst.length ? Math.max(...recentEst) : 0;
  const hardRecent = rides.filter((r) => r.date >= addDays(today, -42) && (rideIntensity(r, inp.profile.lthr, rideLadders(inp.profile)) ?? 0) >= 0.9).length;
  let ftpStatus: Assessment['ftpStatus'];
  if (!rides.length) ftpStatus = none('stale', 'No rides yet, so a test early on sets the numbers the plan is built on.');
  else if (bestEst && bestEst >= inp.profile.ftp * 1.03) ftpStatus = ev('likely-higher', recentEst.length, 2, `Intervals.icu's estimate from recent rides is about ${Math.round(bestEst)} W against ${inp.profile.ftp} W in use; a test would likely raise the number.`);
  else if (bestEst && bestEst <= inp.profile.ftp * 0.94 && hardRecent >= 2) ftpStatus = ev('likely-lower', recentEst.length, 2, `Recent hard rides estimate FTP nearer ${Math.round(bestEst)} W than the ${inp.profile.ftp} W in use; targets may be set too high.`);
  else if (hardRecent === 0) ftpStatus = ev('stale', 1, 1, 'No hard efforts in six weeks, so the FTP in use is unverified; a test early in the plan is worth it.');
  else ftpStatus = ev('fresh', hardRecent, 2, 'Recent hard rides agree with the FTP in use; no test needed yet.');

  // Compliance over the last six weeks.
  const past = inp.planned.filter((p) => p.date >= addDays(today, -42) && p.date < today);
  const done = past.filter((p) => p.status === 'completed').length;
  const compliance = ev(past.length ? round2(done / past.length) : 1, past.length, 6, past.length ? `${done} of ${past.length} planned rides completed in six weeks.` : 'No planned rides in the record yet.');

  // Limiters, strongest first, from the evidence above.
  const limiters: Limiter[] = [];
  if (decoupling.confidence !== 'none' && dec > 6) limiters.push('durability');
  if (powerProfile.confidence !== 'none') {
    if (prof.p5m && prof.p5m < 1.12) limiters.push('vo2max');
    if (prof.p1m && prof.p1m < 1.4) limiters.push('anaerobic');
    if (prof.p20m && prof.p20m < 1.02) limiters.push('threshold');
  }
  if (weeklyHours.confidence !== 'none' && hours < 5) limiters.push('base');
  if (limiters.length === 0) limiters.push(decoupling.confidence === 'none' ? 'base' : 'threshold');

  const summary = [weeklyHours, longestRide, decoupling, efficiencyTrend, powerProfile, ftpStatus, afterStrength, afterLongRide, afterHardRide, compliance, rampRate].map((e) => e.note);
  return { asOf: today, fitness, rampRate, weeklyHours, weeklyTss, longestRide, decoupling, efficiencyTrend, powerProfile, afterStrength, afterLongRide, afterHardRide, ftpStatus, compliance, limiters, summary };
}

export const LIMITER_LABEL: Record<Limiter, string> = {
  durability: 'aerobic durability on long rides',
  threshold: 'sustained power at threshold',
  vo2max: 'top-end aerobic power (VO2max)',
  anaerobic: 'short, sharp power',
  base: 'aerobic base and volume',
};

function mean(xs: Array<number | undefined>): number | undefined {
  const v = xs.filter((x): x is number => typeof x === 'number' && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
function fmtSigned(n: number) { return (n > 0 ? '+' : '') + n; }
export function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}
