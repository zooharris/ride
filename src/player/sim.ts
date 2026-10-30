/**
 * A simulated rider on a simulated trainer: practice without the bike, and the
 * thing the tests and screenshots ride. Power follows the trainer's target
 * with a short lag and a little noise; heart rate follows power slowly, the
 * way a real heart does, and drifts up over a long effort.
 */

export interface RiderNumbers { ftp: number; lthr: number; restingHr: number; maxHr: number }

/** Road speed on a trainer from power, roughly: 200 W ≈ 27 km/h. */
export function simSpeedKmh(watts: number): number {
  return watts <= 0 ? 0 : 4.6 * Math.cbrt(watts);
}

/** The heart rate a steady power settles at, before drift. */
export function steadyHr(watts: number, p: RiderNumbers): number {
  const f = Math.max(0, watts) / Math.max(1, p.ftp);
  return Math.min(p.maxHr, p.restingHr + (p.lthr - p.restingHr) * Math.pow(f, 0.85));
}

/** Upward drift after `minutes` of riding, bpm: faster the harder the effort. */
export function driftBpm(minutes: number, fractionOfFtp: number): number {
  return 0.06 * minutes * Math.min(1, Math.max(0, fractionOfFtp) / 0.6);
}

/** One step of heart rate toward where the power puts it, with a 45-second lag. */
export function nextHr(hr: number, watts: number, p: RiderNumbers, dtS: number, minutesIn: number): number {
  const target = steadyHr(watts, p) + driftBpm(minutesIn, watts / Math.max(1, p.ftp));
  return hr + (target - hr) * (1 - Math.exp(-dtS / 45));
}

/** One step of delivered power toward the target, with a 2-second lag. */
export function nextPower(watts: number, target: number, dtS: number): number {
  return watts + (target - watts) * (1 - Math.exp(-dtS / 2));
}

/** The ventilation a steady power settles at, L/min: about 10 + 0.14 × watts. */
export const steadyVe = (watts: number) => 10 + 0.14 * Math.max(0, watts);
/** Breaths a minute for a ventilation, 14 to 45; the breath size follows from the two. */
export const breathRateFor = (ve: number) => Math.max(14, Math.min(45, 10 + ve * 0.3));

export class SimRider {
  watts = 0;
  bpm: number;
  cadence = 0;
  /** What the simulated trainer has been told to hold; free pedalling at 150 W otherwise. */
  target = 150;
  /** Ventilation, L/min: follows power with a lag of about 30 seconds. */
  ve = 14;
  private seconds = 0;
  constructor(private p: RiderNumbers) { this.bpm = p.restingHr + 8; }
  setNumbers(p: RiderNumbers): void { this.p = p; }

  tick(dtS = 1): { watts: number; cadence: number; speedKmh: number; bpm: number; ve: number; br: number; tv: number; ie: number } {
    this.seconds += dtS;
    this.watts = nextPower(this.watts, this.target, dtS);
    const noisy = Math.max(0, this.watts * (1 + (Math.random() - 0.5) * 0.06));
    this.cadence = this.target > 0 ? 88 + Math.round((Math.random() - 0.5) * 8) : 0;
    this.bpm = nextHr(this.bpm, this.watts, this.p, dtS, this.seconds / 60);
    this.ve += (steadyVe(this.watts) - this.ve) * (1 - Math.exp(-dtS / 30));
    const ve = Math.max(5, this.ve * (1 + (Math.random() - 0.5) * 0.08));
    const br = breathRateFor(ve) * (1 + (Math.random() - 0.5) * 0.06);
    return { watts: Math.round(noisy), cadence: this.cadence, speedKmh: simSpeedKmh(noisy), bpm: Math.round(this.bpm), ve: Math.round(ve * 10) / 10, br: Math.round(br * 10) / 10, tv: Math.round((ve / br) * 100) / 100, ie: Math.round((0.75 + Math.random() * 0.1) * 100) / 100 };
  }
}
