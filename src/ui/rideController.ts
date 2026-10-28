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
import { getSensors, commandTrainer, resetTrainerSession } from '../player/hub';
import { pickSources } from '../player/sources';
import { RideEngine, type TrainerMode } from '../player/engine';
import { buildTimeline, targetBand, type TimelineStep } from '../player/timeline';
import { putRecording, patchRecording } from '../player/rides';
import type { Recording } from '../player/types';
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
}

export interface ActiveRide {
  setup: RideSetup;
  engine: RideEngine;
  timeline: TimelineStep[];
  rec: Recording;
  /** Power averaged over the chosen seconds, for the big number. */
  shownWatts?: number;
  live: { watts?: number; cadence?: number; speedKmh?: number; bpm?: number };
}

let active: ActiveRide | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let audio: AudioContext | undefined;
let wake: { release(): Promise<void> } | undefined;
const recent: number[] = [];

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
  const rec: Recording = {
    id: newId(), status: 'recording', startedAt: localIso(now), startMs: now, date: today(),
    plannedId: setup.planned?.id, workoutId: setup.workout?.id, name: setup.workout?.name ?? 'Free ride',
    basis: setup.basis, ftp: setup.profile.ftp, lthr: setup.profile.lthr,
    samples: [], laps: [], events: [], timerSeconds: 0, distanceM: 0, savedMs: now,
  };
  active = { setup, engine, timeline, rec, live: {} };
  recent.length = 0;
  resetTrainerSession();
  if (setup.sound) { try { audio ??= new AudioContext(); void audio.resume(); } catch { audio = undefined; } }
  void holdScreenOn();
  addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', onVisible);
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
  const src = pickSources(getSensors(), Date.now());
  a.live = { watts: src.watts?.value, cadence: src.cadence?.value, speedKmh: src.speedKmh?.value, bpm: src.bpm?.value };
  if (a.live.watts != null) { recent.push(a.live.watts); while (recent.length > a.setup.smoothing) recent.shift(); }
  a.shownWatts = recent.length ? Math.round(recent.reduce((x, y) => x + y, 0) / recent.length) : undefined;
  const out = a.engine.tick(now, a.live);
  if (out.command) commandTrainer(out.command);
  if (out.beep && a.setup.sound) beep(out.beep);
  if (out.note) toast({ ok: true, text: out.note });
  const last = a.engine.events[a.engine.events.length - 1];
  if (last?.type === 'eased' && last.t === a.engine.wall(now)) toast({ ok: true, text: 'Cadence dropped: the trainer has eased off. Spin back up over 70 rpm and it builds back to the target.' });
  if (a.engine.timer % 5 === 0) save();
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
export function resumeRide() { if (active) { active.engine.resume(Date.now()); push(); } }
export function skipStep() { if (active) { active.engine.skip(Date.now()); push(); } }
export function lapNow() { if (active) { active.engine.lap(Date.now()); toast({ ok: true, text: 'Lap.' }); emit(); } }
export function setRideScale(scale: number) { if (active) { active.engine.setScale(Date.now(), scale); push(); } }
export function setRideMode(mode: TrainerMode) { if (active) { active.engine.setMode(Date.now(), mode); push(); } }
export function setRideLevel(level: number) { if (active) { active.engine.setLevel(level); push(); } }

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
  const cmd = a.engine.finish(Date.now());
  if (cmd) commandTrainer(cmd);
  clearInterval(timer);
  timer = undefined;
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
