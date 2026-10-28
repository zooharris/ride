import { useEffect, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import type { Basis, PlannedWorkout, Profile, Workout } from '../../engine/types';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { FAMILY_LABEL } from '../../library/workouts';
import { fmtDate } from '../derived';
import { WorkoutProfile } from '../Profile';
import { StepsTable } from '../StepsTable';
import { Logo } from '../Brand';
import { Empty } from '../PageHead';
import { getSetting } from '../../data/db';
import { bluetoothAvailable } from '../../player/ble/web';
import { addSensor, addSimulated, forget, getSensors, reconnect, restoreSaved, setRiderNumbers, SIM_KEY, subscribe, type SensorState } from '../../player/hub';
import { KIND_WORD, METRIC_WORD, pickSources, STALE_MS, suppliedBy, type Metric, type SensorKind, type Supplied } from '../../player/sources';
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
 * The ride player, before the ride (spec screen 1): the workout, the sensors
 * with their live numbers, and how the ride will be played. Reached from
 * "Ride indoors on the trainer" (#/play/planned/<id>) or a ride's page
 * (#/play/workout/<id>). It has the whole window, without the app's menu.
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

function Frame({ children }: { children: preact.ComponentChildren }) {
  return (
    <div class="player">
      <header class="pl-head">
        <Logo height={24} />
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

function PreRide({ workout, planned, profile, sim, bt }: { workout: Workout; planned?: PlannedWorkout; profile: Profile; sim: boolean; bt: boolean }) {
  const allowsHr = workout.bases.includes('hr');
  const [basis, setBasis] = useState<Basis>(planned?.basis ?? (workout.bases.includes(profile.basis) ? profile.basis : workout.bases[0]));
  const { sensors, now } = useSensors();
  const sources = pickSources(sensors, now);
  const choice = chooseMode(basis, sensors, sources, allowsHr);
  const s = workoutStats(workout.blocks);
  const when = planned ? (planned.date === today() ? `Today · ${fmtDate(planned.date)}` : `Planned for ${fmtDate(planned.date)}`) : 'Not on your calendar';

  return (
    <>
      {!bt && <div class="pl-banner">This browser can't reach Bluetooth: only the simulated sensors are available. For real sensors, use Chrome or Edge on a computer.</div>}
      <main class="pl-main pl-pre">
        <section class="panel pl-workout">
          <p class="eyebrow">{when}</p>
          <div class="row between wrap" style="gap:8px">
            <h1 style="margin:0">{workout.name}</h1>
            {allowsHr ? (
              <div class="seg" role="group" aria-label="Targets by">
                <button class={basis === 'power' ? 'on' : ''} aria-pressed={basis === 'power'} onClick={() => setBasis('power')}>Power</button>
                <button class={basis === 'hr' ? 'on' : ''} aria-pressed={basis === 'hr'} onClick={() => setBasis('hr')}>Heart rate</button>
              </div>
            ) : <span class="faint small">power only</span>}
          </div>
          {workout.subtitle && <p class="pl-sub">{workout.subtitle}</p>}
          <div class="pl-stats">
            <div><div class="caption">Duration</div><div class="pl-stat num">{clock(s.seconds)}</div></div>
            <div><div class="caption">Training load</div><div class="pl-stat num">{s.tss}<small> TSS</small></div></div>
            <div><div class="caption">Overall intensity</div><div class="pl-stat num">{s.intensityFactor.toFixed(2)}<small> of {basis === 'power' ? 'FTP' : 'threshold'}</small></div></div>
            <div><div class="caption">{basis === 'power' ? 'Your FTP' : 'Threshold heart rate'}</div><div class="pl-stat num">{basis === 'power' ? profile.ftp : profile.lthr}<small>{basis === 'power' ? ' W' : ' bpm'}</small></div></div>
          </div>
          <div style="margin:16px 0 6px"><WorkoutProfile blocks={workout.blocks} height={100} hero targets={{ profile, basis }} /></div>
          <p class="muted small" style="margin:10px 0 14px">{FAMILY_LABEL[workout.family]}. {workout.purpose}</p>
          <h2 class="pl-h2" style="margin:0 0 8px">Steps</h2>
          <StepsTable blocks={workout.blocks} basis={basis} profile={profile} />
        </section>

        <div class="pl-side">
          <Sensors sensors={sensors} sources={sources} profile={profile} sim={sim} bt={bt} />
          <section class="panel">
            <h2 class="pl-h2" style="margin:0 0 10px">The numbers the ride will use</h2>
            <div class="pl-uses">
              {(['watts', 'bpm', 'cadence', 'speedKmh'] as Metric[]).map((m) => {
                const src = sources[m];
                const from = src ? sensors.find((x) => x.id === src.from) : undefined;
                return (
                  <div key={m} class="pl-use">
                    <span class="caption">{USE_LABEL[m]}</span>
                    <span class="num pl-use-v">{src ? fmtMetric(m, src.value, profile) : '—'}</span>
                    <span class="faint small">{from ? `from ${from.simulated ? 'the ' : 'your '}${sourceWord(from)}` : 'nothing connected supplies it'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>

      <footer class="pl-foot">
        <div class="pl-foot-text">
          <div class={choice.mode ? 'pl-ready' : 'pl-notready'}>{choice.says}{choice.suggestHr && <> <button class="btn sm" onClick={() => setBasis('hr')}>Switch to heart rate</button></>}</div>
          <div class="faint small">Riding the workout arrives with the next update. For now, connect your trainer and sensors here and check that their numbers move when you pedal.</div>
        </div>
        <button class="btn primary pl-start" disabled title="Arrives with the next update">Start ride</button>
      </footer>
    </>
  );
}

const USE_LABEL: Record<Metric, string> = { watts: 'Power', bpm: 'Heart rate', cadence: 'Cadence', speedKmh: 'Speed' };

function sourceWord(s: SensorState): string {
  if (s.simulated) return s.name.toLowerCase();
  return { trainer: 'trainer', power: 'power meter', hr: 'heart-rate monitor', csc: 'speed/cadence sensor' }[s.kind];
}

function fmtMetric(m: Metric, v: number, profile: Profile): string {
  if (m === 'watts') return `${Math.round(v)} W`;
  if (m === 'bpm') return `${Math.round(v)} bpm`;
  if (m === 'cadence') return `${Math.round(v)} rpm`;
  return profile.units === 'imperial' ? `${(v / 1.609344).toFixed(1)} mph` : `${v.toFixed(1)} km/h`;
}

const STATUS_WORD: Record<SensorState['status'], string> = { connecting: 'Connecting…', connected: 'Connected', lost: 'Reconnecting…', offline: 'Not found' };

function Sensors({ sensors, sources, profile, sim, bt }: { sensors: SensorState[]; sources: Partial<Record<Metric, Supplied>>; profile: Profile; sim: boolean; bt: boolean }) {
  const [menu, setMenu] = useState(false);
  const order: SensorKind[] = ['trainer', 'power', 'hr', 'csc'];
  const list = [...sensors].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const pick = (kind: SensorKind, simulated: boolean) => {
    setMenu(false);
    if (simulated) addSimulated(kind); else void addSensor(kind);
  };
  const ask = async (s: SensorState) => {
    if (!confirm(`Forget ${s.name} on this computer?\n\nIt disconnects now. To use it again, add it again.`)) return;
    await forget(s.id);
  };
  return (
    <section class="panel">
      <div class="row between" style="align-items:flex-start;gap:12px">
        <div>
          <h2 class="pl-h2" style="margin:0">Your sensors</h2>
          <p class="faint small" style="margin:2px 0 0">{list.length ? 'Pedal a few strokes to check the numbers move.' : 'Add your smart trainer first, then heart rate and any other sensors.'}</p>
        </div>
        <div class="menu">
          <button class="btn sm" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>Add a sensor</button>
          {menu && <div class="menu-bg" onClick={() => setMenu(false)} />}
          {menu && (
            <div class="menu-list pl-menu" role="menu">
              {bt && order.map((k) => <button key={k} role="menuitem" onClick={() => pick(k, false)}>{KIND_WORD[k]}</button>)}
              {sim && <>
                {bt && <div class="pl-menu-sep" />}
                {(['trainer', 'power', 'hr'] as SensorKind[]).map((k) => <button key={`sim-${k}`} role="menuitem" onClick={() => pick(k, true)}>Simulated {k === 'trainer' ? 'trainer' : k === 'power' ? 'power meter' : 'heart rate'}</button>)}
              </>}
            </div>
          )}
        </div>
      </div>
      {list.length > 0 && (
        <div class="pl-sensors">
          {list.map((s) => {
            const fresh = s.status === 'connected' && s.reading && Date.now() - s.reading.at <= STALE_MS;
            const gives = suppliedBy(s.id, sources).map((m) => METRIC_WORD[m]);
            return (
              <div key={s.id} class="pl-sensor">
                <span class={`pl-kind k-${s.kind}`}>{SENSOR_ICON[s.kind]}</span>
                <div style="min-width:0">
                  <div class="pl-sensor-name">{s.name}</div>
                  <div class="faint small">{KIND_WORD[s.kind]}{s.kind === 'trainer' && s.controllable ? ' · controls the workout' : ''}{gives.length ? ` · supplies ${gives.join(', ')}` : ''}</div>
                  {s.warning && <div class="pl-warn small">{s.warning}</div>}
                </div>
                <div class="pl-live num">{fresh ? liveText(s, profile) : '—'}</div>
                <div class="pl-status">
                  <span class={`pl-dot ${s.status}`} />
                  <span class="small">{STATUS_WORD[s.status]}</span>
                  {s.status === 'offline' && !s.simulated && <button class="btn sm" onClick={() => void reconnect(s.id)}>Connect</button>}
                  <button class="btn sm quiet" onClick={() => void ask(s)}>Forget</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!bt && !sim && <p class="faint small">This browser can't reach Bluetooth.</p>}
    </section>
  );
}

function liveText(s: SensorState, profile: Profile): string {
  const r = s.reading!;
  const parts: string[] = [];
  if (r.bpm != null && s.kind === 'hr') parts.push(fmtMetric('bpm', r.bpm, profile));
  if (r.watts != null) parts.push(fmtMetric('watts', r.watts, profile));
  if (r.speedKmh != null && (s.kind === 'trainer' || s.kind === 'csc')) parts.push(fmtMetric('speedKmh', r.speedKmh, profile));
  if (r.cadence != null && (s.kind === 'power' || s.kind === 'csc')) parts.push(fmtMetric('cadence', r.cadence, profile));
  return parts.join(' · ') || '—';
}

const svg = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' } as const;
const SENSOR_ICON: Record<SensorKind, preact.JSX.Element> = {
  trainer: <svg {...svg}><circle cx="7" cy="15" r="4" /><circle cx="17" cy="15" r="4" /><path d="M3 20h18" /></svg>,
  power: <svg {...svg}><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z" /></svg>,
  hr: <svg {...svg}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /><path d="M7.5 12h3l1.5-2.5 2 4 1.2-1.5h1.3" /></svg>,
  csc: <svg {...svg}><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4h-4" /><circle cx="12" cy="12" r="1.5" /></svg>,
};
