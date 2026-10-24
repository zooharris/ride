import type { Basis, Profile, WorkoutBlock, WorkoutStep } from '../engine/types';
import { formatDuration, stepShare, stepTargets } from '../engine/workout';
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
  return (
    <table class="steps">
      <tr><td /><td class="faint small">Step</td><td class="r faint small">Time</td><td class="r faint small">% of FTP</td><td class={`r faint small${basis === 'power' ? '' : ' muted basis-off'}`}>Watts</td><td class={`r faint small${basis === 'hr' ? '' : ' muted basis-off'}`}>Heart rate</td></tr>
      {rows.map(({ step, set }, i) => {
        const t = stepTargets(step, profile);
        const z = powerZone(step.intensity, ladder);
        const share = stepShare(step);
        return (
          <>
            {set && <tr key={`s${i}`}><td colSpan={6} class="set">{set}</td></tr>}
            <tr key={i}>
              <td><span class="z" style={`background:${ZONE_VAR[z - 1]}`} /></td>
              <td>{step.label ?? `Zone ${z}`}{step.cadence ? <span class="faint"> · {step.cadence} rpm</span> : null}</td>
              <td class="r muted">{formatDuration(step.seconds)}</td>
              <td class="r num muted">{share}</td>
              <td class={`r num${basis === 'power' ? '' : ' muted basis-off'}`}>{t.watts} W</td>
              <td class={`r num${basis === 'hr' ? '' : ' muted basis-off'}`}>{t.bpm} bpm</td>
            </tr>
          </>
        );
      })}
    </table>
  );
}
