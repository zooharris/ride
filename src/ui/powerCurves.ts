import { db, type PowerCurve } from '../data/db';
import { CURVE_SECONDS, meanMaxPower } from '../engine/progress';
import { hrAtPower, steadyAtHr } from '../engine/hrPower';
import { judgeSession } from '../engine/sessionVerdict';
import { addDays, today } from '../engine/load';
import type { Basis, Profile, Ride, Workout } from '../engine/types';
import { fetchIntervals, fetchPowerStream } from '../sync/intervals';
import type { RideLap } from '../engine/analysis';
import { breathingOf } from '../engine/breathFreeze';
import { breathAtPower, learnNormal, todayOffset, veAtPower, type BreathNormal } from '../engine/breathOffset';
import { breathFromRecording, hasBreathing, noteBreathingDate } from '../player/breathRead';
import { patchRecording } from '../player/rides';
import { upsertEdit } from '../sync/records';
import { getSetting, setSetting, STREAMS_VERSION } from '../data/db';
import { credentials } from '../sync/syncService';
import { bestMean } from '../engine/rampJudge';

/**
 * Builds the per-ride cache: for every ride with power, its mean-maximal curve and (Step 2b, 30 Oct 2026)
 * heart rate alongside power: time and heart rate in each power band, power at a steady heart rate, and,
 * for a planned hard session, how it went. Read from the full recording if this device has it, else a
 * time, watts and heart-rate download. Rides without a record come first, newest first; records from before
 * heart rate was kept (no `v: 2`) are re-read once after them, the last 16 weeks first. One ride at a time.
 * `onProgress` reports done/total; a second call while one runs joins it.
 */
export const CURVE_VERSION = 2;
/** How planned sessions were judged: 2 finds each step by the recording's laps (31 Oct); records judged before that are judged again once. */
export const JUDGE_VERSION = 2;
/** 1 (31 Oct): breathing read alongside power, for the strap's normal (2A). Records of the last 12 weeks without it are read again once. */
/** 2 (7 Nov 2026, Step 2c): breathing in finer bands with breathing rate, breath size and heart rate. */
export const BREATH_VERSION = 2;
/** 1 (4 Nov, Part A5): the ride's highest 30-second heart rate kept, for the max heart rate learned from rides. Records of the last 12 months without it are read again once. */
export const HR_VERSION = 1;
/** The rider's normal breathing at each effort, learned from their rides (2A). */
export const BREATH_NORMAL_KEY = 'breathNormal';

export interface CurveContext {
  profile: Profile;
  /** The planned session a recording was matched to, if any. */
  sessionOf: (rideId: string) => { workout: Workout; basis: Basis } | undefined;
  /** The rider's normal breathing as learned so far, for each ride's offset (2A). */
  breathNormal?: BreathNormal;
}

export interface CurveProgress { done: number; total: number; error?: string; rebuilding?: boolean }
let running: Promise<void> | null = null;
const listeners = new Set<(p: CurveProgress) => void>();
let last: CurveProgress | null = null;

export function buildPowerCurves(rides: Ride[], onProgress: (p: CurveProgress) => void, ctx?: CurveContext): () => void {
  listeners.add(onProgress);
  if (!running) running = run(rides, ctx).finally(() => { running = null; });
  else if (last) onProgress(last);
  return () => listeners.delete(onProgress);
}

/** Follow a build already under way (Settings > History), without starting one. */
export function watchPowerCurves(onProgress: (p: CurveProgress) => void): () => void {
  listeners.add(onProgress);
  if (running && last) onProgress(last);
  return () => listeners.delete(onProgress);
}

async function run(rides: Ride[], ctx0?: CurveContext): Promise<void> {
  let ctx = ctx0;
  const emit = (p: CurveProgress) => { last = p; listeners.forEach((l) => l(p)); };
  const have = new Map((await db.powerCurves.toArray()).map((c) => [c.id, c]));
  const recent = addDays(today(), -16 * 7);
  const withPower = rides.filter((r) => r.sport === 'ride' && (r.normalizedPower || r.averagePower));
  const missing = withPower.filter((r) => !have.has(r.id)).sort((a, b) => b.date.localeCompare(a.date));
  // Re-read once: records from before heart rate was kept, records whose ride has since been matched to a planned session,
  // and sessions judged before the steps were found by laps.
  // And (2A) rides of the last 12 weeks read before breathing was kept.
  const breathFrom = addDays(today(), -84);
  const hrFrom = addDays(today(), -365);
  const stale = ctx0 ? withPower.filter((r) => { const c = have.get(r.id); return !!c && (c.v !== CURVE_VERSION || (!c.judged && !!ctx0.sessionOf(r.id)) || (!!c.judged && c.jv !== JUDGE_VERSION) || (r.date >= breathFrom && c.bv !== BREATH_VERSION) || (r.date >= hrFrom && c.hv !== HR_VERSION)); })
    .sort((a, b) => Number(b.date >= recent) - Number(a.date >= recent) || b.date.localeCompare(a.date)) : [];
  const todo = [...missing, ...stale];
  const rebuilding = stale.length > 0;
  if (!todo.length) { emit({ done: 0, total: 0 }); return; }
  const c = await credentials();
  let done = 0;
  emit({ done, total: todo.length, rebuilding });
  if (ctx) ctx = { ...ctx, breathNormal: await getSetting<BreathNormal | undefined>(BREATH_NORMAL_KEY, undefined) };
  const recordings = await db.recordings.toArray();
  let breathSeen = false;
  for (const r of todo) {
    try {
      const full = await db.streams.get(r.id);
      // The cached recording is used when it is current or already has breathing; otherwise power, heart rate and breathing are read.
      const fresh = !!full?.watts && (full.v === STREAMS_VERSION || hasBreathing(full));
      let s: StreamsIn | null = fresh ? { time: full!.time, watts: full!.watts, heartrate: full!.heartrate, ve: full!.ve, br: full!.br, tv: full!.tv }
        : c ? await fetchPowerStream(c, r.id) : full?.watts ? { time: full.time, watts: full.watts, heartrate: full.heartrate } : null;
      if (!s) { emit({ done, total: todo.length, rebuilding, error: 'Connect Intervals.icu to read your rides.' }); return; }
      // A player ride's breathing comes from its recording on this computer when Intervals.icu has none of it.
      const local = recordings.find((x) => x.activityId === r.id);
      if (local?.breathing && !hasBreathing(s)) { const b = breathFromRecording(local, s.time); if (b) s = { ...s, ...b }; }
      // A planned session is judged by its laps: from the full recording when this device has it, else one small read.
      const laps: RideLap[] | undefined = ctx?.sessionOf(r.id) ? (full?.intervals ?? (c ? await fetchIntervals(c, r.id) : undefined)) : undefined;
      const rec = curveRecord(r, s, ctx, laps);
      await db.powerCurves.put(rec);
      if (rec.veAtPower) {
        breathSeen = true;
        await noteBreathingDate(r.date);
        // Today's offset is kept with the ride: on the player's recording here, or on a Garmin ride's edit (synced).
        if (rec.breathOffset != null) {
          if (local) { if (local.breathOffset !== rec.breathOffset) await patchRecording(local.id, { breathOffset: rec.breathOffset }); }
          else {
            const e = await db.activityEdits.get(r.id);
            if (e?.source !== 'veloiq' && e?.breathOffset !== rec.breathOffset) await upsertEdit(r.id, r.date, { breathOffset: rec.breathOffset });
          }
        }
      }
    } catch (e) {
      emit({ done, total: todo.length, rebuilding, error: (e as Error).message });
      return;
    }
    done++;
    emit({ done, total: todo.length, rebuilding });
  }
  if (breathSeen && ctx) await relearnBreathNormal(ctx.profile.ftp);
}

/** The rider's normal breathing, learned again from every ride's record (2A). */
export async function relearnBreathNormal(ftp: number): Promise<BreathNormal | undefined> {
  const normal = learnNormal(await db.powerCurves.toArray(), ftp, today());
  if (normal) await setSetting(BREATH_NORMAL_KEY, normal);
  return normal;
}

type StreamsIn = { time: number[]; watts?: number[]; heartrate?: number[]; ve?: number[]; br?: number[]; tv?: number[] };

/** One ride's record. Pure apart from the context's lookups. */
export function curveRecord(r: Pick<Ride, 'id' | 'date'>, s: StreamsIn, ctx?: CurveContext, laps?: RideLap[]): PowerCurve {
  const w = s.watts?.length ? meanMaxPower(s.time, s.watts, CURVE_SECONDS) : CURVE_SECONDS.map(() => 0);
  const h = s.heartrate?.length ? bestMean(s.time, s.heartrate, -Infinity, Infinity, 30) : undefined;
  const hr: Pick<PowerCurve, 'hr30' | 'hv'> = { ...(h != null ? { hr30: Math.round(h) } : {}), hv: HR_VERSION };
  if (!ctx) return { id: r.id, date: r.date, w, ...hr };
  const p = ctx.profile;
  const bands = hrAtPower(s.time, s.watts, s.heartrate, p.ftp);
  const steady = steadyAtHr(s.time, s.watts, s.heartrate, p.lthr);
  const session = ctx.sessionOf(r.id);
  const verdict = session ? judgeSession(session.workout, p, session.basis, s.time, s.watts, s.heartrate, laps) : undefined;
  // Breathing alongside power (2A), with any frozen stretch cut off first.
  const b = s.ve ? breathingOf(s) : undefined;
  const ve = b ? veAtPower(s.time, s.watts, b.ve, p.ftp) : [];
  const fine = b ? breathAtPower(s.time, s.watts, b.ve, b.br, b.tv, s.heartrate, p.ftp) : [];
  const offset = ve.length ? todayOffset(s.time, s.watts, b!.ve, ctx.breathNormal, p.ftp) : undefined;
  return {
    id: r.id, date: r.date, w, v: CURVE_VERSION, ftpAtBuild: p.ftp, lthrAtBuild: p.lthr,
    ...(bands.length ? { hrAtPower: bands } : {}), ...(steady ? { steadyAtHr: steady } : {}),
    ...(verdict ? { verdict } : {}), ...(session ? { judged: true, jv: JUDGE_VERSION } : {}),
    bv: BREATH_VERSION, ...(ve.length ? { veAtPower: ve } : {}), ...(fine.length ? { breathAtPower: fine } : {}), ...(offset != null ? { breathOffset: offset } : {}), ...hr,
  };
}

/** What the cache needs from the app's data: the profile, and each recording's planned session. */
export function curveContext(profile: Profile | null | undefined, planned: Array<{ activityId?: string; workoutId: string; basis: Basis }>, find: (id: string) => Workout | undefined): CurveContext | undefined {
  if (!profile) return undefined;
  const byActivity = new Map(planned.filter((p) => p.activityId).map((p) => [p.activityId!, p]));
  return { profile, sessionOf: (id) => { const p = byActivity.get(id); const w = p ? find(p.workoutId) : undefined; return p && w && w.kind === 'ride' ? { workout: w, basis: p.basis } : undefined; } };
}
