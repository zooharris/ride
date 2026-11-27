import type { TrainerMode } from '../player/engine';

/**
 * The trainer choice (27 Nov 2026): the same names on every ride, in equal parts. ERG means the trainer does the
 * holding, whatever the ride is ridden by; where there is room, a line under each name says what it does.
 */
export function TrainerSeg({ modes, value, onPick, by, free }: { modes: TrainerMode[]; value: TrainerMode; onPick: (m: TrainerMode) => void; by: 'power' | 'hr' | 'breath'; free?: boolean }) {
  const name = (m: TrainerMode) => (m === 'erg' ? (free ? 'Hold watts' : 'ERG') : m === 'resistance' ? 'Resistance' : 'Free ride');
  const does = (m: TrainerMode) => (m === 'erg' ? (free ? 'trainer holds the watts' : by === 'power' ? 'trainer holds the power' : 'trainer holds the zone') : m === 'resistance' ? 'you set the level' : 'you use your gears');
  return (
    <div class="seg tseg" role="group" aria-label="Trainer">
      {modes.map((m) => <button key={m} class={value === m ? 'on' : ''} aria-pressed={value === m} aria-label={name(m)} title={does(m)} onClick={() => onPick(m)}><b>{name(m)}</b><small>{does(m)}</small></button>)}
    </div>
  );
}
