/**
 * Pure readers for the four standard Bluetooth measurements the player uses,
 * and the Fitness Machine control-point commands. Nothing here touches
 * Bluetooth itself, so every byte layout is tested against fixtures written
 * from the Bluetooth SIG specifications (Fitness Machine Service 1.0, Cycling
 * Power 1.1, Heart Rate 1.0, Cycling Speed and Cadence 1.0).
 */

// ── Fitness Machine: Indoor Bike Data (0x2AD2) ─────────────────────────────

export interface IndoorBikeData {
  /** km/h */
  speedKmh?: number;
  /** rpm */
  cadence?: number;
  /** metres since the trainer's session began */
  distanceM?: number;
  resistance?: number;
  watts?: number;
  bpm?: number;
  elapsedS?: number;
}

/**
 * Fields follow the flags in this order, each present when its bit is set,
 * except instantaneous speed, which is present when bit 0 ("more data") is CLEAR.
 */
export function parseIndoorBikeData(v: DataView): IndoorBikeData {
  const flags = v.getUint16(0, true);
  let o = 2;
  const out: IndoorBikeData = {};
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  if (!has(0)) { out.speedKmh = v.getUint16(o, true) / 100; o += 2; }
  if (has(1)) o += 2; // average speed
  if (has(2)) { out.cadence = v.getUint16(o, true) / 2; o += 2; }
  if (has(3)) o += 2; // average cadence
  if (has(4)) { out.distanceM = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); o += 3; }
  if (has(5)) { out.resistance = v.getInt16(o, true); o += 2; }
  if (has(6)) { out.watts = v.getInt16(o, true); o += 2; }
  if (has(7)) o += 2; // average power
  if (has(8)) o += 5; // expended energy: total (2), per hour (2), per minute (1)
  if (has(9)) { out.bpm = v.getUint8(o); o += 1; }
  if (has(10)) o += 1; // metabolic equivalent
  if (has(11)) { out.elapsedS = v.getUint16(o, true); o += 2; }
  return out;
}

// ── Fitness Machine: control point (0x2AD9) ────────────────────────────────

export const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetResistance: 0x04,
  setTargetPower: 0x05,
  startOrResume: 0x07,
  stopOrPause: 0x08,
  response: 0x80,
} as const;

export const RESULT = { success: 0x01, notSupported: 0x02, invalidParameter: 0x03, failed: 0x04, notPermitted: 0x05 } as const;

export function cmdRequestControl(): Uint8Array { return Uint8Array.of(OP.requestControl); }
export function cmdStart(): Uint8Array { return Uint8Array.of(OP.startOrResume); }
/** 1 = stop, 2 = pause. */
export function cmdStop(pause = false): Uint8Array { return Uint8Array.of(OP.stopOrPause, pause ? 2 : 1); }
/** Target power in whole watts (signed 16-bit). */
export function cmdSetTargetPower(watts: number): Uint8Array {
  const w = Math.max(-32768, Math.min(32767, Math.round(watts)));
  return Uint8Array.of(OP.setTargetPower, w & 0xff, (w >> 8) & 0xff);
}

export interface ControlResponse { request: number; result: number; ok: boolean }
/** A control-point indication: 0x80, the opcode it answers, the result. */
export function parseControlResponse(v: DataView): ControlResponse | null {
  if (v.byteLength < 3 || v.getUint8(0) !== OP.response) return null;
  const result = v.getUint8(2);
  return { request: v.getUint8(1), result, ok: result === RESULT.success };
}

export interface Range { min: number; max: number; step: number }
/** Supported Power Range (0x2AD8): signed min and max watts, unsigned increment. */
export function parsePowerRange(v: DataView): Range {
  return { min: v.getInt16(0, true), max: v.getInt16(2, true), step: v.getUint16(4, true) || 1 };
}
/** Supported Resistance Level Range (0x2AD6): the same layout, in tenths. */
export function parseResistanceRange(v: DataView): Range {
  return { min: v.getInt16(0, true) / 10, max: v.getInt16(2, true) / 10, step: (v.getUint16(4, true) || 1) / 10 };
}

// ── Cycling Power Measurement (0x2A63) ─────────────────────────────────────

export interface PowerMeasurement {
  watts: number;
  /** Cumulative wheel revolutions and the time of the last one, in 1/2048 s. */
  wheel?: { revs: number; time: number };
  /** Cumulative crank revolutions and the time of the last one, in 1/1024 s. */
  crank?: { revs: number; time: number };
}

export function parseCyclingPower(v: DataView): PowerMeasurement {
  const flags = v.getUint16(0, true);
  const out: PowerMeasurement = { watts: v.getInt16(2, true) };
  let o = 4;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  if (has(0)) o += 1; // pedal power balance
  if (has(2)) o += 2; // accumulated torque
  if (has(4)) { out.wheel = { revs: v.getUint32(o, true), time: v.getUint16(o + 4, true) }; o += 6; }
  if (has(5)) { out.crank = { revs: v.getUint16(o, true), time: v.getUint16(o + 2, true) }; o += 4; }
  return out;
}

// ── Heart Rate Measurement (0x2A37) ────────────────────────────────────────

export function parseHeartRate(v: DataView): number {
  const flags = v.getUint8(0);
  return flags & 0x01 ? v.getUint16(1, true) : v.getUint8(1);
}

// ── Cycling Speed and Cadence Measurement (0x2A5B) ─────────────────────────

export interface CscMeasurement {
  /** Time in 1/1024 s. */
  wheel?: { revs: number; time: number };
  crank?: { revs: number; time: number };
}

export function parseCsc(v: DataView): CscMeasurement {
  const flags = v.getUint8(0);
  let o = 1;
  const out: CscMeasurement = {};
  if (flags & 0x01) { out.wheel = { revs: v.getUint32(o, true), time: v.getUint16(o + 4, true) }; o += 6; }
  if (flags & 0x02) { out.crank = { revs: v.getUint16(o, true), time: v.getUint16(o + 2, true) }; o += 4; }
  return out;
}

// ── From revolution counters to cadence and speed ──────────────────────────

/**
 * Turns successive (cumulative revolutions, last event time) pairs into a
 * rate. Counters and times roll over (16-bit crank counts and event times);
 * a repeated pair means no new revolution yet, and nothing new for three
 * seconds means the wheel or the cranks have stopped.
 */
export class RevRate {
  private last?: { revs: number; time: number; at: number };
  private rate = 0;
  private lastChange = 0;
  constructor(private readonly revMod: number, private readonly ticksPerSecond: number) {}

  /** Revolutions per second, or 0 when stopped. `now` in ms. */
  update(revs: number, time: number, now: number): number {
    const prev = this.last;
    this.last = { revs, time, at: now };
    if (!prev) { this.lastChange = now; return 0; }
    const dRevs = (revs - prev.revs + this.revMod) % this.revMod;
    const dTicks = (time - prev.time + 65536) % 65536;
    if (dRevs > 0 && dTicks > 0) {
      this.rate = dRevs / (dTicks / this.ticksPerSecond);
      this.lastChange = now;
    } else if (now - this.lastChange > 3000) {
      this.rate = 0;
    }
    return this.rate;
  }
}

export const crankRate = () => new RevRate(65536, 1024);
/** Cycling Power wheel data: 32-bit revolutions, 1/2048 s. */
export const cpsWheelRate = () => new RevRate(2 ** 32, 2048);
/** Speed and Cadence wheel data: 32-bit revolutions, 1/1024 s. */
export const cscWheelRate = () => new RevRate(2 ** 32, 1024);

/** A 700 × 25c road wheel, metres; the usual default. */
export const WHEEL_M = 2.105;
