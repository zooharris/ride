import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { LIBRARY } from '../library/workouts';
import { allWorkouts, alreadyText, scheduleWorkout } from '../ui/store';
import { replacePlanned } from '../ui/planService';
import { dayPossessive } from '../ui/derived';
import { addDays, today } from '../engine/load';

(globalThis as { navigator?: unknown }).navigator ??= { userAgent: 'test' };

const ride = LIBRARY.find((w) => w.kind === 'ride')!;
const other = LIBRARY.find((w) => w.kind === 'ride' && w.id !== ride.id)!;
const strength = allWorkouts([]).find((w) => w.kind === 'strength' && w.source === 'library')!;
const d = today();
const onDay = async (date: string) => db.planned.where('date').equals(date).toArray();

beforeEach(async () => { await db.delete(); await db.open(); });

describe('the same workout cannot go on a day twice', () => {
  it('a ride twice on one day: the second is refused, one entry', async () => {
    expect(await scheduleWorkout(ride, d, 'power')).toBe('added');
    expect(await scheduleWorkout(ride, d, 'power')).toBe('already');
    expect(await onDay(d)).toHaveLength(1);
  });
  it('a different ride on the same day is fine', async () => {
    await scheduleWorkout(ride, d, 'power');
    expect(await scheduleWorkout(other, d, 'power')).toBe('added');
    expect(await onDay(d)).toHaveLength(2);
  });
  it('the same ride on two days is fine', async () => {
    expect(await scheduleWorkout(ride, d, 'power')).toBe('added');
    expect(await scheduleWorkout(ride, addDays(d, 1), 'power')).toBe('added');
  });
  it('a library strength session, stored as a copy, is matched by name and kind', async () => {
    expect(await scheduleWorkout(strength, d, 'power')).toBe('added');
    expect(await scheduleWorkout(strength, d, 'power')).toBe('already');
    expect(await onDay(d)).toHaveLength(1);
  });
  it('once the first is done, it can be added again', async () => {
    await scheduleWorkout(ride, d, 'power');
    const [p] = await onDay(d);
    await db.planned.put({ ...p, status: 'completed' });
    expect(await scheduleWorkout(ride, d, 'power')).toBe('added');
  });
  it('replacing with a workout that is already another entry on the day is refused', async () => {
    await scheduleWorkout(ride, d, 'power');
    await scheduleWorkout(other, d, 'power');
    const second = (await onDay(d)).find((p) => p.workoutId === other.id)!;
    expect(await replacePlanned(second, ride, 'power')).toBe('already');
    expect((await db.planned.get(second.id))?.workoutId).toBe(other.id);
    // replacing an entry with itself is not a duplicate of another entry
    expect(await replacePlanned(second, other, 'power')).toBe('replaced');
  });
  it('says so in words', () => {
    expect(alreadyText('Hunter Mill', d)).toBe("Hunter Mill is already on today's calendar.");
    expect(dayPossessive(addDays(d, 1), d)).toBe("tomorrow's");
    expect(dayPossessive('2026-10-29', '2026-10-25')).toBe("Thu 29 Oct's");
  });
});
