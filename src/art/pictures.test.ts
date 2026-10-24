import { describe, expect, it } from 'vitest';
import list from './exercises.json';
import { picturesFor } from './pictures';
import { EXERCISES } from '../library/strength';
import { MOBILITY } from '../library/mobility';

const poses = list as Record<string, string[]>;
const ids = [...EXERCISES.map((e) => e.id), ...MOBILITY.map((m) => m.id)];

describe('the exercise pictures', () => {
  it('has a start picture for every exercise and stretch, and nothing else', () => {
    expect(ids).toHaveLength(86);
    for (const id of ids) expect(poses[id], id).toContain('a');
    const known = new Set(ids);
    for (const id of Object.keys(poses)) expect(known.has(id), id).toBe(true);
    expect(Object.keys(poses)).toHaveLength(86);
  });
  it('has 47 finish pictures', () => {
    // 48 drawn; the calf raise's finish is left out (a heel lift does not read at tile size).
    expect(Object.values(poses).filter((p) => p.includes('b'))).toHaveLength(47);
    expect(poses['calf-raise']).toEqual(['a']);
  });
});

describe('looking up a picture', () => {
  it('finds both poses by id, under the app base', () => {
    const p = picturesFor('goblet-squat');
    expect(p.a).toMatch(/\/art\/exercises\/goblet-squat-a\.webp$/);
    expect(p.b).toMatch(/\/art\/exercises\/goblet-squat-b\.webp$/);
    expect(p.a!.startsWith(import.meta.env.BASE_URL)).toBe(true);
  });
  it('finds pictures by name, in any case', () => {
    expect(picturesFor('Goblet squat')).toEqual(picturesFor('goblet-squat'));
    expect(picturesFor('  GOBLET SQUAT ')).toEqual(picturesFor('goblet-squat'));
  });
  it('gives only the start pose for an exercise that holds still', () => {
    const p = picturesFor('farmer-carry');
    expect(p.a).toBeDefined();
    expect(p.b).toBeUndefined();
  });
  it('prefers a record’s exerciseId over its name', () => {
    expect(picturesFor('My renamed squat', 'goblet-squat')).toEqual(picturesFor('goblet-squat'));
    expect(picturesFor('Side plank', 'goblet-squat')).toEqual(picturesFor('goblet-squat'));
    expect(picturesFor('Goblet squat', 'no-such-id')).toEqual(picturesFor('goblet-squat'));
  });
  it('gives nothing for an unknown exercise', () => {
    expect(picturesFor('Treadmill walk')).toEqual({});
    expect(picturesFor('')).toEqual({});
  });
});
