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
import { getSensors, getSlots, commandTrainer, resetTrainerSession, onTrainerControl } from '../player/hub';
import { pickSources } from '../player/sources';
import { RideEngine, type TrainerMode } from '../player/engine';
import { buildTimeline, hrZoneOf, targetBand, type TimelineStep } from '../player/timeline';
import { hrAnswer, hrLearn, hrLearns, hrResumed, hrStatus, hrStepStart, hrTick, startWatts, type HrCtl, type HrPowerTable, type HrStep } from '../player/hrControl';
import { getSetting, setSetting } from '../data/db';
import { putRecording, patchRecording } from '../player/rides';
import { bandOf, ewma, settle, type Settled } from '../player/smooth';
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
  live: { watts?: number; cadence?: number; speedKmh?: number; bpm?: number };
}

let active: ActiveRide | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let audio: AudioContext | undefined;
let wake: { release(): Promise<void> } | undefined;
const recent: number[] = [];
const recentHr: number[] = [];
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
  const timeline = setup.workout ? buildTimeline(setup.workout, setup.profile) : [];
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
  active = { setup, engine, timeline, rec, live: {}, band: { count: 0 }, cueState: {}, hrTable: {} };
  if (setup.basis === 'hr') void getSetting<HrPowerTable>(HR_TABLE, {}).then((t) => { if (active?.rec.id === rec.id) active.hrTable = t ?? {}; });
  recent.length = 0;
  recentHr.length = 0;
  resetTrainerSession();
  if (setup.sound) { try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = undefined; } }
  void holdScreenOn();
  addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', onVisible);
  offControl?.();
  offControl = onTrainerControl(trainerBack);
  lastTick = now;
  timer = setInterval(loop, 250);
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
  a.live = { watts: src.watts?.value, cadence: src.cadence?.value, speedKmh: src.speedKmh?.value, bpm: src.bpm?.value };
  if (a.live.watts != null) { recent.push(a.live.watts); while (recent.length > a.setup.smoothing) recent.shift(); }
  a.shownWatts = recent.length ? Math.round(recent.reduce((x, y) => x + y, 0) / recent.length) : undefined;
  if (a.live.bpm != null) { recentHr.push(a.live.bpm); while (recentHr.length > Math.max(30, a.setup.smoothing)) recentHr.shift(); }
  const lastHr = (n: number) => { const xs = recentHr.slice(-n); return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : undefined; };
  a.shownBpm = lastHr(a.setup.smoothing);
  const byHr = a.setup.basis === 'hr';
  const step = a.engine.step;
  // A new step starts its label and cue afresh, so a target change is not met with a stale verdict.
  if (step && step.index !== a.bandStep) { a.band = { count: 0 }; a.bandStep = step.index; a.cueState = { lastTone: a.cueState.lastTone }; a.cue = undefined; }
  if (!byHr && a.live.watts != null && a.engine.phase === 'riding') {
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
  if (out.command) commandTrainer(out.command);
  if (out.beep && a.setup.sound) beep(out.beep);
  if (out.note) toast({ ok: true, text: out.note });
  const last = a.engine.events[a.engine.events.length - 1];
  if (last?.type === 'eased' && last.t === a.engine.wall(now)) toast({ ok: true, text: 'Cadence dropped: the trainer has eased off. Spin back up over 70 rpm and it builds back to the target.' });
  if (a.engine.timer % 5 === 0) save();
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
  return { ...a.rec, samples: e.samples, laps: [...e.laps], events: e.events, timerSeconds: e.timer, distanceM: Math.round(e.distanceM) };
}

function save() { if (active) void putRecording(snapshot(active)); }

// ── The rider's controls ───────────────────────────────────────────────────

export function pauseRide() { if (active) { active.engine.pause(Date.now()); push(); } }
export function resumeRide() { if (active) { active.engine.resume(Date.now()); if (active.hr) active.hr = { ...active.hr, st: hrResumed(active.hr.st) }; push(); } }
export function skipStep() { if (active) { active.engine.skip(Date.now()); push(); } }
export function lapNow() { if (active) { active.engine.lap(Date.now()); toast({ ok: true, text: 'Lap.' }); emit(); } }
export function setRideScale(scale: number) { if (active) { active.engine.setScale(Date.now(), scale); push(); } }
export function setRideMode(mode: TrainerMode) {
  if (!active) return;
  // The rider's own choice wins over the switch made when heart rate went missing; coming back to adjusting starts the step's loop afresh.
  active.hrLost = false;
  if (mode === 'erg' && active.setup.basis === 'hr') active.hr = undefined;
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
  const cmd = a.engine.finish(Date.now());
  if (cmd) commandTrainer(cmd);
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
