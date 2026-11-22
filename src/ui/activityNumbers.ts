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
export function activityNumbers(r: Ride, profile: Profile, tempF?: string, effort?: number, test?: boolean): Array<[string, string | number | undefined, string?]> {
  const hr: Array<[string, string | number | undefined, string?]> = [
    ['Average heart rate', r.averageHr ? `${Math.round(r.averageHr)} bpm` : undefined, `Over the whole ${KIND_NOUN[r.sport]}`],
    ['Max heart rate', r.maxHr ? `${Math.round(r.maxHr)} bpm` : undefined],
  ];
  // More per activity (11 Nov 2026): each shows only when the data service carried it for this activity.
  const imperial = miles(profile);
  const temp = (c?: number) => (c == null ? undefined : fahrenheit(profile) ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`);
  const speed = (ms?: number) => (ms ? (imperial ? `${(ms * 2.23694).toFixed(1)} mph` : `${(ms * 3.6).toFixed(1)} km/h`) : undefined);
  const energy: Array<[string, string | number | undefined, string?]> = [
    ['Energy burned', r.calories ? `${Math.round(r.calories).toLocaleString()} kcal` : undefined, 'As your device or Intervals.icu worked it out'],
    ['Carbohydrate used', r.carbsUsedG ? `${Math.round(r.carbsUsedG)} g` : undefined, 'An estimate from your power and FTP: what a long ride takes out of you'],
  ];
  const weather: Array<[string, string | number | undefined, string?]> = [
    ['Weather', r.weatherTempC != null ? `${temp(r.weatherTempC)}${r.feelsLikeC != null && Math.abs(r.feelsLikeC - r.weatherTempC) >= 2 ? `, felt like ${temp(r.feelsLikeC)}` : ''}` : undefined, 'The air temperature along the route, from the weather record (your device\'s own reading is "Average temperature")'],
    ['Wind', r.windMs ? `${speed(r.windMs)}${r.headwindPct != null && r.headwindPct > 0 ? `, ${Math.round(r.headwindPct)}% of the ride into it` : ''}` : undefined, 'Average wind speed along the route, and how much of the ride faced it'],
  ];
  const tail: Array<[string, string | number | undefined, string?]> = [
    ['Effort you rated', r.rpe ? `${Math.round(r.rpe)} of 10` : undefined, 'The effort you gave this in Intervals.icu'],
    ['Recorded on', r.device],
  ];
  if (r.sport === 'ride') return [
    ['Moving time', clock(r.seconds), 'Time pedalling, stops excluded'],
    ['Elapsed time', r.elapsedSeconds && r.elapsedSeconds - r.seconds >= 60 ? clock(r.elapsedSeconds) : undefined, 'Start to finish, stops included'],
    ['Distance', distance(r.distanceM, profile)],
    ['Total climbing', elevation(r.elevationM, profile)],
    ['Training load (TSS)', r.tss, r.notTraining === 'drive' ? 'Counts 0: at this speed with no power it was not a ride (a car, a train, a watch left recording).' : r.notTraining === 'trivial' ? 'Counts 0: under five minutes is not training. If it was a planned session, match it by hand below.' : r.tssBasis === 'estimate' ? 'An estimate from the time alone (no power and no heart rate were recorded), at the cost of easy endurance riding, about 45 an hour' : r.tssBasis === 'heart-rate' ? 'How much the ride cost you, from average heart rate against your threshold heart rate (no power was recorded). An hour flat out at threshold is 100' : GLOSSARY.tss.short],
    ['Normalized power', r.normalizedPower ? `${r.normalizedPower} W` : undefined, GLOSSARY.np.short],
    ['Average power', r.averagePower ? `${r.averagePower} W` : undefined, 'Plain average over the whole ride, coasting included'],
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
    ['FTP used for this ride', r.ftpAtRide ? `${r.ftpAtRide} W` : undefined, 'The FTP on record the day you rode; TSS and intensity are relative to it'],
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

