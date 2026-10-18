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
import type { Basis, Ride, Wellness, Workout } from '../engine/types';
import { renderIntervalsText, workoutStats } from '../engine/workout';

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
  if (!res.ok) throw new IntervalsError(`Intervals.icu answered ${res.status}.`, res.status);
  return (await res.json()) as T;
}

/** A cheap call that proves the credentials work and returns the athlete's name. */
export interface AthleteNumbers {
  name: string;
  ftp?: number;
  lthr?: number;
  maxHr?: number;
  restingHr?: number;
  weight?: number;
}

export async function testConnection(c: IntervalsCredentials): Promise<AthleteNumbers> {
  const a = await call<Record<string, unknown>>(c, `/athlete/${c.athleteId}`);
  const settings = Array.isArray(a.sportSettings) ? (a.sportSettings as Array<Record<string, unknown>>) : [];
  const sport = settings.find((s) => (s.types as string[] | undefined)?.includes('Ride')) ?? settings[0];
  return {
    name: String(a.name ?? ''),
    ftp: num(sport?.ftp) ?? num(a.icu_ftp),
    lthr: num(sport?.lthr),
    maxHr: num(sport?.max_hr),
    restingHr: num(a.icu_resting_hr),
    weight: num(a.icu_weight) ?? num(a.weight),
  };
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
  paired_event_id?: number;
}

const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide']);

export async function fetchRides(c: IntervalsCredentials, oldest: string, newest: string): Promise<Ride[]> {
  const list = await call<IcuActivity[]>(c, `/athlete/${c.athleteId}/activities?oldest=${oldest}&newest=${newest}`);
  return list.filter((a) => RIDE_TYPES.has(a.type ?? '')).map(toRide);
}

function toRide(a: IcuActivity): Ride {
  return {
    id: String(a.id),
    date: a.start_date_local.slice(0, 10),
    startTime: a.start_date_local,
    name: a.name ?? 'Ride',
    type: a.type ?? 'Ride',
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
    pairedEventId: a.paired_event_id,
  };
}

function zoneSeconds(z: IcuActivity['icu_zone_times']): number[] | undefined {
  if (!z) return undefined;
  if (typeof z[0] === 'number') return z as number[];
  return (z as Array<{ secs: number }>).map((x) => x.secs);
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
export async function sendWorkout(c: IntervalsCredentials, workout: Workout, date: string, basis: Basis): Promise<number> {
  const stats = workoutStats(workout.blocks);
  const body = {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: 'Ride',
    name: workout.name,
    description: renderIntervalsText(workout, basis),
    moving_time: stats.seconds,
    icu_training_load: stats.tss,
  };
  const ev = await call<{ id: number }>(c, `/athlete/${c.athleteId}/events`, { method: 'POST', body: JSON.stringify(body) });
  return ev.id;
}

export async function deleteEvent(c: IntervalsCredentials, eventId: number): Promise<void> {
  await call(c, `/athlete/${c.athleteId}/events/${eventId}`, { method: 'DELETE' });
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}
