import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AppData } from '../store';
import { findWorkout } from '../store';
import { getSetting, setSetting, type PowerCurve } from '../../data/db';
import { addDays, today } from '../../engine/load';
import { fitnessFromRides, loadRatio, readinessSeries, weekStart } from '../derived';
import { Measures } from '../../engine/measures';
import { labExtra, periodDays, type LabPeriod } from '../../engine/lab';
import { dayKind } from '../../engine/mornings';
import type { Fitness, Profile, Ride } from '../../engine/types';
import { miles, pounds } from '../../engine/units';
import { getActivePlan, type ActivePlan } from '../planService';
import { plannedTss } from '../week';
import { hrNumbers, pageFacts, useCurves, useTests, type TestEntry } from '../screens/Progress';
import { useProgressCoach, type ProgressCoachState } from '../ProgressCoach';
import { readQuery, replaceQuery } from '../router';
import type { RangeKey } from '../FitnessChart';

/**
 * Everything Insights and the Lab read (27 Nov 2026), worked out once from what is on this device: the fitness
 * series, every measure, the per-ride cache, the tests, the plan in force, and the period chosen. Built on the
 * same pieces as the Progress page, so no figure is worked out a second way.
 */
export interface LabData {
  data: AppData;
  profile: Profile;
  t: string;
  series: Fitness[];
  measures: Measures;
  curves: PowerCurve[];
  /** The per-ride cache is still being read: charts built on it may yet fill in. */
  building: boolean;
  tests: TestEntry[];
  plan: ActivePlan | null;
  hardDays: Set<string>;
  coach: ProgressCoachState;
  earliest: string;
  rides: Ride[];
  imperial: boolean;
  period: LabPeriod;
  from: string;
  to: string;
  custom: { from: string; to: string };
  setPeriod: (p: LabPeriod, custom?: { from: string; to: string }) => void;
}

const PERIODS: LabPeriod[] = ['4w', '3m', '6m', '1y', 'all', 'plan', 'custom'];
const day = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export function useLab(data: AppData): LabData {
  const profile = data.profile!;
  const t = today();
  const series = useMemo(() => fitnessFromRides(data.rides), [data.rides]);
  const curvesState = useCurves(data);
  const tests = useTests(data);
  const [plan, setPlan] = useState<ActivePlan | null>(null);
  useEffect(() => { getActivePlan().then(setPlan); }, [data.planned.length]);
  const earliest = useMemo(() => [...data.rides, ...data.wellness].reduce((m, x) => (x.date < m ? x.date : m), t), [data.rides, data.wellness, t]);

  // The period lives in the address (so Back returns to it) and is remembered on this device.
  const q0 = useMemo(() => readQuery(), []);
  const urlP = PERIODS.find((k) => k === q0.get('p'));
  const [period, setP] = useState<LabPeriod>(urlP ?? '3m');
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: day(q0.get('pf')) ?? addDays(t, -90), to: day(q0.get('pt')) ?? t });
  useEffect(() => { if (!urlP) getSetting<LabPeriod>('labPeriod', '3m').then((p) => { if (PERIODS.includes(p) && p !== 'custom') setP(p); }); }, []);
  const setPeriod = (p: LabPeriod, c?: { from: string; to: string }) => {
    setP(p);
    if (c) setCustom(c);
    if (p !== 'custom') void setSetting('labPeriod', p);
    replaceQuery({ p, pf: p === 'custom' ? (c ?? custom).from : undefined, pt: p === 'custom' ? (c ?? custom).to : undefined });
  };
  const { from, to } = periodDays(period, t, { earliest, plan: plan ? { start: plan.start, end: plan.goalDate } : undefined, custom });

  const measures = useMemo(() => {
    const hr = hrNumbers(profile);
    return new Measures({
      rides: data.rides, wellness: data.wellness, series, profile, today: t, weekStartOf: (d) => weekStart(d),
      breath: curvesState.curves.filter((c) => c.breathAtPower?.length),
      isEndurance: (r) => { const p = data.planned.find((x) => x.activityId === r.id); const w = p ? findWorkout(data.mine, p.workoutId) : undefined; return w ? (w.family === 'endurance' || w.family === 'recovery') : undefined; },
      hrZones: hr.ladders?.hr,
      weightUnit: pounds(profile) ? 'lb' : 'kg', distUnit: miles(profile) ? 'mi' : 'km',
      readiness: () => new Map(readinessSeries(data.wellness, series, data.rides, data.wellness.reduce((m, w) => (!m || w.date < m ? w.date : m), t), t).map((x) => [x.date, x.score])),
    }, labExtra({
      distUnit: miles(profile) ? 'mi' : 'km', weightUnit: pounds(profile) ? 'lb' : 'kg',
      curves: curvesState.curves,
      tests: tests.map((x) => ({ date: x.date, ftpEstimate: x.result?.ftpEstimate, vo2: x.result?.vo2maxMlKgMin, vt1: x.result?.breath?.vt1?.watts, vt2: x.result?.breath?.vt2?.watts })),
      plannedWeeks: () => {
        const out = new Map<string, number>();
        for (const p of data.planned) { if (!p.planId) continue; const w = findWorkout(data.mine, p.workoutId); if (!w) continue; const s = weekStart(p.plannedFor ?? p.date); out.set(s, (out.get(s) ?? 0) + plannedTss(w)); }
        return out;
      },
      loadRatio: (d) => loadRatio(data.rides, d),
      lthr: profile.lthr,
    }));
  }, [data.rides, data.wellness, series, profile, t, curvesState.curves, tests, data.planned, data.mine]);

  const hardDays = useMemo(() => {
    const by = new Map<string, Ride[]>();
    for (const r of data.rides) { const l = by.get(r.date) ?? []; l.push(r); by.set(r.date, l); }
    const out = new Set<string>();
    for (const [d, l] of by) if (dayKind(l, profile.lthr ?? 0, hrNumbers(profile)) === 'hard') out.add(d);
    return out;
  }, [data.rides, profile]);

  // The coach reads the same facts the Progress page gives it; without an AI connected it is simply absent.
  const range: RangeKey = period === '4w' ? '6w' : period === 'plan' || period === 'custom' ? '3m' : period;
  const facts = useMemo(() => pageFacts({ data, from, to, range, series, curves: curvesState.curves, tests, plan, earliest }), [data, from, to, range, series, curvesState.curves, tests, plan, earliest]);
  const coach = useProgressCoach({ data, range, from, to, facts });

  return { data, profile, t, series, measures, curves: curvesState.curves, building: curvesState.building, tests, plan, hardDays, coach, earliest, rides: data.rides, imperial: miles(profile), period, from, to, custom, setPeriod };
}

// ---------- pins, and where this part of the app opens ----------

export type OpensOn = 'insights' | 'lab';
export const OPENS_KEY = 'insightsOpensOn';
export const PINS_KEY = 'labPins';

/** The rider's pinned charts and measures: `c:<chart>` or `m:<measure>`, in the order pinned. */
export function usePins(): { pins: string[]; toggle: (key: string) => void; has: (key: string) => boolean } {
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => { getSetting<string[]>(PINS_KEY, []).then((p) => setPins(Array.isArray(p) ? p : [])); }, []);
  const toggle = (key: string) => setPins((cur) => { const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]; void setSetting(PINS_KEY, next); return next; });
  return { pins, toggle, has: (k) => pins.includes(k) };
}

export function useOpensOn(): [OpensOn, (v: OpensOn) => void] {
  const [v, setV] = useState<OpensOn>('insights');
  useEffect(() => { getSetting<OpensOn>(OPENS_KEY, 'insights').then((x) => setV(x === 'lab' ? 'lab' : 'insights')); }, []);
  return [v, (x) => { setV(x); void setSetting(OPENS_KEY, x); }];
}
