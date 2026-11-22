import type { StreamSet } from '../data/db';
import { breathStreams, readFitBreathing } from './fitRead';

/**
 * An activity's second-by-second recording read from its original FIT file (22 Nov 2026, Stage 0): what the charts
 * need when the data service sends an activity with no detail, from the copy kept on this device. Records give time,
 * power, heart rate, cadence, distance, speed, altitude, temperature and position; laps give the laps. Breathing, when
 * the file carries Tymewear's fields, comes from the breathing reader. Everything else in the file is stepped over.
 */

interface Def { global: number; little: boolean; fields: Array<{ num: number; size: number; type: number }>; devSize: number }

/** A FIT value of any whole or float base type, signed where the type is; undefined for FIT's "no value". */
function readAny(v: DataView, at: number, size: number, type: number, little: boolean): number | undefined {
  const base = type & 0x1f;
  const signed = base === 0x01 || base === 0x03 || base === 0x05;
  if (base === 0x08 && size === 4) { const x = v.getFloat32(at, little); return v.getUint32(at, little) === 0xffffffff || !isFinite(x) ? undefined : x; }
  if (size === 1) { const x = v.getUint8(at); if (x === (signed ? 0x7f : 0xff)) return undefined; return signed ? v.getInt8(at) : x; }
  if (size === 2) { const x = v.getUint16(at, little); if (x === (signed ? 0x7fff : 0xffff)) return undefined; return signed ? v.getInt16(at, little) : x; }
  if (size === 4) { const x = v.getUint32(at, little); if (x === (signed ? 0x7fffffff : 0xffffffff)) return undefined; return signed ? v.getInt32(at, little) : x; }
  return undefined;
}

const SEMI = 180 / 2 ** 31;

/** What a FIT file says about the activity as a whole (its session, file id and activity messages). */
export interface FitSummary {
  /** Start, Unix seconds. */
  startUnix?: number;
  /** Local time minus UTC, seconds, when the file says (its activity message's local timestamp). */
  localOffset?: number;
  sport?: number; subSport?: number;
  elapsedS?: number; timerS?: number; distanceM?: number; ascentM?: number; descentM?: number; calories?: number;
  manufacturer?: number; product?: string;
}

/** FIT time starts on 31 Dec 1989. */
export const FIT_EPOCH = 631065600;

/** The recording and the summary of a FIT file. */
export function readFitActivity(file: Uint8Array, id = ''): { streams?: StreamSet; summary: FitSummary } {
  const summary: FitSummary = {};
  const streams = readFitRecording(file, id, summary);
  return { streams, summary };
}

/** The recording in a FIT file as the app's streams; undefined when the file holds no records. */
export function readFitRecording(file: Uint8Array, id = '', summary?: FitSummary): StreamSet | undefined {
  if (file.length < 12) return undefined;
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const headerSize = file[0];
  const dataSize = v.getUint32(4, true);
  const end = Math.min(file.length, headerSize + dataSize);
  const defs = new Map<number, Def>();
  type Rec = { ts: number; w?: number; hr?: number; cad?: number; d?: number; spd?: number; alt?: number; temp?: number; lat?: number; lng?: number };
  const recs: Rec[] = [];
  const laps: Array<{ start: number; end: number }> = [];
  let lastTs = 0;
  let p = headerSize;
  try {
    while (p < end) {
      const h = file[p++];
      if (h & 0x80) {
        const local = (h >> 5) & 0x03;
        const offset = h & 0x1f;
        lastTs = (lastTs & ~0x1f) + offset + (offset < (lastTs & 0x1f) ? 0x20 : 0);
        const d = defs.get(local);
        if (!d) break;
        p = readData(d, p, lastTs);
        continue;
      }
      const local = h & 0x0f;
      if (h & 0x40) {
        const little = file[p + 1] === 0;
        const global = little ? v.getUint16(p + 2, true) : v.getUint16(p + 2, false);
        const n = file[p + 4];
        p += 5;
        const fs: Def['fields'] = [];
        for (let i = 0; i < n; i++, p += 3) fs.push({ num: file[p], size: file[p + 1], type: file[p + 2] });
        let devSize = 0;
        if (h & 0x20) { const m = file[p++]; for (let i = 0; i < m; i++, p += 3) devSize += file[p + 1]; }
        defs.set(local, { global, little, fields: fs, devSize });
        continue;
      }
      const d = defs.get(local);
      if (!d) break;
      p = readData(d, p);
    }
  } catch { /* a damaged end of file: keep what was read */ }
  if (summary && summary.startUnix == null && recs.length) summary.startUnix = recs[0].ts + FIT_EPOCH;
  if (recs.length < 2) return undefined;

  const t0 = recs[0].ts;
  // One value per second of the recording, the last record in each second.
  const span = recs[recs.length - 1].ts - t0;
  if (span <= 0 || span > 7 * 24 * 3600) return undefined;
  const byS = new Map<number, Rec>();
  for (const r of recs) byS.set(r.ts - t0, r);
  const time = [...byS.keys()].sort((a, b) => a - b);
  const col = (k: keyof Rec, f: (x: number) => number = (x) => x) => {
    if (!recs.some((r) => r[k] != null)) return undefined;
    return time.map((t) => { const x = byS.get(t)![k]; return x == null ? NaN : f(x); });
  };
  const set: StreamSet = {
    id, time,
    watts: col('w'), heartrate: col('hr'), cadence: col('cad'),
    distance: col('d', (x) => x / 100), velocity: col('spd', (x) => x / 1000),
    altitude: col('alt', (x) => x / 5 - 500), temp: col('temp'),
    lat: col('lat', (x) => x * SEMI), lng: col('lng', (x) => x * SEMI),
    intervals: laps.filter((l) => l.end > l.start).map((l) => ({ start: l.start - t0, end: l.end - t0 })),
  };
  for (const k of Object.keys(set) as Array<keyof StreamSet>) if (set[k] === undefined) delete set[k];
  // Breathing, from Tymewear's fields, when the file has them.
  const fb = readFitBreathing(file);
  const breath = fb.records.length ? breathStreams(fb, time, t0) : undefined;
  return breath ? { ...set, ...breath } : set;

  function readData(d: Def, at: number, compressedTs?: number): number {
    const vals = new Map<number, { at: number; size: number; type: number }>();
    for (const f of d.fields) { vals.set(f.num, { at, size: f.size, type: f.type }); at += f.size; }
    at += d.devSize;
    const num = (n: number) => { const x = vals.get(n); return x ? readAny(v, x.at, x.size, x.type, d.little) : undefined; };
    const ts = num(253) ?? compressedTs;
    if (ts != null) lastTs = ts;
    if (d.global === 20) {
      const alt = num(78) ?? num(2);
      const spd = num(73) ?? num(6);
      recs.push({ ts: ts ?? lastTs, w: num(7), hr: num(3), cad: num(4), d: num(5), spd, alt, temp: num(13), lat: num(0), lng: num(1) });
    } else if (d.global === 19) {
      const start = num(2), stop = ts;
      if (start != null && stop != null) laps.push({ start, end: stop });
    } else if (d.global === 18 && summary) {
      // session: the activity's own totals
      summary.startUnix ??= num(2) != null ? num(2)! + FIT_EPOCH : undefined;
      summary.sport ??= num(5); summary.subSport ??= num(6);
      const el = num(7), tm = num(8), di = num(9);
      if (el != null) summary.elapsedS = (summary.elapsedS ?? 0) + el / 1000;
      if (tm != null) summary.timerS = (summary.timerS ?? 0) + tm / 1000;
      if (di != null) summary.distanceM = (summary.distanceM ?? 0) + di / 100;
      const up = num(22), down = num(23), kcal = num(11);
      if (up != null) summary.ascentM = (summary.ascentM ?? 0) + up;
      if (down != null) summary.descentM = (summary.descentM ?? 0) + down;
      if (kcal != null) summary.calories = (summary.calories ?? 0) + kcal;
    } else if (d.global === 34 && summary) {
      // activity: its local timestamp gives the rider's time zone at the time
      const local = num(5);
      if (local != null && ts != null) summary.localOffset = local - ts;
    } else if (d.global === 0 && summary) {
      summary.manufacturer ??= num(1);
      const pn = vals.get(8);
      if (pn && (pn.type & 0x1f) === 0x07) { let e = pn.at; while (e < pn.at + pn.size && file[e] !== 0) e++; const name = new TextDecoder().decode(file.subarray(pn.at, e)); if (name) summary.product = name; }
    }
    return at;
  }
}
