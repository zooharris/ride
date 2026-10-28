import { useEffect, useState } from 'preact/hooks';
import type { Profile, Workout, PlannedWorkout } from '../../engine/types';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { hrZone, powerZone, ridePowerZones, rideHrZones } from '../../engine/zones';
import { Mark } from '../Brand';
import { ZONE_VAR } from '../Profile';
import { toast } from '../Toast';
import { go } from '../router';
import { useSensors } from './Player';
import { controlledTrainer, type SensorState } from '../../player/hub';
import { hrZoneOf, targetBand, totalSeconds, type TimelineStep } from '../../player/timeline';
import { CUE_WORDS } from '../../player/hrCue';
import { isEffort, observation, observationHr, stepStats, timeInZone, totals, type Totals } from '../../player/summary';
import { deleteRecording, downloadRide, patchRecording, rideSeconds, uploadRide } from '../../player/rides';
import { plannedSeconds, TRIVIAL_SECONDS } from '../../sync/syncService';
import type { Recording, Sample } from '../../player/types';
import type { TrainerMode } from '../../player/engine';
import {
  clearRide, currentRide, endRide, lapNow, pauseRide, resumeRide, setRideEffort, setRideFreeWatts, setRideLevel, setRideMode, setRideScale, skipStep, subscribeRide, type ActiveRide,
} from '../rideController';

export function useRide(): ActiveRide | undefined {
  const [, set] = useState(0);
  useEffect(() => subscribeRide(() => set((n) => n + 1)), []);
  return currentRide();
}

const mmss = (s: number) => clock(Math.max(0, Math.round(s)));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mph = (kmh: number, p: Profile) => (p.units === 'imperial' ? `${(kmh / 1.609344).toFixed(1)}` : kmh.toFixed(1));
const speedUnit = (p: Profile) => (p.units === 'imperial' ? 'mph' : 'km/h');
const distText = (m: number, p: Profile) => (p.units === 'imperial' ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`);

function fullScreen() {
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {});
}

async function askEnd() {
  if (!confirm('End the ride?\n\nYou\'ll see your summary next, where you save it.')) return;
  await endRide();
}

// ── Riding (spec screen 2) ──────────────────────────────────────────────────

export function Riding({ ride, profile }: { ride: ActiveRide; profile: Profile }) {
  const { sensors } = useSensors();
  const e = ride.engine;
  const tl = ride.timeline;
  const step = e.step;
  const next = e.next;
  const then = next ? tl[next.index + 1] : undefined;
  const byHr = ride.setup.basis === 'hr';
  const t = totals(e.samples, profile.ftp, profile.lthr, undefined, ride.setup.basis);
  const planned = ride.setup.workout ? workoutStats(ride.setup.workout.blocks) : undefined;
  const trainer = controlledTrainer();
  const paused = e.phase === 'paused';
  const zoneTime = byHr && tl.length ? timeInZone(e.samples, tl, (s) => targetBand(s, 'hr', profile)) : undefined;
  const hasPower = t.avgPower != null;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.closest?.('input, textarea')) return;
      const r = currentRide();
      if (!r || r.engine.phase === 'finished') return;
      if (ev.key === ' ') { ev.preventDefault(); if (r.engine.phase === 'paused') resumeRide(); else pauseRide(); }
      else if (ev.key === '+' || ev.key === '=') nudge(r, 1);
      else if (ev.key === '-' || ev.key === '_') nudge(r, -1);
      else if (ev.key === 'e' || ev.key === 'E') void askEnd();
      else if (ev.key === 'f' || ev.key === 'F') fullScreen();
      else if (ev.key === 'l' || ev.key === 'L') lapNow();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const lost = sensors.filter((s) => s.status === 'lost');
  return (
    <div class="player fit ride">
      <header class="pl-head">
        <Mark size={28} />
        <div class="rd-title">
          <div class="rd-name">{ride.setup.workout?.name ?? 'Free ride'}</div>
          <div class="rd-sub">{ride.setup.workout?.subtitle ?? 'No workout: ride as you like'}</div>
        </div>
        <span style="flex:1" />
        <div class="rd-pills">{sensors.map((s) => <SensorPill key={s.id} s={s} mode={e.mode} />)}</div>
        <span class="pl-head-sep" />
        <button class="btn primary rd-pause" onClick={() => (paused ? resumeRide() : pauseRide())}>
          {paused ? <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13a.8.8 0 0 0 1.2.7l11-6.5a.8.8 0 0 0 0-1.4l-11-6.5A.8.8 0 0 0 1 1.5z" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button class="btn" onClick={() => void askEnd()}>End ride</button>
        <KeysHelp />
      </header>
      {lost.length > 0 && <div class="rd-lost">{lost.map((s) => s.name).join(' and ')} lost: reconnecting… The ride keeps recording.</div>}

      <main class="rd-main">
        <section class="rd-top">
          {byHr ? <HrHero ride={ride} profile={profile} trainerOk={!!trainer} /> : <Hero ride={ride} profile={profile} trainerOk={!!trainer} />}
          {tl.length ? <Dial ride={ride} step={step} next={next} then={then} profile={profile} /> : <FreeCard ride={ride} trainerOk={!!trainer} />}
          <div class="rd-col">
            {byHr ? <PowerTile watts={ride.shownWatts} sensors={sensors} /> : <HrTile bpm={ride.live.bpm} samples={e.samples} profile={profile} />}
            <section class="rd-card rd-tile">
              <span class="caption">Cadence</span>
              <div class="rd-big2 num">{ride.live.cadence != null ? Math.round(ride.live.cadence) : '—'}<small> rpm</small></div>
              <div class="rd-grow" />
              <div class="rd-tile-foot"><span>{step?.cadence ? `Target ${step.cadence} rpm` : 'Any comfortable cadence'}</span><span><b class="num">{ride.live.speedKmh != null ? mph(ride.live.speedKmh, profile) : '—'}</b> {speedUnit(profile)}</span></div>
            </section>
          </div>
        </section>

        {byHr ? (
          <section class="rd-card rd-strip" style={`grid-template-columns:repeat(${hasPower ? 6 : 5}, minmax(0, 1fr))`}>
            <div><span class="caption">Elapsed time</span><div><b class="num">{mmss(e.timer)}</b>{planned && <small> of {clock(planned.seconds)}</small>}</div></div>
            {zoneTime ? <div><span class="caption">Time in target zone</span><div><b class="num">{mmss(zoneTime.seconds)}</b>{zoneTime.share != null && <small> · {pct(zoneTime.share)} of steps</small>}</div></div>
              : <div><span class="caption">Highest heart rate</span><div><b class="num">{t.maxHr ?? '—'}</b><small> bpm</small></div></div>}
            <div><span class="caption">Average heart rate</span><div><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></div></div>
            <div><span class="caption">Training load so far</span><div><b class="num">{t.tss}</b><small>{planned ? ` of ${planned.tss} planned` : ' TSS'}</small></div></div>
            {hasPower && <div><span class="caption">Average power</span><div><b class="num">{t.avgPower}</b><small> W</small></div></div>}
            <div><span class="caption">Distance</span><div><b class="num">{distText(t.distanceM, profile).split(' ')[0]}</b><small> {profile.units === 'imperial' ? 'mi' : 'km'}</small></div></div>
          </section>
        ) : (
          <section class="rd-card rd-strip">
            <div><span class="caption">Elapsed time</span><div><b class="num">{mmss(e.timer)}</b>{planned && <small> of {clock(planned.seconds)}</small>}</div></div>
            <div><span class="caption">Average power</span><div><b class="num">{t.avgPower ?? '—'}</b><small> W</small></div></div>
            <div><span class="caption">Normalized power</span><div><b class="num">{t.np ?? '—'}</b><small> W</small></div></div>
            <div><span class="caption">Training load so far</span><div><b class="num">{t.tss}</b><small>{planned ? ` of ${planned.tss} planned` : ' TSS'}</small></div></div>
            <div><span class="caption">Average heart rate</span><div><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></div></div>
            <div><span class="caption">Work done</span><div><b class="num">{t.kj ?? '—'}</b><small> kJ</small></div></div>
          </section>
        )}

        <section class="rd-card rd-chartcard">
          <div class="rd-chart-head">
            <span class="caption">{tl.length ? 'Workout' : 'Your ride'}</span>
            {byHr ? <>
              <span class="rd-key"><i class="ln hr" />Your heart rate</span>
              {tl.length > 0 && <span class="rd-key"><i class="bx" />Target zone</span>}
              {hasPower && <span class="rd-key"><i class="ln" />Power</span>}
            </> : <>
              <span class="rd-key"><i class="ln" />Your power</span>
              {tl.length > 0 && <span class="rd-key"><i class="bx" />Target, coloured by zone</span>}
              <span class="rd-key"><i class="ln hr" />Heart rate</span>
            </>}
            <span style="flex:1" />
            {step && <button class="btn sm quiet" onClick={skipStep}>Skip this step ›</button>}
          </div>
          <RideChart timeline={tl} samples={e.samples} profile={profile} position={e.position} live by={ride.setup.basis} />
        </section>
      </main>

      {e.phase === 'countdown' && <div class="rd-overlay"><div class="rd-count num">{e.countdownLeft || 'Go'}</div><p>Get pedalling</p></div>}
      {paused && (
        <div class="rd-overlay" role="dialog" aria-label="Paused">
          <div class="rd-paused">
            <h2>{e.isAutoPaused ? 'Paused: you stopped pedalling' : 'Paused'}</h2>
            <p class="muted">{e.isAutoPaused ? 'Pedal to carry on, or press Resume.' : 'The clock has stopped and the trainer has let go.'}</p>
            <div class="row" style="gap:10px;justify-content:center;margin-top:16px">
              <button class="btn primary rd-resume" onClick={resumeRide}>Resume</button>
              <button class="btn" onClick={() => void askEnd()}>End ride</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SensorPill({ s, mode }: { s: SensorState; mode: TrainerMode }) {
  const word = s.kind === 'trainer' ? `Trainer · ${s.controllable ? MODE_WORD[mode] : 'not in control'}` : s.kind === 'power' ? 'Power' : s.kind === 'hr' ? 'Heart rate' : 'Cadence';
  return <span class={`rd-pill ${s.status}`}><i />{word}</span>;
}
const MODE_WORD: Record<TrainerMode, string> = { erg: 'ERG', resistance: 'Resistance', free: 'Free ride', self: 'your gears' };

function KeysHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div class="menu">
      <button class="icon-btn" aria-label="Keyboard keys" title="Keyboard keys" aria-expanded={open} onClick={() => setOpen(!open)}><span style="font-weight:700;font-size:14px">⌨</span></button>
      {open && <>
        <div class="menu-bg" onClick={() => setOpen(false)} />
        <div class="menu-list pl-menu rd-keys">
          <div class="menu-title">Keys</div>
          <div><kbd>Space</kbd> Pause or resume</div>
          <div><kbd>+</kbd> <kbd>−</kbd> Workout intensity, resistance level or watts</div>
          <div><kbd>L</kbd> Lap</div>
          <div><kbd>F</kbd> Full screen</div>
          <div><kbd>E</kbd> End ride</div>
        </div>
      </>}
    </div>
  );
}

/** + and −: the watts of a free ride in ERG, the resistance level, or the workout intensity on a power ride. */
function nudge(r: ActiveRide, dir: 1 | -1) {
  const e = r.engine;
  if (e.mode === 'resistance') setRideLevel(e.level + dir);
  else if (e.mode === 'erg' && !r.timeline.length) setRideFreeWatts(e.freeWatts + 5 * dir);
  else if (e.mode === 'erg' && r.setup.basis === 'power') setRideScale(e.scale + 0.01 * dir);
}

/** Riding by heart rate (spec screen 3): heart rate is the big number, against the step's zone, with the cue when you drift out of it. */
function HrHero({ ride, profile, trainerOk }: { ride: ActiveRide; profile: Profile; trainerOk: boolean }) {
  const e = ride.engine;
  const step = e.step;
  const band = step ? targetBand(step, 'hr', profile) : undefined;
  const bpm = ride.shownBpm;
  const mb = ride.markerBpm ?? bpm;
  const state = band && mb != null ? ride.band.state : undefined;
  const lo = band ? (band.low || Math.round(band.high * 0.8)) : 0;
  const span = band ? Math.max(14, (band.high - lo) * 1.1) : 1;
  const mid = band ? (lo + band.high) / 2 : 0;
  const pos = (x: number) => Math.max(0, Math.min(100, band ? ((x - (mid - span)) / (2 * span)) * 100 : 50));
  const zone = step ? hrZoneOf(step, profile) : undefined;
  const away = band && mb != null ? (mb > band.high ? Math.round(mb - band.high) : band.low && mb < band.low ? Math.round(band.low - mb) : 0) : 0;
  const cue = ride.cue ? CUE_WORDS[ride.cue] : undefined;
  return (
    <section class="rd-card rd-hero">
      <div class="row between">
        <span class="caption">Heart rate · {ride.setup.smoothing === 1 ? 'every second' : `${ride.setup.smoothing}-second average`}</span>
        {state && <span class={`rd-state ${state}`}>{state === 'on' ? 'In zone' : state === 'under' ? 'Below the zone' : 'Above the zone'}</span>}
      </div>
      <div class="rd-big num rd-hr">{bpm ?? '—'}<small>bpm</small></div>
      {band && zone ? (
        <>
          <div class="rd-target"><span class="muted">Target</span><b class="num" style={`color:${ZONE_VAR[zone - 1]}`}>Zone {zone} · {band.text.replace(/–/, ' to ')}</b></div>
          <div class="rd-band" aria-hidden="true">
            <div class="rd-band-track" />
            <div class="rd-band-ok" style={`left:${pos(band.low || lo - span)}%;width:${Math.max(2, pos(band.high) - pos(band.low || lo - span))}%`} />
            {mb != null && <div class="rd-band-mark" style={`left:${pos(mb)}%`} />}
          </div>
          <div class="rd-band-words"><span>Too easy</span><span>{mb != null ? (away === 0 ? 'In the zone' : `${away} bpm ${mb > band.high ? 'above' : 'below'} the zone`) : ''}</span><span>Too hard</span></div>
        </>
      ) : <div class="rd-target"><span class="muted">{e.workoutDone && ride.timeline.length ? 'Workout complete: ride on, or end the ride.' : 'Free ride: no target.'}</span></div>}
      <div class={`rd-cueline${cue ? ` ${ride.cue}` : ''}`} aria-live="polite">
        {cue ? <><b>{cue.head}</b><span>{cue.how}</span></> : step ? <span class="muted">{state === 'on' ? 'Holding the zone. Keep it steady.' : 'Settling in: heart rate takes a minute or two to answer a change in effort.'}</span> : null}
      </div>
      <div class="rd-grow" />
      <div class="rd-controls">
        {trainerOk && e.mode !== 'self' ? (
          <div class="seg" role="group" aria-label="Trainer">
            {(['resistance', 'free'] as TrainerMode[]).map((m) => <button key={m} class={e.mode === m ? 'on' : ''} aria-pressed={e.mode === m} onClick={() => setRideMode(m)}>{m === 'resistance' ? 'Set resistance' : 'Free ride'}</button>)}
          </div>
        ) : <span class="faint small">Riding to the zones with your gears.</span>}
        <span style="flex:1" />
        {ride.timeline.length > 0 && e.mode === 'resistance' && trainerOk && <Stepper label="Level" value={`${e.level}`} onDown={() => setRideLevel(e.level - 1)} onUp={() => setRideLevel(e.level + 1)} />}
      </div>
    </section>
  );
}

/** On a ride by heart rate: power, for interest, from whichever device supplies it. */
function PowerTile({ watts, sensors }: { watts?: number; sensors: SensorState[] }) {
  const meter = sensors.find((s) => s.kind === 'power' && s.status === 'connected');
  const trainer = sensors.find((s) => s.kind === 'trainer' && s.status === 'connected');
  const from = meter ? 'from your power meter' : trainer ? 'from your trainer' : undefined;
  return (
    <section class="rd-card rd-tile">
      <span class="caption">Power{from ? ` · ${from}` : ''}</span>
      <div class="rd-big2 num">{watts ?? '—'}<small> W</small></div>
      <div class="rd-grow" />
      <div class="faint small">{from ? 'Shown for interest, not as a target.' : 'No power source: nothing needed for a ride by heart rate.'}</div>
    </section>
  );
}

/** A free ride's centre card: what the trainer is doing, large, with + and −. */
function FreeCard({ ride, trainerOk }: { ride: ActiveRide; trainerOk: boolean }) {
  const e = ride.engine;
  const control = trainerOk && e.mode !== 'self';
  const [label, value, unit, down, up] = !control ? ['Riding with your gears', undefined, '', undefined, undefined]
    : e.mode === 'resistance' ? ['Resistance level', `${e.level}`, 'of 10', () => setRideLevel(e.level - 1), () => setRideLevel(e.level + 1)]
    : e.mode === 'erg' ? ['Holding', `${e.freeWatts}`, 'W', () => setRideFreeWatts(e.freeWatts - 5), () => setRideFreeWatts(e.freeWatts + 5)]
    : ['Flat road', undefined, '', undefined, undefined];
  return (
    <section class="rd-card rd-dial rd-free">
      <span class="caption" style="align-self:flex-start">Free ride</span>
      <div class="rd-free-body">
        <span class="muted">{label}</span>
        {value != null && <div class="rd-free-v num">{value}<small> {unit}</small></div>}
        {down && up && (
          <div class="rd-free-btns">
            <button class="btn" aria-label={`Lower ${label.toLowerCase()}`} onClick={down}>−</button>
            <button class="btn" aria-label={`Raise ${label.toLowerCase()}`} onClick={up}>+</button>
          </div>
        )}
        {value == null && <div class="num rd-dial-time">{mmss(e.timer)}</div>}
        <p class="faint small">{control ? 'Change it with the buttons or the + and − keys. Pick another way to ride under the big number.' : 'Ride as you like; end the ride when you are done.'}</p>
      </div>
    </section>
  );
}

function Hero({ ride, profile, trainerOk }: { ride: ActiveRide; profile: Profile; trainerOk: boolean }) {
  const e = ride.engine;
  const step = e.step ?? (e.workoutDone ? undefined : undefined);
  const band = step ? targetBand(step, 'power', profile, e.scale) : undefined;
  const w = ride.shownWatts;
  // The marker and the label use the calmer reading (smooth.ts); the big number stays the rider's chosen average.
  const mw = ride.markerWatts ?? w;
  const state = band && mw != null ? ride.band.state : undefined;
  const span = band ? Math.max(30, band.mid * 0.25) : 1;
  const pos = (x: number) => Math.max(0, Math.min(100, band ? ((x - (band.mid - span)) / (2 * span)) * 100 : 50));
  const ergNow = e.mode === 'erg' && trainerOk;
  return (
    <section class="rd-card rd-hero">
      <div class="row between">
        <span class="caption">Power · {ride.setup.smoothing === 1 ? 'every second' : `${ride.setup.smoothing}-second average`}</span>
        {state && <span class={`rd-state ${state}`}>{state === 'on' ? 'On target' : state === 'under' ? 'Under' : 'Over'}</span>}
      </div>
      <div class="rd-big num">{w ?? '—'}<small>W</small></div>
      {band ? (
        <>
          <div class="rd-target"><span class="muted">Target</span><b class="num" style={`color:${ZONE_VAR[step!.zone - 1]}`}>{band.text}</b><span class="faint">{pct(step!.low === step!.high ? step!.low * e.scale : ((step!.low + step!.high) / 2) * e.scale)} of FTP{ergNow ? ' · the trainer holds it' : ''}</span></div>
          <div class="rd-band" aria-hidden="true">
            <div class="rd-band-track" />
            <div class="rd-band-ok" style={`left:${pos(band.low)}%;width:${Math.max(2, pos(band.high) - pos(band.low))}%`} />
            {mw != null && <div class="rd-band-mark" style={`left:${pos(mw)}%`} />}
          </div>
          <div class="rd-band-words"><span>Too easy</span><span>{mw != null ? (state === 'on' ? 'In the band' : `${Math.abs(Math.round(mw - band.mid))} W ${mw < band.mid ? 'under' : 'over'} the target`) : ''}</span><span>Too hard</span></div>
        </>
      ) : <div class="rd-target"><span class="muted">{e.workoutDone && ride.timeline.length ? 'Workout complete: ride on, or end the ride.' : 'Free ride: no target.'}</span></div>}
      <div class="rd-grow" />
      <div class="rd-controls">
        {trainerOk ? (
          <div class="seg" role="group" aria-label="Trainer">
            {(['erg', 'resistance', 'free'] as TrainerMode[]).map((m) => <button key={m} class={e.mode === m ? 'on' : ''} aria-pressed={e.mode === m} onClick={() => setRideMode(m)}>{m === 'erg' ? (ride.timeline.length ? 'ERG' : 'Hold watts') : m === 'resistance' ? 'Resistance' : 'Free ride'}</button>)}
          </div>
        ) : <span class="faint small">{ride.timeline.length ? "You're riding to the targets yourself." : 'Riding with your gears.'}</span>}
        <span style="flex:1" />
        {!ride.timeline.length ? null : e.mode === 'resistance' && trainerOk ? (
          <Stepper label="Level" value={`${e.level}`} onDown={() => setRideLevel(e.level - 1)} onUp={() => setRideLevel(e.level + 1)} />
        ) : e.mode !== 'free' && ride.timeline.length > 0 ? (
          <Stepper label="Intensity" value={pct(e.scale)} onDown={() => setRideScale(e.scale - 0.01)} onUp={() => setRideScale(e.scale + 0.01)} />
        ) : null}
      </div>
    </section>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <div class="rd-stepper">
      <span class="faint small">{label}</span>
      <button class="btn" aria-label={`Lower ${label.toLowerCase()}`} onClick={onDown}>−</button>
      <b class="num">{value}</b>
      <button class="btn" aria-label={`Raise ${label.toLowerCase()}`} onClick={onUp}>+</button>
    </div>
  );
}

function Dial({ ride, step, next, then, profile }: { ride: ActiveRide; step?: TimelineStep; next?: TimelineStep; then?: TimelineStep; profile: Profile }) {
  const e = ride.engine;
  const C = 2 * Math.PI * 110;
  const arc = C * 0.75;
  if (!step) {
    return (
      <section class="rd-card rd-dial">
        <span class="caption">{ride.timeline.length ? 'Workout complete' : 'Free ride'}</span>
        <div class="rd-dial-done">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-6.5" /></svg>
          <div class="num rd-dial-time">{mmss(e.timer)}</div>
          <p class="muted">{ride.timeline.length ? 'Keep riding as long as you like, or end the ride.' : 'Ride as you like; end the ride when you are done.'}</p>
        </div>
      </section>
    );
  }
  const done = e.position - step.start;
  const left = step.end - e.position;
  const frac = Math.max(0, Math.min(1, done / step.seconds));
  const band = (s: TimelineStep) => targetBand(s, ride.setup.basis, profile, e.scale).text;
  const index = step.index + 1, of = ride.timeline.length;
  return (
    <section class="rd-card rd-dial">
      <div class="row between" style="align-self:stretch">
        <span class="caption">Step {index} of {of}</span>
        {(() => { const z = ride.setup.basis === 'hr' ? hrZoneOf(step, profile) : step.zone; return <span class="rd-zone" style={`--c:${ZONE_VAR[z - 1]}`}>Zone {z} · {step.name}</span>; })()}
      </div>
      <div class="rd-ring">
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <g transform="rotate(135 130 130)" fill="none" stroke-width="14" stroke-linecap="round">
            <circle cx="130" cy="130" r="110" stroke="var(--line)" stroke-dasharray={`${arc} ${C}`} />
            <circle cx="130" cy="130" r="110" stroke="var(--accent)" stroke-dasharray={`${arc * frac} ${C}`} />
          </g>
        </svg>
        <div class="rd-ring-text">
          <span class="num rd-dial-time">{mmss(left)}</span>
          <span class="muted">left in this step</span>
          <span class="faint small">{mmss(done)} of {mmss(step.seconds)} done{step.setNote ? <><br />{step.setNote}</> : null}</span>
        </div>
      </div>
      {step.cadence ? <p class="rd-cue">Hold about {step.cadence} rpm.</p> : <p class="rd-cue">{step.work ? 'Settle in and hold it steady.' : 'Easy: spin and recover.'}</p>}
      <div class="rd-grow" />
      <div class="rd-next">
        {next ? <div><span class="caption">Next</span><i style={`background:${ZONE_VAR[(ride.setup.basis === 'hr' ? hrZoneOf(next, profile) : next.zone) - 1]}`} /><b>{next.name}</b><span class="num muted">{mmss(next.seconds)} · {band(next)}</span></div>
          : <div><span class="caption">Next</span><i style="background:var(--good)" /><b>Workout complete</b><span class="muted">ride on, or end</span></div>}
        {then && <div><span class="caption">Then</span><i style={`background:${ZONE_VAR[(ride.setup.basis === 'hr' ? hrZoneOf(then, profile) : then.zone) - 1]}`} /><span class="muted">{then.name}</span><span class="num muted">{mmss(then.seconds)} · {band(then)}</span></div>}
      </div>
    </section>
  );
}

function HrTile({ bpm, samples, profile }: { bpm?: number; samples: Sample[]; profile: Profile }) {
  const zone = bpm ? hrZone(bpm / profile.lthr, rideHrZones(profile)) : undefined;
  const last = samples.slice(-600).map((s) => s.hr).filter((x): x is number => x != null && x > 0);
  const lo = last.length ? Math.min(...last) - 3 : 0, hi = last.length ? Math.max(...last) + 3 : 1;
  const pts = last.map((h, i) => `${(i / Math.max(1, last.length - 1)) * 200},${40 - ((h - lo) / Math.max(1, hi - lo)) * 36 - 2}`).join(' ');
  const trend = last.length > 120 ? Math.round(((last[last.length - 1] - last[Math.max(0, last.length - 121)]) / 2) * 10) / 10 : undefined;
  return (
    <section class="rd-card rd-tile">
      <div class="row between"><span class="caption">Heart rate</span>{zone && <span class="rd-zone" style={`--c:${ZONE_VAR[zone - 1]}`}>Zone {zone}</span>}</div>
      <div class="rd-big2 num rd-hr">{bpm != null ? Math.round(bpm) : '—'}<small> bpm</small></div>
      <div class="rd-grow" />
      {last.length > 10 && <svg class="rd-spark" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke="var(--z6)" stroke-width="2" vector-effect="non-scaling-stroke" /></svg>}
      <div class="faint small">{last.length > 10 ? `Last ${(() => { const m = Math.min(10, Math.round(last.length / 60)) || 1; return m === 1 ? 'minute' : `${m} minutes`; })()}${trend != null && Math.abs(trend) >= 0.5 ? ` · ${trend > 0 ? 'rising' : 'falling'} ${Math.abs(trend)} bpm a minute` : ' · steady'}` : 'Heart rate over the last ten minutes appears here.'}</div>
    </section>
  );
}

/**
 * The workout's targets as zone-coloured blocks with the ride drawn over them,
 * and a strip beneath, on one time axis. By power: power over the watts
 * targets, heart rate beneath. By heart rate: heart rate over the zone bands,
 * power beneath (when there is any).
 */
export function RideChart({ timeline, samples, profile, position, live, by = 'power' }: { timeline: TimelineStep[]; samples: Sample[]; profile: Profile; position?: number; live?: boolean; by?: 'power' | 'hr' }) {
  // A free ride's chart starts ten minutes wide and grows with the ride.
  const total = Math.max(totalSeconds(timeline), samples.length ? (samples[samples.length - 1].p ?? samples.length) + 1 : 0, timeline.length ? 60 : 600);
  const W = 1000, H = 200, HH = 56;
  const x = (sec: number) => (sec / total) * W;
  const byHr = by === 'hr';
  const ws = samples.map((s) => s.w ?? 0);
  const hrs = samples.map((s) => s.hr).filter((h): h is number => h != null && h > 0);
  const hasPower = samples.some((s) => s.w != null);
  // The main plot's scale: watts from 0, or bpm across the useful range.
  const bands = byHr ? timeline.map((s) => targetBand(s, 'hr', profile)) : [];
  const top = byHr ? Math.max(profile.maxHr, ...hrs, ...bands.map((b) => b.high + 5)) : Math.max(profile.ftp * 1.25, ...timeline.map((s) => s.high * profile.ftp * 1.1), ...(ws.length ? [Math.max(...ws) * 1.05] : []));
  const bottom = byHr ? Math.min(Math.round(profile.lthr * 0.55), ...hrs.map((h) => h - 5)) : 0;
  const y = (v: number) => H - ((v - bottom) / Math.max(1, top - bottom)) * H;
  // The strip beneath: heart rate (by power) or power (by heart rate).
  const stripVals = byHr ? ws : hrs;
  const slo = byHr ? 0 : Math.min(80, ...hrs), shi = byHr ? Math.max(100, ...ws) * 1.05 : Math.max(profile.maxHr, ...hrs);
  const sy = (v: number) => HH - ((v - slo) / Math.max(1, shi - slo)) * (HH - 4) - 2;
  // The main line, smoothed over 5 s so it reads at a glance.
  const val = (s: Sample) => (byHr ? s.hr : s.w);
  const line = samples.map((s, i) => {
    const from = Math.max(0, i - 4);
    let sum = 0, n = 0; for (let k = from; k <= i; k++) { const v = val(samples[k]); if (v != null && v > 0) { sum += v; n++; } }
    return n ? `${x(s.p ?? i).toFixed(1)},${y(sum / n).toFixed(1)}` : '';
  }).filter(Boolean).join(' ');
  const strip = byHr
    ? (hasPower ? samples.map((s, i) => `${x(s.p ?? i).toFixed(1)},${sy(s.w ?? 0).toFixed(1)}`).join(' ') : '')
    : samples.filter((s) => s.hr).map((s, i) => `${x(s.p ?? i).toFixed(1)},${sy(s.hr!).toFixed(1)}`).join(' ');
  const tick = total <= 12 * 60 ? 120 : total <= 35 * 60 ? 300 : total <= 90 * 60 ? 600 : total <= 150 * 60 ? 900 : total <= 240 * 60 ? 1800 : 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += tick) ticks.push(t);
  const nowX = position != null ? x(position) : undefined;
  const ladder = ridePowerZones(profile);
  const threshold = byHr ? profile.lthr : profile.ftp;
  return (
    <div class="rd-chart">
      <div class="rd-chart-pw">
        <svg class="rd-chart-p" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={byHr ? "Heart rate over the workout's zones" : "Power over the workout's targets"}>
          {timeline.map((s, i) => {
            const done = position != null && s.start < position;
            const op = done || !live ? 0.42 : 0.2;
            if (byHr) {
              const b = bands[i];
              const y1 = y(b.high), y0 = b.low ? y(b.low) : H;
              return <rect key={s.index} x={x(s.start)} y={y1} width={Math.max(0.5, x(s.end) - x(s.start) - 0.6)} height={Math.max(1, y0 - y1)} fill={ZONE_VAR[hrZoneOf(s, profile) - 1]} opacity={op} />;
            }
            const t = y(((s.low + s.high) / 2) * profile.ftp);
            return <rect key={s.index} x={x(s.start)} y={t} width={Math.max(0.5, x(s.end) - x(s.start) - 0.6)} height={H - t} fill={ZONE_VAR[powerZone((s.low + s.high) / 2, ladder) - 1]} opacity={op} />;
          })}
          <line x1="0" x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--ink-3)" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" />
          {line && <polyline points={line} fill="none" stroke={byHr ? 'var(--z6)' : 'var(--ink)'} stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />}
          {nowX != null && live && <line x1={nowX} x2={nowX} y1="0" y2={H} stroke="var(--today)" stroke-width="2" vector-effect="non-scaling-stroke" />}
        </svg>
        <span class="rd-ftp" style={`top:calc(${(y(threshold) / H) * 100}% - 15px)`}>{byHr ? `Threshold ${profile.lthr} bpm` : `FTP ${profile.ftp} W`}</span>
      </div>
      {(!byHr || hasPower) && (
        <svg class="rd-chart-h" viewBox={`0 0 ${W} ${HH}`} preserveAspectRatio="none" role="img" aria-label={byHr ? 'Power' : 'Heart rate'}>
          <rect x="0" y="0" width={W} height={HH} fill="var(--bg)" />
          {strip && stripVals.length > 0 && <polyline points={strip} fill="none" stroke={byHr ? 'var(--ink-2)' : 'var(--z6)'} stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />}
          {nowX != null && live && <line x1={nowX} x2={nowX} y1="0" y2={HH} stroke="var(--today)" stroke-width="2" vector-effect="non-scaling-stroke" />}
        </svg>
      )}
      <div class="rd-chart-x" aria-hidden="true">
        {ticks.map((t, i) => <span key={t} style={i === 0 ? 'left:0' : `left:${(t / total) * 100}%;transform:translateX(-50%)`}>{clock(t)}</span>)}
        {nowX != null && live && <span class="now" style={`left:${(nowX / W) * 100}%;transform:translateX(-50%)`}>Now</span>}
      </div>
    </div>
  );
}

// ── Ride complete (spec screen 4) ───────────────────────────────────────────

export function RideDone({ rec, workout, planned, timeline, profile, recovered }: { rec: Recording; workout?: Workout; planned?: PlannedWorkout; timeline: TimelineStep[]; profile: Profile; recovered?: boolean }) {
  const byHr = rec.basis === 'hr';
  const t: Totals = totals(rec.samples, rec.ftp, rec.lthr, undefined, rec.basis);
  const plannedStats = workout ? workoutStats(workout.blocks) : undefined;
  const bandOf = (s: TimelineStep) => targetBand(s, rec.basis, profile);
  const stats = stepStats(rec.samples, timeline, bandOf, rec.basis);
  const work = stats.filter((s) => isEffort(s.step, rec.basis) && s.seconds > 0);
  const doneSteps = stats.filter((s) => s.seconds >= s.step.seconds * 0.9).length;
  const note = byHr ? observationHr(stats) : observation(stats);
  const zoneTime = byHr && timeline.length ? timeInZone(rec.samples, timeline, bandOf) : undefined;
  const [rpe, setRpe] = useState<number | undefined>(rec.rpe);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'waiting'>(rec.activityId ? 'saved' : 'idle');
  const [said, setSaid] = useState<string>('');
  const want = plannedSeconds(workout);
  const short = !!workout && (rideSeconds(rec) < TRIVIAL_SECONDS || (!!want && rideSeconds(rec) < want * 0.2));
  const hasPower = t.avgPower != null;
  const when = new Date(rec.startMs);

  const pick = async (n: number) => {
    const v = rpe === n ? undefined : n;
    setRpe(v);
    await setRideEffort(v);
    await patchRecording(rec.id, { rpe: v });
  };
  const save = async () => {
    setState('saving');
    const r = await uploadRide(rec.id);
    setSaid(r.text);
    setState(r.ok ? 'saved' : 'waiting');
    toast({ ok: r.ok, text: r.text });
  };
  const done = () => { clearRide(); go('today'); };
  const discard = async () => {
    if (!confirm('Discard this ride?\n\nIt won\'t be saved anywhere.')) return;
    await deleteRecording(rec.id);
    clearRide();
    go('today');
  };

  return (
    <div class="player">
      <header class="pl-head">
        <Mark size={28} />
        <span class="rd-name">Ride complete</span>
        <span style="flex:1" />
        {state === 'saved' && <button class="btn primary" onClick={done}>Done</button>}
      </header>
      <main class="pl-main rd-done">
        <section class="rd-done-head">
          <div class="rd-done-title">
            <p class="eyebrow">{recovered ? 'Recovered ride · ' : ''}{when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</p>
            <h1>{rec.name}</h1>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              {short ? <span class="pill">Too short to count as this workout: saved as a ride on its own</span>
                : planned && planned.date === rec.date ? <span class="rd-state on">Today's planned session</span> : workout ? <span class="pill">Goes on {rec.date === today() ? "today's" : 'its day\'s'} calendar as done</span> : null}
              {timeline.length > 0 && <span class="pill">{doneSteps === timeline.length ? `All ${timeline.length} steps done` : `${doneSteps} of ${timeline.length} steps done`}</span>}
            </div>
          </div>
          {byHr ? (
          <div class="rd-card rd-figs" style={`grid-template-columns:repeat(${hasPower ? 6 : 5}, minmax(0, 1fr))`}>
            <div><span class="caption">Duration</span><b class="num">{clock(t.seconds)}</b></div>
            <div><span class="caption">Training load</span><span><b class="num">{t.tss}</b><small>{plannedStats ? ` TSS · ${plannedStats.tss} planned` : ' TSS'}</small></span></div>
            <div><span class="caption">Average heart rate</span><span><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></span></div>
            {zoneTime ? <div><span class="caption">Time in target zone</span><span><b class="num">{clock(zoneTime.seconds)}</b>{zoneTime.share != null && <small> · {pct(zoneTime.share)}</small>}</span></div>
              : <div><span class="caption">Highest heart rate</span><span><b class="num">{t.maxHr ?? '—'}</b><small> bpm</small></span></div>}
            {hasPower && <div><span class="caption">Average power</span><span><b class="num">{t.avgPower}</b><small> W</small></span></div>}
            <div><span class="caption">Distance</span><b class="num">{distText(t.distanceM, profile)}</b></div>
          </div>
          ) : (
          <div class="rd-card rd-figs">
            <div><span class="caption">Duration</span><b class="num">{clock(t.seconds)}</b></div>
            <div><span class="caption">Training load</span><span><b class="num">{t.tss}</b><small>{plannedStats ? ` TSS · ${plannedStats.tss} planned` : ' TSS'}</small></span></div>
            {hasPower ? <>
              <div><span class="caption">Normalized power</span><span><b class="num">{t.np}</b><small> W</small></span></div>
              <div><span class="caption">Average power</span><span><b class="num">{t.avgPower}</b><small> W</small></span></div>
            </> : <>
              <div><span class="caption">Distance</span><b class="num">{distText(t.distanceM, profile)}</b></div>
              <div><span class="caption">Highest heart rate</span><span><b class="num">{t.maxHr ?? '—'}</b><small> bpm</small></span></div>
            </>}
            <div><span class="caption">Average heart rate</span><span><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></span></div>
            <div><span class="caption">{hasPower ? 'Work done' : 'Average cadence'}</span><span><b class="num">{hasPower ? t.kj : t.avgCadence ?? '—'}</b><small>{hasPower ? ' kJ' : ' rpm'}</small></span></div>
          </div>
          )}
        </section>

        <section class="rd-card rd-chartcard">
          <div class="rd-chart-head"><span class="caption">The ride</span>{byHr ? <>
            <span class="rd-key"><i class="ln hr" />Your heart rate</span>{timeline.length > 0 && <span class="rd-key"><i class="bx" />Target zone</span>}{hasPower && <span class="rd-key"><i class="ln" />Power</span>}
          </> : <>
            <span class="rd-key"><i class="ln" />Your power</span>{timeline.length > 0 && <span class="rd-key"><i class="bx" />Target, coloured by zone</span>}<span class="rd-key"><i class="ln hr" />Heart rate</span>
          </>}</div>
          <RideChart timeline={timeline} samples={rec.samples} profile={profile} by={rec.basis} />
        </section>

        <section class="rd-done-grid">
          <div class="rd-card">
            {work.length > 0 ? (
              <>
                <h2 class="pl-h2">{work.length === 1 ? 'The effort' : `The ${work.length === 2 ? 'two' : work.length === 3 ? 'three' : work.length} efforts`}</h2>
                <table class="rd-table">
                  {byHr ? <>
                  <thead><tr><th>Step</th><th>Average heart rate</th><th>Time in zone</th><th>Highest heart rate</th>{hasPower && <th>Average power</th>}</tr></thead>
                  <tbody>{work.map((s) => (
                    <tr key={s.step.index}>
                      <td><i style={`background:${ZONE_VAR[hrZoneOf(s.step, profile) - 1]}`} />{s.step.name}{s.step.setNote ? <span class="faint"> · {s.step.setNote}</span> : null}</td>
                      <td class="num">{s.avgHr != null ? `${s.avgHr} bpm` : '—'}</td>
                      <td class={`num ${s.onTarget != null && s.onTarget >= 0.8 ? 'good' : ''}`}>{s.onTarget != null ? pct(s.onTarget) : '—'}</td>
                      <td class="num">{s.maxHr != null ? `${s.maxHr} bpm` : '—'}</td>
                      {hasPower && <td class="num">{s.avgPower != null ? `${s.avgPower} W` : '—'}</td>}
                    </tr>
                  ))}</tbody>
                  </> : <>
                  <thead><tr><th>Step</th><th>Average power</th><th>Time on target</th><th>Average heart rate</th><th>Highest heart rate</th></tr></thead>
                  <tbody>{work.map((s) => (
                    <tr key={s.step.index}>
                      <td><i style={`background:${ZONE_VAR[s.step.zone - 1]}`} />{s.step.name}{s.step.setNote ? <span class="faint"> · {s.step.setNote}</span> : null}</td>
                      <td class="num">{s.avgPower != null ? `${s.avgPower} W` : '—'}</td>
                      <td class={`num ${s.onTarget != null && s.onTarget >= 0.8 ? 'good' : ''}`}>{s.onTarget != null ? pct(s.onTarget) : '—'}</td>
                      <td class="num">{s.avgHr != null ? `${s.avgHr} bpm` : '—'}</td>
                      <td class="num">{s.maxHr != null ? `${s.maxHr} bpm` : '—'}</td>
                    </tr>
                  ))}</tbody>
                  </>}
                </table>
              </>
            ) : <><h2 class="pl-h2">The ride</h2><p class="muted">{timeline.length ? 'No hard efforts in this workout to compare.' : 'A free ride: no workout to compare against.'}</p></>}
            {note && <div class="rd-note"><span class="pl-kind">↗</span><p>{note}</p></div>}
          </div>

          <div class="rd-card rd-save">
            <div>
              <h2 class="pl-h2">How hard did that feel?</h2>
              <p class="faint small" style="margin:2px 0 10px">Optional. The coach uses it alongside your numbers.</p>
              <div class="rd-effort" role="group" aria-label="Effort from 1 to 10">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <button key={n} class={`chip${rpe === n ? ' on' : ''}`} aria-pressed={rpe === n} onClick={() => void pick(n)}>{n}</button>)}
              </div>
              <div class="rd-effort-words faint small"><span>Very easy</span><span>All out</span></div>
            </div>
            <div class="rd-grow" />
            {state === 'saved' ? (
              <div class="rd-saved"><span class="rd-state on">Saved</span><span class="small">{said || 'In Intervals.icu.'}</span></div>
            ) : (
              <button class="btn primary rd-savebtn" disabled={state === 'saving'} onClick={() => void save()}>{state === 'saving' ? 'Saving…' : state === 'waiting' ? 'Try saving again' : 'Save to Intervals.icu'}</button>
            )}
            <div class="row" style="gap:10px">
              <button class="btn" style="flex:1" onClick={() => downloadRide(rec)}>Download the ride file</button>
              {state !== 'saved' && <button class="btn danger" style="flex:1" onClick={() => void discard()}>Discard ride…</button>}
              {state === 'waiting' && <button class="btn quiet" onClick={done}>Done for now</button>}
            </div>
            <p class="faint small" style="text-align:center;margin:0">{state === 'waiting' ? 'The ride is kept on this computer and tried again each time the app opens.' : 'A copy stays on this computer until the upload succeeds.'}</p>
          </div>
        </section>
      </main>
    </div>
  );
}
