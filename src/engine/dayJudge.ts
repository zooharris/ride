import { addDays } from './load';
import { bandOf, type Readiness } from './readiness';
import type { SessionVerdict } from './sessionVerdict';
import type { SessionKind } from './types';
import type { ResolvedChange, Stance } from '../coach/judge';

/**
 * The re-check thinks (1 Nov 2026), Part E: the app's own day judge, for riders
 * without a coach. Pure. It follows the readiness score's method: every signal
 * is scored against the rider's own normal range (mean and usual spread of their
 * own history), where a day at the rider's normal scores 70 and each spread
 * worse about 12 less; the signals are combined, and the readiness bands decide
 * the day. No fixed load or duration is used anywhere. How long a ride lasted
 * against its plan is not a signal.
 */
export const HISTORY_DAYS = 56;

export interface DaySession {
  id: string;
  date: string;
  kind: SessionKind;
  name: string;
  /** Ride family (tempo, sweetspot, endurance, recovery…); other kinds have none. */
  family?: string;
  minutes: number;
  done: boolean;
  handPlaced: boolean;
}

export interface DayOption { id: string; name: string; family: string; minutes: number; setting?: string }

export interface DayJudgeInput {
  date: string;
  readiness: Readiness;
  /** The rider set this morning's numbers aside: the morning is left out. */
  setAside: boolean;
  /** Training load by day, the last 8 weeks and more. */
  loads: Array<{ date: string; tss: number }>;
  /** What yesterday was, for the rider's own morning-after evidence (0..1 dip in readiness, as the assessment measured it). */
  yesterdayKind?: 'long' | 'hard' | 'strength';
  morningAfterCost?: number;
  /** The latest ride's reads against the rider's own history. */
  performance?: {
    /** Beats above (+) the rider's usual heart rate at the same power, and the rider's usual spread of that number ride to ride. */
    hrVsNormal?: { beats: number; spread: number };
    /** Drift on the latest ride, and the rider's usual drift and its spread. */
    drift?: { value: number; usual: number; spread: number };
    verdict?: SessionVerdict;
  };
  /** The calendar from today to the end of the week. */
  week: DaySession[];
  /** Hours available on each day of the week (index 0 = Sunday), and which days allow a ride; without a plan, none. */
  hours?: number[];
  rideAllowed?: (date: string) => boolean;
  /** Library rides that may go on today (the right setting for today). */
  rides: DayOption[];
}

export interface DayJudgment {
  stance: Stance;
  score: number;
  /** The signals in words, for the reasons. */
  reasons: string[];
  changes: ResolvedChange[];
}

const QUALITY = ['tempo', 'sweetspot', 'threshold', 'vo2max', 'anaerobic', 'test'];
/** One family down, for a lighter day. */
const DOWN: Record<string, string> = { anaerobic: 'vo2max', vo2max: 'threshold', threshold: 'sweetspot', sweetspot: 'tempo', tempo: 'endurance', test: 'endurance', endurance: 'recovery' };
const scoreOfZ = (z: number) => Math.max(0, Math.min(100, 70 + 12 * z));
const dowOf = (date: string) => new Date(date + 'T00:00:00').getDay();

/** The normal quantile (Acklam's approximation): a share of days below, as spreads from the middle. */
function quantile(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) return -quantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Where a value falls among the rider's own: the share of their days below it (ties count half), kept off 0 and 1. */
function rank(x: number, xs: number[]): number {
  const below = xs.filter((v) => v < x).length, same = xs.filter((v) => v === x).length;
  return Math.min(1 - 0.5 / xs.length, Math.max(0.5 / xs.length, (below + same / 2) / xs.length));
}

/**
 * Yesterday's load, and the last three days', placed among the rider's own days over the last 8 weeks: positive =
 * lighter than the rider's usual. Yesterday is placed among the rider's days of the same weekday when there are enough
 * (a rider's routine long Saturday is their normal Saturday, not a big day), else among all their days; the last three
 * days are placed among all their three-day spells. The two are averaged.
 */
export function loadSignal(loads: Array<{ date: string; tss: number }>, date: string): { z: number; words: string } | undefined {
  const by = new Map<string, number>();
  for (const l of loads) by.set(l.date, (by.get(l.date) ?? 0) + l.tss);
  const day = (d: string) => by.get(d) ?? 0;
  const three = (d: string) => day(d) + day(addDays(d, -1)) + day(addDays(d, -2));
  const y = addDays(date, -1);
  const days: number[] = [], threes: number[] = [], sameDow: number[] = [];
  for (let i = 2; i <= HISTORY_DAYS + 1; i++) { const d = addDays(date, -i); days.push(day(d)); threes.push(three(d)); if (dowOf(d) === dowOf(y)) sameDow.push(day(d)); }
  if (days.filter((x) => x > 0).length < 5) return undefined;
  const byWeekday = sameDow.filter((x) => x > 0).length >= 4;
  const r1 = rank(day(y), byWeekday ? sameDow : days), r3 = rank(three(y), threes);
  const z = -(quantile(r1) + quantile(r3)) / 2;
  const pct = (r: number) => Math.round(r * 100);
  const weekday = new Date(y + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
  const dayWords = day(y) === 0 ? 'yesterday was a rest day'
    : byWeekday ? (r1 >= 0.8 ? `yesterday's training load (${Math.round(day(y))} TSS) was above your usual for a ${weekday}` : r1 <= 0.2 ? `yesterday's training load (${Math.round(day(y))} TSS) was below your usual for a ${weekday}` : `yesterday's training load (${Math.round(day(y))} TSS) was about your usual for a ${weekday}`)
    : `yesterday's training load (${Math.round(day(y))} TSS) was more than ${pct(r1)}% of your days in the last 8 weeks`;
  const threeWords = r3 >= 0.8 ? 'the last three days together were among your heavier spells' : r3 <= 0.2 ? 'the last three days together were light for you' : 'the last three days together were about your usual';
  return { z, words: `${dayWords}, and ${threeWords}` };
}

export function judgeTheDay(input: DayJudgeInput): DayJudgment {
  const parts: Array<{ score: number; weight: number }> = [];
  const reasons: string[] = [];
  // The morning: the readiness score, already against the rider's own normal. When it rests on form alone, the rider's
  // own morning-after evidence for the kind of day yesterday was stands in for the missing numbers.
  if (!input.setAside && !input.readiness.formOnly && input.readiness.drivers.some((d) => d.normal != null)) {
    parts.push({ score: input.readiness.score, weight: 2 });
    const off = input.readiness.drivers.filter((d) => d.effect === 'down' && d.normal != null).map((d) => d.name.toLowerCase());
    reasons.push(off.length ? `this morning's ${off.join(' and ')} ${off.length === 1 ? 'is' : 'are'} worse than your normal${input.readiness.drivers.some((d) => d.note?.includes('running')) ? ', two mornings running' : ''}` : 'this morning\'s numbers are within your normal');
  } else if (input.yesterdayKind && input.morningAfterCost != null && input.morningAfterCost > 0) {
    // The assessment's cost is the rider's measured HRV dip after such a day (0.3 = a 7.5% dip): about what the
    // readiness score would have shown, 70 less 40 times the cost.
    parts.push({ score: 70 - 40 * input.morningAfterCost, weight: 1 });
    reasons.push(`no overnight numbers to go on; your mornings after a ${input.yesterdayKind === 'long' ? 'long ride' : input.yesterdayKind === 'hard' ? 'hard ride' : 'strength day'} usually dip`);
  }
  // Load is the rider's own prior: it carries full weight only when the morning's numbers are missing, since the
  // morning already shows how the rider responded to yesterday. It is spoken of only when it is unusual.
  const morningIn = parts.length > 0 && !(input.readiness.formOnly || input.setAside);
  const load = loadSignal(input.loads, input.date);
  if (load) { parts.push({ score: scoreOfZ(load.z), weight: morningIn ? 0.5 : 1 }); if (Math.abs(load.z) >= 0.75) reasons.push(load.words); }
  const p = input.performance;
  if (p?.hrVsNormal) {
    const z = -p.hrVsNormal.beats / Math.max(p.hrVsNormal.spread, 1);
    parts.push({ score: scoreOfZ(z), weight: 0.5 });
    if (Math.abs(z) >= 0.75) reasons.push(`on your latest ride heart rate ran ${Math.abs(Math.round(p.hrVsNormal.beats))} bpm ${p.hrVsNormal.beats > 0 ? 'above' : 'below'} your usual at the same power`);
  }
  if (p?.drift) {
    const z = -(p.drift.value - p.drift.usual) / Math.max(p.drift.spread, 1);
    parts.push({ score: scoreOfZ(z), weight: 0.5 });
    if (z <= -0.75) reasons.push(`heart rate drifted ${p.drift.value}% against power, more than your usual ${Math.round(p.drift.usual)}%`);
  }
  if (p?.verdict && (p.verdict.kind === 'short' || (p.verdict.kind === 'held' && p.verdict.hr === 'high'))) {
    parts.push({ score: scoreOfZ(-1), weight: 0.5 });
    reasons.push(p.verdict.kind === 'short' ? 'your last hard session fell short of its targets' : 'your last hard session was held only with heart rate high');
  }
  const w = parts.reduce((t, x) => t + x.weight, 0);
  const score = w ? Math.round(parts.reduce((t, x) => t + x.score * x.weight, 0) / w) : 70;
  const band = bandOf(score);
  const stance: Stance = band === 'go' ? 'as planned' : band === 'ease' ? 'lighter' : band === 'easy' ? 'easy' : 'rest';
  return { stance, score, reasons, changes: stance === 'as planned' ? [] : changesFor(stance, input, reasons) };
}

function why(stance: Stance, reasons: string[]): string {
  const said = reasons.length ? `${reasons[0].charAt(0).toUpperCase()}${reasons[0].slice(1)}${reasons.length > 1 ? `; ${reasons.slice(1).join('; ')}` : ''}.` : '';
  return `${said} ${stance === 'lighter' ? 'A lighter day than planned.' : stance === 'easy' ? 'Keep today easy.' : 'Rest today.'}`.trim();
}

/** Today's calendar changes for a lighter, easy or rest day. Nothing beyond this week is touched. */
function changesFor(stance: Stance, input: DayJudgeInput, reasons: string[]): ResolvedChange[] {
  const t = input.date;
  const today = input.week.filter((s) => s.date === t && !s.done);
  const ride = today.find((s) => s.kind === 'ride');
  const out: ResolvedChange[] = [];
  const reason = why(stance, reasons);
  const quality = !!ride && QUALITY.includes(ride.family ?? '');
  const cap = input.hours ? input.hours[dowOf(t)] * 60 : Infinity;
  const pick = (family: string, near: number) => input.rides.filter((r) => r.family === family && r.minutes <= Math.min(cap, Math.max(near, 30) * 1.15) + 2).sort((a, b) => Math.abs(a.minutes - near) - Math.abs(b.minutes - near))[0];
  const easiest = () => input.rides.filter((r) => r.family === 'recovery' && !/openers/i.test(r.name) && r.minutes <= cap + 2).sort((a, b) => b.minutes - a.minutes)[0];
  /** The next free day this week for a ride: allowed, with the hours, and no undone ride already on it. */
  const freeDay = (minutes: number): string | undefined => {
    const end = addDays(t, 7 - ((dowOf(t) + 6) % 7) - 1);   // the week's last day (Sunday)
    for (let d = addDays(t, 1); d <= end; d = addDays(d, 1)) {
      if (input.rideAllowed && !input.rideAllowed(d)) continue;
      if (input.hours && input.hours[dowOf(d)] * 60 < minutes) continue;
      if (input.week.some((s) => s.date === d && s.kind === 'ride' && !s.done)) continue;
      return d;
    }
    return undefined;
  };
  const hand = (s: DaySession) => (s.handPlaced ? { handPlaced: true } : {});
  if (stance === 'lighter') {
    if (!ride) return out;
    const down = DOWN[ride.family ?? ''];
    const w = down ? pick(down, ride.minutes) : undefined;
    if (w && w.id !== ride.id) out.push({ date: t, kind: 'ride', action: 'replace', plannedId: ride.id, workoutId: w.id, before: ride.name, after: w.name, why: reason, ...hand(ride) });
    return out;
  }
  // Easy or rest: a quality ride is kept for later this week if a day can hold it.
  const later = quality ? freeDay(ride!.minutes) : undefined;
  if (stance === 'easy') {
    if (ride && ride.family !== 'recovery') {
      const spin = easiest();
      if (later) {
        out.push({ date: t, kind: 'ride', action: 'move', plannedId: ride.id, toDate: later, before: ride.name, after: ride.name, why: `${reason} ${ride.name} moves to later this week.`, ...hand(ride) });
        if (spin) out.push({ date: t, kind: 'ride', action: 'add', workoutId: spin.id, after: spin.name, why: reason });
      } else if (spin) out.push({ date: t, kind: 'ride', action: 'replace', plannedId: ride.id, workoutId: spin.id, before: ride.name, after: spin.name, why: quality ? `${reason} No day later this week can hold ${ride.name}.` : reason, ...hand(ride) });
    }
    return out;
  }
  // Rest: today is cleared; the quality ride moves when it can.
  for (const s of today) {
    if (s === ride && later) out.push({ date: t, kind: 'ride', action: 'move', plannedId: s.id, toDate: later, before: s.name, after: s.name, why: `${reason} ${s.name} moves to later this week.`, ...hand(s) });
    else out.push({ date: t, kind: s.kind, action: 'remove', plannedId: s.id, before: s.name, why: reason, ...hand(s) });
  }
  return out;
}
