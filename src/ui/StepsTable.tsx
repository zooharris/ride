import type { Basis, Profile, WorkoutBlock, WorkoutStep } from '../engine/types';
import { formatDuration, stepTargets } from '../engine/workout';
import { powerZone, ridePowerZones } from '../engine/zones';
import { ZONE_VAR } from './Profile';

/** A ride's steps with their targets in watts or bpm; sets show as a heading over the steps they repeat. */
export function StepsTable({ blocks, basis, profile }: { blocks: WorkoutBlock[]; basis: Basis; profile: Profile }) {
  const rows: Array<{ step: WorkoutStep; set?: string }> = [];
  for (const b of blocks) {
    if (b.kind === 'step') rows.push({ step: b });
    else { rows.push({ step: b.steps[0], set: `${b.label ?? 'Set'} × ${b.times}` }); for (const st of b.steps.slice(1)) rows.push({ step: st }); }
  }
  const ladder = ridePowerZones(profile);
  const pct = (f: number) => Math.round(f * 100);
  return (
    <table class="steps">
      <tr><td /><td class="faint small">Step</td><td class="r faint small">Time</td><td class="r faint small">% of FTP</td><td class={`r faint small${basis === 'power' ? '' : ' muted'}`}>Watts</td><td class={`r faint small${basis === 'hr' ? '' : ' muted'}`}>Heart rate</td></tr>
      {rows.map(({ step, set }, i) => {
        const t = stepTargets(step, profile);
        const z = powerZone(step.intensity, ladder);
        const share = step.noFloor ? `up to ${pct(step.intensityHigh ?? step.intensity)}%` : step.intensityHigh ? `${pct(step.intensity)}–${pct(step.intensityHigh)}%` : `${pct(step.intensity)}%`;
        return (
          <>
            {set && <tr key={`s${i}`}><td colSpan={6} class="set">{set}</td></tr>}
            <tr key={i}>
              <td><span class="z" style={`background:${ZONE_VAR[z - 1]}`} /></td>
              <td>{step.label ?? `Zone ${z}`}{step.cadence ? <span class="faint"> · {step.cadence} rpm</span> : null}</td>
              <td class="r muted">{formatDuration(step.seconds)}</td>
              <td class="r num muted">{share}</td>
              <td class={`r num${basis === 'power' ? '' : ' muted'}`}>{t.watts} W</td>
              <td class={`r num${basis === 'hr' ? '' : ' muted'}`}>{t.bpm} bpm</td>
            </tr>
          </>
        );
      })}
    </table>
  );
}
