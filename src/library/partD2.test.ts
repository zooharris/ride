import { describe, expect, it } from 'vitest';
import type { Equipment } from '../engine/types';
import { EXERCISES, EXERCISES_ADDED_11_NOV, exercisesFor } from './strength';
import { STRENGTH_SESSIONS } from './strengthSessions';
import { STRENGTH_D2 } from './strengthD2';
import { readyMadeSessions } from './sessions';
import { applyFilters, filtersFromQuery, filtersToQuery, NO_FILTERS, sessionIncludes } from '../ui/LibraryFilters';
import filtersSrc from '../ui/LibraryFilters.tsx?raw';

/** Part D, batch 2 (11 Nov 2026): the 22 approved exercises, the sessions built on them, the filter and the balance checks. */
const pattern = new Map(EXERCISES.map((e) => [e.id, e.pattern]));
const SETS: Equipment[][] = [['bodyweight'], ['bodyweight', 'dumbbells', 'bench'], ['bodyweight', 'dumbbells', 'bench', 'kettlebell'], ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band'], ['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars']];

describe('the 22 approved exercises', () => {
  it('are all in the Library with instructions, and each is in at least one session', () => {
    expect(EXERCISES_ADDED_11_NOV).toHaveLength(22);
    const used = new Set(STRENGTH_SESSIONS.flatMap((s) => s.ids));
    for (const id of EXERCISES_ADDED_11_NOV) {
      const e = EXERCISES.find((x) => x.id === id)!;
      expect(e, id).toBeTruthy();
      expect(e.cue.length, id).toBeGreaterThan(30);
      expect(e.why?.length ?? 0, id).toBeGreaterThan(20);
      expect(used.has(id), id).toBe(true);
    }
  });
  it('jumps and hops go first; household rows carry their safety line and count as bodyweight; the snatch says it is advanced', () => {
    for (const id of ['squat-jump', 'skater-hop', 'pogo-hops', 'box-jump', 'split-jump']) expect(EXERCISES.find((e) => e.id === id)!.first, id).toBe(true);
    for (const id of ['towel-row', 'table-row']) {
      const e = EXERCISES.find((x) => x.id === id)!;
      expect(e.equipment).toEqual(['bodyweight']);
      expect(e.cue).toMatch(/cannot (move|tip)/);
    }
    expect(EXERCISES.find((e) => e.id === 'kb-snatch')!.cue).toMatch(/^Advanced/);
  });
  it('the builder offers them to riders with the equipment, and a bodyweight rider can now pull', () => {
    expect(exercisesFor('pull', ['bodyweight']).map((e) => e.id)).toEqual(expect.arrayContaining(['towel-row', 'table-row']));
    expect(exercisesFor('pull', ['bodyweight', 'pullup-bar']).map((e) => e.id)).toEqual(expect.arrayContaining(['chin-up', 'dead-hang']));
    expect(exercisesFor('hinge', ['bodyweight']).map((e) => e.id)).toContain('nordic-lower');
    expect(exercisesFor('hinge', ['bodyweight', 'bench']).map((e) => e.id)).not.toContain('bb-hip-thrust');
  });
});

describe('the sessions', () => {
  it('no two share a name or the same exercises; "short" means four exercises', () => {
    const names = STRENGTH_SESSIONS.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const sets = STRENGTH_SESSIONS.map((s) => [...s.ids].sort().join());
    expect(new Set(sets).size).toBe(sets.length);
    for (const s of STRENGTH_D2) if (/ short$/.test(s.name)) expect(s.ids.length, s.name).toBe(4);
  });
  it('bodyweight leg power and bodyweight upper body with pulling, at both lengths', () => {
    const bw = STRENGTH_D2.filter((s) => s.needs.length === 0);
    expect(bw.filter((s) => s.quality === 'power' && s.focus === 'legs').length).toBeGreaterThanOrEqual(4);
    for (const q of ['heavy', 'power', 'endurance', 'stability'] as const) {
      const up = bw.filter((s) => s.quality === q && s.focus === 'upper');
      expect(up.some((s) => s.ids.length === 8), q).toBe(true);
      for (const s of up) expect(s.ids.some((i) => pattern.get(i) === 'pull'), s.name).toBe(true);
    }
  });
});

describe('balanced sessions, for every equipment set', () => {
  for (const eq of SETS) it(`${eq.join(', ')}`, () => {
    for (const w of readyMadeSessions(eq).filter((x) => x.kind === 'strength' && x.strength)) {
      const f = w.strength!.focus;
      const has = (p: string) => (w.exercises ?? []).some((e) => EXERCISES.find((d) => d.name === e.name)?.pattern === p);
      const lower = has('squat') || has('single-leg');
      if (f === 'upper') { expect(has('push'), `${w.name}: push`).toBe(true); expect(has('pull'), `${w.name}: pull`).toBe(true); }
      if (f === 'legs') { expect(has('hinge'), `${w.name}: hinge`).toBe(true); expect(lower, `${w.name}: squat or one leg`).toBe(true); }
      if (f === 'full') { for (const p of ['hinge', 'push', 'pull', 'trunk']) expect(has(p), `${w.name}: ${p}`).toBe(true); expect(lower, `${w.name}: squat`).toBe(true); }
    }
  });
});

describe('the Includes filter', () => {
  const all = readyMadeSessions(SETS[4]).filter((w) => w.kind === 'strength');
  const mine = { favorites: new Set<string>(), recent: new Map<string, string>() };
  it('each choice alone, and combined: a session must include all that are picked', () => {
    const pull = applyFilters(all, { ...NO_FILTERS, includes: ['pull'] }, 'strength', mine);
    expect(pull.length).toBeGreaterThan(10);
    expect(pull.every((w) => sessionIncludes(w, 'pull'))).toBe(true);
    const both = applyFilters(all, { ...NO_FILTERS, includes: ['pull', 'posterior'] }, 'strength', mine);
    expect(both.every((w) => sessionIncludes(w, 'pull') && sessionIncludes(w, 'posterior'))).toBe(true);
    expect(both.length).toBeLessThanOrEqual(pull.length);
  });
  it('kept in the address, counted in "Filters · N", and labelled plainly', () => {
    const f = { ...NO_FILTERS, includes: ['trunk', 'push'] as const };
    const q = new URLSearchParams(Object.entries(filtersToQuery({ ...f, includes: [...f.includes] })).filter(([, v]) => v != null) as Array<[string, string]>);
    expect(filtersFromQuery(q).includes).toEqual(['trunk', 'push']);
    expect(filtersSrc).toMatch(/f\.includes\.length > 0, f\.show/);
    expect(filtersSrc).toMatch(/posterior: 'Posterior chain'/);
  });
});
