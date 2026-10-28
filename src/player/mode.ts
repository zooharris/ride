/**
 * How a ride will be played, from the workout's basis and what is connected
 * (spec §5.1). Pure, so the table is tested.
 */
import type { Basis } from '../engine/types';
import type { Metric, SensorSnapshot, Supplied } from './sources';

export type RideMode = 'erg' | 'power-self' | 'hr-trainer' | 'hr-self';

export interface ModeChoice {
  mode?: RideMode;
  /** One sentence for the screen: what will happen, or what is missing. */
  says: string;
  /** Power basis with no power but heart rate present, on a workout that allows heart rate: offer the switch. */
  suggestHr?: boolean;
  /** A power-only workout with no power connected: it cannot start; offer workouts that can be ridden by heart rate. */
  needsPower?: boolean;
}

export function chooseMode(
  basis: Basis,
  sensors: (SensorSnapshot & { controllable?: boolean })[],
  sources: Partial<Record<Metric, Supplied>>,
  allowsHr: boolean,
): ModeChoice {
  const control = sensors.some((s) => s.kind === 'trainer' && s.status === 'connected' && s.controllable);
  const power = sources.watts != null;
  const hr = sources.bpm != null;
  if (basis === 'power') {
    if (power && control) return { mode: 'erg', says: 'Ready. The trainer will hold each power target for you (ERG).' };
    if (power) return { mode: 'power-self', says: "Ready. You'll ride to the power targets yourself: the trainer can't be controlled from here." };
    if (hr && allowsHr) return { says: 'No power source yet. Connect your trainer or power meter, or switch this ride to heart rate.', suggestHr: true };
    if (!allowsHr) return { says: 'This workout needs a power meter, or a smart trainer that measures power. Connect one to start.', needsPower: true };
    return { says: 'Connect a heart-rate monitor or a power source to ride this workout.' };
  }
  if (hr && control) return { mode: 'hr-trainer', says: 'Ready. The trainer will adjust its resistance to keep you in each heart-rate zone.' };
  if (hr) return { mode: 'hr-self', says: "Ready. You'll ride to the heart-rate zones with your gears." };
  if (power) return { says: 'This ride is by heart rate: connect a heart-rate strap, or your watch broadcasting heart rate.' };
  return { says: 'Connect a heart-rate monitor or a power source to ride this workout.' };
}

/**
 * A free ride (no workout): it can start with any number to record, power,
 * heart rate or speed. With a trainer in control the rider chooses a set
 * resistance, watts to hold, or a flat road.
 */
export function chooseFreeMode(sensors: (SensorSnapshot & { controllable?: boolean })[], sources: Partial<Record<Metric, Supplied>>): { ready: boolean; control: boolean; says: string } {
  const control = sensors.some((s) => s.kind === 'trainer' && s.status === 'connected' && s.controllable);
  const ready = sources.watts != null || sources.bpm != null || sources.speedKmh != null;
  if (!ready) return { ready, control, says: 'Connect your trainer, a power meter or a heart-rate monitor: anything that gives the ride a number to record.' };
  return { ready, control, says: control ? 'Ready. Choose how the trainer feels; you can change it as you ride.' : "Ready. You'll ride with your gears; the ride records what your sensors send." };
}
