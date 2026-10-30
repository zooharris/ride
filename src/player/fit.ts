/**
 * Writes a ride as a FIT activity file, the format Garmin devices record and
 * Intervals.icu, Strava and Garmin Connect all read. Written from the public
 * FIT protocol description; only the messages a recorded indoor ride needs:
 * file id, timer events, one record a second, a lap per workout step, the
 * session and the activity. A ride with a breathing strap (Step 3, 30 Oct)
 * carries breathing as developer fields in Tymewear's own layout, so
 * Intervals.icu, Tymewear's dashboard and any FIT tool read them alike.
 */
import type { Recording } from './types';
import type { Totals } from './summary';

/** FIT time: seconds since 31 December 1989, 00:00 UTC. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
export const fitTime = (ms: number) => Math.round((ms - FIT_EPOCH_MS) / 1000);

// Base types: [code, size]
const ENUM = [0x00, 1], UINT8 = [0x02, 1], UINT16 = [0x84, 2], UINT32 = [0x86, 4], UINT32Z = [0x8c, 4], BYTE = (n: number) => [0x0d, n];
const STRING = (n: number) => [0x07, n];
type BaseType = number[];
const INVALID: Record<number, number> = { 0x00: 0xff, 0x02: 0xff, 0x84: 0xffff, 0x86: 0xffffffff, 0x8c: 0 };

interface FieldDef { num: number; type: BaseType }
interface DevFieldDef { num: number; size: number; index: number }
interface MesgDef { global: number; local: number; fields: FieldDef[]; dev?: DevFieldDef[] }

/** Tymewear's developer application id and its four record fields (float32), as its own files carry them. */
export const TYME_APP_ID = '0101020358030d69223759ffff7962ff';
export const TYME_FIELDS = [
  { num: 0, name: 'tyme_breath_rate', units: 'brpm', key: 'br' },
  { num: 1, name: 'tyme_tidal_volume', units: 'vol/br', key: 'tv' },
  { num: 2, name: 'tyme_minute_volume', units: 'vol/min', key: 've' },
  { num: 3, name: 'tyme_inhale_exhale_ratio', units: 'sec/sec', key: 'ie' },
] as const;
const FLOAT32 = 0x88;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length, crc = 0): number {
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  len = 0;
  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  u8(v: number) { this.grow(1); this.buf[this.len++] = v & 0xff; }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  f32(v: number | undefined) {
    if (v == null || !Number.isFinite(v)) { this.u32(0xffffffff); return; }
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    b.forEach((x) => this.u8(x));
  }
  bytes() { return this.buf.subarray(0, this.len); }
}

function define(w: Writer, d: MesgDef) {
  w.u8(0x40 | (d.dev?.length ? 0x20 : 0) | d.local);
  w.u8(0); // reserved
  w.u8(0); // little-endian
  w.u16(d.global);
  w.u8(d.fields.length);
  for (const f of d.fields) { w.u8(f.num); w.u8(f.type[1]); w.u8(f.type[0]); }
  if (d.dev?.length) { w.u8(d.dev.length); for (const f of d.dev) { w.u8(f.num); w.u8(f.size); w.u8(f.index); } }
}

function data(w: Writer, d: MesgDef, values: Record<number, number | string | Uint8Array | undefined>, dev: Array<number | undefined> = []) {
  w.u8(d.local);
  for (const f of d.fields) {
    const [code, size] = f.type;
    const v = values[f.num];
    if (code === 0x0d) {
      for (let i = 0; i < size; i++) w.u8(v instanceof Uint8Array && i < v.length ? v[i] : 0xff);
      continue;
    }
    if (code === 0x07) {
      const s = typeof v === 'string' ? new TextEncoder().encode(v).subarray(0, size - 1) : new Uint8Array();
      for (let i = 0; i < size; i++) w.u8(i < s.length ? s[i] : 0);
      continue;
    }
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : INVALID[code];
    if (size === 1) w.u8(Math.min(n, 0xff)); else if (size === 2) w.u16(Math.min(n, 0xffff)); else w.u32(Math.min(n, 0xffffffff));
  }
  (d.dev ?? []).forEach((_, i) => w.f32(dev[i]));
}

const FILE_ID: MesgDef = { global: 0, local: 0, fields: [{ num: 0, type: ENUM }, { num: 1, type: UINT16 }, { num: 2, type: UINT16 }, { num: 3, type: UINT32Z }, { num: 4, type: UINT32 }, { num: 8, type: STRING(20) }] };
const EVENT: MesgDef = { global: 21, local: 1, fields: [{ num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }] };
const RECORD: MesgDef = { global: 20, local: 2, fields: [{ num: 253, type: UINT32 }, { num: 7, type: UINT16 }, { num: 3, type: UINT8 }, { num: 4, type: UINT8 }, { num: 6, type: UINT16 }, { num: 5, type: UINT32 }] };
const LAP: MesgDef = { global: 19, local: 3, fields: [
  { num: 254, type: UINT16 }, { num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }, { num: 2, type: UINT32 },
  { num: 7, type: UINT32 }, { num: 8, type: UINT32 }, { num: 9, type: UINT32 }, { num: 15, type: UINT8 }, { num: 16, type: UINT8 },
  { num: 17, type: UINT8 }, { num: 19, type: UINT16 }, { num: 20, type: UINT16 }, { num: 24, type: ENUM }, { num: 25, type: ENUM }] };
const SESSION: MesgDef = { global: 18, local: 4, fields: [
  { num: 254, type: UINT16 }, { num: 253, type: UINT32 }, { num: 0, type: ENUM }, { num: 1, type: ENUM }, { num: 2, type: UINT32 },
  { num: 5, type: ENUM }, { num: 6, type: ENUM }, { num: 7, type: UINT32 }, { num: 8, type: UINT32 }, { num: 9, type: UINT32 },
  { num: 16, type: UINT8 }, { num: 17, type: UINT8 }, { num: 18, type: UINT8 }, { num: 20, type: UINT16 }, { num: 21, type: UINT16 },
  { num: 25, type: UINT16 }, { num: 26, type: UINT16 }, { num: 28, type: ENUM }, { num: 34, type: UINT16 }, { num: 35, type: UINT16 },
  { num: 36, type: UINT16 }, { num: 45, type: UINT16 }, { num: 48, type: UINT32 }] };
const DEV_DATA_ID: MesgDef = { global: 207, local: 6, fields: [{ num: 1, type: BYTE(16) }, { num: 3, type: UINT8 }] };
const FIELD_DESC: MesgDef = { global: 206, local: 7, fields: [{ num: 0, type: UINT8 }, { num: 1, type: UINT8 }, { num: 2, type: UINT8 }, { num: 3, type: STRING(32) }, { num: 8, type: STRING(16) }] };
const RECORD_BREATH: MesgDef = { ...RECORD, dev: TYME_FIELDS.map((f) => ({ num: f.num, size: 4, index: 0 })) };
const hexBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const ACTIVITY: MesgDef = { global: 34, local: 5, fields: [{ num: 253, type: UINT32 }, { num: 0, type: UINT32 }, { num: 1, type: UINT16 }, { num: 2, type: ENUM }, { num: 3, type: ENUM }, { num: 4, type: ENUM }, { num: 5, type: UINT32 }] };

const EV_TIMER = 0, EV_LAP = 9, EV_SESSION = 8, EV_ACTIVITY = 26;
const ET_START = 0, ET_STOP = 1, ET_STOP_ALL = 4;
const SPORT_CYCLING = 2, SUB_INDOOR = 6;

export function encodeFit(rec: Recording, t: Totals): Uint8Array {
  const w = new Writer();
  for (let i = 0; i < 14; i++) w.u8(0); // header, filled in below
  const at = (sec: number) => fitTime(rec.startMs + sec * 1000);
  const end = rec.samples.length ? rec.samples[rec.samples.length - 1].t + 1 : 0;

  define(w, FILE_ID);
  data(w, FILE_ID, { 0: 4, 1: 255, 2: 1, 3: (rec.startMs / 1000) >>> 0, 4: at(0), 8: 'Antogo' });

  define(w, EVENT);
  data(w, EVENT, { 253: at(0), 0: EV_TIMER, 1: ET_START });

  // Breathing: the developer's id and its fields' descriptions come before the record definition that uses them.
  const breathing = rec.samples.some((s) => s.ve != null);
  if (breathing) {
    define(w, DEV_DATA_ID);
    data(w, DEV_DATA_ID, { 1: hexBytes(TYME_APP_ID), 3: 0 });
    define(w, FIELD_DESC);
    for (const f of TYME_FIELDS) data(w, FIELD_DESC, { 0: 0, 1: f.num, 2: FLOAT32, 3: f.name, 8: f.units });
  }
  const recordDef = breathing ? RECORD_BREATH : RECORD;
  define(w, recordDef);
  const pauses = rec.events.filter((e) => e.type === 'pause' || e.type === 'resume');
  let p = 0;
  for (const s of rec.samples) {
    while (p < pauses.length && pauses[p].t <= s.t) {
      data(w, EVENT, { 253: at(pauses[p].t), 0: EV_TIMER, 1: pauses[p].type === 'pause' ? ET_STOP_ALL : ET_START });
      p++;
    }
    data(w, recordDef, { 253: at(s.t), 7: s.w, 3: s.hr, 4: s.cad, 6: s.spd != null ? (s.spd / 3.6) * 1000 : undefined, 5: s.d != null ? s.d * 100 : undefined },
      breathing ? [s.br, s.tv, s.ve, s.ie] : []);
  }

  define(w, LAP);
  rec.laps.forEach((lap, i) => {
    const xs = rec.samples.filter((s) => s.t >= lap.start && s.t < lap.end);
    const ws = xs.map((s) => s.w).filter((x): x is number => x != null);
    const hs = xs.map((s) => s.hr).filter((x): x is number => x != null && x > 0);
    const cs = xs.map((s) => s.cad).filter((x): x is number => x != null && x > 0);
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : undefined);
    const dist = xs.length ? (xs[xs.length - 1].d ?? 0) - (rec.samples.find((s) => s.t >= lap.start)?.d ?? 0) : 0;
    data(w, LAP, {
      254: i, 253: at(lap.end), 0: EV_LAP, 1: ET_STOP, 2: at(lap.start),
      7: (lap.end - lap.start) * 1000, 8: xs.length * 1000, 9: Math.max(0, dist) * 100,
      15: avg(hs), 16: hs.length ? Math.max(...hs) : undefined, 17: avg(cs),
      19: avg(ws), 20: ws.length ? Math.max(...ws) : undefined, 24: lap.manual ? 0 : 2, 25: SPORT_CYCLING,
    });
  });

  define(w, EVENT);
  data(w, EVENT, { 253: at(end), 0: EV_TIMER, 1: ET_STOP_ALL });

  define(w, SESSION);
  data(w, SESSION, {
    254: 0, 253: at(end), 0: EV_SESSION, 1: ET_STOP, 2: at(0), 5: SPORT_CYCLING, 6: SUB_INDOOR,
    7: end * 1000, 8: t.seconds * 1000, 9: t.distanceM * 100,
    16: t.avgHr, 17: t.maxHr, 18: t.avgCadence, 20: t.avgPower, 21: t.maxPower,
    25: 0, 26: rec.laps.length, 28: 0, 34: t.np, 35: t.tss * 10, 36: t.intensity != null ? t.intensity * 1000 : undefined,
    45: rec.basis === 'power' || t.np ? rec.ftp : undefined, 48: t.kj != null ? t.kj * 1000 : undefined,
  });

  define(w, ACTIVITY);
  const offset = -new Date(rec.startMs).getTimezoneOffset() * 60;
  data(w, ACTIVITY, { 253: at(end), 0: t.seconds * 1000, 1: 1, 2: 0, 3: EV_ACTIVITY, 4: ET_STOP, 5: at(end) + offset });

  // Header: size, protocol 2.0, profile 21.0, data size, ".FIT", header CRC; then the file CRC.
  const out = w.bytes();
  const dataSize = out.length - 14;
  const h = new DataView(out.buffer, out.byteOffset, 14);
  h.setUint8(0, 14);
  h.setUint8(1, 0x20);
  h.setUint16(2, 2100, true);
  h.setUint32(4, dataSize, true);
  out.set([0x2e, 0x46, 0x49, 0x54], 8);
  h.setUint16(12, fitCrc(out, 0, 12), true);
  const crc = fitCrc(out);
  const file = new Uint8Array(out.length + 2);
  file.set(out);
  file[out.length] = crc & 0xff;
  file[out.length + 1] = crc >> 8;
  return file;
}
