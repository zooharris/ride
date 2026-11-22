import { assess, type Assessment, type AssessmentInput, type Confidence, type Evidence, type Limiter } from './assessment';
import { addDays } from './load';
import type { Profile } from './types';

/**
 * "What your data say", kept with the plan (22 Nov 2026, brief Part B). The list on Plan my training is worked out
 * afresh each time the page opens; the plan keeps the list it was built from, so the page can say what has moved
 * since. Each line keeps its sentence, its figure and its dot; the plan also keeps its two limiters and the date.
 */

/** The lines in the order the page shows them. */
export const FINDING_KEYS = ['weeklyHours', 'longestRide', 'decoupling', 'efficiencyTrend', 'powerProfile', 'ftpStatus', 'afterStrength', 'afterLongRide', 'afterHardRide', 'compliance', 'rampRate'] as const;
export type FindingKey = typeof FINDING_KEYS[number];

/** A line's figure: one number, several (the power profile; riding and all training hours), or a word (the FTP's status). */
export type Figure = number | number[] | string;

export interface Finding { key: FindingKey; note: string; figure: Figure; confidence: Confidence }

export interface PlanFindings {
  /** The day the findings are from (YYYY-MM-DD). */
  date: string;
  lines: Finding[];
  /** The first two limiters, when they are on record. */
  limiters?: Limiter[];
  /** Worked out afterwards from the rider's history, for a plan built before plans kept their findings. */
  afterwards?: boolean;
}

/** A line's figure, as the planner reads it. */
function figureOf(key: FindingKey, e: Evidence<unknown>, a: Assessment): Figure {
  if (key === 'weeklyHours') return [e.value as number, a.trainingHours];
  if (key === 'powerProfile') { const p = e.value as Assessment['powerProfile']['value']; return [p.p5s, p.p1m, p.p5m, p.p20m].map(round3); }
  return typeof e.value === 'number' ? e.value : String(e.value);
}

/** Today's list, as the page shows it and as a plan keeps it. */
export function findingsOf(a: Assessment): PlanFindings {
  return {
    date: a.asOf,
    lines: FINDING_KEYS.map((key) => { const e = a[key] as Evidence<unknown>; return { key, note: e.note, figure: figureOf(key, e, a), confidence: e.confidence }; }),
    limiters: a.limiters.slice(0, 2),
  };
}

/**
 * Whether a line has moved meaningfully since the plan was built: its dot changed, or its figure moved by a tenth or
 * more. A tenth means a tenth of the larger of the two figures (10%), so a line counted in hours and one counted in
 * percent are held to the same rule; two figures of zero have not moved. A line of several figures has moved when any
 * of them has; a word (the FTP's status) has moved when it is a different word.
 */
export function moved(before: Finding, now: Finding): boolean {
  if (before.confidence !== now.confidence) return true;
  const a = before.figure, b = now.figure;
  if (typeof a === 'string' || typeof b === 'string') return String(a) !== String(b);
  const xs = Array.isArray(a) ? a : [a], ys = Array.isArray(b) ? b : [b];
  if (xs.length !== ys.length) return true;
  return xs.some((x, i) => tenth(x, ys[i]));
}

function tenth(x: number, y: number): boolean {
  const big = Math.max(Math.abs(x), Math.abs(y));
  if (!big) return false;
  return Math.abs(x - y) >= big * 0.1 - 1e-9;
}

/** The lines that have moved since the plan's list, by key, with the plan's line. */
export function changedSince(saved: PlanFindings, now: PlanFindings): Map<FindingKey, Finding> {
  const out = new Map<FindingKey, Finding>();
  for (const n of now.lines) {
    const b = saved.lines.find((x) => x.key === n.key);
    if (b && moved(b, n)) out.set(n.key, b);
  }
  return out;
}

/** The first limiter the plan was built on, when it differs from today's; undefined when they agree or the plan's is not on record. */
export function limiterChanged(saved: PlanFindings, now: PlanFindings): Limiter | undefined {
  const was = saved.limiters?.[0], is = now.limiters?.[0];
  return was && is && was !== is ? was : undefined;
}

/**
 * A finding's sentence in the past tense, where the sentence allows: the plan's list read as a record. Only the
 * sentences the assessment writes are changed, phrase by phrase; anything else is left as written.
 */
const PAST: Array<[RegExp, string]> = [
  [/\bFitness has moved\b/g, 'Fitness had moved'],
  [/\bNo long rides on record yet\b/g, 'No long rides were on record yet'],
  [/\baverages (-?[\d.]+%)/g, 'averaged $1'],
  [/the aerobic base is solid/g, 'the aerobic base was solid'],
  [/so there is some base still to build/g, 'so there was some base still to build'],
  [/so base work will pay first/g, 'so base work would pay first'],
  [/aerobic durability is unknown/g, 'aerobic durability was unknown'],
  [/whether aerobic efficiency is improving/g, 'whether aerobic efficiency was improving'],
  [/Power curve not synced yet; limiters are judged/g, 'Power curve not synced yet; limiters were judged'],
  [/strength sessions look like any other morning; a hard ride after a lift costs you little/g, 'strength sessions looked like any other morning; a hard ride after a lift cost you little'],
  [/strength sessions are a little flatter; the plan prefers/g, 'strength sessions were a little flatter; the plan preferred'],
  [/strength sessions are noticeably flatter; the plan keeps/g, 'strength sessions were noticeably flatter; the plan kept'],
  [/Strength sessions are on record but no wellness data follows them yet/g, 'Strength sessions were on record but no wellness data followed them yet'],
  [/You bounce back from long rides; two long days in a row is on the table/g, 'You bounced back from long rides; two long days in a row was on the table'],
  [/Long rides leave a small dent the next morning; back-to-back long days are fine/g, 'Long rides left a small dent the next morning; back-to-back long days were fine'],
  [/Long rides leave a clear dent the next morning; the plan spaces them out/g, 'Long rides left a clear dent the next morning; the plan spaced them out'],
  [/Hard rides do not show in the next morning; two hard days back to back are possible/g, 'Hard rides did not show in the next morning; two hard days back to back were possible'],
  [/Hard rides leave a small dent the next morning; the plan prefers/g, 'Hard rides left a small dent the next morning; the plan preferred'],
  [/Hard rides leave a clear dent the next morning; the plan spaces them/g, 'Hard rides left a clear dent the next morning; the plan spaced them'],
  [/so a test early on sets the numbers the plan is built on/g, 'so a test early on set the numbers the plan was built on'],
  [/estimate from recent rides is about/g, 'estimate from recent rides was about'],
  [/Recent hard rides estimate FTP nearer/g, 'Recent hard rides estimated FTP nearer'],
  [/targets may be set too high/g, 'targets might have been set too high'],
  [/so the FTP in use is unverified; a test early in the plan is worth it/g, 'so the FTP in use was unverified; a test early in the plan was worth it'],
  [/Recent hard rides agree with the FTP in use/g, 'Recent hard rides agreed with the FTP in use'],
];
export function pastTense(note: string): string {
  let out = note;
  for (const [re, w] of PAST) out = out.replace(re, w);
  return out;
}

/**
 * How many days of history before a date each line reads; a line whose window reaches back before the synced history
 * cannot honestly be worked out for that day, so it is left out rather than guessed.
 */
const WINDOW: Partial<Record<FindingKey, number>> = {
  weeklyHours: 28, longestRide: 56, decoupling: 56, efficiencyTrend: 56, afterStrength: 56, afterLongRide: 56, afterHardRide: 56, compliance: 42,
  // Fitness six weeks back needs history well before that to have settled.
  rampRate: 84,
};

/**
 * B5: the list for a plan built before plans kept their findings, worked out once from the history as it stood on a
 * day: activities before that day, wellness up to and including it, sessions planned before it, and the FTP the last
 * ride before it was scored with. Left out, never guessed: the power profile (the power curve of that day is not on
 * record), the FTP's status when no ride before the day carries its FTP, any line whose window reaches back before
 * the history this device holds, and the limiters (they rest on the power profile).
 */
export function findingsAsOf(inp: Omit<AssessmentInput, 'today' | 'powerCurve'>, day: string, historyFrom: string): PlanFindings {
  const before = inp.rides.filter((r) => r.date < day);
  const lastFtp = [...before].sort((a, b) => b.date.localeCompare(a.date)).find((r) => r.ftpAtRide)?.ftpAtRide;
  const profile: Profile = lastFtp ? { ...inp.profile, ftp: lastFtp } : inp.profile;
  const a = assess({ today: day, profile, rides: before, wellness: inp.wellness.filter((w) => w.date <= day), planned: inp.planned.filter((p) => p.date < day) });
  const all = findingsOf(a);
  const lines = all.lines.filter((l) => {
    if (l.key === 'powerProfile') return false;
    if (l.key === 'ftpStatus') return !!lastFtp;
    const w = WINDOW[l.key];
    return w == null || addDays(day, -w) >= historyFrom;
  });
  return { date: day, lines, afterwards: true };
}

function round3(n: number) { return Math.round(n * 1000) / 1000; }
