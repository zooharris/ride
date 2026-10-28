/**
 * The ERG spiral guard (spec §5.2). In ERG the trainer holds the watts
 * whatever the cadence, so a rider who slows down gets a heavier and heavier
 * stroke until the legs stop. If cadence stays under 50 rpm for 3 seconds the
 * target eases to half; once cadence is back over 70 rpm it ramps back to the
 * full target over 5 seconds. Pure: the caller keeps the state.
 */

export interface GuardState {
  /** When cadence first fell below the low mark, ms. */
  lowSince?: number;
  eased: boolean;
  /** When the ramp back to the full target began, ms. */
  rampFrom?: number;
}

export interface GuardRule { low: number; recover: number; holdMs: number; rampMs: number; eased: number }
export const GUARD: GuardRule = { low: 50, recover: 70, holdMs: 3000, rampMs: 5000, eased: 0.5 };

/** The share of the target to send now (1 = all of it), and the next state. `justEased` is true on the moment it eases, for a one-time message. */
export function guardStep(st: GuardState, cadence: number | undefined, now: number, rule: GuardRule = GUARD): { state: GuardState; factor: number; justEased: boolean } {
  const c = cadence ?? 0;
  if (st.eased) {
    if (c > rule.recover) return { state: { eased: false, rampFrom: now }, factor: rule.eased, justEased: false };
    return { state: st, factor: rule.eased, justEased: false };
  }
  let ramp = 1;
  let rampFrom = st.rampFrom;
  if (rampFrom != null) {
    const p = (now - rampFrom) / rule.rampMs;
    if (p >= 1) rampFrom = undefined; else ramp = rule.eased + (1 - rule.eased) * Math.max(0, p);
  }
  if (c < rule.low) {
    const since = st.lowSince ?? now;
    if (now - since >= rule.holdMs) return { state: { eased: true }, factor: rule.eased, justEased: true };
    return { state: { eased: false, lowSince: since, rampFrom }, factor: ramp, justEased: false };
  }
  return { state: { eased: false, rampFrom }, factor: ramp, justEased: false };
}
