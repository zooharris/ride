import { describe, expect, it } from 'vitest';
import { sweetSpotSeconds, zoneSeconds } from './intervals';

describe('power zone times from Intervals.icu', () => {
  const icu = [
    { id: 'Z1', secs: 2212 }, { id: 'Z2', secs: 2124 }, { id: 'Z3', secs: 1268 }, { id: 'Z4', secs: 652 },
    { id: 'Z5', secs: 255 }, { id: 'Z6', secs: 144 }, { id: 'Z7', secs: 62 }, { id: 'SS', secs: 863 },
  ];
  it('keeps zones 1 to 7 and never turns sweet spot into a zone 8', () => {
    expect(zoneSeconds(icu)).toEqual([2212, 2124, 1268, 652, 255, 144, 62]);
  });
  it('reports the sweet-spot time on its own', () => {
    expect(sweetSpotSeconds(icu)).toBe(863);
  });
  it('reads by label, whatever the order', () => {
    expect(zoneSeconds([...icu].reverse())).toEqual([2212, 2124, 1268, 652, 255, 144, 62]);
  });
  it('a plain list is cut to seven', () => {
    expect(zoneSeconds([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sweetSpotSeconds([1, 2, 3, 4, 5, 6, 7, 8])).toBeUndefined();
  });
});
