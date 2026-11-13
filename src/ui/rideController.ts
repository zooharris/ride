/**
 * The ride being ridden now, in this browser tab. It owns the engine, the
 * recording and the clock: once a second it reads the sensors, asks the
 * engine what happens, sends the trainer its command, beeps, and saves the
 * recording every five seconds so a closed browser loses almost nothing.
 * Screens subscribe and redraw.
 */
import type { Basis, PlannedWorkout, Profile, Workout } from '../engine/types';
import { newId } from '../engine/workout';
import { today } from '../engine/load';
import { getSensors, getSlots, commandTrainer, resetTrainerSession, onTrainerControl, strapRideStart, strapRideEnd, strapRideDetails, strapStalledNow, wakeStrap, WAKE_WORDS } from '../player/hub';
import { pickSources } from '../player/sources';
import { cleanName } from '../player/devices';
import { RideEngine, type TrainerMode } from '../player/engine';
import { breathBand, buildTimeline, hrZoneOf, rampRef, targetBand, type TimelineStep } from '../player/timeline';
import { BREATH_OFFSET_FALLBACK_S, BREATH_TABLE, breathAnswer, breathLearn, breathLearns, breathResumed, breathStartWatts, breathStatus, breathStepStart, breathTick, type BreathCtl, type BreathPowerTable, type BreathStep } from '../player/breathControl';
import { todayOffset, type BreathNormal } from '../engine/breathOffset';
import { BREATH_NORMAL_KEY } from './powerCurves';
import { hrAnswer, hrLearn, hrLearns, hrResumed, hrStatus, hrStepStart, hrTick, startWatts, type HrCtl, type HrPowerTable, type HrStep } from '../player/hrControl';
import { db, getSetting, setSetting } from '../data/db';
import { putRecording, patchRecording } from '../player/rides';
import { bandOf, breathShown, ewma, settle, type Settled } from '../player/smooth';
import type { Recording } from '../player/types';
import { hrCue, type Cue, type CueState } from '../player/hrCue';
import { toast } from './Toast';

export interface RideSetup {
  workout?: Workout;
  planned?: PlannedWorkout;
  basis: Basis;
  profile: Profile;
  mode: TrainerMode;
  scale: number;
  level: number;
  sound: boolean;
  autoPause: boolean;
  guard: boolean;
  /** Seconds of power averaged for the big number. */
  smoothing: number;
  /** A free ride in ERG: the watts to start at. */
  freeWatts?: number;
  /** The Ramp Test: watts added each minute. */
  rampStep?: number;
  /** Step 5 (11 Nov 2026): ridden by breathing. `basis` is then 'power' (the trainer's watts are what is recorded and scored). */
  byBreath?: boolean;
  /** Who wrote the ride's cues (12 Nov 2026, B6): the ride itself, or the rider's AI before it started. */
  cuesBy?: 'ai' | 'written';
}

export interface ActiveRide {
  setup: RideSetup;
  engine: RideEngine;
  timeline: TimelineStep[];
  rec: Recording;
  /** Power averaged over the chosen seconds, for the big number. */
  shownWatts?: number;
  /** A smoother power for the marker on the target bar, and the label beside it, settled so neither jumps about. */
  markerWatts?: number;
  band: Settled;
  bandStep?: number;
  /** Heart rate averaged over the chosen seconds, for the big number on a ride by heart rate. */
  shownBpm?: number;
  /** Breathing strap: ventilation over the last 30 seconds, breaths a minute and breath size over the last 10. */
  shownBreath?: { ve?: number; br?: number; tv?: number };
  /** A smoother heart rate for the marker on the zone bar. */
  markerBpm?: number;
  /** On a ride by heart rate with your gears: the cue on screen, if any. */
  cue?: Cue;
  cueState: CueState;
  /** Riding by heart rate with the trainer adjusting: the loop for the step being ridden, and its line for the screen. */
  hr?: { step: number; st: HrCtl; inS: number; status: string };
  /** The watts that kept heart rate in each zone on earlier rides (synced). */
  hrTable: HrPowerTable;
  /** Heart rate missing since (ms); after a minute the trainer stops adjusting until it returns. */
  hrMissingSince?: number;
  hrLost?: boolean;
  /** The breathing strap in use on this ride (its device id). */
  breathStrapId?: string;
  /** Part A4 / strap brief (4 Nov 2026): the recovery ladder is running; it failed (the rider has been told); when to try again. */
  breathWaking?: boolean;
  breathQuiet?: boolean;
  breathRetryAt?: number;
  /** A `lost` event is open (written when the stall was seen, closed by `found`). */
  breathLost?: boolean;
  live: { watts?: number; cadence?: number; speedKmh?: number; bpm?: number; ve?: number; br?: number; tv?: number; ie?: number };
  /** Riding by breathing with the trainer adjusting (Step 5): the loop for the step being ridden, and its line for the screen. */
  breath?: { step: number; st: BreathCtl; inS: number; status: string };
  /** The watts that kept breathing in each breathing zone on earlier rides (synced). */
  breathTable: BreathPowerTable;
  /** The rider's normal breathing at each effort (for today's strap offset), and today's offset once known. */
  breathNormal?: BreathNormal;
  breathOffsetToday?: number;
  /** Ventilation over 30 seconds, corrected for today's offset: what the targets are judged against. */
  veNow?: number;
  /** A smoother ventilation for the marker on the breathing bar. */
  markerVe?: number;
  /** Breathing has stopped arriving on a ride by breathing: the trainer is holding its watts and the rider is offered a way on. */
  breathStopped?: boolean;
  breathMissingSince?: number;
}

let active: ActiveRide | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let audio: AudioContext | undefined;
let wake: { release(): Promise<void> } | undefined;
const recent: number[] = [];
const recentHr: number[] = [];
const recentBreath: Array<{ ve: number; br?: number; tv?: number }> = [];
let offControl: (() => void) | undefined;
export const HR_TABLE = 'hrPowerTable';

/** The trainer came back after a dropout: start its session again and give it the current target at once. */
export function trainerBack(): void {
  const a = active;
  if (!a || (a.engine.phase !== 'riding' && a.engine.phase !== 'paused')) return;
  resetTrainerSession();
  push();
}

export function currentRide(): ActiveRide | undefined { return active; }
export function subscribeRide(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = () => listeners.forEach((l) => l());

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Start a ride. Call from the Start button's click (the browser allows sound only after one). */
export function startRide(setup: RideSetup): void {
  if (active && active.engine.phase !== 'finished') return;
  const now = Date.now();
  // The Ramp Test with no FTP yet is built in watts against a reference FTP, so the trainer still gets its watts.
  if (setup.workout?.test === 'ramp' && !(setup.profile.ftp > 0)) setup = { ...setup, profile: { ...setup.profile, ftp: rampRef(setup.profile.ftp) } };
  const timeline = setup.workout ? buildTimeline(setup.workout, setup.profile, { rampStep: setup.rampStep }) : [];
  const targetOf = setup.basis === 'hr'
    ? (s: TimelineStep, scale: number) => targetBand(s, 'hr', setup.profile, scale).mid
    : undefined;
  const engine = new RideEngine({ timeline, ftp: setup.profile.ftp, basis: setup.basis, mode: setup.mode, autoPause: setup.autoPause, guard: setup.guard, targetOf }, now);
  engine.scale = setup.scale;
  engine.setLevel(setup.level);
  if (setup.freeWatts) engine.freeWatts = setup.freeWatts;
  const rec: Recording = {
    id: newId(), status: 'recording', startedAt: localIso(now), startMs: now, date: today(),
    plannedId: setup.planned?.id, workoutId: setup.workout?.id, name: setup.workout?.name ?? 'Free ride',
    basis: setup.basis, ftp: setup.profile.ftp, lthr: setup.profile.lthr, rampStep: setup.rampStep,
    samples: [], laps: [], events: [], timerSeconds: 0, distanceM: 0, savedMs: now,
  };
  if (setup.byBreath) rec.byBreath = true;
  // The cues as they will be shown, kept with the recording so its summary can show what was said.
  const cueLines = timeline.flatMap((st) => (st.step.cues ?? []).filter((c) => (c.rep === 'last' ? st.rep === st.reps : c.rep == null || c.rep === st.rep)).map((c) => ({ t: st.start + (c.at >= 0 ? c.at : st.seconds + c.at), text: c.text })));
  if (cueLines.length) rec.cues = { by: setup.cuesBy ?? 'written', lines: cueLines.sort((a, b) => a.t - b.t) };
  active = { setup, engine, timeline, rec, live: {}, band: { count: 0 }, cueState: {}, hrTable: {}, breathTable: {} };
  if (setup.byBreath) void Promise.all([getSetting<BreathPowerTable>(BREATH_TABLE, {}), getSetting<BreathNormal | undefined>(BREATH_NORMAL_KEY, undefined)]).then(([t, n]) => { if (active?.rec.id === rec.id) { active.breathTable = t ?? {}; active.breathNormal = n; } });
  if (setup.basis === 'hr') void getSetting<HrPowerTable>(HR_TABLE, {}).then((t) => { if (active?.rec.id === rec.id) active.hrTable = t ?? {}; });
  recent.length = 0;
  recentHr.length = 0;
  recentBreath.length = 0;
  resetTrainerSession();
  if (setup.sound) { try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = undefined; } }
  void holdScreenOn();
  addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', onVisible);
  offControl?.();
  offControl = onTrainerControl(trainerBack);
  lastTick = now;
  timer = setInterval(loop, 250);
  // The strap brief: a session is started on the breathing strap, as the Tymewear app does.
  void strapRideStart();
  void putRecording(rec);
  emit();
}

function onLeave(e: BeforeUnloadEvent) {
  if (active && active.engine.phase !== 'finished') { e.preventDefault(); e.returnValue = ''; }
}

function onVisible() {
  if (document.visibilityState === 'visible' && active && active.engine.phase !== 'finished') void holdScreenOn();
  if (document.visibilityState === 'visible' && active && active.engine.phase !== 'finished' && hiddenSince && Date.now() - hiddenSince > 5000) {
    toast({ ok: false, text: 'Keep this tab in front while riding: the browser slows a tab in the background.' });
  }
  hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0;
}
let hiddenSince = 0;

async function holdScreenOn() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    wake = await nav.wakeLock?.request('screen');
  } catch { /* not offered: the screen may dim */ }
}

/** Every quarter second: run one engine second for each whole second gone by (catching up after a slow moment, at most five). */
function loop() {
  if (!active) return;
  const now = Date.now();
  let due = Math.floor((now - lastTick) / 1000);
  if (due <= 0) return;
  if (due > 5) { lastTick = now - 5000; due = 5; }
  for (let i = 0; i < due; i++) { lastTick += 1000; second(lastTick); }
  emit();
}

function second(now: number) {
  const a = active!;
  const src = pickSources(getSensors(), Date.now(), getSlots());
  a.live = { watts: src.watts?.value, cadence: src.cadence?.value, speedKmh: src.speedKmh?.value, bpm: src.bpm?.value, ve: src.ve?.value, br: src.br?.value, tv: src.tv?.value, ie: src.ie?.value };
  if (a.live.ve != null) {
    recentBreath.push({ ve: a.live.ve, br: a.live.br, tv: a.live.tv });
    while (recentBreath.length > 30) recentBreath.shift();
    if (!a.rec.breathSensor) { const strap = getSensors().find((x) => x.id === src.ve!.from); if (strap) a.rec = { ...a.rec, breathSensor: cleanName(strap.name) }; }
    a.breathStrapId ??= src.ve!.from;
  } else recentBreath.length = 0;
  a.shownBreath = recentBreath.length ? breathShown(recentBreath) : undefined;
  watchBreath(a, now);
  if (a.live.watts != null) { recent.push(a.live.watts); while (recent.length > a.setup.smoothing) recent.shift(); }
  a.shownWatts = recent.length ? Math.round(recent.reduce((x, y) => x + y, 0) / recent.length) : undefined;
  if (a.live.bpm != null) { recentHr.push(a.live.bpm); while (recentHr.length > Math.max(30, a.setup.smoothing)) recentHr.shift(); }
  const lastHr = (n: number) => { const xs = recentHr.slice(-n); return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : undefined; };
  a.shownBpm = lastHr(a.setup.smoothing);
  const byHr = a.setup.basis === 'hr';
  const byBreath = !!a.setup.byBreath;
  const step = a.engine.step;
  if (byBreath) breathSecond(a, now, step);
  // A new step starts its label and cue afresh, so a target change is not met with a stale verdict.
  if (step && step.index !== a.bandStep) { a.band = { count: 0 }; a.bandStep = step.index; a.cueState = { lastTone: a.cueState.lastTone, hist: a.cueState.hist }; a.cue = undefined; }
  if (!byHr && !byBreath && a.live.watts != null && a.engine.phase === 'riding') {
    a.markerWatts = ewma(a.markerWatts, a.live.watts);
    if (step) {
      const b = targetBand(step, 'power', a.setup.profile, a.engine.scale);
      a.band = settle(a.band, bandOf(a.markerWatts, b.low, b.high));
    }
  }
  if (byHr && a.timeline.length && (a.engine.mode === 'erg' || a.hrLost)) steerByHr(a, now, step, a.live.bpm != null ? lastHr(30) : undefined);
  const adjusting = byHr && a.timeline.length > 0 && a.engine.mode === 'erg';
  if (byHr && a.live.bpm != null && a.engine.phase === 'riding') {
    a.markerBpm = ewma(a.markerBpm, a.live.bpm);
    if (step) {
      const b = targetBand(step, 'hr', a.setup.profile);
      a.band = settle(a.band, bandOf(a.markerBpm, b.low, b.high));
    }
    if (step && !adjusting) {
      const b = targetBand(step, 'hr', a.setup.profile);
      const c = hrCue(a.cueState, lastHr(10), b, step.noFloor, a.engine.wall(now));
      if (c.cue && c.cue !== a.cue) a.engine.mark(now, 'cue', c.cue);
      a.cueState = c.state;
      a.cue = c.cue;
      if (c.tone && a.setup.sound) beep('count');
    }
  }
  if (byHr && (a.engine.phase !== 'riding' || adjusting)) a.cue = undefined;
  const wasPaused = a.engine.phase === 'paused';
  const out = a.engine.tick(now, { ...a.live, canMove: canTellMoving() });
  // Pedalling again after an auto-pause carries on as the Resume button does: free to rise again.
  if (wasPaused && a.engine.phase === 'riding' && a.hr) a.hr = { ...a.hr, st: hrResumed(a.hr.st) };
  if (wasPaused && a.engine.phase === 'riding' && a.breath) a.breath = { ...a.breath, st: breathResumed(a.breath.st) };
  if (out.command) commandTrainer(out.command);
  if (out.beep && a.setup.sound) beep(out.beep);
  if (out.note) toast({ ok: true, text: out.note });
  const last = a.engine.events[a.engine.events.length - 1];
  if (last?.type === 'eased' && last.t === a.engine.wall(now)) toast({ ok: true, text: 'Cadence dropped: the trainer has eased off. Spin back up over 70 rpm and it builds back to the target.' });
  if (a.engine.timer % 5 === 0) save();
}

/**
 * The breath watchdog (strap brief, 4 Nov 2026). Once a strap has sent breathing on this ride, 20 s without a
 * breath, or motion frames with a frozen clock (the 4 Nov stall), writes a `lost` event and starts the recovery
 * ladder (start the session again; stop and start it; re-enable notifications; reconnect), quietly. Breaths
 * back: a `found` event naming the step that worked. Only when the whole ladder fails is the rider told; the
 * ladder is tried again every minute while the strap stays silent. The ride keeps recording throughout.
 */
export const WAKE_RETRY_MS = 60_000;
function watchBreath(a: ActiveRide, now: number) {
  const id = a.breathStrapId;
  if (!id || !a.rec.breathSensor || a.engine.phase !== 'riding') return;
  const strap = getSensors().find((x) => x.id === id);
  // A strap that has dropped its connection is reconnecting by itself and shows as lost on screen already.
  if (!strap || strap.status !== 'connected') return;
  const name = a.rec.breathSensor;
  const stalled = strapStalledNow(id, now);
  if (!stalled) {
    if (a.breathLost && !a.breathWaking) {
      a.breathLost = false;
      a.engine.mark(now, 'found', name);
      if (a.breathQuiet) { a.breathQuiet = false; toast({ ok: true, text: 'Breathing readings are back.' }); }
    }
    return;
  }
  if (a.breathWaking || (a.breathRetryAt != null && now < a.breathRetryAt)) return;
  if (!a.breathLost) { a.breathLost = true; a.engine.mark(now, 'lost', name); }
  a.breathWaking = true;
  const rideId = a.rec.id;
  void wakeStrap(id).then((step) => {
    const r = active;
    if (!r || r.rec.id !== rideId) return;
    r.breathWaking = false;
    if (step) {
      r.breathRetryAt = undefined;
      r.breathLost = false;
      r.engine.mark(Date.now(), 'found', `${name} · ${WAKE_WORDS[step]}`);
      if (r.breathQuiet) { r.breathQuiet = false; toast({ ok: true, text: 'Breathing readings are back.' }); }
    } else {
      r.breathRetryAt = Date.now() + WAKE_RETRY_MS;
      if (!r.breathQuiet) {
        r.breathQuiet = true;
        toast({ ok: false, text: 'The breathing strap has stopped sending breaths and Antogo could not wake it. Take it off for a minute and put it back on. The ride keeps recording.' });
      }
    }
    emit();
  });
}

/** A step as the heart-rate loop sees it. */
function hrStepOf(step: TimelineStep, profile: Profile): HrStep {
  const b = targetBand(step, 'hr', profile);
  return { seconds: step.seconds, noFloor: step.noFloor, zone: hrZoneOf(step, profile), low: b.low, high: b.high };
}

/**
 * Riding by heart rate with the trainer adjusting (brief C2): once a second the
 * loop moves the trainer's watts a little toward the step's zone. Heart rate
 * missing for a minute: the trainer gives a set resistance and the rider rides
 * to the zones with their gears until it returns.
 */
function steerByHr(a: ActiveRide, now: number, step: TimelineStep | undefined, bpm30: number | undefined) {
  const e = a.engine;
  const profile = a.setup.profile;
  if (a.live.bpm == null) {
    a.hrMissingSince ??= now;
    if (!a.hrLost && e.mode === 'erg' && e.phase === 'riding' && now - a.hrMissingSince >= 60_000) {
      a.hrLost = true;
      e.setMode(now, 'resistance');
      toast({ ok: false, text: 'Heart rate lost for a minute: ride to the zones with your gears until it returns.' });
      return;
    }
  } else {
    a.hrMissingSince = undefined;
    if (a.hrLost) {
      a.hrLost = false;
      a.hr = undefined;
      e.setMode(now, 'erg');
      toast({ ok: true, text: 'Heart rate is back: the trainer adjusts to it again.' });
    }
  }
  if (e.mode !== 'erg' || e.phase === 'paused' || e.phase === 'finished' || !step) return;
  const hs = hrStepOf(step, profile);
  const inS = Math.max(0, e.position - step.start);
  if (!a.hr || a.hr.step !== step.index) {
    // The step before's final watts: a step that starts harder or easier is a change heart rate takes time to answer.
    const prev = a.hr?.st.target;
    if (a.hr) learnFrom(a);
    a.hr = { step: step.index, st: hrStepStart(startWatts(a.hrTable, hs.zone, profile), undefined, prev), inS: 0, status: '' };
  }
  const r = hrTick(a.hr.st, hs, inS, bpm30);
  a.hr = { ...a.hr, st: r.state, inS, status: hrStatus(r.state, hs, inS, bpm30) };
  e.hrWatts = r.state.target;
  if (r.easedNow) toast({ ok: false, text: 'Heart rate well above the zone: the trainer has eased off.' });
}

/** A steady step that held its zone teaches the table the watts that did it (the last three minutes' average). */
function learnFrom(a: ActiveRide) {
  const h = a.hr;
  const step = h ? a.timeline[h.step] : undefined;
  if (!h || !step) return;
  const hs = hrStepOf(step, a.setup.profile);
  if (!hrLearns(h.st, hs, h.inS + 1)) return;
  const ws = a.engine.samples.filter((s) => s.s === step.index && s.w != null).slice(-180).map((s) => s.w!);
  if (ws.length < 150) return;
  a.hrTable = hrLearn(a.hrTable, hs.zone, ws.reduce((x, y) => x + y, 0) / ws.length, today());
  void setSetting(HR_TABLE, a.hrTable);
}

// ── Riding by breathing (Step 5, 11 Nov 2026) ─────────────────────────────

/** Breathing missing this long on a ride by breathing: the trainer holds and the rider is offered a way on. */
export const BREATH_STOP_S = 30;

/** A step as the breathing loop sees it. */
function breathStepOf(step: TimelineStep, profile: Profile, scale: number): BreathStep | undefined {
  const b = breathBand(step, profile, scale);
  if (!b) return undefined;
  const hr = targetBand(step, 'hr', profile);
  return { seconds: step.seconds, noFloor: step.noFloor, zone: b.zone, low: step.noFloor ? 0 : b.low, high: b.high, plannedWatts: targetBand(step, 'power', profile, scale).mid, hrHigh: hr.high || undefined };
}

/**
 * Once a second on a ride by breathing: today's strap offset (until known), the corrected ventilation, the
 * zone pill, the cue when the rider steers, the trainer's loop when it adjusts, and whether breathing has stopped.
 */
function breathSecond(a: ActiveRide, now: number, step: TimelineStep | undefined) {
  const e = a.engine;
  const profile = a.setup.profile;
  // Today's offset: worked out every 30 seconds until known; with no earlier rides to compare with, the reading is taken as it is after ten minutes.
  if (a.breathOffsetToday == null && e.timer > 0 && e.timer % 30 === 0) {
    const ss = e.samples;
    const off = todayOffset(ss.map((x) => x.t), ss.map((x) => x.w ?? NaN), ss.map((x) => x.ve ?? NaN), a.breathNormal, profile.ftp);
    if (off != null) a.breathOffsetToday = off;
    else if (e.timer >= BREATH_OFFSET_FALLBACK_S && !a.breathNormal) a.breathOffsetToday = 1;
  }
  const usable = a.live.ve != null && !a.breathQuiet && !a.breathLost;
  const raw = usable ? a.shownBreath?.ve : undefined;
  a.veNow = raw != null ? Math.round((raw / (a.breathOffsetToday ?? 1)) * 10) / 10 : undefined;
  // Breathing has stopped: missing for 30 seconds, or the strap's watchdog says so.
  a.breathMissingSince = a.veNow == null ? (a.breathMissingSince ?? now) : undefined;
  const stopped = e.phase === 'riding' && a.breathMissingSince != null && now - a.breathMissingSince >= BREATH_STOP_S * 1000;
  if (stopped && !a.breathStopped) e.mark(now, 'breath', 'stopped');
  a.breathStopped = stopped;
  if (!step) return;
  const b = breathBand(step, profile, e.scale);
  if (!b) return;
  if (a.veNow != null && e.phase === 'riding') {
    a.markerVe = ewma(a.markerVe, a.veNow);
    a.band = settle(a.band, bandOf(a.markerVe, step.noFloor ? 0 : b.low, b.high));
  }
  const adjusting = a.timeline.length > 0 && e.mode === 'erg';
  if (adjusting) steerByBreath(a, now, step);
  else if (a.veNow != null && e.phase === 'riding') {
    const c = hrCue(a.cueState, a.veNow, { low: step.noFloor ? 0 : b.low, high: b.high }, step.noFloor, e.wall(now));
    if (c.cue && c.cue !== a.cue) e.mark(now, 'cue', c.cue);
    a.cueState = c.state;
    a.cue = c.cue;
    if (c.tone && a.setup.sound) beep('count');
  }
}

function steerByBreath(a: ActiveRide, now: number, step: TimelineStep) {
  const e = a.engine;
  if (e.phase === 'paused' || e.phase === 'finished') return;
  const bs = breathStepOf(step, a.setup.profile, e.scale);
  if (!bs) return;
  const inS = Math.max(0, e.position - step.start);
  if (!a.breath || a.breath.step !== step.index) {
    const prev = a.breath?.st.target;
    if (a.breath) learnBreath(a);
    a.breath = { step: step.index, st: breathStepStart(breathStartWatts(a.breathTable, bs.zone, bs.plannedWatts), undefined, prev), inS: 0, status: '' };
  }
  const offsetKnown = a.breathOffsetToday != null;
  const r = breathTick(a.breath.st, bs, inS, offsetKnown ? a.veNow : undefined, a.live.bpm != null ? a.shownBpm : undefined, a.setup.profile.ftp);
  const status = a.breathStopped ? `Breathing has stopped arriving. The trainer is holding ${r.state.target} W.` : breathStatus(r.state, bs, inS, a.veNow, offsetKnown);
  a.breath = { ...a.breath, st: r.state, inS, status };
  e.hrWatts = r.state.target;
  if (r.easedNow) toast({ ok: false, text: 'Heart rate well above the zone: the trainer has eased off.' });
}

/** A steady step that held its breathing zone teaches the table the watts that did it (the last three minutes' average). */
function learnBreath(a: ActiveRide) {
  const h = a.breath;
  const step = h ? a.timeline[h.step] : undefined;
  const bs = step ? breathStepOf(step, a.setup.profile, a.engine.scale) : undefined;
  if (!h || !step || !bs || !breathLearns(h.st, bs, h.inS + 1)) return;
  const ws = a.engine.samples.filter((s) => s.s === step.index && s.w != null).slice(-180).map((s) => s.w!);
  if (ws.length < 150) return;
  a.breathTable = breathLearn(a.breathTable, bs.zone, ws.reduce((x, y) => x + y, 0) / ws.length, today());
  void setSetting(BREATH_TABLE, a.breathTable);
}

/** The rider's answer to "Your breathing is staying low today". */
export function answerBreath(answer: 'harder' | 'keep') {
  const a = active;
  if (!a?.breath) return;
  a.breath = { ...a.breath, st: breathAnswer(a.breath.st, answer) };
  emit();
}

/** The rider's + and − on a ride by breathing with the trainer adjusting: 5 W, then held for the rest of the step, as the rider chose. */
export function nudgeBreath(dir: 1 | -1) {
  const a = active;
  if (!a?.breath || a.engine.mode !== 'erg') return;
  const target = Math.max(40, Math.min(a.breath.st.maxW, a.breath.st.target + 5 * dir));
  a.breath = { ...a.breath, st: { ...a.breath.st, target, kept: true, asking: false }, status: `Holding ${target} W for the rest of this step, as you chose.` };
  a.engine.hrWatts = target;
  push();
}

/**
 * Breathing has stopped arriving: carry on by heart rate (the trainer then adjusts to heart rate) or by power
 * (the trainer holds each step's watts). The ride stays one recording; it is marked as changed at this point.
 */
export function carryOnWithout(by: 'hr' | 'power') {
  const a = active;
  if (!a) return;
  if (a.breath && a.engine.mode === 'erg') learnBreath(a);
  a.setup = { ...a.setup, byBreath: false, basis: by };
  a.rec = { ...a.rec, byBreath: undefined, basis: by };
  a.breath = undefined;
  a.breathStopped = false;
  a.hr = undefined;
  a.engine.hrWatts = undefined;
  a.band = { count: 0 };
  a.engine.mark(Date.now(), 'breath', by === 'hr' ? 'carried on by heart rate' : 'carried on by power');
  if (by === 'hr') void getSetting<HrPowerTable>(HR_TABLE, {}).then((t) => { if (active === a) a.hrTable = t ?? {}; });
  push();
}

/** The rider's answer to "Your heart rate is staying low today". */
export function answerHr(answer: 'harder' | 'keep') {
  const a = active;
  if (!a?.hr) return;
  const step = a.timeline[a.hr.step];
  const st = hrAnswer(a.hr.st, answer);
  a.hr = { ...a.hr, st, status: step ? hrStatus(st, hrStepOf(step, a.setup.profile), a.hr.inS, recentHr.length ? recentHr[recentHr.length - 1] : undefined) : a.hr.status };
  emit();
}

/** Whether a connected sensor can say the rider is moving: anything but a heart-rate strap. */
function canTellMoving(): boolean {
  return getSensors().some((s) => s.kind !== 'hr' && s.status === 'connected');
}

function beep(kind: 'count' | 'go') {
  if (!audio) return;
  try {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = kind === 'go' ? 1320 : 880;
    g.gain.value = 0.0001;
    o.connect(g).connect(audio.destination);
    const t = audio.currentTime;
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'go' ? 0.35 : 0.12));
    o.start(t);
    o.stop(t + 0.4);
  } catch { /* no sound */ }
}

function snapshot(a: ActiveRide): Recording {
  const e = a.engine;
  const breathing = e.samples.some((x) => x.ve != null) || undefined;
  return { ...a.rec, samples: e.samples, laps: [...e.laps], events: e.events, timerSeconds: e.timer, distanceM: Math.round(e.distanceM), rampEndAt: e.rampEndAt, breathing, breathSensor: breathing ? a.rec.breathSensor : undefined };
}


function save() { if (active) void putRecording(snapshot(active)); }

// ── The rider's controls ───────────────────────────────────────────────────

export function pauseRide() { if (active) { active.engine.pause(Date.now()); push(); } }
export function resumeRide() { if (active) { active.engine.resume(Date.now()); if (active.hr) active.hr = { ...active.hr, st: hrResumed(active.hr.st) }; if (active.breath) active.breath = { ...active.breath, st: breathResumed(active.breath.st) }; push(); } }
/** The Ramp Test's Stop button: the ramp ends now and the cool-down starts. */
export function stopTest() {
  const a = active;
  if (!a || !a.engine.endTest(Date.now(), 'rider')) return;
  toast({ ok: true, text: 'Test over. Cooling down.' });
  save();
  push();
}
export function skipStep() { if (active) { active.engine.skip(Date.now()); push(); } }
export function lapNow() { if (active) { active.engine.lap(Date.now()); toast({ ok: true, text: 'Lap.' }); emit(); } }
export function setRideScale(scale: number) { if (active && !active.setup.workout?.test) { active.engine.setScale(Date.now(), scale); push(); } }
export function setRideMode(mode: TrainerMode) {
  if (!active) return;
  // The rider's own choice wins over the switch made when heart rate went missing; coming back to adjusting starts the step's loop afresh.
  active.hrLost = false;
  if (mode === 'erg' && active.setup.basis === 'hr') active.hr = undefined;
  if (mode === 'erg' && active.setup.byBreath) active.breath = undefined;
  // Leaving "adjusts to breathing" gives the trainer back its planned watts.
  if (mode !== 'erg' && active.setup.byBreath) active.engine.hrWatts = undefined;
  active.engine.setMode(Date.now(), mode);
  push();
}
export function setRideLevel(level: number) { if (active) { active.engine.setLevel(level); push(); } }
export function setRideFreeWatts(watts: number) { if (active) { active.engine.setFreeWatts(Date.now(), watts); push(); } }

/** After a control: the trainer gets its new command at once, not at the next second. */
function push() {
  const a = active;
  if (!a) return;
  const cmd = a.engine.commandNow(Date.now(), a.live.cadence);
  if (cmd) commandTrainer(cmd);
  emit();
}

/** End the ride. The recording is saved as finished; the summary screen takes it from here. */
export async function endRide(): Promise<Recording | undefined> {
  const a = active;
  if (!a) return undefined;
  if (a.hr && a.engine.mode === 'erg') learnFrom(a);
  if (a.breath && a.engine.mode === 'erg') learnBreath(a);
  // Ending the ride while still on the ramp is stopping the test: the result then knows where it ended.
  a.engine.endTest(Date.now(), 'rider');
  const cmd = a.engine.finish(Date.now());
  if (cmd) commandTrainer(cmd);
  // The strap's session is stopped and its stored sessions erased, as the Tymewear app does.
  const strapDone = strapRideEnd();
  clearInterval(timer);
  timer = undefined;
  offControl?.();
  offControl = undefined;
  removeEventListener('beforeunload', onLeave);
  document.removeEventListener('visibilitychange', onVisible);
  try { await wake?.release(); } catch { /* already released */ }
  wake = undefined;
  const rec: Recording = { ...snapshot(a), status: 'finished' };
  a.rec = rec;
  await putRecording(rec);
  // A ride from the calendar is judged by the targets it was ridden to (10 Nov 2026 evening): the player's choice.
  if (rec.plannedId) { try { await db.planned.update(rec.plannedId, { basis: a.setup.basis, rodeByBreath: a.setup.byBreath ? true : undefined }); } catch { /* the session was removed meanwhile */ } }
  // Diagnostics brief, Part A: the strap's details are saved with the ride now (so closing the tab can't lose them),
  // and again once the strap has answered its stop commands.
  const early = strapRideDetails();
  if (early) await patchRecording(rec.id, { strapLog: early });
  void strapDone.catch(() => undefined).then(async () => {
    const strapLog = strapRideDetails();
    if (!strapLog) return;
    if (active?.rec.id === rec.id) active.rec = { ...active.rec, strapLog };
    await patchRecording(rec.id, { strapLog });
  });
  emit();
  return rec;
}

/** The summary is done with (saved or discarded): forget the ride. */
export function clearRide() { active = undefined; emit(); }

export async function setRideEffort(rpe: number | undefined) {
  if (!active) return;
  active.rec = { ...active.rec, rpe };
  await patchRecording(active.rec.id, { rpe });
}
