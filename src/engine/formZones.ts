/**
 * Form, in named zones (Insights and the Lab, 27 Nov 2026). The edges are the ones the readiness score already
 * uses (readiness.ts, formScore): form from −10 to +5 is "an ordinary training state" and scores 70; above +5 the
 * score rises (fresh); below −10 it falls two points for each point of form. The last edge, −25, is where that
 * score reaches 40, inside the band readiness calls an easy day. One rule, in one place, used by both.
 */
export type FormZone = 'much' | 'building' | 'balanced' | 'fresh';
export const FORM_EDGES = { much: -25, building: -10, fresh: 5 } as const;
export const FORM_ZONES: Array<{ id: FormZone; name: string; lo: number; hi: number; says: string }> = [
  { id: 'much', name: 'Too much', lo: -Infinity, hi: FORM_EDGES.much, says: 'you are carrying more fatigue than training usually needs' },
  { id: 'building', name: 'Building', lo: FORM_EDGES.much, hi: FORM_EDGES.building, says: 'you are carrying the fatigue that building fitness brings' },
  { id: 'balanced', name: 'Balanced', lo: FORM_EDGES.building, hi: FORM_EDGES.fresh, says: 'your training and your recovery are in balance' },
  { id: 'fresh', name: 'Fresh', lo: FORM_EDGES.fresh, hi: Infinity, says: 'you are rested' },
];
export function formZone(tsb: number): (typeof FORM_ZONES)[number] {
  return tsb <= FORM_EDGES.much ? FORM_ZONES[0] : tsb < FORM_EDGES.building ? FORM_ZONES[1] : tsb <= FORM_EDGES.fresh ? FORM_ZONES[2] : FORM_ZONES[3];
}
