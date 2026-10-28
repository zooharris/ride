/**
 * The ride, second by second (spec §5, §7). Given the time and the live
 * numbers once a second, it moves through the workout, decides what the
 * trainer should hold, records a sample, opens and closes laps, and pauses by
 * itself when the rider stops pedalling. It never touches Bluetooth or
 * storage, so it is tested with a fake clock; the controller does the rest.
 */
import { ergWatts, stepAt, totalSeconds, type TimelineStep } from './timeline';
import { guardStep, type GuardState } from './erg';
import type { Lap, RideEvent, Sample } from './types';
import type { TrainerCommand } from './hub';

export type Phase = 'countdown' | 'riding' | 'paused' | 'finished';
/** ERG: the trainer holds the watts. Resistance: a road of a set gradient. Free: a flat road. Self: no trainer control at all. */
export type TrainerMode = 'erg' | 'resistance' | 'free' | 'self';

export interface Live {
  watts?: number; cadence?: number; speedKmh?: number; bpm?: number;
  /** Whether any connected sensor can tell that the rider is moving (a trainer, a power meter, a speed or cadence sensor). Without one, the ride never pauses itself. Absent means yes. */
  canMove?: boolean;
}

export interface EngineOptions {
  timeline: TimelineStep[];
  ftp: number;
  basis: 'power' | 'hr';
  mode: TrainerMode;
  autoPause: boolean;
  guard: boolean;
  /** The target in the units recorded beside each sample: watts for power, bpm for heart rate. */
  targetOf?: (s: TimelineStep, scale: number) => number;
}

export interface TickOut {
  /** A trainer command to send now (only when it changes). */
  command?: TrainerCommand;
  /** A beep: the three seconds before a step change, then the change. */
  beep?: 'count' | 'go';
  /** Something to tell the rider once. */
  note?: string;
}

const COUNTDOWN = 3;
const AUTO_PAUSE_S = 10;

export class RideEngine {
  phase: Phase = 'countdown';
  /** Seconds ridden (pauses left out). */
  timer = 0;
  /** Seconds the workout has been moved on by skipping. */
  private shift = 0;
  scale = 1;
  level = 3;
  mode: TrainerMode;
  samples: Sample[] = [];
  laps: Lap[] = [];
  events: RideEvent[] = [];
  distanceM = 0;
  workoutDone: boolean;
  private countdown = COUNTDOWN;
  private openLap?: Lap;
  private stepIndex?: number;
  private still = 0;
  private autoPaused = false;
  private guardState: GuardState = { eased: false };
  private lastCommand?: string;
  private lastWall = 0;

  constructor(private o: EngineOptions, private startMs: number) {
    this.mode = o.mode;
    this.workoutDone = !o.timeline.length;
  }

  /** Seconds since the ride began, pauses included (the recording's clock). */
  wall(now: number): number { return Math.max(0, Math.round((now - this.startMs) / 1000)); }
  /** Where in the workout the ride is. */
  get position(): number { return this.timer + this.shift; }
  get step(): TimelineStep | undefined { return this.workoutDone ? undefined : stepAt(this.o.timeline, this.position); }
  get next(): TimelineStep | undefined { const s = this.step; return s ? this.o.timeline[s.index + 1] : undefined; }
  get total(): number { return totalSeconds(this.o.timeline); }
  get isAutoPaused(): boolean { return this.autoPaused; }
  /** Seconds left of the countdown before the ride starts. */
  get countdownLeft(): number { return this.phase === 'countdown' ? this.countdown : 0; }

  /** The trainer command for right now, sent even if unchanged (after the rider changes something). */
  commandNow(now: number, cadence?: number): TrainerCommand | undefined {
    this.lastCommand = undefined;
    return this.send(now / 1000, cadence);
  }

  /** The watts the trainer is asked to hold in ERG now (before the cadence guard). */
  ergTarget(): number | undefined {
    const s = this.step ?? this.o.timeline[this.o.timeline.length - 1];
    return s ? ergWatts(s, this.o.ftp, this.scale) : undefined;
  }

  private command(): TrainerCommand | undefined {
    if (this.mode === 'self') return undefined;
    if (this.phase === 'paused' || this.phase === 'countdown' || this.phase === 'finished') return { grade: 0 };
    if (this.mode === 'free') return { grade: 0 };
    if (this.mode === 'resistance') return { grade: this.level };
    const t = this.ergTarget();
    return t != null ? { erg: t } : { grade: 0 };
  }

  private send(now: number, cadence?: number): TickOut['command'] {
    let cmd = this.command();
    // No cadence reading at all (a trainer without it), or not pedalling (auto-pause's business): nothing to guard on.
    if (cmd && 'erg' in cmd && this.o.guard && this.phase === 'riding' && cadence != null && cadence > 0) {
      const g = guardStep(this.guardState, cadence, now * 1000);
      this.guardState = g.state;
      if (g.justEased) this.event(this.lastWall, 'eased');
      cmd = { erg: Math.round(cmd.erg * g.factor) };
    }
    const key = cmd ? JSON.stringify(cmd) : '';
    if (!cmd || key === this.lastCommand) return undefined;
    this.lastCommand = key;
    return cmd;
  }

  private event(t: number, type: RideEvent['type'], value?: RideEvent['value']) { this.events.push({ t, type, value }); }

  private closeLap(t: number) {
    if (this.openLap && t > this.openLap.start) { this.openLap.end = t; this.laps.push(this.openLap); }
    this.openLap = undefined;
  }

  /** Once a second. */
  tick(now: number, live: Live): TickOut {
    const t = this.wall(now);
    this.lastWall = t;
    const out: TickOut = {};
    if (this.phase === 'finished') return out;

    if (this.phase === 'countdown') {
      this.countdown -= 1;
      out.beep = this.countdown > 0 ? 'count' : 'go';
      if (this.countdown <= 0) {
        this.phase = 'riding';
        this.event(t, 'start');
        this.stepIndex = this.step?.index;
        // The first sample is the next second's.
        this.openLap = { start: t + 1, end: t + 1, step: this.stepIndex };
      }
      out.command = this.send(now / 1000, live.cadence);
      return out;
    }

    const moving = (live.cadence ?? 0) > 0 || (live.watts ?? 0) >= 10 || (live.speedKmh ?? 0) > 3;
    const watching = this.o.autoPause && live.canMove !== false;
    if (this.phase === 'paused') {
      if (this.autoPaused && moving) { this.resume(now); out.note = 'Pedalling again: the ride carries on.'; }
      else { out.command = this.send(now / 1000, live.cadence); return out; }
    }

    // Auto-pause after ten seconds without pedalling.
    this.still = moving || !watching ? 0 : this.still + 1;
    if (watching && this.still >= AUTO_PAUSE_S) {
      this.pause(now, true);
      out.note = 'Paused: you stopped pedalling. Pedal to carry on.';
      out.command = this.send(now / 1000, live.cadence);
      return out;
    }

    const step = this.step;
    if (step?.index !== this.stepIndex) {
      this.closeLap(t);
      this.stepIndex = step?.index;
      if (step) { this.openLap = { start: t, end: t, step: step.index }; out.beep = 'go'; }
      else if (!this.workoutDone) { this.workoutDone = true; this.event(t, 'done'); out.note = 'Workout complete. Keep riding, or end the ride.'; this.openLap = { start: t, end: t }; }
    }
    if (step && !out.beep) {
      const left = step.end - this.position;
      if (left <= 3 && left >= 1 && this.o.timeline[step.index + 1]) out.beep = 'count';
    }

    this.distanceM += ((live.speedKmh ?? 0) / 3.6);
    const tgt = step ? (this.o.targetOf ? this.o.targetOf(step, this.scale) : ergWatts(step, this.o.ftp, this.scale)) : undefined;
    this.samples.push({
      t,
      w: live.watts != null ? Math.round(live.watts) : undefined,
      hr: live.bpm != null ? Math.round(live.bpm) : undefined,
      cad: live.cadence != null ? Math.round(live.cadence) : undefined,
      spd: live.speedKmh != null ? Math.round(live.speedKmh * 10) / 10 : undefined,
      d: Math.round(this.distanceM),
      tgt,
      s: step?.index,
      p: this.position,
    });
    this.timer += 1;
    out.command = this.send(now / 1000, live.cadence);
    return out;
  }

  pause(now: number, auto = false): void {
    if (this.phase !== 'riding') return;
    this.phase = 'paused';
    this.autoPaused = auto;
    this.still = 0;
    this.event(this.wall(now), 'pause', auto ? 'auto' : 'manual');
  }

  resume(now: number): void {
    if (this.phase !== 'paused') return;
    this.phase = 'riding';
    this.autoPaused = false;
    this.lastCommand = undefined;
    this.event(this.wall(now), 'resume');
  }

  /** Move on to the next step now. */
  skip(now: number): void {
    const s = this.step;
    if (!s || this.phase === 'finished') return;
    this.shift += s.end - this.position;
    this.event(this.wall(now), 'skip', s.index);
  }

  /** A lap of the rider's own, inside the step. */
  lap(now: number): void {
    if (this.phase !== 'riding' || !this.openLap) return;
    const t = this.wall(now);
    const step = this.openLap.step;
    this.closeLap(t);
    this.openLap = { start: t, end: t, step, manual: true };
  }

  setScale(now: number, scale: number): void {
    this.scale = Math.max(0.5, Math.min(1.5, Math.round(scale * 100) / 100));
    this.event(this.wall(now), 'intensity', this.scale);
  }

  setMode(now: number, mode: TrainerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.lastCommand = undefined;
    this.event(this.wall(now), 'mode', mode);
  }

  setLevel(level: number): void { this.level = Math.max(0, Math.min(10, Math.round(level))); }

  /** End the ride: close the last lap. The trainer is let go (a flat road). */
  finish(now: number): TrainerCommand | undefined {
    if (this.phase === 'finished') return undefined;
    const t = this.wall(now);
    if (this.phase === 'riding' || this.phase === 'paused') this.closeLap(this.samples.length ? this.samples[this.samples.length - 1].t + 1 : t);
    this.phase = 'finished';
    this.event(t, 'stop');
    return this.mode === 'self' ? undefined : { grade: 0 };
  }

}
