import { describe, expect, it } from 'vitest';
import { applyFilters, filtersFromQuery, filtersToQuery, minutesOf, NO_FILTERS, type Filters } from './LibraryFilters';
import { LIBRARY } from '../library/workouts';

const rides = LIBRARY.filter((w) => w.kind === 'ride');

describe('the shared filters', () => {
  it('a length band keeps only rides in it', () => {
    const out = applyFilters(rides, { ...NO_FILTERS, duration: 'u60' }, 'ride');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((w) => minutesOf(w) < 60)).toBe(true);
    expect(out.length).toBeLessThan(rides.length);
  });
  it('shortest first orders by minutes, longest first the other way', () => {
    const short = applyFilters(rides, { ...NO_FILTERS, sort: 'short' }, 'ride').map(minutesOf);
    expect(short).toEqual([...short].sort((a, b) => a - b));
    const long = applyFilters(rides, { ...NO_FILTERS, sort: 'long' }, 'ride').map(minutesOf);
    expect(long).toEqual([...long].sort((a, b) => b - a));
  });
  it('search matches the name, and the type', () => {
    expect(applyFilters(rides, { ...NO_FILTERS, query: 'hunter mill' }, 'ride').map((w) => w.name)).toContain('Hunter Mill');
    const byType = applyFilters(rides, { ...NO_FILTERS, query: 'threshold' }, 'ride');
    expect(byType.length).toBeGreaterThan(0);
  });
  it('the type filter applies to rides only', () => {
    const out = applyFilters(rides, { ...NO_FILTERS, family: 'endurance' }, 'ride');
    expect(out.every((w) => w.family === 'endurance')).toBe(true);
    const sessions = LIBRARY.slice(0, 5);
    expect(applyFilters(sessions, { ...NO_FILTERS, family: 'endurance' }, 'strength')).toHaveLength(sessions.length);
  });
  it('no filters: everything, in the given order', () => {
    expect(applyFilters(rides, NO_FILTERS, 'ride')).toEqual(rides);
  });
});

/** Encodes filters as the Library's address does, the way `replaceQuery` writes them. */
const asQuery = (f: Filters) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(filtersToQuery(f))) if (v !== undefined) q.set(k, v); return q; };

describe('the Library keeps its filters in its address (8 Nov 2026)', () => {
  it('filters survive the round trip through the address', () => {
    const f: Filters = { query: 'hill & dale', family: 'endurance', duration: '90-120', sort: 'short' };
    expect(filtersFromQuery(asQuery(f))).toEqual(f);
  });
  it('no filters: nothing in the address, and nothing read back', () => {
    expect(asQuery(NO_FILTERS).toString()).toBe('');
    expect(filtersFromQuery(new URLSearchParams())).toEqual(NO_FILTERS);
  });
  it('an address with unknown values opens the Library unfiltered rather than broken', () => {
    expect(filtersFromQuery(new URLSearchParams('t=nonsense&len=7h&sort=sideways'))).toEqual(NO_FILTERS);
  });
});
