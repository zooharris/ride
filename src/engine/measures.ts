import type { Fitness, Profile, Ride, Wellness } from './types';
import { addDays } from './load';
import { aerobicPoints, dailyLoad, ftpByDay, weeklyLoad, weeklyZones } from './progress';
import { enduranceBreathRate } from './progressMore';
import type { Zone } from './zones';

/**
 * Every measure the large Progress view can draw, lay over another, compare and download (12 Nov 2026, large
 * charts, A3). One registry, so the list under "More…", the suggestions, the panels and the download all agree.
 * Each measure is a value per day (or per week, keyed by the week's first day), worked out once from what is on
 * this device. Nothing here knows about one rider: the boundaries are general, and a measure the rider has no data
 * for simply has no values and is not offered.
 */

export type MeasureGroup = 'Training' | 'Body' | 'Riding' | 'Breathing';
export const MEASURE_GROUPS: MeasureGroup[] = ['Training', 'Body', 'Riding', 'Breathing'];
export type Cadence = 'day' | 'week';
/** How a measure is drawn on its own: a line, a bar per day or week, or a dot per ride joined by its average. */
export type MeasureStyle = 'line' | 'bars' | 'dots';

export interface MeasureDef {
  id: string;
  name: string;
  /** The name inside a sentence ("HRV", "training load", "sleep"). */
  word: string;
  /** One line on what it is, for the head of the large view. */
  desc: string;
  unit: string;
  group: MeasureGroup;
  cadence: Cadence;
  style: MeasureStyle;
  digits: number;
  /** Two measures in one family are the same thing summed or smoothed differently: never laid over each other. */
  family?: string;
  /** Words for the low and high ends in "What this shows" ("shortest nights", "longest nights"). */
  ends?: [string, string];
  /** True for training load: "What this shows" compares its hardest fifth with the range's average (A6.4). */
  isLoad?: boolean;
  /** Has a "your normal" band, worked out as readiness works out its normal. */
  normal?: boolean;
}

export interface MeasureInput {
  rides: Ride[];
  wellness: Wellness[];
  series: Fitness[];
  profile: Profile;
  today: string;
  weekStartOf: (d: string) => string;
  /** Rides with breathing read: the endurance breathing rate comes from these. */
  breath?: Array<{ date: string; breathAtPower?: Array<{ lo: number; hi: number; seconds: number; br?: number }> }>;
  /** Whether a ride was planned as endurance (for the steady-ride measures); undefined when not on the calendar. */
  isEndurance?: (r: Ride) => boolean | undefined;
  hrZones?: Zone[];
  weightUnit: 'lb' | 'kg';
  distUnit: 'mi' | 'km';
  /** The app's readiness score by day (worked out by the caller, which has the readiness rules). */
  readiness?: () => Map<string, number>;
}

const LB = 2.20462;

export function measureDefs(i: Pick<MeasureInput, 'weightUnit' | 'distUnit'>): MeasureDef[] {
  const kg = i.weightUnit, mi = i.distUnit === 'mi';
  return [
    { id: 'fitness', name: 'Fitness', word: 'fitness', desc: 'The 42-day weighted average of your daily training load.', unit: '', group: 'Training', cadence: 'day', style: 'line', digits: 0 },
    { id: 'fatigue', name: 'Fatigue', word: 'fatigue', desc: 'The 7-day weighted average of your daily training load.', unit: '', group: 'Training', cadence: 'day', style: 'line', digits: 0 },
    { id: 'form', name: 'Form', word: 'form', desc: 'Fitness less fatigue: below zero after hard training, above it when fresh.', unit: '', group: 'Training', cadence: 'day', style: 'line', digits: 0 },
    { id: 'load', name: 'Training load, each day', word: 'training load', desc: 'The training load (TSS) of everything you did each day; rest days count as nothing.', unit: 'TSS', group: 'Training', cadence: 'day', style: 'bars', digits: 0, family: 'load', ends: ['lightest days', 'hardest days'], isLoad: true },
    { id: 'weekLoad', name: 'Training load, each week', word: 'weekly training load', desc: 'The training load (TSS) of each week, every kind of session together.', unit: 'TSS', group: 'Training', cadence: 'week', style: 'bars', digits: 0, family: 'load', ends: ['lightest weeks', 'hardest weeks'], isLoad: true },
    { id: 'weekHours', name: 'Hours trained, each week', word: 'hours trained', desc: 'Time spent training each week, every kind of session together.', unit: 'h', group: 'Training', cadence: 'week', style: 'bars', digits: 1, ends: ['shortest weeks', 'longest weeks'] },
    { id: 'zoneEasy', name: 'Ride time in zones 1–2', word: 'easy ride time', desc: 'Hours of riding each week in power zones 1 and 2 (heart-rate zones for rides without power).', unit: 'h', group: 'Training', cadence: 'week', style: 'bars', digits: 1 },
    { id: 'zoneMid', name: 'Ride time in zone 3', word: 'zone 3 time', desc: 'Hours of riding each week in zone 3, the middle of the range.', unit: 'h', group: 'Training', cadence: 'week', style: 'bars', digits: 1 },
    { id: 'zoneHard', name: 'Ride time in zone 4 and up', word: 'hard ride time', desc: 'Hours of riding each week at zone 4 and above: threshold and harder.', unit: 'h', group: 'Training', cadence: 'week', style: 'bars', digits: 1 },
    { id: 'hrv', name: 'Heart-rate variability', word: 'HRV', desc: 'Your overnight HRV each morning. Higher than your normal usually means well recovered.', unit: 'ms', group: 'Body', cadence: 'day', style: 'dots', digits: 0, normal: true },
    { id: 'restingHr', name: 'Resting heart rate', word: 'resting heart rate', desc: 'Your resting heart rate each morning. Lower than your normal usually means well recovered.', unit: 'bpm', group: 'Body', cadence: 'day', style: 'dots', digits: 0, normal: true },
    { id: 'sleep', name: 'Sleep', word: 'sleep', desc: 'How long you slept each night, on the morning it ended.', unit: 'h', group: 'Body', cadence: 'day', style: 'dots', digits: 1, normal: true, ends: ['shortest nights', 'longest nights'] },
    { id: 'sleepScore', name: 'Sleep score', word: 'sleep score', desc: "Your device's own score for each night's sleep.", unit: '', group: 'Body', cadence: 'day', style: 'dots', digits: 0, normal: true, ends: ['worst-scored nights', 'best-scored nights'] },
    { id: 'sleepingHr', name: 'Heart rate asleep', word: 'heart rate asleep', desc: 'Your average heart rate while asleep, when your device sends it.', unit: 'bpm', group: 'Body', cadence: 'day', style: 'dots', digits: 0, normal: true },
    { id: 'respiration', name: 'Breathing rate overnight', word: 'overnight breathing rate', desc: 'Breaths a minute overnight, when your device sends it.', unit: 'br/min', group: 'Body', cadence: 'day', style: 'dots', digits: 1, normal: true },
    { id: 'spo2', name: 'Blood oxygen', word: 'blood oxygen', desc: 'Blood oxygen overnight, when your device sends it.', unit: '%', group: 'Body', cadence: 'day', style: 'dots', digits: 0 },
    { id: 'steps', name: 'Steps', word: 'steps', desc: 'Steps each day, when your device sends them.', unit: 'steps', group: 'Body', cadence: 'day', style: 'bars', digits: 0, ends: ['days with fewest steps', 'days with most steps'] },
    { id: 'readiness', name: 'Readiness', word: 'readiness', desc: "The app's readiness score each morning, from your overnight numbers and your form.", unit: '', group: 'Body', cadence: 'day', style: 'line', digits: 0 },
    { id: 'deviceReadiness', name: "Readiness, your device's", word: "your device's readiness", desc: "Your watch's or ring's own readiness score, when it sends one.", unit: '', group: 'Body', cadence: 'day', style: 'dots', digits: 0 },
    { id: 'weight', name: 'Weight', word: 'weight', desc: 'Your body weight, as your scale or app records it.', unit: kg, group: 'Body', cadence: 'day', style: 'dots', digits: 1, ends: ['lightest days', 'heaviest days'] },
    { id: 'bodyFat', name: 'Body fat', word: 'body fat', desc: 'Body fat, when your scale sends it.', unit: '%', group: 'Body', cadence: 'day', style: 'dots', digits: 1 },
    { id: 'ftp', name: 'FTP', word: 'FTP', desc: 'The FTP on record each day: it changes when a test, you or Intervals.icu update it.', unit: 'W', group: 'Riding', cadence: 'day', style: 'line', digits: 0 },
    { id: 'wkg', name: 'Power to weight', word: 'power to weight', desc: 'FTP divided by your 7-day average weight.', unit: 'W/kg', group: 'Riding', cadence: 'day', style: 'line', digits: 2 },
    { id: 'vo2watch', name: "VO2max, your device's", word: "your device's VO2max", desc: "Your watch's own VO2max estimate, when it sends one.", unit: 'ml/kg/min', group: 'Riding', cadence: 'day', style: 'dots', digits: 1 },
    { id: 'ef', name: 'Efficiency', word: 'efficiency', desc: 'Power per heartbeat on steady rides of an hour or more. Rising on the same kind of ride means a growing aerobic base.', unit: 'W/beat', group: 'Riding', cadence: 'day', style: 'dots', digits: 2 },
    { id: 'drift', name: 'Heart-rate drift', word: 'heart-rate drift', desc: 'How much heart rate rises for the same power in the second half of a steady ride. Under 5% is a solid base.', unit: '%', group: 'Riding', cadence: 'day', style: 'dots', digits: 1 },
    { id: 'weekDistance', name: 'Distance, each week', word: 'weekly distance', desc: 'Distance each week, every kind of activity together.', unit: mi ? 'mi' : 'km', group: 'Riding', cadence: 'week', style: 'bars', digits: 0 },
    { id: 'weekClimbing', name: 'Climbing, each week', word: 'weekly climbing', desc: 'Height climbed each week, every kind of activity together.', unit: mi ? 'ft' : 'm', group: 'Riding', cadence: 'week', style: 'bars', digits: 0 },
    { id: 'breath', name: 'Breathing at endurance power', word: 'breathing rate at endurance power', desc: 'Breaths a minute at 55–75% of FTP on each ride with a breathing strap. Fewer for the same power over time is a sign of aerobic fitness.', unit: 'br/min', group: 'Breathing', cadence: 'day', style: 'dots', digits: 1 },
  ];
}

export type Values = Map<string, number>;

const ok = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** Every measure's values. Worked out once for the data on hand; the large view reads from this. */
export class Measures {
  readonly defs: MeasureDef[];
  readonly byId: Map<string, MeasureDef>;
  private cache = new Map<string, Values>();
  private normals = new Map<string, Map<string, [number, number]>>();
  /** The first day of the rider's history (a ride or a morning). */
  readonly start: string;
  constructor(private input: MeasureInput) {
    this.defs = measureDefs(input);
    this.byId = new Map(this.defs.map((d) => [d.id, d]));
    // Rides and mornings may arrive in any order: take the true earliest of either.
    let first = '';
    for (const x of [...input.rides, ...input.wellness]) if (!first || x.date < first) first = x.date;
    this.start = first || addDays(input.today, -42);
  }

  def(id: string): MeasureDef | undefined { return this.byId.get(id); }

  values(id: string): Values {
    let v = this.cache.get(id);
    if (!v) { v = this.compute(id); this.cache.set(id, v); }
    return v;
  }

  /** Measures with at least three values: the ones the rider can lay over a chart. */
  available(): MeasureDef[] {
    return this.defs.filter((d) => this.count(d.id) >= 3);
  }

  count(id: string, from?: string, to?: string): number {
    let n = 0;
    for (const k of this.values(id).keys()) if ((!from || k >= from) && (!to || k <= to)) n++;
    return n;
  }

  /** The "your normal" band on each day: the average and usual spread of the 28 mornings before it, as readiness works it out. */
  normal(id: string): Map<string, [number, number]> | undefined {
    const def = this.def(id);
    if (!def?.normal) return undefined;
    let n = this.normals.get(id);
    if (!n) { n = rollingNormal(this.values(id), id); this.normals.set(id, n); }
    return n;
  }

  private compute(id: string): Values {
    const { rides, wellness, series, profile, today, weekStartOf } = this.input;
    const out: Values = new Map();
    const well = (get: (w: Wellness) => number | undefined) => { for (const w of wellness) { const v = get(w); if (ok(v)) out.set(w.date, v); } return out; };
    const weeks = <T>(fn: () => Array<{ start: string } & T>, get: (w: T) => number) => { for (const w of fn()) out.set(w.start, get(w)); return out; };
    const wk = (get: (r: Ride) => number) => {
      for (let w = weekStartOf(this.start); w <= today; w = addDays(w, 7)) out.set(w, 0);
      for (const r of rides) { const s = weekStartOf(r.date); if (out.has(s)) out.set(s, out.get(s)! + get(r)); }
      return out;
    };
    switch (id) {
      case 'fitness': for (const f of series) out.set(f.date, f.ctl); return out;
      case 'fatigue': for (const f of series) out.set(f.date, f.atl); return out;
      case 'form': for (const f of series) out.set(f.date, f.tsb); return out;
      case 'load': {
        const by = dailyLoad(rides);
        for (let d = this.start; d <= today; d = addDays(d, 1)) out.set(d, Math.round(by.get(d)?.tss ?? 0));
        return out;
      }
      case 'weekLoad': return weeks(() => weeklyLoad(rides, this.start, today, weekStartOf), (w) => Math.round(w.total));
      case 'weekHours': return wk((r) => r.seconds / 3600);
      case 'zoneEasy': case 'zoneMid': case 'zoneHard': {
        if (!rides.some((r) => r.sport === 'ride' && (r.powerZoneSeconds?.length || r.hrZoneSeconds?.length))) return out;
        const pick = id === 'zoneEasy' ? [0, 1] : id === 'zoneMid' ? [2] : [3, 4, 5, 6];
        return weeks(() => weeklyZones(rides, this.start, today, weekStartOf), (w) => pick.reduce((a, z) => a + (w.seconds[z] ?? 0), 0) / 3600);
      }
      case 'hrv': return well((w) => w.hrv);
      case 'restingHr': return well((w) => w.restingHr);
      case 'sleep': return well((w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined));
      case 'sleepScore': return well((w) => w.sleepScore);
      case 'sleepingHr': return well((w) => w.avgSleepingHr);
      case 'respiration': return well((w) => w.respiration);
      case 'spo2': return well((w) => w.spO2);
      case 'steps': return well((w) => w.steps);
      case 'deviceReadiness': return well((w) => w.deviceReadiness);
      case 'weight': return well((w) => (w.weightKg ? (this.input.weightUnit === 'lb' ? w.weightKg * LB : w.weightKg) : undefined));
      case 'bodyFat': return well((w) => w.bodyFatPct);
      case 'vo2watch': return well((w) => w.vo2max);
      case 'readiness': return this.input.readiness ? this.input.readiness() : out;
      case 'ftp': {
        if (!rides.length) return out;
        for (const x of ftpByDay(rides, this.start, today, profile.ftp)) out.set(x.date, x.ftp);
        return out;
      }
      case 'wkg': {
        const kgDays = new Map(wellness.filter((w) => ok(w.weightKg)).map((w) => [w.date, w.weightKg!]));
        if (!kgDays.size || !rides.length) return out;
        const ftp = this.values('ftp');
        // FTP over the 7-day average weight, on days with a weight in the week up to them.
        const dates = [...kgDays.keys()].sort();
        let lo = 0;
        for (let k = 0; k < dates.length; k++) {
          const d = dates[k];
          while (dates[lo] < addDays(d, -6)) lo++;
          let s = 0; for (let j = lo; j <= k; j++) s += kgDays.get(dates[j])!;
          const f = ftp.get(d);
          if (f) out.set(d, f / (s / (k - lo + 1)));
        }
        return out;
      }
      case 'ef': case 'drift': {
        // One value a day: a day with two steady rides shows their average.
        const pts = aerobicPoints(rides, this.input.isEndurance ?? (() => undefined), profile.lthr, this.input.hrZones);
        const acc = new Map<string, number[]>();
        for (const p of pts) { const v = id === 'ef' ? p.ef : p.drift; if (v == null || !isFinite(v)) continue; const l = acc.get(p.date) ?? []; l.push(v); acc.set(p.date, l); }
        for (const [d, l] of acc) out.set(d, l.reduce((a, b) => a + b, 0) / l.length);
        return out;
      }
      case 'weekDistance': return wk((r) => (r.distanceM ?? 0) / (this.input.distUnit === 'mi' ? 1609.344 : 1000));
      case 'weekClimbing': return wk((r) => (r.elevationM ?? 0) * (this.input.distUnit === 'mi' ? 3.28084 : 1));
      case 'breath': {
        const acc = new Map<string, number[]>();
        for (const c of this.input.breath ?? []) { const v = enduranceBreathRate(c.breathAtPower); if (v == null) continue; const l = acc.get(c.date) ?? []; l.push(v); acc.set(c.date, l); }
        for (const [d, l] of acc) out.set(d, l.reduce((a, b) => a + b, 0) / l.length);
        return out;
      }
      default: return out;
    }
  }
}

/** The smallest spread a normal is given, as readiness gives it, so a very steady rider is not shown a hairline band. */
const FLOOR: Record<string, (mean: number) => number> = {
  hrv: (m) => m * 0.04, sleep: (m) => m * 0.06, sleepScore: (m) => m * 0.06, restingHr: () => 1.5, sleepingHr: (m) => m * 0.04, respiration: () => 0.8,
};
/** Readings needed before a normal is drawn: as many as readiness needs. */
const MIN_NORMAL = 7;

/** For each day with a reading, the band of the average plus and minus the usual spread of the 28 days before it. */
export function rollingNormal(values: Values, id: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const dates = [...values.keys()].sort();
  const floor = FLOOR[id] ?? (() => 0);
  let lo = 0, s = 0, s2 = 0;
  for (let k = 0; k < dates.length; k++) {
    const d = dates[k];
    // The window is the 28 days before d (not d itself).
    while (lo < k && dates[lo] < addDays(d, -28)) { const v = values.get(dates[lo])!; s -= v; s2 -= v * v; lo++; }
    const n = k - lo;
    if (n >= MIN_NORMAL) {
      const mean = s / n;
      const sd = Math.max(Math.sqrt(Math.max(0, (s2 - n * mean * mean) / (n - 1))), floor(mean));
      out.set(d, [mean - sd, mean + sd]);
    }
    const v = values.get(d)!; s += v; s2 += v * v;
  }
  return out;
}

/** A measure's values in a range, in date order. */
export function inRange(values: Values, from: string, to: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const [k, v] of values) if (k >= from && k <= to) out.push([k, v]);
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Format a measure's value with its unit. */
export function fmtValue(def: MeasureDef, v: number | undefined | null, withUnit = true): string {
  if (v == null || !isFinite(v)) return '–';
  if (def.id === 'sleep') { const h = Math.floor(v), m = Math.round((v - h) * 60); return m === 60 ? `${h + 1} h 00` : `${h} h ${String(m).padStart(2, '0')}`; }
  if (def.id === 'form') { const r = Math.round(v); return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0'; }
  const n = def.digits === 0 ? Math.round(v).toLocaleString() : v.toFixed(def.digits);
  const s = n.replace(/^-/, '−');
  return withUnit && def.unit ? `${s}${def.unit === '%' ? '%' : ` ${def.unit}`}` : s;
}
