import { describe, expect, it } from 'vitest';
import { columnsFor } from './screens/Progress';

const ids = ['load', 'zones', 'power', 'records', 'durability', 'aerobic', 'wellness', 'morning', 'consistency', 'totals', 'weight', 'tests', 'body', 'breathing'];

describe('the Progress columns', () => {
  it('place every card exactly once, whatever the number of columns', () => {
    for (const cols of [1, 2, 3]) {
      const out = columnsFor(ids, cols);
      expect(out).toHaveLength(cols);
      expect(out.flat().sort()).toEqual([...ids].sort());
    }
  });
  it('end about level: no column is taller than another by more than one card', () => {
    const heights: Record<string, number> = { load: 320, zones: 300, power: 360, records: 290, durability: 310, aerobic: 470, wellness: 430, morning: 250, consistency: 300, totals: 440, weight: 480, tests: 520, body: 400, breathing: 380 };
    for (const cols of [2, 3]) {
      const tall = columnsFor(ids, cols, heights).map((c) => c.reduce((a, id) => a + heights[id] + 14, 0));
      expect(Math.max(...tall) - Math.min(...tall)).toBeLessThanOrEqual(Math.max(...Object.values(heights)) + 14);
    }
  });
  it('keep the reading order within each column, and start with the first cards across the top', () => {
    // (with no measured heights the rough ones are used)
    const out = columnsFor(ids, 3);
    expect(out.map((c) => c[0])).toEqual(['load', 'zones', 'power']);
    for (const col of out) expect(col.map((id) => ids.indexOf(id))).toEqual([...col.map((id) => ids.indexOf(id))].sort((a, b) => a - b));
  });
  it('one column is the plain list', () => {
    expect(columnsFor(ids, 1)).toEqual([ids]);
  });
});

describe('the columns end level', () => {
  it('leaves only a little to share out, for many mixes of card heights', () => {
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let worst = 0;
    for (let run = 0; run < 300; run++) {
      const some = ids.filter((id) => !['weight', 'body', 'breathing'].includes(id) || rnd() > 0.4);
      const heights = Object.fromEntries(some.map((id) => [id, Math.round(250 + rnd() * 300)]));
      for (const cols of [2, 3]) {
        const out = columnsFor(some, cols, heights);
        expect(out.flat().sort()).toEqual([...some].sort());
        const tall = out.map((c) => c.reduce((a, id) => a + heights[id] + 14, 0));
        worst = Math.max(worst, Math.max(...tall) - Math.min(...tall));
      }
    }
    // With an uneven number of cards one column holds one more than the others, so some difference is unavoidable;
    // it is shared out among that column's neighbours, a fraction each.
    expect(worst).toBeLessThanOrEqual(260);
  });
});
