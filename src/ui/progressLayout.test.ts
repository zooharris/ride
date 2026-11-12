import { describe, expect, it } from 'vitest';
import { layout } from './screens/Progress';

const cards = (ids: string[]) => ids.map((id) => ({ id }));
/** Every row adds up to the full width, in order, with nothing left over. */
const rows = (items: Array<{ id: string; w: number }>, cols: number) => {
  const out: string[][] = [];
  let row: string[] = [], used = 0;
  for (const x of items) {
    if (used + x.w > cols) return null;
    row.push(x.id); used += x.w;
    if (used === cols) { out.push(row); row = []; used = 0; }
  }
  return used === 0 ? out : null;
};

describe('the Progress grid', () => {
  const base = ['fitness', 'key', 'load', 'zones', 'power', 'records', 'durability', 'aerobic', 'wellness', 'morning', 'consistency', 'totals'];
  for (const extra of [[], ['weight'], ['tests'], ['weight', 'tests'], ['weight', 'tests', 'body'], ['tests', 'body', 'breathing'], ['weight', 'tests', 'body', 'breathing'], ['tests', 'breathing']]) {
    for (const cols of [2, 3]) {
      it(`leaves no row short: ${cols} columns with ${extra.join(', ') || 'the base cards'}`, () => {
        const placed = layout(cards([...base, ...extra]), cols);
        expect(rows(placed, cols)).not.toBeNull();
        expect(placed.map((x) => x.id).sort()).toEqual([...base, ...extra].sort());
      });
    }
  }
  it('puts the fitness chart beside Key numbers and the three table cards in one row', () => {
    const r = rows(layout(cards([...base, 'weight', 'tests', 'body']), 3), 3)!;
    expect(r[0]).toEqual(['fitness', 'key']);
    expect(r).toContainEqual(['records', 'morning', 'consistency']);
  });
  it('gives a spare column to a card with several small charts, never to whichever card is last', () => {
    const placed = layout(cards([...base, 'tests', 'body']), 3);
    const wide = placed.filter((x) => x.w === 2 && x.id !== 'fitness').map((x) => x.id);
    expect(wide.every((id) => ['totals', 'aerobic', 'weight', 'wellness', 'breathing'].includes(id))).toBe(true);
    expect(placed.find((x) => x.id === 'body')!.w).toBe(1);
  });
  it('one column is a plain list', () => {
    expect(layout(cards(base), 1).every((x) => x.w === 1)).toBe(true);
  });
});
