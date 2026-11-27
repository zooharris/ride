import { thisDevice } from '../../shell';
import { useEffect, useRef, useState } from 'preact/hooks';
import { brShown } from '../../engine/breathThresholds';
import type { Profile, Workout, PlannedWorkout } from '../../engine/types';
import { clock, workoutStats } from '../../engine/workout';
import { today } from '../../engine/load';
import { breathZones, hrZone, powerZone, ridePowerZones, rideHrZones } from '../../engine/zones';
import { Mark } from '../Brand';
import { breathZoneVar, ZONE_VAR } from '../Profile';
import { toast } from '../Toast';
import { notify } from '../store';
import { go } from '../router';
import { useSensors } from './Player';
import { phoneScreen } from '../../player/platform';
import { usePadUpright } from '../usePad';
import { controlledTrainer, type SensorState } from '../../player/hub';
import { cleanName } from '../../player/devices';
import { breathBand, cueAt, hrZoneOf, rampView, targetBand, totalSeconds, type TimelineStep } from '../../player/timeline';
import { breathTrend } from '../../player/breathControl';
import { CUE_WORDS, hrSlot, zoneWords } from '../../player/hrCue';
import { isEffort, observation, observationHr, stepStats, timeInZone, totals, type StepStats, type Totals } from '../../player/summary';
import { rampResult, testResultKey, twentyMinResult, withActions, type TestResult } from '../../player/tests';
import { rampContextFor } from '../maxHrSeen';
import { TestResults } from '../TestResults';
import { deleteRecording, downloadRide, getRecording, patchRecording, rideSeconds, uploadRide } from '../../player/rides';
import { setSetting } from '../../data/db';
import { keepVeloiqInstead, KEPT_GARMIN } from '../../player/garmin';
import { plannedSeconds, TRIVIAL_SECONDS } from '../../sync/syncService';
import type { Recording, Sample } from '../../player/types';
import type { TrainerMode } from '../../player/engine';
import { miles } from '../../engine/units';
import { isUnknown } from '../../engine/known';
import {
  answerBreath, answerHr, carryOnWithout, clearRide, nudgeBreath, currentRide, endRide, lapNow, pauseRide, resumeRide, setRideEffort, setRideFreeWatts, setRideLevel, setRideMode, setRideScale, skipStep, stopTest, subscribeRide, type ActiveRide,
} from '../rideController';

export function useRide(): ActiveRide | undefined {
  const [, set] = useState(0);
  useEffect(() => subscribeRide(() => set((n) => n + 1)), []);
  return currentRide();
}

const mmss = (s: number) => clock(Math.max(0, Math.round(s)));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const mph = (kmh: number, p: Profile) => (miles(p) ? `${(kmh / 1.609344).toFixed(1)}` : kmh.toFixed(1));
const speedUnit = (p: Profile) => (miles(p) ? 'mph' : 'km/h');
const distText = (m: number, p: Profile) => (miles(p) ? `${(m / 1609.344).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`);

function fullScreen() {
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {});
}

async function askEnd() {
  if (!confirm('End the ride?\n\nYou\'ll see your summary next, where you save it.')) return;
  await endRide();
}

// ── Riding (spec screen 2) ──────────────────────────────────────────────────

/** + and −, space and the rest, for a keyboard: the same on every size of screen. */
function useRideKeys(): void {
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
}

/** The ride, while riding. A phone gets three pages of one screen each (26 Nov 2026); everything larger, the one wide screen. */
export function Riding({ ride, profile }: { ride: ActiveRide; profile: Profile }) {
  const [phone] = useState(phoneScreen);
  const pad = usePadUpright();
  return phone ? <RidingPhone ride={ride} profile={profile} /> : pad ? <RidingPhone ride={ride} profile={profile} pad /> : <RidingWide ride={ride} profile={profile} />;
}

function RidingWide({ ride, profile }: { ride: ActiveRide; profile: Profile }) {
  const { sensors } = useSensors();
  const e = ride.engine;
  const tl = ride.timeline;
  const step = e.step;
  const next = e.next;
  const then = next ? tl[next.index + 1] : undefined;
  const byHr = ride.setup.basis === 'hr';
  const byBreath = !!ride.setup.byBreath;
  const t = totals(e.samples, profile.ftp, profile.lthr, undefined, ride.setup.basis);
  const testing = ride.setup.workout?.test === 'ramp';
  // An open-ended test has no planned length or load to measure against.
  const planned = ride.setup.workout && !testing ? workoutStats(ride.setup.workout.blocks) : undefined;
  const onRamp = !!step?.ramp && e.rampEndAt == null;
  const trainer = controlledTrainer();
  const paused = e.phase === 'paused';
  const zoneTime = byHr && tl.length ? timeInZone(e.samples, tl, (s) => targetBand(s, 'hr', profile)) : undefined;
  const hasPower = t.avgPower != null;
  // Step 3 (30 Oct): with a breathing strap connected, breathing takes cadence's tile and cadence joins the strip.
  const strap = sensors.find((s) => s.kind === 'breath' && s.status === 'connected');
  const ves = e.samples.map((x) => x.ve).filter((x): x is number => x != null);
  const avgVe = ves.length ? Math.round(ves.reduce((x, y) => x + y, 0) / ves.length) : undefined;
  const cadenceCell = strap && <div><span class="caption">Cadence · speed</span><div><b class="num">{ride.live.cadence != null ? Math.round(ride.live.cadence) : '—'}</b><small> rpm · </small><b class="num">{ride.live.speedKmh != null ? mph(ride.live.speedKmh, profile) : '—'}</b><small> {speedUnit(profile)}</small></div></div>;
  const veCell = strap && <div><span class="caption">Average ventilation</span><div><b class="num">{avgVe ?? '—'}</b><small> L/min</small></div></div>;

  useRideKeys();

  const lost = sensors.filter((s) => s.status === 'lost');
  return (
    <div class="player fit ride">
      <header class="pl-head">
        <Mark size={20} />
        <div class="rd-title">
          <div class="rd-name">{ride.setup.workout?.name ?? 'Free ride'}</div>
          <div class="rd-sub">{ride.setup.workout ? (ride.setup.workout.subtitle ?? '') : 'No workout: ride as you like'}</div>
        </div>
        <span style="flex:1" />
        <div class="rd-pills">{sensors.map((s) => <SensorPill key={s.id} s={s} mode={e.mode} byHr={byHr && ride.timeline.length > 0} byBreath={byBreath && ride.timeline.length > 0} />)}</div>
        <span class="pl-head-sep" />
        <button class="btn primary rd-pause" onClick={() => (paused ? resumeRide() : pauseRide())}>
          {paused ? <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M1 1.5v13a.8.8 0 0 0 1.2.7l11-6.5a.8.8 0 0 0 0-1.4l-11-6.5A.8.8 0 0 0 1 1.5z" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>}
          {paused ? 'Resume' : 'Pause'}
        </button>
        {onRamp && <button class="btn rd-stoptest" onClick={stopTest}>Stop the test</button>}
        <button class="btn" onClick={() => void askEnd()}>End ride</button>
        <KeysHelp />
      </header>
      {lost.length > 0 && <div class="rd-lost">{lost.map((s) => s.name).join(' and ')} lost: reconnecting… The ride keeps recording.</div>}
      {ride.breathQuiet && !lost.some((s) => s.kind === 'breath') && <div class="rd-lost">Breathing strap: no breaths, and Antogo could not wake it. Take it off for a minute and put it back on; Antogo keeps trying. The ride keeps recording.</div>}

      <main class="rd-main">
        <section class="rd-top">
          {byBreath ? <BreathHero ride={ride} profile={profile} trainerOk={!!trainer} /> : byHr ? <HrHero ride={ride} profile={profile} trainerOk={!!trainer} /> : <Hero ride={ride} profile={profile} trainerOk={!!trainer} />}
          {tl.length ? <Dial ride={ride} step={step} next={next} then={then} profile={profile} /> : <FreeCard ride={ride} trainerOk={!!trainer} />}
          <div class="rd-col">
            {byHr || byBreath ? <PowerTile watts={ride.shownWatts} sensors={sensors} by={byBreath ? 'breathing' : 'heart rate'} /> : <HrTile bpm={ride.live.bpm} samples={e.samples} profile={profile} />}
            {byBreath ? <HrTile bpm={ride.live.bpm} samples={e.samples} profile={profile} /> : strap ? <BreathTile shown={ride.shownBreath} name={cleanName(strap.name)} /> : <section class="rd-card rd-tile">
              <span class="caption">Cadence</span>
              <div class="rd-big2 num">{ride.live.cadence != null ? Math.round(ride.live.cadence) : '—'}<small> rpm</small></div>
              <div class="rd-grow" />
              <div class="rd-tile-foot"><span>{step?.cadence ? `Target ${step.cadence} rpm` : 'Any comfortable cadence'}</span><span><b class="num">{ride.live.speedKmh != null ? mph(ride.live.speedKmh, profile) : '—'}</b> {speedUnit(profile)}</span></div>
            </section>}
          </div>
        </section>

        {byHr ? (
          <section class={`rd-card rd-strip${strap ? ' tight' : ''}`} style={`grid-template-columns:repeat(${(hasPower ? 6 : 5) + (strap ? 1 : 0)}, minmax(0, 1fr))${strap ? ' minmax(0, 1.4fr)' : ''}`}>
            <div><span class="caption">Elapsed time</span><div><b class="num">{mmss(e.timer)}</b>{planned && <small> of {clock(planned.seconds)}</small>}</div></div>
            {zoneTime ? <div><span class="caption">Time in target zone</span><div><b class="num">{mmss(zoneTime.seconds)}</b>{zoneTime.share != null && <small> · {pct(zoneTime.share)} of steps</small>}</div></div>
              : <div><span class="caption">Highest heart rate</span><div><b class="num">{t.maxHr ?? '—'}</b><small> bpm</small></div></div>}
            <div><span class="caption">Average heart rate</span><div><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></div></div>
            <div><span class="caption">Training load so far</span><div><b class="num">{t.tss}</b><small>{planned ? ` of ${planned.tss} planned` : ' TSS'}</small></div></div>
            {hasPower && <div><span class="caption">Average power</span><div><b class="num">{t.avgPower}</b><small> W</small></div></div>}
            <div><span class="caption">Distance</span><div><b class="num">{distText(t.distanceM, profile).split(' ')[0]}</b><small> {miles(profile) ? 'mi' : 'km'}</small></div></div>
            {veCell}{cadenceCell}
          </section>
        ) : (
          <section class={`rd-card rd-strip${strap ? ' tight' : ''}`} style={strap ? 'grid-template-columns:repeat(7, minmax(0, 1fr)) minmax(0, 1.4fr)' : undefined}>
            <div><span class="caption">Elapsed time</span><div><b class="num">{mmss(e.timer)}</b>{planned && <small> of {clock(planned.seconds)}</small>}</div></div>
            <div><span class="caption">Average power</span><div><b class="num">{t.avgPower ?? '—'}</b><small> W</small></div></div>
            <div><span class="caption">Normalized power</span><div><b class="num">{t.np ?? '—'}</b><small> W</small></div></div>
            <div><span class="caption">Training load so far</span><div><b class="num">{t.tss}</b><small>{planned ? ` of ${planned.tss} planned` : ' TSS'}</small></div></div>
            <div><span class="caption">Average heart rate</span><div><b class="num">{t.avgHr ?? '—'}</b><small> bpm</small></div></div>
            <div><span class="caption">Work done</span><div><b class="num">{t.kj ?? '—'}</b><small> kJ</small></div></div>
            {veCell}{cadenceCell}
          </section>
        )}

        <section class="rd-card rd-chartcard">
          <div class="rd-chart-head">
            <span class="caption">{tl.length ? 'Workout' : 'Your ride'}</span>
            {byBreath && breathZones(profile) ? <>
              <span class="rd-key"><i class="ln br" />Your breathing, 30-second average</span>
              {tl.length > 0 && <span class="rd-key"><i class="bx" />Breathing target</span>}
              {hasPower && <span class="rd-key"><i class="ln" />Power</span>}
            </> : byHr ? <>
              <span class="rd-key"><i class="ln hr" />Your heart rate</span>
              {tl.length > 0 && <span class="rd-key"><i class="bx" />Target zone</span>}
              {hasPower && <span class="rd-key"><i class="ln" />Power</span>}
            </> : <>
              <span class="rd-key"><i class="ln" />Your power</span>
              {tl.length > 0 && <span class="rd-key"><i class="bx" />Target, coloured by zone</span>}
              <span class="rd-key"><i class="ln hr" />Heart rate</span>
            </>}
            <span style="flex:1" />
            {step && !step.ramp && <button class="btn sm quiet" onClick={skipStep}>Skip this step ›</button>}
          </div>
          <RideChart timeline={rampView(tl, e.position)} samples={e.samples} profile={profile} position={e.position} live by={byBreath ? 'breath' : ride.setup.basis} />
        </section>
      </main>

      {e.phase === 'countdown' && <div class="rd-overlay"><div class="rd-count num">{e.countdownLeft || 'Go'}</div><p>Get pedalling</p></div>}
      {paused && (
        <div class="rd-overlay" role="dialog" aria-label="Paused">
          <div class="rd-paused">
            <h2>{e.isAutoPaused ? 'Paused: you stopped pedalling' : 'Paused'}</h2>
            <p class="muted">{e.isAutoPaused ? 'Start pedalling and the ride carries on, or press Resume.' : 'The clock has stopped and the trainer has let go.'}</p>
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

// ── Riding on a phone: three pages of one screen each (26 Nov 2026) ──────────────────────────────────────────────

/** A step's target as words, and its colour, by what the ride is ridden by. */
function stepTarget(ride: ActiveRide, profile: Profile, s: TimelineStep): { text: string; colour: string } {
  const e = ride.engine;
  const bb = ride.setup.byBreath ? breathBand(s, profile, e.scale) : undefined;
  return {
    text: bb?.text ?? targetBand(s, ride.setup.basis, profile, e.scale).text,
    colour: bb?.zone ? breathZoneVar(bb.zone) : ZONE_VAR[(ride.setup.basis === 'hr' ? hrZoneOf(s, profile) : s.zone) - 1],
  };
}

/** The workout's steps as a list, with the one being ridden marked and kept in view. */
function PhoneSteps({ ride, profile, cols }: { ride: ActiveRide; profile: Profile; cols?: number }) {
  const e = ride.engine;
  const tl = ride.timeline;
  const cur = e.step?.index ?? (e.workoutDone ? tl.length : -1);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Moved by hand, never by scrollIntoView: that would also slide the pages sideways to this one.
    const b = box.current;
    const el = b?.querySelector<HTMLElement>('.now');
    if (b && el) b.scrollTop = Math.max(0, el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2);
  }, [cur]);
  return (
    <div class={`rd-card rp-steps${cols ? ' cols' : ''}`} style={cols ? `--rows:${Math.ceil(tl.length / cols)};--cols:${cols}` : undefined} ref={box} role="list" aria-label="Steps">
      {tl.map((s) => {
        const t = stepTarget(ride, profile, s);
        const state = s.index < cur ? 'done' : s.index === cur ? 'now' : '';
        return (
          <div key={s.index} role="listitem" class={`rp-step ${state}`}>
            <i style={`background:${t.colour}`} />
            <div class="rp-step-n"><b>{s.name}</b>{state === 'now' && <small class="num">{t.text} · now</small>}</div>
            <span class="num">{mmss(s.seconds)}<u> · {t.text}</u></span>
            <em>{state === 'done' ? 'Done' : state === 'now' ? 'Now' : ''}</em>
          </div>
        );
      })}
    </div>
  );
}

interface Cell { label: string; value: string | number; unit?: string; note?: string; cls?: string }

/** A phone's pages: a strip that snaps from one to the next, the page kept when the phone is turned. */
function usePages(count: number) {
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const at = useRef(0);
  at.current = page;
  const turning = useRef(0);
  const goTo = (i: number) => {
    const el = pager.current;
    if (!el) return;
    setPage(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = pager.current;
    if (!el || !el.clientWidth || Date.now() < turning.current) return;
    const i = Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)));
    if (i !== at.current) setPage(i);
  };
  useEffect(() => {
    const keep = () => { const el = pager.current; if (el) el.scrollLeft = at.current * el.clientWidth; };
    const turned = () => { turning.current = Date.now() + 500; keep(); setTimeout(keep, 120); setTimeout(keep, 400); };
    addEventListener('resize', turned);
    return () => removeEventListener('resize', turned);
  }, []);
  return { pager, page, goTo, onScroll };
}

function RidingPhone({ ride, profile, pad }: { ride: ActiveRide; profile: Profile; pad?: boolean }) {
  const { sensors } = useSensors();
  useRideKeys();
  const e = ride.engine;
  const tl = ride.timeline;
  const step = e.step;
  const next = e.next;
  const then = next ? tl[next.index + 1] : undefined;
  const byHr = ride.setup.basis === 'hr';
  const byBreath = !!ride.setup.byBreath;
  const t = totals(e.samples, profile.ftp, profile.lthr, undefined, ride.setup.basis);
  const testing = ride.setup.workout?.test === 'ramp';
  const planned = ride.setup.workout && !testing ? workoutStats(ride.setup.workout.blocks) : undefined;
  const onRamp = !!step?.ramp && e.rampEndAt == null;
  const trainer = controlledTrainer();
  const paused = e.phase === 'paused';
  const zoneTime = byHr && tl.length ? timeInZone(e.samples, tl, (s) => targetBand(s, 'hr', profile)) : undefined;
  const hasPower = t.avgPower != null;
  const strap = sensors.find((s) => s.kind === 'breath' && s.status === 'connected');
  const ves = e.samples.map((x) => x.ve).filter((x): x is number => x != null);
  const avgVe = ves.length ? Math.round(ves.reduce((x, y) => x + y, 0) / ves.length) : undefined;
  const lost = sensors.filter((s) => s.status === 'lost');

  const { pager, page, goTo, onScroll } = usePages(3);

  const dash = '—';
  const bpm = ride.live.bpm != null ? Math.round(ride.live.bpm) : undefined;
  const cadence = ride.live.cadence != null ? Math.round(ride.live.cadence) : undefined;
  const speed = ride.live.speedKmh != null ? mph(ride.live.speedKmh, profile) : undefined;
  const lthrKnown = !isUnknown(profile, 'lthr');
  const st = step && !step.step.allOut ? ride.band.state : undefined;
  const zoneWord = st === 'on' ? 'in zone' : st === 'under' ? 'below zone' : st === 'over' ? 'above zone' : undefined;

  // The live readings in brief, for the pages that are not the Ride page.
  const first: Cell = byBreath ? { label: `Breathing${zoneWord && breathBand(step!, profile, e.scale) ? ` · ${zoneWord}` : ''}`, value: ride.veNow != null ? Math.round(ride.veNow) : dash, unit: 'L/min' }
    : byHr ? { label: `Heart rate${zoneWord && lthrKnown ? ` · ${zoneWord}` : ''}`, value: ride.shownBpm ?? dash, unit: 'bpm', cls: 'rd-hr' }
    : { label: `Power${st && !isUnknown(profile, 'ftp') ? ` · ${st === 'on' ? 'on target' : st}` : ''}`, value: ride.shownWatts ?? dash, unit: 'W' };
  const second: Cell = step ? { label: 'Left in step', value: mmss(step.end - e.position) } : { label: 'Elapsed', value: mmss(e.timer) };
  const third: Cell = byHr ? { label: 'Power', value: ride.shownWatts ?? dash, unit: 'W' } : { label: 'Heart rate', value: bpm ?? dash, unit: 'bpm', cls: 'rd-hr' };
  const live = (cls: string) => (
    <div class={`rp-live ${cls}`}>
      {[first, second, third].map((c) => <div key={c.label}><span class="caption">{c.label}</span><div><b class={`num ${c.cls ?? ''}`}>{c.value}</b>{c.unit && <small> {c.unit}</small>}</div></div>)}
    </div>
  );

  // The Ride page's small tiles: the live readings the big number is not.
  const hz = bpm && lthrKnown ? hrZone(bpm / profile.lthr, rideHrZones(profile)) : undefined;
  const hrT: Cell = { label: 'Heart rate', value: bpm ?? dash, unit: 'bpm', note: hz ? `Zone ${hz}` : '', cls: 'rd-hr' };
  const pwT: Cell = { label: 'Power', value: ride.shownWatts ?? dash, unit: 'W' };
  const cadT: Cell = { label: 'Cadence', value: cadence ?? dash, unit: 'rpm', note: step?.cadence ? `Target ${step.cadence}` : '' };
  const spT: Cell = { label: 'Speed', value: speed ?? dash, unit: speedUnit(profile) };
  const brT: Cell | undefined = strap ? { label: 'Breathing', value: ride.shownBreath?.ve != null ? Math.round(ride.shownBreath.ve) : dash, unit: 'L/min', note: ride.shownBreath?.br != null ? `${brShown(ride.shownBreath.br)} a minute` : '', cls: 'rp-br' } : undefined;
  const tiles = (byBreath ? [pwT, hrT, cadT, spT] : byHr ? [pwT, cadT, brT, spT] : [hrT, cadT, brT, spT]).filter((c): c is Cell => !!c);

  // The Numbers page: every total, and the readings a total is not kept for.
  const dist = distText(t.distanceM, profile).split(' ');
  const nums: Cell[] = [
    { label: 'Elapsed', value: mmss(e.timer), note: planned ? `of ${clock(planned.seconds)}` : '' },
    { label: 'Training load', value: t.tss, unit: planned ? '' : 'TSS', note: planned ? `of ${planned.tss} planned` : '' },
    ...(zoneTime ? [{ label: 'Time in target zone', value: mmss(zoneTime.seconds), note: zoneTime.share != null ? `${pct(zoneTime.share)} of steps` : '' }] : []),
    { label: 'Average heart rate', value: t.avgHr ?? dash, unit: 'bpm' },
    { label: 'Highest heart rate', value: t.maxHr ?? dash, unit: 'bpm' },
    ...(hasPower || !byHr ? [
      { label: 'Average power', value: t.avgPower ?? dash, unit: 'W' },
      { label: 'Normalized power', value: t.np ?? dash, unit: 'W' },
      { label: 'Work done', value: t.kj ?? dash, unit: 'kJ' },
    ] : []),
    { label: 'Cadence', value: cadence ?? dash, unit: 'rpm' },
    { label: 'Speed', value: speed ?? dash, unit: speedUnit(profile) },
    { label: 'Distance', value: dist[0], unit: dist[1] },
    ...(strap ? [
      { label: 'Average ventilation', value: avgVe ?? dash, unit: 'L/min' },
      { label: 'Breaths', value: ride.shownBreath?.br != null ? brShown(ride.shownBreath.br) : dash, unit: 'a minute', note: ride.shownBreath?.tv != null ? `${ride.shownBreath.tv.toFixed(1)} L a breath` : '' },
    ] : []),
  ];

  const names = ['Ride', 'Numbers', tl.length ? 'Workout' : 'Chart'];
  const list = tl.length > 0 && !testing;
  const sub = [`${mmss(e.timer)}${planned ? ` of ${clock(planned.seconds)}` : ''}`, ride.setup.workout?.subtitle].filter(Boolean).join(' · ');
  const heroCard = <>
          {byBreath ? <BreathHero ride={ride} profile={profile} trainerOk={!!trainer} bare /> : byHr ? <HrHero ride={ride} profile={profile} trainerOk={!!trainer} bare /> : <Hero ride={ride} profile={profile} trainerOk={!!trainer} bare />}
  </>;
  const stepCard = <>
          {tl.length ? <Dial ride={ride} step={step} next={next} then={then} profile={profile} /> : <FreeCard ride={ride} trainerOk={!!trainer} phone />}
  </>;
  const chartCard = <>
          <section class="rd-card rd-chartcard">
            <div class="rd-chart-head">
              <span class="caption">{tl.length ? 'Workout' : 'Your ride'}</span>
              {byBreath && breathZones(profile) ? <>
                <span class="rd-key"><i class="ln br" />Your breathing</span>
                {tl.length > 0 && <span class="rd-key"><i class="bx" />Target</span>}
                {hasPower && <span class="rd-key"><i class="ln" />Power</span>}
              </> : byHr ? <>
                <span class="rd-key"><i class="ln hr" />Your heart rate</span>
                {tl.length > 0 && <span class="rd-key"><i class="bx" />Target zone</span>}
                {hasPower && <span class="rd-key"><i class="ln" />Power</span>}
              </> : <>
                <span class="rd-key"><i class="ln" />Your power</span>
                {tl.length > 0 && <span class="rd-key"><i class="bx" />Target</span>}
                <span class="rd-key"><i class="ln hr" />Heart rate</span>
              </>}
            </div>
            <RideChart timeline={rampView(tl, e.position)} samples={e.samples} profile={profile} position={e.position} live by={byBreath ? 'breath' : ride.setup.basis} />
          </section>
  </>;
  const controls = <>
          <div class="rp-ctl">
            {byBreath ? <BreathControls ride={ride} trainerOk={!!trainer} /> : byHr ? <HrControls ride={ride} trainerOk={!!trainer} /> : <PowerControls ride={ride} trainerOk={!!trainer} />}
            {step && !step.ramp && <button class="btn quiet rp-skip" aria-label="Skip this step ›" onClick={skipStep}><span>Skip<span class="rp-skip-more"> this step</span> ›</span></button>}
          </div>
  </>;
  const overlays = <>
      {e.phase === 'countdown' && <div class="rd-overlay"><div class="rd-count num">{e.countdownLeft || 'Go'}</div><p>Get pedalling</p></div>}
      {paused && (
        <div class="rd-overlay" role="dialog" aria-label="Paused">
          <div class="rd-paused">
            <h2>{e.isAutoPaused ? 'Paused: you stopped pedalling' : 'Paused'}</h2>
            <p class="muted">{e.isAutoPaused ? 'Start pedalling and the ride carries on, or press Resume.' : 'The clock has stopped and the trainer has let go.'}</p>
            <div class="row" style="gap:10px;justify-content:center;margin-top:16px">
              <button class="btn primary rd-resume" onClick={resumeRide}>Resume</button>
              <button class="btn" onClick={() => void askEnd()}>End ride</button>
            </div>
          </div>
        </div>
      )}
  </>;
  const notices = <>
      {lost.length > 0 && <div class="rd-lost">{lost.map((s) => s.name).join(' and ')} lost: reconnecting… The ride keeps recording.</div>}
      {ride.breathQuiet && !lost.some((s) => s.kind === 'breath') && <div class="rd-lost">Breathing strap: no breaths, and Antogo could not wake it. Take it off for a minute and put it back on; Antogo keeps trying. The ride keeps recording.</div>}

  </>;

  // An upright iPad (26 Nov 2026): everything on one screen, with no pages. The ride's profile keeps one proportion
  // wherever it is drawn, and the room it leaves goes to the step list.
  if (pad) {
    const four = (byBreath ? [pwT, hrT, cadT, spT] : byHr ? [pwT, cadT, spT, brT] : [hrT, cadT, spT, brT]).filter((c): c is Cell => !!c);
    const sums = nums.filter((c) => c.label !== 'Cadence' && c.label !== 'Speed');
    return (
      <div class="player ride rp rpad">
        <header class="rp-bar">
        <div class="rp-title">
          <div class="rp-name">{ride.setup.workout?.name ?? 'Free ride'}</div>
          <div class="rp-sub num">{sub}</div>
        </div>
        {onRamp && <button class="btn rd-stoptest" onClick={stopTest}>Stop the test</button>}
        <button class="btn" onClick={() => void askEnd()}>End ride</button>
        <button class="btn primary rd-pause" onClick={() => (paused ? resumeRide() : pauseRide())}>{paused ? 'Resume' : 'Pause'}</button>
        </header>
        {notices}
        <div class="rpad-body">
          {heroCard}
          <div class="rpad-mid">
            {stepCard}
            <div class="rp-tiles">
              {four.map((c) => <div key={c.label} class="rp-tile"><span class="caption">{c.label}</span><div><b class={`num ${c.cls ?? ''}`}>{c.value}</b><small>{c.unit}</small></div><em>{c.note}</em></div>)}
            </div>
          </div>
          <div class="rd-card rpad-sums" style={`--n:${sums.length}`}>
            {sums.map((c) => <div key={c.label}><span class="caption">{c.label}</span><div><b class="num">{c.value}</b>{c.unit && <small> {c.unit}</small>}</div></div>)}
          </div>
          {chartCard}
          {list && <PhoneSteps ride={ride} profile={profile} cols={3} />}
          {controls}
        </div>
        {overlays}
      </div>
    );
  }

  return (
    <div class={`player ride rp${page ? ' rp-away' : ''}`}>
      <header class="rp-bar">
        <div class="rp-title">
          <div class="rp-name">{ride.setup.workout?.name ?? 'Free ride'}</div>
          <div class="rp-sub num">{sub}</div>
        </div>
        {live('rp-live-bar')}
        {onRamp && <button class="btn rd-stoptest" onClick={stopTest}>Stop the test</button>}
        <button class="btn" onClick={() => void askEnd()}>End ride</button>
        <button class="btn primary rd-pause" onClick={() => (paused ? resumeRide() : pauseRide())}>{paused ? 'Resume' : 'Pause'}</button>
      </header>
      {notices}

      <div class="rp-pages" ref={pager} onScroll={onScroll}>
        <section class="rp-page rp-ride" aria-label={names[0]}>
          {heroCard}
          {stepCard}
          <div class="rp-tiles">
            {tiles.map((c) => <div key={c.label} class="rp-tile"><span class="caption">{c.label}</span><div><b class={`num ${c.cls ?? ''}`}>{c.value}</b><small>{c.unit}</small></div><em>{c.note}</em></div>)}
          </div>
        </section>

        <section class="rp-page rp-numbers" aria-label={names[1]}>
          {live('rp-live-page')}
          <div class="rp-grid" style={`--cols:${Math.ceil(nums.length / (nums.length > 10 ? 3 : 2))}`}>
            {nums.map((c) => <div key={c.label} class="rp-num"><span class="caption">{c.label}</span><div><b class="num">{c.value}</b>{c.unit && <small> {c.unit}</small>}</div>{c.note && <em>{c.note}</em>}</div>)}
          </div>
        </section>

        <section class={`rp-page rp-workout${list ? '' : ' nolist'}`} aria-label={names[2]}>
          {live('rp-live-page')}
          {chartCard}
          {list && <PhoneSteps ride={ride} profile={profile} />}
          {controls}
        </section>
      </div>

      <nav class="rp-dots" aria-label="Pages">
        {names.map((n, i) => <button key={n} class={page === i ? 'on' : ''} aria-current={page === i ? 'page' : undefined} onClick={() => goTo(i)}><i />{n}</button>)}
      </nav>

      {overlays}
    </div>
  );
}

function SensorPill({ s, mode, byHr, byBreath }: { s: SensorState; mode: TrainerMode; byHr?: boolean; byBreath?: boolean }) {
  const word = s.kind === 'trainer' ? `Trainer · ${!s.controllable ? 'not in control' : byBreath && mode === 'erg' ? 'adjusting to breathing' : byHr && mode === 'erg' ? 'adjusting to heart rate' : MODE_WORD[mode]}` : s.kind === 'power' ? 'Power' : s.kind === 'hr' ? 'Heart rate' : s.kind === 'breath' ? 'Breathing' : 'Cadence';
  return <span class={`rd-pill ${s.status}`}><i />{word}</span>;
}
const MODE_WORD: Record<TrainerMode, string> = { erg: 'ERG', resistance: 'Resistance', free: 'Free ride', self: 'your gears' };

function KeysHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div class="menu rd-keys-help">
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
  else if (e.mode === 'erg' && r.setup.byBreath) nudgeBreath(dir);
  else if (e.mode === 'erg' && r.setup.basis === 'power') setRideScale(e.scale + 0.01 * dir);
}

/** Riding by heart rate (spec screen 3): heart rate is the big number, against the step's zone, with the cue when you drift out of it. */
/** What the player says in place of a target during an all-out step (12 Nov 2026). */
const ALL_OUT_WORDS = <><b>All out.</b> No number to hit: everything you have until the step ends.</>;

function HrHero({ ride, profile, trainerOk, bare }: { ride: ActiveRide; profile: Profile; trainerOk: boolean; bare?: boolean }) {
  const e = ride.engine;
  const step = e.step;
  // Threshold heart rate not known yet (13 Nov 2026): no band built on a stand-in; the zone, by feel.
  const noNumber = isUnknown(profile, 'lthr');
  const band = step && !step.step.allOut && !noNumber ? targetBand(step, 'hr', profile) : undefined;
  const bpm = ride.shownBpm;
  const mb = ride.markerBpm ?? bpm;
  const state = band && mb != null ? ride.band.state : undefined;
  const lo = band ? (band.low || Math.round(band.high * 0.8)) : 0;
  const span = band ? Math.max(14, (band.high - lo) * 1.1) : 1;
  const mid = band ? (lo + band.high) / 2 : 0;
  const pos = (x: number) => Math.max(0, Math.min(100, band ? ((x - (mid - span)) / (2 * span)) * 100 : 50));
  const zone = step ? hrZoneOf(step, profile) : undefined;
  const adjusting = e.mode === 'erg' && ride.timeline.length > 0;
  return (
    <section class="rd-card rd-hero">
      <div class="row between">
        <span class="caption">Heart rate<span class="rd-smooth"> · {ride.setup.smoothing === 1 ? 'every second' : `${ride.setup.smoothing}-second average`}</span></span>
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
          <div class="rd-band-words"><span>Too easy</span><span>{band && mb != null ? zoneWords(mb, band, !adjusting && ride.cueState.closing) : ''}</span><span>Too hard</span></div>
        </>
      ) : <div class="rd-target"><span class="muted">{e.workoutDone && ride.timeline.length ? 'Workout complete: ride on, or end the ride.' : step?.step.allOut ? ALL_OUT_WORDS : noNumber && zone ? `Zone ${zone}, by feel: your threshold heart rate is not known yet.` : 'Free ride: no target.'}</span></div>}
      {/* One message slot (10 Nov 2026): an instruction, the trainer's account of itself, or nothing; its space is always kept, so nothing below moves. */}
      {(() => {
        const slot = hrSlot({ adjusting, status: ride.hr?.status, cue: step && band ? ride.cue : undefined });
        if (slot.kind === 'status') return <div class="rd-signal quiet" aria-live="polite"><span>{slot.text}</span></div>;
        if (slot.kind === 'signal') {
          const w = CUE_WORDS[slot.cue];
          return (
            <div class="rd-signal on" role="status" aria-live="polite">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{slot.cue === 'under' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}</svg>
              <b>{w.head}</b><span class="rd-signal-how">{w.short}</span>
            </div>
          );
        }
        return <div class="rd-signal" aria-hidden="true" />;
      })()}
      {adjusting && ride.hr?.st.asking && (
        <div class="rd-ask" role="group" aria-label="Heart rate staying low">
          <span>Your heart rate is staying low today.</span>
          <button class="btn" onClick={() => answerHr('harder')}>Allow harder</button>
          <button class="btn quiet" onClick={() => answerHr('keep')}>Keep it here</button>
        </div>
      )}
      {!bare && <><div class="rd-grow" /><HrControls ride={ride} trainerOk={trainerOk} /></>}
    </section>
  );
}


/**
 * Riding by breathing (Step 5, 11 Nov 2026): the same layout as by heart rate, with breathing in heart rate's
 * place. Ventilation (30 seconds, corrected for today's strap) large with breathing rate beside it; the step's
 * breathing range as the target bar; the one message line beneath. Watts and heart rate are in the tiles beside.
 */
function BreathHero({ ride, profile, trainerOk, bare }: { ride: ActiveRide; profile: Profile; trainerOk: boolean; bare?: boolean }) {
  const e = ride.engine;
  const step = e.step;
  const b = step && !step.step.allOut ? breathBand(step, profile, e.scale) : undefined;
  const ve = ride.veNow;
  const mv = ride.markerVe ?? ve;
  const lowShown = b && step?.noFloor ? 0 : b?.low ?? 0;
  const state = b && mv != null ? ride.band.state : undefined;
  const lo = b ? (lowShown || Math.round(b.high * 0.8)) : 0;
  const span = b ? Math.max(4, (b.high - lo) * 1.1) : 1;
  const mid = b ? (lo + b.high) / 2 : 0;
  const pos = (x: number) => Math.max(0, Math.min(100, b ? ((x - (mid - span)) / (2 * span)) * 100 : 50));
  const adjusting = e.mode === 'erg' && ride.timeline.length > 0;
  const trend = adjusting && ride.breath ? breathTrend(ride.breath.st) : ride.cueState.closing;
  const words = b && mv != null ? (mv > b.high ? `Above the zone${trend ? `, ${trend}` : ''}` : step?.noFloor || mv >= lowShown ? `In zone${trend ? `, ${trend}` : ''}` : `Below the zone${trend ? `, ${trend}` : ''}`) : '';
  return (
    <section class="rd-card rd-hero">
      <div class="row between">
        <span class="caption">Breathing<span class="rd-smooth"> · 30-second average</span></span>
        {state && <span class={`rd-state ${state}`}>{state === 'on' ? 'In zone' : state === 'under' ? 'Below the zone' : 'Above the zone'}</span>}
      </div>
      <div class="rd-breath-pair rd-big-pair">
        <div class="rd-big num">{ve != null ? Math.round(ve) : '—'}<small>L/min</small></div>
        <div class="rd-big num rd-big-b">{ride.shownBreath?.br != null ? brShown(ride.shownBreath.br) : '—'}<small>a minute</small></div>
      </div>
      {b && step ? (
        <>
          <div class="rd-target"><span class="muted">Target</span><b class="num" style={`color:${breathZoneVar(b.zone)}`}>Zone {b.zone} · {b.text}</b></div>
          <div class="rd-band" aria-hidden="true">
            <div class="rd-band-track" />
            <div class="rd-band-ok" style={`left:${pos(lowShown || lo - span)}%;width:${Math.max(2, pos(b.high) - pos(lowShown || lo - span))}%`} />
            {mv != null && <div class="rd-band-mark" style={`left:${pos(mv)}%`} />}
          </div>
          <div class="rd-band-words"><span>Too easy</span><span>{words}</span><span>Too hard</span></div>
        </>
      ) : <div class="rd-target"><span class="muted">{e.workoutDone && ride.timeline.length ? 'Workout complete: ride on, or end the ride.' : step?.step.allOut ? ALL_OUT_WORDS : 'No target.'}</span></div>}
      {ride.breathStopped ? (
        <div class="rd-ask" role="group" aria-label="Breathing has stopped arriving">
          <span>Breathing has stopped arriving.{adjusting ? ' The trainer is holding these watts.' : ''}</span>
          {ride.setup.workout?.bases.includes('hr') && ride.live.bpm != null && <button class="btn" onClick={() => carryOnWithout('hr')}>Carry on by heart rate</button>}
          <button class="btn quiet" onClick={() => carryOnWithout('power')}>Carry on by power</button>
        </div>
      ) : (() => {
        const slot = hrSlot({ adjusting, status: ride.breath?.status, cue: step && b ? ride.cue : undefined });
        if (slot.kind === 'status') return <div class="rd-signal quiet" aria-live="polite"><span>{slot.text}</span></div>;
        if (slot.kind === 'signal') {
          const w = CUE_WORDS[slot.cue];
          return (
            <div class="rd-signal on" role="status" aria-live="polite">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{slot.cue === 'under' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}</svg>
              <b>{w.head}</b><span class="rd-signal-how">{w.short}</span>
            </div>
          );
        }
        return <div class="rd-signal" aria-hidden="true" />;
      })()}
      {adjusting && ride.breath?.st.asking && !ride.breathStopped && (
        <div class="rd-ask" role="group" aria-label="Breathing staying low">
          <span>Your breathing is staying low today.</span>
          <button class="btn" onClick={() => answerBreath('harder')}>Allow harder</button>
          <button class="btn quiet" onClick={() => answerBreath('keep')}>Keep it here</button>
        </div>
      )}
      {!bare && <><div class="rd-grow" /><BreathControls ride={ride} trainerOk={trainerOk} /></>}
    </section>
  );
}

/**
 * Breathing (Step 3): ventilation over 30 seconds and breaths a minute, large and side by side (Step 2c, Part D,
 * 7 Nov 2026: with a strap that records breath size faintly, breathing rate carries as much as the litres); breath
 * size under them. No zones yet.
 */
function BreathTile({ shown, name }: { shown?: { ve?: number; br?: number; tv?: number }; name: string }) {
  return (
    <section class="rd-card rd-tile rd-breath">
      <div class="row between" style="gap:8px;min-width:0"><span class="caption">Breathing</span><span class="faint small rd-breath-from" title={name}>{name}</span></div>
      <div class="rd-breath-pair">
        <div class="rd-big2 num">{shown?.ve != null ? Math.round(shown.ve) : '—'}<small> L/min</small></div>
        <div class="rd-big2 num">{shown?.br != null ? brShown(shown.br) : '—'}<small> a minute</small></div>
      </div>
      <div class="rd-grow" />
      <div class="rd-tile-foot"><span><b class="num">{shown?.tv != null ? shown.tv.toFixed(1) : '—'}</b> L a breath</span></div>
    </section>
  );
}

/** On a ride by heart rate: power, for interest, from whichever device supplies it. */
function PowerTile({ watts, sensors, by = 'heart rate' }: { watts?: number; sensors: SensorState[]; by?: string }) {
  const meter = sensors.find((s) => s.kind === 'power' && s.status === 'connected');
  const trainer = sensors.find((s) => s.kind === 'trainer' && s.status === 'connected');
  const from = meter ? 'from your power meter' : trainer ? 'from your trainer' : undefined;
  return (
    <section class="rd-card rd-tile">
      <span class="caption">Power{from ? ` · ${from}` : ''}</span>
      <div class="rd-big2 num">{watts ?? '—'}<small> W</small></div>
      <div class="rd-grow" />
      <div class="faint small">{from ? (by === 'breathing' ? 'What the trainer is giving you.' : 'Shown for interest, not as a target.') : `No power source: nothing needed for a ride by ${by}.`}</div>
    </section>
  );
}

/** A free ride's centre card: what the trainer is doing, large, with + and −. */
function FreeCard({ ride, trainerOk, phone }: { ride: ActiveRide; trainerOk: boolean; phone?: boolean }) {
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
        <p class="faint small">{control ? (phone ? 'Change it with the buttons. Pick another way to ride on the Chart page.' : 'Change it with the buttons or the + and − keys. Pick another way to ride under the big number.') : 'Ride as you like; end the ride when you are done.'}</p>
      </div>
    </section>
  );
}

function Hero({ ride, profile, trainerOk, bare }: { ride: ActiveRide; profile: Profile; trainerOk: boolean; bare?: boolean }) {
  const e = ride.engine;
  const step = e.step ?? (e.workoutDone ? undefined : undefined);
  const noNumber = isUnknown(profile, 'ftp');
  const band = step && !step.step.allOut && !noNumber ? targetBand(step, 'power', profile, e.scale) : undefined;
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
        <span class="caption">Power<span class="rd-smooth"> · {ride.setup.smoothing === 1 ? 'every second' : `${ride.setup.smoothing}-second average`}</span></span>
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
      ) : <div class="rd-target"><span class="muted">{e.workoutDone && ride.timeline.length ? 'Workout complete: ride on, or end the ride.' : step?.step.allOut ? ALL_OUT_WORDS : noNumber && step ? `Zone ${step.zone}, ${pct(((step.low + step.high) / 2) * e.scale)} of FTP, by feel: your FTP is not known yet.` : 'Free ride: no target.'}</span></div>}
      {!bare && <><div class="rd-grow" /><PowerControls ride={ride} trainerOk={trainerOk} /></>}
    </section>
  );
}

/** The trainer's controls on a ride by heart rate. */
function HrControls({ ride, trainerOk }: { ride: ActiveRide; trainerOk: boolean }) {
  const e = ride.engine;
  return (
    <>
      {trainerOk && e.mode !== 'self' && (
        <div class="rd-controls">
          <div class="seg" role="group" aria-label="Trainer">
            {((ride.timeline.length ? ['erg', 'resistance', 'free'] : ['resistance', 'free']) as TrainerMode[]).map((m) => <button key={m} class={e.mode === m ? 'on' : ''} aria-pressed={e.mode === m} onClick={() => setRideMode(m)}>{m === 'erg' ? 'Adjusts to heart rate' : m === 'resistance' ? 'Set resistance' : 'Free ride'}</button>)}
          </div>
          <span style="flex:1" />
          {ride.timeline.length > 0 && e.mode === 'resistance' && <Stepper label="Level" value={`${e.level}`} onDown={() => setRideLevel(e.level - 1)} onUp={() => setRideLevel(e.level + 1)} />}
        </div>
      )}
    </>
  );
}

/** The trainer's controls on a ride by breathing. */
function BreathControls({ ride, trainerOk }: { ride: ActiveRide; trainerOk: boolean }) {
  const e = ride.engine;
  return (
    <>
      {trainerOk && e.mode !== 'self' && (
        <div class="rd-controls">
          <div class="seg" role="group" aria-label="Trainer">
            {(['erg', 'resistance', 'free'] as TrainerMode[]).map((m) => <button key={m} class={e.mode === m ? 'on' : ''} aria-pressed={e.mode === m} onClick={() => setRideMode(m)}>{m === 'erg' ? 'Adjusts to breathing' : MODE_WORD[m]}</button>)}
          </div>
        </div>
      )}
      {trainerOk && e.mode !== 'self' && (e.mode === 'erg' || e.mode === 'resistance') && (
        <div class="rd-controls">
          <span class="faint small">{e.mode === 'erg' ? 'Set the watts yourself for the rest of this step' : 'Resistance level'}</span>
          <span style="flex:1" />
          {e.mode === 'erg' && <Stepper label="Watts" value={`${e.ergTarget() ?? '—'}`} onDown={() => nudgeBreath(-1)} onUp={() => nudgeBreath(1)} />}
          {e.mode === 'resistance' && <Stepper label="Level" value={`${e.level}`} onDown={() => setRideLevel(e.level - 1)} onUp={() => setRideLevel(e.level + 1)} />}
        </div>
      )}
    </>
  );
}

/** How the trainer is driven on a ride by power, and how hard: under the big number on a wide screen, on the Workout page on a phone. */
function PowerControls({ ride, trainerOk }: { ride: ActiveRide; trainerOk: boolean }) {
  const e = ride.engine;
  return (
    <div class="rd-controls">
      {trainerOk ? (
        <div class="seg" role="group" aria-label="Trainer">
          {(['erg', 'resistance', 'free'] as TrainerMode[]).map((m) => <button key={m} class={e.mode === m ? 'on' : ''} aria-pressed={e.mode === m} onClick={() => setRideMode(m)}>{m === 'erg' ? (ride.timeline.length ? 'ERG' : 'Hold watts') : m === 'resistance' ? 'Resistance' : 'Free ride'}</button>)}
        </div>
      ) : <span class="faint small">{ride.timeline.length ? "You're riding to the targets yourself." : 'Riding with your gears.'}</span>}
      <span style="flex:1" />
      {!ride.timeline.length ? null : e.mode === 'resistance' && trainerOk ? (
        <Stepper label="Level" value={`${e.level}`} onDown={() => setRideLevel(e.level - 1)} onUp={() => setRideLevel(e.level + 1)} />
      ) : e.mode !== 'free' && ride.timeline.length > 0 && !ride.setup.workout?.test ? (
        <Stepper label="Intensity" value={pct(e.scale)} onDown={() => setRideScale(e.scale - 0.01)} onUp={() => setRideScale(e.scale + 0.01)} />
      ) : null}
    </div>
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
  const band = (s: TimelineStep) => (ride.setup.byBreath ? breathBand(s, profile, e.scale)?.text : undefined) ?? targetBand(s, ride.setup.basis, profile, e.scale).text;
  const zoneColour = (s: TimelineStep) => { const bz = ride.setup.byBreath ? breathBand(s, profile, e.scale)?.zone : undefined; return bz ? breathZoneVar(bz) : ZONE_VAR[(ride.setup.basis === 'hr' ? hrZoneOf(s, profile) : s.zone) - 1]; };
  const index = step.index + 1, of = ride.timeline.length;
  return (
    <section class="rd-card rd-dial">
      <div class="row between" style="align-self:stretch">
        <span class="caption">{step.ramp ? `Ramp step ${step.ramp}` : `Step ${index} of ${of}${step.setNote ? ` · ${step.setNote}` : ''}`}</span>
        {(() => { const bz = ride.setup.byBreath ? breathBand(step, profile, e.scale)?.zone : undefined; const z = bz ?? (ride.setup.basis === 'hr' ? hrZoneOf(step, profile) : step.zone); return <span class="rd-zone" style={`--c:${bz ? breathZoneVar(bz) : ZONE_VAR[z - 1]}`}>{bz ? 'Breathing zone' : 'Zone'} {z}{step.ramp ? '' : ` · ${step.name}`}</span>; })()}
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
          <span class="faint small">{mmss(done)} of {mmss(step.seconds)} done</span>
        </div>
      </div>
      {/* The message line (10 Nov 2026): the workout's own voice, directly under the ring. Two lines' room, so a long
          cue doesn't move Next. A ride's cue arrives in teal and settles to ink; a step without one shows the plain default. */}
      <div class="rd-msg" aria-live="polite">
        {step.ramp ? <p class="rd-cue">Hold it as long as you can. Press <b>Stop the test</b> when you can't.</p>
          : cueAt(step, done) ? <p key={`${step.index}|${cueAt(step, done)}`} class="rd-cue rd-cue-own">{cueAt(step, done)}</p>
          : <p class="rd-cue rd-cue-default">{step.cadence ? `Hold about ${step.cadence} rpm.` : step.work ? 'Settle in and hold it steady.' : 'Easy: spin and recover.'}</p>}
      </div>
      <div class="rd-grow" />
      <div class="rd-next">
        {next ? <div><span class="caption">Next</span><i style={`background:${zoneColour(next)}`} /><b>{next.name}</b><span class="num muted">{mmss(next.seconds)} · {band(next)}</span></div>
          : <div><span class="caption">Next</span><i style="background:var(--good)" /><b>Workout complete</b><span class="muted">ride on, or end</span></div>}
        {then && <div><span class="caption">Then</span><i style={`background:${zoneColour(then)}`} /><span class="muted">{then.name}</span><span class="num muted">{mmss(then.seconds)} · {band(then)}</span></div>}
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
export function RideChart({ timeline, samples, profile, position, live, by = 'power' }: { timeline: TimelineStep[]; samples: Sample[]; profile: Profile; position?: number; live?: boolean; by?: 'power' | 'hr' | 'breath' }) {
  // A free ride's chart starts ten minutes wide and grows with the ride.
  const total = Math.max(totalSeconds(timeline), samples.length ? (samples[samples.length - 1].p ?? samples.length) + 1 : 0, timeline.length ? 60 : 600);
  const W = 1000, H = 200, HH = 56;
  const x = (sec: number) => (sec / total) * W;
  // By breathing (11 Nov 2026): the main plot is ventilation over each step's breathing target, with power beneath,
  // just as a ride by heart rate draws heart rate over its zones. Without the rider's breathing zones it falls back.
  const byBreath = by === 'breath' && !!breathZones(profile);
  const byHr = by === 'hr' || (by === 'breath' && !byBreath);
  const alt = byHr || byBreath;
  const ws = samples.map((s) => s.w ?? 0);
  const ves = byBreath ? samples.map((s) => s.ve).filter((v): v is number => v != null && v > 0) : [];
  const bBands = byBreath ? timeline.map((s) => breathBand(s, profile)) : [];
  const hrs = samples.map((s) => s.hr).filter((h): h is number => h != null && h > 0);
  const hasPower = samples.some((s) => s.w != null);
  // The main plot's scale: watts from 0, or bpm across the useful range.
  const bands = byHr ? timeline.map((s) => targetBand(s, 'hr', profile)) : [];
  const top = byBreath ? Math.max((profile.vt2Ve ?? 60) * 1.25, ...ves.map((v) => v * 1.05), ...bBands.map((b) => (b ? b.high * 1.1 : 0))) : byHr ? Math.max(profile.maxHr, ...hrs, ...bands.map((b) => b.high + 5)) : Math.max(profile.ftp * 1.25, ...timeline.map((s) => s.high * profile.ftp * 1.1), ...(ws.length ? [Math.max(...ws) * 1.05] : []));
  // Breathing's scale starts a little under the lowest target or reading, not at zero, so the bands have room to be read.
  const bLows = bBands.map((b) => (b ? b.low || b.high * 0.8 : 0)).filter((v) => v > 0);
  const bottom = byBreath ? Math.max(0, Math.floor(Math.min(...ves, ...bLows, (profile.vt2Ve ?? 60) * 0.5) * 0.75)) : byHr ? Math.min(Math.round(profile.lthr * 0.55), ...hrs.map((h) => h - 5)) : 0;
  const y = (v: number) => H - ((v - bottom) / Math.max(1, top - bottom)) * H;
  // The strip beneath: heart rate (by power) or power (by heart rate).
  const stripVals = alt ? ws : hrs;
  const slo = alt ? 0 : Math.min(80, ...hrs), shi = alt ? Math.max(100, ...ws) * 1.05 : Math.max(profile.maxHr, ...hrs);
  const sy = (v: number) => HH - ((v - slo) / Math.max(1, shi - slo)) * (HH - 4) - 2;
  // The main line, smoothed over 5 s so it reads at a glance (breathing over 30 s, as the big number is).
  const val = (s: Sample) => (byBreath ? s.ve : byHr ? s.hr : s.w);
  const span = byBreath ? 29 : 4;
  const line = samples.map((s, i) => {
    const from = Math.max(0, i - span);
    let sum = 0, n = 0; for (let k = from; k <= i; k++) { const v = val(samples[k]); if (v != null && v > 0) { sum += v; n++; } }
    return n ? `${x(s.p ?? i).toFixed(1)},${y(sum / n).toFixed(1)}` : '';
  }).filter(Boolean).join(' ');
  const strip = alt
    ? (hasPower ? samples.map((s, i) => `${x(s.p ?? i).toFixed(1)},${sy(s.w ?? 0).toFixed(1)}`).join(' ') : '')
    : samples.filter((s) => s.hr).map((s, i) => `${x(s.p ?? i).toFixed(1)},${sy(s.hr!).toFixed(1)}`).join(' ');
  const tick = total <= 12 * 60 ? 120 : total <= 35 * 60 ? 300 : total <= 90 * 60 ? 600 : total <= 150 * 60 ? 900 : total <= 240 * 60 ? 1800 : 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += tick) ticks.push(t);
  const nowX = position != null ? x(position) : undefined;
  const ladder = ridePowerZones(profile);
  const threshold = byBreath ? (profile.vt2Ve ?? 0) : byHr ? profile.lthr : profile.ftp;
  return (
    <div class="rd-chart">
      <div class="rd-chart-pw">
        <svg class="rd-chart-p" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={byBreath ? "Breathing over the workout's breathing targets" : byHr ? "Heart rate over the workout's zones" : "Power over the workout's targets"}>
          {timeline.map((s, i) => {
            const done = position != null && s.start < position;
            const op = done || !live ? 0.42 : 0.2;
            if (byBreath) {
              const b = bBands[i];
              if (!b) return null;
              const y1 = y(b.high), y0 = b.low ? y(b.low) : H;
              return <rect key={s.index} x={x(s.start)} y={y1} width={Math.max(0.5, x(s.end) - x(s.start) - 0.6)} height={Math.max(1, y0 - y1)} fill={breathZoneVar(b.zone)} opacity={op} />;
            }
            if (byHr) {
              const b = bands[i];
              const y1 = y(b.high), y0 = b.low ? y(b.low) : H;
              return <rect key={s.index} x={x(s.start)} y={y1} width={Math.max(0.5, x(s.end) - x(s.start) - 0.6)} height={Math.max(1, y0 - y1)} fill={ZONE_VAR[hrZoneOf(s, profile) - 1]} opacity={op} />;
            }
            const t = y(((s.low + s.high) / 2) * profile.ftp);
            return <rect key={s.index} x={x(s.start)} y={t} width={Math.max(0.5, x(s.end) - x(s.start) - 0.6)} height={H - t} fill={ZONE_VAR[powerZone((s.low + s.high) / 2, ladder) - 1]} opacity={op} />;
          })}
          {threshold > 0 && <line x1="0" x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--ink-3)" stroke-dasharray="4 5" vector-effect="non-scaling-stroke" />}
          {line && <polyline points={line} fill="none" stroke={byBreath ? 'var(--aqua)' : byHr ? 'var(--z6)' : 'var(--ink)'} stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke" />}
          {nowX != null && live && <line x1={nowX} x2={nowX} y1="0" y2={H} stroke="var(--today)" stroke-width="2" vector-effect="non-scaling-stroke" />}
        </svg>
        {threshold > 0 && <span class="rd-ftp" style={`top:calc(${(y(threshold) / H) * 100}% - 15px)`}>{byBreath ? `Second threshold ${Math.round(threshold)} L/min` : byHr ? `Threshold ${profile.lthr} bpm` : `FTP ${profile.ftp} W`}</span>}
      </div>
      {(!alt || hasPower) && (
        <svg class="rd-chart-h" viewBox={`0 0 ${W} ${HH}`} preserveAspectRatio="none" role="img" aria-label={alt ? 'Power' : 'Heart rate'}>
          <rect x="0" y="0" width={W} height={HH} fill="var(--bg)" />
          {strip && stripVals.length > 0 && <polyline points={strip} fill="none" stroke={alt ? 'var(--ink-2)' : 'var(--z6)'} stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke" />}
          {nowX != null && live && <line x1={nowX} x2={nowX} y1="0" y2={HH} stroke="var(--today)" stroke-width="2" vector-effect="non-scaling-stroke" />}
        </svg>
      )}
      <div class="rd-chart-x" aria-hidden="true">
        {ticks.filter((t) => !(nowX != null && live && Math.abs(x(t) - nowX) < W * 0.045)).map((t) => <span key={t} style={t === 0 ? 'left:0' : `left:${(t / total) * 100}%;transform:translateX(-50%)`}>{clock(t)}</span>)}
        {nowX != null && live && <span class="now" style={`left:${(nowX / W) * 100}%;transform:translateX(-50%)`}>Now</span>}
      </div>
    </div>
  );
}

// ── Ride complete (spec screen 4) ───────────────────────────────────────────

export function RideDone({ rec, workout, planned, timeline, profile, recovered }: { rec: Recording; workout?: Workout; planned?: PlannedWorkout; timeline: TimelineStep[]; profile: Profile; recovered?: boolean }) {
  const byHr = rec.basis === 'hr';
  const t: Totals = totals(rec.samples, rec.ftp, rec.lthr, undefined, rec.basis);
  const testKind = workout?.test;
  // An open-ended ramp has no planned length or load to measure against.
  const plannedStats = workout && testKind !== 'ramp' ? workoutStats(workout.blocks) : undefined;
  // A test's results, worked out from the recording; what the rider chose is kept with them on the recording.
  const [test, setTest] = useState<TestResult | undefined>(() => {
    if (!testKind) return undefined;
    // Read against the settings the test was ridden with; the highest heart rate seen and the riding's FTP follow below.
    const found = testKind === 'ramp' ? rampResult(rec, timeline, profile.weightKg, { ftp: rec.ftp, lthr: rec.lthr, maxHr: profile.maxHr }) : twentyMinResult(rec, timeline);
    const was = rec.test;
    return { ...found, ftpBefore: was?.ftpBefore ?? profile.ftp, ftpAction: was?.ftpAction, lthrBefore: was?.lthrBefore ?? (found.lthrEstimate != null ? profile.lthr : undefined), lthrAction: was?.lthrAction, zonesAction: was?.zonesAction };
  });
  useEffect(() => {
    if (test) void patchRecording(rec.id, { test });
    // Part A: the ramp read again with the highest heart rate seen in the rider's rides and the FTP recent riding shows, before the rider acts on it.
    if (testKind !== 'ramp') return;
    void rampContextFor({ ftp: rec.ftp, lthr: rec.lthr, maxHr: profile.maxHr }, rec.activityId).then((ctx) => {
      if (ctx.learnedMaxHr == null && ctx.cpFtp == null) return;
      setTest((cur) => {
        if (!cur || cur.ftpAction || cur.lthrAction || cur.zonesAction) return cur;
        const next = withActions(rampResult(rec, timeline, profile.weightKg, ctx), cur);
        void patchRecording(rec.id, { test: next });
        return next;
      });
    });
  }, []);
  const changeTest = async (r: TestResult) => {
    setTest(r);
    await patchRecording(rec.id, { test: r });
    // Already saved: the kept copy (which syncs to the other devices) follows the choice.
    const now = await getRecording(rec.id);
    for (const id of [now?.activityId, now?.localId]) if (id) await setSetting(testResultKey(id), r);
  };
  // The ride is drawn and judged with the numbers it was ridden at, even after a test result changes the settings.
  const asRidden: Profile = { ...profile, ftp: rec.ftp, lthr: rec.lthr };
  // Step 5 (11 Nov 2026): a ride by breathing is judged against its breathing targets, with the zones it was ridden with.
  const byBreath = !!rec.byBreath && !!breathZones(asRidden);
  const by: 'power' | 'hr' | 'breath' = byBreath ? 'breath' : rec.basis;
  const bandOf = (s: TimelineStep) => (byBreath ? breathBand(s, asRidden) : undefined) ?? targetBand(s, rec.basis, asRidden);
  const stats = stepStats(rec.samples, timeline, bandOf, by);
  const work = stats.filter((s) => isEffort(s.step, by) && s.seconds > 0);
  const doneSteps = stats.filter((s) => s.seconds >= s.step.seconds * 0.9).length;
  const note = byBreath ? observationHr(stats, 'breathing') : byHr ? observationHr(stats) : observation(stats);
  const zoneTime = byBreath && timeline.length ? timeInZone(rec.samples, timeline, (s) => breathBand(s, asRidden), (x) => x.ve) : byHr && timeline.length ? timeInZone(rec.samples, timeline, bandOf) : undefined;
  const [rpe, setRpe] = useState<number | undefined>(rec.rpe);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'waiting'>(rec.activityId || rec.localId || rec.supersededBy ? 'saved' : 'idle');
  const [said, setSaid] = useState<string>(rec.supersededBy ? KEPT_GARMIN : '');
  const [garmins, setGarmins] = useState(!!rec.supersededBy);
  const want = plannedSeconds(workout);
  const short = !!workout && (rideSeconds(rec) < TRIVIAL_SECONDS || (!!want && rideSeconds(rec) < want * 0.2));
  const hasPower = t.avgPower != null;
  const when = new Date(rec.startMs);
  const [phone] = useState(phoneScreen);
  const pad = usePadUpright();
  const brief = phone || pad;
  const { pager, page, goTo, onScroll } = usePages(2);

  const pick = async (n: number) => {
    const v = rpe === n ? undefined : n;
    setRpe(v);
    await setRideEffort(v);
    await patchRecording(rec.id, { rpe: v });
  };
  const save = async () => {
    setState('saving');
    const r = await uploadRide(rec.id);
    // The ride is in the record now: every screen reads it again (23 Nov 2026: no pull from a data service does that for it).
    notify();
    setSaid(r.text);
    setGarmins(!!r.superseded);
    setState(r.ok ? 'saved' : 'waiting');
    if (!r.superseded) toast({ ok: r.ok, text: r.text });
  };
  // The Garmin's recording was kept; the rider would rather have Antogo's.
  const ours = async () => {
    setState('saving');
    const r = await keepVeloiqInstead(rec.id);
    notify();
    setSaid(r.text);
    setGarmins(false);
    setState(r.ok ? 'saved' : 'waiting');
    toast({ ok: r.ok, text: r.text });
  };
  const done = () => { clearRide(); go('today'); };
  const rideChart = (
        <section class="rd-card rd-chartcard">
          <div class="rd-chart-head"><span class="caption">The ride</span>{byBreath ? <>
            <span class="rd-key"><i class="ln br" />{brief ? 'Your breathing' : 'Your breathing, 30-second average'}</span>{timeline.length > 0 && <span class="rd-key"><i class="bx" />{brief ? 'Target' : 'Breathing target'}</span>}{hasPower && <span class="rd-key"><i class="ln" />Power</span>}
          </> : byHr ? <>
            <span class="rd-key"><i class="ln hr" />Your heart rate</span>{timeline.length > 0 && <span class="rd-key"><i class="bx" />Target zone</span>}{hasPower && <span class="rd-key"><i class="ln" />Power</span>}
          </> : <>
            <span class="rd-key"><i class="ln" />Your power</span>{timeline.length > 0 && <span class="rd-key"><i class="bx" />{brief ? 'Target' : 'Target, coloured by zone'}</span>}<span class="rd-key"><i class="ln hr" />Heart rate</span>
          </>}</div>
          <RideChart timeline={timeline} samples={rec.samples} profile={asRidden} by={by} />
        </section>
  );
  const discard = async () => {
    if (!confirm('Discard this ride?\n\nIt won\'t be saved anywhere.')) return;
    await deleteRecording(rec.id);
    clearRide();
    go('today');
  };

  // The ride's six numbers (five where one has nothing to show), by what the ride was ridden by.
  const load: Cell = { label: 'Training load', value: t.tss, unit: 'TSS', note: plannedStats ? `${plannedStats.tss} planned` : undefined };
  const length: Cell = { label: 'Duration', value: clock(t.seconds) };
  const avgHr: Cell = { label: 'Average heart rate', value: t.avgHr ?? '—', unit: 'bpm' };
  const topHr: Cell = { label: 'Highest heart rate', value: t.maxHr ?? '—', unit: 'bpm' };
  const avgPw: Cell = { label: 'Average power', value: t.avgPower ?? '—', unit: 'W' };
  const far: Cell = { label: 'Distance', value: distText(t.distanceM, profile) };
  const inZone = (label: string): Cell | undefined => zoneTime ? { label, value: clock(zoneTime.seconds), unit: zoneTime.share != null ? `· ${pct(zoneTime.share)}` : undefined } : undefined;
  const ves = rec.samples.map((x) => x.ve).filter((x): x is number => x != null && x > 0);
  const figs: Cell[] = (byBreath ? [length, load, { label: 'Average ventilation', value: ves.length ? Math.round(ves.reduce((x, y) => x + y, 0) / ves.length) : '—', unit: 'L/min' }, inZone('Time in breathing zone'), avgPw, avgHr]
    : byHr ? [length, load, avgHr, inZone('Time in target zone') ?? topHr, hasPower ? avgPw : undefined, far]
    : hasPower ? [length, load, { label: 'Normalized power', value: t.np ?? '—', unit: 'W' }, avgPw, avgHr, { label: 'Work done', value: t.kj ?? '—', unit: 'kJ' }]
    : [length, load, far, topHr, avgHr, { label: 'Average cadence', value: t.avgCadence ?? '—', unit: 'rpm' }]).filter((c): c is Cell => !!c);
  const figCard = (
    <div class="rd-card rd-figs" style={`--n:${figs.length}`}>
      {figs.map((c) => <div key={c.label}><span class="caption">{c.label}</span>{c.unit ? <span><b class="num">{c.value}</b><small> {c.unit}</small>{c.note && <small class="rd-fig-note"><i> · </i>{c.note}</small>}</span> : <b class="num">{c.value}</b>}</div>)}
    </div>
  );
  const verdict = <>
    {short ? <span class="pill">Too short to count as this workout: saved as a ride on its own</span>
      : planned && planned.date === rec.date ? <span class="rd-state on">Today's planned session</span> : workout ? <span class="pill">Goes on {rec.date === today() ? "today's" : 'its day\'s'} calendar as done</span> : null}
    {timeline.length > 0 && testKind !== 'ramp' && <span class="pill">{doneSteps === timeline.length ? `All ${timeline.length} steps done` : `${doneSteps} of ${timeline.length} steps done`}</span>}
  </>;
  const whenWords = `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  // The efforts' columns: on a phone, three after the step's name, in fewer words.
  const heads = byBreath ? (brief ? ['Effort', 'Ventilation', 'In zone', 'Heart rate'] : ['Step', 'Average ventilation', 'Time in breathing zone', 'Average power', 'Average heart rate'])
    : byHr ? (brief ? ['Effort', 'Heart rate', 'In zone', 'Highest'] : ['Step', 'Average heart rate', 'Time in zone', 'Highest heart rate', ...(hasPower ? ['Average power'] : [])])
    : brief ? ['Effort', 'Power', 'On target', 'Heart rate'] : ['Step', 'Average power', 'Time on target', 'Average heart rate', 'Highest heart rate'];
  const good = (s: StepStats) => `num ${s.onTarget != null && s.onTarget >= 0.8 ? 'good' : ''}`;
  const share = (s: StepStats) => (s.onTarget != null ? pct(s.onTarget) : '—');
  const w = (v?: number) => (v != null ? `${v} W` : '—');
  const hr = (v?: number) => (v != null ? `${v} bpm` : '—');
  const named = (s: StepStats, colour: string) => <td><i style={`background:${colour}`} />{s.step.name}{s.step.setNote ? <span class="faint"> · {s.step.setNote}</span> : null}</td>;
  const efforts = work.length > 0 ? (
    <>
      <h2 class="pl-h2">{work.length === 1 ? 'The effort' : `The ${work.length === 2 ? 'two' : work.length === 3 ? 'three' : work.length} efforts`}</h2>
      <table class="rd-table">
        <thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{work.map((s) => (
          <tr key={s.step.index}>
            {byBreath ? <>
              {named(s, breathZoneVar(breathBand(s.step, asRidden)?.zone ?? 1))}
              <td class="num">{s.avgVe != null ? `${Math.round(s.avgVe)} L/min` : '—'}</td>
              <td class={good(s)}>{share(s)}</td>
              {!brief && <td class="num">{w(s.avgPower)}</td>}
              <td class="num">{hr(s.avgHr)}</td>
            </> : byHr ? <>
              {named(s, ZONE_VAR[hrZoneOf(s.step, profile) - 1])}
              <td class="num">{hr(s.avgHr)}</td>
              <td class={good(s)}>{share(s)}</td>
              <td class="num">{hr(s.maxHr)}</td>
              {hasPower && !brief && <td class="num">{w(s.avgPower)}</td>}
            </> : <>
              {named(s, ZONE_VAR[s.step.zone - 1])}
              <td class="num">{w(s.avgPower)}</td>
              <td class={good(s)}>{share(s)}</td>
              <td class="num">{hr(s.avgHr)}</td>
              {!brief && <td class="num">{hr(s.maxHr)}</td>}
            </>}
          </tr>
        ))}</tbody>
      </table>
    </>
  ) : <><h2 class="pl-h2">The ride</h2><p class="muted">{timeline.length ? 'No hard efforts in this workout to compare.' : 'A free ride: no workout to compare against.'}</p></>;
  const finding = note ? <div class="rd-note"><span class="pl-kind">↗</span><p>{note}</p></div> : null;
  const cueLines = rec.cues?.lines.length ? rec.cues.lines.filter((l) => l.t <= rec.timerSeconds + 1) : [];
  const cueTitle = `What the cues said${rec.cues?.by === 'ai' ? ', written for you by your AI' : ''}`;
  const chips = (
    <div class="rd-effort" role="group" aria-label="Effort from 1 to 10">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <button key={n} class={`chip${rpe === n ? ' on' : ''}`} aria-pressed={rpe === n} onClick={() => void pick(n)}>{n}</button>)}
    </div>
  );
  const savedBox = (
    <div class="rd-saved"><span class="rd-state on">{garmins ? "Your device's kept" : 'Saved'}</span><span class="small">{said || 'Your ride is saved.'}</span>
      {garmins && <button class="btn quiet sm" onClick={() => void ours()}>Save Antogo's instead</button>}</div>
  );
  const saveWord = state === 'saving' ? 'Saving…' : state === 'waiting' ? 'Try saving again' : 'Save ride';

  // Save, Download and Discard: the same three, in the same place, on both of a phone's pages (26 Nov 2026).
  const actions = <>
    {state === 'saved' ? savedBox : <button class="btn primary rd-savebtn" disabled={state === 'saving'} onClick={() => void save()}>{saveWord}</button>}
    <div class="rc-others">
      <button class="btn" onClick={() => downloadRide(rec)}>Download the file</button>
      {state !== 'saved' && <button class="btn danger" onClick={() => void discard()}>Discard ride…</button>}
      {state === 'waiting' && <button class="btn quiet" onClick={done}>Done for now</button>}
      {state === 'saved' && <button class="btn primary" onClick={done}>Done</button>}
    </div>
    {state === 'waiting' && <p class="faint small rc-kept">The ride is kept on {thisDevice()} and tried again each time the app opens.</p>}
  </>;

  const headBlock = (
    <div class="rc-head">
      <p class="eyebrow"><span>{testKind ? 'Test complete' : 'Ride complete'}{recovered ? ', recovered' : ''}</span> · <span>{whenWords}</span></p>
      <h1>{rec.name}</h1>
      <div class="rc-pills">{verdict}</div>
    </div>
  );
  const feelCard = (
    <div class="rd-card rc-feel">
      <div class="rc-feel-head"><h2 class="pl-h2">How hard did that feel?</h2><span class="faint small">Optional</span></div>
      {chips}
      <div class="rd-effort-words faint small"><span>Very easy</span><span>All out</span></div>
    </div>
  );

  // An upright iPad (26 Nov 2026): one screen, no pages. The ride drawn at its one proportion; the efforts beside
  // what the cues said; how it felt beside Save, Download and Discard.
  if (pad) {
    return (
      <div class="player rp rc rcpad">
        <div class="rcpad-body">
          {headBlock}
          {figCard}
          {rideChart}
          <div class={`rcpad-two rcpad-detail${test || !cueLines.length ? ' one' : ''}`}>
            {test ? <div class="rd-card rc-eff"><TestResults result={test} profile={profile} onChange={changeTest} /></div> : <>
              <div class="rd-card rc-eff">{efforts}{finding}</div>
              {cueLines.length > 0 && <div class="rd-card rc-cues">
                <h2 class="pl-h2">{cueTitle}</h2>
                <ol>{cueLines.map((l, i) => <li key={i}><span class="num faint">{mmss(l.t)}</span><span>{l.text}</span></li>)}</ol>
              </div>}
            </>}
          </div>
          <div class="rcpad-two">
            {feelCard}
            <div class="rc-act">{actions}</div>
          </div>
        </div>
      </div>
    );
  }

  // A phone (26 Nov 2026): two pages of one screen each, Summary and Details, swiped like the ride's own.
  if (phone) {
    const names = ['Summary', test ? 'Result' : 'Details'];
    return (
      <div class="player rp rc">
        <div class="rp-pages" ref={pager} onScroll={onScroll}>
          <section class="rp-page rc-sum" aria-label={names[0]}>
            <div class="rc-top">
              {headBlock}
              {figCard}
            </div>
            {rideChart}
            <div class="rc-act">
              {feelCard}
              {actions}
            </div>
          </section>
          <section class={`rp-page rc-det${test || !cueLines.length ? ' one' : ''}`} aria-label={names[1]}>
            <div class="rc-bar">
              <div class="rp-title">
                <div class="rp-name">{rec.name}</div>
                <div class="rp-sub">{testKind ? 'Test complete' : 'Ride complete'} · {clock(t.seconds)} · {state === 'saved' ? 'saved' : 'not saved yet'}</div>
              </div>
            </div>
            {test ? <div class="rd-card rc-eff"><TestResults result={test} profile={profile} onChange={changeTest} /></div> : <>
              <div class="rd-card rc-eff">{efforts}{finding}</div>
              {cueLines.length > 0 && <div class="rd-card rc-cues">
                <h2 class="pl-h2">{cueTitle}</h2>
                <ol>{cueLines.map((l, i) => <li key={i}><span class="num faint">{mmss(l.t)}</span><span>{l.text}</span></li>)}</ol>
              </div>}
            </>}
            <div class="rc-act">{actions}</div>
          </section>
        </div>
        <nav class="rp-dots" aria-label="Pages">
          {names.map((n, i) => <button key={n} class={page === i ? 'on' : ''} aria-current={page === i ? 'page' : undefined} onClick={() => goTo(i)}><i />{n}</button>)}
        </nav>
      </div>
    );
  }

  return (
    <div class="player">
      <header class="pl-head">
        <Mark size={20} />
        <span class="rd-name">{testKind ? 'Test complete' : 'Ride complete'}</span>
        <span style="flex:1" />
        {state === 'saved' && <button class="btn primary" onClick={done}>Done</button>}
      </header>
      <main class="pl-main rd-done">
        <section class="rd-done-head">
          <div class="rd-done-title">
            <p class="eyebrow">{recovered ? 'Recovered ride · ' : ''}{whenWords}</p>
            <h1>{rec.name}</h1>
            <div class="row" style="gap:8px;flex-wrap:wrap">{verdict}</div>
          </div>
          {figCard}
        </section>

        {!test && rideChart}
        <section class="rd-done-grid">
          {test ? <div class="rd-card"><TestResults result={test} profile={profile} onChange={changeTest} /></div> : <div class="rd-card">
            {efforts}
            {finding}
            {cueLines.length > 0 && (
              <details class="rd-cues">
                <summary class="small">{cueTitle}</summary>
                <ol class="small">{cueLines.map((l, i) => <li key={i}><span class="num faint">{mmss(l.t)}</span> {l.text}</li>)}</ol>
              </details>
            )}
          </div>}

          <div class="rd-card rd-save">
            <div>
              <h2 class="pl-h2">How hard did that feel?</h2>
              <p class="faint small" style="margin:2px 0 10px">Optional. The coach uses it alongside your numbers.</p>
              {chips}
              <div class="rd-effort-words faint small"><span>Very easy</span><span>All out</span></div>
            </div>
            <div class="rd-grow" />
            {state === 'saved' ? savedBox : <button class="btn primary rd-savebtn" disabled={state === 'saving'} onClick={() => void save()}>{saveWord}</button>}
            <div class="row" style="gap:10px;flex-wrap:wrap">
              <button class="btn" style="flex:1 1 auto" onClick={() => downloadRide(rec)}>Download the ride file</button>
              {state !== 'saved' && <button class="btn danger" style="flex:1 1 auto" onClick={() => void discard()}>Discard ride…</button>}
              {state === 'waiting' && <button class="btn quiet" onClick={done}>Done for now</button>}
            </div>
            <p class="faint small" style="text-align:center;margin:0">{state === 'waiting' ? `The ride is kept on ${thisDevice()} and tried again each time the app opens.` : `A copy stays on ${thisDevice()} until the upload succeeds.`}</p>
          </div>
        </section>
        {test && rideChart}
      </main>
    </div>
  );
}
