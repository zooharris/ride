/**
 * A small FIT file writer for the files Antogo exports (12 Nov 2026, export at any time): workout files and
 * activity files written from a recording's streams. Written from the public FIT protocol description, like the
 * ride player's own writer (player/fit.ts), which stays as it is so the player's file never changes. This one also
 * carries signed numbers (map positions, temperature) and developer fields.
 */
import { fitCrc } from '../player/fit';

/** A FIT base type: its code and its size in bytes. */
export type BaseType = readonly [number, number];
export const ENUM: BaseType = [0x00, 1];
export const SINT8: BaseType = [0x01, 1];
export const UINT8: BaseType = [0x02, 1];
export const UINT16: BaseType = [0x84, 2];
export const SINT32: BaseType = [0x85, 4];
export const UINT32: BaseType = [0x86, 4];
export const UINT32Z: BaseType = [0x8c, 4];
export const STRING = (n: number): BaseType => [0x07, n];
export const BYTES = (n: number): BaseType => [0x0d, n];
export const FLOAT32 = 0x88;

const INVALID: Record<number, number> = { 0x00: 0xff, 0x01: 0x7f, 0x02: 0xff, 0x84: 0xffff, 0x85: 0x7fffffff, 0x86: 0xffffffff, 0x8c: 0 };
const SIGNED = new Set([0x01, 0x85]);

export interface FieldDef { num: number; type: BaseType }
export interface DevFieldDef { num: number; size: number; index: number }
export interface MesgDef { global: number; local: number; fields: FieldDef[]; dev?: DevFieldDef[] }
export type Value = number | string | Uint8Array | undefined;

/** FIT time: seconds since 31 December 1989, 00:00 UTC. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31, 0, 0, 0);
export const fitTime = (ms: number) => Math.round((ms - FIT_EPOCH_MS) / 1000);

export class FitWriter {
  private buf = new Uint8Array(1 << 16);
  private len = 14; // the header is written last
  private defined = new Map<number, MesgDef>();

  private grow(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  private u8(v: number) { this.grow(1); this.buf[this.len++] = v & 0xff; }
  private u16(v: number) { this.u8(v); this.u8(v >>> 8); }
  private u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  private f32(v: number | undefined) {
    if (v == null || !Number.isFinite(v)) { this.u32(0xffffffff); return; }
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    b.forEach((x) => this.u8(x));
  }

  /** Write a definition message (only when the local number now means something else). */
  define(d: MesgDef): void {
    if (this.defined.get(d.local) === d) return;
    this.defined.set(d.local, d);
    this.u8(0x40 | (d.dev?.length ? 0x20 : 0) | d.local);
    this.u8(0);
    this.u8(0); // little-endian
    this.u16(d.global);
    this.u8(d.fields.length);
    for (const f of d.fields) { this.u8(f.num); this.u8(f.type[1]); this.u8(f.type[0]); }
    if (d.dev?.length) { this.u8(d.dev.length); for (const f of d.dev) { this.u8(f.num); this.u8(f.size); this.u8(f.index); } }
  }

  /** Write a data message; a value left out, or not a finite number, is written as the type's "invalid". */
  write(d: MesgDef, values: Record<number, Value>, dev: Array<number | undefined> = []): void {
    this.define(d);
    this.u8(d.local);
    for (const f of d.fields) {
      const [code, size] = f.type;
      const v = values[f.num];
      if (code === 0x0d) {
        for (let i = 0; i < size; i++) this.u8(v instanceof Uint8Array && i < v.length ? v[i] : 0xff);
        continue;
      }
      if (code === 0x07) {
        const s = typeof v === 'string' ? utf8Cut(v, size - 1) : new Uint8Array();
        for (let i = 0; i < size; i++) this.u8(i < s.length ? s[i] : 0);
        continue;
      }
      let n: number;
      if (typeof v !== 'number' || !Number.isFinite(v)) n = INVALID[code];
      else if (SIGNED.has(code)) {
        const r = Math.round(v);
        const lim = size === 1 ? 0x7f : 0x7fffffff;
        n = Math.max(-lim, Math.min(lim - 1, r));
        if (n < 0) n = size === 1 ? n & 0xff : n >>> 0;
      } else {
        const max = size === 1 ? 0xfe : size === 2 ? 0xfffe : 0xfffffffe;
        n = Math.max(0, Math.min(max, Math.round(v)));
      }
      if (size === 1) this.u8(n); else if (size === 2) this.u16(n); else this.u32(n);
    }
    (d.dev ?? []).forEach((_, i) => this.f32(dev[i]));
  }

  /** The finished file: header, the messages, and the file's CRC. */
  finish(): Uint8Array {
    const out = this.buf.slice(0, this.len);
    const h = new DataView(out.buffer, out.byteOffset, 14);
    h.setUint8(0, 14);
    h.setUint8(1, 0x20); // protocol 2.0
    h.setUint16(2, 2100, true); // profile 21.00
    h.setUint32(4, this.len - 14, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    h.setUint16(12, fitCrc(out, 0, 12), true);
    const crc = fitCrc(out);
    const file = new Uint8Array(out.length + 2);
    file.set(out);
    file[out.length] = crc & 0xff;
    file[out.length + 1] = crc >> 8;
    return file;
  }
}

/** A string as UTF-8, cut to at most n bytes without splitting a character. */
function utf8Cut(s: string, n: number): Uint8Array {
  const enc = new TextEncoder();
  let b = enc.encode(s);
  if (b.length <= n) return b;
  let cut = s;
  while (b.length > n && cut.length) { cut = cut.slice(0, -1); b = enc.encode(cut); }
  return b;
}

/** The file id every exported file starts with. `type` 4 is an activity, 5 a workout. */
export const FILE_ID: MesgDef = { global: 0, local: 0, fields: [{ num: 0, type: ENUM }, { num: 1, type: UINT16 }, { num: 2, type: UINT16 }, { num: 3, type: UINT32Z }, { num: 4, type: UINT32 }, { num: 8, type: STRING(20) }] };
/** Manufacturer 255 is "development": the honest value for a file no device made. */
export const MANUFACTURER_DEVELOPMENT = 255;
