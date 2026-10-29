import { APP_SHORT_NAME } from '../appName';
/**
 * What the app is running on, as far as riding with a trainer is concerned.
 * An iPhone can never reach Bluetooth from a browser, so the player is not
 * offered there at all; an iPad can, in the Bluefy browser; a computer can, in
 * Chrome or Edge. Pure, so it is tested with the strings browsers send.
 */
export type Platform = 'iphone' | 'ipad' | 'android' | 'computer';

export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPod/.test(userAgent)) return 'iphone';
  if (/iPad/.test(userAgent)) return 'ipad';
  // An iPad in Safari (and most iPad browsers) says it is a Mac; a Mac has no touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ipad';
  if (/Android/.test(userAgent)) return 'android';
  return 'computer';
}

export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'computer';
  return platformOf(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
}

/** Whether to offer "Ride indoors on the trainer" here at all. */
export const playerOffered = (): boolean => platform() !== 'iphone';

/** Where a trainer-only workout (the Ramp Test) can be ridden, said on a device that can't run the player. */
export const TRAINER_ONLY_ELSEWHERE = `Ride this on a computer with Chrome, from ${APP_SHORT_NAME}.`;
