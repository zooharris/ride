import type { OwnRecord } from '../data/db';
import type { Ride } from '../engine/types';

/**
 * TEMPORARY (22 Nov 2026, Stage 1 brief B5, decision 5b): the one-time check of Antogo's numbers against
 * Intervals.icu's on the rider's own history, run on their device, with results to copy. Not linked from anywhere in
 * the app; removed in the follow-up build once the results are in.
 */
export interface MetricCheck { key: string; label: string; n: number; within: number; medianPct?: number; worst: Array<{ id: string; date: string; name: string; came: string; own: string }> }

type Tol = { abs?: number; pct?: number };
const METRICS: Array<{ key: string; label: string; tol: Tol; unit?: string; zone?: boolean }> = [
  { key: 'tss', label: 'Training load (Antogo against Intervals.icu’s load)', tol: { abs: 2, pct: 3 } },
  { key: 'normalizedPower', label: 'Normalized power', tol: { pct: 2 }, unit: 'W' },
  { key: 'averagePower', label: 'Average power', tol: { pct: 2 }, unit: 'W' },
  { key: 'intensityFactor', label: 'Intensity', tol: { abs: 0.02 } },
  { key: 'workKj', label: 'Work done', tol: { pct: 2 }, unit: 'kJ' },
  { key: 'averageHr', label: 'Average heart rate', tol: { abs: 2 }, unit: 'bpm' },
  { key: 'maxHr', label: 'Max heart rate', tol: { abs: 2 }, unit: 'bpm' },
  { key: 'averageCadence', label: 'Average cadence', tol: { abs: 2 }, unit: 'rpm' },
  { key: 'efficiencyFactor', label: 'Efficiency (watts per heartbeat)', tol: { pct: 2 } },
  { key: 'decoupling', label: 'Heart-rate drift', tol: { abs: 1 }, unit: 'points' },
  { key: 'coastingSeconds', label: 'Time coasting', tol: { abs: 60, pct: 10 }, unit: 's' },
  { key: 'maxSpeedMs', label: 'Top speed', tol: { pct: 3 }, unit: 'm/s' },
  { key: 'calories', label: 'Energy burned', tol: { pct: 10 }, unit: 'kcal' },
  { key: 'powerZoneSeconds', label: 'Time in power zones (each zone)', tol: { abs: 60, pct: 2 }, zone: true },
  { key: 'hrZoneSeconds', label: 'Time in heart-rate zones (each zone)', tol: { abs: 60, pct: 2 }, zone: true },
];

const within = (a: number, b: number, t: Tol, scale = Math.max(Math.abs(a), Math.abs(b))) => {
  const d = Math.abs(a - b);
  return (t.abs != null && d <= t.abs) || (t.pct != null && d <= (scale * t.pct) / 100);
};

/** The check, metric by metric, over the latest activities that have both figures. */
export function checkNumbers(rides: Ride[], recs: OwnRecord[], limit = 200): MetricCheck[] {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const both = rides.filter((r) => r.ownNumbers && byId.get(r.id)?.came).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  return METRICS.map((m) => {
    const rows: Array<{ r: Ride; came: number; own: number; ok: boolean; pct: number }> = [];
    for (const r of both) {
      const rec = byId.get(r.id)!;
      const came = rec.came as Record<string, unknown>, own = rec.nums as Record<string, unknown>;
      if (m.key === 'tss') {
        if (r.icuLoad == null || r.tss == null || r.tssBasis !== 'power') continue;
        rows.push({ r, came: r.icuLoad, own: r.tss, ok: within(r.icuLoad, r.tss, m.tol), pct: pctOf(r.icuLoad, r.tss) });
      } else if (m.zone) {
        const a = came[m.key] as number[] | undefined, b = own[m.key] as number[] | undefined;
        if (!a?.length || !b?.length) continue;
        const total = Math.max(1, a.reduce((x, y) => x + y, 0));
        let worst = 0, ok = true;
        for (let i = 0; i < Math.min(a.length, b.length); i++) { if (!within(a[i], b[i], m.tol, total)) ok = false; worst = Math.max(worst, Math.abs(a[i] - b[i])); }
        rows.push({ r, came: total, own: worst, ok, pct: (worst / total) * 100 });
      } else {
        const a0 = came[m.key], b = own[m.key];
        if (typeof a0 !== 'number' || typeof b !== 'number') continue;
        // Intervals.icu's drift runs the other way up; figures remembered before that was known are turned over here.
        const a = m.key === 'decoupling' && rec.cameV !== 2 ? -a0 : a0;
        rows.push({ r, came: a, own: b, ok: within(a, b, m.tol), pct: pctOf(a, b) });
      }
    }
    const pcts = rows.map((x) => x.pct).sort((a, b) => a - b);
    const fmt = (v: number) => (m.zone ? '' : `${Math.round(v * 100) / 100}${m.unit ? ` ${m.unit}` : ''}`);
    return {
      key: m.key, label: m.label, n: rows.length, within: rows.filter((x) => x.ok).length,
      medianPct: pcts.length ? Math.round(pcts[Math.floor(pcts.length / 2)] * 10) / 10 : undefined,
      worst: rows.filter((x) => !x.ok).sort((a, b) => b.pct - a.pct).slice(0, 3).map((x) => ({ id: x.r.id, date: x.r.date, name: x.r.name, came: m.zone ? `${Math.round(x.came / 60)} min in all` : fmt(x.came), own: m.zone ? `off by up to ${Math.round(x.own / 60)} min in one zone` : fmt(x.own) })),
    };
  });
}
const pctOf = (a: number, b: number) => (Math.max(Math.abs(a), Math.abs(b)) ? (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))) * 100 : 0);

export function checkText(cs: MetricCheck[], activities: number): string {
  return [`Antogo's numbers against Intervals.icu's, ${new Date().toLocaleString()}, over ${activities} activities`,
    ...cs.map((c) => `${c.label}: ${c.n ? `${c.within} of ${c.n} agree${c.medianPct != null ? ` (median difference ${c.medianPct}%)` : ''}` : 'none to compare'}${c.worst.length ? `; most different: ${c.worst.map((w) => `${w.date} ${w.name} (Intervals.icu ${w.came}, Antogo ${w.own})`).join('; ')}` : ''}`)].join('\n');
}
