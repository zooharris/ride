import { describe, expect, it } from 'vitest';
import { readyMadeSessions } from './sessions';
import { MOBILITY } from './mobility';
import { EXERCISES } from './strength';
import { strengthTss } from './sessions';
import { redose } from './strengthSessions';
import { runMinutes } from '../engine/run';
import type { Equipment } from '../engine/types';

const EVERYTHING: Equipment[] = ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars', 'treadmill', 'outdoor-walk'];
const NEW_STRENGTH = ['kb-swings-carries', 'hotel-15', 'upper-back', 'hip-power', 'aero-trunk'];
const kinds = (eq: Equipment[]) => { const l = readyMadeSessions(eq); return { l, n: (k: string) => l.filter((w) => w.kind === k).length }; };

describe('Library, Batch 5c', () => {
  it('with everything ticked: every id unique; mobility, walks and runs as before', () => {
    const { l, n } = kinds(EVERYTHING);
    expect([n('mobility'), n('walk'), n('run')]).toEqual([17, 21, 10]);
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
    expect(readyMadeSessions(['bodyweight']).map((w) => w.id)).not.toContain('lib-sq-heavy-legs');
    const hotel = readyMadeSessions(EVERYTHING).find((w) => w.id === 'lib-str-hotel-15')!;
    for (const e of hotel.exercises!) expect(e.equipment).toContain('bodyweight');
  });
  it('sessions are what their names say: swings first, one swing only, the kettlebell single-leg deadlift on heavy kettlebell legs', () => {
    const l = readyMadeSessions(EVERYTHING);
    const names = (id: string) => l.find((w) => w.id === id)!.exercises!.map((e) => e.name);
    expect(names('lib-str-kb-swings-carries')[0]).toBe('Kettlebell swing');
    expect(names('lib-str-hip-power')[0]).toBe('Kettlebell swing');
    expect(names('lib-str-hip-power').filter((n) => /swing/i.test(n))).toHaveLength(1);
    expect(names('lib-sq-heavy-legs-kb')).toContain('Kettlebell single-leg deadlift');
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

describe('strength by quality (30 Oct 2026)', () => {
  const SETS: Record<string, Equipment[]> = {
    bodyweight: ['bodyweight'],
    'dumbbells and a bench': ['bodyweight', 'dumbbells', 'bench'],
    'and a kettlebell': ['bodyweight', 'dumbbells', 'bench', 'kettlebell'],
    'and bands': ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band'],
    'a full gym': ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars'],
  };
  for (const [name, eq] of Object.entries(SETS)) {
    it(`every exercise New workout offers for ${name} is in at least one Library session for it`, () => {
      const offered = EXERCISES.filter((e) => e.equipment.some((q) => eq.includes(q))).map((e) => e.name);
      const inLibrary = new Set(readyMadeSessions(eq).filter((w) => w.kind === 'strength').flatMap((w) => (w.exercises ?? []).map((e) => e.name)));
      expect(offered.filter((n) => !inLibrary.has(n))).toEqual([]);
    });
  }
  it('every session by quality has a quality, a focus and what it needs; no exercise needs more than the session says', () => {
    for (const w of readyMadeSessions(EVERYTHING).filter((x) => x.kind === 'strength' && x.strength)) {
      for (const e of w.exercises!) expect(e.equipment.some((q) => q === 'bodyweight' || w.strength!.needs.includes(q)), `${w.name}: ${e.name}`).toBe(true);
    }
  });
  it('a rider sees only the sessions their equipment allows; the old level copies are gone', () => {
    const bw = readyMadeSessions(['bodyweight']).filter((w) => w.kind === 'strength' && w.strength);
    expect(bw.every((w) => w.strength!.needs.length === 0)).toBe(true);
    for (const q of ['heavy', 'power', 'endurance', 'stability']) for (const f of ['legs', 'upper']) expect(bw.some((w) => w.strength!.quality === q && w.strength!.focus === f), `${q} ${f}`).toBe(true);
    expect(readyMadeSessions(EVERYTHING).some((w) => /^lib-str-(foundation|build|maintain|light)-[ab]$/.test(w.id))).toBe(false);
  });
  it('the level sets the sets and reps, and the length: Build 4 × 6–8 for heavy, a short session fits half an hour at any level', () => {
    const heavy = readyMadeSessions(EVERYTHING).find((w) => w.name === 'Heavy legs')!;
    for (const [dose, sets, reps] of [['foundation', 3, '10–12'], ['build', 4, '6–8'], ['maintain', 2, '8'], ['light', 2, '10']] as const) {
      const d = redose(heavy, dose, strengthTss);
      expect(d.exercises![0].sets).toBe(sets);
      expect(d.exercises![0].reps).toBe(reps);
      expect(d.strength!.dose).toBe(dose);
    }
    const short = readyMadeSessions(EVERYTHING).filter((w) => / short$/.test(w.name));
    expect(short.length).toBe(12);
    for (const w of short) for (const dose of ['foundation', 'build', 'maintain', 'light'] as const) expect(redose(w, dose, strengthTss).minutes!).toBeLessThanOrEqual(30);
  });
});
