import type { Assessment } from './assessment';
import type { Profile } from './types';

/** What the rider wants, with the numbers the planner needs. */
export type Goal =
  | { kind: 'event'; date: string; name: string; eventType: EventType; distanceKm?: number; climbingM?: number; priority: 'A' | 'B' | 'C' }
  | { kind: 'ftp'; weeks: number; targetWatts: number }
  | { kind: 'vo2max'; weeks: number }
  | { kind: 'endurance'; weeks: number; targetHours: number }
  | { kind: 'weight'; weeks: number; targetKg?: number }
  | { kind: 'general'; weeks: number };

export type EventType = 'century' | 'gran-fondo' | 'climbing' | 'time-trial' | 'group-ride' | 'multi-day' | 'other';

export interface Demand {
  /** Hours the goal effort will take, 0 when the goal is not an event. */
  eventHours: number;
  /** Intensity factor the event is ridden at. */
  eventIF: number;
  /** Training stress of the event itself. */
  eventTss: number;
  /** Fitness the goal wants at the start of the taper, 0 when there is no number. */
  requiredCtl: number;
  /** Longest training ride the goal wants before the taper, seconds (0 if none). */
  requiredLongest: number;
  /** Emphasis the goal puts on each quality, 0..1. */
  emphasis: { durability: number; threshold: number; vo2max: number; anaerobic: number; base: number };
  why: string;
}

const EVENT: Record<EventType, { IF: number; kmh: number; ratio: number; emphasis: Demand['emphasis'] }> = {
  // ratio: event TSS over CTL that makes the day hard but doable; above ~4.5 it is a survival exercise
  century:     { IF: 0.70, kmh: 25, ratio: 4.5, emphasis: { durability: 1, threshold: 0.4, vo2max: 0.2, anaerobic: 0.1, base: 1 } },
  'gran-fondo': { IF: 0.78, kmh: 24, ratio: 4.0, emphasis: { durability: 0.9, threshold: 0.8, vo2max: 0.5, anaerobic: 0.2, base: 0.8 } },
  climbing:    { IF: 0.82, kmh: 18, ratio: 4.0, emphasis: { durability: 0.6, threshold: 1, vo2max: 0.6, anaerobic: 0.2, base: 0.6 } },
  'time-trial': { IF: 0.95, kmh: 38, ratio: 3.0, emphasis: { durability: 0.3, threshold: 1, vo2max: 0.5, anaerobic: 0.2, base: 0.5 } },
  'group-ride': { IF: 0.80, kmh: 30, ratio: 3.5, emphasis: { durability: 0.5, threshold: 0.7, vo2max: 0.7, anaerobic: 0.8, base: 0.6 } },
  'multi-day': { IF: 0.68, kmh: 24, ratio: 3.5, emphasis: { durability: 1, threshold: 0.4, vo2max: 0.2, anaerobic: 0.1, base: 1 } },
  other:       { IF: 0.75, kmh: 26, ratio: 4.0, emphasis: { durability: 0.7, threshold: 0.7, vo2max: 0.5, anaerobic: 0.3, base: 0.7 } },
};

/**
 * Turn a goal into demands. For an event, the duration comes from distance,
 * climbing and the rider's own pace on long rides when there is one; the
 * required fitness is the fitness at which the event's stress is a hard day
 * rather than a catastrophe.
 */
export function demand(goal: Goal, profile: Profile, a: Assessment, recentLongRideKmh?: number): Demand {
  if (goal.kind === 'event') {
    const e = EVENT[goal.eventType];
    const kmh = recentLongRideKmh && recentLongRideKmh > 10 ? recentLongRideKmh * 0.92 : e.kmh;
    const km = goal.distanceKm ?? (goal.eventType === 'century' ? 161 : goal.eventType === 'time-trial' ? 40 : 100);
    const climbPenaltyH = (goal.climbingM ?? 0) / 1000 * 0.35;   // roughly 20 minutes per 1,000 m of climbing beyond the flat time
    const eventHours = Math.max(0.5, km / kmh + climbPenaltyH);
    const eventTss = Math.round(eventHours * e.IF * e.IF * 100);
    const requiredCtl = Math.round(Math.max(35, eventTss / e.ratio));
    const requiredLongest = Math.round(Math.min(eventHours * 0.75, 5) * 3600);
    const why = `${goal.name || 'The event'} is about ${hoursText(eventHours)} at an intensity of ${e.IF.toFixed(2)}, roughly ${eventTss} TSS in one day. With fitness around ${requiredCtl} that is a hard day you finish well; much below it, it is a long day of survival. The plan also wants one training ride of about ${hoursText(requiredLongest / 3600)} before the taper.`;
    return { eventHours, eventIF: e.IF, eventTss, requiredCtl, requiredLongest, emphasis: e.emphasis, why };
  }
  const ctl = a.fitness.ctl;
  switch (goal.kind) {
    case 'ftp': {
      const gain = goal.targetWatts / Math.max(1, profile.ftp) - 1;
      const requiredCtl = Math.round(Math.max(45, ctl + Math.max(5, gain * 100)));
      return { eventHours: 0, eventIF: 0, eventTss: 0, requiredCtl, requiredLongest: 0, emphasis: { durability: 0.3, threshold: 1, vo2max: 0.6, anaerobic: 0.2, base: 0.6 },
        why: `Raising FTP from ${profile.ftp} to ${goal.targetWatts} W (${Math.round(gain * 100)}%) is mostly threshold and sweet-spot work on a base that can absorb it. A gain like that usually needs fitness to rise to about ${requiredCtl}.` };
    }
    case 'vo2max':
      return { eventHours: 0, eventIF: 0, eventTss: 0, requiredCtl: Math.round(Math.max(40, ctl + 6)), requiredLongest: 0, emphasis: { durability: 0.3, threshold: 0.5, vo2max: 1, anaerobic: 0.4, base: 0.5 },
        why: 'VO2max responds to short, very hard intervals, but only on a rider fresh enough to hit them, so the plan keeps volume moderate and protects the hard days.' };
    case 'endurance':
      return { eventHours: goal.targetHours, eventIF: 0.68, eventTss: Math.round(goal.targetHours * 0.68 * 0.68 * 100), requiredCtl: Math.round(Math.max(40, goal.targetHours * 11)), requiredLongest: Math.round(goal.targetHours * 0.8 * 3600), emphasis: { durability: 1, threshold: 0.4, vo2max: 0.1, anaerobic: 0, base: 1 },
        why: `Riding ${hoursText(goal.targetHours)} comfortably is about durability: long rides that grow steadily, fuelling, and a little tempo so the pace feels easy.` };
    case 'weight':
      return { eventHours: 0, eventIF: 0, eventTss: 0, requiredCtl: 0, requiredLongest: 0, emphasis: { durability: 0.7, threshold: 0.3, vo2max: 0.1, anaerobic: 0, base: 1 },
        why: 'Weight comes off through consistent hours, mostly easy, which burn energy without the appetite surge hard riding brings. The plan keeps one quality session a week so fitness still rises.' };
    default:
      return { eventHours: 0, eventIF: 0, eventTss: 0, requiredCtl: 0, requiredLongest: 0, emphasis: { durability: 0.6, threshold: 0.6, vo2max: 0.5, anaerobic: 0.3, base: 0.7 },
        why: 'General fitness has no finish line. The plan alternates base and build blocks with recovery weeks and keeps the whole range of intensities in play.' };
  }
}

export function hoursText(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return hh ? `${hh}h${mm ? String(mm).padStart(2, '0') : ''}` : `${mm} min`;
}
