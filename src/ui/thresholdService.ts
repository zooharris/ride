/**
 * Step 2: loads what the FTP estimate and zone analysis read (power curves,
 * test results, notes, readiness) and builds the evidence. The AI call and the
 * periodic check live here too (Parts B and C).
 */
import { useEffect, useState } from 'preact/hooks';
import { db } from '../data/db';
import { today } from '../engine/load';
import { gatherEvidence, type TestInput, type ThresholdEvidence } from '../engine/thresholdEvidence';
import { testResultKey, type TestResult } from '../player/tests';
import { LIBRARY } from '../library/workouts';
import { fitnessFromRides, fitnessOn, readinessToday } from './derived';
import { findWorkout, type AppData } from './store';

const BAND_WORDS: Record<string, string> = { go: 'Ready', ease: 'Ease off a little', easy: 'Keep it easy', rest: 'Rest' };

/** Every test the rider has a result for, with its date: kept results (synced) first, then recordings on this computer. */
export async function loadTests(data: AppData): Promise<TestInput[]> {
  const prefix = testResultKey('');
  const kept = await db.settings.where('key').startsWith(prefix).toArray();
  const recs = await db.recordings.filter((r) => !!r.test && r.status !== 'discarded').toArray();
  const out: TestInput[] = [];
  const seen = new Set<string>();
  const take = (date: string, r: TestResult) => out.push({ date, kind: r.kind, ftpEstimate: r.ftpEstimate, lthrEstimate: r.lthrEstimate, vo2maxMlKgMin: r.vo2maxMlKgMin, ftpAction: r.ftpAction });
  for (const s of kept) {
    const id = s.key.slice(prefix.length);
    const ride = data.rides.find((x) => x.id === id);
    if (ride) { take(ride.date, s.value as TestResult); seen.add(id); }
  }
  for (const r of recs) if (!r.activityId || !seen.has(r.activityId)) { take(r.date, r.test!); if (r.activityId) seen.add(r.activityId); }
  // A test ridden elsewhere and never opened has no result yet; it still counts as a test for "how long since" (no numbers).
  for (const ride of data.rides) {
    if (seen.has(ride.id)) continue;
    const p = data.planned.find((x) => x.activityId === ride.id);
    const kind = (p ? findWorkout(data.mine, p.workoutId)?.test : undefined) ?? LIBRARY.find((x) => x.test && x.name === ride.name)?.test;
    if (kind) out.push({ date: ride.date, kind });
  }
  return out;
}

export async function loadEvidence(data: AppData): Promise<ThresholdEvidence | undefined> {
  if (!data.profile) return undefined;
  const t = today();
  const [curves, tests] = await Promise.all([db.powerCurves.toArray(), loadTests(data)]);
  const fit = fitnessOn(fitnessFromRides(data.rides), t);
  const band = readinessToday(data.wellness, fit, t, data.rides).band;
  return gatherEvidence({ profile: data.profile, rides: data.rides, curves, tests, notes: data.dayNotes, readinessBand: BAND_WORDS[band], today: t });
}

/** The evidence for the screen, rebuilt when the rides or the profile change. */
export function useEvidence(data: AppData): ThresholdEvidence | undefined {
  const [ev, setEv] = useState<ThresholdEvidence | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadEvidence(data).then((e) => { if (alive) setEv(e); });
    return () => { alive = false; };
  }, [data.rides, data.profile, data.dayNotes]);
  return ev;
}
