/**
 * Part A5 (4 Nov 2026): the highest heart rate seen in the rider's activities
 * of the last 12 months, as a 30-second mean (a single beat's spike from a
 * strap is not a heart rate anyone held). Read from each ride's record in the
 * power-curve cache and from the ride player's recordings on this computer.
 * The figure Antogo uses is never below the max-heart-rate setting.
 */
import { useEffect, useState } from 'preact/hooks';
import { db } from '../data/db';
import { addDays, today } from '../engine/load';
import { bestMean } from '../engine/rampJudge';

export interface MaxHrSeen { bpm: number; date: string }

export async function maxHrSeen(): Promise<MaxHrSeen | undefined> {
  const from = addDays(today(), -365);
  let top: MaxHrSeen | undefined;
  const take = (bpm: number | undefined, date: string) => { if (bpm && bpm > 0 && (!top || bpm > top.bpm)) top = { bpm: Math.round(bpm), date }; };
  for (const c of await db.powerCurves.where('date').aboveOrEqual(from).toArray()) take(c.hr30, c.date);
  for (const r of await db.recordings.toArray()) {
    if (r.date < from || r.status === 'discarded') continue;
    take(bestMean(r.samples.map((x) => x.t), r.samples.map((x) => x.hr), -Infinity, Infinity, 30), r.date);
  }
  return top;
}

/** The highest heart rate Antogo reads against: the setting, or the highest seen when that is higher. */
export const maxHrInUse = (setting: number, seen?: MaxHrSeen): number => Math.max(setting || 0, seen?.bpm ?? 0);

export function useMaxHrSeen(): MaxHrSeen | undefined | null {
  const [v, setV] = useState<MaxHrSeen | undefined | null>(null);
  useEffect(() => { let alive = true; void maxHrSeen().then((x) => { if (alive) setV(x); }); return () => { alive = false; }; }, []);
  return v;
}

/**
 * Part A3: the FTP recent riding shows, only when the critical-power fit through the rider's best 2 to 30
 * minutes of the last eight weeks passes its own check (never the single-effort floor), with enough rides.
 */
export async function ridingFitFtp(exceptId?: string): Promise<number | undefined> {
  const { fitCp, FIT_SECONDS } = await import('../engine/cpFit');
  const { CURVE_SECONDS } = await import('../engine/progress');
  const { EVIDENCE_WEEKS, THIN_RIDES } = await import('../engine/thresholdEvidence');
  const from = addDays(today(), -EVIDENCE_WEEKS * 7);
  // The test's own ride is not a witness to itself.
  const curves = (await db.powerCurves.where('date').aboveOrEqual(from).toArray()).filter((c) => c.id !== exceptId);
  if (curves.length < THIN_RIDES) return undefined;
  const efforts = FIT_SECONDS.map((seconds) => { const i = CURVE_SECONDS.indexOf(seconds); return { seconds, watts: Math.max(0, ...curves.map((c) => c.w[i] ?? 0)) }; });
  const fit = fitCp(efforts);
  return fit?.ok ? fit.ftp : undefined;
}

/** Everything a ramp is read against (Part A): the settings, the highest heart rate seen, and the riding's trustworthy FTP. */
export async function rampContextFor(p: { ftp: number; lthr: number; maxHr: number }, testActivityId?: string): Promise<import('../player/tests').RampContext> {
  const [seen, cpFtp] = await Promise.all([maxHrSeen(), ridingFitFtp(testActivityId)]);
  return { ftp: p.ftp, lthr: p.lthr, maxHr: p.maxHr, learnedMaxHr: seen?.bpm, cpFtp };
}
