import { describe, expect, it } from 'vitest';
import { deviceRegion, fahrenheit, legacyUnits, mastersFor, miles, packWords, pounds, sameSessionName, setPackUnit, unitsForRegion, weightSystem } from './units';
import { easyWalkName } from './sessions';
import { distance, elevation } from '../ui/derived';
import type { Profile } from './types';

const base = { name: 'R', ftp: 250, lthr: 160, maxHr: 180, restingHr: 50, weightKg: 70, basis: 'power', masters: false, rideDays: [], hoursPerWeek: 6 } as unknown as Profile;

describe('distance and weight are two settings (12 Nov 2026)', () => {
  it('the starting guess by region', () => {
    expect(unitsForRegion('US')).toEqual({ distUnits: 'mi', weightUnits: 'lb' });
    expect(unitsForRegion('GB')).toEqual({ distUnits: 'mi', weightUnits: 'kg' });
    expect(unitsForRegion('FR')).toEqual({ distUnits: 'km', weightUnits: 'kg' });
    expect(unitsForRegion(undefined)).toEqual({ distUnits: 'km', weightUnits: 'kg' });
    expect(unitsForRegion('LR').distUnits).toBe('mi');
    expect(deviceRegion(['en-GB'])).toBe('GB');
    expect(deviceRegion(['fr-FR', 'en-US'])).toBe('FR');
    expect(deviceRegion(['en'])).toBeUndefined();
  });
  it('an existing rider keeps what they had', () => {
    expect([miles({ ...base, units: 'imperial' }), pounds({ ...base, units: 'imperial' })]).toEqual([true, true]);
    expect([miles({ ...base, units: 'metric' }), pounds({ ...base, units: 'metric' })]).toEqual([false, false]);
  });
  it('miles with kilograms shows correctly', () => {
    const uk = { ...base, units: legacyUnits('mi', 'kg'), distUnits: 'mi', weightUnits: 'kg' } as Profile;
    expect(distance(16093.44, uk)).toBe('10.0 mi');
    expect(elevation(100, uk)).toBe('328 ft');
    expect(weightSystem(uk)).toBe('metric');
    expect(fahrenheit(uk)).toBe(false);
    expect(pounds(uk)).toBe(false);
  });
});

describe('walk names follow the weight setting', () => {
  it('in both units, and an old name still matches', () => {
    setPackUnit('lb');
    expect(easyWalkName(30, 6.8)).toBe('Easy walk 30 min with a 15 lb pack');
    setPackUnit('kg');
    expect(easyWalkName(30, 6.8)).toBe('Easy walk 30 min with a 7 kg pack');
    expect(packWords(13.6)).toBe('14 kg');
    expect(sameSessionName('Easy walk 30 min with a 15 lb pack', 'Easy walk 30 min with a 7 kg pack')).toBe(true);
    expect(sameSessionName('Easy walk 30 min with a 20 lb pack', 'Easy walk 30 min with a 7 kg pack')).toBe(false);
    setPackUnit('lb');
  });
});

describe('masters recovery by birth year', () => {
  it('on from 40, off when younger or not given', () => {
    const today = '2026-11-12';
    expect(mastersFor(2001, today)).toBe(false);   // 25
    expect(mastersFor(1987, today)).toBe(false);   // 39
    expect(mastersFor(1986, today)).toBe(true);    // 40
    expect(mastersFor(1966, today)).toBe(true);    // 60
    expect(mastersFor(undefined, today)).toBe(false);
  });
});
