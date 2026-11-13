/**
 * What can be exported, in which formats, and why a format may not be offered (12 Nov 2026, export at any time).
 * Nothing is converted silently: a format that can't carry what the rider chose is listed as unavailable, with a
 * sentence saying why.
 */
import type { Profile, Workout } from '../engine/types';
import { versionFor, type SendBasis, type Where } from '../library/sendWhere';
import { shapedForSend } from '../library/breathSend';
import type { BreathPowerTable } from '../player/breathControl';
import { encodeFitWorkout, fitWorkoutKind } from './fitWorkout';
import { encodeMrcErg, encodeZwo } from './trainerFiles';
import { hasOpenEffort, sessionDocument } from './workoutText';
import { exportFileName } from './names';

export type WorkoutFormat = 'fit' | 'zwo' | 'mrc' | 'erg' | 'text';
export type ActivityFormat = 'fit' | 'tcx' | 'gpx';

// The file type first, always choosable, with a hint after it (13 Nov 2026): a rider may want a type for some other
// platform, so a maker's name never replaces it. The line under it says where the file goes.
export const WORKOUT_FORMAT_LABEL: Record<WorkoutFormat, string> = {
  fit: '.fit (Garmin and most bike computers)',
  zwo: '.zwo (Zwift)',
  mrc: '.mrc (Wahoo, copied to its plans folder; trainer apps)',
  erg: '.erg (trainer apps)',
  text: '.txt (a readable list)',
};
export const WORKOUT_FORMAT_WHAT: Record<WorkoutFormat, string> = {
  fit: 'On a Garmin, copy it into the NewFiles folder over a cable. Most other bike computers, watches and training apps that take workout files read it too. The only one of these that carries heart-rate targets.',
  zwo: 'In Zwift, put it in Documents, Zwift, Workouts, then the folder named with your Zwift number. Many other trainer apps read Zwift files too. Power as a share of your FTP.',
  mrc: 'On a Wahoo ELEMNT, copy it into the plans folder over a cable, then sync planned workouts on the device. Wahoo doesn’t officially support copying files this way, though riders report .mrc working; Send to my devices, through Intervals.icu, is the supported way. Trainer apps read it too. Power as a share of your FTP.',
  erg: 'For trainer apps that take a fixed list of watts. Power in watts, worked out from your FTP today.',
  text: 'The session written out to read on a phone or print: each exercise with sets, reps, load or hold.',
};
export const ACTIVITY_FORMAT_LABEL: Record<ActivityFormat, string> = {
  fit: '.fit (the fullest record)',
  tcx: '.tcx (Training Center)',
  gpx: '.gpx (the route)',
};
export const ACTIVITY_FORMAT_WHAT: Record<ActivityFormat, string> = {
  fit: 'Every second of the activity. Garmin Connect, Strava and most training apps import it.',
  tcx: 'For older apps that don’t read FIT files.',
  gpx: 'The route, with heart rate, cadence and power where recorded. For mapping apps; only for activities with a route.',
};

export interface Offer<F> { format: F; ok: boolean; why?: string }

const RAMP_WHY = 'The Ramp Test is ridden in Antogo’s ride player only: it keeps climbing until you stop, which no workout file can describe.';

/** Whether a session can be downloaded as a workout at all, and if not, why. */
export function workoutExportable(w: Workout): { ok: boolean; why?: string } {
  if (w.kind === 'ride' && w.test === 'ramp') return { ok: false, why: RAMP_WHY };
  if (w.kind === 'other') return { ok: false, why: 'This kind of session has nothing to put in a file.' };
  if (w.kind === 'ride' && !w.blocks.length) return { ok: false, why: 'This ride has no steps yet.' };
  return { ok: true };
}

/** The formats for a session, given the targets chosen for a ride ('power', 'hr' or 'breath'). */
export function workoutOffers(w: Workout, basis: SendBasis = 'power'): Array<Offer<WorkoutFormat>> {
  const can = workoutExportable(w);
  if (!can.ok) return [];
  if (w.kind === 'strength' || w.kind === 'mobility') return [{ format: 'text', ok: true }];
  const powerOnly = (f: WorkoutFormat): Offer<WorkoutFormat> => {
    if (w.kind !== 'ride') return { format: f, ok: false, why: 'Trainer workout files are for rides only.' };
    if (!w.bases.includes('power') && basis !== 'breath') return { format: f, ok: false, why: 'This ride works by heart rate only, and this format holds power only.' };
    if (basis === 'hr') return { format: f, ok: false, why: 'This format holds power only. For heart-rate targets, use the .fit file.' };
    if ((f === 'mrc' || f === 'erg') && hasOpenEffort(w)) return { format: f, ok: false, why: w.family === 'test' ? 'This format needs a set power for every step, and a trainer holding a set wattage would spoil the test’s free effort.' : 'This format needs a set power for every step, and this ride’s all-out sprints have none. The .fit and .zwo files carry them as free steps.' };
    return { format: f, ok: true };
  };
  return [{ format: 'fit', ok: fitWorkoutKind(w) }, powerOnly('zwo'), powerOnly('mrc'), powerOnly('erg')];
}

/** The ride exactly as it should go into a file: the chosen version, shaped for breathing when chosen, and the targets the file holds. */
export function preparedRide(w: Workout, basis: SendBasis, where: Where | undefined, profile: Profile, table: BreathPowerTable): { workout: Workout; targets: 'power' | 'hr' } {
  const shaped = shapedForSend(w, basis, profile, table);
  return { workout: versionFor(shaped.workout, where ?? 'trainer').workout, targets: shaped.targets };
}

export interface FileOut { name: string; data: Uint8Array | string; mime: string }
const MIME: Record<WorkoutFormat, string> = { fit: 'application/octet-stream', zwo: 'application/xml', mrc: 'text/plain', erg: 'text/plain', text: 'text/plain' };
const EXT: Record<WorkoutFormat, string> = { fit: 'fit', zwo: 'zwo', mrc: 'mrc', erg: 'erg', text: 'txt' };

/**
 * One session as a file. `date` goes into the name when the session is on the calendar. The FTP an .erg file is
 * worked out from is the rider's FTP now, and the file says so in its header.
 */
export function workoutFile(w: Workout, format: WorkoutFormat, choice: { basis: SendBasis; where?: Where }, profile: Profile, table: BreathPowerTable, date?: string): FileOut {
  const name = exportFileName(date, w.name, w.kind === 'ride' ? 'ride' : w.kind, EXT[format]);
  if (format === 'text') return { name, data: sessionDocument(w, { date }), mime: MIME.text };
  if (w.kind !== 'ride') return { name, data: encodeFitWorkout(w, 'hr', profile), mime: MIME.fit };
  const { workout, targets } = preparedRide(w, choice.basis, choice.where, profile, table);
  if (format === 'fit') return { name, data: encodeFitWorkout(workout, targets, profile), mime: MIME.fit };
  if (format === 'zwo') return { name, data: encodeZwo(workout), mime: MIME.zwo };
  return { name, data: encodeMrcErg(workout, format, profile.ftp), mime: MIME[format] };
}
