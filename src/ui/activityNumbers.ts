import type { Profile, Ride } from '../engine/types';
import { clock } from '../engine/workout';
import { fahrenheit, miles } from '../engine/units';
import { distance, elevation } from './derived';
import { GLOSSARY } from './glossary';

/** One number on an activity's page: its label, its value, and the sentence that explains it. */
export type NumberRow = [string, string | number | undefined, string?];

export const KIND_NOUN: Record<Ride['sport'], string> = { ride: 'ride', walk: 'walk', run: 'run', strength: 'session', mobility: 'session', other: 'activity' };

/** Recorded indoors: a trainer ride, a treadmill walk or run. */
export function isIndoor(r: Ride): boolean { return /Virtual|Treadmill|Indoor/i.test(r.type); }
/** Pace means something over half a mile outdoors; a treadmill's GPS distance, or a few hundred metres, it does not. */
export function showPace(r: Ride): boolean { return (r.distanceM ?? 0) >= 805 && !isIndoor(r); }

/** Pace for a walk or run, as minutes per mile or kilometre. */
export function pace(speedMs: number | undefined, profile: Parameters<typeof miles>[0]): string | undefined {
  if (!speedMs || speedMs <= 0) return undefined;
  const secs = Math.round((miles(profile) ? 1609.344 : 1000) / speedMs);
  return `${clock(secs)} per ${miles(profile) ? 'mile' : 'km'}`;
}

/**
 * The numbers worth showing for the kind of activity it was. A ride gets
 * power, cadence and intensity; a walk gets distance, pace and heart rate; a
 * strength or mobility session gets its time, load and heart rate. Nothing
 * that only means something on a bike is shown for anything else.
 */
export function activityNumbers(r: Ride, profile: Profile, tempF?: string, effort?: number, test?: boolean, says: { ftp?: string; lthr?: string; edit?: { noPower?: boolean; noHr?: boolean; trim?: unknown } } = {}): Array<[string, string | number | undefined, string?]> {
  // A measure the rider left out (22 Nov 2026): its numbers are hidden, with a line saying why.
  const leftOut: Array<[string, string | number | undefined, string?]> = [
    ['Power', says.edit?.noPower ? 'Left out by you' : undefined, 'You left this ride’s power out, under Correct this activity. Its power numbers are hidden, it is scored from heart rate, and it is kept out of your power curve and records. Take the correction away and they come back.'],
    ['Heart rate', says.edit?.noHr ? 'Left out by you' : undefined, 'You left this activity’s heart rate out, under Correct this activity. Its heart-rate numbers are hidden and it is kept out of your heart-rate records. Take the correction away and they come back.'],
  ];
  const lthrUsed: [string, string | number | undefined, string?] = ['Threshold heart rate used', r.averageHr && (says.lthr || r.lthrAtRide) ? says.lthr ?? `${r.lthrAtRide} bpm` : undefined, 'Heart-rate zones and heart-rate load are measured against the threshold heart rate in force on the activity’s day, from your threshold heart-rate history in Settings. To change it for this activity alone, use Correct this activity.'];
  const hr: Array<[string, string | number | undefined, string?]> = [
    ['Average heart rate', r.averageHr ? `${Math.round(r.averageHr)} bpm` : undefined, `Over the whole ${KIND_NOUN[r.sport]}`],
    ['Max heart rate', r.maxHr ? `${Math.round(r.maxHr)} bpm` : undefined],
    lthrUsed,
    leftOut[1],
  ];
  // More per activity (11 Nov 2026): each shows only when the data service carried it for this activity.
  const imperial = miles(profile);
  const temp = (c?: number) => (c == null ? undefined : fahrenheit(profile) ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`);
  const speed = (ms?: number) => (ms ? (imperial ? `${(ms * 2.23694).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`) : undefined);
  const energy: Array<[string, string | number | undefined, string?]> = [
    ['Energy burned', r.calories ? `${Math.round(r.calories).toLocaleString()} kcal` : undefined, 'As your device worked it out; from the work done at the pedals when it gave no figure'],
    ['Carbohydrate used', r.carbsUsedG ? `${Math.round(r.carbsUsedG)} g` : undefined, r.carbsEstimated ? "Antogo's estimate, from the work done and how hard it was: what a long ride takes out of you" : 'An estimate from your power and FTP: what a long ride takes out of you'],
  ];
  const weather: Array<[string, string | number | undefined, string?]> = [
    ['Weather', r.weatherTempC != null ? `${temp(r.weatherTempC)}${r.feelsLikeC != null && Math.abs(r.feelsLikeC - r.weatherTempC) >= 2 ? `, felt like ${temp(r.feelsLikeC)}` : ''}` : undefined, 'The air temperature along the route, from the weather record (your device\'s own reading is "Average temperature")'],
    ['Wind', r.windMs ? `${speed(r.windMs)}${r.headwindPct != null && r.headwindPct > 0 ? `, ${Math.round(r.headwindPct)}% of the ride into it` : ''}` : undefined, 'Average wind speed along the route, and how much of the ride faced it'],
  ];
  const tail: Array<[string, string | number | undefined, string?]> = [
    ['Effort you rated', r.rpe ? `${Math.round(r.rpe)} of 10` : undefined, 'The effort you gave this in Intervals.icu'],
    ['Recorded on', r.device],
    // Stage 1 (22 Nov 2026): where the numbers came from, in one line.
    ['Numbers', r.ownNumbers ? 'Worked out by Antogo' : r.source === 'file' ? 'From the file’s summary' : 'From Intervals.icu', r.ownNumbers ? 'Antogo worked these out from the recording itself. They can differ a little from other apps’ figures for the same activity.' : r.source === 'file' ? 'The file had no second-by-second recording to work from, so these are the totals it carried.' : 'Antogo hasn’t worked these out from the recording yet (it does once the activity’s original file is kept on this device), so they are Intervals.icu’s.'],
  ];
  if (r.sport === 'ride') return [
    ['Moving time', clock(r.seconds), says.edit?.trim ? 'Time pedalling in the part you kept, stops excluded' : 'Time pedalling, stops excluded'],
    ['Elapsed time', r.elapsedSeconds && r.elapsedSeconds - r.seconds >= 60 ? clock(r.elapsedSeconds) : undefined, 'Start to finish, stops included'],
    ['Distance', distance(r.distanceM, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, r.notTraining === 'drive' ? 'Counts 0: at this speed with no power it was not a ride (a car, a train, a watch left recording).' : r.notTraining === 'trivial' ? 'Counts 0: under five minutes is not training. If it was a planned session, match it by hand below.' : r.tssBasis === 'estimate' ? 'An estimate from the time alone (no power and no heart rate were recorded), at the cost of easy endurance riding, about 45 an hour' : r.tssBasis === 'heart-rate' ? 'How much the ride cost you, from average heart rate against your threshold heart rate (' + (says.edit?.noPower ? 'you left its power out' : r.powerCoverage != null && r.powerCoverage < 0.8 ? 'the power meter recorded only part of the ride' : 'no power was recorded') + '). An hour flat out at threshold is 100' : GLOSSARY.tss.short],
    leftOut[0],
    ['Normalized power', r.normalizedPower ? `${r.normalizedPower} W` : undefined, GLOSSARY.np.short],
    ['Average power', r.averagePower ? `${r.averagePower} W` : undefined, 'Plain average over the whole ride, coasting included'],
    ['Power recorded for', r.powerCoverage != null && r.powerCoverage < 0.95 ? `${Math.round(r.powerCoverage * 100)}% of the ride` : undefined, r.powerCoverage != null && r.powerCoverage < 0.8 ? 'The power meter gave no reading for the rest. The power numbers describe only the part it recorded, so this ride’s training load is from heart rate.' : 'The power meter gave no reading for the rest. The power numbers describe the part it recorded.'],
    ['Intensity', r.intensityFactor?.toFixed(2), GLOSSARY.intensity.short],
    ['Steadiness', r.variabilityIndex ? r.variabilityIndex.toFixed(2) : undefined, 'Normalized power divided by average power. 1.00 is perfectly even; 1.05 or less is a steady ride; a hilly or stop-start ride runs higher'],
    ['Work done', r.workKj ? `${Math.round(r.workKj).toLocaleString()} kJ` : undefined, 'The energy you put through the pedals'],
    ['Work above FTP', r.workAboveFtpKj ? `${Math.round(r.workAboveFtpKj)} kJ` : undefined, 'The part of the work done harder than your FTP: what the hard efforts added up to'],
    ['Deepest into your reserve', r.reserveUsedKj ? `${r.reserveUsedKj.toFixed(1)} kJ` : undefined, 'The most your reserve above FTP was drawn down at any moment; it refills when you ease off'],
    ...hr,
    ['Average cadence', r.averageCadence ? `${Math.round(r.averageCadence)} rpm` : undefined, 'Over the whole ride, while pedalling'],
    ['Time coasting', r.coastingSeconds && r.coastingSeconds >= 60 ? clock(r.coastingSeconds) : undefined, 'Time moving without pedalling'],
    ['Top speed', speed(r.maxSpeedMs)],
    ['Total descent', r.elevationLossM ? elevation(r.elevationLossM, profile) : undefined],
    ['Efficiency factor', r.efficiencyFactor?.toFixed(2), GLOSSARY.ef.short],
    // Part A9: drift means something on steady riding only; on a test (a ramp above all) it is noise.
    ['Heart-rate drift', r.decoupling != null && !test ? `${r.decoupling.toFixed(1)}%` : undefined, GLOSSARY.drift.short],
    ['Average temperature', tempF],
    ...weather,
    ...energy,
    ['FTP used for this ride', r.ftpAtRide && (r.normalizedPower || r.averagePower) ? says.ftp ?? `${r.ftpAtRide} W` : undefined, `Training load, intensity and time in power zones are measured against it. Settings, Thresholds and zones has the rule (your FTP history, or the FTP your device had set that day) and the history itself. To change it for this ride alone, use Correct this activity${r.ftpDevice && r.ftpDevice !== r.ftpAtRide ? `. This ride's own file says your device had ${r.ftpDevice} W set` : ''}`],
    ...tail,
  ];
  if (r.sport === 'walk') return [
    ['Time', clock(r.seconds), 'Start to finish. A watch on a still arm (a treadmill, a phone in hand) can think you stopped, so its "moving time" is not used for walks'],
    ['Moving time, as the watch judged it', r.movingSeconds && r.seconds - r.movingSeconds >= 120 ? clock(r.movingSeconds) : undefined, 'Shown only when it differs; not used for anything'],
    ['Distance', distance(r.distanceM, profile)],
    ['Average pace', showPace(r) ? pace(r.averageSpeedMs, profile) : undefined],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much the walk cost you, from heart rate and time. An hour flat out at threshold is 100; an easy walk is a small fraction of that'],
    ...hr,
    ['Average temperature', tempF],
    ...weather,
    ...energy.slice(0, 1),
    ...tail,
  ];
  if (r.sport === 'run') return [
    ['Time', clock(r.seconds), 'Moving time: stops at lights and crossings are left out, as on a ride'],
    ['Distance', distance(r.distanceM, profile)],
    ['Average pace', showPace(r) ? pace(r.averageSpeedMs, profile) : undefined, 'Moving time over distance'],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, r.tssBasis === 'heart-rate' ? 'From heart rate and time, the same way an HR-only ride is scored' : r.tssBasis === 'intervals' ? 'Intervals.icu\'s own load for the run (no heart rate recorded)' : 'Estimated at 55 an hour: no heart rate or load came with the recording'],
    ...hr,
    ['Average temperature', tempF],
    ...weather,
    ...energy.slice(0, 1),
    ...tail,
  ];
  if (r.sport === 'strength' || r.sport === 'mobility') return [
    ['Time', clock(r.seconds), 'From start to finish of the recording, rests included'],
    ['Training load (TSS)', r.tss, r.uncountedTss != null ? `Left out of training load at your request; it would be ${r.uncountedTss}.` : r.sport === 'strength' && effort ? `From your effort rating (${effort}/10) and the time: heart rate under-reads lifting, so your rating sets the load.` : r.sport === 'strength' ? 'How much the session cost you, estimated from heart rate and time. Lifting loads the muscles more than the heart shows, so treat this as a floor' : 'How much the session cost you, from heart rate and time; mobility is meant to cost very little'],
    ...hr,
    ...energy.slice(0, 1),
    ...tail,
  ];
  return [
    ['Time', clock(r.seconds)],
    ['Distance', distance(r.distanceM, profile)],
    ['Average pace', showPace(r) ? pace(r.averageSpeedMs, profile) : undefined],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, 'How much it cost you, from heart rate and time'],
    ...hr,
    ['Average temperature', tempF],
  ];
}

