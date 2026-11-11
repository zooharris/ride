import { describe, expect, it } from 'vitest';
import { STRENGTH_SESSIONS } from './strengthSessions';
import { STRENGTH_D1 } from './strengthD1';
import { EXERCISES } from './strength';
import { readyMadeSessions } from './sessions';

/** Part D, batch 1 (11 Nov 2026): strength, mobility, walks and runs. */
describe('Part D, batch 1', () => {
  it('no two strength sessions share a name or the same set of exercises', () => {
    const names = STRENGTH_SESSIONS.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const sets = STRENGTH_SESSIONS.map((s) => [...s.ids].sort().join());
    expect(new Set(sets).size).toBe(sets.length);
  });
  it('the new sessions use only exercises already in the Library, and every exercise is in some session', () => {
    const known = new Set(EXERCISES.map((e) => e.id));
    for (const s of STRENGTH_D1) for (const id of s.ids) expect(known.has(id), `${s.name}: ${id}`).toBe(true);
    const used = new Set(STRENGTH_SESSIONS.flatMap((s) => s.ids));
    for (const e of EXERCISES) expect(used.has(e.id), e.name).toBe(true);
  });
  it('"short" still means half an hour: the five-exercise sessions are not called short', () => {
    for (const s of STRENGTH_D1.filter((x) => x.ids.length > 4)) expect(s.name, s.name).not.toMatch(/ short$/);
  });
  it('every mobility routine’s name states the length its holds add up to', () => {
    for (const w of readyMadeSessions(['bodyweight']).filter((x) => x.kind === 'mobility')) {
      const m = w.name.match(/\((\d+) min\)$/);
      if (m) expect(Number(m[1]), w.name).toBe(w.minutes);
    }
  });
});
