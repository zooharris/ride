import type { Basis, Profile, WorkoutBlock, WorkoutStep } from '../engine/types';
import { formatDuration, stepBreath, stepShare, stepTargets } from '../engine/workout';
import { breathProvisional, breathTargetWords, breathZones, powerZone, ridePowerZones } from '../engine/zones';
import { ZONE_VAR } from './Profile';
import { stepName } from '../player/timeline';

/** A ride's steps with their targets in watts and in bpm, with equal weight (10 Nov 2026 evening: which one the Garmin gets is chosen when it is sent); a set shows as a heading over the steps it repeats, with a line down their left to show where it ends. */
/**
 * Step 5 (11 Nov 2026): a breathing column beside watts and heart rate, at equal weight, when the rider has breathing
 * zones and the ride works by breathing (any ride that works by heart rate); shares of the second threshold first.
 */
export function StepsTable({ blocks, profile, breath = true }: { blocks: WorkoutBlock[]; basis?: Basis; profile: Profile; breath?: boolean }) {
  const showBreath = breath && !!breathZones(profile);
  const cols = showBreath ? 7 : 6;
  const rows: Array<{ step: WorkoutStep; set?: string; inSet?: boolean; setLabel?: string }> = [];
  for (const b of blocks) {
    if (b.kind === 'step') rows.push({ step: b });
    else {
      // A set run once is just its steps; a set run more than once has its heading.
      b.steps.forEach((st, j) => rows.push({ step: st, set: j === 0 && b.times > 1 ? `${b.label ?? 'Set'} × ${b.times}` : undefined, inSet: b.times > 1, setLabel: b.label ?? (b.times > 1 ? 'Set' : undefined) }));
    }
  }
  const ladder = ridePowerZones(profile);
  return (
    <table class="steps">
      <tr><td /><td class="faint small">Step</td><td class="r faint small">Time</td><td class="r faint small share-col">% of FTP</td><td class="r faint small">Watts</td><td class="r faint small">Heart rate<span class="u-head"> (bpm)</span></td>{showBreath && <td class="r faint small" title={breathProvisional(profile) ? 'Provisional: your first breathing threshold is not yet known.' : 'Ventilation, as a share of your second breathing threshold and in litres a minute.'}>Breathing{breathProvisional(profile) ? ' (provisional)' : ''}</td>}</tr>
      {rows.map(({ step, set, inSet, setLabel }, i) => {
        const t = stepTargets(step, profile);
        const z = powerZone(step.intensity, ladder);
        const share = stepShare(step);
        return (
          <>
            {set && <tr key={`s${i}`}><td colSpan={cols} class="set">{set}</td></tr>}
            <tr key={i} class={inSet ? 'in-set' : undefined}>
              <td><span class="z" style={`background:${ZONE_VAR[z - 1]}`} /></td>
              <td>{stepName(step, z, setLabel)}{step.cadence ? <span class="faint"> · {step.cadence} rpm</span> : null}</td>
              <td class="r muted">{formatDuration(step.seconds)}</td>
              <td class="r num muted share-col">{share}</td>
              {step.allOut ? <td class="r" colSpan={2}><b>All out</b> <span class="faint small">no target</span></td> : <><td class="r num">{t.watts}<span class="u"> W</span></td>
              <td class="r num">{t.bpm}<span class="u"> bpm</span></td></>}
              {showBreath && <td class="r num breath-col">{(() => { const b = stepBreath(step, profile); if (!b) return ''; const [share, litres] = breathTargetWords(b).split(' · '); return <><span>{share}</span><span class="breath-l">{litres}</span></>; })()}</td>}
            </tr>
          </>
        );
      })}
    </table>
  );
}
