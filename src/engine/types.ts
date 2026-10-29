// Core training types. The engine knows nothing about screens or storage.

export type Basis = 'power' | 'hr';

export interface Profile {
  updatedAt?: string;       // set by the database on every write; drives the sync across devices
  name: string;
  ftp: number;          // watts
  /** The day the FTP last changed (YYYY-MM-DD), stamped by the database whenever it does. */
  ftpSetOn?: string;
  lthr: number;         // bpm, lactate threshold heart rate on the bike
  /** The day the threshold heart rate last changed (YYYY-MM-DD), stamped by the database whenever it does. */
  lthrSetOn?: string;
  maxHr: number;        // bpm
  restingHr: number;    // bpm
  /**
   * The rider's zone tables. Each has a mode: 'pct' (shares of the threshold,
   * which move when the threshold changes) or 'abs' (watts or bpm, which stay
   * put). Both representations may be filled; the mode says which one is the
   * rider's. Absent: the standard shares.
   */
  powerZoneMode?: 'pct' | 'abs';
  /** Top of power zones 1..6 as whole percent of FTP. */
  powerZonePcts?: number[];
  /** Top of power zones 1..6 in watts. */
  powerZoneWatts?: number[];
  hrZoneMode?: 'pct' | 'abs';
  /** Top of heart-rate zones 1..6 as whole percent of the bike threshold. */
  hrZonePcts?: number[];
  /** Top of heart-rate zones 1..6 in bpm on the bike (zone 7 runs to max). */
  hrZoneTops?: number[];
  /** Threshold heart rate on foot (runs and walks), a few beats above the bike's for most people. Absent: the bike's. */
  footLthr?: number;
  footHrZoneMode?: 'pct' | 'abs';
  footHrZonePcts?: number[];
  /** Top of heart-rate zones 1..6 in bpm on foot. */
  footHrZoneTops?: number[];
  weightKg: number;
  birthYear?: number;
  /** Threshold run pace, seconds per kilometre (shown per mile or km by units). Optional: runs are by heart rate; pace is a hint. */
  thresholdPaceSec?: number;
  basis: Basis;         // default basis for new workouts
  masters: boolean;     // masters recovery ratios in the plan builder
  units: 'imperial' | 'metric';
  /** First day of the week on calendars, lists and printouts: 0 = Sunday, 1 = Monday. */
  weekStartsOn?: 0 | 1;
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
  /**
   * No minimum: the rider may go as easy as they like, up to intensityHigh.
   * `intensity` then stays the effort expected for load estimates (recovery
   * steps are typically ridden around it) but nothing is enforced; the Garmin
   * gets a floor far below anything a moving rider produces.
   */
  noFloor?: boolean;
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

export type SessionKind = 'ride' | 'strength' | 'mobility' | 'walk' | 'run' | 'other';

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

export type Equipment = 'bodyweight' | 'dumbbells' | 'kettlebell' | 'bench' | 'band' | 'barbell' | 'pullup-bar' | 'dip-bars' | 'treadmill' | 'outdoor-walk' | 'trainer';

export interface WalkSpec {
  minutes: number;
  /**
   * The heart-rate band as zone positions on the rider's foot table (see engine/foot.ts):
   * 2.0 is the bottom of zone 2, 3.0 its top. zoneLow at or below 1 means no minimum.
   */
  zoneLow?: number;
  zoneHigh?: number;
  /** Older walks: the band as a share of max heart rate; 0 low means no minimum. Still honoured; new walks use zones. */
  hrLow?: number;
  hrHigh?: number;
  packKg?: number;          // weighted pack, if any
}

/** One step of a run: time, a heart-rate band by name (zones on the foot table), and optionally repeats with a recovery. */
export interface RunStep {
  seconds: number;
  band?: 'walk' | 'easy' | 'steady' | 'tempo' | 'hard';
  recoverBand?: 'walk' | 'easy' | 'steady' | 'tempo' | 'hard';
  label?: string;
  repeat?: number;
  recoverSeconds?: number;
  /** Older runs: bands as shares of max heart rate. Still honoured; new runs use band names. */
  hrLow?: number; hrHigh?: number; recoverLow?: number; recoverHigh?: number;
}
export interface RunSpec { steps: RunStep[]; where?: 'outdoor' | 'treadmill' }

export interface Workout {
  updatedAt?: string;
  /** The descriptive form of a named library ride ("Sweet Spot 3 × 12"); the name itself is a place. */
  subtitle?: string;
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
  run?: RunSpec;
  /** Rough training stress for non-ride sessions (rides compute theirs from the blocks). */
  estimatedTss?: number;
  /** Planned effort for strength sessions, 1–10 (RPE); drives the estimate. */
  effort?: number;
  /** Intended duration for non-ride sessions. */
  minutes?: number;
  source: 'library' | 'mine' | 'generated';
  /** Ridden only in the ride player on a trainer: never sent to the Garmin (a Garmin workout is a fixed list of steps; it can't run until you fail). */
  trainerOnly?: boolean;
  /** A fitness test whose recording the app turns into results (FTP, VO2max, threshold heart rate). */
  test?: 'ramp' | '20min';
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
  updatedAt?: string;
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
  /** The plan's name when it was put here, so a plan record lost to a sync can be rebuilt under its real name. */
  planName?: string;
  /** The rider replaced or moved this plan session by hand; the re-check may suggest changes but never applies them unasked. */
  userEdited?: boolean;
  /** When a session was moved here, the date it came from. */
  movedFrom?: string;
  /** For sessions logged in the app (strength, mobility, walks): how it felt, 1..10. */
  rpe?: number;
  loggedSeconds?: number;
  /** The manual activity the app created in Intervals.icu when the session was logged by hand; the only activity an undo may delete. */
  manualActivityId?: string;
  /** Recordings the rider said were not this session ("Not this session"); never matched to it again. */
  notActivityIds?: string[];
  /** When the app relabelled the matched recording's type in Intervals.icu, what it was before, so an unmatch can put it back. */
  relabelled?: { activityId: string; from: string };
  /** What was actually done, captured from the plan when the session became done and editable by the rider. */
  done?: DoneRecord;
  /** The rider matched the recording to this session by hand; the automatic rules never undo it. */
  matchedByHand?: boolean;
  /** When the rider undid a hand-logged completion: an explicit choice that outranks a completion another device still holds. */
  undoneAt?: string;
}

/** One exercise as done: the plan's by default, then whatever the rider corrects. */
export interface DoneExercise {
  name: string;
  /** Library id (strength or mobility) when known, so "last time" finds it under a renamed copy too. */
  exerciseId?: string;
  sets?: number;
  reps?: string;
  holdSeconds?: number;
  /** As entered, in the unit shown at the time. */
  weight?: number;
  unit?: 'lb' | 'kg';
  skipped?: boolean;
  cue?: string;
  why?: string;
  equipment?: Equipment[];
}

/**
 * The rider's own edits to a recorded activity, kept by the app (activities
 * themselves are re-downloaded from Intervals.icu on every Sync, so edits live
 * here and are applied each time). Synced across devices with the calendar.
 */
export interface ActivityEdit {
  updatedAt?: string;
  id: string;               // the activity's Intervals.icu id
  date: string;             // the activity's date, so "last time" can order unplanned records
  /** What it really was, when the device's type was wrong. */
  kind?: SessionKind;
  /** Left out of training load: fitness, fatigue and the plan's view of the week. */
  excluded?: boolean;
  /** What was done, for an activity no planned session covers. */
  done?: DoneRecord;
  rpe?: number;
  /** Made by the Antogo ride player (uploaded from a ride on the trainer). Only such activities may ever be deleted by the Garmin rule. */
  source?: 'veloiq';
  /** The rider chose to keep Antogo's recording over the Garmin's: the Garmin rule leaves it alone. */
  keepVeloiq?: boolean;
  /** On the Garmin's recording: Antogo's copy of the same ride was removed in its favour. */
  replaced?: { name: string; at: string; playerActivityId?: string; recordingId?: string };
}

/** The record of a done strength, mobility or walk session. Rides have none: the device's data is the record. */
export interface DoneRecord {
  exercises?: DoneExercise[];
  walk?: { minutes: number; packKg?: number };
  /** Set when the rider edits it; absent means "assumed done as planned". */
  editedAt?: string;
}

/** A completed activity from the watch or computer (ride, walk, strength session), as stored locally after sync. */
export interface Ride {
  id: string;               // Intervals.icu activity id
  date: string;             // YYYY-MM-DD local
  startTime: string;        // ISO local
  name: string;
  type: string;             // Intervals.icu activity type: Ride, VirtualRide, Walk, Hike, WeightTraining, Yoga, ...
  sport: SessionKind;       // what the app treats it as
  seconds: number;          // the duration the app uses: moving time for rides (and runs), elapsed time for walks, strength and mobility
  movingSeconds?: number;   // as the device judged it; a watch on a still arm (treadmill, phone in hand) under-counts it
  elapsedSeconds?: number;  // start to finish
  distanceM?: number;
  elevationM?: number;
  tss?: number;             // as computed by the engine
  icuLoad?: number;         // Intervals' own load, for reference
  normalizedPower?: number;
  averagePower?: number;
  intensityFactor?: number; // a fraction of FTP (0.84), known only for rides with power
  averageHr?: number;
  maxHr?: number;
  /** How `tss` was arrived at: 'power', 'heart-rate', Intervals.icu's own load, or a duration estimate (no power, no heart rate). */
  tssBasis?: 'power' | 'heart-rate' | 'intervals' | 'estimate' | 'effort';
  /** Not training: a "ride" at car speed, or a recording too short to mean anything. Counts 0 and is hidden from lists. */
  notTraining?: 'drive' | 'trivial';
  averageCadence?: number;
  averageSpeedMs?: number;
  averageTempC?: number;
  efficiencyFactor?: number;
  decoupling?: number;
  powerZoneSeconds?: number[];
  /** Intervals.icu's sweet-spot time: a band straddling zones 3 and 4, already counted inside them, so never a zone of its own. */
  sweetSpotSeconds?: number;
  hrZoneSeconds?: number[];
  ftpAtRide?: number;
  eftp?: number;            // Intervals.icu's FTP estimate from this ride, if it made one
  pairedEventId?: number;
  /** Left out of training load by the rider: `tss` is 0 and this is what it would have been. */
  uncountedTss?: number;
  /** The activity's description in Intervals.icu (the app writes its record there when it is empty). */
  description?: string;
}

export interface Wellness {
  date: string;
  hrv?: number;
  restingHr?: number;
  sleepSeconds?: number;
  sleepScore?: number;
  /** Average heart rate while asleep (bpm), when the watch sends it. */
  avgSleepingHr?: number;
  /** Breathing rate overnight (breaths per minute), when the watch sends it. */
  respiration?: number;
  weightKg?: number;
}

/**
 * The rider's own word on a day: a note for the coach, and whether the
 * wellness numbers recorded for that day can be trusted (a watch left out of
 * sleep mode, a night in a hotel). A distrusted day is left out of readiness and
 * of every average the assessment builds.
 */
export interface DayNote {
  date: string;             // YYYY-MM-DD local; sleep and HRV for the night are on the morning's date
  text?: string;
  badWellness?: boolean;
  updatedAt?: string;
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
