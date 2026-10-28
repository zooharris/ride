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
    if (hr) return { says: "This workout's short efforts need power. Connect your trainer or power meter." };
    return { says: 'Connect a heart-rate monitor or a power source to ride this workout.' };
  }
  if (hr && control) return { mode: 'hr-trainer', says: 'Ready. The trainer will adjust its resistance to keep you in each heart-rate zone.' };
  if (hr) return { mode: 'hr-self', says: "Ready. You'll ride to the heart-rate zones with your gears." };
  if (power) return { says: 'This ride is by heart rate: connect a heart-rate strap, or your watch broadcasting heart rate.' };
  return { says: 'Connect a heart-rate monitor or a power source to ride this workout.' };
}
