/**
 * Step 2 (29 Oct): everything the FTP estimate and the zone analysis read,
 * gathered from the rider's own data, and the app's own FTP estimate from it.
 * Pure: the caller loads the rides, power curves, test results and notes.
 * The AI reads `lines`; the app uses the structured fields. Everything here is
 * the app's own measurement: no FTP estimate from Intervals.icu is read.
 */
import type { Profile, Ride } from './types';
import { addDays } from './load';
import { CURVE_SECONDS, aerobicPoints } from './progress';
import { ladderTops, powerZone, rideHrZones, ridePowerZones } from './zones';
import { fitCp, FIT_SECONDS, FTP_OF_CP, type CpFit } from './cpFit';
import { offVerdict, type SessionVerdict } from './sessionVerdict';
import { aerobicTrend } from './aerobicTrend';
import { BANDS } from './hrPower';
import type { FtpSigns } from './ftpCheck';

export const EVIDENCE_WEEKS = 8;
/** Fewer rides with power than this in the window: too little to estimate from. */
export const THIN_RIDES = 6;

/** When the fit can't be trusted: the single best effort that most directly shows FTP. */
export const FALLBACK_RULES: Array<{ seconds: number; label: string; factor: number }> = [
  { seconds: 3600, label: '60 minutes', factor: 1.0 },
  { seconds: 1200, label: '20 minutes', factor: 0.95 },
];

export interface CurveInput {
  id: string; date: string; w: number[];
  /** Step 2b (30 Oct 2026): heart rate alongside power, power at a steady heart rate, and a hard session's verdict. */
  hrAtPower?: Array<{ lo: number; hi: number; seconds: number; hr: number }>;
  steadyAtHr?: { watts: number; seconds: number };
  ftpAtBuild?: number;
  lthrAtBuild?: number;
  verdict?: SessionVerdict;
}
export interface TestInput { date: string; kind: 'ramp' | '20min'; ftpEstimate?: number; lthrEstimate?: number; vo2maxMlKgMin?: number; ftpAction?: 'updated' | 'kept' }

export interface ThresholdEvidence {
  today: string;
  from: string;
  ridesWithPower: number;
  thin: boolean;
  /** Best power over the window at 1, 5, 20 and 60 minutes, with the ride it came from. */
  bests: Array<{ label: string; seconds: number; watts: number; date: string; rideName?: string }>;
  /** The critical power fit through the best 2 to 30 minute efforts, when there are enough of them. */
  fit?: CpFit;
  /** What the estimate rests on: the fit, a recent test, or one best effort when the fit can't be trusted. */
  basis?: 'fit' | 'test' | 'effort';
  tests: TestInput[];
  /** Share of riding time in each zone (power, and heart rate), over the window. */
  powerZoneShare?: number[];
  hrZoneShare?: number[];
  /** Typical heart rate on rides whose average power fell in each power zone. */
  hrByPowerZone: Array<{ zone: number; rides: number; hr: number }>;
  steady: Array<{ date: string; name: string; ef?: number; drift?: number }>;
  notes: string[];
  /** The app's own FTP estimate. Settled: a good fit, or a recent test; mixed: one best effort only; thin: too little to go on. */
  estimate?: number;
  confidence: 'settled' | 'mixed' | 'thin';
  /** The FTP the rider's efforts prove they can at least ride (the fit when it is good), for the upward check. */
  proven?: number;
  /** What the riding shows for Today's FTP messages (Step 2b, Parts B-C). */
  signs: FtpSigns;
  /** Any ramp or 20-minute test ever, and the newest (all of the record, not just the 12 weeks above). */
  everTested: boolean;
  lastTestDate?: string;
  /** Planned hard sessions judged in the window, newest first (never shown). */
  sessions: Array<{ date: string; name?: string; verdict: SessionVerdict }>;
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
  for (const [label, seconds] of [['1 minute', 60], ['2 minutes', 120], ['5 minutes', 300], ['10 minutes', 600], ['20 minutes', 1200], ['30 minutes', 1800], ['60 minutes', 3600]] as const) {
    const b = best(seconds);
    if (b) bests.push({ label, seconds, ...b });
  }
  const fit = fitCp(bests.filter((x) => FIT_SECONDS.includes(x.seconds)));
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

  // The app's estimate: a recent test is the anchor unless the efforts since prove more; otherwise the fit;
  // otherwise the single best 60 or 20 minutes. Never anything from Intervals.icu.
  const recentTest = tests.find((t) => t.ftpEstimate && t.date >= addDays(today, -8 * 7));
  const fallback = FALLBACK_RULES.map((r) => { const x = bests.find((b) => b.seconds === r.seconds); return x ? { label: r.label, ftp: Math.round(x.watts * r.factor), date: x.date } : undefined; }).find(Boolean);
  const goodFit = fit?.ok ? fit : undefined;
  const proven = goodFit?.ftp;
  let estimate: number | undefined, basis: ThresholdEvidence['basis'], confidence: ThresholdEvidence['confidence'];
  if (recentTest && !(proven && proven >= recentTest.ftpEstimate! * 1.03)) { estimate = recentTest.ftpEstimate; basis = 'test'; confidence = 'settled'; }
  else if (goodFit && !thin) { estimate = goodFit.ftp; basis = 'fit'; confidence = 'settled'; }
  else if (fallback && !thin) { estimate = fallback.ftp; basis = 'effort'; confidence = 'mixed'; }
  else { estimate = undefined; basis = undefined; confidence = 'thin'; }
  const fitWords = (f: CpFit) => `your best ${f.points.map((x) => `${x.seconds / 60}`).join(', ').replace(/, ([^,]*)$/, ' and $1')} minutes`;
  const sources = basis === 'test' ? [`your ${recentTest!.kind === 'ramp' ? 'ramp test' : '20-minute test'} of ${recentTest!.date}`]
    : basis === 'fit' ? [fitWords(goodFit!)]
    : basis === 'effort' ? [`your best ${fallback!.label} (${fallback!.date})`] : [];

  // Step 2b (30 Oct 2026): the hidden evidence. Judged hard sessions; power at a steady heart rate, week by week;
  // heart rate measured in each power band (each record's bands re-scaled from the FTP it was read with).
  const sessions = o.curves.filter((c) => c.verdict && c.date >= from && c.date <= today).sort((a, b) => b.date.localeCompare(a.date))
    .map((c) => ({ date: c.date, name: byId.get(c.id)?.name, verdict: c.verdict! }));
  const lastFour = sessions.filter((x) => x.date >= addDays(today, -42)).slice(0, 4);
  const lastMonth = sessions.filter((x) => x.date >= addDays(today, -28));
  const trend = aerobicTrend(o.curves, p.lthr, today);
  const signs: FtpSigns = {
    sessionsOff: lastFour.filter((x) => offVerdict(x.verdict)).length >= 2,
    sessionsOk: !lastMonth.some((x) => offVerdict(x.verdict)),
    steadyDropped: trend.dropped,
  };
  const bandSec = BANDS.map(() => 0), bandBeats = BANDS.map(() => 0);
  for (const c of curves) for (const b of c.hrAtPower ?? []) {
    const f = ((b.lo + b.hi) / 2) * ((c.ftpAtBuild ?? p.ftp) / Math.max(1, p.ftp));
    const k = BANDS.findIndex(([lo, hi]) => f >= lo && f < hi);
    if (k < 0) continue;
    bandSec[k] += b.seconds; bandBeats[k] += b.hr * b.seconds;
  }
  const hrBands = BANDS.map(([lo, hi], k) => ({ lo, hi, minutes: Math.round(bandSec[k] / 60), hr: bandSec[k] ? Math.round(bandBeats[k] / bandSec[k]) : 0 })).filter((b) => b.minutes >= 3);
  const judgedDates = new Set(sessions.map((x) => x.date));
  const verdictWords = (v: SessionVerdict) => `${v.kind === 'held' ? 'held' : v.kind === 'short' ? 'fell short' : 'a little under'}${v.hr ? `, heart rate ${v.hr} on the last interval` : ''} (${v.intervals} interval${v.intervals === 1 ? '' : 's'}, ${v.work} min of hard work planned)`;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines: string[] = [
    `Window: ${from} to ${today} (${EVIDENCE_WEEKS} weeks). Rides with power in it: ${withPower.length}${thin ? ' (thin: too few to rely on)' : ''}.`,
    `FTP setting now: ${p.ftp} W${p.ftpSetOn ? `, set ${p.ftpSetOn}` : ''}. Threshold heart rate: ${p.lthr} bpm${p.lthrSetOn ? `, set ${p.lthrSetOn}` : ''}. Max heart rate ${p.maxHr} bpm. Weight ${Math.round(p.weightKg)} kg.`,
    `Power zone tops now (zones 1-6, watts): ${ladderTops(ladder, p.ftp).join(', ')} (${p.powerZoneMode === 'abs' ? 'set in watts' : 'set as shares of FTP'}).`,
    `Heart-rate zone tops now (zones 1-6, bpm; zone 7 to max): ${ladderTops(rideHrZones(p), p.lthr).join(', ')} (${p.hrZoneMode === 'abs' ? 'set in bpm' : 'set as shares of threshold heart rate'}).`,
    bests.length ? `Best power in the window: ${bests.map((b) => `${b.label} ${b.watts} W (${b.date}${b.rideName ? `, ${b.rideName}` : ''}${judgedDates.has(b.date) ? ', on the day of a planned hard session' : ''})`).join('; ')}.` : 'Best power in the window: none recorded.',
    fit ? `The app's critical power fit through the best ${fit.points.map((x) => `${x.seconds / 60} min ${x.watts} W`).join(', ')}: sustainable level (critical power) ${fit.cp} W, reserve ${Math.round(fit.wPrime / 1000)} kJ, largest miss ${Math.round(fit.worstMiss * 100)}%; ${fit.ok ? `a good fit, FTP about ${fit.ftp} W (${Math.round(FTP_OF_CP * 100)}% of critical power)` : `not trustworthy: ${fit.problem}`}.` : 'Critical power fit: not enough hard efforts between 2 and 30 minutes to fit.',
    tests.length ? `Tests in the last 12 weeks: ${tests.map((t) => `${t.kind === 'ramp' ? 'ramp test' : '20-minute test'} ${t.date}: FTP estimate ${t.ftpEstimate ?? '?'} W${t.lthrEstimate ? `, threshold heart rate ${t.lthrEstimate} bpm` : ''}${t.vo2maxMlKgMin ? `, VO2max ${t.vo2maxMlKgMin} ml/kg/min` : ''}${t.ftpAction ? ` (rider ${t.ftpAction} their FTP)` : ''}`).join('; ')}.` : 'Tests in the last 12 weeks: none.',
    (() => { const s = share('powerZoneSeconds'); return s ? `Riding time by power zone (1-7): ${s.map(pct).join(', ')}.` : ''; })(),
    (() => { const s = share('hrZoneSeconds'); return s ? `Riding time by heart-rate zone (1-7): ${s.map(pct).join(', ')}.` : ''; })(),
    sessions.length ? `Planned hard sessions, judged against their own steps (held: every interval in its band, the last of a set within 8% of the first; fell short: an interval more than 5% under its band, or the last of a set more than 8% below the first; heart rate high means 105% of threshold heart rate or more on the last interval, low 95% or less): ${sessions.map((x) => `${x.date}${x.name ? ` ${x.name}` : ''}: ${verdictWords(x.verdict)}`).join('; ')}.` : 'Planned hard sessions judged in the window: none.',
    trend.weeks.length ? `Power at a steady heart rate (70-80% of threshold heart rate, after the first 10 minutes), weekly median of rides with 15+ steady minutes, weeks with two such rides or more: ${trend.weeks.map((w) => `week of ${w.start} ${w.watts} W (${w.rides} rides)`).join('; ')}.${trend.recent != null ? ` Last three weeks ${trend.recent} W against ${trend.earlier} W six weeks before${trend.dropped ? ': down 5% or more' : ''}.` : ''}` : '',
    hrBands.length ? `Heart rate measured in each power band over the window (after the first 10 minutes of each ride): ${hrBands.map((b) => `${Math.round(b.lo * 100)}-${Math.round(b.hi * 100)}% of FTP (${Math.round(b.lo * p.ftp)}-${Math.round(b.hi * p.ftp)} W): ${b.hr} bpm over ${b.minutes} min`).join('; ')}.` : '',
    !hrBands.length && hrByPowerZone.length ? `Typical average heart rate on rides of 20 minutes or more whose average power fell in each power zone: ${hrByPowerZone.map((x) => `zone ${x.zone} ${x.hr} bpm (${x.rides} ride${x.rides === 1 ? '' : 's'})`).join('; ')}.` : '',
    steady.length ? `Steady rides of an hour or more (efficiency factor, heart-rate drift): ${steady.map((x) => `${x.date} ${x.name}: EF ${x.ef?.toFixed(2) ?? '?'}, drift ${x.drift != null ? `${x.drift.toFixed(1)}%` : '?'}`).join('; ')}.` : '',
    notes.length ? `The rider's notes mentioning illness or tiredness: ${notes.join(' | ')}.` : '',
    o.readinessBand ? `Readiness today: ${o.readinessBand}.` : '',
    estimate != null ? `The app's own FTP estimate: ${estimate} W (${confidence}; from ${sources.join(', ')}).` : "The app's own FTP estimate: none (too little evidence).",
  ].filter(Boolean);

  return {
    today, from, ridesWithPower: withPower.length, thin, bests, fit, basis, tests,
    powerZoneShare: share('powerZoneSeconds'), hrZoneShare: share('hrZoneSeconds'), hrByPowerZone, steady, notes,
    estimate, confidence, proven, sources, lines, signs, sessions,
    everTested: o.tests.some((t) => t.date <= today), lastTestDate: o.tests.map((t) => t.date).filter((d) => d <= today).sort().pop(),
  };
}
