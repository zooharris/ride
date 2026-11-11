import { describe, expect, it } from 'vitest';
import { layout } from './screens/Progress';

const cards = (ids: string[], extra: Record<string, { w: number; h: number }> = {}) => ids.map((id) => Object.assign({ id, w: 1, h: 1 }, extra[id]));
const rowsFull = (items: Array<{ w: number; h: number }>, cols: number) => {
  // Fill a grid the way CSS does (dense enough for these shapes) and check no row has a hole.
  const grid: boolean[][] = [];
  let r = 0, c = 0;
  for (const x of items) {
    for (;;) {
      grid[r] ??= Array(cols).fill(false);
      const fits = c + x.w <= cols && Array.from({ length: x.h }, (_, dr) => Array.from({ length: x.w }, (_, dc) => !(grid[r + dr]?.[c + dc]))).flat().every(Boolean);
      if (fits) break;
      c++; if (c >= cols) { c = 0; r++; }
    }
    for (let dr = 0; dr < x.h; dr++) { grid[r + dr] ??= Array(cols).fill(false); for (let dc = 0; dc < x.w; dc++) grid[r + dr][c + dc] = true; }
    c += x.w; if (c >= cols) { c = 0; r++; }
  }
  return grid.every((row) => row.every(Boolean));
};

describe('the Progress grid leaves no holes', () => {
  const base = ['fitness', 'key', 'load', 'zones', 'power', 'records', 'durability', 'aerobic', 'wellness', 'morning', 'consistency', 'totals'];
  const big = { fitness: { w: 2, h: 2 }, key: { w: 1, h: 2 } };
  for (const extra of [[], ['weight'], ['weight', 'tests'], ['weight', 'tests', 'body'], ['tests', 'body', 'breathing'], ['weight', 'tests', 'body', 'breathing']]) {
    for (const cols of [2, 3]) {
      it(`${cols} columns with ${extra.join(', ') || 'the base cards'}`, () => {
        const items = cards([...base, ...extra], { ...big, breathing: { w: 2, h: 1 } });
        expect(rowsFull(layout(items, cols), cols)).toBe(true);
      });
    }
  }
  it('one column is a plain list', () => {
    expect(layout(cards(base, big), 1).every((x) => x.w === 1 && x.h === 1)).toBe(true);
  });
});
