import { describe, expect, it } from 'vitest';
import { applyFilters, filtersFromQuery, filtersToQuery, minutesOf, NO_FILTERS, type Filters } from './LibraryFilters';
import { recentlyDone } from './favorites';
import { LIBRARY, libraryById } from '../library/workouts';
import { readyMadeSessions } from '../library/sessions';
import { tagsOf } from '../library/tags';
import type { PlannedWorkout } from '../engine/types';

const rides = LIBRARY.filter((w) => w.kind === 'ride');
const strength = readyMadeSessions(['bodyweight', 'dumbbells', 'bench', 'kettlebell', 'band', 'barbell', 'pullup-bar', 'dip-bars']).filter((w) => w.kind === 'strength');

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
  it('search matches the name, and the purpose', () => {
    expect(applyFilters(rides, { ...NO_FILTERS, query: 'hunter mill' }, 'ride').map((w) => w.name)).toContain('Hunter Mill');
    expect(applyFilters(rides, { ...NO_FILTERS, query: 'threshold' }, 'ride').length).toBeGreaterThan(0);
  });
  it('no filters: everything, in the given order', () => {
    expect(applyFilters(rides, NO_FILTERS, 'ride')).toEqual(rides);
  });
});

describe('the Library grows up (9 Nov 2026, Part B)', () => {
  it('"What do you want to work on?" keeps rides of that purpose, and applies to rides only', () => {
    const out = applyFilters(rides, { ...NO_FILTERS, purpose: 'vo2' }, 'ride');
    expect(out.length).toBeGreaterThan(5);
    expect(out.every((w) => tagsOf(w).purpose === 'vo2')).toBe(true);
    expect(applyFilters(strength, { ...NO_FILTERS, purpose: 'vo2' }, 'strength')).toHaveLength(strength.length);
  });
  it('how hard: every kind', () => {
    const easy = applyFilters(rides, { ...NO_FILTERS, intensity: 'easy' }, 'ride');
    expect(easy.length).toBeGreaterThan(0);
    expect(easy.every((w) => tagsOf(w).intensity === 'easy')).toBe(true);
    expect(applyFilters(strength, { ...NO_FILTERS, intensity: 'hard' }, 'strength').every((w) => tagsOf(w).intensity === 'hard')).toBe(true);
  });
  it('rides well outdoors leaves out the fast on/off work and the drills', () => {
    const out = applyFilters(rides, { ...NO_FILTERS, outdoor: true }, 'ride');
    expect(out.every((w) => tagsOf(w).outdoor === 'well')).toBe(true);
    expect(out.map((w) => w.id)).not.toContain('lib-vo2-30-30');
  });
  it('body focus: strength only', () => {
    const legs = applyFilters(strength, { ...NO_FILTERS, focus: 'legs' }, 'strength');
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((w) => w.strength?.focus === 'legs')).toBe(true);
  });
  it('favorites keep only the starred; a star on a calendar copy counts for its Library workout', () => {
    const fav = new Set(['lib-spin-30']);
    expect(applyFilters(rides, { ...NO_FILTERS, show: 'favorites' }, 'ride', { favorites: fav, recent: new Map() }).map((w) => w.id)).toEqual(['lib-spin-30']);
    const copy = { ...libraryById('lib-sprints')!, id: 'copy-1', libraryId: 'lib-sprints' };
    expect(applyFilters([copy], { ...NO_FILTERS, show: 'favorites' }, 'ride', { favorites: new Set(['lib-sprints']), recent: new Map() })).toHaveLength(1);
  });
  it('recently done: completed in the last 90 days, most recent first', () => {
    const p = (id: string, date: string, status: PlannedWorkout['status'] = 'completed'): PlannedWorkout => ({ id: id + date, date, workoutId: id, basis: 'power', status });
    const recent = recentlyDone([p('lib-spin-30', '2026-11-01'), p('lib-sprints', '2026-11-05'), p('lib-opener', '2026-11-06', 'planned'), p('lib-z2-60', '2026-06-01'), p('lib-spin-30', '2026-10-01')], (id) => libraryById(id), '2026-11-09');
    expect([...recent.keys()].sort()).toEqual(['lib-spin-30', 'lib-sprints']);
    expect(recent.get('lib-spin-30')).toBe('2026-11-01');
    const out = applyFilters(rides, { ...NO_FILTERS, show: 'recent' }, 'ride', { favorites: new Set(), recent });
    expect(out.map((w) => w.id)).toEqual(['lib-sprints', 'lib-spin-30']);
  });
});

/** Encodes filters as the Library's address does, the way `replaceQuery` writes them. */
const asQuery = (f: Filters) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(filtersToQuery(f))) if (v !== undefined) q.set(k, v); return q; };

describe('the Library keeps its filters in its address (8 Nov 2026)', () => {
  it('filters survive the round trip through the address', () => {
    const f: Filters = { query: 'hill & dale', purpose: 'endurance', intensity: 'moderate', outdoor: true, focus: 'all', show: 'favorites', duration: '90-120', sort: 'short' };
    expect(filtersFromQuery(asQuery(f))).toEqual(f);
    const s: Filters = { ...NO_FILTERS, focus: 'upper', show: 'recent' };
    expect(filtersFromQuery(asQuery(s))).toEqual(s);
  });
  it('no filters: nothing in the address, and nothing read back', () => {
    expect(asQuery(NO_FILTERS).toString()).toBe('');
    expect(filtersFromQuery(new URLSearchParams())).toEqual(NO_FILTERS);
  });
  it('an address with unknown values opens the Library unfiltered rather than broken', () => {
    expect(filtersFromQuery(new URLSearchParams('p=nonsense&i=x&len=7h&sort=sideways&show=all-of-it&focus=toes'))).toEqual(NO_FILTERS);
  });
  it('an address saved before 9 Nov, with a ride type, opens on the matching purpose', () => {
    expect(filtersFromQuery(new URLSearchParams('t=vo2max')).purpose).toBe('vo2');
  });
});
