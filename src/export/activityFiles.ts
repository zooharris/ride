/**
 * A finished activity written from its second-by-second record (12 Nov 2026, export at any time), for when the
 * original file can't be had or the rider asked for another format: Garmin's activity file (FIT), .tcx and .gpx.
 * Only what was recorded goes in. The file's summary is the activity's own totals.
 */
import type { Ride } from '../engine/types';
import { TYME_APP_ID, TYME_FIELDS } from '../player/fit';
import { BYTES, ENUM, FILE_ID, FLOAT32, FitWriter, MANUFACTURER_DEVELOPMENT, SINT32, SINT8, STRING, UINT16, UINT32, UINT8, fitTime, type MesgDef } from './fitWriter';

/** The second-by-second record of an activity, as Antogo keeps it (a stream set). */
export interface ActivityStreams {
  time: number[];
  watts?: number[];
  heartrate?: number[];
  cadence?: number[];
  distance?: number[];
  altitude?: number[];
  velocity?: number[];
  temp?: number[];
  lat?: number[];
  lng?: number[];
  ve?: number[];
  br?: number[];
  tv?: number[];
}

/** When the activity started, in ms: its local start time read on this device. */
export function startMsOf(r: Pick<Ride, 'startTime' | 'date'>): number {
  const t = Date.parse(r.startTime);
  return Number.isFinite(t) ? t : Date.parse(`${r.date}T12:00:00`);
}

const num = (a: number[] | undefined, i: number): number | undefined => {
  const v = a?.[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const hasAny = (a: number[] | undefined) => !!a?.some((v) => typeof v === 'number' && Number.isFinite(v));
export const hasRoute = (s: ActivityStreams) => !!s.lat && !!s.lng && s.lat.some((v, i) => typeof v === 'number' && Number.isFinite(v) && v !== 0 && typeof s.lng![i] === 'number');
/** Whether the record has anything to write second by second. */
export const hasRecord = (s: ActivityStreams | null | undefined): s is ActivityStreams =>
  !!s && s.time.length > 1 && [s.watts, s.heartrate, s.cadence, s.distance, s.altitude, s.velocity, s.lat].some(hasAny);

/** FIT's sport and sub-sport for an activity. */
function fitSport(r: Ride, outdoors: boolean): [number, number] {
  if (r.sport === 'ride') return /Virtual/.test(r.type) ? [2, 58] : outdoors ? [2, 0] : [2, 6];
  if (r.sport === 'run') return [1, /Treadmill/.test(r.type) ? 1 : 0];
  if (r.sport === 'walk') return [11, 0];
  if (r.sport === 'strength') return [10, 20];
  if (r.sport === 'mobility') return [10, /Yoga/.test(r.type) ? 43 : 19];
  return [0, 0];
}

const SEMI = 2 ** 31 / 180;
const RECORD: MesgDef = { global: 20, local: 3, fields: [
  { num: 253, type: UINT32 }, { num: 0, type: SINT32 }, { num: 1, type: SINT32 }, { num: 2, type: UINT16 }, { num: 3, type: UINT8 },
  { num: 4, type: UINT8 }, { num: 5, type: UINT32 }, { num: 6, type: UINT16 }, { num: 7, type: UINT16 }, { num: 13, type: SINT8 }] };
const RECORD_BREATH: MesgDef = { ...RECORD, local: 4, dev: TYME_FIELDS.map((f) => ({ num: f.num, size: 4, index: 0 })) };
const EVENT: MesgDef = { global: 21, local: 1, fields: [{ num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }] };
const DEV_DATA_ID: MesgDef = { global: 207, local: 5, fields: [{ num: 1, type: BYTES(16) }, { num: 3, type: UINT8 }] };
const FIELD_DESC: MesgDef = { global: 206, local: 6, fields: [{ num: 0, type: UINT8 }, { num: 1, type: UINT8 }, { num: 2, type: UINT8 }, { num: 3, type: STRING(32) }, { num: 8, type: STRING(16) }] };
const LAP: MesgDef = { global: 19, local: 7, fields: [
  { num: 254, type: UINT16 }, { num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }, { num: 2, type: UINT32 },
  { num: 7, type: UINT32 }, { num: 8, type: UINT32 }, { num: 9, type: UINT32 }, { num: 15, type: UINT8 }, { num: 16, type: UINT8 },
  { num: 17, type: UINT8 }, { num: 19, type: UINT16 }, { num: 20, type: UINT16 }, { num: 24, type: ENUM }, { num: 25, type: ENUM }] };
const SESSION: MesgDef = { global: 18, local: 8, fields: [
  { num: 254, type: UINT16 }, { num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }, { num: 2, type: UINT32 },
  { num: 5, type: ENUM }, { num: 6, type: ENUM }, { num: 7, type: UINT32 }, { num: 8, type: UINT32 }, { num: 9, type: UINT32 },
  { num: 11, type: UINT16 }, { num: 16, type: UINT8 }, { num: 17, type: UINT8 }, { num: 18, type: UINT8 }, { num: 20, type: UINT16 },
  { num: 22, type: UINT16 }, { num: 25, type: UINT16 }, { num: 26, type: UINT16 }, { num: 28, type: ENUM }, { num: 34, type: UINT16 },
  { num: 35, type: UINT16 }, { num: 45, type: UINT16 }] };
const ACTIVITY: MesgDef = { global: 34, local: 9, fields: [{ num: 253, type: UINT32 }, { num: 0, type: UINT32 }, { num: 1, type: UINT16 }, { num: 2, type: ENUM }, { num: 3, type: ENUM }, { num: 4, type: ENUM }, { num: 5, type: UINT32 }] };
const hexBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const avgOf = (a: number[] | undefined) => { const xs = (a ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0); return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : undefined; };
const maxOf = (a: number[] | undefined) => { const xs = (a ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v)); return xs.length ? Math.max(...xs) : undefined; };

/** Garmin's activity file, from the record. */
export function encodeFitActivity(r: Ride, s: ActivityStreams): Uint8Array {
  const start = startMsOf(r);
  const at = (sec: number) => fitTime(start + sec * 1000);
  const n = s.time.length;
  const end = n ? s.time[n - 1] : r.elapsedSeconds ?? r.seconds;
  const route = hasRoute(s);
  const [sport, sub] = fitSport(r, route);
  const f = new FitWriter();
  f.write(FILE_ID, { 0: 4, 1: MANUFACTURER_DEVELOPMENT, 2: 0, 3: (start / 1000) >>> 0, 4: at(0), 8: 'Antogo' });
  f.write(EVENT, { 253: at(0), 0: 0, 1: 0 });
  const breathing = hasAny(s.ve);
  if (breathing) {
    f.write(DEV_DATA_ID, { 1: hexBytes(TYME_APP_ID), 3: 0 });
    for (const x of TYME_FIELDS) f.write(FIELD_DESC, { 0: 0, 1: x.num, 2: FLOAT32, 3: x.name, 8: x.units });
  }
  const rec = breathing ? RECORD_BREATH : RECORD;
  for (let i = 0; i < n; i++) {
    const lat = num(s.lat, i), lng = num(s.lng, i);
    const pos = lat != null && lng != null && !(lat === 0 && lng === 0);
    const alt = num(s.altitude, i);
    const v = num(s.velocity, i), d = num(s.distance, i);
    f.write(rec, {
      253: at(s.time[i]), 0: pos ? lat! * SEMI : undefined, 1: pos ? lng! * SEMI : undefined,
      2: alt != null ? (alt + 500) * 5 : undefined, 3: num(s.heartrate, i), 4: num(s.cadence, i),
      5: d != null ? d * 100 : undefined, 6: v != null ? v * 1000 : undefined, 7: num(s.watts, i), 13: num(s.temp, i),
    }, breathing ? [num(s.br, i), num(s.tv, i), num(s.ve, i), undefined] : []);
  }
  f.write(EVENT, { 253: at(end), 0: 0, 1: 4 });
  const distM = r.distanceM ?? maxOf(s.distance) ?? 0;
  const moving = r.movingSeconds ?? r.seconds;
  const totals = {
    elapsed: (r.elapsedSeconds ?? end) * 1000, timer: moving * 1000, dist: distM * 100,
    avgHr: r.averageHr ?? avgOf(s.heartrate), maxHr: r.maxHr ?? maxOf(s.heartrate), cad: r.averageCadence ?? avgOf(s.cadence),
    avgW: r.averagePower ?? avgOf(s.watts), maxW: maxOf(s.watts),
  };
  f.write(LAP, { 254: 0, 253: at(end), 0: 9, 1: 1, 2: at(0), 7: totals.elapsed, 8: totals.timer, 9: totals.dist, 15: totals.avgHr, 16: totals.maxHr, 17: totals.cad, 19: totals.avgW, 20: totals.maxW, 24: 7, 25: sport });
  f.write(SESSION, {
    254: 0, 253: at(end), 0: 8, 1: 1, 2: at(0), 5: sport, 6: sub, 7: totals.elapsed, 8: totals.timer, 9: totals.dist,
    11: r.calories, 16: totals.avgHr, 17: totals.maxHr, 18: totals.cad, 20: totals.avgW, 22: r.elevationM, 25: 0, 26: 1, 28: 0,
    34: r.normalizedPower, 35: r.tss != null ? r.tss * 10 : undefined, 45: r.ftpAtRide,
  });
  const offset = -new Date(start).getTimezoneOffset() * 60;
  f.write(ACTIVITY, { 253: at(end), 0: totals.timer, 1: 1, 2: 0, 3: 26, 4: 1, 5: at(end) + offset });
  return f.finish();
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const tcxSport = (r: Ride) => (r.sport === 'ride' ? 'Biking' : r.sport === 'run' || r.sport === 'walk' ? 'Running' : 'Other');

/** The Training Center file (.tcx): one lap with the activity's totals, and a point a second. */
export function encodeTcx(r: Ride, s: ActivityStreams): string {
  const start = startMsOf(r);
  const pts: string[] = [];
  const power = hasAny(s.watts), speed = hasAny(s.velocity);
  for (let i = 0; i < s.time.length; i++) {
    const lat = num(s.lat, i), lng = num(s.lng, i), alt = num(s.altitude, i), d = num(s.distance, i), hr = num(s.heartrate, i), cad = num(s.cadence, i), w = num(s.watts, i), v = num(s.velocity, i);
    const parts = [`<Time>${iso(start + s.time[i] * 1000)}</Time>`];
    if (lat != null && lng != null && !(lat === 0 && lng === 0)) parts.push(`<Position><LatitudeDegrees>${lat.toFixed(7)}</LatitudeDegrees><LongitudeDegrees>${lng.toFixed(7)}</LongitudeDegrees></Position>`);
    if (alt != null) parts.push(`<AltitudeMeters>${alt.toFixed(1)}</AltitudeMeters>`);
    if (d != null) parts.push(`<DistanceMeters>${d.toFixed(1)}</DistanceMeters>`);
    if (hr != null && hr > 0) parts.push(`<HeartRateBpm><Value>${Math.round(hr)}</Value></HeartRateBpm>`);
    if (cad != null) parts.push(`<Cadence>${Math.min(254, Math.round(cad))}</Cadence>`);
    if ((power && w != null) || (speed && v != null)) parts.push(`<Extensions><ns3:TPX>${speed && v != null ? `<ns3:Speed>${v.toFixed(3)}</ns3:Speed>` : ''}${power && w != null ? `<ns3:Watts>${Math.round(w)}</ns3:Watts>` : ''}</ns3:TPX></Extensions>`);
    pts.push(`          <Trackpoint>${parts.join('')}</Trackpoint>`);
  }
  const avgHr = r.averageHr ?? avgOf(s.heartrate), maxHr = r.maxHr ?? maxOf(s.heartrate);
  const total = r.movingSeconds ?? r.seconds;
  const lap = [
    `      <Lap StartTime="${iso(start)}">`,
    `        <TotalTimeSeconds>${total.toFixed(1)}</TotalTimeSeconds>`,
    `        <DistanceMeters>${(r.distanceM ?? maxOf(s.distance) ?? 0).toFixed(1)}</DistanceMeters>`,
    `        <Calories>${Math.round(r.calories ?? 0)}</Calories>`,
    ...(avgHr ? [`        <AverageHeartRateBpm><Value>${Math.round(avgHr)}</Value></AverageHeartRateBpm>`] : []),
    ...(maxHr ? [`        <MaximumHeartRateBpm><Value>${Math.round(maxHr)}</Value></MaximumHeartRateBpm>`] : []),
    '        <Intensity>Active</Intensity>',
    '        <TriggerMethod>Manual</TriggerMethod>',
    '        <Track>', ...pts, '        </Track>',
    '      </Lap>',
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">',
    '  <Activities>',
    `    <Activity Sport="${tcxSport(r)}">`,
    `      <Id>${iso(start)}</Id>`,
    ...lap,
    `      <Notes>${xml(r.name)}</Notes>`,
    '      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Antogo</Name><UnitId>0</UnitId><ProductID>0</ProductID><Version><VersionMajor>2</VersionMajor><VersionMinor>0</VersionMinor></Version></Creator>',
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
    '',
  ].join('\n');
}

/** The GPS exchange file (.gpx): the route, with heart rate, cadence and power where recorded. Only for an activity with a route. */
export function encodeGpx(r: Ride, s: ActivityStreams): string {
  const start = startMsOf(r);
  const pts: string[] = [];
  for (let i = 0; i < s.time.length; i++) {
    const lat = num(s.lat, i), lng = num(s.lng, i);
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    const alt = num(s.altitude, i), hr = num(s.heartrate, i), cad = num(s.cadence, i), w = num(s.watts, i), tc = num(s.temp, i);
    const tpx = [hr != null && hr > 0 ? `<gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr>` : '', cad != null ? `<gpxtpx:cad>${Math.round(cad)}</gpxtpx:cad>` : '', tc != null ? `<gpxtpx:atemp>${tc.toFixed(1)}</gpxtpx:atemp>` : ''].join('');
    const ext = tpx || w != null ? `<extensions>${w != null ? `<power>${Math.round(w)}</power>` : ''}${tpx ? `<gpxtpx:TrackPointExtension>${tpx}</gpxtpx:TrackPointExtension>` : ''}</extensions>` : '';
    pts.push(`      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}">${alt != null ? `<ele>${alt.toFixed(1)}</ele>` : ''}<time>${iso(start + s.time[i] * 1000)}</time>${ext}</trkpt>`);
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Antogo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    `  <metadata><name>${xml(r.name)}</name><time>${iso(start)}</time></metadata>`,
    `  <trk><name>${xml(r.name)}</name><type>${xml(r.type)}</type>`,
    '    <trkseg>', ...pts, '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
