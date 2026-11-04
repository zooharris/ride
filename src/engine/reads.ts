import type { Basis, Profile, Ride, SessionKind, Workout } from './types';
import { hrAtPower, type HrAtPower } from './hrPower';
import { veAtPower, type BreathNormal, type VeAtPower } from './breathOffset';
import { breathingOf } from './breathFreeze';
import { analyseRide, stepReadout, type RideLap } from './analysis';
import { judgeSession, type SessionVerdict } from './sessionVerdict';
import { footHrZones, footLthr, hrZone, powerZone, rideHrZones, ridePowerZones } from './zones';
import { addDays } from './load';

/**
 * The re-check thinks (1 Nov 2026), Part A: what each activity shows, read once
 * from whatever its recording holds. Pure. Two layers:
 *  - Layer 1, "what this recording shows", for every activity, planned or not:
 *    time in each zone against the rider's own tables, heart rate, power, fade,
 *    drift, heart rate at each power band, breathing at each power band.
 *  - Layer 2, "against the plan", only for an activity matched to a calendar
 *    session: each step ridden against its target. How long the activity lasted
 *    against its plan is recorded as a fact and never judged.
 * Everything is measured against the signed-in rider's own settings and
 * history; nothing here is set for any one rider.
 */
/** 3 (4 Nov 2026, Part A9): a planned test is marked, so its drift and its steps are not read. */
export const READ_VERSION = 3;
/** How far back activities are read. */
export const READ_DAYS = 84;
/** The steady part of a ride starts after the warm-up. */
const SKIP = 600;
/** Fade and drift need this much steady riding to mean anything. */
const STEADY_MIN = 1800;
/** A heart-rate band compared with the rider's normal needs this much time in both. */
const COMPARE_FLOOR = 300;
/** The rider's normal heart rate at power is read from the rides of the weeks before. */
export const NORMAL_DAYS = 56;

export interface ActivityRead {
  id: string;
  date: string;
  v: number;
  name: string;
  kind: SessionKind;
  seconds: number;
  tss?: number;
  /** Which recordings were there: power, heart rate, breathing. */
  has: { power: boolean; hr: boolean; breathing: boolean; streams: boolean };
  /** Seconds in each heart-rate zone (zone 1 first), on the bike table for rides and the foot table otherwise. */
  hrZones?: number[];
  hrTable?: 'bike' | 'foot';
  /** Seconds in each power zone (zone 1 first), on the rider's own power table. */
  powerZones?: number[];
  /** Where zone time came from: the recording against the rider's tables, or Intervals.icu's own numbers. */
  zoneSource?: 'recording' | 'intervals';
  averageHr?: number;
  peakHr?: number;
  normalizedPower?: number;
  intensityFactor?: number;
  /** Power in the last quarter of the steady part over the first quarter (1 = held, 0.9 = 10% down). */
  fade?: number;
  /** Heart rate drifting up against power from the first half of the steady part to the second, in percent (positive = drifted up). */
  drift?: number;
  /** Seconds and mean heart rate in each band of FTP (as FTP was when read), after minute 10. */
  hrAtPower?: HrAtPower[];
  /** Median ventilation in each band of FTP, frozen stretches left out. */
  veAtPower?: VeAtPower[];
  averageBreathRate?: number;
  /** Seconds into the activity at which the strap's link froze; breathing after it is not used. */
  breathFrozenAt?: number;
  ftpAtRead: number;
  lthrAtRead: number;
  /** Layer 2, only when matched to a calendar session. */
  planned?: PlannedRead;
  /** The rider's effort rating, 1 to 10, when given. */
  effort?: number;
  /** The recording could not be downloaded this time: read from the activity's own numbers, and tried again on a later pass. */
  retry?: boolean;
}

export interface PlannedRead {
  workoutId: string;
  name: string;
  /** Part A9: a fitness test, whose drift and fade mean nothing (a ramp rises by design). */
  test?: boolean;
  /** One line per work step ridden: "Hard effort 2 of 3 · target 300 to 320 W · you rode 318 W, in target". */
  steps: string[];
  /** Planned steps reached by the recording, and planned steps in all: a fact, never a verdict. */
  reached?: { steps: number; of: number };
  verdict?: SessionVerdict;
}

export interface Streams { time: number[]; watts?: number[]; heartrate?: number[]; ve?: number[]; br?: number[]; tv?: number[] }

export interface ReadContext {
  profile: Profile;
  session?: { workout: Workout; basis: Basis };
  laps?: RideLap[];
  effort?: number;
}

const finite = (v: number | undefined): v is number => typeof v === 'number' && isFinite(v) && v > 0;

/** Seconds each sample stands for: up to the next sample, never more than 5 s, so a pause is not counted. */
function dts(time: number[], n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = i + 1 < n ? Math.min(5, Math.max(0, time[i + 1] - time[i])) : 1;
  return out;
}

/** Time in each zone of a ladder from a stream, as fractions of the threshold. */
export function zoneTime(time: number[], values: number[] | undefined, threshold: number, zoneOf: (f: number) => number, zones: number): number[] | undefined {
  if (!values?.length || threshold <= 0) return undefined;
  const n = Math.min(time.length, values.length);
  const d = dts(time, n);
  const out = new Array<number>(zones).fill(0);
  let any = false;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!finite(v) || d[i] <= 0) continue;
    const z = Math.min(zones, Math.max(1, zoneOf(v / threshold)));
    out[z - 1] += d[i];
    any = true;
  }
  return any ? out.map(Math.round) : undefined;
}

/**
 * Power in the last quarter of the steady part over the first quarter, on
 * pedalling seconds only (power above zero): a ride that ends downhill is not
 * a rider fading.
 */
export function powerFade(time: number[], watts: number[] | undefined): number | undefined {
  if (!watts?.length) return undefined;
  const n = Math.min(time.length, watts.length);
  const d = dts(time, n);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (time[i] >= SKIP && d[i] > 0 && watts[i] > 0) idx.push(i);
  const total = idx.reduce((t, i) => t + d[i], 0);
  if (total < STEADY_MIN) return undefined;
  const avg = (from: number, to: number) => {
    let s = 0, w = 0, acc = 0;
    for (const i of idx) {
      const at = acc; acc += d[i];
      if (at < from || at >= to) continue;
      s += watts[i] * d[i]; w += d[i];
    }
    return w ? s / w : 0;
  };
  const first = avg(0, total / 4), last = avg(total * 3 / 4, total);
  return first > 0 ? Math.round((last / first) * 100) / 100 : undefined;
}

/**
 * Heart rate drifting against power: power per beat in the first half of the
 * steady part against the second half, in percent. Only seconds with both
 * pedalling (power above zero) and heart rate count, after minute 10.
 */
export function hrDrift(time: number[], watts: number[] | undefined, hr: number[] | undefined): number | undefined {
  if (!watts?.length || !hr?.length) return undefined;
  const n = Math.min(time.length, watts.length, hr.length);
  const d = dts(time, n);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (time[i] >= SKIP && d[i] > 0 && watts[i] > 0 && hr[i] > 0) idx.push(i);
  const total = idx.reduce((t, i) => t + d[i], 0);
  if (total < STEADY_MIN) return undefined;
  let acc = 0, p1 = 0, h1 = 0, p2 = 0, h2 = 0;
  for (const i of idx) {
    const first = acc < total / 2; acc += d[i];
    if (first) { p1 += watts[i] * d[i]; h1 += hr[i] * d[i]; } else { p2 += watts[i] * d[i]; h2 += hr[i] * d[i]; }
  }
  if (!h1 || !h2 || !p1) return undefined;
  const ef1 = p1 / h1, ef2 = p2 / h2;
  return Math.round(((ef1 - ef2) / ef1) * 1000) / 10;
}

function normalized(time: number[], watts: number[]): number | undefined {
  const n = Math.min(time.length, watts.length);
  if (n < 60) return undefined;
  // 30-second rolling average of power, to the fourth power, averaged, fourth root.
  const d = dts(time, n);
  let win = 0, winT = 0, j = 0, sum4 = 0, t4 = 0;
  for (let i = 0; i < n; i++) {
    win += (watts[i] ?? 0) * d[i]; winT += d[i];
    while (winT > 30 && j < i) { win -= (watts[j] ?? 0) * d[j]; winT -= d[j]; j++; }
    if (time[i] >= 30 && winT > 0) { const a = win / winT; sum4 += a ** 4 * d[i]; t4 += d[i]; }
  }
  return t4 ? Math.round((sum4 / t4) ** 0.25) : undefined;
}

/** One activity's read. `s` is whatever recording there is; without one, only the activity's own numbers are used. */
export function readActivity(r: Ride, s: Streams | undefined, ctx: ReadContext): ActivityRead {
  const p = ctx.profile;
  const time = s?.time ?? [];
  const watts = s?.watts?.length ? s.watts : undefined;
  const hr = s?.heartrate?.length ? s.heartrate : undefined;
  const hasPower = !!watts?.some((w) => w > 0) || !!(r.normalizedPower || r.averagePower);
  const hasHr = !!hr?.some((h) => h > 0) || !!r.averageHr;
  const onFoot = r.sport !== 'ride';
  const out: ActivityRead = {
    id: r.id, date: r.date, v: READ_VERSION, name: r.name, kind: r.sport, seconds: r.seconds,
    ...(r.tss != null ? { tss: Math.round(r.tss) } : {}),
    has: { power: hasPower, hr: hasHr, breathing: false, streams: time.length > 0 },
    ftpAtRead: p.ftp, lthrAtRead: p.lthr,
    ...(ctx.effort ? { effort: ctx.effort } : {}),
  };

  // Heart-rate zones: the bike table on a ride, the foot table for everything else.
  const hrLadder = onFoot ? footHrZones(p) : rideHrZones(p);
  const hrThreshold = onFoot ? footLthr(p) : p.lthr;
  const hz = time.length ? zoneTime(time, hr, hrThreshold, (f) => hrZone(f, hrLadder), hrLadder.length) : undefined;
  const pLadder = ridePowerZones(p);
  const pz = time.length && !onFoot ? zoneTime(time, watts, p.ftp, (f) => powerZone(f, pLadder), pLadder.length) : undefined;
  if (hz || pz) {
    out.zoneSource = 'recording';
    if (hz) { out.hrZones = hz; out.hrTable = onFoot ? 'foot' : 'bike'; }
    if (pz) out.powerZones = pz;
  } else if (r.hrZoneSeconds?.length || r.powerZoneSeconds?.length) {
    out.zoneSource = 'intervals';
    if (r.hrZoneSeconds?.length) { out.hrZones = r.hrZoneSeconds.map(Math.round); out.hrTable = onFoot ? 'foot' : 'bike'; }
    if (r.powerZoneSeconds?.length) out.powerZones = r.powerZoneSeconds.map(Math.round);
  }

  // Heart rate.
  if (hr && time.length) {
    const n = Math.min(time.length, hr.length);
    const d = dts(time, n);
    let s1 = 0, w1 = 0, peak = 0;
    for (let i = 0; i < n; i++) if (hr[i] > 0) { s1 += hr[i] * d[i]; w1 += d[i]; if (hr[i] > peak) peak = hr[i]; }
    if (w1) out.averageHr = Math.round(s1 / w1);
    if (peak) out.peakHr = Math.round(peak);
  } else {
    if (r.averageHr) out.averageHr = Math.round(r.averageHr);
    if (r.maxHr) out.peakHr = Math.round(r.maxHr);
  }

  // Power.
  if (!onFoot) {
    const np = watts && time.length ? normalized(time, watts) : undefined;
    const npv = np ?? r.normalizedPower;
    if (npv) {
      out.normalizedPower = Math.round(npv);
      if (p.ftp > 0) out.intensityFactor = Math.round((npv / p.ftp) * 100) / 100;
    } else if (r.intensityFactor) out.intensityFactor = r.intensityFactor;
    if (watts && time.length) {
      const fade = powerFade(time, watts);
      if (fade != null) out.fade = fade;
      const drift = hrDrift(time, watts, hr);
      if (drift != null) out.drift = drift;
      const bands = hrAtPower(time, watts, hr, p.ftp);
      if (bands.length) out.hrAtPower = bands;
    } else if (r.decoupling != null && isFinite(r.decoupling)) out.drift = Math.round(r.decoupling * 10) / 10;
  }

  // Breathing, with any frozen stretch cut off first.
  if (s?.ve?.length && s.ve.some((v) => finite(v))) {
    const b = breathingOf(s);
    out.has.breathing = true;
    if (b.frozenAt != null) out.breathFrozenAt = Math.round(b.frozenAt);
    const ve = veAtPower(time, watts, b.ve, p.ftp);
    if (ve.length) out.veAtPower = ve;
    const br = (b.br ?? []).filter((v) => finite(v));
    if (br.length) out.averageBreathRate = Math.round((br.reduce((a, c) => a + c, 0) / br.length) * 10) / 10;
  }

  // Layer 2: against the plan, only when matched.
  if (ctx.session) out.planned = plannedRead(ctx.session.workout, ctx.session.basis, p, time, watts, hr, ctx.laps);
  return out;
}

/** Each step ridden against its target. Steps the recording never reached are counted, not judged. */
export function plannedRead(workout: Workout, basis: Basis, p: Profile, time: number[], watts?: number[], hr?: number[], laps?: RideLap[]): PlannedRead {
  const base: PlannedRead = { workoutId: workout.id, name: workout.name, steps: [], ...(workout.test ? { test: true } : {}) };
  // Part A9: a test is read by its results, not step by step against targets (a ramp's steps are there to be failed).
  if (workout.kind !== 'ride' || !time.length || workout.test) return base;
  const series = basis === 'power' ? watts : hr;
  if (!series?.length) return base;
  const a = analyseRide(workout, p, basis, time, watts, hr, laps);
  const end = time[time.length - 1];
  const reached = a.steps.filter((s) => s.startSec < end - 5 && s.actual != null).length;
  const unit = basis === 'power' ? 'W' : 'bpm';
  const lines = a.steps.filter((s) => s.work && s.actual != null && s.endSec <= end + 5).map((s) => stepReadout(s, unit));
  const verdict = judgeSession(workout, p, basis, time, watts, hr, laps);
  return {
    ...base,
    steps: lines.slice(0, 12),
    ...(reached < a.steps.length ? { reached: { steps: reached, of: a.steps.length } } : {}),
    ...(verdict ? { verdict } : {}),
  };
}

// ---- words -------------------------------------------------------------------

/** The rider's normal heart rate at each band of FTP, from reads in the weeks before `date`, at the same FTP (within 3%). */
export function normalHrAtPower(reads: ActivityRead[], date: string, ftp: number): Map<number, { hr: number; seconds: number; rides: number }> {
  const from = addDays(date, -NORMAL_DAYS);
  const acc = new Map<number, { beats: number; seconds: number; rides: number }>();
  for (const r of reads) {
    if (r.date >= date || r.date < from || !r.hrAtPower) continue;
    if (Math.abs(r.ftpAtRead - ftp) > ftp * 0.03) continue;
    for (const b of r.hrAtPower) {
      if (b.seconds < COMPARE_FLOOR) continue;
      const a = acc.get(b.lo) ?? { beats: 0, seconds: 0, rides: 0 };
      a.beats += b.hr * b.seconds; a.seconds += b.seconds; a.rides += 1;
      acc.set(b.lo, a);
    }
  }
  const out = new Map<number, { hr: number; seconds: number; rides: number }>();
  for (const [lo, a] of acc) if (a.rides >= 2) out.set(lo, { hr: a.beats / a.seconds, seconds: a.seconds, rides: a.rides });
  return out;
}

/** Beats above (+) or below (−) the rider's normal at the same power, weighted by this ride's time in each band. */
export function hrVsNormal(read: ActivityRead, reads: ActivityRead[]): { beats: number; from: number; to: number } | undefined {
  if (!read.hrAtPower?.length) return undefined;
  const normal = normalHrAtPower(reads, read.date, read.ftpAtRead);
  let diff = 0, sec = 0, lo = Infinity, hi = 0;
  for (const b of read.hrAtPower) {
    const n = normal.get(b.lo);
    if (!n || b.seconds < COMPARE_FLOOR) continue;
    diff += (b.hr - n.hr) * b.seconds; sec += b.seconds; lo = Math.min(lo, b.lo); hi = Math.max(hi, b.hi);
  }
  if (sec < COMPARE_FLOOR) return undefined;
  return { beats: Math.round((diff / sec) * 10) / 10, from: Math.round(lo * read.ftpAtRead), to: Math.round(hi * read.ftpAtRead) };
}

/** Ventilation against the rider's normal at the same power, in percent (positive = breathing harder). */
export function breathVsNormal(read: ActivityRead, normal: BreathNormal | undefined): number | undefined {
  if (!read.veAtPower?.length || !normal || Math.abs(normal.ftp - read.ftpAtRead) > read.ftpAtRead * 0.03) return undefined;
  let ratio = 0, sec = 0;
  for (const b of read.veAtPower) {
    const n = normal.bands.find((x) => x.lo === b.lo);
    if (!n || n.ve <= 0) continue;
    ratio += (b.ve / n.ve) * b.seconds; sec += b.seconds;
  }
  return sec >= COMPARE_FLOOR ? Math.round((ratio / sec - 1) * 100) : undefined;
}

const KIND_WORD: Record<SessionKind, string> = { ride: 'ride', strength: 'strength session', mobility: 'mobility session', walk: 'walk', run: 'run', other: 'activity' };

export function minutesWords(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function clock(sec: number): string {
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`;
}

/** The biggest zones, in words: "2 h 50 min in zone 2 and 25 min in zone 3". Zones under 5 minutes or 10% are left out. */
function zoneWords(z: number[] | undefined, what: string): string | undefined {
  if (!z?.length) return undefined;
  const total = z.reduce((a, b) => a + b, 0);
  if (!total) return undefined;
  const top = z.map((s, i) => ({ s, i })).filter((x) => x.s >= 300 && x.s >= total * 0.1).sort((a, b) => b.s - a.s).slice(0, 3).sort((a, b) => a.i - b.i);
  if (!top.length) return undefined;
  const parts = top.map((x) => `${minutesWords(x.s)} in ${what} zone ${x.i + 1}`);
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface WordsContext {
  /** Every read, for the rider's normal heart rate at power. */
  reads: ActivityRead[];
  breathNormal?: BreathNormal;
}

/**
 * One or two plain sentences on what an activity shows, for the coach's
 * evidence and the activity page. Every number is named. A planned activity
 * gets a second sentence on the steps ridden; how much of the plan was reached
 * is said as a fact with no judgement.
 */
export function readWords(read: ActivityRead, ctx: WordsContext): string[] {
  const out: string[] = [];
  const bits: string[] = [];
  const zones = read.powerZones ? zoneWords(read.powerZones, 'power') : zoneWords(read.hrZones, 'heart-rate');
  if (zones) bits.push(zones);
  if (read.powerZones && read.hrZones && read.kind === 'ride') { /* power zones already said */ }
  if (read.normalizedPower) bits.push(`normalized power ${read.normalizedPower} W${read.intensityFactor ? ` (intensity ${read.intensityFactor.toFixed(2)} of FTP)` : ''}`);
  if (read.averageHr) bits.push(`average heart rate ${read.averageHr} bpm${read.peakHr ? `, peak ${read.peakHr} bpm` : ''}`);
  const vs = hrVsNormal(read, ctx.reads);
  if (vs && Math.abs(vs.beats) >= 1) bits.push(`heart rate at ${vs.from} to ${vs.to} W averaged ${Math.abs(Math.round(vs.beats))} bpm ${vs.beats > 0 ? 'above' : 'below'} the rider's usual for that power over the previous 8 weeks`);
  else if (vs) bits.push(`heart rate at ${vs.from} to ${vs.to} W was the rider's usual for that power`);
  // Drift and fade mean something on steady riding; a session of hard steps is read by its steps instead.
  const steady = !read.planned?.steps.length && !read.planned?.test;
  if (read.drift != null && steady) bits.push(`heart rate drifted ${read.drift >= 0 ? 'up' : 'down'} ${Math.abs(read.drift)}% against power from the first half to the second`);
  if (read.fade != null && steady) bits.push(read.fade >= 0.97 ? 'power held from the first quarter to the last' : `power in the last quarter ${Math.round((1 - read.fade) * 100)}% below the first`);
  if (read.has.breathing) {
    const bv = breathVsNormal(read, ctx.breathNormal);
    const frozen = read.breathFrozenAt != null ? `breathing strap stopped reading at ${clock(read.breathFrozenAt)}, so only the breathing before that is used` : '';
    if (read.breathFrozenAt != null && read.breathFrozenAt < 600) bits.push('breathing set aside: the strap stopped reading in the first minutes');
    else {
      if (bv != null) bits.push(`ventilation ${Math.abs(bv)}% ${bv >= 0 ? 'above' : 'below'} the rider's normal at the same power`);
      if (read.averageBreathRate) bits.push(`average breathing rate ${read.averageBreathRate} breaths a minute`);
      if (frozen) bits.push(frozen);
    }
  }
  if (read.effort) bits.push(`effort ${read.effort}/10`);
  if (!read.has.streams && !read.zoneSource) bits.push('no recording beyond its duration and load');
  out.push(`${minutesWords(read.seconds)} ${KIND_WORD[read.kind]}${read.tss != null ? `, training load ${read.tss} TSS` : ''}${bits.length ? `: ${bits.join('; ')}` : ''}.`);
  if (read.planned) {
    const pl = read.planned;
    const parts: string[] = [];
    if (pl.steps.length) parts.push(`steps ridden: ${pl.steps.join('; ')}`);
    if (pl.verdict) parts.push(pl.verdict.kind === 'held' ? `the hard work was held${pl.verdict.hr === 'high' ? ', with heart rate high at the end' : ''}` : pl.verdict.kind === 'short' ? `the hard work fell short of its targets${pl.verdict.hr === 'high' ? ', with heart rate high' : ''}` : 'the hard work was a little under its targets');
    if (pl.reached) parts.push(`the recording ends after step ${pl.reached.steps} of ${pl.reached.of} (a fact only: why it ended is not known)`);
    out.push(`Planned as ${pl.name}${parts.length ? `: ${parts.join('; ')}` : ''}.`);
  }
  return out;
}
