import { describe, expect, it } from 'vitest';
import { garminSendable } from './workout';
import { libraryById, LIBRARY } from '../library/workouts';
import { rampFirstStep } from '../player/timeline';
import { sendWorkout } from '../sync/intervals';

describe('trainer-only workouts (Step 1, A2)', () => {
  const ramp = LIBRARY.find((w) => w.id === 'lib-ramp')!;
  it('the Ramp Test is trainer-only and a ramp test; the 20-minute test is neither trainer-only nor a ramp', () => {
    expect(ramp.trainerOnly).toBe(true);
    expect(ramp.test).toBe('ramp');
    const t20 = LIBRARY.find((w) => w.id === 'lib-20min')!;
    expect(t20.trainerOnly).toBeFalsy();
    expect(t20.test).toBe('20min');
  });
  it('is never counted or sent to the Garmin; every other kind is', () => {
    expect(garminSendable(ramp)).toBe(false);
    expect(garminSendable(LIBRARY.find((w) => w.id === 'lib-20min'))).toBe(true);
    for (const kind of ['ride', 'walk', 'run', 'strength', 'mobility'] as const) expect(garminSendable({ kind })).toBe(true);
    expect(garminSendable(undefined)).toBe(false);
  });
  it('the sender refuses it outright, before calling Intervals.icu', async () => {
    await expect(sendWorkout({ athleteId: 'x', apiKey: 'y' }, ramp, '2026-10-30', 'power')).rejects.toThrow(/trainer/);
  });
  it('is found in the library by id', () => { expect(libraryById('lib-ramp')?.trainerOnly).toBe(true); });
});

describe('the ramp’s first step (A4)', () => {
  it('is 46% of FTP plus one step', () => {
    expect(rampFirstStep(225, 20)).toBe(124);
    expect(rampFirstStep(200, 10)).toBe(102);
  });
  it('is a fixed 100 W with no FTP', () => { expect(rampFirstStep(0, 20)).toBe(100); });
});
