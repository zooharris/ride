import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
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
import { addSensor, addSimulated, connectSaved, disconnect, getSensors, getSlots, knownNow, loadSlots, restoreSaved, savedDevices, setRiderNumbers, setSlot, SIM_KEY, subscribe, type SensorState } from '../../player/hub';
import { pickSources, type Metric, type Supplied } from '../../player/sources';
import { chooseFreeMode, chooseMode } from '../../player/mode';
import { cleanName, FIND_KIND, FIND_WORDS, KIND_NOUN, optionsFor, pillFor, SLOT_CAPTION, slotView, WAKE, type Slot } from '../../player/devices';

/** The connected sensors, redrawn as readings arrive and once a second so a sensor that falls silent shows it. */
export function useSensors(): { sensors: SensorState[]; now: number } {
  const [state, setState] = useState({ sensors: getSensors(), now: Date.now() });
  useEffect(() => {
    const tick = () => setState({ sensors: getSensors(), now: Date.now() });
    // The remembered devices and the rider's choices load once; the boxes redraw when they arrive.
    void Promise.all([savedDevices(), loadSlots()]).then(tick);
    const off = subscribe(tick);
    const t = setInterval(tick, 1000);
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
  const sources = pickSources(sensors, now, getSlots());
  const choice = chooseMode(basis, sensors, sources, allowsHr);
  const s = workoutStats(workout.blocks);
  const when = planned ? (planned.date === today() ? `Today · ${fmtDate(planned.date)}` : `Planned for ${fmtDate(planned.date)}`) : 'Not on your calendar';
  const power = basis === 'power';
  const alternatives = useMemo(() => (allowsHr ? [] : hrAlternatives(workout, allWorkouts(mine), 5)), [workout.id, allowsHr, mine]);
  const prefs = usePrefs();
  const [chosenMode, setMode] = useState<TrainerMode>('erg');
  // By heart rate, "erg" means the trainer adjusts its watts to keep heart rate in each zone.
  const mode: TrainerMode = chosenMode;
  const [scale, setScale] = useState(1);
  const [level, setLevel] = useState(3);
  const setSound = (on: boolean) => { void setSetting(PREF.sound, on); prefs.set({ ...prefs, sound: on }); };
  const startable = basis === 'power' ? (choice.mode === 'erg' || choice.mode === 'power-self') : (choice.mode === 'hr-self' || choice.mode === 'hr-trainer');
  const trainerRuns = choice.mode === 'erg' || choice.mode === 'hr-trainer';
  const [open, setOpen] = useState<Slot | null>(null);
  // When the ride can't start, the place where Start would be says why, and opens the box that fixes it.
  const blocked: { head: string; text: string; action?: [string, () => void] } | undefined = startable ? undefined
    : choice.needsPower ? { head: 'This workout needs a power meter', text: 'Connect a power meter, or a smart trainer that measures power, to ride it.', action: ['Choose power', () => setOpen('watts')] }
    : choice.suggestHr ? { head: 'No power source connected', text: 'Connect your trainer or a power meter to ride by power, or ride this workout by heart rate.', action: ['Ride by heart rate', () => setBasis('hr')] }
    : basis === 'hr' && sources.watts ? { head: 'Connect a heart-rate monitor', text: 'This ride is by heart rate: connect a heart-rate strap, or your watch broadcasting heart rate.', action: ['Choose heart rate', () => setOpen('bpm')] }
    : { head: 'Connect your trainer to start', text: basis === 'hr' ? 'Or a heart-rate monitor: this ride is by heart rate.' : 'Or a power meter: this ride is by power.', action: ['Choose your trainer', () => setOpen('trainer')] };
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

        <aside class={`pl-side${choice.needsPower ? ' needs' : ''}`}>
          {choice.needsPower ? (
            <>
              {blocked && <Blocked b={blocked} alternatives={alternatives} />}
              <ScrollMore class="pl-side-body">
              <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={startable} open={open} setOpen={setOpen} />
              </ScrollMore>
            </>
          ) : (
          <ScrollMore class="pl-side-body">
          <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={startable} open={open} setOpen={setOpen} />
          <section class="pl-card pl-runs-card">
            <h2 class="pl-h2">How the ride runs</h2>
            {trainerRuns ? (
              <>
                {!power && (mode === 'erg'
                  ? <p class="pl-runs">The trainer adjusts its resistance, a few watts at a time, to keep your heart rate in each zone. Steps under three minutes are held at steady watts.</p>
                  : <p class="pl-runs">You ride to each heart-rate zone with your gears. After 20 seconds outside the zone the screen says <b>Reduce intensity</b> or <b>Increase intensity</b>.</p>)}
                <div class="pl-runs-row">
                  <span>Trainer</span>
                  <div class="seg" role="group" aria-label="Trainer">
                    {((power ? [['erg', 'Holds targets (ERG)'], ['resistance', 'Set resistance'], ['free', 'Free ride']] : [['erg', 'Adjusts to heart rate'], ['resistance', 'Set resistance'], ['free', 'Free ride']]) as Array<[TrainerMode, string]>).map(([m, label]) => (
                      <button key={m} class={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
                    ))}
                  </div>
                </div>
                {mode === 'resistance' ? (
                  <div class="pl-runs-row"><span>Resistance level</span><StepperSmall value={`${level}`} onDown={() => setLevel(Math.max(0, level - 1))} onUp={() => setLevel(Math.min(10, level + 1))} label="resistance level" /></div>
                ) : mode === 'erg' && power ? (
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
  const sources = pickSources(sensors, now, getSlots());
  const free = chooseFreeMode(sensors, sources);
  const prefs = usePrefs();
  const [mode, setMode] = useState<TrainerMode>('resistance');
  const [level, setLevel] = useState(3);
  const [watts, setWatts] = useState(150);
  const [open, setOpen] = useState<Slot | null>(null);
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
            <Ready sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} allSet={free.ready} open={open} setOpen={setOpen} />
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

// ── Your devices, right (Todd, 28 Oct): a box for the trainer and for each number ──

const SUB_DATE = (iso?: string) => (iso ? `last used ${iso === new Date().toISOString().slice(0, 10) ? 'today' : new Date(iso + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'used before');

function Ready({ sensors, sources, profile, sim, bt, allSet, open, setOpen }: { sensors: SensorState[]; sources: Partial<Record<Metric, Supplied>>; profile: Profile; sim: boolean; bt: boolean; allSet: boolean; open: Slot | null; setOpen: (s: Slot | null) => void }) {
  const known = knownNow();
  const chosen = getSlots();
  const pill = pillFor(sensors, allSet);
  const ref = useRef<HTMLElement>(null);
  // The list floats over the page beside its box, so a scrolling panel never cuts it off; it opens upward when there is no room below.
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    const cell = ref.current?.querySelector(`[data-slot="${open}"]`) as HTMLElement | null;
    if (!cell) return;
    cell.scrollIntoView({ block: 'nearest' });
    const r = cell.getBoundingClientRect();
    const w = 330, gap = 6;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const below = innerHeight - r.bottom - gap - 8, above = r.top - gap - 8;
    setAt(below >= 300 || below >= above ? { left, top: r.bottom + gap, maxHeight: below } : { left, bottom: innerHeight - r.top + gap, maxHeight: above });
  }, [open]);
  const done = () => setOpen(null);
  const pickOption = async (slot: Slot, id: string, connected: boolean) => {
    done();
    if (!connected && !(await connectSaved(id))) return;
    if (slot !== 'trainer') await setSlot(slot, id);
  };
  const find = async (slot: Slot) => {
    done();
    const id = await addSensor(FIND_KIND[slot]);
    if (id && slot !== 'trainer') await setSlot(slot, id);
  };
  const simulate = async (slot: Slot) => {
    done();
    const kind = FIND_KIND[slot];
    addSimulated(kind);
    if (slot !== 'trainer') await setSlot(slot, `sim-${kind}`);
  };
  const none = async (slot: Slot) => {
    done();
    if (slot === 'trainer') { const t = sensors.find((x) => x.kind === 'trainer'); if (t) disconnect(t.id); }
    else await setSlot(slot, 'none');
  };
  const reading = (id: string, slot: Slot) => {
    const s = sensors.find((x) => x.id === id);
    if (slot === 'trainer') return s?.status !== 'connected' ? 'connecting…' : s.controllable ? 'controls the resistance' : 'not in control';
    const v = s?.reading?.[slot];
    return v != null ? `${fmtValue(slot, v, profile)} ${unitOf(slot, profile)}` : s?.status === 'connected' ? 'connected' : 'connecting…';
  };

  const box = (slot: Slot) => {
    const v = slotView(slot, sensors, known, sources, chosen);
    const d = v.device;
    const name = d ? cleanName(d.name) : undefined;
    const opts = optionsFor(slot, sensors, known, sources);
    const isOpen = open === slot;
    return (
      <div key={slot} class={`menu pl-devcell${slot === 'trainer' ? ' wide' : ''}`} data-slot={slot}>
        <button class={`pl-dev ${v.state}`} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : slot)}>
          <span class="pl-dev-k">{SLOT_CAPTION[slot]}<span class="pl-dev-chev" aria-hidden="true">⌄</span></span>
          {v.state === 'connected' && <>
            <span class="pl-dev-name">{name}</span>
            {slot !== 'trainer' && v.value != null && <span class="pl-dev-v num">{fmtValue(slot, v.value, profile)}<small> {unitOf(slot, profile)}</small></span>}
            <span class="pl-dev-s"><span class="pl-dot ok" />Connected{slot === 'trainer' ? (d?.controllable ? ' · controls the resistance' : ' · not in control') : ''}</span>
            {slot === 'trainer' && d?.warning && <span class="pl-dev-warn">{d.warning}</span>}
          </>}
          {v.state === 'waiting' && <>
            <span class="pl-dev-name">{name}</span>
            <span class="pl-dev-s"><span class="pl-dot connecting" />{d?.status === 'lost' ? 'Lost: reconnecting…' : 'Connecting…'}</span>
          </>}
          {v.state === 'off' && <span class="pl-dev-none">None for this ride</span>}
          {v.state === 'empty' && <>
            <span class="pl-dev-none">Not connected</span>
            {v.lastUsed && <span class="pl-dev-hint">Last used: {cleanName(v.lastUsed)}</span>}
          </>}
          <span class="pl-dev-act">{v.state === 'connected' || v.state === 'waiting' ? 'Change…' : 'Choose…'}</span>
        </button>
        {isOpen && <>
          <div class="menu-bg" onClick={done} />
          <div class="pl-pick" role="menu" style={at ? `left:${at.left}px;${at.top != null ? `top:${at.top}px` : `bottom:${at.bottom}px`};max-height:${at.maxHeight}px` : 'visibility:hidden'}>
            <div class="pl-pick-title">{SLOT_CAPTION[slot]} from</div>
            {opts.map((o) => (
              <button key={o.id} role="menuitemradio" aria-checked={o.selected} class="pl-pick-it" onClick={() => void pickOption(slot, o.id, o.connected)}>
                <span class={`pl-radio${o.selected ? ' on' : ''}`} aria-hidden="true" />
                <span class="pl-pick-m"><b>{o.name}</b><span>{KIND_NOUN[o.kind]} · {o.connected ? reading(o.id, slot) : SUB_DATE(o.lastUsed)}</span></span>
              </button>
            ))}
            {(opts.length > 0) && <hr />}
            {bt && <button role="menuitem" class="pl-pick-find" onClick={() => void find(slot)}>+ {FIND_WORDS[slot]}</button>}
            {sim && <button role="menuitem" class="pl-pick-find" onClick={() => void simulate(slot)}>+ Simulated {KIND_NOUN[FIND_KIND[slot]].toLowerCase()}</button>}
            <button role="menuitemradio" aria-checked={v.state === 'off'} class="pl-pick-it" onClick={() => void none(slot)}>
              <span class={`pl-radio${v.state === 'off' ? ' on' : ''}`} aria-hidden="true" /><span class="pl-pick-m"><span class="pl-pick-none">None for this ride</span></span>
            </button>
            {WAKE[slot] && <p class="pl-pick-note">{WAKE[slot]}</p>}
          </div>
        </>}
      </div>
    );
  };

  return (
    <section class="pl-card" ref={ref}>
      <div class="row between">
        <h2 class="pl-h2">Your devices</h2>
        <span class={`pl-pill ${pill.ok ? 'ok' : 'wait'}`}><span class="pl-dot" />{pill.text}</span>
      </div>
      <div class="pl-devgrid">
        {box('trainer')}
        {box('watts')}{box('bpm')}{box('cadence')}{box('speedKmh')}
      </div>
      {!known.length && !sensors.length && <p class="pl-note">Click a box to choose the device for it. Your browser asks before connecting each one, and this computer remembers them for next time.</p>}
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
/** Where the ride can't start: why, the one next step, and for a power-only workout, rides to do by heart rate instead. */
function Blocked({ b, alternatives = [] }: { b: { head: string; text: string; action?: [string, () => void] }; alternatives?: Workout[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) { setAt(null); return; }
    const r = btn.current.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, innerWidth - 368)), top: r.bottom + 6 });
  }, [open]);
  return (
    <div class={`pl-blocked${alternatives.length ? ' with-alts' : ''}`} role="status">
      <span class="pl-blocked-icon" aria-hidden="true">!</span>
      <div style="min-width:0;flex:1">
        {alternatives.length > 0 ? <>
          <div class="pl-bl-row">
            <div class="pl-bl-text"><b>{b.head}</b><p>{b.text}</p></div>
            {b.action && <div class="pl-blocked-acts"><button class="btn primary" onClick={b.action[1]}>{b.action[0]}</button></div>}
          </div>
          <div class="pl-blocked-alts pl-bl-row">
            <div class="pl-bl-text"><b class="pl-blocked-sub">Ride one of these by heart rate instead</b>
            <span class="pl-blocked-or">Close in length and effort to this workout, and can be ridden by heart rate alone.</span></div>
            <div class="pl-bl-btn"><button ref={btn} class="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Choose a heart-rate workout <span aria-hidden="true">▾</span></button></div>
            {open && <>
              <div class="menu-bg" onClick={() => setOpen(false)} />
              <div class="pl-pick pl-alt-menu" role="menu" style={at ? `left:${at.left}px;top:${at.top}px;max-height:${innerHeight - at.top - 8}px` : 'visibility:hidden'}>
                
                {alternatives.map((a) => (
                  <a key={a.id} class="pl-alt-row pl-alt-thumbrow" href={`#/play/workout/${a.id}`}>
                    <span class="pl-alt-thumb"><WorkoutProfile blocks={a.blocks} height={30} /></span>
                    <span class="pl-alt-text"><b>{a.name}</b><span>{a.subtitle ? `${a.subtitle} · ` : ''}{clock(workoutStats(a.blocks).seconds)}</span></span>
                  </a>
                ))}
              </div>
            </>}
          </div>
        </> : <><b>{b.head}</b><p>{b.text}</p></>}
      </div>
      {!alternatives.length && b.action && <button class="btn primary" onClick={b.action[1]}>{b.action[0]}</button>}
    </div>
  );
}
