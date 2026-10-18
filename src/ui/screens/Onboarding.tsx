import { useState } from 'preact/hooks';
import { DEFAULT_PROFILE, saveProfile } from '../../data/db';
import type { Basis, Profile } from '../../engine/types';
import { notify } from '../store';
import { APP_NAME } from '../../appName';
import { LIBRARY } from '../../library/workouts';
import { WorkoutProfile } from '../Profile';

/** First run: nothing about any one rider is assumed. */
export function Onboarding() {
  const [p, setP] = useState<Profile>({ ...DEFAULT_PROFILE });
  const upd = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const num = (k: keyof Profile) => (e: Event) => upd(k, Number((e.target as HTMLInputElement).value) as never);
  const sample = LIBRARY.find((w) => w.id === 'lib-ss-3x15')!;

  async function start() {
    await saveProfile(p);
    notify();
    location.hash = '/settings';
  }

  return (
    <main class="main" style="max-width:560px">
      <div style="margin:24px 0 28px">
        <WorkoutProfile blocks={sample.blocks} height={64} hero />
      </div>
      <h1 style="font-size:32px">{APP_NAME}</h1>
      <p class="muted" style="margin:8px 0 26px;font-size:16px;line-height:1.55">Plan the week, send each ride to your Garmin, and see what the ride did for you. Everything stays on this device. A few numbers to start; you can change them any time.</p>
      <div class="form">
        <div class="field"><label>Your name</label><input value={p.name} onInput={(e) => upd('name', (e.target as HTMLInputElement).value)} autofocus /></div>
        <div class="field"><label>FTP (watts, best guess)</label><input type="number" value={p.ftp} onInput={num('ftp')} /></div>
        <div class="field"><label>Threshold heart rate (bpm)</label><input type="number" value={p.lthr} onInput={num('lthr')} /></div>
        <div class="field"><label>Hours per week you can train</label><input type="number" step="0.5" value={p.hoursPerWeek} onInput={num('hoursPerWeek')} /></div>
      </div>
      <div class="row wrap" style="margin-top:16px;gap:18px">
        <div class="field"><label>Train by</label>
          <div class="seg"><button class={p.basis === 'power' ? 'on' : ''} onClick={() => upd('basis', 'power' as Basis)}>Power</button><button class={p.basis === 'hr' ? 'on' : ''} onClick={() => upd('basis', 'hr' as Basis)}>Heart rate</button></div></div>
        <div class="field"><label>Units</label>
          <div class="seg"><button class={p.units === 'imperial' ? 'on' : ''} onClick={() => upd('units', 'imperial')}>Miles</button><button class={p.units === 'metric' ? 'on' : ''} onClick={() => upd('units', 'metric')}>Kilometres</button></div></div>
      </div>
      <button class="btn primary block" style="margin-top:26px" onClick={start} disabled={!p.ftp || !p.lthr}>Start</button>
      <p class="faint small" style="margin-top:12px">Next: connect Intervals.icu so workouts reach your Garmin and rides come back.</p>
    </main>
  );
}
