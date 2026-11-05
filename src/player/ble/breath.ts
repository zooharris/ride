/**
 * The Tymewear VitalPro breathing strap (Step 3, 30 Oct 2026). Its protocol is
 * not published; this follows K-Breathe's reading of it (docs/PROTOCOL.md,
 * Protocol.kt), checked there against Tymewear's own files over two rides.
 *
 * All breathing arrives as notifications on 40B50004-…; no command starts it.
 * Packet 0x01 (17 bytes) comes once a breath, little-endian: [1..4] uint32
 * timestamp in 40 ms ticks, [5..6] inhale time, [7..8] exhale time (10 ms
 * units), [9..10] breath size raw (0.01 L). Packets 0x02 (accelerometer) and
 * 0x06 (raw peaks) are ignored. Pure, so it is tested without Bluetooth.
 */

export const BREATH_SERVICE = '40b50000-30b5-11e5-a151-feff819cdc90';
export const BREATH_DATA = '40b50004-30b5-11e5-a151-feff819cdc90';
/**
 * The VitalPro is two Bluetooth devices. Its breathing sensor is named
 * "TYME-xxxx" (these prefixes find it); its heart-rate sensor is named
 * "TymeHR nnnnnnn" and is an ordinary heart-rate strap, never the breathing one.
 */
export const BREATH_NAMES = ['VitalPro', 'vitalpro', 'tymewear', 'TYME-'];
export const isTymeHrName = (name?: string) => !!name && /^\s*TymeHR\b/i.test(name);
export const isBreathName = (name?: string) => !!name && !isTymeHrName(name) && /vitalpro|tymewear|tyme/i.test(name);

export interface Breath {
  /** breaths a minute */
  rate: number;
  /** litres a breath */
  size: number;
  /** litres a minute */
  ventilation: number;
  /** inhale time over exhale time */
  ieRatio: number;
  /** the strap's clock, 40 ms ticks */
  timestamp: number;
}

const TICK_S = 0.04;
const SIZE_L = 0.01;
const MAX_RATE = 80, MAX_VE = 300, MIN_RATE = 4;

const bytesOf = (b: Uint8Array | DataView) => (b instanceof DataView ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b);

/** The timestamp of a breath packet, or undefined for any other packet (so a rejected breath still moves the clock on). */
export function breathTimestamp(raw: Uint8Array | DataView): number | undefined {
  const b = bytesOf(raw);
  if (b.length < 11 || b[0] !== 0x01) return undefined;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(1, true);
}

/**
 * One breath from a 0x01 packet. The rate comes from the time since the last
 * breath; for the first breath, or when that gives under 4 a minute (a packet
 * went missing), from this breath's own inhale and exhale times. A rate over 80
 * or a ventilation over 300 L/min is noise: null.
 */
export function parseBreathPacket(raw: Uint8Array | DataView, prevTimestamp?: number): Breath | null {
  const b = bytesOf(raw);
  if (b.length < 11 || b[0] !== 0x01) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const timestamp = v.getUint32(1, true);
  const inhale = v.getUint16(5, true), exhale = v.getUint16(7, true);
  const size = v.getUint16(9, true) * SIZE_L;
  let rate: number | undefined;
  if (prevTimestamp != null) {
    const dt = ((timestamp - prevTimestamp) >>> 0) * TICK_S;
    if (dt > 0) rate = 60 / dt;
  }
  if (rate == null || rate < MIN_RATE) rate = inhale + exhale > 0 ? 6000 / (inhale + exhale) : undefined;
  if (rate == null || !isFinite(rate) || rate > MAX_RATE || size <= 0) return null;
  const ventilation = rate * size;
  if (ventilation > MAX_VE) return null;
  return { rate, size, ventilation, ieRatio: exhale > 0 ? inhale / exhale : 0, timestamp };
}

/** One packet as a line for Copy details: its length, first byte and every byte in hex. */
export function packetLine(raw: Uint8Array | DataView): string {
  const b = bytesOf(raw);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  return `${b.length} bytes, type 0x${(b[0] ?? 0).toString(16).padStart(2, '0')}: ${hex}`;
}

// ── The strap's commands (4 Nov 2026, from Todd's capture of the Tymewear app) ──
//
// 40B50007 is the command characteristic (write with response; the strap answers
// by notification on it). A command is two little-endian uint16s, [command][tag],
// and the reply starts 00 80 <tag>. Every minute the strap also sends an 8-byte
// beacon on it, 02 40 <counter> 1c …. 40B50001 carries stored-session downloads,
// which Antogo does not use. Pure.

export const BREATH_CMD = '40b50007-30b5-11e5-a151-feff819cdc90';
export const BREATH_BULK = '40b50001-30b5-11e5-a151-feff819cdc90';

/** The commands the Tymewear app sends, as captured. */
export const STRAP = {
  /** Status: answered with the strap's clock, its current session's start, and a flag byte. */
  status: [0x01, 0x00, 0x0a, 0x00],
  /** Start a session (the app sends it when an activity starts). */
  start: [0x2d, 0x00, 0x2d, 0x00],
  /** Sent after start and after stop; likely "apply". */
  apply: [0x2e, 0x00, 0x2e, 0x00],
  /** Stop the session (the live stream ends at once). */
  stop: [0x21, 0x00, 0x0c, 0x00],
  /** List the sessions the strap has stored. */
  list: [0x09, 0x01, 0x6c, 0x00],
  /** Erase the stored sessions. */
  erase: [0x2b, 0x00, 0x2b, 0x00],
} as const;
export type StrapCommand = keyof typeof STRAP;

/** The tag a command's reply carries (its bytes 2-3). */
export const tagOf = (cmd: ArrayLike<number>): number => cmd[2] | (cmd[3] << 8);

export interface StrapStatus {
  /** The flag byte: 0xe6 seen while sensing with a session, 0x26 idle, 0x66 just after a stop. */
  flag: number;
  /** The strap's clock, Unix seconds. */
  now: number;
  /** The current session's start, Unix seconds; 0 when there is none. */
  session: number;
}

export type StrapReply =
  | { type: 'reply'; tag: number; status?: StrapStatus; sessions?: number[]; bytes: Uint8Array }
  | { type: 'beacon'; counter: number; bytes: Uint8Array };

/** A notification on the command characteristic: a reply to a command, or the strap's minute beacon. */
export function parseStrapReply(raw: Uint8Array | DataView): StrapReply | undefined {
  const b = bytesOf(raw);
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x80) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = v.getUint16(2, true);
    const out: StrapReply = { type: 'reply', tag, bytes: b };
    if (tag === tagOf(STRAP.status) && b.length >= 24) out.status = { flag: b[11], now: v.getUint32(16, true), session: v.getUint32(20, true) };
    if (tag === tagOf(STRAP.list)) { const s: number[] = []; for (let i = 4; i + 12 <= b.length; i += 12) s.push(v.getUint32(i, true)); out.sessions = s; }
    return out;
  }
  if (b.length >= 3 && b[0] === 0x02 && b[1] === 0x40) return { type: 'beacon', counter: b[2], bytes: b };
  return undefined;
}

/** The clock of a 0x02 motion frame (40 ms ticks, bytes 1-4). A sensor whose clock stops advancing has stalled. */
export function motionClock(raw: Uint8Array | DataView): number | undefined {
  const b = bytesOf(raw);
  if (b.length < 5 || b[0] !== 0x02) return undefined;
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(1, true);
}

/** A status in words, for Copy details. */
export function statusWords(s: StrapStatus): string {
  const t = (x: number) => (x ? new Date(x * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'none');
  return `flag 0x${s.flag.toString(16).padStart(2, '0')}, strap clock ${t(s.now)}, session started ${t(s.session)}`;
}
