import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import type { Basis, PlannedWorkout, Profile, Workout, WorkoutStep } from '../../engine/types';
import { clock, flattenSteps, formatDuration, stepTargets, workoutStats } from '../../engine/workout';
import { powerZone, ridePowerZones } from '../../engine/zones';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';
import { WorkoutProfile, ZONE_VAR } from '../Profile';
import { Logo } from '../Brand';
import { Empty } from '../PageHead';
import { getSetting } from '../../data/db';
import { bluetoothAvailable } from '../../player/ble/web';
import { addSensor, addSimulated, forget, getSensors, reconnect, restoreSaved, setRiderNumbers, SIM_KEY, subscribe, type SensorState } from '../../player/hub';
import { KIND_WORD, pickSources, type Metric, type SensorKind, type Supplied } from '../../player/sources';
import { chooseMode } from '../../player/mode';

/** The connected sensors, redrawn as readings arrive and once a second so a sensor that falls silent shows it. */
export function useSensors(): { sensors: SensorState[]; now: number } {
  const [state, setState] = useState({ sensors: getSensors(), now: Date.now() });
  useEffect(() => {
    const off = subscribe(() => setState({ sensors: getSensors(), now: Date.now() }));
    const t = setInterval(() => setState({ sensors: getSensors(), now: Date.now() }), 1000);
    return () => { off(); clearInterval(t); };
  }, []);
  return state;
}

function back(): void {
  if (history.length > 1) history.back(); else location.hash = '/today';
}

/**
 * The ride player, before the ride (spec screen 1, as redesigned 27 Oct): the
 * workout on the left; on the right, "Ready to ride" — each number the ride
 * uses shown once, with the device it comes from — the trainer, how the ride
 * runs, and Start. Reached from "Ride indoors on the trainer"
 * (#/play/planned/<id>) or a ride's page (#/play/workout/<id>). It has the
 * whole window, without the app's menu.
 */
export function Player({ data, parts }: { data: AppData; parts: string[] }) {
  const profile = data.profile!;
  const [, how, id] = parts;
  const planned = how === 'planned' ? data.planned.find((p) => p.id === id) : undefined;
  const workout = planned ? findWorkout(data.mine, planned.workoutId) : how === 'workout' && id ? findWorkout(data.mine, id) : undefined;
  const [sim, setSim] = useState(false);
  useEffect(() => { getSetting<boolean>(SIM_KEY, false).then(setSim); }, []);
  useEffect(() => {
    setRiderNumbers({ ftp: profile.ftp, lthr: profile.lthr, restingHr: profile.restingHr, maxHr: profile.maxHr });
    if (bluetoothAvailable()) void restoreSaved();
  }, [profile.ftp, profile.lthr, profile.restingHr, profile.maxHr]);

  const bt = bluetoothAvailable();
  if (!bt && !sim) return <Frame><NoBluetooth /></Frame>;
  if (!workout || workout.kind !== 'ride') {
    return <Frame><div class="pl-empty"><Empty title="That ride isn't here" action={<button class="btn" onClick={back}>Back</button>}>It may have been removed from your calendar or your workouts on another device.</Empty></div></Frame>;
  }
  return <Frame><PreRide workout={workout} planned={planned} profile={profile} sim={sim} bt={bt} /></Frame>;
}

function Frame({ children }: { children: ComponentChildren }) {
  return (
    <div class="player">
      <header class="pl-head">
        <Logo height={24} />
        <span class="pl-head-sep" />
        <span class="pl-head-name">Ride player</span>
        <span style="flex:1" />
        <button class="btn quiet" onClick={back}>‹ Back</button>
      </header>
      {children}
    </div>
  );
}

function NoBluetooth() {
  return (
    <div class="pl-empty">
      <div class="panel" style="max-width:560px">
        <h2 style="margin-top:0">Riding with a trainer needs Chrome or Edge</h2>
        <p class="muted">This browser can't reach Bluetooth, so it can't talk to a smart trainer or sensors. Open {location.host || 'the app'} in <b>Chrome</b> or <b>Edge</b> on a computer (Mac, Windows or Chromebook). On an iPad, the free <b>Bluefy</b> browser adds Bluetooth. Safari, Firefox and every iPhone browser can't do it yet.</p>
        <p class="muted small">Everything else in the app works here as usual. To try the player without a trainer, turn on <b>Practice with a simulated trainer</b> in Settings.</p>
        <div class="row" style="margin-top:12px"><button class="btn" onClick={back}>Back</button><a class="btn quiet" href="#/help?s=player">Help</a></div>
      </div>
    </div>
  );
}

// ── The workout, left ───────────────────────────────────────────────────────

function PreRide({ workout, planned, profile, sim, bt }: { workout: Workout; planned?: PlannedWorkout; profile: Profile; sim: boolean; bt: boolean }) {
  const allowsHr = workout.bases.includes('hr');
  const [basis, setBasis] = useState<Basis>(planned?.basis ?? (workout.bases.includes(profile.basis) ? profile.basis : workout.bases[0]));
  const { sensors, now } = useSensors();
  const sources = pickSources(sensors, now);
  const choice = chooseMode(basis, sensors, sources, allowsHr);
  const s = workoutStats(workout.blocks);
  const when = planned ? (planned.date === today() ? `Today · ${fmtDate(planned.date)}` : `Planned for ${fmtDate(planned.date)}`) : 'Not on your calendar';
  const power = basis === 'power';

  return (
    <>
      {!bt && <div class="pl-banner">This browser can't reach Bluetooth: only the simulated sensors are available. For real sensors, use Chrome or Edge on a computer.</div>}
      <main class="pl-main pl-pre">
        <section class="pl-card pl-workout">
          <p class="eyebrow">{when}</p>
          <div class="pl-title-row">
            <div style="min-width:0">
              <h1>{workout.name}</h1>
              {workout.subtitle && <p class="pl-sub">{workout.subtitle}</p>}
            </div>
            {allowsHr ? (
              <div class="seg" role="group" aria-label="Targets by">
                <button class={power ? 'on' : ''} aria-pressed={power} onClick={() => setBasis('power')}>Power</button>
                <button class={!power ? 'on' : ''} aria-pressed={!power} onClick={() => setBasis('hr')}>Heart rate</button>
              </div>
            ) : <span class="faint small">Power only</span>}
          </div>
          <div class="pl-figures">
            <div><div class="caption">Duration</div><div class="pl-fig num">{clock(s.seconds)}</div></div>
            <div><div class="caption">Training load</div><div class="pl-fig num">{s.tss}<small> TSS</small></div></div>
            <div><div class="caption">Intensity</div><div class="pl-fig num">{s.intensityFactor.toFixed(2)}<small> of {power ? 'FTP' : 'threshold'}</small></div></div>
            <div><div class="caption">{power ? 'Your FTP' : 'Threshold heart rate'}</div><div class="pl-fig num">{power ? profile.ftp : profile.lthr}<small>{power ? ' W' : ' bpm'}</small></div></div>
          </div>
          <WorkoutChart workout={workout} profile={profile} basis={basis} seconds={s.seconds} />
          <StepList workout={workout} profile={profile} basis={basis} />
        </section>

        <aside class="pl-side">
          <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={!!choice.mode} />
          <section class="pl-card">
            <h2 class="pl-h2">How the ride runs</h2>
            <p class={`pl-runs ${choice.mode ? '' : 'muted'}`}>{choice.mode ? choice.says.replace(/^Ready\.\s*/, '') : choice.says}
              {choice.suggestHr && <> <button class="btn sm" onClick={() => setBasis('hr')}>Switch to heart rate</button></>}</p>
          </section>
          <div class="pl-grow" />
          <button class="btn primary pl-start" disabled>
            <svg width="15" height="17" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13a.8.8 0 0 0 1.2.7l11-6.5a.8.8 0 0 0 0-1.4l-11-6.5A.8.8 0 0 0 1 1.5z" fill="currentColor" /></svg>
            Start ride
          </button>
          <p class="pl-start-note">Riding the workout arrives with the next update.</p>
        </aside>
      </main>
    </>
  );
}

/** The workout's shape at full width with its axes: the threshold line labelled in watts or bpm, time along the bottom. Pointing at a block names it (the shared diagram's own readout). */
function WorkoutChart({ workout, profile, basis, seconds }: { workout: Workout; profile: Profile; basis: Basis; seconds: number }) {
  const steps = flattenSteps(workout.blocks);
  const maxI = Math.max(1.25, ...steps.map((st) => st.intensityHigh ?? st.intensity));
  const thresholdFromTop = (1 - 1 / maxI) * 100;
  const tick = seconds <= 90 * 60 ? 600 : seconds <= 150 * 60 ? 900 : seconds <= 240 * 60 ? 1800 : 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= seconds + 1; t += tick) ticks.push(t);
  return (
    <div class="pl-chart">
      <div class="pl-chart-y" aria-hidden="true">
        <span style={`top:calc(${thresholdFromTop}% - 7px)`}>{basis === 'power' ? `${profile.ftp} W` : `${profile.lthr} bpm`}</span>
        <span style="bottom:-7px">0</span>
      </div>
      <div class="pl-chart-plot">
        <WorkoutProfile blocks={workout.blocks} height={180} hero targets={{ profile, basis }} />
        <div class="pl-chart-x" aria-hidden="true">
          {ticks.map((t, i) => <span key={t} style={i === 0 ? 'left:0' : t >= seconds - 1 ? 'right:0' : `left:${(t / seconds) * 100}%;transform:translateX(-50%)`}>{clock(t)}</span>)}
          {ticks[ticks.length - 1] < seconds - tick / 3 && <span style="right:0">{clock(seconds)}</span>}
        </div>
      </div>
    </div>
  );
}

/** The steps, compact: a repeated set once under its heading, each step with its length and the one target that matters on this basis. */
function StepList({ workout, profile, basis }: { workout: Workout; profile: Profile; basis: Basis }) {
  const ladder = ridePowerZones(profile);
  // A step without a name of its own: inside a set, the set's name for the work and "Recovery" for the easy part; elsewhere, its zone.
  const nameOf = (st: WorkoutStep, z: number, set?: string) => st.label ?? (set ? (st.intensity < 0.6 ? 'Recovery' : set) : `Zone ${z}`);
  const row = (st: WorkoutStep, key: string, set?: string) => {
    const z = powerZone(st.intensity, ladder);
    const t = stepTargets(st, profile);
    const inSet = !!set;
    return (
      <div key={key} class={`pl-step${inSet ? ' in-set' : ''}`}>
        <span class="z" style={`background:${ZONE_VAR[z - 1]}`} />
        <span class="pl-step-name">{nameOf(st, z, set)}{st.cadence ? <span class="faint"> · {st.cadence} rpm</span> : null}</span>
        <span class="num muted">{formatDuration(st.seconds)}</span>
        <span class="num pl-step-target">{basis === 'power' ? `${t.watts} W` : `${t.bpm} bpm`}</span>
      </div>
    );
  };
  return (
    <div class="pl-steps">
      {workout.blocks.map((b, i) => b.kind === 'step' ? row(b, `${i}`) : (
        <div key={i} class="pl-set">
          <div class="pl-set-head"><span>{b.label ?? 'Set'} <b>× {b.times}</b></span></div>
          {b.steps.map((st, j) => row(st, `${i}-${j}`, b.label ?? 'Set'))}
        </div>
      ))}
    </div>
  );
}

// ── Ready to ride, right ────────────────────────────────────────────────────

const TILES: Array<{ m: Metric; label: string; from: SensorKind[]; hint: string }> = [
  { m: 'watts', label: 'Power', from: ['power', 'trainer'], hint: 'From your trainer or power meter' },
  { m: 'bpm', label: 'Heart rate', from: ['hr'], hint: '' },
  { m: 'cadence', label: 'Cadence', from: ['power', 'csc', 'trainer'], hint: 'From your trainer or power meter' },
  { m: 'speedKmh', label: 'Speed', from: ['trainer', 'csc'], hint: 'From your trainer' },
];

const STATUS_WORD: Record<SensorState['status'], string> = { connecting: 'Connecting…', connected: 'Connected', lost: 'Reconnecting…', offline: 'Not found' };

function Ready({ sensors, sources, profile, sim, bt, allSet }: { sensors: SensorState[]; sources: Partial<Record<Metric, Supplied>>; profile: Profile; sim: boolean; bt: boolean; allSet: boolean }) {
  const [menu, setMenu] = useState<'add' | 'manage' | null>(null);
  const trainer = sensors.find((s) => s.kind === 'trainer');
  const connected = sensors.filter((s) => s.status === 'connected');
  const warnings = sensors.filter((s) => s.warning);
  const add = (kind: SensorKind, simulated = false) => {
    setMenu(null);
    if (simulated || !bt) addSimulated(kind); else void addSensor(kind);
  };
  const pill = allSet ? { cls: 'ok', text: 'All set' } : sensors.length ? { cls: 'wait', text: 'Not ready yet' } : { cls: 'wait', text: 'Nothing connected yet' };

  const trainerStrip = trainer ? (
    <div class={`pl-trainer${trainer.status === 'connected' ? ' on' : ''}`}>
      <span class="pl-kind">{TRAINER_ICON}</span>
      <div style="min-width:0;flex:1">
        <div class="pl-trainer-name">{trainer.name}</div>
        <div class="muted small">{trainer.status !== 'connected' ? KIND_WORD.trainer : trainer.controllable ? 'Controls the resistance and holds each target for you' : 'Supplies its numbers; it is not taking control'}</div>
      </div>
      <span class={`pl-state ${trainer.status}`}><span class="pl-dot" />{STATUS_WORD[trainer.status]}</span>
      {trainer.status === 'offline' && !trainer.simulated && <button class="btn sm" onClick={() => void reconnect(trainer.id)}>Connect</button>}
    </div>
  ) : (
    <div class="pl-trainer vacant">
      <span class="pl-kind">{TRAINER_ICON}</span>
      <div style="min-width:0;flex:1">
        <div class="pl-trainer-name">Your smart trainer</div>
        <div class="muted small">It holds each target for you. Pedal a few strokes to wake it first.</div>
      </div>
      <button class="btn primary sm pl-connect" onClick={() => add('trainer')}>Connect trainer</button>
    </div>
  );

  return (
    <section class="pl-card">
      <div class="row between">
        <h2 class="pl-h2">{sensors.length ? 'Ready to ride' : 'Get ready to ride'}</h2>
        <span class={`pl-pill ${pill.cls}`}><span class="pl-dot" />{pill.text}</span>
      </div>
      {!trainer && trainerStrip}
      <div class="pl-tiles">
        {TILES.map((t) => {
          const src = sources[t.m];
          const from = src ? sensors.find((x) => x.id === src.from) : undefined;
          // No live value: say which device should supply it and why it isn't (dropped, not found), else how to get one.
          const waiting = !src ? sensors.find((x) => t.from.includes(x.kind) && x.status !== 'connected') : undefined;
          return (
            <div key={t.m} class={`pl-tile${src ? '' : ' vacant'}`}>
              <div class="caption">{t.label}</div>
              <div class="pl-tile-v num">{src ? fmtValue(t.m, src.value, profile) : '—'}{src && <small> {unitOf(t.m, profile)}</small>}</div>
              <div class="pl-tile-from">
                {from ? <><span class="pl-dot ok" />{from.name}</>
                  : waiting ? <><span class={`pl-dot ${waiting.status}`} />{waiting.name} · {STATUS_WORD[waiting.status].toLowerCase()}</>
                  : t.m === 'bpm' ? <button class="btn sm" onClick={() => add('hr')}>Add heart rate</button>
                  : <span>{t.hint}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {trainer && trainerStrip}
      {warnings.map((s) => <p key={s.id} class="pl-alert small">{s.warning}</p>)}
      <div class="pl-devices">
        <span class="faint small">{connected.length ? `${connected.length} device${connected.length === 1 ? '' : 's'} connected` : 'Also have a power meter or a cadence sensor?'}</span>
        <span style="flex:1" />
        <div class="menu">
          <button class="btn sm" aria-haspopup="menu" aria-expanded={menu === 'add'} onClick={() => setMenu(menu === 'add' ? null : 'add')}>Add a device</button>
          {menu === 'add' && <>
            <div class="menu-bg" onClick={() => setMenu(null)} />
            <div class="menu-list pl-menu" role="menu">
              {bt && (['trainer', 'power', 'hr', 'csc'] as SensorKind[]).map((k) => <button key={k} role="menuitem" onClick={() => add(k)}>{KIND_WORD[k]}</button>)}
              {sim && <>
                {bt && <div class="menu-title">Practice</div>}
                {(['trainer', 'power', 'hr'] as SensorKind[]).map((k) => <button key={`sim-${k}`} role="menuitem" onClick={() => add(k, true)}>Simulated {k === 'trainer' ? 'trainer' : k === 'power' ? 'power meter' : 'heart rate'}</button>)}
              </>}
            </div>
          </>}
        </div>
        {sensors.length > 0 && (
          <div class="menu">
            <button class="btn sm quiet" aria-haspopup="menu" aria-expanded={menu === 'manage'} onClick={() => setMenu(menu === 'manage' ? null : 'manage')}>Manage</button>
            {menu === 'manage' && <>
              <div class="menu-bg" onClick={() => setMenu(null)} />
              <div class="menu-list pl-menu pl-manage">
                <div class="menu-title">On this computer</div>
                {sensors.map((s) => (
                  <div key={s.id} class="pl-manage-row">
                    <div style="min-width:0;flex:1">
                      <div class="pl-manage-name">{s.name}</div>
                      <div class="faint small">{KIND_WORD[s.kind]} · {STATUS_WORD[s.status].toLowerCase()}</div>
                    </div>
                    {s.status === 'offline' && !s.simulated && <button class="btn sm" onClick={() => { setMenu(null); void reconnect(s.id); }}>Connect</button>}
                    <button class="btn sm quiet" onClick={() => { setMenu(null); if (confirm(`Forget ${s.name} on this computer?\n\nIt disconnects now. To use it again, add it again.`)) void forget(s.id); }}>Forget</button>
                  </div>
                ))}
              </div>
            </>}
          </div>
        )}
      </div>
      {!sensors.length && <p class="pl-note">Your browser asks before connecting each one. Everything you connect is remembered on this computer for next time.</p>}
    </section>
  );
}

function fmtValue(m: Metric, v: number, profile: Profile): string {
  if (m === 'speedKmh') return profile.units === 'imperial' ? (v / 1.609344).toFixed(1) : v.toFixed(1);
  return String(Math.round(v));
}

function unitOf(m: Metric, profile: Profile): string {
  return m === 'watts' ? 'W' : m === 'bpm' ? 'bpm' : m === 'cadence' ? 'rpm' : profile.units === 'imperial' ? 'mph' : 'km/h';
}

const TRAINER_ICON: JSX.Element = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="15" r="4" /><circle cx="17" cy="15" r="4" /><path d="M3 20h18" /></svg>;
