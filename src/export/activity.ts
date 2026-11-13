/**
 * A finished activity as a file (12 Nov 2026, export at any time). In order of preference:
 *  1. a ride Antogo's player recorded on this device: the same file the player gives at the end of the ride;
 *  2. the original file the activity arrived as, unchanged, when the rider asked for that format;
 *  3. a file written from the activity's second-by-second record;
 *  4. when only a summary exists: a short text summary, said plainly, never a file that pretends to be a recording.
 * Where an activity came from is read from the activity itself, never from anything about one rider's set-up.
 */
import type { ActivityEdit, PlannedWorkout, Ride } from '../engine/types';
import { db, STREAMS_VERSION, type StreamSet } from '../data/db';
import { fetchActivityFile, fetchStreams, IntervalsError, type IntervalsCredentials } from '../sync/intervals';
import { maybeGunzip } from '../player/fitRead';
import { rideFile } from '../player/rides';
import type { Recording } from '../player/types';
import { clock } from '../engine/workout';
import { encodeFitActivity, encodeGpx, encodeTcx, hasRecord, hasRoute, type ActivityStreams } from './activityFiles';
import { exportFileName } from './names';
import type { ActivityFormat, FileOut } from './formats';

/** Where an activity came from: made in Antogo (its player, or logged by hand), or brought in from a device or service. */
export interface Origin { antogo: boolean; source: string }

/** Makers and services a device name may name, as riders know them. */
const MAKERS: Array<[RegExp, string]> = [
  [/garmin|edge|forerunner|fenix|f[eē]nix|venu|vivo|epix|instinct|enduro/i, 'Garmin'], [/wahoo|elemnt|kickr/i, 'Wahoo'], [/hammerhead|karoo/i, 'Hammerhead'],
  [/coros/i, 'Coros'], [/polar/i, 'Polar'], [/suunto/i, 'Suunto'], [/apple|iphone|watch/i, 'Apple'], [/zwift/i, 'Zwift'], [/strava/i, 'Strava'],
  [/trainerroad/i, 'TrainerRoad'], [/rouvy/i, 'Rouvy'], [/whoop/i, 'Whoop'], [/samsung|galaxy/i, 'Samsung'], [/bryton/i, 'Bryton'], [/lezyne/i, 'Lezyne'],
  [/oura/i, 'Oura'], [/fitbit/i, 'Fitbit'], [/peloton/i, 'Peloton'], [/tacx/i, 'Tacx'],
];

/** The maker or service a device name stands for; the name itself when it is none of the known ones. */
export function makerOf(device?: string): string | undefined {
  const d = device?.trim();
  if (!d) return undefined;
  return MAKERS.find(([re]) => re.test(d))?.[1] ?? d;
}

export const UNKNOWN_SOURCE = 'unknown source';

/** Where this activity came from. */
export function originOf(r: Pick<Ride, 'id' | 'device'>, edits: ActivityEdit[], planned: PlannedWorkout[], playerIds: Set<string>): Origin {
  if (edits.find((e) => e.id === r.id)?.source === 'veloiq' || playerIds.has(r.id)) return { antogo: true, source: 'Antogo’s ride player' };
  if (planned.some((p) => p.manualActivityId === r.id)) return { antogo: true, source: 'logged in Antogo' };
  return { antogo: false, source: makerOf(r.device) ?? UNKNOWN_SOURCE };
}

/** What kind of file an original is, from its first bytes. */
export function originalKind(b: Uint8Array): ActivityFormat | undefined {
  if (b.length > 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54) return 'fit';
  const head = new TextDecoder().decode(b.subarray(0, 600)).toLowerCase();
  if (head.includes('<trainingcenterdatabase')) return 'tcx';
  if (head.includes('<gpx')) return 'gpx';
  return undefined;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One call to the data service, tried again on a busy answer or a dropped connection (waits of 2, then 6 seconds),
 * never on "not found" or "not allowed". The service's limits are respected: callers make one call at a time.
 */
export async function patiently<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await f(); } catch (e) {
      last = e;
      const st = e instanceof IntervalsError ? e.status : undefined;
      if (st != null && st !== 429 && st < 500) throw e;
      if (i < tries - 1) await wait(st === 429 ? 6000 * (i + 1) : 2000 * (i * 2 + 1));
    }
  }
  throw last;
}

/** The record to write a file from: the cached one when it is complete, else asked for. Null when there is none. */
async function recordOf(c: IntervalsCredentials | null, r: Ride, local?: Recording): Promise<ActivityStreams | null> {
  const cached = await db.streams.get(r.id);
  if (cached && (cached.v ?? 0) >= STREAMS_VERSION && hasRecord(cached)) return cached;
  if (c) {
    try {
      const st = await patiently(() => fetchStreams(c, r.id));
      const set: StreamSet = { id: r.id, v: STREAMS_VERSION, ...st };
      if (hasRecord(set)) return set;
    } catch (e) {
      if (!(e instanceof IntervalsError && e.status === 404)) throw e;
    }
  }
  if (local?.samples.length) {
    const s = local.samples;
    const pick = (f: (x: Recording['samples'][number]) => number | undefined) => (s.some((x) => f(x) != null) ? s.map((x) => f(x) ?? NaN) : undefined);
    return { time: s.map((x) => x.t), watts: pick((x) => x.w), heartrate: pick((x) => x.hr), cadence: pick((x) => x.cad), distance: pick((x) => x.d), velocity: pick((x) => (x.spd != null ? x.spd / 3.6 : undefined)), ve: pick((x) => x.ve), br: pick((x) => x.br), tv: pick((x) => x.tv) };
  }
  return cached && hasRecord(cached) ? cached : null;
}

/** The activity's totals, in words, for an activity with only a summary. */
export function summaryText(r: Ride, origin: Origin): string {
  const lines = [
    r.name,
    `${r.date}, ${r.type}, from ${origin.source}`,
    '',
    'Only a summary of this activity exists: no second-by-second recording was kept, so there is no ride file to give.',
    '',
    `Time: ${clock(r.seconds)}`,
    ...(r.distanceM ? [`Distance: ${(r.distanceM / 1000).toFixed(2)} km (${(r.distanceM / 1609.344).toFixed(2)} miles)`] : []),
    ...(r.tss != null ? [`Training load: ${Math.round(r.tss)} TSS`] : []),
    ...(r.averagePower ? [`Average power: ${Math.round(r.averagePower)} W`] : []),
    ...(r.averageHr ? [`Average heart rate: ${Math.round(r.averageHr)} bpm`] : []),
    ...(r.rpe ? [`Effort: ${r.rpe} of 10`] : []),
    ...(r.description ? ['', r.description] : []),
    '',
  ];
  return lines.join('\n');
}

export interface ActivityFileResult {
  file: FileOut;
  /** How the file was made: the original unchanged, Antogo's player file, written from the record, or a summary. */
  how: 'original' | 'player' | 'record' | 'summary';
  /** Asked for a format the record can't give (a .gpx without a route): the file was not made. */
  unavailable?: string;
}

const MIME: Record<ActivityFormat, string> = { fit: 'application/octet-stream', tcx: 'application/xml', gpx: 'application/gpx+xml' };

/** The file for one activity in the format asked for. */
export async function activityFile(c: IntervalsCredentials | null, r: Ride, format: ActivityFormat, origin: Origin, local?: Recording): Promise<ActivityFileResult> {
  const name = (ext: string) => exportFileName(r.date, r.name, r.sport, ext);
  // 1. The player's own file, when its recording is still on this device.
  if (format === 'fit' && local?.samples.length) return { file: { name: name('fit'), data: rideFile(local), mime: MIME.fit }, how: 'player' };
  // 2. The original, unchanged, when it is already this format.
  if (c) {
    try {
      const orig = await maybeGunzip(await patiently(() => fetchActivityFile(c, r.id)));
      if (orig.length && originalKind(orig) === format) return { file: { name: name(format), data: orig, mime: MIME[format] }, how: 'original' };
    } catch (e) {
      // No original (an activity entered by hand, or one the service holds only as a summary): carry on.
      if (!(e instanceof IntervalsError) || (e.status != null && e.status !== 404 && e.status !== 422)) throw e;
    }
  }
  // 3. Written from the record.
  const rec = await recordOf(c, r, local);
  if (rec) {
    if (format === 'gpx' && !hasRoute(rec)) return { file: { name: name('txt'), data: '', mime: 'text/plain' }, how: 'record', unavailable: 'This activity has no route, so there is no GPS file to give.' };
    const data = format === 'fit' ? encodeFitActivity(r, rec) : format === 'tcx' ? encodeTcx(r, rec) : encodeGpx(r, rec);
    return { file: { name: name(format), data, mime: MIME[format] }, how: 'record' };
  }
  // 4. Only a summary.
  return { file: { name: exportFileName(r.date, r.name, r.sport, 'txt'), data: summaryText(r, origin), mime: 'text/plain' }, how: 'summary' };
}

/** Which formats an activity can be offered in, as far as is known before asking the data service. */
export function activityOffers(r: Pick<Ride, 'distanceM' | 'type'>, knownNoRoute: boolean): Array<{ format: ActivityFormat; ok: boolean; why?: string }> {
  const indoorish = /Virtual|Indoor|Treadmill|WeightTraining|Yoga|Workout/i.test(r.type) || !r.distanceM;
  return [
    { format: 'fit', ok: true },
    { format: 'tcx', ok: true },
    knownNoRoute || indoorish ? { format: 'gpx', ok: false, why: 'This activity has no route, so there is no GPS file to give.' } : { format: 'gpx', ok: true },
  ];
}
