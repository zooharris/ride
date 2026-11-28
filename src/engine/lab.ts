import type { Ride } from './types';
import { addDays } from './load';
import { CURVE_SECONDS, weeklyZones } from './progress';
import { aerobicTrend } from './aerobicTrend';
import { fitCp, FIT_SECONDS } from './cpFit';
import type { LateEfforts } from './progressMore';
import type { MeasureDef, MeasureExtra, MeasureGroup, Measures, Values } from './measures';

/**
 * The Lab (27 Nov 2026): every measure Antogo works out, sorted into families, each a value per day or per week so
 * it opens in the one large view. The standing measures (measures.ts) are joined here by the ones the app already
 * worked out elsewhere (on an activity's page, in the per-ride cache, in the readiness score) and never drew over
 * time. Nothing here knows about one rider: a measure with no data has no values, and is listed with what it needs.
 */

export type LabFamily = 'load' | 'power' | 'zones' | 'heart' | 'breathing' | 'durability' | 'volume' | 'body' | 'estimates' | 'pedalling';

export const LAB_FAMILIES: Array<{ id: LabFamily; name: string; about: string }> = [
  { id: 'load', name: 'Load and form', about: 'How much training you carry, and how fresh you are.' },
  { id: 'power', name: 'Power', about: 'What your legs produce, ride by ride and at your best.' },
  { id: 'zones', name: 'Zones', about: 'Where your riding time falls, week by week.' },
  { id: 'heart', name: 'Heart', about: 'Heart rate on your rides, and what it costs to make power.' },
  { id: 'breathing', name: 'Breathing', about: 'What a breathing sensor shows on your rides.' },
  { id: 'durability', name: 'Durability', about: 'How well your power holds late in a ride.' },
  { id: 'volume', name: 'Volume and consistency', about: 'How much you do, and how regularly.' },
  { id: 'body', name: 'Body and recovery', about: 'Your mornings: sleep, heart, weight and readiness.' },
  { id: 'estimates', name: 'Fitness estimates', about: 'Single figures that sum up your fitness.' },
  { id: 'pedalling', name: 'Pedalling and speed', about: 'Cadence, coasting and speed on your rides.' },
];

/** What a measure needs before it has anything to show, in the rider's words. */
export const NEEDS = {
  any: 'Needs recorded activities',
  power: 'Needs a power meter',
  hr: 'Needs a heart-rate strap or watch',
  powerHr: 'Needs power and heart rate on steady rides',
  breath: 'Needs a breathing sensor',
  long: 'Needs long rides with a power meter',
  night: 'Needs overnight readings from a watch or ring',
  scale: 'Needs weighings',
  cadence: 'Needs a cadence sensor',
  plan: 'Needs a training plan',
  test: 'Needs a fitness test ridden in Antogo',
  device: 'Needs a device that sends it',
  felt: 'Needs how hard each ride felt, typed in',
  speed: 'Needs rides with distance',
} as const;

/** The family and the need of every standing measure (measures.ts). */
const STANDING: Record<string, [LabFamily, string]> = {
  fitness: ['load', NEEDS.any], fatigue: ['load', NEEDS.any], form: ['load', NEEDS.any], load: ['load', NEEDS.any], weekLoad: ['load', NEEDS.any],
  weekHours: ['volume', NEEDS.any], weekDistance: ['volume', NEEDS.speed], weekClimbing: ['volume', NEEDS.any],
  zoneEasy: ['zones', NEEDS.any], zoneMid: ['zones', NEEDS.any], zoneHard: ['zones', NEEDS.any],
  hrv: ['body', NEEDS.night], restingHr: ['body', NEEDS.night], sleep: ['body', NEEDS.night], sleepScore: ['body', NEEDS.night], sleepingHr: ['body', NEEDS.night],
  respiration: ['body', NEEDS.night], spo2: ['body', NEEDS.night], steps: ['body', NEEDS.device], readiness: ['body', NEEDS.night], deviceReadiness: ['body', NEEDS.device],
  weight: ['body', NEEDS.scale], bodyFat: ['body', NEEDS.scale], wkg: ['body', 'Needs a power meter and weighings'],
  ftp: ['power', NEEDS.power], vo2watch: ['estimates', NEEDS.device], ef: ['heart', NEEDS.powerHr], drift: ['heart', NEEDS.powerHr], breath: ['breathing', NEEDS.breath],
};

interface Extra extends MeasureDef { lab: LabFamily; needs: string }

const x = (id: string, lab: LabFamily, needs: string, name: string, word: string, desc: string, unit: string, cadence: 'day' | 'week', style: 'line' | 'bars' | 'dots', digits: number, group: MeasureGroup, more: Partial<MeasureDef> = {}): Extra =>
  ({ id, lab, needs, name, word, desc, unit, cadence, style, digits, group, ...more });

/** A per-ride cache record, as much of it as the Lab reads. */
export interface LabCurve {
  id: string; date: string; w?: number[]; hr30?: number; late?: LateEfforts;
  steadyAtHr?: { watts: number; seconds: number }; lthrAtBuild?: number;
  breathAtPower?: Array<{ lo: number; hi: number; seconds: number; ve: number; br?: number }>;
}

export interface LabInput {
  distUnit: 'mi' | 'km';
  weightUnit: 'lb' | 'kg';
  /** The per-ride cache (best efforts, late efforts, heart rate, breathing). */
  curves: LabCurve[];
  /** Fitness tests with their results. */
  tests: Array<{ date: string; ftpEstimate?: number; vo2?: number; vt1?: number; vt2?: number }>;
  /** Planned training load by week (the week's first day), when there is a plan. */
  plannedWeeks?: () => Map<string, number>;
  /** The 7-day load against the 28-day load on a day, as readiness works it out. */
  loadRatio?: (day: string) => number | undefined;
  /** The threshold heart rate now (steady-ride power is re-scaled to it, as the aerobic trend does). */
  lthr?: number;
}

const BEST: Array<[string, number, string]> = [['best5s', 5, '5 seconds'], ['best1m', 60, 'minute'], ['best5m', 300, '5 minutes'], ['best20m', 1200, '20 minutes'], ['best60m', 3600, 'hour']];
const ZONE_WORDS = ['recovery', 'endurance', 'tempo', 'threshold', 'VO2max', 'anaerobic', 'sprint'];
/** Days of best efforts the critical-power line is fitted to: a season's quarter, so each fit rests on recent hard riding. */
export const CP_WINDOW_DAYS = 90;

export function labDefs(i: Pick<LabInput, 'distUnit' | 'weightUnit'>): Extra[] {
  const mi = i.distUnit === 'mi';
  return [
    // Load and form
    x('ramp', 'load', NEEDS.any, 'Fitness gained in a week', 'fitness gained in a week', 'How far fitness has moved in the seven days to each day. Above zero it is rising.', '', 'day', 'line', 1, 'Training'),
    x('loadRatio', 'load', NEEDS.any, 'This week against your month', 'the week against the month', 'Average daily load over seven days divided by the average over twenty-eight. 1.00 means a week like your month; readiness uses the same figure.', '', 'day', 'line', 2, 'Training'),
    x('intensity', 'load', NEEDS.power, 'Intensity of each ride', 'ride intensity', 'Effort-weighted power as a share of your FTP on the day. 1.00 is an hour at threshold.', '', 'day', 'dots', 2, 'Training'),
    x('hrLoad', 'load', NEEDS.hr, 'Load scored from heart rate, each week', 'load scored from heart rate', 'The part of each week’s training load that was scored from heart rate because the activity had no power.', 'TSS', 'week', 'bars', 0, 'Training', { family: 'load' }),
    x('plannedLoad', 'load', NEEDS.plan, 'Planned load, each week', 'planned load', 'The training load your plan asked for each week.', 'TSS', 'week', 'bars', 0, 'Training', { family: 'load' }),
    // Power
    x('eftp', 'power', NEEDS.power, 'FTP estimated from rides', 'estimated FTP', 'The FTP a hard ride points to, on the days a ride was hard enough to give one.', 'W', 'day', 'dots', 0, 'Riding'),
    x('np', 'power', NEEDS.power, 'Normalized power, each ride', 'normalized power', 'Effort-weighted power of each ride: what the ride cost, counting surges for more than steady riding.', 'W', 'day', 'dots', 0, 'Riding'),
    x('avgPower', 'power', NEEDS.power, 'Average power, each ride', 'average power', 'Plain average power of each ride.', 'W', 'day', 'dots', 0, 'Riding'),
    x('variability', 'power', NEEDS.power, 'Unevenness, each ride', 'unevenness', 'Normalized power divided by average power. 1.00 is perfectly steady; a hilly or surging ride is higher.', '', 'day', 'dots', 2, 'Riding'),
    x('work', 'power', NEEDS.power, 'Work done, each ride', 'work done', 'Mechanical work at the pedals on each ride.', 'kJ', 'day', 'dots', 0, 'Riding', { family: 'work' }),
    x('weekWork', 'power', NEEDS.power, 'Work done, each week', 'weekly work', 'Mechanical work at the pedals each week.', 'kJ', 'week', 'bars', 0, 'Riding', { family: 'work' }),
    x('workAbove', 'power', NEEDS.power, 'Work above FTP, each ride', 'work above FTP', 'The part of each ride’s work done above your FTP.', 'kJ', 'day', 'dots', 0, 'Riding'),
    x('reserveUsed', 'power', NEEDS.power, 'Reserve used, each ride', 'reserve used', 'The deepest your reserve above threshold was drawn down on each ride.', 'kJ', 'day', 'dots', 1, 'Riding'),
    ...BEST.map(([id, , words]) => x(id, 'power', NEEDS.power, `Best ${words}, each ride`, `best ${words}`, `The highest power held for ${words === 'minute' || words === 'hour' ? `one ${words}` : words} on each ride.`, 'W', 'day', 'dots', 0, 'Riding')),
    x('cp', 'power', NEEDS.power, 'Critical power', 'critical power', `The power you can hold well beyond a short burst, fitted each week to your best 2- to 30-minute efforts of the ${CP_WINDOW_DAYS} days before. Shown only when those efforts fit one line.`, 'W', 'week', 'line', 0, 'Riding'),
    x('wPrime', 'power', NEEDS.power, 'Reserve above critical power', 'reserve above critical power', `The work you can do above critical power before you must ease, from the same weekly fit.`, 'kJ', 'week', 'line', 1, 'Riding'),
    // Zones
    ...ZONE_WORDS.map((w, k) => x(`z${k + 1}`, 'zones', NEEDS.any, `Ride time in zone ${k + 1}`, `zone ${k + 1} time`, `Hours of riding each week in zone ${k + 1} (${w}): power zones, or heart-rate zones for rides without power.`, 'h', 'week', 'bars', 1, 'Training')),
    x('sweetSpot', 'zones', NEEDS.power, 'Sweet-spot time', 'sweet-spot time', 'Hours each week in the band straddling zones 3 and 4. It is already counted inside those zones.', 'h', 'week', 'bars', 1, 'Training'),
    x('easyShare', 'zones', NEEDS.any, 'Share of riding that was easy', 'easy share', 'Zones 1 and 2 as a share of each week’s riding time in zones.', '%', 'week', 'line', 0, 'Training'),
    ...[1, 2, 3, 4, 5].map((k) => x(`hz${k}`, 'zones', NEEDS.hr, `Time in heart-rate zone ${k}`, `heart-rate zone ${k} time`, `Hours each week with your heart rate in zone ${k}, every activity with heart rate together.`, 'h', 'week', 'bars', 1, 'Training')),
    // Heart
    x('avgHr', 'heart', NEEDS.hr, 'Average heart rate, each ride', 'average heart rate', 'Average heart rate of each ride.', 'bpm', 'day', 'dots', 0, 'Riding'),
    x('maxHr', 'heart', NEEDS.hr, 'Highest heart rate, each ride', 'highest heart rate', 'The highest heart rate each ride reached.', 'bpm', 'day', 'dots', 0, 'Riding'),
    x('hr30', 'heart', NEEDS.hr, 'Highest 30-second heart rate, each ride', 'highest 30-second heart rate', 'The highest heart rate held for thirty seconds on each ride: steadier than a single peak reading.', 'bpm', 'day', 'dots', 0, 'Riding'),
    // Breathing
    x('veEndurance', 'breathing', NEEDS.breath, 'Air breathed at endurance power', 'air breathed at endurance power', 'Litres of air a minute at 55–75% of FTP on each ride with a breathing sensor. Less for the same power over time is a sign of aerobic fitness.', 'L/min', 'day', 'dots', 1, 'Breathing'),
    x('vt1', 'breathing', NEEDS.breath, 'First breathing threshold', 'first breathing threshold', 'The power at your first breathing threshold, each time a test read it.', 'W', 'day', 'dots', 0, 'Breathing'),
    x('vt2', 'breathing', NEEDS.breath, 'Second breathing threshold', 'second breathing threshold', 'The power at your second breathing threshold, each time a test read it.', 'W', 'day', 'dots', 0, 'Breathing'),
    // Durability
    x('late5', 'durability', NEEDS.long, '5-minute power held late', '5-minute power held late', 'Your best 5 minutes after an hour’s worth of work at FTP, as a share of your best 5 minutes before it on the same ride.', '%', 'day', 'dots', 0, 'Riding'),
    x('late20', 'durability', NEEDS.long, '20-minute power held late', '20-minute power held late', 'Your best 20 minutes after an hour’s worth of work at FTP, as a share of your best 20 minutes before it on the same ride.', '%', 'day', 'dots', 0, 'Riding'),
    x('late5w', 'durability', NEEDS.long, 'Best 5 minutes, late in a ride', 'late 5-minute power', 'Your best 5 minutes after an hour’s worth of work at FTP.', 'W', 'day', 'dots', 0, 'Riding'),
    x('late20w', 'durability', NEEDS.long, 'Best 20 minutes, late in a ride', 'late 20-minute power', 'Your best 20 minutes after an hour’s worth of work at FTP.', 'W', 'day', 'dots', 0, 'Riding'),
    // Volume and consistency
    x('weekRideHours', 'volume', NEEDS.any, 'Hours ridden, each week', 'hours ridden', 'Time on the bike each week, rides only.', 'h', 'week', 'bars', 1, 'Training'),
    x('weekRides', 'volume', NEEDS.any, 'Rides, each week', 'rides a week', 'How many rides each week.', 'rides', 'week', 'bars', 0, 'Training'),
    x('weekSessions', 'volume', NEEDS.any, 'Sessions of every kind, each week', 'sessions a week', 'Rides, strength, mobility, walks and runs together, each week.', 'sessions', 'week', 'bars', 0, 'Training'),
    x('weekDays', 'volume', NEEDS.any, 'Days trained, each week', 'days trained', 'On how many days of each week you trained.', 'days', 'week', 'bars', 0, 'Training'),
    x('longest', 'volume', NEEDS.any, 'Longest ride, each week', 'longest ride', 'The longest single ride of each week.', 'h', 'week', 'bars', 1, 'Training'),
    x('weekEnergy', 'volume', NEEDS.any, 'Energy burned, each week', 'energy burned', 'Energy burned in recorded activities each week, as your device or Antogo worked it out.', 'kcal', 'week', 'bars', 0, 'Training'),
    x('speed', 'pedalling', NEEDS.speed, 'Average speed, each ride', 'average speed', 'Average speed of each ride.', mi ? 'mph' : 'km/h', 'day', 'dots', 1, 'Riding'),
    // Body and recovery
    x('hrvSdnn', 'body', NEEDS.device, 'Heart-rate variability, SDNN', 'HRV (SDNN)', 'Overnight HRV worked out as SDNN, when your device sends it beside the usual figure.', 'ms', 'day', 'dots', 0, 'Body'),
    x('weight7', 'body', NEEDS.scale, 'Weight, 7-day average', '7-day average weight', 'The average of the weighings in the seven days to each weighing: steadier than one morning.', i.weightUnit, 'day', 'line', 1, 'Body', { family: 'weight' }),
    x('felt', 'body', NEEDS.felt, 'How hard it felt', 'how hard it felt', 'The effort you rated for each activity, 1 to 10.', '', 'day', 'dots', 0, 'Body'),
    // Fitness estimates
    x('vo2test', 'estimates', NEEDS.test, 'VO2max, from your tests', 'VO2max from tests', 'Antogo’s VO2max estimate from each Ramp Test: worked out from the power you reached and your weight.', 'ml/kg/min', 'day', 'dots', 1, 'Riding'),
    x('ftpTest', 'estimates', NEEDS.test, 'FTP, from your tests', 'FTP from tests', 'The FTP each fitness test pointed to.', 'W', 'day', 'dots', 0, 'Riding'),
    x('steadyPower', 'estimates', NEEDS.powerHr, 'Power at a steady heart rate', 'power at a steady heart rate', 'Power while your heart sat at 70–80% of threshold heart rate, week by week over twelve weeks: the median of weeks with two or more such rides. Rising means a growing aerobic base.', 'W', 'week', 'line', 0, 'Riding'),
    // Pedalling
    x('cadence', 'pedalling', NEEDS.cadence, 'Cadence, each ride', 'cadence', 'Average pedalling rate of each ride.', 'rpm', 'day', 'dots', 0, 'Riding'),
    x('coasting', 'pedalling', NEEDS.cadence, 'Share of the ride spent coasting', 'coasting share', 'Time not pedalling as a share of each ride.', '%', 'day', 'dots', 0, 'Riding'),
  ];
}

const pos = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;
const mean = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;

/** Air breathed at endurance power on one ride: the seconds-weighted mean from 55% to 75% of FTP, by the rule the breathing rate uses. */
export function enduranceVentilation(bands: Array<{ lo: number; hi: number; seconds: number; ve: number }> | undefined): number | undefined {
  if (!bands?.length) return undefined;
  let s = 0, w = 0;
  for (const b of bands) if (b.lo >= 0.55 && b.hi <= 0.75 && pos(b.ve) && b.seconds > 0) { s += b.ve * b.seconds; w += b.seconds; }
  return w >= 300 ? Math.round((s / w) * 10) / 10 : undefined;
}

/** The Lab's measures, to hand to `new Measures(input, labExtra(...))`. */
export function labExtra(li: LabInput): MeasureExtra & { defs: Extra[] } {
  const defs = labDefs(li);
  const compute = (id: string, M: Measures): Values | undefined => {
    const { rides, wellness, today, weekStartOf } = M.input;
    const out: Values = new Map();
    const onlyRides = rides.filter((r) => r.sport === 'ride');
    // One value a day from the day's rides: their average, or the highest.
    const perRide = (get: (r: Ride) => number | undefined, how: 'mean' | 'max' = 'mean', list: Ride[] = onlyRides) => {
      const acc = new Map<string, number[]>();
      for (const r of list) { const v = get(r); if (!pos(v)) continue; const l = acc.get(r.date) ?? []; l.push(v); acc.set(r.date, l); }
      for (const [d, l] of acc) out.set(d, how === 'max' ? Math.max(...l) : mean(l));
      return out;
    };
    const perCurve = (get: (c: LabCurve) => number | undefined, how: 'mean' | 'max' = 'max') => {
      const acc = new Map<string, number[]>();
      for (const c of li.curves) { const v = get(c); if (!pos(v)) continue; const l = acc.get(c.date) ?? []; l.push(v); acc.set(c.date, l); }
      for (const [d, l] of acc) out.set(d, how === 'max' ? Math.max(...l) : mean(l));
      return out;
    };
    // A sum per week over the whole history; weeks with nothing count as nothing, when the rider has any at all.
    const perWeek = (get: (r: Ride) => number, list: Ride[] = rides, how: 'sum' | 'max' = 'sum') => {
      if (!list.some((r) => get(r) > 0)) return out;
      for (let w = weekStartOf(M.start); w <= today; w = addDays(w, 7)) out.set(w, 0);
      for (const r of list) { const s = weekStartOf(r.date); if (!out.has(s)) continue; const v = get(r) || 0; out.set(s, how === 'max' ? Math.max(out.get(s)!, v) : out.get(s)! + v); }
      return out;
    };
    const best = BEST.find((b) => b[0] === id);
    if (best) { const k = CURVE_SECONDS.indexOf(best[1]); return perCurve((c) => c.w?.[k]); }
    const z = /^z([1-7])$/.exec(id);
    if (z) {
      if (!onlyRides.some((r) => r.powerZoneSeconds?.length || r.hrZoneSeconds?.length)) return out;
      for (const w of weeklyZones(rides, M.start, today, weekStartOf)) out.set(w.start, (w.seconds[+z[1] - 1] ?? 0) / 3600);
      // A zone the rider's zones do not have (five heart-rate zones, say) is not offered as a row of noughts.
      return [...out.values()].some((v) => v > 0) ? out : new Map();
    }
    const hz = /^hz([1-5])$/.exec(id);
    if (hz) return perWeek((r) => (r.hrZoneSeconds?.[+hz[1] - 1] ?? 0) / 3600);
    switch (id) {
      case 'ramp': { const f = M.values('fitness'); for (const [d, v] of f) { const b = f.get(addDays(d, -7)); if (b != null) out.set(d, v - b); } return out; }
      case 'loadRatio': {
        if (!li.loadRatio) return out;
        for (let d = M.start; d <= today; d = addDays(d, 1)) { const v = li.loadRatio(d); if (pos(v)) out.set(d, v); }
        return out;
      }
      case 'intensity': return perRide((r) => r.intensityFactor, 'max');
      case 'hrLoad': return perWeek((r) => (r.tssBasis === 'heart-rate' ? r.tss ?? 0 : 0));
      case 'plannedLoad': { for (const [w, v] of li.plannedWeeks?.() ?? []) if (v > 0) out.set(w, Math.round(v)); return out; }
      case 'eftp': return perRide((r) => r.eftp, 'max');
      case 'np': return perRide((r) => r.normalizedPower, 'max');
      case 'avgPower': return perRide((r) => r.averagePower, 'max');
      case 'variability': return perRide((r) => r.variabilityIndex);
      case 'work': return perRide((r) => r.workKj, 'max');
      case 'weekWork': return perWeek((r) => r.workKj ?? 0, onlyRides);
      case 'workAbove': return perRide((r) => r.workAboveFtpKj, 'max');
      case 'reserveUsed': return perRide((r) => r.reserveUsedKj, 'max');
      case 'cp': case 'wPrime': {
        const withW = li.curves.filter((c) => c.w?.length).sort((a, b) => a.date.localeCompare(b.date));
        if (!withW.length) return out;
        const idx = FIT_SECONDS.map((s) => CURVE_SECONDS.indexOf(s));
        for (let w = weekStartOf(withW[0].date); w <= today; w = addDays(w, 7)) {
          const end = addDays(w, 6) > today ? today : addDays(w, 6), from = addDays(end, -(CP_WINDOW_DAYS - 1));
          const bests = idx.map(() => 0);
          for (const c of withW) { if (c.date < from) continue; if (c.date > end) break; idx.forEach((k, j) => { const v = c.w![k]; if (v > bests[j]) bests[j] = v; }); }
          const fit = fitCp(FIT_SECONDS.map((seconds, j) => ({ seconds, watts: bests[j] })).filter((e) => e.watts > 0));
          if (fit?.ok) out.set(w, id === 'cp' ? fit.cp : fit.wPrime / 1000);
        }
        return out;
      }
      case 'sweetSpot': return perWeek((r) => (r.sweetSpotSeconds ?? 0) / 3600, onlyRides);
      case 'easyShare': {
        if (!onlyRides.some((r) => r.powerZoneSeconds?.length || r.hrZoneSeconds?.length)) return out;
        for (const w of weeklyZones(rides, M.start, today, weekStartOf)) { const all = w.seconds.reduce((a, b) => a + b, 0); if (all > 0) out.set(w.start, ((w.seconds[0] ?? 0) + (w.seconds[1] ?? 0)) / all * 100); }
        return out;
      }
      case 'avgHr': return perRide((r) => r.averageHr);
      case 'maxHr': return perRide((r) => r.maxHr, 'max');
      case 'hr30': return perCurve((c) => c.hr30);
      case 'veEndurance': return perCurve((c) => enduranceVentilation(c.breathAtPower), 'mean');
      case 'vt1': case 'vt2': case 'vo2test': case 'ftpTest': {
        const get = { vt1: 'vt1', vt2: 'vt2', vo2test: 'vo2', ftpTest: 'ftpEstimate' }[id] as 'vt1' | 'vt2' | 'vo2' | 'ftpEstimate';
        for (const t of li.tests) { const v = t[get]; if (pos(v)) out.set(t.date, Math.max(v, out.get(t.date) ?? 0)); }
        return out;
      }
      case 'late5': return perCurve((c) => (pos(c.late?.a5) && pos(c.late?.b5) ? c.late!.a5! / c.late!.b5! * 100 : undefined));
      case 'late20': return perCurve((c) => (pos(c.late?.a20) && pos(c.late?.b20) ? c.late!.a20! / c.late!.b20! * 100 : undefined));
      case 'late5w': return perCurve((c) => c.late?.a5);
      case 'late20w': return perCurve((c) => c.late?.a20);
      case 'weekRideHours': return perWeek((r) => r.seconds / 3600, onlyRides);
      case 'weekRides': return perWeek(() => 1, onlyRides);
      case 'weekSessions': return perWeek(() => 1);
      case 'weekDays': {
        if (!rides.length) return out;
        for (let w = weekStartOf(M.start); w <= today; w = addDays(w, 7)) out.set(w, 0);
        for (const d of new Set(rides.map((r) => r.date))) { const s = weekStartOf(d); if (out.has(s)) out.set(s, out.get(s)! + 1); }
        return out;
      }
      case 'longest': return perWeek((r) => r.seconds / 3600, onlyRides, 'max');
      case 'weekEnergy': return perWeek((r) => r.calories ?? 0);
      case 'speed': return perRide((r) => (pos(r.averageSpeedMs) ? r.averageSpeedMs * (li.distUnit === 'mi' ? 2.236936 : 3.6) : undefined));
      case 'hrvSdnn': { for (const w of wellness) if (pos(w.hrvSdnn)) out.set(w.date, w.hrvSdnn); return out; }
      case 'weight7': {
        const days = [...M.values('weight').entries()].sort((a, b) => a[0].localeCompare(b[0]));
        let lo = 0;
        for (let k = 0; k < days.length; k++) { while (days[lo][0] < addDays(days[k][0], -6)) lo++; out.set(days[k][0], mean(days.slice(lo, k + 1).map((p) => p[1]))); }
        return out;
      }
      case 'felt': return perRide((r) => r.rpe, 'max', rides);
      case 'steadyPower': {
        if (!pos(li.lthr)) return out;
        for (const w of aerobicTrend(li.curves, li.lthr, today).weeks) out.set(weekStartOf(w.start), w.watts);
        return out;
      }
      case 'cadence': return perRide((r) => r.averageCadence);
      case 'coasting': return perRide((r) => (pos(r.coastingSeconds) && r.seconds > 0 ? Math.min(100, r.coastingSeconds / r.seconds * 100) : undefined));
      default: return undefined;
    }
  };
  return { defs, compute };
}

/** The family a measure sits in, and what it needs. */
export function labMeta(M: Measures, id: string): { family: LabFamily; needs: string } | undefined {
  const s = STANDING[id];
  if (s) return { family: s[0], needs: s[1] };
  const d = M.def(id) as Extra | undefined;
  return d?.lab ? { family: d.lab, needs: d.needs } : undefined;
}

/**
 * How many values a measure has, for the Lab's purposes. A measure made only of noughts (fitness, daily load and
 * weekly totals for a rider with no activities yet) counts as none: the rider has recorded nothing, so nothing is drawn.
 */
export function readings(M: Measures, id: string, from?: string, to?: string): number {
  const vs = M.values(id);
  let any = false;
  for (const v of vs.values()) if (v !== 0) { any = true; break; }
  return any ? M.count(id, from, to) : 0;
}

/** A family's measures, in the order they are listed: those with data first, each group in the registry's order. */
export function familyMeasures(M: Measures, family: LabFamily): MeasureDef[] {
  const all = M.defs.filter((d) => labMeta(M, d.id)?.family === family);
  return [...all.filter((d) => readings(M, d.id) > 0), ...all.filter((d) => readings(M, d.id) === 0)];
}

/** A measure's newest value and its day; none for a measure with nothing recorded. */
export function newest(M: Measures, id: string): { date: string; value: number } | undefined {
  if (!readings(M, id)) return undefined;
  let best: string | undefined;
  const vs = M.values(id);
  for (const k of vs.keys()) if (!best || k > best) best = k;
  return best ? { date: best, value: vs.get(best)! } : undefined;
}

/** Words to find a measure or a family by: plain lower-case matching on every word typed. */
export function searchMeasures(M: Measures, query: string): MeasureDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const fam = new Map(LAB_FAMILIES.map((f) => [f.id, f.name.toLowerCase()]));
  return M.defs.filter((d) => {
    const meta = labMeta(M, d.id);
    if (!meta) return false;
    const hay = `${d.name} ${d.word} ${d.desc} ${d.unit} ${fam.get(meta.family)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------- the period, the same choice on every Lab screen ----------

export type LabPeriod = '4w' | '3m' | '6m' | '1y' | 'all' | 'plan' | 'custom';
export const PERIOD_LABEL: Record<LabPeriod, string> = { '4w': '4 weeks', '3m': '3 months', '6m': '6 months', '1y': '1 year', all: 'All time', plan: 'This plan', custom: 'Custom' };
const PERIOD_DAYS: Record<'4w' | '3m' | '6m' | '1y', number> = { '4w': 28, '3m': 91, '6m': 182, '1y': 365 };

/** The first and last day of a period. `plan` needs the plan's days; `custom` the two typed; either falls back to 3 months. */
export function periodDays(p: LabPeriod, today: string, o: { earliest: string; plan?: { start: string; end: string }; custom?: { from: string; to: string } }): { from: string; to: string } {
  if (p === 'all') return { from: o.earliest < today ? o.earliest : addDays(today, -41), to: today };
  if (p === 'plan' && o.plan) return { from: o.plan.start, to: o.plan.end < today ? o.plan.end : today };
  if (p === 'custom' && o.custom && o.custom.from <= o.custom.to) return o.custom;
  const n = PERIOD_DAYS[p === 'plan' || p === 'custom' ? '3m' : p];
  return { from: addDays(today, -(n - 1)), to: today };
}

/** The period of the same length just before one (for "against the period before"). */
export function periodBefore(from: string, to: string): { from: string; to: string } {
  const n = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}
