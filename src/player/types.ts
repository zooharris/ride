/** What the player records. Times are seconds from the moment the ride started (the wall clock, pauses included). */

export interface Sample {
  t: number;
  /** watts */
  w?: number;
  hr?: number;
  cad?: number;
  /** km/h */
  spd?: number;
  /** metres so far */
  d?: number;
  /** the target at that second, watts (power) or bpm (heart rate) */
  tgt?: number;
  /** index of the workout step being ridden; absent after the workout ends or on a free ride */
  s?: number;
  /** where in the workout this second was (seconds; skips move it on), for drawing the ride over the plan */
  p?: number;
  /** Breathing strap (Step 3): ventilation L/min, breaths a minute, breath size L; each breath held until the next. */
  ve?: number;
  br?: number;
  tv?: number;
  /** inhale time over exhale time */
  ie?: number;
}

export interface Lap { start: number; end: number; step?: number; manual?: boolean }

export type RideEventType = 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'intensity' | 'mode' | 'eased' | 'lost' | 'found' | 'done' | 'cue' | 'test';
export interface RideEvent { t: number; type: RideEventType; value?: string | number }

export type RecordingStatus = 'recording' | 'finished' | 'uploaded' | 'discarded' | 'superseded';

export interface Recording {
  id: string;
  status: RecordingStatus;
  /** ISO local-time string of the start, and the start in ms since 1970. */
  startedAt: string;
  startMs: number;
  /** The date it counts on, YYYY-MM-DD local. */
  date: string;
  plannedId?: string;
  workoutId?: string;
  name: string;
  basis: 'power' | 'hr';
  ftp: number;
  lthr: number;
  samples: Sample[];
  laps: Lap[];
  events: RideEvent[];
  /** Seconds of riding (pauses left out). */
  timerSeconds: number;
  distanceM: number;
  /** When the recording last saved, ms. */
  savedMs: number;
  rpe?: number;
  activityId?: string;
  uploadedAt?: string;
  /** The last upload attempt's failure, in words. */
  error?: string;
  /** The Garmin recorded the same ride and its recording was kept: its activity id. The file stays here 30 days for Undo. */
  supersededBy?: string;
  /** The rider chose Antogo's recording over the Garmin's. */
  keepVeloiq?: boolean;
  /** The Ramp Test: watts added each minute (what the ramp was built from). */
  rampStep?: number;
  /** The Ramp Test: where in the workout (seconds) the ramp ended, by the rider or by itself; the cool-down follows from there. */
  rampEndAt?: number;
  /** Any second has breathing (a breathing strap was connected), and the strap's name. */
  breathing?: boolean;
  breathSensor?: string;
  /** A fitness test's results, and what the rider did with each suggestion. */
  test?: import('./tests').TestResult;
}
