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

export const WORKOUT_FORMAT_LABEL: Record<WorkoutFormat, string> = {
  fit: 'Garmin workout file (.fit)',
  zwo: 'Zwift workout (.zwo)',
  mrc: 'Trainer workout, shares of FTP (.mrc)',
  erg: 'Trainer workout, watts (.erg)',
  text: 'Readable list (.txt)',
};
export const WORKOUT_FORMAT_WHAT: Record<WorkoutFormat, string> = {
  fit: 'For Garmin and most bike computers and watches. The only one of these that carries heart-rate targets.',
  zwo: 'For Zwift, and many other trainer apps that read Zwift files. Power as a share of your FTP.',
  mrc: 'For older trainer apps. Power as a share of your FTP.',
  erg: 'For older trainer apps. Power in watts, worked out from your FTP today.',
  text: 'The session written out to read on a phone or print: each exercise with sets, reps, load or hold.',
};
export const ACTIVITY_FORMAT_LABEL: Record<ActivityFormat, string> = {
  fit: 'Garmin activity file (.fit)',
  tcx: 'Training Center (.tcx)',
  gpx: 'GPS route (.gpx)',
};
export const ACTIVITY_FORMAT_WHAT: Record<ActivityFormat, string> = {
  fit: 'The fullest record, every second, and what Garmin Connect, Strava and most training apps import.',
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
    if (basis === 'hr') return { format: f, ok: false, why: 'This format holds power only. For heart-rate targets, use the Garmin workout file.' };
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
