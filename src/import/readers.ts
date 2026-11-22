import type { StreamSet } from '../data/db';
import { readFitActivity, type FitSummary } from '../player/fitRecording';
import { maybeGunzip } from '../player/fitRead';
import { unzipFirst } from '../sync/garminPersonal';

/**
 * Stage 1 (22 Nov 2026): an activity file of any maker read into one shape: its recording and what it says about
 * itself. FIT (also compressed or zipped), TCX and GPX. Nothing here assumes a maker or a rider.
 */
export interface ParsedActivity {
  streams?: StreamSet;
  /** Start, Unix seconds. */
  startUnix: number;
  /** The rider's local time at the start, as "YYYY-MM-DDTHH:MM:SS". */
  startLocal: string;
  /** The activity's kind in the data service's words (Ride, VirtualRide, Walk, Run, WeightTraining, Yoga, ...). */
  type: string;
  elapsedS: number;
  movingS?: number;
  distanceM?: number;
  ascentM?: number;
  descentM?: number;
  calories?: number;
  device?: string;
  /** The FTP set on the device that day, when the file says. */
  ftp?: number;
  format: 'fit' | 'tcx' | 'gpx';
}

/** A file that is the device's own but not an activity (daily monitoring, settings, sleep and the like). */
export const NOT_ACTIVITY = 'not-activity' as const;

/** FIT sport and sub-sport to the data service's activity types. */
export function fitType(sport?: number, sub?: number): string {
  switch (sport) {
    case 2: return sub === 6 || sub === 58 ? 'VirtualRide' : sub === 8 ? 'MountainBikeRide' : sub === 46 ? 'GravelRide' : 'Ride';
    case 1: return 'Run';
    case 11: return 'Walk';
    case 17: return 'Hike';
    case 10: return sub === 20 ? 'WeightTraining' : sub === 43 ? 'Yoga' : sub === 44 ? 'Pilates' : sub === 19 ? 'Stretching' : 'Workout';
    case 4: return sub === 14 ? 'Rowing' : 'Workout';
    case 5: return 'Swim';
    case 15: return 'Rowing';
    case 13: return 'AlpineSki';
    default: return 'Other';
  }
}

const MAKERS: Record<number, string> = { 1: 'Garmin', 32: 'Wahoo', 255: 'a device', 260: 'Zwift', 263: 'Suunto', 289: 'Hammerhead', 294: 'Coros', 123: 'Polar', 69: 'Stages', 89: 'Tacx', 23: 'Suunto', 265: 'Strava', 267: 'Bryton', 282: 'Bryton' };

/** A local time as the data service writes it, from Unix seconds and an offset. */
export function localIso(unix: number, offsetS: number): string {
  return new Date((unix + offsetS) * 1000).toISOString().slice(0, 19);
}
/** This device's offset from UTC at a moment, seconds (the rider's time zone when the file doesn't say). */
const deviceOffset = (unix: number) => -new Date(unix * 1000).getTimezoneOffset() * 60;

/** Read one file, whatever its format; undefined when it is not an activity. */
export async function readActivityFile(name: string, bytes0: Uint8Array): Promise<ParsedActivity | typeof NOT_ACTIVITY | undefined> {
  let bytes = await maybeGunzip(bytes0);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { const inner = await unzipFirst(bytes); if (!inner) return undefined; bytes = await maybeGunzip(inner); }
  if (isFit(bytes)) return fromFit(bytes);
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 50_000_000)));
  if (/<TrainingCenterDatabase/i.test(text)) return fromTcx(text);
  if (/<gpx[\s>]/i.test(text)) return fromGpx(text);
  void name;
  return undefined;
}

export const isFit = (b: Uint8Array) => b.length >= 12 && b[8] === 0x2e && b[9] === 0x46 && b[10] === 0x49 && b[11] === 0x54;

function fromFit(bytes: Uint8Array): ParsedActivity | typeof NOT_ACTIVITY | undefined {
  const { streams, summary: s } = readFitActivity(bytes);
  // The file says what kind it is; one that is not an activity and holds no recording is not a failed read.
  if (s.fileType != null && s.fileType !== 4 && !streams) return NOT_ACTIVITY;
  return fitParsed(streams, s);
}

export function fitParsed(streams: StreamSet | undefined, s: FitSummary): ParsedActivity | undefined {
  if (s.startUnix == null) return undefined;
  const span = streams?.time.length ? streams.time[streams.time.length - 1] : 0;
  const elapsedS = Math.round(s.elapsedS ?? span);
  if (!elapsedS) return undefined;
  const offset = s.localOffset != null && Math.abs(s.localOffset) <= 14 * 3600 ? s.localOffset : deviceOffset(s.startUnix);
  return {
    streams, startUnix: s.startUnix, startLocal: localIso(s.startUnix, offset), type: fitType(s.sport, s.subSport),
    elapsedS, movingS: s.timerS != null ? Math.round(s.timerS) : undefined,
    distanceM: s.distanceM ?? lastOf(streams?.distance), ascentM: s.ascentM, descentM: s.descentM, calories: s.calories,
    device: s.product || (s.manufacturer != null ? MAKERS[s.manufacturer] : undefined),
    ...(s.thresholdPower && s.thresholdPower >= 50 && s.thresholdPower <= 600 ? { ftp: s.thresholdPower } : {}), format: 'fit',
  };
}

const lastOf = (xs?: number[]) => { if (!xs) return undefined; for (let i = xs.length - 1; i >= 0; i--) if (isFinite(xs[i])) return xs[i]; return undefined; };
const tag = (s: string, name: string) => { const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i').exec(s); return m ? m[1].trim() : undefined; };
const numTag = (s: string, name: string) => { const v = tag(s, name); const n = v != null ? Number(v) : NaN; return isFinite(n) ? n : undefined; };

type Point = { t: number; hr?: number; cad?: number; w?: number; d?: number; alt?: number; lat?: number; lng?: number; spd?: number };

/** Points to the app's streams: one per second from the first. */
function pointsToStreams(pts: Point[]): StreamSet | undefined {
  if (pts.length < 2) return undefined;
  pts.sort((a, b) => a.t - b.t);
  const t0 = pts[0].t;
  const by = new Map<number, Point>();
  for (const p of pts) by.set(Math.round(p.t - t0), p);
  const time = [...by.keys()].sort((a, b) => a - b);
  const col = (k: keyof Point) => (pts.some((p) => p[k] != null) ? time.map((t) => { const x = by.get(t)![k]; return x == null ? NaN : x; }) : undefined);
  const set: StreamSet = { id: '', time, heartrate: col('hr'), cadence: col('cad'), watts: col('w'), distance: col('d'), altitude: col('alt'), lat: col('lat'), lng: col('lng'), velocity: col('spd') };
  for (const k of Object.keys(set) as Array<keyof StreamSet>) if (set[k] === undefined) delete set[k];
  return set;
}

export function fromTcx(text: string): ParsedActivity | undefined {
  const sport = /<Activity\s+Sport="([^"]+)"/i.exec(text)?.[1] ?? 'Other';
  const type = /bik/i.test(sport) ? 'Ride' : /run/i.test(sport) ? 'Run' : 'Other';
  const pts: Point[] = [];
  for (const m of text.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/gi)) {
    const b = m[1];
    const time = tag(b, 'Time');
    if (!time) continue;
    pts.push({ t: Date.parse(time) / 1000, hr: numTag(/<HeartRateBpm>([\s\S]*?)<\/HeartRateBpm>/i.exec(b)?.[1] ?? '', 'Value'), cad: numTag(b, 'Cadence'), w: numTag(b, 'Watts'),
      d: numTag(b, 'DistanceMeters'), alt: numTag(b, 'AltitudeMeters'), lat: numTag(b, 'LatitudeDegrees'), lng: numTag(b, 'LongitudeDegrees'), spd: numTag(b, 'Speed') });
  }
  const laps = [...text.matchAll(/<Lap\s+StartTime="([^"]+)"[^>]*>([\s\S]*?)<\/Lap>/gi)];
  const start = laps.length ? Date.parse(laps[0][1]) / 1000 : pts[0]?.t;
  if (start == null || !isFinite(start)) return undefined;
  const sum = (k: string) => laps.reduce((a, l) => a + (numTag(l[2].replace(/<Track>[\s\S]*<\/Track>/i, ''), k) ?? 0), 0);
  const streams = pointsToStreams(pts);
  const moving = sum('TotalTimeSeconds');
  const span = streams ? streams.time[streams.time.length - 1] : moving;
  return {
    streams, startUnix: start, startLocal: localIso(start, deviceOffset(start)), type,
    elapsedS: Math.round(Math.max(span, moving)), movingS: moving ? Math.round(moving) : undefined,
    distanceM: sum('DistanceMeters') || lastOf(streams?.distance), calories: sum('Calories') || undefined,
    device: tag(/<Creator[\s\S]*?<\/Creator>/i.exec(text)?.[0] ?? '', 'Name'), format: 'tcx',
  };
}

export function fromGpx(text: string): ParsedActivity | undefined {
  const pts: Point[] = [];
  for (const m of text.matchAll(/<trkpt\s+([^>]*)>([\s\S]*?)<\/trkpt>/gi)) {
    const attrs = m[1], b = m[2];
    const time = tag(b, 'time');
    if (!time) continue;
    const lat = Number(/lat="([^"]+)"/.exec(attrs)?.[1]), lng = Number(/lon="([^"]+)"/.exec(attrs)?.[1]);
    pts.push({ t: Date.parse(time) / 1000, lat: isFinite(lat) ? lat : undefined, lng: isFinite(lng) ? lng : undefined, alt: numTag(b, 'ele'), hr: numTag(b, 'hr'), cad: numTag(b, 'cad'), w: numTag(b, 'power') });
  }
  const streams = pointsToStreams(pts);
  if (!streams) return undefined;
  // Distance along the track, from the positions.
  if (streams.lat && streams.lng) {
    const d: number[] = []; let acc = 0;
    for (let i = 0; i < streams.time.length; i++) {
      if (i && isFinite(streams.lat[i]) && isFinite(streams.lat[i - 1])) acc += haversine(streams.lat[i - 1], streams.lng[i - 1], streams.lat[i], streams.lng[i]);
      d.push(acc);
    }
    streams.distance = d;
  }
  const kind = (tag(text, 'type') ?? '').toLowerCase();
  const type = /cycl|bik|ride|^1$/.test(kind) ? 'Ride' : /run|^9$/.test(kind) ? 'Run' : /walk|hik|^10$/.test(kind) ? 'Walk' : streams.watts ? 'Ride' : 'Other';
  const start = pts[0].t;
  return {
    streams, startUnix: start, startLocal: localIso(start, deviceOffset(start)), type,
    elapsedS: streams.time[streams.time.length - 1], distanceM: lastOf(streams.distance),
    device: /<gpx[^>]*creator="([^"]+)"/i.exec(text)?.[1], format: 'gpx',
  };
}

function haversine(a: number, b: number, c: number, d: number): number {
  const R = 6371000, r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
