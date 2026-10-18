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

export type SessionKind = 'ride' | 'strength' | 'mobility' | 'walk' | 'other';

/** One exercise in a strength or mobility session, with what to do and why. */
export interface Exercise {
  name: string;
  sets?: number;
  reps?: string;            // "8–10", "6 per side"
  holdSeconds?: number;     // for stretches and holds
  load?: string;            // "leave 2 reps in reserve", "bodyweight", "15–25 lb pack"
  cue: string;              // one line on how to do it
  why?: string;             // what it does for a cyclist
  equipment: Equipment[];
}

export type Equipment = 'bodyweight' | 'dumbbells' | 'bench' | 'band' | 'treadmill' | 'outdoor-walk' | 'trainer';

export interface WalkSpec {
  minutes: number;
  hrLow: number;            // fraction of max HR
  hrHigh: number;
  packKg?: number;          // weighted pack, if any
}

export interface Workout {
  id: string;
  name: string;
  /** Rides have blocks; strength and mobility have exercises; walks have a walk spec. */
  kind: SessionKind;
  family: Family;
  purpose: string;          // one paragraph, what it does for you
  physiology?: string;      // what it targets
  phases: Phase[];
  /** Which bases this workout works on. Short VO2max and sprint work is power-only. */
  bases: Basis[];
  /** Where it is meant to be ridden. Outdoor rides carry a long warm-up and finish in zone 2; indoor ones are compact. */
  setting: 'outdoor' | 'indoor' | 'any';
  blocks: WorkoutBlock[];   // empty for non-ride sessions
  exercises?: Exercise[];
  walk?: WalkSpec;
  /** Rough training stress for non-ride sessions (rides compute theirs from the blocks). */
  estimatedTss?: number;
  /** Intended duration for non-ride sessions. */
  minutes?: number;
  source: 'library' | 'mine' | 'generated';
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
  /** Set when a plan put this on the calendar; hand-added sessions have none. */
  planId?: string;
  /** For sessions logged in the app (strength, mobility, walks): how it felt, 1..10. */
  rpe?: number;
  loggedSeconds?: number;
}

/** A completed activity from the watch or computer (ride, walk, strength session), as stored locally after sync. */
export interface Ride {
  id: string;               // Intervals.icu activity id
  date: string;             // YYYY-MM-DD local
  startTime: string;        // ISO local
  name: string;
  type: string;             // Intervals.icu activity type: Ride, VirtualRide, Walk, Hike, WeightTraining, Yoga, ...
  sport: SessionKind;       // what the app treats it as
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
  eftp?: number;            // Intervals.icu's FTP estimate from this ride, if it made one
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
