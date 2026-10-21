import { describe, expect, it } from 'vitest';
import { durationFor, intensityFraction, sessionSteps, sportOf } from './intervals';
import { readyMadeSessions } from '../library/sessions';
import type { Ride } from '../engine/types';

describe('activity types from Intervals.icu', () => {
  it('maps rides, walks, strength and mobility', () => {
    expect(sportOf('Ride')).toBe('ride');
    expect(sportOf('VirtualRide')).toBe('ride');
    expect(sportOf('Walk')).toBe('walk');
    expect(sportOf('Hike')).toBe('walk');
    expect(sportOf('WeightTraining')).toBe('strength');
    expect(sportOf('Yoga')).toBe('mobility');
  });
  it('treats a slow treadmill "run" as a walk, a real run as other', () => {
    expect(sportOf('Run', 1.5)).toBe('walk');          // 5.4 km/h
    expect(sportOf('VirtualRun', 1.7)).toBe('walk');
    expect(sportOf('Run', 3.0)).toBe('other');          // 10.8 km/h
    expect(sportOf('Run')).toBe('other');               // no speed known
  });
});

describe('the duration the app counts', () => {
  it('a treadmill walk the watch thought was half standing still counts its whole time', () => {
    expect(durationFor('walk', 985, 1839)).toBe(1839);
    expect(durationFor('strength', 600, 2400)).toBe(2400);
    expect(durationFor('mobility', undefined, 900)).toBe(900);
  });
  it('a ride counts moving time, stops excluded', () => {
    expect(durationFor('ride', 3600, 4200)).toBe(3600);
    expect(durationFor('ride', undefined, 4200)).toBe(4200);
  });
});

describe('strength and mobility as Garmin steps', () => {
  const all = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'treadmill']);
  it('sets end on a lap press, rests and holds are timed, ranges are written with "to"', () => {
    const w = all.find((x) => x.kind === 'strength' && /Foundation A/.test(x.name))!;
    const lines = sessionSteps(w);
    expect(lines.some((l) => /^- Press lap Goblet squat 10 to 12 reps 50s$/.test(l))).toBe(true);
    // Step text carries no symbols and no bare ranges, which Intervals.icu could read as targets; numerals are fine.
    for (const l of lines.filter((x) => /^- /.test(x))) expect(l.replace(/ \S+$/, '')).toMatch(/^- [A-Za-z0-9 ]+$/);
    expect(lines).toContain('- Rest 1m30s');
    expect(lines).toContain('3x');
    expect(lines.some((l) => /\d+[-–]\d+/.test(l))).toBe(false);
    expect(lines.some((l) => /^- (Plank|Dead bug) \d+s$/.test(l))).toBe(true);
    // Repeat blocks are separated by a blank line.
    const idx = lines.indexOf('3x');
    expect(lines[idx - 1] ?? '').toBe('');
  });
  it('stretches are timed per side with no rests and no lap presses', () => {
    const w = all.find((x) => x.kind === 'mobility' && /after the long ride/.test(x.name))!;
    const lines = sessionSteps(w);
    expect(lines.every((l) => !/Press lap|Rest/.test(l))).toBe(true);
    expect(lines.some((l) => / left side \d+s$| left side \dm$/.test(l))).toBe(true);
  });
});

describe('garminText', () => {
  it('keeps numerals, writes ranges with "to", and strips symbols', async () => {
    const { garminText } = await import('./intervals');
    expect(garminText('Goblet squat')).toBe('Goblet squat');
    expect(garminText('10–12')).toBe('10 to 12');
    expect(garminText('8 per side')).toBe('8 per side');
    expect(garminText('35 lb, or 2 reps in reserve')).toBe('35 lb or 2 reps in reserve');
    expect(garminText('3 × 12.5 kg')).toBe('3 13 kg');
    expect(garminText('Half-kneeling hip flexor stretch')).toBe('Half kneeling hip flexor stretch');
    expect(garminText('3 x 10')).toBe('3 10');
  });
});

describe('pairing recordings to planned sessions', () => {
  it('pairs a strength session recorded as a ride by name, leaving the real ride for the planned ride', async () => {
    const { pairRecordings } = await import('./syncService');
    const { SESSION_EVENT_TYPE } = await import('./intervals');
    expect(SESSION_EVENT_TYPE).toBe('Ride');          // the interim: step text only travels for rides
    const w = {
      ride: { name: 'Oatlands', subtitle: 'Endurance 2h', kind: 'ride' as const },
      lift: { name: 'Full body express', kind: 'strength' as const },
    };
    const planned = [
      { id: 'pr', date: '2026-10-20', workoutId: 'ride', basis: 'power' as const, status: 'sent' as const },
      { id: 'ps', date: '2026-10-20', workoutId: 'lift', basis: 'power' as const, status: 'sent' as const },
    ];
    const ride = (id: string, name: string, type: string) => ({ id, name, type, date: '2026-10-20', startTime: '', sport: 'ride' as const, seconds: 1800 } as unknown as Ride);
    // the strength session comes back first in the list, filed as a ride, named after the workout
    const rides = [ride('a', 'Full body express', 'Ride'), ride('b', 'Oatlands · Endurance 2h', 'Ride')];
    const m = pairRecordings(planned, rides, (id) => w[id as keyof typeof w]);
    expect(m.get('ps')?.id).toBe('a');
    expect(m.get('pr')?.id).toBe('b');
  });
  it('falls back to day and kind when the watch gave the recording another name', async () => {
    const { pairRecordings } = await import('./syncService');
    const planned = [{ id: 'ps', date: '2026-10-21', workoutId: 'lift', basis: 'power' as const, status: 'sent' as const }];
    const rides = [{ id: 'x', name: 'Herndon Strength', type: 'WeightTraining', date: '2026-10-21', sport: 'strength', seconds: 1500 } as unknown as Ride];
    const m = pairRecordings(planned, rides, () => ({ name: 'Full body express', kind: 'strength' }));
    expect(m.get('ps')?.id).toBe('x');
  });
  it('does not take an accidental 25-second recording for a 40-minute session', async () => {
    const { pairRecordings } = await import('./syncService');
    const planned = [{ id: 'ps', date: '2026-10-20', workoutId: 'lift', basis: 'power' as const, status: 'sent' as const, icuEventId: 41 }];
    const blip = { id: 'c', name: 'Cardio', type: 'Workout', date: '2026-10-20', sport: 'strength', seconds: 25, elapsedSeconds: 25, pairedEventId: 41 } as unknown as Ride;
    const m = pairRecordings(planned, [blip], () => ({ name: 'Strength A: legs and trunk', kind: 'strength', minutes: 40 }));
    expect(m.size).toBe(0);
  });
  it('still counts a ride cut short (35 minutes of two hours) as the planned ride', async () => {
    const { pairRecordings } = await import('./syncService');
    const planned = [{ id: 'pr', date: '2026-10-20', workoutId: 'r', basis: 'power' as const, status: 'sent' as const }];
    const short = { id: 'r1', name: 'Morning ride', type: 'Ride', date: '2026-10-20', sport: 'ride', seconds: 2100 } as unknown as Ride;
    const m = pairRecordings(planned, [short], () => ({ name: 'Leesburg', kind: 'ride', minutes: 120 }));
    expect(m.get('pr')?.id).toBe('r1');
  });
  it('never re-pairs a recording the rider said was not the session, and takes a later one instead', async () => {
    const { pairRecordings } = await import('./syncService');
    const planned = [{ id: 'ps', date: '2026-10-20', workoutId: 'lift', basis: 'power' as const, status: 'sent' as const, icuEventId: 7, notActivityIds: ['extra'] }];
    const rec = (id: string, seconds: number) => ({ id, name: 'Strength', type: 'WeightTraining', date: '2026-10-20', sport: 'strength', seconds, pairedEventId: 7 } as unknown as Ride);
    const fn = () => ({ name: 'Strength A: legs and trunk', kind: 'strength' as const, minutes: 40 });
    expect(pairRecordings(planned, [rec('extra', 1800)], fn).size).toBe(0);
    expect(pairRecordings(planned, [rec('extra', 1800), rec('later', 2400)], fn).get('ps')?.id).toBe('later');
  });
});

describe('intensity factor from Intervals.icu', () => {
  it('reads the percent Intervals.icu sends as a fraction', () => {
    expect(intensityFraction(84.23424)).toBe(0.84);
    expect(intensityFraction(58.6)).toBe(0.59);
  });
  it('accepts a fraction if one ever arrives, falls back to NP over the FTP of the day, and is unknown without power', () => {
    expect(intensityFraction(0.84)).toBe(0.84);
    expect(intensityFraction(undefined, 180, 222)).toBe(0.81);
    expect(intensityFraction(undefined, undefined, 222)).toBeUndefined();
    expect(intensityFraction(0)).toBeUndefined();
  });
});
