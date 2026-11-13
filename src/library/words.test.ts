import { describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';

/** Every source file a rider can read text from. */
const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const all = Object.entries(sources).map(([p, s]) => ({ p: p.replace(/^\.\.\//, 'src/').replace(/^\.\//, 'src/library/'), s }));
const readFile = (p: string) => all.find((x) => x.p === p)!.s;

describe('words that assume one rider (12 Nov 2026)', () => {
  it('no text says "masters rider", except the plan’s sentence to a rider on masters recovery', () => {
    const hits = all.flatMap(({ p, s }) => s.split('\n').map((l, i) => ({ p, i, l })).filter((x) => /masters riders?\b/i.test(x.l)));
    expect(hits.map((h) => h.p)).toEqual(['src/engine/planner.ts']);
    expect(hits[0].l).toMatch(/masters \? ' for a masters rider'/);
  });
  it('the read-me, Help and the Feet and ankles routine', () => {
    expect(readme).not.toMatch(/masters riders/);
    const help = all.find((x) => x.p.endsWith('Help.tsx'))!.s;
    expect(help).not.toMatch(/from the Edge/);
    expect(all.find((x) => x.p.endsWith('library/sessions.ts'))!.s).toMatch(/cramp late in a long ride/);
  });
  it('the coach’s day follows the device’s way of writing dates', () => {
    for (const f of ['src/ui/judgeService.ts', 'src/engine/dayJudge.ts']) expect(readFile(f)).not.toMatch(/'en-US'/);
    // A British and a German device write the day their own way.
    expect(new Date('2026-11-12T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })).toBe('Thursday 12 November');
    expect(new Date('2026-11-12T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })).toBe('Donnerstag, 12. November');
  });
});
