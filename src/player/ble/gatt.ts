/**
 * The standard Bluetooth services and characteristics the player uses, by their
 * 16-bit numbers (Bluetooth SIG assigned numbers). Every smart trainer of the
 * last few years speaks the Fitness Machine Service; power meters, heart-rate
 * straps and speed/cadence sensors have their own standard services.
 */
export const SERVICE = {
  ftms: 0x1826,
  cyclingPower: 0x1818,
  heartRate: 0x180d,
  csc: 0x1816,
} as const;

export const CHAR = {
  // Fitness Machine Service
  indoorBikeData: 0x2ad2,
  controlPoint: 0x2ad9,
  supportedPowerRange: 0x2ad8,
  supportedResistanceRange: 0x2ad6,
  machineStatus: 0x2ada,
  machineFeature: 0x2acc,
  // Cycling Power
  cyclingPowerMeasurement: 0x2a63,
  // Heart Rate
  heartRateMeasurement: 0x2a37,
  // Cycling Speed and Cadence
  cscMeasurement: 0x2a5b,
} as const;
