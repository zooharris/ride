import { describe, expect, it } from 'vitest';
import { readyMadeSessions } from './sessions';
import { MOBILITY } from './mobility';
import { EXERCISES } from './strength';
import { runMinutes } from '../engine/run';
import type { Equipment } from '../engine/types';

const EVERYTHING: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk'];
const NEW_STRENGTH = ['kb-swings-carries', 'kb-legs', 'heavy-legs', 'hotel-15', 'upper-back', 'balance', 'hip-power', 'aero-trunk'];
const kinds = (eq: Equipment[]) => { const l = readyMadeSessions(eq); return { l, n: (k: string) => l.filter((w) => w.kind === k).length }; };

describe('Library, Batch 5c', () => {
  it('with everything ticked: 24 strength, 17 mobility, 14 walks, 10 runs, every id unique', () => {
    const { l, n } = kinds(EVERYTHING);
    expect([n('strength'), n('mobility'), n('walk'), n('run')]).toEqual([24, 17, 14, 10]);
    expect(new Set(l.map((w) => w.id)).size).toBe(l.length);
  });
  it('every new strength session fills every pattern for bodyweight, dumbbells and a bench, and a kettlebell', () => {
    for (const eq of [['bodyweight'], ['bodyweight', 'dumbbells', 'bench'], ['bodyweight', 'dumbbells', 'bench', 'kettlebell']] as Equipment[][]) {
      const l = readyMadeSessions(eq);
      for (const id of NEW_STRENGTH) {
        const w = l.find((x) => x.id === `lib-str-${id}`);
        if (!w) continue;   // a session that needs equipment this rider does not have
        expect(w.exercises!.length, `${id} with ${eq.join(',')}`).toBeGreaterThanOrEqual(4);
        for (const e of w.exercises!) expect(e.equipment.some((q) => eq.includes(q))).toBe(true);
      }
    }
  });
  it('kettlebell sessions only with a kettlebell; Hotel room is bodyweight only; heavy legs needs a load', () => {
    const plain = readyMadeSessions(['bodyweight', 'dumbbells', 'bench']).map((w) => w.id);
    expect(plain).not.toContain('lib-str-kb-swings-carries');
    expect(plain).not.toContain('lib-str-kb-legs');
    expect(readyMadeSessions(['bodyweight']).map((w) => w.id)).not.toContain('lib-str-heavy-legs');
    const hotel = readyMadeSessions(EVERYTHING).find((w) => w.id === 'lib-str-hotel-15')!;
    for (const e of hotel.exercises!) expect(e.equipment).toContain('bodyweight');
  });
  it('sessions are what their names say: swings first, one swing only, the kettlebell single-leg deadlift on kettlebell legs', () => {
    const l = readyMadeSessions(EVERYTHING);
    const names = (id: string) => l.find((w) => w.id === id)!.exercises!.map((e) => e.name);
    expect(names('lib-str-kb-swings-carries')[0]).toBe('Kettlebell swing');
    expect(names('lib-str-hip-power')[0]).toBe('Kettlebell swing');
    expect(names('lib-str-hip-power').filter((n) => /swing/i.test(n))).toHaveLength(1);
    expect(names('lib-str-kb-legs')).toContain('Kettlebell single-leg deadlift');
  });
  it('every mobility routine uses stretches that exist; every exercise in the Library is one of the 86', () => {
    const known = new Set([...EXERCISES.map((e) => e.name), ...MOBILITY.map((m) => m.name)]);
    expect(known.size).toBe(86);
    for (const w of readyMadeSessions(EVERYTHING)) for (const e of w.exercises ?? []) expect(known.has(e.name), e.name).toBe(true);
    for (const w of readyMadeSessions(EVERYTHING).filter((x) => x.kind === 'mobility')) expect(w.exercises!.length).toBeGreaterThanOrEqual(4);
  });
  it('every run’s minutes are its steps, and every walk and run has a load', () => {
    for (const w of readyMadeSessions(EVERYTHING).filter((x) => x.kind === 'run' || x.kind === 'walk')) {
      if (w.kind === 'run') expect(w.minutes).toBe(runMinutes(w.run));
      expect(w.estimatedTss).toBeGreaterThan(0);
    }
  });
});
