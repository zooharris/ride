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
/** The strap's name contains one of these. */
export const BREATH_NAMES = ['VitalPro', 'vitalpro', 'tymewear', 'TYME'];
export const isBreathName = (name?: string) => !!name && /vitalpro|tymewear|tyme/i.test(name);

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
