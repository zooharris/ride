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
}

/**
 * The athlete's numbers as Intervals.icu holds them. FTP, LTHR and max HR live in
 * the per-sport settings (the "Ride" entry); weight and resting HR on the athlete.
 * Also proves the credentials work.
 */
export async function testConnection(c: IntervalsCredentials): Promise<AthleteNumbers> {
  const a = await call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`);
  const sport = rideSettings(a);
  return {
    name: String(a.name ?? ''),
    ftp: num(sport?.ftp) ?? num(a.icu_ftp),
    lthr: num(sport?.lthr),
    maxHr: num(sport?.max_hr),
    restingHr: num(a.icu_resting_hr),
    weight: num(a.icu_weight) ?? num(a.weight),
  };
}

function rideSettings(athlete: Record<string, unknown>): Record<string, unknown> | undefined {
  const settings = Array.isArray(athlete.sportSettings) ? (athlete.sportSettings as Array<Record<string, unknown>>) : [];
  return settings.find((s) => (s.types as string[] | undefined)?.includes('Ride')) ?? settings[0];
}

/**
 * Push FTP, LTHR and max HR to Intervals.icu. This matters: Intervals.icu turns
 * the app's "% of FTP" into watts with ITS FTP before the workout reaches Garmin,
 * so the two must agree. Only the fields given are changed.
 */
export async function pushAthleteNumbers(c: IntervalsCredentials, n: { ftp?: number; lthr?: number; maxHr?: number }): Promise<void> {
  const a = await call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`);
  const sport = rideSettings(a);
  if (!sport || sport.id == null) throw new IntervalsError('Intervals.icu has no cycling sport settings to update; open its Settings page once and save, then try again.');
  const body: Record<string, unknown> = {};
  if (n.ftp) body.ftp = n.ftp;
  if (n.lthr) body.lthr = n.lthr;
  if (n.maxHr) body.max_hr = n.maxHr;
  if (Object.keys(body).length === 0) return;
  await call(c, `/athlete/${c.athleteId}/sport-settings/${sport.id}`, { method: 'PUT', body: JSON.stringify(body) });
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
  if (/^(WeightTraining|Workout|Crossfit|HIIT)$/.test(type)) return 'strength';
  if (/^(Yoga|Pilates|Stretching|Mobility)$/.test(type)) return 'mobility';
  return 'other';   // runs, swims, rows, anything else: counted toward load, never planned
}

/** Every activity Intervals.icu holds for the window, whatever recorded it. */
export async function fetchRides(c: IntervalsCredentials, oldest: string, newest: string): Promise<Ride[]> {
  const list = await call<IcuActivity[]>(c, `/athlete/${c.athleteId}/activities?oldest=${oldest}&newest=${newest}`);
  return list.map(toRide);
}

function toRide(a: IcuActivity): Ride {
  return {
    id: String(a.id),
    date: a.start_date_local.slice(0, 10),
    startTime: a.start_date_local,
    name: a.name ?? 'Activity',
    type: a.type ?? 'Ride',
    sport: sportOf(a.type ?? 'Ride', a.average_speed),
    seconds: a.moving_time ?? a.elapsed_time ?? 0,
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    icuLoad: a.icu_training_load,
    normalizedPower: a.icu_weighted_avg_watts,
    averagePower: a.icu_average_watts,
    intensityFactor: a.icu_intensity,
    averageHr: a.average_heartrate,
    maxHr: a.max_heartrate,
    averageCadence: a.average_cadence,
    averageSpeedMs: a.average_speed,
    averageTempC: a.average_temp,
    efficiencyFactor: a.icu_efficiency_factor,
    decoupling: a.decoupling,
    powerZoneSeconds: zoneSeconds(a.icu_zone_times),
    hrZoneSeconds: a.icu_hr_zone_times,
    ftpAtRide: a.icu_ftp,
    eftp: a.icu_eftp,
    pairedEventId: a.paired_event_id,
  };
}

function zoneSeconds(z: IcuActivity['icu_zone_times']): number[] | undefined {
  if (!z) return undefined;
  if (typeof z[0] === 'number') return z as number[];
  return (z as Array<{ secs: number }>).map((x) => x.secs);
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
export async function sendWorkout(c: IntervalsCredentials, workout: Workout, date: string, basis: Basis, profile?: { maxHr: number; lthr: number }): Promise<number> {
  const body = workout.kind === 'walk' ? walkEvent(workout, date, profile)
    : workout.kind === 'strength' || workout.kind === 'mobility' ? sessionEvent(workout, date)
    : rideEvent(workout, date, basis);
  const ev = await call<{ id: number }>(c, `/athlete/${c.athleteId}/events`, { method: 'POST', body: JSON.stringify(body) });
  return ev.id;
}

function rideEvent(workout: Workout, date: string, basis: Basis) {
  const stats = workoutStats(workout.blocks);
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Ride',
    name: workout.subtitle ? `${workout.name} · ${workout.subtitle}` : workout.name,
    description: renderIntervalsText(workout, basis),
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
    const steps = [`- Press lap ${name}${reps}${load} ${dur(estimate)}`];
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
 * Step text the way Intervals.icu passes it to Garmin as the step name: words
 * only. Digits read as targets and symbols cut the name short, so numbers are
 * spelled out ("ten to twelve reps", "thirty five lb") and punctuation goes.
 */
export function garminText(text: string): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const words = (n: number): string => n < 20 ? ones[n] : n < 100 ? `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}` : n < 1000 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? ' ' + words(n % 100) : ''}` : String(n);
  return text
    .replace(/(\d+)\s*[-–—]\s*(\d+)/g, (_m, a, b) => `${words(+a)} to ${words(+b)}`)
    .replace(/\d+(\.\d+)?/g, (m) => words(Math.round(+m)))
    .replace(/×|(?<=\s|^)x(?=\s)/g, ' ')
    .replace(/[^A-Za-z ]+/g, ' ')
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
    // Garmin's native strength and yoga workouts build their steps from Garmin's own exercise library, so a
    // step from outside gets no name on the watch, just "Go". A generic cardio workout keeps its step text.
    type: 'Workout',
    name: workout.name,
    description: [`${workout.purpose} ${intro}`, '', ...steps].join('\n'),
    moving_time: (workout.minutes ?? 30) * 60,
    icu_training_load: workout.estimatedTss ?? 0,
  };
}

function walkEvent(workout: Workout, date: string, profile?: { maxHr: number; lthr: number }) {
  const w = workout.walk ?? { minutes: workout.minutes ?? 30, hrLow: 0.6, hrHigh: 0.7 };
  const toLthr = (f: number) => (profile && profile.lthr > 0 ? Math.round((f * profile.maxHr / profile.lthr) * 100) : Math.round(f * 100 / 0.92));
  const pack = w.packKg ? ` with a ${Math.round(w.packKg * 2.2)} lb pack` : '';
  const lines = [
    `${workout.purpose}${pack ? ` Walk${pack}.` : ''}`,
    '',
    `- ${w.minutes}m ${w.hrLow > 0 ? toLthr(w.hrLow) : Math.round(NO_FLOOR.hr * 100)}-${toLthr(w.hrHigh)}% LTHR`,
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
 * Record a session done without a device as a manual activity, so Intervals.icu
 * holds the complete record and the next sync treats it like any other.
 */
export async function createManualActivity(c: IntervalsCredentials, a: { date: string; name: string; type: 'Walk' | 'WeightTraining' | 'Yoga'; seconds: number; tss: number; rpe?: number; description?: string }): Promise<string> {
  const full = {
    start_date_local: `${a.date}T12:00:00`,
    name: a.name,
    type: a.type,
    moving_time: a.seconds,
    elapsed_time: a.seconds,
    icu_training_load: a.tss,
    icu_rpe: a.rpe,
    description: a.description,
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
