// Core training types. The engine knows nothing about screens or storage.

export type Basis = 'power' | 'hr';

export interface Profile {
  name: string;
  ftp: number;          // watts
  lthr: number;         // bpm, lactate threshold heart rate
  maxHr: number;        // bpm
  restingHr: number;    // bpm
  weightKg: number;
  birthYear?: number;
  basis: Basis;         // default basis for new workouts
  masters: boolean;     // masters recovery ratios in the plan builder
  units: 'imperial' | 'metric';
  rideDays: number[];   // 0 = Sunday .. 6 = Saturday
  hoursPerWeek: number;
}

export interface WorkoutStep {
  kind: 'step';
  seconds: number;
  /** Intensity as a fraction of threshold: 0.88 = 88% of FTP or LTHR. */
  intensity: number;
  /** Optional upper bound for a range target; when set, intensity is the lower bound. */
  intensityHigh?: number;
  label?: string;
  cadence?: number;
}

export interface WorkoutRepeat {
  kind: 'repeat';
  times: number;
  steps: WorkoutStep[];
  label?: string;
}

export type WorkoutBlock = WorkoutStep | WorkoutRepeat;

export type Family =
  | 'recovery' | 'endurance' | 'tempo' | 'sweetspot'
  | 'threshold' | 'vo2max' | 'anaerobic' | 'test';

export type Phase = 'base' | 'build' | 'peak' | 'taper' | 'any';

export interface Workout {
  id: string;
  name: string;
  family: Family;
  purpose: string;          // one paragraph, what it does for you
  physiology?: string;      // what it targets
  phases: Phase[];
  /** Which bases this workout works on. Short VO2max and sprint work is power-only. */
  bases: Basis[];
  blocks: WorkoutBlock[];
  source: 'library' | 'mine';
}

export interface WorkoutStats {
  seconds: number;
  tss: number;
  intensityFactor: number;
  dominantZone: number;     // 1..7
  zoneSeconds: number[];    // index 0 = Z1
}

/** A workout placed on a date. */
export interface PlannedWorkout {
  id: string;
  date: string;             // YYYY-MM-DD local
  workoutId: string;
  basis: Basis;
  status: 'planned' | 'sent' | 'completed' | 'missed';
  icuEventId?: number;
  activityId?: string;
  note?: string;
}

/** A completed ride, as stored locally after sync. */
export interface Ride {
  id: string;               // Intervals.icu activity id
  date: string;             // YYYY-MM-DD local
  startTime: string;        // ISO local
  name: string;
  type: string;
  seconds: number;          // moving time
  distanceM?: number;
  elevationM?: number;
  tss?: number;             // as computed by the engine
  icuLoad?: number;         // Intervals' own load, for reference
  normalizedPower?: number;
  averagePower?: number;
  intensityFactor?: number;
  averageHr?: number;
  maxHr?: number;
  averageCadence?: number;
  averageSpeedMs?: number;
  averageTempC?: number;
  efficiencyFactor?: number;
  decoupling?: number;
  powerZoneSeconds?: number[];
  hrZoneSeconds?: number[];
  ftpAtRide?: number;
  pairedEventId?: number;
}

export interface Wellness {
  date: string;
  hrv?: number;
  restingHr?: number;
  sleepSeconds?: number;
  sleepScore?: number;
  weightKg?: number;
}

export interface DayLoad {
  date: string;
  tss: number;
}

export interface Fitness {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
}
