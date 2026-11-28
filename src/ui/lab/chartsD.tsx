import { hasPowerHistory } from '../../engine/hrRecords';
import { inRange } from '../../engine/measures';
import { readings } from '../../engine/lab';
import { weekStart } from '../derived';
import { readQuery } from '../router';
import { Progress } from '../screens/Progress';
import { C } from './look';
import type { LabChart } from './types';
import type { LabData } from './useLab';
import { Mini, plural, sample, sg, short } from './util';

/**
 * What the Progress page held that no designed chart replaces (28 Nov 2026), brought into the Lab whole: the fitness
 * chart that other measures are laid over, and the cards for weekly load against the plan, key numbers, aerobic
 * efficiency, monthly totals, fitness tests, consistency, body measurements and, for a rider without power,
 * heart-rate records. Each is the same card, doing everything it did.
 */
const card = (only: string[]) => function Card({ L }: { L: LabData }) { return <Progress data={L.data} params={readQuery()} embed={{ only }} />; };
const any = (L: LabData) => (L.rides.length ? { state: 'ok' as const } : { state: 'none' as const, why: 'Needs recorded activities' });
const weekly = (L: LabData, of: (r: LabData['rides'][number]) => number) => {
  const by = new Map<string, number>();
  for (const r of L.rides) if (r.date >= L.from && r.date <= L.to) by.set(weekStart(r.date), (by.get(weekStart(r.date)) ?? 0) + of(r));
  return [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);
};

export const overlayChart: LabChart = {
  id: 'overlay', name: 'Fitness, with anything laid over it', about: 'Fitness, fatigue and form, with HRV, sleep, weight and more overlaid.', question: 'fitter', words: 'overlay compare stats progress chips lay over hrv sleep weight',
  ready: (L) => { const n = new Set(L.rides.filter((r) => (r.tss ?? 0) > 0).map((r) => r.date)).size; return n >= 7 ? { state: 'ok' } : n ? { state: 'some', so: `Your data so far: ${plural(n, 'day')} of training` } : { state: 'none', why: 'Needs recorded activities' }; },
  tile: (L) => {
    const by = new Map(L.series.map((p) => [p.date, p])), last = L.series[L.series.length - 1];
    const over = ['hrv', 'sleep', 'weight'].find((id) => readings(L.measures, id) >= 3);
    const o = over ? L.measures.values(over) : undefined;
    const lo = o ? Math.min(...inRange(o, L.from, L.to).map((q) => q[1])) : 0, hi = o ? Math.max(...inRange(o, L.from, L.to).map((q) => q[1])) : 1;
    const top = Math.max(1, ...L.series.filter((p) => p.date >= L.from).map((p) => p.ctl));
    let cur: number | undefined;
    return { mini: <Mini label="Your fitness with another measure laid over it" lines={[...(o ? [{ vals: sample((d) => { const v = o.get(d); if (v != null) cur = (v - lo) / (hi - lo || 1) * top; return cur; }, L.from, L.to), color: C.cyan, width: 1.2 }] : []), { vals: sample((d) => by.get(d)?.tsb != null ? by.get(d)!.ctl + by.get(d)!.tsb : undefined, L.from, L.to), color: C.violet, width: 1 }, { vals: sample((d) => by.get(d)?.ctl, L.from, L.to), color: C.gold, width: 2 }]} />,
      figure: last ? `${Math.round(last.ctl)}` : undefined, label: last ? `fitness · form ${sg(last.tsb)} · choose what to lay over it` : undefined };
  },
  ownPeriod: true,
  Page: card(['fitness']),
};

export const weekLoadChart: LabChart = {
  id: 'weekload', name: 'Weekly load against the plan', about: 'Each week’s training load, with what the plan asked for.', question: 'plan', words: 'tss week planned done',
  ready: any,
  tile: (L) => { const w = weekly(L, (r) => r.tss ?? 0); return { mini: <Mini label="Your training load, week by week" bars={{ vals: w, color: C.gold }} />, figure: w.length ? `${Math.round(w[w.length - 1])} TSS` : undefined, label: w.length ? 'this week so far' : 'no training in this period' }; },
  ownPeriod: true,
  Page: card(['load']),
};

export const totalsChart: LabChart = {
  id: 'totals', name: 'Totals, month by month', about: 'Hours, distance and climbing each month, against the year before.', question: 'enough', words: 'monthly distance climbing hours last year',
  ready: any,
  tile: (L) => { const w = weekly(L, (r) => r.seconds / 3600); const sum = w.reduce((a, b) => a + b, 0); return { mini: <Mini label="Your hours, week by week" bars={{ vals: w, color: C.end }} />, figure: `${Math.round(sum)} h`, label: 'in this period' }; },
  ownPeriod: true,
  Page: card(['totals', 'consistency']),
};

export const aerobicChart: LabChart = {
  id: 'aerobic', name: 'Aerobic efficiency', about: 'Power for each heartbeat on steady rides, and how far heart rate drifts.', question: 'fitter', words: 'efficiency factor decoupling drift ef',
  ready: any,
  tile: (L) => { const e = inRange(L.measures.values('ef'), L.from, L.to); const last = e[e.length - 1]; return { mini: <Mini label="Your efficiency on steady rides" lines={[{ vals: e.map((q) => q[1]), color: C.tempo, width: 1.8, area: true }]} />, figure: last ? last[1].toFixed(2) : undefined, label: last ? 'watts for each heartbeat, newest steady ride' : 'no steady rides in this period' }; },
  ownPeriod: true,
  Page: card(['aerobic']),
};

export const testsChart: LabChart = {
  id: 'tests', name: 'Fitness tests and key numbers', about: 'Every test you have ridden and what it found, with your key numbers.', question: 'fitter', words: 'ramp test ftp vo2max key numbers',
  ready: any,
  tile: (L) => ({ mini: <Mini label="The FTP each of your tests found" lines={[{ vals: L.tests.filter((x) => x.result?.ftpEstimate).map((x) => x.result!.ftpEstimate!), color: C.vo2, width: 2 }]} />, figure: plural(L.tests.length, 'test'), label: L.tests.length ? `the newest on ${short(L.tests.reduce((m, x) => (x.date > m ? x.date : m), ''))}` : 'none ridden yet' }),
  ownPeriod: true,
  Page: card(['key', 'tests', 'body']),
};

export const hrRecordsChart: LabChart = {
  id: 'hrrecords', name: 'Heart-rate records', about: 'Your bests by heart rate, for riding without a power meter.', question: 'profile', words: 'heart rate bests no power',
  ready: (L) => (hasPowerHistory(L.rides) ? { state: 'none', why: 'For riders without a power meter: your records are on the Records chart' } : any(L)),
  tile: (L) => { const m = inRange(L.measures.values('maxHr'), L.from, L.to); return { mini: <Mini label="The highest heart rate of each ride" lines={[{ vals: m.map((q) => q[1]), color: C.sprint, width: 1.8 }]} />, figure: m.length ? `${Math.round(Math.max(...m.map((q) => q[1])))} bpm` : undefined, label: m.length ? 'highest in this period' : undefined }; },
  ownPeriod: true,
  Page: card(['hrrecords']),
};
