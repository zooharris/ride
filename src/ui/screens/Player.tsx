import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Fragment, type ComponentChildren } from 'preact';
import type { AppData } from '../store';
import { allWorkouts, findWorkout } from '../store';
import { hrAlternatives } from '../../player/alternatives';
import type { Basis, PlannedWorkout, Profile, Workout, WorkoutStep } from '../../engine/types';
import { clock, flattenSteps, formatDuration, stepTargets, workoutStats } from '../../engine/workout';
import { powerZone, ridePowerZones } from '../../engine/zones';
import { today } from '../../engine/load';
import { fmtDate } from '../derived';
import { WorkoutProfile, ZONE_VAR } from '../Profile';
import { Logo } from '../Brand';
import { Empty } from '../PageHead';
import { getSetting, setSetting } from '../../data/db';
import { buildTimeline } from '../../player/timeline';
import { getRecording, patchRecording } from '../../player/rides';
import type { Recording } from '../../player/types';
import type { TrainerMode } from '../../player/engine';
import { startRide } from '../rideController';
import { Riding, RideDone, useRide } from './RideScreens';
import { bluetoothAvailable } from '../../player/ble/web';
import { platform } from '../../player/platform';
import { APP_NAME } from '../../appName';
import { addSensor, addSimulated, forget, getSensors, reconnect, restoreSaved, setRiderNumbers, SIM_KEY, subscribe, type SensorState } from '../../player/hub';
import { pickSources, type Metric, type SensorKind, type Supplied } from '../../player/sources';
import { chooseFreeMode, chooseMode } from '../../player/mode';
import { ADD_TITLE, cleanName, deviceBoxes, KIND_CAPTION, KIND_NOUN, pillFor, WAKE } from '../../player/devices';

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
 * workout on the left; on the right, "Your devices" (a box per kind of device,
 * its numbers live), how the ride runs, and Start. Reached from "Ride indoors on the trainer"
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

  const ride = useRide();
  const [recovered, setRecovered] = useState<Recording | null | undefined>(undefined);
  useEffect(() => {
    if (how !== 'recovered' || !id) return;
    // A ride the browser closed in the middle of: it ends where the recording stopped.
    getRecording(id).then(async (r) => {
      if (r && r.status === 'recording') { r = { ...r, status: 'finished' }; await patchRecording(r.id, { status: 'finished' }); }
      setRecovered(r ?? null);
    });
  }, [how, id]);

  if (ride) {
    if (ride.engine.phase !== 'finished') return <Riding ride={ride} profile={profile} />;
    return <RideDone rec={ride.rec} workout={ride.setup.workout} planned={ride.setup.planned} timeline={ride.timeline} profile={profile} />;
  }
  if (how === 'recovered') {
    if (recovered === undefined) return <Frame><div class="pl-empty" /></Frame>;
    if (!recovered) return <Frame><div class="pl-empty"><Empty title="That ride isn't here" action={<button class="btn" onClick={back}>Back</button>}>It has already been saved or discarded.</Empty></div></Frame>;
    const w = recovered.workoutId ? findWorkout(data.mine, recovered.workoutId) : undefined;
    const p = recovered.plannedId ? data.planned.find((x) => x.id === recovered.plannedId) : undefined;
    return <RideDone rec={recovered} workout={w} planned={p} timeline={w ? buildTimeline(w, profile) : []} profile={profile} recovered />;
  }
  const bt = bluetoothAvailable();
  if (!bt && !sim) return <Frame><NoBluetooth /></Frame>;
  if (how === 'free') return <Frame fit><FreePre profile={profile} sim={sim} bt={bt} /></Frame>;
  if (!workout || workout.kind !== 'ride') {
    return <Frame><div class="pl-empty"><Empty title="That ride isn't here" action={<button class="btn" onClick={back}>Back</button>}>It may have been removed from your calendar or your workouts on another device.</Empty></div></Frame>;
  }
  return <Frame fit><PreRide workout={workout} planned={planned} profile={profile} sim={sim} bt={bt} mine={data.mine} /></Frame>;
}

function Frame({ children, fit }: { children: ComponentChildren; fit?: boolean }) {
  return (
    <div class={`player${fit ? ' fit' : ''}`}>
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
  const where = platform();
  const [head, text] = where === 'iphone'
    ? ['Riding with a trainer needs a computer or an iPad', <>An iPhone's browsers can't reach Bluetooth, so they can't talk to a smart trainer or sensors. Open {APP_NAME} in <b>Chrome</b> or <b>Edge</b> on a computer (Mac, Windows or Chromebook), or in the free <b>Bluefy</b> browser on an iPad.</>]
    : where === 'ipad'
      ? ['Riding with a trainer on an iPad needs the Bluefy browser', <>Safari on an iPad can't reach Bluetooth, so it can't talk to a smart trainer or sensors. Open {APP_NAME} in the free <b>Bluefy</b> browser on this iPad, or in <b>Chrome</b> or <b>Edge</b> on a computer.</>]
      : ['Riding with a trainer needs Chrome or Edge', <>This browser can't reach Bluetooth, so it can't talk to a smart trainer or sensors. Open {APP_NAME} in <b>Chrome</b> or <b>Edge</b> on this computer (Mac, Windows or Chromebook).</>];
  return (
    <div class="pl-empty">
      <div class="panel" style="max-width:560px">
        <h2 style="margin-top:0">{head}</h2>
        <p class="muted">{text}</p>
        <p class="muted small">Everything else in the app works here as usual. To try the player without a trainer, turn on <b>Practice with a simulated trainer</b> in Settings.</p>
        <div class="row" style="margin-top:12px"><button class="btn" onClick={back}>Back</button><a class="btn quiet" href="#/help?s=player">Help</a></div>
      </div>
    </div>
  );
}

// ── The workout, left ───────────────────────────────────────────────────────

function PreRide({ workout, planned, profile, sim, bt, mine }: { workout: Workout; planned?: PlannedWorkout; profile: Profile; sim: boolean; bt: boolean; mine: Workout[] }) {
  const allowsHr = workout.bases.includes('hr');
  const [basis, setBasis] = useState<Basis>(planned?.basis ?? (workout.bases.includes(profile.basis) ? profile.basis : workout.bases[0]));
  const { sensors, now } = useSensors();
  const sources = pickSources(sensors, now);
  const choice = chooseMode(basis, sensors, sources, allowsHr);
  const s = workoutStats(workout.blocks);
  const when = planned ? (planned.date === today() ? `Today · ${fmtDate(planned.date)}` : `Planned for ${fmtDate(planned.date)}`) : 'Not on your calendar';
  const power = basis === 'power';
  const alternatives = useMemo(() => (allowsHr ? [] : hrAlternatives(workout, allWorkouts(mine), 5)), [workout.id, allowsHr, mine]);
  const prefs = usePrefs();
  const [chosenMode, setMode] = useState<TrainerMode>('erg');
  // Riding by heart rate in this update: the trainer gives you a road (set resistance or flat) and you ride to the zones with your gears.
  const mode: TrainerMode = basis === 'hr' && chosenMode === 'erg' ? 'resistance' : chosenMode;
  const [scale, setScale] = useState(1);
  const [level, setLevel] = useState(3);
  const setSound = (on: boolean) => { void setSetting(PREF.sound, on); prefs.set({ ...prefs, sound: on }); };
  const startable = basis === 'power' ? (choice.mode === 'erg' || choice.mode === 'power-self') : (choice.mode === 'hr-self' || choice.mode === 'hr-trainer');
  const trainerRuns = choice.mode === 'erg' || choice.mode === 'hr-trainer';
  const connect = (kind: SensorKind) => { if (!bt) addSimulated(kind); else void addSensor(kind); };
  // When the ride can't start, the place where Start would be says why, and offers the next step.
  const waitingDevices = sensors.filter((x) => x.status === 'offline' && !x.simulated).length;
  const blocked: { head: string; text: string; action?: [string, () => void] } | undefined = startable ? undefined
    : waitingDevices && !choice.needsPower ? { head: `Connect your device${waitingDevices === 1 ? '' : 's'} to start`, text: `Wake ${waitingDevices === 1 ? 'it' : 'them'} first (pedal a few strokes; turn on Broadcast heart rate on your watch), then click each box above that says Click to connect.` }
    : choice.needsPower ? { head: 'This workout needs a power meter', text: `Connect a power meter, or a smart trainer that measures power, to ride it${alternatives.length ? '. Or ride one of the heart-rate workouts below instead.' : '.'}`, action: ['Connect a power meter', () => connect('power')] }
    : choice.suggestHr ? { head: 'No power source connected', text: 'Connect your trainer or a power meter to ride by power, or ride this workout by heart rate.', action: ['Ride by heart rate', () => setBasis('hr')] }
    : basis === 'hr' && sources.watts ? { head: 'Connect a heart-rate monitor', text: 'This ride is by heart rate: connect a heart-rate strap, or your watch broadcasting heart rate.', action: ['Connect heart rate', () => connect('hr')] }
    : { head: 'Connect your trainer to start', text: basis === 'hr' ? 'Or a heart-rate monitor: this ride is by heart rate.' : 'Or a power meter: this ride is by power.', action: ['Connect trainer', () => connect('trainer')] };
  const start = () => startRide({
    workout, planned, basis, profile, scale, level,
    mode: trainerRuns ? mode : 'self',
    sound: prefs.sound, autoPause: prefs.autoPause, guard: prefs.guard, smoothing: prefs.smoothing,
  });

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
          {choice.needsPower ? (
            <>
              {blocked && <Blocked b={blocked} />}
              <ScrollMore class="pl-side-body">
              <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={startable} basis={basis} />
              {alternatives.length > 0 && (
                <section class="pl-card pl-alts-card">
                  <h2 class="pl-h2">Ride one of these by heart rate instead</h2>
                  <p class="muted small" style="margin:2px 0 8px">Close in length and effort to this workout, and can be ridden by heart rate alone.</p>
                  <ScrollMore class="pl-alts" label="Workouts to ride by heart rate">
                    {alternatives.map((a) => (
                      <a key={a.id} class="pl-alt" href={`#/play/workout/${a.id}`}>
                        <b>{a.name}</b><span class="faint small">{a.subtitle ? `${a.subtitle} · ` : ''}{clock(workoutStats(a.blocks).seconds)}</span>
                      </a>
                    ))}
                  </ScrollMore>
                </section>
              )}
              </ScrollMore>
            </>
          ) : (
          <ScrollMore class="pl-side-body">
          <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={startable} basis={basis} />
          <section class="pl-card pl-runs-card">
            <h2 class="pl-h2">How the ride runs</h2>
            {trainerRuns ? (
              <>
                {!power && <p class="pl-runs">You ride to each heart-rate zone with your gears. After 20 seconds outside the zone the screen says <b>Reduce intensity</b> or <b>Increase intensity</b>.</p>}
                <div class="pl-runs-row">
                  <span>Trainer</span>
                  <div class="seg" role="group" aria-label="Trainer">
                    {((power ? [['erg', 'Holds targets (ERG)'], ['resistance', 'Set resistance'], ['free', 'Free ride']] : [['resistance', 'Set resistance'], ['free', 'Free ride']]) as Array<[TrainerMode, string]>).map(([m, label]) => (
                      <button key={m} class={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
                    ))}
                  </div>
                </div>
                {mode === 'resistance' ? (
                  <div class="pl-runs-row"><span>Resistance level</span><StepperSmall value={`${level}`} onDown={() => setLevel(Math.max(0, level - 1))} onUp={() => setLevel(Math.min(10, level + 1))} label="resistance level" /></div>
                ) : mode === 'erg' ? (
                  <div class="pl-runs-row"><span>Workout intensity</span><StepperSmall value={`${Math.round(scale * 100)}%`} onDown={() => setScale(Math.max(0.5, Math.round((scale - 0.01) * 100) / 100))} onUp={() => setScale(Math.min(1.5, Math.round((scale + 0.01) * 100) / 100))} label="workout intensity" /></div>
                ) : null}
                <div class="pl-runs-row"><span>Beeps before each step</span>
                  <button class={`pl-switch${prefs.sound ? ' on' : ''}`} role="switch" aria-checked={prefs.sound} aria-label="Beeps before each step" onClick={() => setSound(!prefs.sound)}><i /></button></div>
              </>
            ) : (
              <>
              {startable ? <p class="pl-runs">{choice.mode === 'hr-self' ? <>You ride to each heart-rate zone with your gears. After 20 seconds outside the zone the screen says <b>Reduce intensity</b> or <b>Increase intensity</b>.</> : choice.says.replace(/^Ready\.\s*/, '')}</p>
                : !choice.needsPower && <p class="pl-runs muted">Choices for the trainer appear here once what the ride needs is connected.</p>}
              {startable && <div class="pl-runs-row"><span>Beeps before each step</span>
                <button class={`pl-switch${prefs.sound ? ' on' : ''}`} role="switch" aria-checked={prefs.sound} aria-label="Beeps before each step" onClick={() => setSound(!prefs.sound)}><i /></button></div>}
            {choice.needsPower && alternatives.length > 0 && (
              <div class="pl-alts">
                <span class="muted small">No power meter? These are close in length and effort, and can be ridden by heart rate:</span>
                {alternatives.map((a) => (
                  <a key={a.id} class="pl-alt" href={`#/play/workout/${a.id}`}>
                    <b>{a.name}</b><span class="faint small">{a.subtitle ? `${a.subtitle} · ` : ''}{clock(workoutStats(a.blocks).seconds)}</span>
                  </a>
                ))}
              </div>
            )}
              </>
            )}
          </section>
          </ScrollMore>
          )}
          {choice.needsPower ? null : blocked ? <Blocked b={blocked} /> : (
            <>
              <button class="btn primary pl-start" onClick={start}>
                <svg width="15" height="17" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13a.8.8 0 0 0 1.2.7l11-6.5a.8.8 0 0 0 0-1.4l-11-6.5A.8.8 0 0 0 1 1.5z" fill="currentColor" /></svg>
                Start ride
              </button>
              <p class="pl-start-note">{planned ? 'Saved to Intervals.icu and matched to this session when you finish' : 'Saved to Intervals.icu when you finish'}</p>
            </>
          )}
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
        <WorkoutProfile blocks={workout.blocks} height={150} hero targets={{ profile, basis }} />
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
  const row = (st: WorkoutStep, key: string, set?: string, flat = false) => {
    const z = powerZone(st.intensity, ladder);
    const t = stepTargets(st, profile);
    const inSet = !!set && !flat;
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
    <>
    <h2 class="pl-steps-head">Steps <span class="faint">· {flattenSteps(workout.blocks).length}</span></h2>
    <ScrollMore class="pl-steps" label="The workout's steps">
      {workout.blocks.map((b, i) => b.kind === 'step' ? row(b, `${i}`) : b.times === 1 ? b.steps.map((st, j) => row(st, `${i}-${j}`, b.label, true)) : (
        <div key={i} class="pl-set">
          <div class="pl-set-head"><span>{b.label ?? 'Set'} <b>× {b.times}</b></span></div>
          {b.steps.map((st, j) => row(st, `${i}-${j}`, b.label ?? 'Set'))}
        </div>
      ))}
    </ScrollMore>
    </>
  );
}

// ── Free ride: no workout ──────────────────────────────────────────────────

function FreePre({ profile, sim, bt }: { profile: Profile; sim: boolean; bt: boolean }) {
  const { sensors, now } = useSensors();
  const sources = pickSources(sensors, now);
  const free = chooseFreeMode(sensors, sources);
  const prefs = usePrefs();
  const [mode, setMode] = useState<TrainerMode>('resistance');
  const [level, setLevel] = useState(3);
  const [watts, setWatts] = useState(150);
  const start = () => startRide({
    workout: undefined, planned: undefined, basis: sources.watts ? 'power' : sources.bpm ? 'hr' : 'power', profile, scale: 1, level, freeWatts: watts,
    mode: free.control ? mode : 'self',
    sound: prefs.sound, autoPause: prefs.autoPause, guard: prefs.guard, smoothing: prefs.smoothing,
  });
  return (
    <>
      {!bt && <div class="pl-banner">This browser can't reach Bluetooth: only the simulated sensors are available. For real sensors, use Chrome or Edge on a computer.</div>}
      <main class="pl-main pl-pre">
        <section class="pl-card pl-workout pl-free">
          <p class="eyebrow">{`Today · ${fmtDate(today())}`}</p>
          <h1>Free ride</h1>
          <p class="pl-sub">No workout: ride as you like</p>
          <p class="pl-free-text">The ride is recorded and saved to Intervals.icu like any other, and goes on today's calendar as a ride of its own. It counts toward your training load, and your plan takes it into account when it next checks itself.</p>
          <div class="pl-free-ways">
            <div><b>Set resistance</b><span class="muted">A road of a fixed steepness, levels 0 to 10. Change gear as you like.</span></div>
            <div><b>Hold watts</b><span class="muted">The trainer holds the watts you choose (ERG), whatever gear you are in.</span></div>
            <div><b>Free ride</b><span class="muted">A flat road.</span></div>
          </div>
          <p class="faint small">You can change any of these as you ride, with the buttons or the + and − keys.</p>
        </section>
        <aside class="pl-side">
          <div class="pl-side-body">
            <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={free.ready} />
            <section class="pl-card pl-runs-card">
              <h2 class="pl-h2">How the ride runs</h2>
              {free.control && free.ready ? (
                <>
                  <div class="pl-runs-row">
                    <span>Trainer</span>
                    <div class="seg" role="group" aria-label="Trainer">
                      {([['resistance', 'Set resistance'], ['erg', 'Hold watts'], ['free', 'Free ride']] as Array<[TrainerMode, string]>).map(([m, label]) => (
                        <button key={m} class={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  {mode === 'resistance' && <div class="pl-runs-row"><span>Resistance level</span><StepperSmall value={`${level}`} onDown={() => setLevel(Math.max(0, level - 1))} onUp={() => setLevel(Math.min(10, level + 1))} label="resistance level" /></div>}
                  {mode === 'erg' && <div class="pl-runs-row"><span>Watts to hold</span><StepperSmall value={`${watts} W`} onDown={() => setWatts(Math.max(50, watts - 5))} onUp={() => setWatts(Math.min(600, watts + 5))} label="watts to hold" /></div>}
                </>
              ) : <p class={`pl-runs ${free.ready ? '' : 'muted'}`}>{free.says.replace(/^Ready\.\s*/, '')}</p>}
            </section>
          </div>
          <button class="btn primary pl-start" disabled={!free.ready} onClick={start}>
            <svg width="15" height="17" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13a.8.8 0 0 0 1.2.7l11-6.5a.8.8 0 0 0 0-1.4l-11-6.5A.8.8 0 0 0 1 1.5z" fill="currentColor" /></svg>
            Start ride
          </button>
          <p class="pl-start-note">{free.ready ? 'Saved to Intervals.icu when you finish' : 'Connect what the ride needs to start'}</p>
        </aside>
      </main>
    </>
  );
}

// ── Your devices, right (brief of 28 Oct: one box per kind of device) ─────

const STATUS_WORD: Record<SensorState['status'], string> = { connecting: 'Connecting…', connected: 'Connected', lost: 'Lost: reconnecting…', offline: 'Click to connect' };

function Ready({ sensors, sources, profile, sim, bt, allSet, basis }: { sensors: SensorState[]; sources: Partial<Record<Metric, Supplied>>; profile: Profile; sim: boolean; bt: boolean; allSet: boolean; basis?: Basis }) {
  const [menu, setMenu] = useState<string | null>(null);
  const d = deviceBoxes(sensors, sources, basis);
  const pill = pillFor(d, allSet);
  const add = (kind: SensorKind, simulated = false) => { setMenu(null); if (simulated || !bt) addSimulated(kind); else void addSensor(kind); };
  // Adding: straight to the browser's list, unless practice mode also offers a simulated one.
  const addItems = (kind: SensorKind) => (
    <>
      {bt && <button role="menuitem" onClick={() => add(kind)}>{KIND_CAPTION[kind]} nearby…</button>}
      {sim && <button role="menuitem" onClick={() => add(kind, true)}>Simulated {KIND_NOUN[kind]}</button>}
    </>
  );
  const onEmpty = (kind: SensorKind) => { if (sim && bt) setMenu(`add-${kind}`); else add(kind); };
  const menuOf = (key: string, body: ComponentChildren) => menu === key && <>
    <div class="menu-bg" onClick={() => setMenu(null)} />
    <div class="menu-list pl-menu pl-dev-menu" role="menu">{body}</div>
  </>;
  return (
    <section class="pl-card">
      <div class="row between">
        <h2 class="pl-h2">Your devices</h2>
        <span class={`pl-pill ${pill.ok ? 'ok' : 'wait'}`}><span class="pl-dot" />{pill.text}</span>
      </div>
      <div class="pl-devgrid">
        {d.boxes.map((b) => {
          const key = `box-${b.kind}`;
          if (b.state === 'empty') {
            return (
              <div key={b.kind} class="menu pl-devcell">
                <button class="pl-dev empty" aria-haspopup={sim && bt ? 'menu' : undefined} onClick={() => onEmpty(b.kind)}>
                  <span class="pl-dev-plus" aria-hidden="true">+</span>
                  <b>{ADD_TITLE[b.kind]}</b>
                  <span class="faint small">{b.reason}</span>
                </button>
                {menuOf(`add-${b.kind}`, addItems(b.kind))}
              </div>
            );
          }
          const s = b.sensor!;
          const name = cleanName(s.name);
          const waiting = b.state === 'click' || b.state === 'lost';
          const click = () => { if (b.state === 'click' && !s.simulated) { setMenu(null); void reconnect(s.id); } else setMenu(menu === key ? null : key); };
          return (
            <div key={b.kind} class="menu pl-devcell">
              <button class={`pl-dev ${b.state}`} aria-haspopup={b.state === 'click' ? undefined : 'menu'} aria-expanded={menu === key} onClick={click}>
                <span class="pl-dev-k">{KIND_CAPTION[b.kind]}<span class="pl-dev-chev" aria-hidden="true">⌄</span></span>
                <span class="pl-dev-name">{name}</span>
                {b.state === 'connected' && b.metrics.length > 0 && (
                  <span class="pl-dev-v num">{b.metrics.map((m, i) => <span key={m}>{i > 0 && ' '}{fmtValue(m, sources[m]!.value, profile)}<small> {unitOf(m, profile)}</small></span>)}</span>
                )}
                <span class="pl-dev-s"><span class={`pl-dot ${b.state === 'connected' ? 'ok' : b.state === 'connecting' ? 'connecting' : 'wait'}`} />
                  {STATUS_WORD[s.status]}{b.state === 'connected' && b.kind === 'trainer' ? (s.controllable ? ' · controls the resistance' : ' · not in control') : ''}</span>
                {waiting && <span class="pl-dev-hint">{WAKE[b.kind]}</span>}
                {b.unused && <span class="pl-dev-hint">{b.unused}</span>}
                {s.warning && <span class="pl-dev-warn">{s.warning}</span>}
              </button>
              {menuOf(key, <>
                <div class="menu-title">{name}</div>
                <button role="menuitem" onClick={() => { setMenu(null); if (sim && !bt) add(b.kind, true); else if (sim) setMenu(`add-${b.kind}`); else add(b.kind); }}>Use a different {KIND_NOUN[b.kind]}…</button>
                <button role="menuitem" class="danger-text" onClick={() => { setMenu(null); if (confirm(`Forget ${name} on this computer?\n\nTo use it again, add it again.`)) void forget(s.id); }}>Forget this {KIND_NOUN[b.kind]}…</button>
              </>)}
              {menuOf(`add-${b.kind}`, addItems(b.kind))}
            </div>
          );
        })}
        {d.more.length > 0 && (
          <div class="menu pl-devcell">
            <button class="pl-dev empty more" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
              <span class="pl-dev-plus" aria-hidden="true">+</span>
              <b>Add another device</b>
              <span class="faint small">{d.more.map((k) => KIND_NOUN[k]).join(' or ').replace(/^./, (c) => c.toUpperCase())}</span>
            </button>
            {menuOf('more', <>{d.more.map((k) => <Fragment key={k}>{bt && <button key={k} role="menuitem" onClick={() => add(k)}>{KIND_CAPTION[k]} nearby…</button>}{sim && <button key={`s-${k}`} role="menuitem" onClick={() => add(k, true)}>Simulated {KIND_NOUN[k]}</button>}</Fragment>)}</>)}
          </div>
        )}
      </div>
      {!sensors.length && <p class="pl-note">Click a box to add a device. Your browser asks before connecting each one, and this computer remembers them for next time.</p>}
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


/** The player's preferences on this computer (Settings → Ride player). */
export const PREF = { sound: 'playerSound', autoPause: 'playerAutoPause', guard: 'playerGuard', smoothing: 'playerSmoothing' } as const;
export interface Prefs { sound: boolean; autoPause: boolean; guard: boolean; smoothing: number }
export const DEFAULT_PREFS: Prefs = { sound: true, autoPause: true, guard: true, smoothing: 3 };
export async function loadPrefs(): Promise<Prefs> {
  return {
    sound: await getSetting(PREF.sound, DEFAULT_PREFS.sound),
    autoPause: await getSetting(PREF.autoPause, DEFAULT_PREFS.autoPause),
    guard: await getSetting(PREF.guard, DEFAULT_PREFS.guard),
    smoothing: await getSetting(PREF.smoothing, DEFAULT_PREFS.smoothing),
  };
}
function usePrefs(): Prefs & { set: (p: Prefs) => void } {
  const [p, set] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => { loadPrefs().then(set); }, []);
  return { ...p, set };
}

function StepperSmall({ value, onDown, onUp, label }: { value: string; onDown: () => void; onUp: () => void; label: string }) {
  return (
    <div class="pl-stepper">
      <button class="btn" aria-label={`Lower ${label}`} onClick={onDown}>−</button>
      <b class="num">{value}</b>
      <button class="btn" aria-label={`Raise ${label}`} onClick={onUp}>+</button>
    </div>
  );
}

/**
 * A panel that scrolls inside the window, showing that it does: while there
 * is more below, its foot fades and a "More below" tab sits at the bottom
 * (click it to scroll on). Both go once the end is in view.
 */
function ScrollMore({ class: cls, children, label }: { class: string; children: ComponentChildren; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = () => { const el = ref.current; if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 6); };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    check();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : undefined;
    ro?.observe(el);
    for (const c of Array.from(el.children)) ro?.observe(c);
    return () => ro?.disconnect();
  });
  return (
    <div class={`pl-scrollwrap ${cls}-wrap`}>
      <div ref={ref} class={`${cls}${more ? ' more' : ''}`} onScroll={check} tabIndex={0} aria-label={label}>{children}</div>
      {more && <button type="button" class="pl-more" onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.7, behavior: 'smooth' })}>More below <span aria-hidden="true">↓</span></button>}
    </div>
  );
}

/** Where the ride can't start: why, and the one next step. */
function Blocked({ b }: { b: { head: string; text: string; action?: [string, () => void] } }) {
  return (
    <div class="pl-blocked" role="status">
      <span class="pl-blocked-icon" aria-hidden="true">!</span>
      <div style="min-width:0;flex:1">
        <b>{b.head}</b>
        <p>{b.text}</p>
      </div>
      {b.action && <button class="btn primary" onClick={b.action[1]}>{b.action[0]}</button>}
    </div>
  );
}
