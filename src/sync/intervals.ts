/**
 * The one module that knows Intervals.icu exists.
 *
 * Everything learned in VeloIQ 1.0 about the API's field names is codified here:
 *   - activities: `icu_weighted_avg_watts` is normalized power, `icu_average_watts`
 *     average power, `icu_training_load` Intervals' own TSS, `icu_intensity` IF,
 *     `average_speed` is m/s, `average_temp` is °C, `icu_zone_times` and
 *     `icu_hr_zone_times` are seconds per zone, `icu_ftp` is the FTP in force.
 *   - wellness: entries are keyed by `id` (the date, YYYY-MM-DD), returned oldest
 *     first; `hrv`, `restingHR`, `sleepSecs`, `sleepScore`, `weight` (kg).
 *   - auth: HTTP Basic with username API_KEY and the key as the password.
 *   - events: POST /athlete/{id}/events with category WORKOUT and the workout
 *     text in `description`; Intervals.icu pushes it to Garmin Connect.
 */
import type { Basis, Ride, SessionKind, Wellness, Workout } from '../engine/types';
import { NO_FLOOR, renderIntervalsText, workoutStats } from '../engine/workout';
import { defaultHrZoneTops, defaultZonePcts, footHrZones, footLthr as footThreshold, ladderPcts, ladderTops, rideHrZones, rideLadders, ridePowerZones, validTops } from '../engine/zones';
import type { Profile } from '../engine/types';
import { EASY_WALK, bandFractions, hasNoFloor, recoveryBand, stepBand, walkBand, type FootBand } from '../engine/foot';

const BASE = 'https://intervals.icu/api/v1';

export interface IntervalsCredentials {
  athleteId: string;   // e.g. i123456
  apiKey: string;
}

export class IntervalsError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

function headers(c: IntervalsCredentials): HeadersInit {
  return {
    Authorization: 'Basic ' + btoa(`API_KEY:${c.apiKey}`),
    'Content-Type': 'application/json',
  };
}

async function call<T>(c: IntervalsCredentials, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(c), ...(init.headers ?? {}) } });
  } catch {
    throw new IntervalsError('Could not reach intervals.icu. Check your connection.');
  }
  if (res.status === 401 || res.status === 403) throw new IntervalsError('Intervals.icu rejected the athlete ID or API key.', res.status);
  if (!res.ok) {
    let why = '';
    try { const t = await res.text(); try { const j = JSON.parse(t) as { error?: string; message?: string }; why = j.error ?? j.message ?? t; } catch { why = t; } } catch { /* no body */ }
    throw new IntervalsError(`Intervals.icu answered ${res.status}${why ? `: ${why.slice(0, 200)}` : '.'}`, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface AthleteNumbers {
  name: string;
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  restingHr?: number;
  weight?: number;
  /** Top of power zones 1..6 as whole percent of FTP, as Intervals.icu keeps them. */
  powerZonePcts?: number[];
  /** Top of heart-rate zones 1..6 on the bike in bpm, as Intervals.icu keeps them. */
  hrZoneTops?: number[];
  /** Threshold heart rate and zone tops on foot (Intervals.icu's Run settings). */
  footLthr?: number;
  footHrZoneTops?: number[];
}

/**
 * Fold the numbers Intervals.icu holds into the profile. Thresholds come across
 * as they are. A zone table comes across only when it differs from what the
 * profile already says, so a table the rider keeps as shares of threshold is
 * not turned into fixed numbers by every sync; when it does differ, the
 * rider changed it in Intervals.icu, and it arrives in Intervals.icu's unit.
 */
export function applyAthleteNumbers(p: Profile, a: AthleteNumbers): Profile {
  const next: Profile = { ...p, ftp: a.ftp ?? p.ftp, lthr: a.lthr ?? p.lthr, maxHr: a.maxHr ?? p.maxHr, restingHr: a.restingHr ?? p.restingHr, weightKg: a.weight ?? p.weightKg, footLthr: a.footLthr ?? p.footLthr };
  const same = (x?: number[], y?: number[]) => !!x && !!y && x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= 1);
  if (a.powerZonePcts && !same(a.powerZonePcts, ladderPcts(ridePowerZones(next)))) { next.powerZoneMode = 'pct'; next.powerZonePcts = a.powerZonePcts; }
  if (a.hrZoneTops && !same(a.hrZoneTops, ladderTops(rideHrZones(next), next.lthr))) { next.hrZoneMode = 'abs'; next.hrZoneTops = a.hrZoneTops; }
  if (a.footHrZoneTops && !same(a.footHrZoneTops, ladderTops(footHrZones(next), footThreshold(next)))) { next.footHrZoneMode = 'abs'; next.footHrZoneTops = a.footHrZoneTops; }
  return next;
}

/** What Save sends: thresholds, and each table in the unit Intervals.icu keeps it in. */
export function numbersToPush(p: Profile): Parameters<typeof pushAthleteNumbers>[1] {
  return {
    ftp: p.ftp, lthr: p.lthr, maxHr: p.maxHr,
    powerZonePcts: ladderPcts(ridePowerZones(p)),
    hrZoneTops: ladderTops(rideHrZones(p), p.lthr),
    footLthr: footThreshold(p),
    footHrZoneTops: ladderTops(footHrZones(p), footThreshold(p)),
  };
}

/** The rider's numbers a workout is sent with, so targets land on the right ladders. */
export type HrProfile = Pick<Profile, 'maxHr' | 'lthr'> & Partial<Profile>;

/**
 * The athlete's numbers as Intervals.icu holds them. FTP, LTHR and max HR live in
 * the per-sport settings (the "Ride" entry); weight and resting HR on the athlete.
 * Also proves the credentials work.
 */
export async function testConnection(c: IntervalsCredentials): Promise<AthleteNumbers> {
  const a = await call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`);
  const sport = rideSettings(a);
  const foot = footSettings(a)[0];
  return {
    name: String(a.name ?? ''),
    ftp: num(sport?.ftp) ?? num(a.icu_ftp),
    lthr: num(sport?.lthr),
    maxHr: num(sport?.max_hr),
    restingHr: num(a.icu_resting_hr),
    weight: num(a.icu_weight) ?? num(a.weight),
    powerZonePcts: zonePcts(sport?.power_zones),
    hrZoneTops: zoneTops(sport?.hr_zones, num(sport?.lthr)),
    footLthr: num(foot?.lthr),
    footHrZoneTops: zoneTops(foot?.hr_zones, num(foot?.lthr)),
  };
}

/**
 * Intervals.icu keeps a zone table as the top of each zone in bpm, max HR last.
 * The app keeps the top of zones 1 to 6. A shorter table (a rider who typed the
 * Garmin's five zones in, say) keeps the tops it has and fills the rest from the
 * standard shares of threshold, kept increasing; Save writes the full seven back.
 */
/** Intervals.icu keeps power zones as the top of each zone in percent of FTP, with an open last entry (999). */
function zonePcts(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const given = v.slice(0, -1).map((x) => Math.round(Number(x))).slice(0, 6);
  const standard = defaultZonePcts('power');
  const pcts: number[] = [];
  for (let i = 0; i < 6; i++) pcts.push(i < given.length ? given[i] : Math.max(standard[i], (pcts[i - 1] ?? 0) + 1));
  return validTops(pcts) ? pcts : undefined;
}

function zoneTops(v: unknown, lthr: number | undefined): number[] | undefined {
  if (!Array.isArray(v) || v.length < 3 || !lthr) return undefined;
  const given = v.slice(0, -1).map((x) => Number(x)).slice(0, 6);
  const standard = defaultHrZoneTops(lthr);
  const tops: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = i < given.length ? given[i] : Math.max(standard[i], (tops[i - 1] ?? 0) + 1);
    tops.push(t);
  }
  return validTops(tops) ? tops : undefined;
}

function sportSettings(athlete: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(athlete.sportSettings) ? (athlete.sportSettings as Array<Record<string, unknown>>) : [];
}

function rideSettings(athlete: Record<string, unknown>): Record<string, unknown> | undefined {
  const settings = sportSettings(athlete);
  return settings.find((s) => (s.types as string[] | undefined)?.includes('Ride')) ?? settings[0];
}

/**
 * The settings that govern runs and walks: Intervals.icu files a Walk under its
 * "Other" entry and a Run under "Run", so both are kept the same. Run first, so
 * it is the one read back.
 */
function footSettings(athlete: Record<string, unknown>): Array<Record<string, unknown>> {
  const settings = sportSettings(athlete);
  const types = (s: Record<string, unknown>) => (s.types as string[] | undefined) ?? [];
  const run = settings.filter((s) => types(s).includes('Run'));
  const other = settings.filter((s) => !types(s).includes('Run') && (types(s).includes('Other') || types(s).includes('Walk')));
  return [...run, ...other];
}

/** Intervals.icu wants a name per zone whenever a table is written, the same count as the table. */
const HR_ZONE_NAMES = ['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max', 'Anaerobic', 'Neuromuscular'];

/**
 * Push FTP, LTHR and max HR to Intervals.icu. This matters: Intervals.icu turns
 * the app's "% of FTP" into watts with ITS FTP before the workout reaches Garmin,
 * so the two must agree. Only the fields given are changed.
 */
export async function pushAthleteNumbers(c: IntervalsCredentials, n: { ftp?: number; lthr?: number; maxHr?: number; powerZonePcts?: number[]; hrZoneTops?: number[]; footLthr?: number; footHrZoneTops?: number[] }): Promise<void> {
  const a = await call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`);
  const sport = rideSettings(a);
  if (!sport || sport.id == null) throw new IntervalsError('Intervals.icu has no cycling sport settings to update; open its Settings page once and save, then try again.');
  const body: Record<string, unknown> = {};
  if (n.ftp) { body.ftp = n.ftp; body.indoor_ftp = n.ftp; }
  if (n.lthr) body.lthr = n.lthr;
  if (n.maxHr) body.max_hr = n.maxHr;
  if (validTops(n.hrZoneTops) && n.maxHr) { body.hr_zones = [...n.hrZoneTops, n.maxHr]; body.hr_zone_names = HR_ZONE_NAMES; }
  if (validTops(n.powerZonePcts)) { body.power_zones = [...n.powerZonePcts, 999]; body.power_zone_names = HR_ZONE_NAMES; }
  if (Object.keys(body).length) await call(c, `/athlete/${c.athleteId}/sport-settings/${sport.id}`, { method: 'PUT', body: JSON.stringify(body) });
  // Runs and walks: their own threshold and table, written to every entry that governs them.
  const foot: Record<string, unknown> = {};
  if (n.footLthr) foot.lthr = n.footLthr;
  if (n.maxHr) foot.max_hr = n.maxHr;
  if (validTops(n.footHrZoneTops) && n.maxHr) { foot.hr_zones = [...n.footHrZoneTops, n.maxHr]; foot.hr_zone_names = HR_ZONE_NAMES; }
  if (!n.footLthr && !validTops(n.footHrZoneTops)) return;
  for (const s of footSettings(a)) {
    if (s.id == null) continue;
    await call(c, `/athlete/${c.athleteId}/sport-settings/${s.id}`, { method: 'PUT', body: JSON.stringify(foot) });
  }
}

interface IcuActivity {
  id: string;
  start_date_local: string;
  name?: string;
  type?: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  total_elevation_gain?: number;
  icu_training_load?: number;
  icu_weighted_avg_watts?: number;
  icu_average_watts?: number;
  icu_intensity?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_speed?: number;
  average_temp?: number;
  icu_efficiency_factor?: number;
  decoupling?: number;
  icu_zone_times?: Array<{ id: string; secs: number }> | number[];
  icu_hr_zone_times?: number[];
  icu_ftp?: number;
  icu_eftp?: number;
  paired_event_id?: number;
  description?: string;
}

/**
 * How Intervals.icu activity types map onto the app's session kinds. A walk
 * done on a treadmill, or recorded on a watch profile Garmin files as running,
 * arrives as a Run type: a "run" slower than 7 km/h (4.4 mph) is a walk.
 */
export function sportOf(type: string, averageSpeedMs?: number): SessionKind {
  if (/Ride/.test(type) || type === 'Velomobile') return 'ride';
  if (/Walk|Hike|Ruck/.test(type)) return 'walk';
  if (/Run|Treadmill/.test(type) && averageSpeedMs != null && averageSpeedMs > 0 && averageSpeedMs < 1.95) return 'walk';
  if (/Run|Treadmill/.test(type)) return 'run';   // 7 km/h or faster, or no speed recorded (a treadmill run without a footpod)
  if (/^(WeightTraining|Workout|Crossfit|HIIT)$/.test(type)) return 'strength';
  if (/^(Yoga|Pilates|Stretching|Mobility)$/.test(type)) return 'mobility';
  return 'other';   // swims, rows, anything else: counted toward load, never planned
}

/**
 * The duration the app counts for an activity. Moving time suits a ride (stops
 * at lights are not training). For a walk, strength or mobility session the
 * watch decides "moving" from wrist motion and GPS: on a treadmill with the arm
 * still, or standing at the bench, most of the session reads as stopped. The
 * whole session is the work, so those count elapsed time.
 */
export function durationFor(kind: SessionKind, moving?: number, elapsed?: number): number {
  if (kind === 'ride' || kind === 'run' || kind === 'other') return moving || elapsed || 0;   // a run, like a ride, stops at lights
  return elapsed || moving || 0;
}

/** Every activity Intervals.icu holds for the window, whatever recorded it. */
export async function fetchRides(c: IntervalsCredentials, oldest: string, newest: string): Promise<Ride[]> {
  const list = await call<IcuActivity[]>(c, `/athlete/${c.athleteId}/activities?oldest=${oldest}&newest=${newest}`);
  return list.map(toRide);
}

function toRide(a: IcuActivity): Ride {
  const sport = sportOf(a.type ?? 'Ride', a.average_speed);
  return {
    id: String(a.id),
    date: a.start_date_local.slice(0, 10),
    startTime: a.start_date_local,
    name: a.name ?? 'Activity',
    type: a.type ?? 'Ride',
    sport,
    seconds: durationFor(sport, a.moving_time, a.elapsed_time),
    movingSeconds: a.moving_time,
    elapsedSeconds: a.elapsed_time,
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    icuLoad: a.icu_training_load,
    normalizedPower: a.icu_weighted_avg_watts,
    averagePower: a.icu_average_watts,
    intensityFactor: intensityFraction(a.icu_intensity, a.icu_weighted_avg_watts, a.icu_ftp),
    averageHr: a.average_heartrate,
    maxHr: a.max_heartrate,
    averageCadence: a.average_cadence,
    averageSpeedMs: a.average_speed,
    averageTempC: a.average_temp,
    efficiencyFactor: a.icu_efficiency_factor,
    decoupling: a.decoupling,
    powerZoneSeconds: zoneSeconds(a.icu_zone_times),
    sweetSpotSeconds: sweetSpotSeconds(a.icu_zone_times),
    hrZoneSeconds: a.icu_hr_zone_times,
    ftpAtRide: a.icu_ftp,
    eftp: a.icu_eftp,
    pairedEventId: a.paired_event_id,
    description: a.description ?? undefined,
  };
}

/**
 * Intensity factor as a fraction of FTP. Intervals.icu's `icu_intensity` is a
 * percent (84, not 0.84) and exists only for rides with power; a value under 3
 * is taken as already a fraction, in case the API changes. Without it, NP over
 * the FTP of the day; without power, unknown (never 0 or 1: the engine treats
 * an unknown intensity as unknown).
 */
export function intensityFraction(icuIntensity?: number, normalizedPower?: number, ftp?: number): number | undefined {
  if (icuIntensity != null && icuIntensity > 0) return round2(icuIntensity > 3 ? icuIntensity / 100 : icuIntensity);
  if (normalizedPower && ftp) return round2(normalizedPower / ftp);
  return undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Seconds in power zones 1 to 7. Intervals.icu labels each entry ("Z1".."Z7")
 * and adds a sweet-spot entry ("SS") whose time is already inside zones 3 and 4;
 * read by label, so that extra entry never shows up as a zone 8.
 */
export function zoneSeconds(z: IcuActivity['icu_zone_times']): number[] | undefined {
  if (!z?.length) return undefined;
  if (typeof z[0] === 'number') return (z as number[]).slice(0, 7);
  const byId = new Map((z as Array<{ id: string; secs: number }>).map((x) => [String(x.id).toUpperCase(), x.secs]));
  const out = [1, 2, 3, 4, 5, 6, 7].map((n) => byId.get(`Z${n}`) ?? 0);
  return out.some((s) => s > 0) ? out : undefined;
}

/** Intervals.icu's sweet-spot time for the activity, when it reports one. */
export function sweetSpotSeconds(z: IcuActivity['icu_zone_times']): number | undefined {
  if (!z?.length || typeof z[0] === 'number') return undefined;
  const ss = (z as Array<{ id: string; secs: number }>).find((x) => String(x.id).toUpperCase() === 'SS');
  return ss && ss.secs > 0 ? ss.secs : undefined;
}

/**
 * Best power over standard durations across a date range, as Intervals.icu
 * computes it. The response shape has varied; both known forms are read.
 */
export async function fetchPowerCurve(c: IntervalsCredentials, oldest: string, newest: string): Promise<Array<{ seconds: number; watts: number }>> {
  const raw = await call<unknown>(c, `/athlete/${c.athleteId}/power-curves?type=Ride&oldest=${oldest}&newest=${newest}`);
  const out: Array<{ seconds: number; watts: number }> = [];
  const take = (secs: unknown, watts: unknown) => {
    if (Array.isArray(secs) && Array.isArray(watts)) secs.forEach((s, i) => { if (typeof s === 'number' && typeof watts[i] === 'number') out.push({ seconds: s, watts: watts[i] as number }); });
  };
  if (Array.isArray(raw)) {
    for (const item of raw as Array<Record<string, unknown>>) {
      if (typeof item.secs === 'number' && typeof item.watts === 'number') out.push({ seconds: item.secs, watts: item.watts });
      else take(item.secs, item.watts);
    }
  } else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    take(o.secs, o.watts);
    const list = (o.list ?? o.curves) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(list)) for (const item of list) take(item.secs, item.watts);
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

interface IcuWellness {
  id: string;
  hrv?: number;
  restingHR?: number;
  sleepSecs?: number;
  sleepScore?: number;
  weight?: number;
}

export async function fetchWellness(c: IntervalsCredentials, oldest: string, newest: string): Promise<Wellness[]> {
  const list = await call<IcuWellness[]>(c, `/athlete/${c.athleteId}/wellness?oldest=${oldest}&newest=${newest}`);
  return list.map((w) => ({
    date: w.id,
    hrv: w.hrv,
    restingHr: w.restingHR,
    sleepSeconds: w.sleepSecs,
    sleepScore: w.sleepScore,
    weightKg: w.weight,
  }));
}

/**
 * Put a workout on the Intervals.icu calendar. Intervals.icu forwards it to
 * Garmin Connect, which sends it to the Edge on its next phone sync.
 * Returns the event id, which is how the ride is later paired back.
 */
export async function sendWorkout(c: IntervalsCredentials, workout: Workout, date: string, basis: Basis, profile?: HrProfile): Promise<number> {
  const body = workout.kind === 'walk' ? walkEvent(workout, date, profile)
    : workout.kind === 'run' ? runEvent(workout, date, profile)
    : workout.kind === 'strength' || workout.kind === 'mobility' ? sessionEvent(workout, date)
    : rideEvent(workout, date, basis, profile);
  const ev = await call<{ id: number }>(c, `/athlete/${c.athleteId}/events`, { method: 'POST', body: JSON.stringify(body) });
  return ev.id;
}

function rideEvent(workout: Workout, date: string, basis: Basis, profile?: HrProfile) {
  const stats = workoutStats(workout.blocks);
  const zones = profile?.ftp ? rideLadders({ ...profile, ftp: profile.ftp }) : undefined;
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Ride',
    name: workout.subtitle ? `${workout.name} · ${workout.subtitle}` : workout.name,
    description: renderIntervalsText(workout, basis, zones),
    moving_time: stats.seconds,
    icu_training_load: stats.tss,
  };
}

/**
 * A walk goes to the Garmin as a walking workout with one heart-rate step. The
 * app's target is a share of max heart rate; Intervals.icu takes heart-rate
 * targets as a share of threshold, so it is converted with the rider's numbers.
 */
/**
 * A strength or mobility session goes to the Garmin as a step-by-step workout:
 * Intervals.icu carries no exercises, so each set is a step that ends on a
 * lap press (the estimate after the name is only for the plan's clock), each
 * rest and each hold is a timed step the watch counts down. Garmin shows the
 * step's name, so the name carries the exercise, reps and load.
 */
export function sessionSteps(workout: Workout): string[] {
  const ex = workout.exercises ?? [];
  const effort = workout.effort ?? 6;
  const restSec = workout.kind === 'mobility' ? 0 : effort >= 8 ? 120 : effort <= 5 ? 60 : 90;
  const dur = (s: number) => (s >= 60 && s % 60 === 0 ? `${s / 60}m` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`);
  const blocks: Array<{ times: number; steps: string[] }> = [];
  for (const e of ex) {
    const sets = Math.max(1, e.sets ?? 1);
    const load = e.load && !/bodyweight|slow and controlled|keep moving|reps in reserve/i.test(e.load) ? ` ${garminText(e.load)}` : '';
    const name = garminText(e.name.length > 40 ? e.name.slice(0, 39) : e.name);
    if (e.holdSeconds) {
      // Holds and stretches are timed and the watch counts them down; stretches get a step a side.
      const perSide = workout.kind === 'mobility' && /side|left|right|per leg|each leg/i.test(`${e.reps ?? ''} ${e.cue}`);
      const steps = perSide ? [`- ${name} left side ${dur(e.holdSeconds)}`, `- ${name} right side ${dur(e.holdSeconds)}`] : [`- ${name} ${dur(e.holdSeconds)}`];
      if (restSec) steps.push(`- Rest ${dur(restSec / 2)}`);
      blocks.push({ times: sets, steps });
      continue;
    }
    // A set ends on the lap press; the time after it is only the plan's estimate of a set.
    const estimate = Math.max(30, Math.round((parseInt(e.reps ?? '10', 10) || 10) * 4 / 5) * 5 + 10);
    const reps = e.reps ? ` ${garminText(e.reps)}${/rep/i.test(e.reps) ? '' : ' reps'}` : '';
    const lastW = lastWeightOf(e.name);
    const last = lastW ? ` last ${garminText(lastW)}` : '';
    const steps = [`- Press lap ${name}${reps}${load}${last} ${dur(estimate)}`];
    if (restSec) steps.push(`- Rest ${dur(restSec)}`);
    blocks.push({ times: sets, steps });
  }
  // No rest after the very last set of the session.
  const last = blocks[blocks.length - 1];
  if (last && last.times === 1 && /^- Rest /.test(last.steps[last.steps.length - 1])) last.steps.pop();
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.times > 1) lines.push('', `${b.times}x`, ...b.steps, '');
    else lines.push(...b.steps);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().split('\n');
}

/**
 * The steps of a strength or mobility session as the watch records them, one
 * lap each, in order, named for people: "Goblet squat, set 2 of 3",
 * "Hip flexor stretch, left side", "Rest". Built exactly as sessionSteps sends
 * them, so the recording's laps can be named after them.
 */
export function sessionLapNames(workout: Workout): string[] {
  const ex = workout.exercises ?? [];
  const effort = workout.effort ?? 6;
  const restSec = workout.kind === 'mobility' ? 0 : effort >= 8 ? 120 : effort <= 5 ? 60 : 90;
  const blocks: Array<{ times: number; steps: (k: number) => string[] }> = [];
  for (const e of ex) {
    const sets = Math.max(1, e.sets ?? 1);
    const of = (k: number) => (sets > 1 ? `, set ${k} of ${sets}` : '');
    if (e.holdSeconds) {
      const perSide = workout.kind === 'mobility' && /side|left|right|per leg|each leg/i.test(`${e.reps ?? ''} ${e.cue}`);
      blocks.push({ times: sets, steps: (k) => [...(perSide ? [`${e.name}, left side${of(k)}`, `${e.name}, right side${of(k)}`] : [`${e.name}${of(k)}`]), ...(restSec ? ['Rest'] : [])] });
      continue;
    }
    blocks.push({ times: sets, steps: (k) => [`${e.name}${of(k)}`, ...(restSec ? ['Rest'] : [])] });
  }
  const out: string[] = [];
  blocks.forEach((b, i) => { for (let k = 1; k <= b.times; k++) out.push(...b.steps(k)); if (i === blocks.length - 1 && b.times === 1 && out[out.length - 1] === 'Rest') out.pop(); });
  return out;
}

/** A last lap this short is the watch closing the recording, not a step. */
export const STRAY_LAP_S = 10;

/**
 * Names for a strength or mobility recording's laps (Todd, 28 Oct): when the
 * laps match the session's steps one for one (a stray last lap under ten
 * seconds aside), each takes its step's name; when they don't (a lap press
 * missed or extra), they are numbered, never guessed.
 */
export function nameLaps(laps: Array<{ start: number; end: number }>, steps: string[] | undefined): { names: string[]; matched: boolean } {
  const n = laps.length;
  const numbered = laps.map((_, i) => `Lap ${i + 1}`);
  if (!steps?.length) return { names: numbered, matched: false };
  const stray = n === steps.length + 1 && laps[n - 1].end - laps[n - 1].start < STRAY_LAP_S;
  if (n === steps.length || stray) return { names: laps.map((_, i) => steps[i] ?? 'End'), matched: true };
  return { names: numbered, matched: false };
}

/**
 * Step text the way Intervals.icu passes it to Garmin: short and readable.
 * Numbers stay as numerals ("8 reps", "40 lb"), which take less of the watch's
 * screen; a range is written "8 to 10" because a bare "8-10" could be read by
 * Intervals.icu as a target range. Decimals are rounded and punctuation goes.
 */
export function garminText(text: string): string {
  return text
    .replace(/(\d+)\s*[-–—]\s*(\d+)/g, '$1 to $2')
    .replace(/\d+\.\d+/g, (m) => String(Math.round(+m)))
    .replace(/×|(?<=\s|^)x(?=\s)/g, ' ')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sessionEvent(workout: Workout, date: string) {
  const steps = sessionSteps(workout);
  const intro = workout.kind === 'strength'
    ? 'Each set ends when you press lap; rests count down. '
    : 'Each stretch is timed; the watch moves you on. ';
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    // INTERIM (19 Oct 2026): Intervals.icu passes step text to Garmin for Ride workouts and drops it for every
    // other type (tested on an Epix Pro Gen 2: identical steps show their names in a bike activity and only
    // "Go" in a strength one). So strength and mobility go as rides, followed on the watch in an indoor-bike
    // profile, and the recording that comes back is relabelled in Intervals.icu once it is paired
    // (syncService). A feature request is with Intervals.icu; when step text travels for other types, change
    // SESSION_EVENT_TYPE to WeightTraining / Yoga and the relabelling becomes a no-op.
    type: SESSION_EVENT_TYPE,
    name: workout.name,
    description: [`${workout.purpose} ${intro}`, '', ...steps].join('\n'),
    moving_time: (workout.minutes ?? 30) * 60,
    icu_training_load: workout.estimatedTss ?? 0,
  };
}

/** How strength and mobility sessions are typed when sent; see sessionEvent. */
export const SESSION_EVENT_TYPE = 'Ride';
/** The type each kind of recording ought to carry in Intervals.icu. */
export const ICU_TYPE_FOR_KIND: Record<string, string> = { strength: 'WeightTraining', mobility: 'Yoga', walk: 'Walk', run: 'Run' };

/** Set an activity's type in Intervals.icu (a recording the watch filed as a ride but that was a planned strength session, say). */
export async function updateActivityType(c: IntervalsCredentials, activityId: string, type: string): Promise<void> {
  await call(c, `/activity/${activityId}`, { method: 'PUT', body: JSON.stringify({ type }) });
}

/** Rename an activity. */
export async function updateActivityName(c: IntervalsCredentials, activityId: string, name: string): Promise<void> {
  await call(c, `/activity/${activityId}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

/** Write the app's record of what was done into an activity's description (callers check it is empty or the app's own). */
export async function updateActivityDescription(c: IntervalsCredentials, activityId: string, description: string): Promise<void> {
  await call(c, `/activity/${activityId}`, { method: 'PUT', body: JSON.stringify({ description }) });
}

/**
 * "Last time" for an exercise, for the step text sent to the Garmin
 * ("last 35 lb"). Set by the app at start-up from the calendar's done records;
 * the adapter itself keeps no state.
 */
let lastWeightOf: (name: string) => string | undefined = () => undefined;
export function setLastWeightLookup(fn: (name: string) => string | undefined): void { lastWeightOf = fn; }

function walkEvent(workout: Workout, date: string, profile?: HrProfile) {
  const w = workout.walk ?? { minutes: workout.minutes ?? 30, ...EASY_WALK };
  const b = walkBand(w, profile);
  const pack = w.packKg ? ` with a ${Math.round(w.packKg * 2.2)} lb pack` : '';
  const lines = [
    `${workout.purpose}${pack ? ` Walk${pack}.` : ''}`,
    '',
    `- ${w.minutes}m ${footTarget(b, profile)}`,
  ];
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Walk',
    name: workout.name,
    description: lines.join('\n'),
    moving_time: w.minutes * 60,
    icu_training_load: workout.estimatedTss ?? 0,
  };
}

/**
 * A band on the foot table as the "% LTHR" target Intervals.icu takes: shares of
 * the threshold it applies to a Walk or a Run, which is the foot threshold (the
 * Run and Other settings' number), read straight off the rider's foot table.
 */
function footTarget(b: FootBand, profile?: HrProfile): string {
  const f = bandFractions(b, profile);
  const lo = hasNoFloor(b) ? Math.round(NO_FLOOR.hr * 100) : Math.round(f.low * 100);
  return `${lo}-${Math.round(f.high * 100)}% LTHR`;
}

/**
 * A run goes to the Garmin as a Run workout with heart-rate steps, each a band on
 * the rider's foot table. A repeated step is an Intervals.icu repeat block: the
 * work and its recovery, "6x". (Intervals repeats the recovery after the last
 * one too, a minute the app's own count leaves out.)
 */
export function runEvent(workout: Workout, date: string, profile?: HrProfile) {
  const dur = (sec: number) => { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return m && s ? `${m}m${s}s` : m ? `${m}m` : `${s}s`; };
  const lines: string[] = [workout.purpose, ''];
  for (const s of workout.run?.steps ?? []) {
    const n = Math.max(1, s.repeat ?? 1);
    const step = `- ${dur(s.seconds)} ${footTarget(stepBand(s, profile), profile)}`;
    if (n === 1) { lines.push(step); continue; }
    lines.push('', `${s.label ? s.label.split(':')[0] : 'Set'} ${n}x`, step);
    if (s.recoverSeconds) lines.push(`- ${dur(s.recoverSeconds)} ${footTarget(recoveryBand(s, profile), profile)}`);
    lines.push('');
  }
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Run',
    name: workout.name,
    description: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    moving_time: (workout.minutes ?? 0) * 60,
    icu_training_load: workout.estimatedTss ?? 0,
  };
}

/**
 * Record a session done without a device as a manual activity, so Intervals.icu
 * holds the complete record and the next sync treats it like any other.
 */
export async function createManualActivity(c: IntervalsCredentials, a: { date: string; name: string; type: 'Walk' | 'WeightTraining' | 'Yoga' | 'Ride' | 'Run'; seconds: number; tss: number; rpe?: number; description?: string; distanceM?: number }): Promise<string> {
  const full = {
    start_date_local: `${a.date}T12:00:00`,
    name: a.name,
    type: a.type,
    moving_time: a.seconds,
    elapsed_time: a.seconds,
    icu_training_load: a.tss,
    icu_rpe: a.rpe,
    description: a.description,
    ...(a.distanceM ? { distance: a.distanceM } : {}),
  };
  // Intervals.icu validates the body strictly; if it refuses the load/effort fields, send the plain record
  // and then set the load with an update, so the session still counts.
  try {
    const res = await call<{ id?: string | number }>(c, `/athlete/${c.athleteId}/activities/manual`, { method: 'POST', body: JSON.stringify(full) });
    return String(res.id ?? '');
  } catch (e) {
    if (!(e instanceof IntervalsError) || e.status !== 422) throw e;
    const minimal = { start_date_local: full.start_date_local, name: a.name, type: a.type, moving_time: a.seconds, description: a.description };
    const res = await call<{ id?: string | number }>(c, `/athlete/${c.athleteId}/activities/manual`, { method: 'POST', body: JSON.stringify(minimal) });
    const id = String(res.id ?? '');
    if (id) { try { await call(c, `/activity/${id}`, { method: 'PUT', body: JSON.stringify({ icu_training_load: a.tss, icu_rpe: a.rpe }) }); } catch { /* the record exists; load can be edited on Intervals.icu */ } }
    return id;
  }
}

/**
 * Second-by-second data for one activity, plus the intervals Intervals.icu
 * detected. Streams come as a list of {type, data}; intervals as a list with
 * start/end indices and averages.
 */
export interface FetchedStreams {
  time: number[];
  watts?: number[];
  heartrate?: number[];
  cadence?: number[];
  distance?: number[];      // metres from start
  altitude?: number[];      // metres
  velocity?: number[];      // m/s
  temp?: number[];          // °C
  lat?: number[];
  lng?: number[];
  intervals: Array<{ label?: string; type?: string; start: number; end: number; avgWatts?: number; avgHr?: number }>;
}

/** Just time and power for one activity: what the power curve needs, a fraction of the full recording. */
export async function fetchPowerStream(c: IntervalsCredentials, activityId: string): Promise<{ time: number[]; watts?: number[] }> {
  const list = await call<Array<{ type: string; data: number[] }>>(c, `/activity/${activityId}/streams.json?types=time,watts`);
  return { time: list.find((x) => x.type === 'time')?.data ?? [], watts: list.find((x) => x.type === 'watts')?.data };
}

/** The recording behind an activity: every stream Intervals.icu has, plus its interval markers. */
export async function fetchStreams(c: IntervalsCredentials, activityId: string): Promise<FetchedStreams> {
  const list = await call<Array<{ type: string; data: number[]; data2?: number[] }>>(c, `/activity/${activityId}/streams.json?types=time,watts,heartrate,cadence,distance,altitude,velocity_smooth,temp,latlng`);
  const find = (t: string) => list.find((x) => x.type === t);
  const by = (t: string) => find(t)?.data;
  const time = by('time') ?? [];
  const ll = find('latlng');
  let intervals: FetchedStreams['intervals'] = [];
  try {
    const iv = await call<{ icu_intervals?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(c, `/activity/${activityId}/intervals`);
    const arr = Array.isArray(iv) ? iv : (iv.icu_intervals ?? []);
    intervals = arr.map((x) => ({
      label: typeof x.label === 'string' ? x.label : undefined,
      type: typeof x.type === 'string' ? x.type : undefined,
      start: Number(x.start_time ?? x.start_index ?? 0),
      end: Number(x.end_time ?? x.end_index ?? 0),
      avgWatts: num(x.average_watts),
      avgHr: num(x.average_heartrate),
    }));
  } catch { /* intervals are optional */ }
  return {
    time, watts: by('watts'), heartrate: by('heartrate'), cadence: by('cadence'), distance: by('distance'), altitude: by('altitude'),
    velocity: by('velocity_smooth'), temp: by('temp'), lat: ll?.data, lng: ll?.data2, intervals,
  };
}

/**
 * Automatic backup lives as a private note on a far-future calendar date in the
 * rider's own Intervals.icu account, so a new device can restore it right after
 * connecting. Nothing but the rider's key can read it.
 */
export const BACKUP_DATE = '2099-12-31';
const BACKUP_NAME = 'App backup (do not edit)';

export async function readBackupNote(c: IntervalsCredentials): Promise<{ id: number; payload: string; updated?: string } | null> {
  const list = await call<Array<{ id: number; name?: string; description?: string; category?: string; updated?: string }>>(c, `/athlete/${c.athleteId}/events?oldest=${BACKUP_DATE}&newest=${BACKUP_DATE}`);
  const note = list.find((e) => e.name === BACKUP_NAME);
  return note && note.description ? { id: note.id, payload: note.description, updated: note.updated } : null;
}

export async function writeBackupNote(c: IntervalsCredentials, payload: string): Promise<void> {
  const existing = await readBackupNote(c);
  const body = { category: 'NOTE', start_date_local: `${BACKUP_DATE}T00:00:00`, name: BACKUP_NAME, description: payload };
  if (existing) await call(c, `/athlete/${c.athleteId}/events/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
  else await call(c, `/athlete/${c.athleteId}/events`, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteEvent(c: IntervalsCredentials, eventId: number): Promise<void> {
  await call(c, `/athlete/${c.athleteId}/events/${eventId}`, { method: 'DELETE' });
}

/** Any calendar event (note, workout) from a raw body; returns its id. */
export async function createEvent(c: IntervalsCredentials, body: Record<string, unknown>): Promise<number> {
  const ev = await call<{ id: number }>(c, `/athlete/${c.athleteId}/events`, { method: 'POST', body: JSON.stringify(body) });
  return ev.id;
}

export async function deleteActivity(c: IntervalsCredentials, activityId: string): Promise<void> {
  await call(c, `/activity/${activityId}`, { method: 'DELETE' });
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

/**
 * Upload a recorded activity file (the ride player's FIT file). The upload is
 * multipart, so it carries only the key, not the JSON content type. The
 * external id is the recording's own, so a retried upload never makes a
 * second copy. Answers the new activity's id.
 */
export async function uploadActivityFile(c: IntervalsCredentials, file: Uint8Array, o: { name: string; description?: string; externalId: string; fileName: string }): Promise<string> {
  const form = new FormData();
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  form.append('file', new Blob([buf], { type: 'application/octet-stream' }), o.fileName);
  const q = new URLSearchParams({ name: o.name, external_id: o.externalId });
  if (o.description) q.set('description', o.description);
  let res: Response;
  try {
    res = await fetch(`${BASE}/athlete/${c.athleteId}/activities?${q}`, { method: 'POST', body: form, headers: { Authorization: 'Basic ' + btoa(`API_KEY:${c.apiKey}`) } });
  } catch {
    throw new IntervalsError('Could not reach intervals.icu. Check your connection.');
  }
  if (res.status === 401 || res.status === 403) throw new IntervalsError('Intervals.icu rejected the athlete ID or API key.', res.status);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let why = text;
    try { const j = JSON.parse(text) as { error?: string; message?: string }; why = j.error ?? j.message ?? text; } catch { /* plain text */ }
    throw new IntervalsError(`Intervals.icu answered ${res.status}${why ? `: ${why.slice(0, 200)}` : '.'}`, res.status);
  }
  let j: { id?: string | number; activities?: Array<{ id?: string | number }> } = {};
  try { j = JSON.parse(text); } catch { /* no body */ }
  const id = j.id ?? j.activities?.[0]?.id;
  if (id == null) throw new IntervalsError('Intervals.icu took the file but did not say which activity it made.');
  return String(id);
}

/** The rider's effort for an activity (1–10), as Intervals.icu keeps it. */
export async function updateActivityEffort(c: IntervalsCredentials, activityId: string, rpe: number): Promise<void> {
  await call(c, `/activity/${activityId}`, { method: 'PUT', body: JSON.stringify({ icu_rpe: rpe }) });
}
