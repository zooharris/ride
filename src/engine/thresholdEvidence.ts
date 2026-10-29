/**
 * Step 2 (29 Oct): everything the FTP estimate and the zone analysis read,
 * gathered from the rider's own data, and the app's own FTP estimate from it.
 * Pure: the caller loads the rides, power curves, test results and notes.
 * The AI reads `lines`; the app uses the structured fields.
 */
import type { Profile, Ride } from './types';
import { addDays } from './load';
import { CURVE_SECONDS, aerobicPoints } from './progress';
import { ladderTops, powerZone, rideHrZones, ridePowerZones } from './zones';

export const EVIDENCE_WEEKS = 8;
/** Fewer rides with power than this in the window: too little to estimate from. */
export const THIN_RIDES = 6;

/** How a best effort of each length implies FTP. Only lengths the power curves hold (no 8 minutes). */
export const CURVE_RULES: Array<{ seconds: number; label: string; factor: number }> = [
  { seconds: 300, label: '5 minutes', factor: 0.78 },
  { seconds: 1200, label: '20 minutes', factor: 0.95 },
  { seconds: 3600, label: '60 minutes', factor: 1.0 },
];

export interface CurveInput { id: string; date: string; w: number[] }
export interface TestInput { date: string; kind: 'ramp' | '20min'; ftpEstimate?: number; lthrEstimate?: number; vo2maxMlKgMin?: number; ftpAction?: 'updated' | 'kept' }

export interface ThresholdEvidence {
  today: string;
  from: string;
  ridesWithPower: number;
  thin: boolean;
  /** Best power over the window at 1, 5, 20 and 60 minutes, with the ride it came from. */
  bests: Array<{ label: string; seconds: number; watts: number; date: string; rideName?: string }>;
  /** FTP each best effort implies. */
  implied: Array<{ label: string; ftp: number }>;
  /** Intervals.icu's per-ride FTP estimates, newest first, up to ten. */
  icu: Array<{ date: string; ftp: number }>;
  icuMedian?: number;
  icuTrend?: 'rising' | 'flat' | 'falling';
  tests: TestInput[];
  /** Share of riding time in each zone (power, and heart rate), over the window. */
  powerZoneShare?: number[];
  hrZoneShare?: number[];
  /** Typical heart rate on rides whose average power fell in each power zone. */
  hrByPowerZone: Array<{ zone: number; rides: number; hr: number }>;
  steady: Array<{ date: string; name: string; ef?: number; drift?: number }>;
  notes: string[];
  /** The app's own FTP estimate, and how far its sources agree. */
  estimate?: number;
  confidence: 'settled' | 'mixed' | 'thin';
  /** Which sources the estimate came from, in words. */
  sources: string[];
  lines: string[];
}

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** The weighted median: each value counted `weight` times. */
export function weightedMedian(items: Array<{ value: number; weight: number }>): number | undefined {
  const xs: number[] = [];
  for (const it of items) for (let k = 0; k < it.weight; k++) xs.push(it.value);
  return median(xs);
}

const ILLNESS = /\b(sick|ill|cold|flu|fever|covid|virus|tired|exhausted|fatigue|run down|sore throat)\b/i;

export function gatherEvidence(o: {
  profile: Profile;
  rides: Ride[];
  curves: CurveInput[];
  tests: TestInput[];
  notes: Array<{ date: string; text?: string }>;
  readinessBand?: string;
  today: string;
}): ThresholdEvidence {
  const { profile: p, today } = o;
  const from = addDays(today, -EVIDENCE_WEEKS * 7);
  const rides = o.rides.filter((r) => r.date >= from && r.date <= today && r.sport === 'ride' && !r.notTraining);
  const withPower = rides.filter((r) => (r.averagePower ?? r.normalizedPower ?? 0) > 0);
  const thin = withPower.length < THIN_RIDES;
  const curves = o.curves.filter((c) => c.date >= from && c.date <= today);
  const byId = new Map(o.rides.map((r) => [r.id, r]));

  const best = (seconds: number) => {
    const i = CURVE_SECONDS.indexOf(seconds);
    let top: { watts: number; date: string; rideName?: string } | undefined;
    for (const c of curves) { const w = c.w[i] ?? 0; if (w > 0 && (!top || w > top.watts)) top = { watts: Math.round(w), date: c.date, rideName: byId.get(c.id)?.name }; }
    return top;
  };
  const bests: ThresholdEvidence['bests'] = [];
  for (const [label, seconds] of [['1 minute', 60], ['5 minutes', 300], ['20 minutes', 1200], ['60 minutes', 3600]] as const) {
    const b = best(seconds);
    if (b) bests.push({ label, seconds, ...b });
  }
  const implied = CURVE_RULES.flatMap((r) => { const b = bests.find((x) => x.seconds === r.seconds); return b ? [{ label: r.label, ftp: Math.round(b.watts * r.factor) }] : []; });

  const icu = rides.filter((r) => (r.eftp ?? 0) > 0).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((r) => ({ date: r.date, ftp: Math.round(r.eftp!) }));
  const icuMedian = median(icu.map((x) => x.ftp));
  let icuTrend: ThresholdEvidence['icuTrend'];
  if (icu.length >= 4) {
    const newer = median(icu.slice(0, Math.floor(icu.length / 2)).map((x) => x.ftp))!;
    const older = median(icu.slice(Math.floor(icu.length / 2)).map((x) => x.ftp))!;
    icuTrend = newer > older * 1.02 ? 'rising' : newer < older * 0.98 ? 'falling' : 'flat';
  }

  const tests = o.tests.filter((t) => t.date >= addDays(today, -12 * 7) && t.date <= today).sort((a, b) => b.date.localeCompare(a.date));

  const share = (key: 'powerZoneSeconds' | 'hrZoneSeconds') => {
    const sums: number[] = [];
    for (const r of rides) (r[key] ?? []).forEach((s, i) => { sums[i] = (sums[i] ?? 0) + (s ?? 0); });
    const total = sums.reduce((a, b) => a + (b ?? 0), 0);
    return total > 0 ? sums.map((s) => Math.round(((s ?? 0) / total) * 100) / 100) : undefined;
  };

  const ladder = ridePowerZones(p);
  const zoneHr = new Map<number, number[]>();
  for (const r of withPower) {
    if (!r.averageHr || !r.averagePower || p.ftp <= 0 || r.seconds < 20 * 60) continue;
    const z = powerZone(r.averagePower / p.ftp, ladder);
    zoneHr.set(z, [...(zoneHr.get(z) ?? []), r.averageHr]);
  }
  const hrByPowerZone = [...zoneHr.entries()].sort((a, b) => a[0] - b[0]).map(([zone, hrs]) => ({ zone, rides: hrs.length, hr: Math.round(median(hrs)!) }));

  const steady = aerobicPoints(rides, () => undefined, p.lthr, rideHrZones(p)).slice(-5);
  const notes = o.notes.filter((n) => n.date >= from && n.text && ILLNESS.test(n.text)).map((n) => `${n.date}: ${n.text}`);

  // The app's estimate: curve rules weigh 1 each, Intervals.icu's median 1, a test under 8 weeks old 2.
  const recentTest = tests.find((t) => t.ftpEstimate && t.date >= addDays(today, -8 * 7));
  const items: Array<{ value: number; weight: number }> = [
    ...implied.map((x) => ({ value: x.ftp, weight: 1 })),
    ...(icuMedian ? [{ value: icuMedian, weight: 1 }] : []),
    ...(recentTest ? [{ value: recentTest.ftpEstimate!, weight: 2 }] : []),
  ];
  const est = weightedMedian(items);
  const estimate = est != null ? Math.round(est) : undefined;
  const values = items.map((x) => x.value);
  const spread = values.length && estimate ? (Math.max(...values) - Math.min(...values)) / estimate : 0;
  const confidence: ThresholdEvidence['confidence'] = thin && !recentTest ? 'thin' : spread <= 0.03 ? 'settled' : 'mixed';
  const sources = [
    ...(implied.length ? [`your best ${implied.map((x) => x.label).join(', ').replace(/, ([^,]*)$/, ' and $1')}`] : []),
    ...(icuMedian ? ["Intervals.icu's estimates"] : []),
    ...(recentTest ? [`your ${recentTest.kind === 'ramp' ? 'ramp test' : '20-minute test'} of ${recentTest.date}`] : []),
  ];

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines: string[] = [
    `Window: ${from} to ${today} (${EVIDENCE_WEEKS} weeks). Rides with power in it: ${withPower.length}${thin ? ' (thin: too few to rely on)' : ''}.`,
    `FTP setting now: ${p.ftp} W${p.ftpSetOn ? `, set ${p.ftpSetOn}` : ''}. Threshold heart rate: ${p.lthr} bpm${p.lthrSetOn ? `, set ${p.lthrSetOn}` : ''}. Max heart rate ${p.maxHr} bpm. Weight ${Math.round(p.weightKg)} kg.`,
    `Power zone tops now (zones 1-6, watts): ${ladderTops(ladder, p.ftp).join(', ')} (${p.powerZoneMode === 'abs' ? 'set in watts' : 'set as shares of FTP'}).`,
    `Heart-rate zone tops now (zones 1-6, bpm; zone 7 to max): ${ladderTops(rideHrZones(p), p.lthr).join(', ')} (${p.hrZoneMode === 'abs' ? 'set in bpm' : 'set as shares of threshold heart rate'}).`,
    bests.length ? `Best power in the window: ${bests.map((b) => `${b.label} ${b.watts} W (${b.date}${b.rideName ? `, ${b.rideName}` : ''})`).join('; ')}.` : 'Best power in the window: none recorded.',
    implied.length ? `FTP those imply: ${implied.map((x) => `${x.label} rule ${x.ftp} W`).join('; ')} (5 min × 0.78, 20 min × 0.95, 60 min × 1.0).` : '',
    icu.length ? `Intervals.icu's per-ride FTP estimates (newest first): ${icu.map((x) => `${x.ftp} W on ${x.date}`).join(', ')}; median ${Math.round(icuMedian!)} W${icuTrend ? `, ${icuTrend}` : ''}.` : "Intervals.icu's per-ride FTP estimates: none in the window.",
    tests.length ? `Tests in the last 12 weeks: ${tests.map((t) => `${t.kind === 'ramp' ? 'ramp test' : '20-minute test'} ${t.date}: FTP estimate ${t.ftpEstimate ?? '?'} W${t.lthrEstimate ? `, threshold heart rate ${t.lthrEstimate} bpm` : ''}${t.vo2maxMlKgMin ? `, VO2max ${t.vo2maxMlKgMin} ml/kg/min` : ''}${t.ftpAction ? ` (rider ${t.ftpAction} their FTP)` : ''}`).join('; ')}.` : 'Tests in the last 12 weeks: none.',
    (() => { const s = share('powerZoneSeconds'); return s ? `Riding time by power zone (1-7): ${s.map(pct).join(', ')}.` : ''; })(),
    (() => { const s = share('hrZoneSeconds'); return s ? `Riding time by heart-rate zone (1-7): ${s.map(pct).join(', ')}.` : ''; })(),
    hrByPowerZone.length ? `Typical average heart rate on rides of 20 minutes or more whose average power fell in each power zone: ${hrByPowerZone.map((x) => `zone ${x.zone} ${x.hr} bpm (${x.rides} ride${x.rides === 1 ? '' : 's'})`).join('; ')}.` : '',
    steady.length ? `Steady rides of an hour or more (efficiency factor, heart-rate drift): ${steady.map((x) => `${x.date} ${x.name}: EF ${x.ef?.toFixed(2) ?? '?'}, drift ${x.drift != null ? `${x.drift.toFixed(1)}%` : '?'}`).join('; ')}.` : '',
    notes.length ? `The rider's notes mentioning illness or tiredness: ${notes.join(' | ')}.` : '',
    o.readinessBand ? `Readiness today: ${o.readinessBand}.` : '',
    estimate != null ? `The app's own FTP estimate from these: ${estimate} W (${confidence}).` : '',
  ].filter(Boolean);

  return {
    today, from, ridesWithPower: withPower.length, thin, bests, implied, icu, icuMedian: icuMedian != null ? Math.round(icuMedian) : undefined, icuTrend, tests,
    powerZoneShare: share('powerZoneSeconds'), hrZoneShare: share('hrZoneSeconds'), hrByPowerZone, steady, notes,
    estimate, confidence, sources, lines,
  };
}
