import { KIND_ICON } from '../icons';
import type { SessionKind } from '../../engine/types';

const KINDS: Array<{ kind: Exclude<SessionKind, 'other'>; title: string; text: string }> = [
  { kind: 'ride', title: 'Ride', text: 'Steps and intervals by power or heart rate, sent to your Garmin.' },
  { kind: 'strength', title: 'Strength', text: 'Exercises for your equipment, with sets, reps and load.' },
  { kind: 'mobility', title: 'Mobility', text: 'Stretches and how long to hold each one.' },
  { kind: 'walk', title: 'Walk', text: 'Treadmill or outdoors, with or without a weighted pack.' },
];

/** The first step of Build: say what kind of session this is. */
export function BuildChooser() {
  return (
    <div>
      <a href="#/library" class="btn quiet sm" style="margin-left:-10px;margin-bottom:8px">‹ Library</a>
      <div class="page-head"><h1>Build</h1></div>
      <p class="muted" style="margin:0 0 16px">What kind of session?</p>
      <div class="grid">
        {KINDS.map((k) => (
          <a key={k.kind} class="wcard" href={`#/build?kind=${k.kind}`} style="display:flex;flex-direction:column;gap:8px">
            <span style="color:var(--accent)">{KIND_ICON[k.kind]({ size: 26 })}</span>
            <h3 style="margin:0">{k.title}</h3>
            <p class="muted small" style="margin:0">{k.text}</p>
          </a>
        ))}
      </div>
      <div style="margin-top:18px"><a class="btn quiet" href="#/library">Cancel</a></div>
    </div>
  );
}
