import list from './exercises.json';
import { EXERCISES } from '../library/strength';
import { MOBILITY } from '../library/mobility';
import { exerciseIdFor } from '../engine/record';

/**
 * The exercise pictures: a start pose (a) for every strength exercise and
 * stretch, and a finish pose (b) for the ones that move. The files are made by
 * scripts/make-art.mjs into public/art/exercises; exercises.json, written by the
 * same script, lists what is there, so a missing picture is never asked for.
 */
const POSES = list as Record<string, string[]>;
const IDS = new Set([...EXERCISES.map((e) => e.id), ...MOBILITY.map((m) => m.id)]);

export interface Pictures { a?: string; b?: string }

const url = (id: string, pose: string) => `${import.meta.env.BASE_URL}art/exercises/${id}-${pose}.webp`;

/**
 * The start and finish pictures for an exercise, by library id or by name (any
 * case). A record's own exerciseId, when it has one, is preferred over its name.
 * An unknown exercise or a missing pose gives nothing.
 */
export function picturesFor(nameOrId: string, exerciseId?: string): Pictures {
  const id = [exerciseId, nameOrId.trim()].find((x) => x && IDS.has(x) && POSES[x]) ?? exerciseIdFor(nameOrId);
  const poses = id ? POSES[id] : undefined;
  if (!id || !poses) return {};
  const out: Pictures = {};
  if (poses.includes('a')) out.a = url(id, 'a');
  if (poses.includes('b')) out.b = url(id, 'b');
  return out;
}
