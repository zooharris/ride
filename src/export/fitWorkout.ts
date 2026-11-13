/**
 * A workout as Garmin's workout file (FIT, file type 5): the one common format that carries heart-rate targets as
 * well as power (12 Nov 2026, export at any time). Rides by power or heart rate, runs and walks by heart rate on the
 * rider's foot table. Power is written as a share of FTP, as Antogo sends it, so the device applies its own FTP;
 * heart rate in beats per minute from the rider's tables, because a Garmin reads a heart-rate share as a share of
 * maximum heart rate, which is not what Antogo's tables mean.
 */
import type { Profile, RunStep, Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { NO_FLOOR } from '../engine/workout';
import { footLthr, powerToHrFraction, rideLadders } from '../engine/zones';
import { EASY_WALK, bandBpm, hasNoFloor, recoveryBand, stepBand, walkBand, type FootBand } from '../engine/foot';
import { ENUM, FILE_ID, FitWriter, MANUFACTURER_DEVELOPMENT, STRING, UINT16, UINT32, fitTime, type MesgDef } from './fitWriter';
import { isOpenEffort, stepNoteText } from './workoutText';

const WORKOUT: MesgDef = { global: 26, local: 1, fields: [{ num: 4, type: ENUM }, { num: 6, type: UINT16 }, { num: 8, type: STRING(48) }, { num: 17, type: STRING(200) }] };
const STEP: MesgDef = { global: 27, local: 2, fields: [
  { num: 254, type: UINT16 }, { num: 0, type: STRING(64) }, { num: 1, type: ENUM }, { num: 2, type: UINT32 }, { num: 3, type: ENUM },
  { num: 4, type: UINT32 }, { num: 5, type: UINT32 }, { num: 6, type: UINT32 }, { num: 7, type: ENUM }, { num: 8, type: STRING(200) },
  { num: 19, type: ENUM }, { num: 20, type: UINT32 }, { num: 21, type: UINT32 }, { num: 22, type: UINT32 }] };

const SPORT = { cycling: 2, running: 1, walking: 11 } as const;
const DUR_TIME = 0, DUR_REPEAT = 6;
const TGT_HR = 1, TGT_OPEN = 2, TGT_CADENCE = 3, TGT_POWER = 4;
const INT_ACTIVE = 0, INT_WARMUP = 2, INT_COOLDOWN = 3, INT_RECOVERY = 4;
/** Garmin's custom target encoding: power above 1000 is watts + 1000 (below, % of FTP); heart rate above 100 is bpm + 100 (below, % of max). */
const BPM = (b: number) => Math.round(b) + 100;

interface StepOut { name?: string; seconds: number; target: 'power' | 'hr' | 'open'; low?: number; high?: number; cadence?: number; intensity: number; notes?: string }
type Item = StepOut | { repeat: number; steps: StepOut[] };

function intensityOf(step: { label?: string; low?: number }, frac: number, index: number, last: number): number {
  const l = step.label ?? '';
  if (/warm/i.test(l) || (index === 0 && frac < 0.6)) return INT_WARMUP;
  if (/cool/i.test(l) || (index === last && frac < 0.6)) return INT_COOLDOWN;
  return frac < 0.6 ? INT_RECOVERY : INT_ACTIVE;
}

/** A ride's step as a Garmin step, by power (share of FTP) or heart rate (beats, through the rider's tables). */
function rideStep(w: Workout, s: WorkoutStep, targets: 'power' | 'hr', profile: Profile, index: number, last: number): StepOut {
  const base = { name: s.label, seconds: s.seconds, cadence: s.cadence, intensity: intensityOf(s, s.intensity, index, last), notes: stepNoteText(s) };
  if (isOpenEffort(w, s)) return { ...base, target: 'open' };
  const hi = s.intensityHigh ?? s.intensity;
  if (targets === 'power') {
    const lo = s.noFloor ? NO_FLOOR.power : s.intensity;
    return { ...base, target: 'power', low: Math.round(lo * 100), high: Math.round(hi * 100) };
  }
  const l = rideLadders(profile);
  const bpm = (f: number) => powerToHrFraction(f, l.hr, l.power) * profile.lthr;
  const lo = s.noFloor ? NO_FLOOR.hr * profile.lthr : bpm(s.intensity);
  return { ...base, target: 'hr', low: BPM(lo), high: BPM(bpm(hi)) };
}

function rideItems(w: Workout, targets: 'power' | 'hr', profile: Profile): Item[] {
  const total = w.blocks.reduce((n, b) => n + (b.kind === 'step' ? 1 : b.steps.length), 0);
  let i = 0;
  return w.blocks.map((b: WorkoutBlock): Item => {
    if (b.kind === 'step') return rideStep(w, b, targets, profile, i++, total - 1);
    const steps = b.steps.map((s) => rideStep(w, s, targets, profile, i++, total - 1));
    // A set's first step carries the set's name when it has none of its own.
    if (b.label && !steps[0].name) steps[0] = { ...steps[0], name: b.label };
    return { repeat: b.times, steps };
  });
}

function footStep(b: FootBand, seconds: number, profile: Profile, name?: string): StepOut {
  const bpm = bandBpm(b, profile);
  const intensity = b.zoneHigh <= 2.5 ? INT_RECOVERY : INT_ACTIVE;
  if (!bpm) return { name, seconds, target: 'open', intensity };
  const low = hasNoFloor(b) ? NO_FLOOR.hr * footLthr(profile) : bpm.low;
  return { name, seconds, target: 'hr', low: BPM(low), high: BPM(bpm.high), intensity };
}

function runItems(w: Workout, profile: Profile): Item[] {
  return (w.run?.steps ?? []).map((s: RunStep): Item => {
    const work = footStep(stepBand(s, profile), s.seconds, profile, s.label);
    const n = Math.max(1, s.repeat ?? 1);
    if (n === 1) return work;
    const steps = [work];
    if (s.recoverSeconds) steps.push({ ...footStep(recoveryBand(s, profile), s.recoverSeconds, profile, 'Recover'), intensity: INT_RECOVERY });
    return { repeat: n, steps };
  });
}

function walkItems(w: Workout, profile: Profile): Item[] {
  const spec = w.walk ?? { minutes: w.minutes ?? 30, ...EASY_WALK };
  return [footStep(walkBand(spec, profile), spec.minutes * 60, profile, w.name)];
}

/** Whether a session can be written as a Garmin workout file. */
export function fitWorkoutKind(w: Workout): boolean {
  return (w.kind === 'ride' && w.blocks.length > 0) || (w.kind === 'run' && !!w.run?.steps.length) || w.kind === 'walk';
}

/**
 * The workout file. `w` is the ride as it should go (already the chosen version, already shaped for breathing when
 * sent by breathing); `targets` is power or heart rate for a ride (runs and walks are always heart rate).
 */
export function encodeFitWorkout(w: Workout, targets: 'power' | 'hr', profile: Profile, now = Date.now()): Uint8Array {
  const items = w.kind === 'run' ? runItems(w, profile) : w.kind === 'walk' ? walkItems(w, profile) : rideItems(w, targets, profile);
  const sport = w.kind === 'run' ? SPORT.running : w.kind === 'walk' ? SPORT.walking : SPORT.cycling;
  const f = new FitWriter();
  f.write(FILE_ID, { 0: 5, 1: MANUFACTURER_DEVELOPMENT, 2: 0, 4: fitTime(now), 8: 'Antogo' });
  const count = items.reduce((n, it) => n + ('repeat' in it ? it.steps.length + 1 : 1), 0);
  const title = w.subtitle ? `${w.name} · ${w.subtitle}` : w.name;
  f.write(WORKOUT, { 4: sport, 6: count, 8: title, 17: w.purpose });
  let idx = 0;
  const one = (s: StepOut) => {
    const tgt = s.target === 'power' ? TGT_POWER : s.target === 'hr' ? TGT_HR : TGT_OPEN;
    f.write(STEP, {
      254: idx++, 0: s.name, 1: DUR_TIME, 2: s.seconds * 1000, 3: tgt, 4: 0,
      5: s.target === 'open' ? undefined : s.low, 6: s.target === 'open' ? undefined : s.high, 7: s.intensity, 8: s.notes,
      19: s.cadence ? TGT_CADENCE : undefined, 20: s.cadence ? 0 : undefined, 21: s.cadence, 22: s.cadence,
    });
  };
  for (const it of items) {
    if (!('repeat' in it)) { one(it); continue; }
    const first = idx;
    it.steps.forEach(one);
    f.write(STEP, { 254: idx++, 1: DUR_REPEAT, 2: first, 4: it.repeat });
  }
  return f.finish();
}
