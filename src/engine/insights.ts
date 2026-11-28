import type { Assessment } from './assessment';
import { LIMITER_LABEL } from './assessment';
import { aerobicTrend } from './aerobicTrend';
import { formZone } from './formZones';
import type { Goal } from './goals';
import { addDays } from './load';
import { CURVE_SECONDS, weekStreak, weeklyZones } from './progress';
import { ftpGoal, zoneMix } from './progressMore';
import type { Readiness } from './readiness';
import type { Fitness, Ride, Wellness } from './types';

/**
 * The rules behind Insights (27 Nov 2026). Each question is answered from pieces of evidence, and every piece is
 * built on something the app already works out (the assessment, readiness and its drivers, the fitness series, the
 * per-ride cache, the plan). A piece compares the rider's own numbers across two periods, or against the rider's
 * own normal range, or against a general rule named beside it; it supports the answer, runs contra, or says
 * nothing and is left out. Nothing here compares the rider with other riders.
 *
 * Every threshold is a named constant below, with its basis.
 */

// ---------- the thresholds, each with its basis ----------

/** The two periods compared: six weeks and the six before. Six weeks is the span fitness is averaged over. */
export const SPAN = 42;
/** Readings needed in each period before two averages are compared: a week of them, as readiness needs for a normal. */
export const MIN_READINGS = 7;
/** Two averages differ only when they are further apart than twice the uncertainty of their difference (the usual 95% rule). */
export const SURE = 2;
/** A best effort has moved only when it changes by more than 2%: the accuracy power-meter makers state for their meters. */
export const POWER_MOVED = 0.02;
/** Power at a steady heart rate has moved at 5%: the rule the app's aerobic trend already uses (aerobicTrend.ts, DROP). */
export const AEROBIC_MOVED = 0.05;
/** Health bodies (the World Health Organization, 2020) ask adults for at least 150 minutes of moderate activity a week. */
export const WHO_MINUTES = 150;
/** History needed before "riding enough" is judged: four weeks, the span the assessment averages hours over. */
export const ENOUGH_DAYS = 28;
/** A best effort older than this may understate the rider: it lies outside the six weeks compared. */
export const STALE_DAYS = SPAN;
/** Following a plan: three planned sessions in four done supports; fewer than half runs contra; between says nothing. PROPOSED, for Todd to confirm. */
export const PLAN_DONE = { yes: 0.75, no: 0.5 };
/** Sessions that must have come due before plan-following is judged: six, as the assessment's compliance needs. */
export const PLAN_MIN_SESSIONS = 6;
/** A forecast further off than this many days is never "clear": two weeks, inside which the fitness that will be there is mostly built. */
export const FORECAST_NEAR = 14;
/** Weighings needed in the last four weeks before a weight forecast is made: one a week. */
export const MIN_WEIGHINGS = 4;

// ---------- what an answer is ----------

export type Strength = 'clear' | 'likely' | 'mixed' | 'early';
export type QuestionId = 'fitter' | 'ready' | 'profile' | 'enough' | 'event' | 'goal' | 'plan' | 'mix' | 'health';
export const QUESTIONS: Record<QuestionId, string> = {
  fitter: 'Am I getting fitter?', ready: 'Am I ready to train hard today?', profile: 'What am I good at, and what holds me back?',
  enough: 'Am I riding enough, and regularly?', event: 'Am I on course for my event?', goal: 'Am I on course for my goal?',
  plan: 'Am I following my plan, and is it working?', mix: 'Am I doing the right mix of training?', health: 'Is my health improving?',
};
export const QUESTION_ORDER: QuestionId[] = ['fitter', 'ready', 'profile', 'enough', 'event', 'goal', 'plan', 'mix', 'health'];

export interface Piece {
  id: string;
  /** Which way it points: toward "yes", toward "no", or neither (shown as support for "no change"). */
  points: 'yes' | 'no' | 'level';
  /** How well supported the piece itself is. */
  support: 'good' | 'thin';
  /** Judged from a stand-in (heart rate for power, a morning reading for fitness). */
  indirect?: boolean;
  title: string;
  text: string;
  figure?: { value: string; label: string };
  /** "See the data": a Lab chart or a measure. */
  see?: { chart?: string; measure?: string; label: string };
  /** A measure to draw small beside it, over the two periods. */
  spark?: string;
}

export interface Answer {
  id: QuestionId;
  ask: string;
  strength: Strength;
  /** The answer in a sentence. */
  answer: string;
  /** The reason that follows the strength ("This conclusion is likely, not certain: …"). */
  why: string;
  /** Evidence for the answer given, and against it. */
  supporting: Piece[];
  contra: Piece[];
  /** The one number (or word) on the card. */
  card?: { value: string; label: string };
  /** A measure to draw small on the card. */
  spark?: string;
  /** For "too early": what is needed, and what can be said so far. */
  needs?: string;
  soFar?: string;
  /** One thing to do, where there is one. */
  act?: { title: string; text: string; href?: string; label?: string };
  related: QuestionId[];
  /** A line under the answer that must always be read with it (health). */
  caution?: string;
}

/** A question that is not shown as a card, with the reason listed at the foot. */
export interface NotShown { id: QuestionId; ask: string; reason: string }

export const STRENGTH_SENTENCE: Record<Strength, string> = {
  clear: 'This conclusion is clear:', likely: 'This conclusion is likely, not certain:', mixed: 'The evidence is mixed:', early: 'It is too early to conclude:',
};
export const STRENGTH_WORD: Record<Strength, string> = { clear: 'clear', likely: 'likely', mixed: 'mixed', early: 'too early' };
/** Bars lit on the three-bar meter. */
export const STRENGTH_BARS: Record<Strength, number> = { clear: 3, likely: 2, mixed: 1, early: 0 };

// ---------- the general rules ----------

const good = (ps: Piece[], way: Piece['points']) => ps.filter((p) => p.points === way && p.support === 'good');
const all = (ps: Piece[], way: Piece['points']) => ps.filter((p) => p.points === way);

export interface Verdict { strength: Strength; lean: 'yes' | 'no' | 'level'; why: string }

/**
 * The strength of a conclusion from its pieces.
 *  - Mixed: at least one well-supported piece each way.
 *  - Clear: two or more well-supported pieces the same way, and none contra.
 *  - Likely: it points one way, but on one well-supported piece, or on thin or indirect ones, or with a thin piece contra.
 *  - With nothing pointing either way, the answer is "no change": clear on two well-supported level pieces, else likely.
 */
export function judge(pieces: Piece[]): Verdict {
  const gy = good(pieces, 'yes'), gn = good(pieces, 'no'), ay = all(pieces, 'yes'), an = all(pieces, 'no');
  if (gy.length && gn.length) return { strength: 'mixed', lean: 'yes', why: 'well-supported evidence points both ways, so both are shown.' };
  if (!ay.length && !an.length) {
    const gl = good(pieces, 'level');
    return gl.length >= 2 ? { strength: 'clear', lean: 'level', why: `${count(gl.length)} separate pieces of evidence show no change beyond your normal variation.` }
      : { strength: 'likely', lean: 'level', why: 'nothing has moved beyond your normal variation, but there is little evidence to go on.' };
  }
  const lean: 'yes' | 'no' = gy.length ? 'yes' : gn.length ? 'no' : ay.length >= an.length ? 'yes' : 'no';
  const lead = lean === 'yes' ? ay : an, leadGood = lean === 'yes' ? gy : gn, other = lean === 'yes' ? an : ay;
  const direct = leadGood.filter((p) => !p.indirect);
  if (leadGood.length >= 2 && direct.length >= 1 && !other.length) return { strength: 'clear', lean, why: `${count(leadGood.length)} separate pieces of evidence agree, and nothing points the other way.` };
  const reasons: string[] = [];
  if (other.length) reasons.push(`${other.length === 1 ? 'one piece' : `${count(other.length).toLowerCase()} pieces`} of thinner evidence point${other.length === 1 ? 's' : ''} the other way`);
  if (!leadGood.length) reasons.push('the evidence for it is thin');
  else if (!direct.length) reasons.push('it is judged indirectly');
  else if (leadGood.length === 1 && lead.length === 1) reasons.push('it rests on one piece of evidence');
  else if (leadGood.length === 1) reasons.push('only one piece of the evidence is well supported');
  return { strength: 'likely', lean, why: `${reasons.join(', and ')}.` };
}
const count = (n: number) => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][n] ?? String(n);

/** Whether two sets of readings differ by more than their own scatter allows: the difference against twice its uncertainty. */
export function compare(earlier: number[], recent: number[]): { diff: number; moved: boolean; enough: boolean; a: number; b: number } {
  const m = (l: number[]) => l.reduce((x, y) => x + y, 0) / l.length;
  const enough = earlier.length >= MIN_READINGS && recent.length >= MIN_READINGS;
  if (!earlier.length || !recent.length) return { diff: 0, moved: false, enough: false, a: 0, b: 0 };
  const a = m(earlier), b = m(recent);
  const v = (l: number[], mu: number) => (l.length > 1 ? l.reduce((x, y) => x + (y - mu) ** 2, 0) / (l.length - 1) : 0);
  const se = Math.sqrt(v(earlier, a) / earlier.length + v(recent, b) / recent.length);
  return { diff: b - a, moved: enough && Math.abs(b - a) > SURE * se && Math.abs(b - a) > 0, enough, a, b };
}

// ---------- what the rules read ----------

export interface InsightCurve { id: string; date: string; w?: number[]; steadyAtHr?: { watts: number; seconds: number }; lthrAtBuild?: number; late?: { b5?: number; a5?: number; b20?: number; a20?: number } }
export interface InsightPlan { goal: Goal; start: string; goalDate: string; requiredCtl: number; projection: Fitness[]; name?: string }

export interface InsightFacts {
  today: string;
  rides: Ride[];
  wellness: Wellness[];
  /** The fitness series, a day each, to today. */
  series: Fitness[];
  assessment: Assessment;
  /** Today's readiness, as Today shows it. */
  readiness?: Readiness;
  curves: InsightCurve[];
  tests: Array<{ date: string; vo2?: number; vt1?: number; vt2?: number }>;
  /** FTP on record by day. */
  ftpHistory: Array<{ date: string; ftp: number }>;
  ftp?: number;
  lthr?: number;
  plan?: InsightPlan | null;
  /** Sessions a plan put on the calendar. */
  planned: Array<{ date: string; status: string }>;
  weekStartOf: (d: string) => string;
  pounds?: boolean;
}

const pos = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0;
const r0 = (v: number) => Math.round(v);
const sgn = (v: number, d = 0) => { const r = Math.round(v * 10 ** d) / 10 ** d; return r > 0 ? `+${r.toFixed(d)}` : r < 0 ? `−${Math.abs(r).toFixed(d)}` : '0'; };
const hm = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const daysApart = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const hasPower = (f: InsightFacts) => f.rides.some((r) => r.sport === 'ride' && !!(r.normalizedPower || r.averagePower));
const fitnessOn = (f: InsightFacts, d: string) => f.series.find((s) => s.date === d);
const firstDay = (f: InsightFacts) => f.rides.reduce((m, r) => (r.date < m ? r.date : m), f.today);
const bestIn = (f: InsightFacts, seconds: number, from: string, to: string) => {
  const k = CURVE_SECONDS.indexOf(seconds); let v = 0, d = '';
  for (const c of f.curves) if (c.date >= from && c.date <= to && (c.w?.[k] ?? 0) > v) { v = c.w![k]; d = c.date; }
  return { v, d };
};
/** How far fitness usually moves in a week for this rider: the typical size of a 7-day change over the twelve weeks to today. */
export function usualWeeklyMove(series: Fitness[], today: string): number {
  const by = new Map(series.map((s) => [s.date, s.ctl]));
  const moves: number[] = [];
  for (let d = addDays(today, -83); d <= today; d = addDays(d, 1)) { const a = by.get(addDays(d, -7)), b = by.get(d); if (a != null && b != null) moves.push(Math.abs(b - a)); }
  return moves.length ? moves.reduce((x, y) => x + y, 0) / moves.length : 0;
}
/** Fitness is shown as a whole number, so a change that would not show in it is no change, however steady the rider. */
export const FITNESS_FLOOR = 1;
const fitnessMove = (series: Fitness[], today: string) => Math.max(FITNESS_FLOOR, usualWeeklyMove(series, today));
const early = (id: QuestionId, needs: string, soFar: string, related: QuestionId[], card?: Answer['card']): Answer =>
  ({ id, ask: QUESTIONS[id], strength: 'early', answer: 'Too early to say.', why: needs, supporting: [], contra: [], needs, soFar, related, card });
/** The pieces for the answer given and those against it. A piece that says nothing is shown only when the answer is "no change". */
const split = (pieces: Piece[], lean: Verdict['lean']) => ({
  supporting: pieces.filter((p) => p.points === lean),
  contra: pieces.filter((p) => lean !== 'level' && p.points !== lean && p.points !== 'level'),
});
const wellIn = (f: InsightFacts, get: (w: Wellness) => number | undefined, from: string, to: string) => f.wellness.filter((w) => w.date >= from && w.date <= to).map(get).filter(pos);

// ---------- Am I getting fitter? ----------

export function fitter(f: InsightFacts): Answer {
  const t = f.today, mid = addDays(t, -SPAN), far = addDays(t, -2 * SPAN);
  const now = f.series[f.series.length - 1], then = fitnessOn(f, mid);
  const span = daysApart(firstDay(f), t), n = f.rides.length;
  if (!now || !then || span < SPAN || n < 6) {
    return early('fitter', `Antogo needs six weeks of training on record, with at least six activities, to compare one six weeks with the last. You have ${n} ${n === 1 ? 'activity' : 'activities'} over ${Math.max(0, span) + (n ? 1 : 0)} days.`,
      now && n ? `Your fitness figure today is ${r0(now.ctl)}. It will mean more once there is something to set it against.` : 'Nothing is recorded yet.', ['enough', 'ready'], now && n ? { value: `${r0(now.ctl)}`, label: 'fitness so far' } : undefined);
  }
  const pieces: Piece[] = [];
  const power = hasPower(f);
  // 1. Fitness against six weeks ago, measured against how far it usually moves in a week.
  const move = fitnessMove(f.series, t), d = now.ctl - then.ctl;
  const ridesIn = f.rides.filter((r) => r.date > mid).length;
  pieces.push({
    id: 'fitness', points: Math.abs(d) <= move ? 'level' : d > 0 ? 'yes' : 'no', support: ridesIn >= 10 ? 'good' : 'thin', indirect: !power,
    title: Math.abs(d) <= move ? 'Your fitness is level.' : d > 0 ? `Your fitness is up ${r0(d)} in six weeks.` : `Your fitness is down ${r0(-d)} in six weeks.`,
    text: `It was ${r0(then.ctl)} on ${day(mid)} and is ${r0(now.ctl)} today. For you it usually moves about ${move.toFixed(1)} in a week, so ${Math.abs(d) <= move ? 'this is inside your normal variation' : 'this is a real change'}.${power ? '' : ' Without a power meter it is worked out from heart rate.'}`,
    figure: { value: `${r0(now.ctl)}`, label: `was ${r0(then.ctl)}` }, see: { chart: 'fitness', label: 'fitness, fatigue and form' }, spark: 'fitness',
  });
  // 2. Best 20 minutes, the last six weeks against the six before.
  if (power) {
    const a = bestIn(f, 1200, addDays(far, 1), mid), b = bestIn(f, 1200, addDays(mid, 1), t);
    if (a.v && b.v) {
      const ch = (b.v - a.v) / a.v;
      pieces.push({
        id: 'best20', points: Math.abs(ch) <= POWER_MOVED ? 'level' : ch > 0 ? 'yes' : 'no', support: 'good',
        title: Math.abs(ch) <= POWER_MOVED ? 'Your best 20 minutes is unchanged.' : `Your best 20 minutes ${ch > 0 ? 'rose' : 'fell'} by ${r0(Math.abs(b.v - a.v))} W.`,
        text: `${r0(a.v)} W in the six weeks to ${day(mid)}, ${r0(b.v)} W since, set on ${day(b.d)}. A change of 2% or less is within what a power meter can tell apart.${ch < -POWER_MOVED ? ' A lower best can also mean you have not gone all-out for 20 minutes lately.' : ''}`,
        figure: { value: `${r0(b.v)} W`, label: `was ${r0(a.v)} W` }, see: { chart: 'power', label: 'the power curve' }, spark: 'best20m',
      });
    }
    // 3. Power at a steady heart rate: the app's own aerobic trend.
    const tr = aerobicTrend(f.curves, f.lthr ?? 0, t);
    if (tr.recent != null && tr.earlier != null) {
      const ch = (tr.recent - tr.earlier) / tr.earlier;
      pieces.push({
        id: 'steady', points: ch >= AEROBIC_MOVED ? 'yes' : ch <= -AEROBIC_MOVED ? 'no' : 'level', support: 'good',
        title: ch >= AEROBIC_MOVED ? 'The same heart rate now gives you more power.' : ch <= -AEROBIC_MOVED ? 'The same heart rate now gives you less power.' : 'Power at a steady heart rate is unchanged.',
        text: `With your heart at 70 to 80% of threshold you rode at about ${tr.earlier} W six weeks back and ${tr.recent} W in the last three weeks counted. A move of 5% either way counts.`,
        figure: { value: `${tr.recent} W`, label: `was ${tr.earlier} W` }, see: { measure: 'steadyPower', label: 'power at a steady heart rate' }, spark: 'steadyPower',
      });
    }
  }
  // 4. Breathing thresholds, when tests have read them more than once.
  for (const [key, name] of [['vt1', 'first'], ['vt2', 'second']] as const) {
    const ts = f.tests.filter((x) => pos(x[key])).sort((x, y) => x.date.localeCompare(y.date));
    if (ts.length < 2 || ts[ts.length - 1].date < far) continue;
    const a = ts[ts.length - 2][key]!, b = ts[ts.length - 1][key]!, ch = (b - a) / a;
    if (Math.abs(ch) <= POWER_MOVED) continue;
    pieces.push({ id: key, points: ch > 0 ? 'yes' : 'no', support: 'good', title: `Your ${name} breathing threshold moved ${ch > 0 ? 'up' : 'down'}.`, text: `From ${r0(a)} W on ${day(ts[ts.length - 2].date)} to ${r0(b)} W on ${day(ts[ts.length - 1].date)}. This is measured from your breathing, not worked out from power.`, figure: { value: `${r0(b)} W`, label: `was ${r0(a)} W` }, see: { chart: 'breathing', label: 'breathing across the season' }, spark: key });
  }
  // 5. Resting heart rate: a morning reading, so indirect.
  const rhr = compare(wellIn(f, (w) => w.restingHr, addDays(far, 1), mid), wellIn(f, (w) => w.restingHr, addDays(mid, 1), t));
  if (rhr.enough && rhr.moved) pieces.push({ id: 'rhr', points: rhr.diff < 0 ? 'yes' : 'no', support: 'good', indirect: true, title: `Your resting heart rate is ${rhr.diff < 0 ? 'lower' : 'higher'}.`, text: `It averaged ${rhr.a.toFixed(0)} in the six weeks to ${day(mid)} and ${rhr.b.toFixed(0)} since: more than your mornings vary by chance. A slower resting heart usually goes with a fitter one, though sleep, heat and illness move it too.`, figure: { value: `${rhr.b.toFixed(0)} bpm`, label: `was ${rhr.a.toFixed(0)}` }, see: { chart: 'recovery', label: 'recovery' }, spark: 'restingHr' });

  const v = judge(pieces);
  const { supporting, contra } = split(pieces, v.lean);
  const answer = v.strength === 'mixed' ? 'Partly. Some signs are up and some are down.' : v.lean === 'yes' ? (v.strength === 'clear' ? 'Yes. You are fitter than six weeks ago.' : 'Probably. The signs point up.') : v.lean === 'no' ? (v.strength === 'clear' ? 'No. You have lost some fitness in six weeks.' : 'Probably not. The signs point down.') : 'You are holding steady.';
  const why = v.strength === 'likely' && !power && v.lean !== 'level' ? `${v.why.replace(/\.$/, '')}. You ride without a power meter, so Antogo judges from heart rate, which heat, hills and tiredness blur.` : v.why;
  return {
    id: 'fitter', ask: QUESTIONS.fitter, strength: v.strength, answer, why, supporting, contra,
    card: { value: `${r0(now.ctl)}`, label: `fitness · ${Math.abs(d) < 1 ? 'level' : `${d > 0 ? 'up' : 'down'} ${r0(Math.abs(d))}`} in six weeks` }, spark: 'fitness',
    act: v.lean === 'no' ? { title: 'Put the regular weeks back.', text: 'Fitness follows steady weeks more than any single hard ride.', href: '#/calendar', label: 'Open the calendar' } : v.lean === 'yes' ? { title: 'Keep the weeks steady.', text: 'What you have been doing is working.' } : undefined,
    related: ['enough', f.plan ? 'plan' : 'mix', 'profile'],
  };
}

// ---------- Am I ready to train hard today? ----------

export function ready(f: InsightFacts): Answer {
  const now = f.series[f.series.length - 1], r = f.readiness;
  const loadDays = new Set(f.rides.filter((x) => (x.tss ?? 0) > 0).map((x) => x.date)).size;
  if (!now || !r || loadDays < 7) return early('ready', `Antogo needs a week of training on record before form means anything, and a week of overnight readings before it knows your normal. You have ${loadDays} ${loadDays === 1 ? 'day' : 'days'} of training.`, 'Until then, go by how you feel.', ['enough', 'fitter']);
  const z = formZone(now.tsb);
  const pieces: Piece[] = [{
    id: 'form', points: z.id === 'much' ? 'no' : 'yes', support: 'good', title: `Your form is ${sgn(now.tsb)}: ${z.name.toLowerCase()}.`,
    text: `Form is fitness less fatigue. In this zone ${z.says}. ${z.id === 'much' ? 'Hard work on top of this much fatigue is more likely to dig a hole than to build.' : z.id === 'building' ? 'That is normal while building, and no bar to a hard session.' : 'Nothing in your training load argues against a hard session.'}`,
    figure: { value: sgn(now.tsb), label: z.name }, see: { chart: 'fitness', label: 'fitness, fatigue and form' }, spark: 'form',
  }];
  for (const dr of r.drivers) {
    if (dr.name === 'Form') continue;
    const overnight = dr.normal != null;
    if (dr.effect === 'flat' && !overnight) continue;
    pieces.push({
      id: `d-${dr.name}`, points: dr.effect === 'down' ? 'no' : 'yes', support: (dr.days ?? 0) >= 14 || !overnight ? 'good' : 'thin',
      title: overnight ? `${dr.name}: ${dr.effect === 'down' ? 'worse than' : dr.effect === 'up' ? 'better than' : 'inside'} your normal${dr.effect === 'flat' ? ' range' : ''}.` : `${dr.name}: ${dr.value}.`,
      text: overnight ? `${dr.today}${dr.unit ? ` ${dr.unit}` : ''} this morning against a normal of ${dr.normal}${dr.unit ? ` ${dr.unit}` : ''}, from ${dr.days} mornings.${dr.note ? ` ${dr.note}` : ''}` : (dr.note ?? dr.value),
      figure: overnight ? { value: `${dr.today}${dr.unit ? ` ${dr.unit}` : ''}`, label: `normal ${dr.normal}` } : undefined, see: { chart: overnight ? 'recovery' : 'fitness', label: overnight ? 'recovery' : 'fitness, fatigue and form' },
    });
  }
  const v = judge(pieces);
  const yes = r.band === 'go' || r.band === 'ease';
  const lean: 'yes' | 'no' = yes ? 'yes' : 'no';
  const { supporting, contra } = split(pieces, lean);
  // The answer follows the readiness score the Today page shows; the strength says how far the pieces agree with it.
  let strength: Strength = contra.some((p) => p.support === 'good') && supporting.some((p) => p.support === 'good') ? 'mixed' : v.strength === 'mixed' ? 'mixed' : supporting.filter((p) => p.support === 'good').length >= 2 && !contra.length ? 'clear' : 'likely';
  let why = strength === 'mixed' ? 'your readings point both ways, so both are shown.' : strength === 'clear' ? 'your training load and this morning’s readings agree.' : v.why;
  if (r.formOnly || pieces.length === 1) { strength = 'likely'; why = 'it rests on your training load alone. There are no overnight readings this morning to confirm it.'; }
  else if (r.missing.length && strength === 'clear') { strength = 'likely'; why = `${r.missing.join(' and ')} ${r.missing.length === 1 ? 'has' : 'have'} not arrived this morning, so part of the usual picture is missing.`; }
  const answer = { go: 'Yes. You are ready for a hard session.', ease: 'Yes, with care. Keep the hard part controlled.', easy: 'Not today. An easy day will serve you better.', rest: 'No. Today is a day to rest.' }[r.band];
  return {
    id: 'ready', ask: QUESTIONS.ready, strength, answer, why, supporting, contra,
    card: { value: `${r.score}`, label: `readiness · form ${sgn(now.tsb)}, ${z.name.toLowerCase()}` }, spark: 'form',
    act: { title: yes ? 'A hard session is on the table.' : 'Keep today easy.', text: 'Today has what is planned, and what Antogo recommends for it.', href: '#/today', label: 'Open Today' },
    related: ['fitter', 'health'],
  };
}

// ---------- What am I good at, and what holds me back? ----------

/** The assessment's own limiter lines, as the plan uses them (assessment.ts): the multiple of FTP below which an effort is a limiter. */
const PROFILE: Array<{ key: 'p1m' | 'p5m' | 'p20m'; seconds: number; name: string; line: number; limiter: string }> = [
  { key: 'p1m', seconds: 60, name: '1-minute power', line: 1.4, limiter: 'anaerobic' },
  { key: 'p5m', seconds: 300, name: '5-minute power', line: 1.12, limiter: 'vo2max' },
  { key: 'p20m', seconds: 1200, name: '20-minute power', line: 1.02, limiter: 'threshold' },
];

export function profile(f: InsightFacts): Answer | NotShown {
  if (!hasPower(f)) return { id: 'profile', ask: QUESTIONS.profile, reason: 'It needs a power meter: strengths and limiters are read from your best efforts at different lengths.' };
  const a = f.assessment, pp = a.powerProfile;
  if (pp.confidence === 'none' || !pos(f.ftp)) return early('profile', 'Antogo needs your best efforts at several lengths, from rides with a power meter, and an FTP to measure them against.', 'Your rides are still being read, or none has power yet.', ['fitter', 'enough']);
  const t = f.today, pieces: Piece[] = [];
  const rows = PROFILE.map((p) => ({ ...p, x: pp.value[p.key], when: bestIn(f, p.seconds, addDays(t, -365), t).d })).filter((p) => p.x > 0);
  const strong = [...rows].sort((x, y) => y.x / y.line - x.x / x.line)[0];
  const weak = rows.filter((p) => p.x < p.line).sort((x, y) => x.x / x.line - y.x / y.line);
  for (const p of rows) {
    const below = p.x < p.line, stale = p.when && daysApart(p.when, t) > STALE_DAYS;
    pieces.push({
      id: p.key, points: below ? 'yes' : 'level', support: pp.confidence === 'good' && !stale ? 'good' : 'thin',
      title: below ? `${p.name} is below the line.` : `${p.name} is not holding you back.`,
      text: `Your best is ${p.x.toFixed(2)} times your FTP${p.when ? `, set on ${day(p.when)}` : ''}. Antogo’s plans treat anything under ${p.line.toFixed(2)} times as a limiter.${stale && below ? ` That best is more than six weeks old, so it may understate you: one all-out effort of that length would settle it.` : ''}`,
      figure: { value: `×${p.x.toFixed(2)}`, label: `line ×${p.line.toFixed(2)}` }, see: { chart: 'records', label: 'records' },
    });
  }
  if (a.decoupling.confidence !== 'none') {
    const dv = a.decoupling.value, lim = dv > 6;
    pieces.push({ id: 'drift', points: lim ? 'yes' : 'level', support: a.decoupling.confidence === 'good' ? 'good' : 'thin', title: lim ? 'Your heart rate drifts up on long rides.' : 'You hold steady on long rides.', text: a.decoupling.note, figure: { value: `${dv}%`, label: 'heart-rate drift' }, see: { measure: 'drift', label: 'heart-rate drift' }, spark: 'drift' });
  }
  if (a.weeklyHours.confidence !== 'none' && a.weeklyHours.value < 5) pieces.push({ id: 'hours', points: 'yes', support: a.weeklyHours.confidence === 'good' ? 'good' : 'thin', title: 'Your riding hours limit your base.', text: `${a.weeklyHours.note} Antogo’s plans treat under five hours a week as a limit on aerobic base.`, figure: { value: `${a.weeklyHours.value} h`, label: 'a week' }, see: { measure: 'weekRideHours', label: 'hours ridden' }, spark: 'weekRideHours' });
  const lims = pieces.filter((p) => p.points === 'yes');
  const stale = lims.some((p) => p.support === 'thin');
  const strength: Strength = !lims.length ? (pieces.every((p) => p.support === 'good') && pieces.length >= 2 ? 'clear' : 'likely') : stale ? 'likely' : lims.length >= 1 && pieces.filter((p) => p.support === 'good').length >= 2 ? 'clear' : 'likely';
  const first = a.limiters[0];
  const limWord = lims.length ? LIMITER_LABEL[first] : '';
  return {
    id: 'profile', ask: QUESTIONS.profile, strength,
    answer: lims.length ? `${strong && strong.x >= strong.line ? `Your ${strong.name} is your strongest suit. ` : ''}What holds you back most is ${limWord}.` : `Nothing stands out as holding you back.${strong ? ` Your ${strong.name} is your strongest suit.` : ''}`,
    why: strength === 'clear' ? 'each effort is measured against your own FTP, on recent bests.' : stale ? 'a limiter rests on a best effort more than six weeks old, or on few rides, so it may understate you.' : 'there are few recent best efforts to judge from.',
    supporting: [...lims, ...pieces.filter((p) => p.points === 'level')], contra: [],
    card: weak[0] ? { value: `×${weak[0].x.toFixed(2)}`, label: `${weak[0].name} against FTP · line ×${weak[0].line.toFixed(2)}` } : strong ? { value: `×${strong.x.toFixed(2)}`, label: `${strong.name} against FTP` } : undefined,
    act: lims.length ? { title: stale ? 'Test it before you train it.' : `Train ${limWord}.`, text: stale ? 'One all-out effort at that length will show whether this is a real limiter.' : 'Plan my training builds around your limiter when you make a plan.', href: '#/plan', label: 'Open Plan' } : undefined,
    related: ['fitter', f.plan ? 'plan' : 'mix'],
  };
}

// ---------- Am I riding enough, and regularly? ----------

export function enough(f: InsightFacts): Answer {
  const t = f.today, span = daysApart(firstDay(f), t) + 1, n = f.rides.length;
  if (!n || span < ENOUGH_DAYS) return early('enough', `Antogo needs four weeks on record to judge a habit. You have ${n} ${n === 1 ? 'activity' : 'activities'} over ${n ? span : 0} ${span === 1 ? 'day' : 'days'}.`, n ? `So far: ${hm(f.rides.reduce((s, r) => s + r.seconds, 0) / 3600)} of activity.` : 'Nothing is recorded yet.', ['fitter', 'ready'], n ? { value: `${n}`, label: n === 1 ? 'activity so far' : 'activities so far' } : undefined);
  const last4 = f.rides.filter((r) => r.date > addDays(t, -28));
  const mins = last4.reduce((s, r) => s + r.seconds, 0) / 60 / 4;
  const pieces: Piece[] = [{
    id: 'who', points: mins >= WHO_MINUTES ? 'yes' : 'no', support: 'good', title: mins >= WHO_MINUTES ? 'You do more than health guidelines ask.' : 'You do less than health guidelines ask.',
    text: `${hm(mins / 60)} of activity a week over the last four weeks, every kind together. The World Health Organization asks adults for at least 150 minutes a week.`,
    figure: { value: hm(mins / 60), label: 'a week' }, see: { measure: 'weekHours', label: 'hours trained, each week' }, spark: 'weekHours',
  }];
  // Blank weeks among the last six complete ones: the span fitness is averaged over.
  const ws = f.weekStartOf(t), active = new Set(f.rides.map((r) => f.weekStartOf(r.date)));
  const weeks = [1, 2, 3, 4, 5, 6].map((k) => addDays(ws, -7 * k)).filter((w) => w >= f.weekStartOf(firstDay(f)));
  const blank = weeks.filter((w) => !active.has(w)).length, streak = weekStreak(f.rides, t, f.weekStartOf);
  if (weeks.length >= 4) pieces.push({
    id: 'regular', points: blank === 0 ? 'yes' : blank >= 2 ? 'no' : 'level', support: weeks.length >= 6 ? 'good' : 'thin',
    title: blank === 0 ? `${count(streak)} week${streak === 1 ? '' : 's'} in a row without a blank one.` : `${count(blank)} blank week${blank === 1 ? '' : 's'} in the last ${weeks.length}.`,
    text: blank === 0 ? 'Every one of the last six weeks has training in it. Six weeks is the span your fitness is averaged over, so a blank week inside it always shows.' : `A week with nothing in it pulls fitness down for the six weeks that follow. ${blank === 1 ? 'One is easily absorbed.' : 'Two or more is a pattern.'}`,
    figure: { value: `${streak}`, label: streak === 1 ? 'week in a row' : 'weeks in a row' }, see: { chart: 'year', label: 'the year in days' }, spark: 'weekDays',
  });
  const v = judge(pieces);
  const { supporting, contra } = split(pieces, v.lean);
  const rides4 = last4.filter((r) => r.sport === 'ride').length;
  return {
    id: 'enough', ask: QUESTIONS.enough, strength: v.strength, why: v.strength === 'clear' ? 'this is a count of what you did. There is nothing to estimate.' : v.why, supporting, contra,
    answer: v.strength === 'mixed' ? (mins >= WHO_MINUTES ? 'Enough, but not regularly.' : 'Regularly, but not much.') : v.lean === 'yes' ? (blank === 0 && weeks.length >= 4 ? `Yes. ${count(streak)} week${streak === 1 ? '' : 's'} without a miss.` : 'Yes.') : v.lean === 'no' ? 'Not yet.' : 'About enough.',
    card: { value: hm(mins / 60), label: `a week · ${(rides4 / 4).toFixed(1).replace(/\.0$/, '')} rides` }, spark: 'weekHours',
    act: v.lean === 'no' || v.strength === 'mixed' ? { title: 'Put the next two weeks on the calendar.', text: 'A habit is easier to keep when the days are chosen ahead.', href: '#/calendar', label: 'Open the calendar' } : undefined,
    related: ['fitter', f.plan ? 'plan' : 'mix'],
  };
}

// ---------- Am I on course for my event? ----------

/** Fitness the plan expected on a day, from the line it kept when it was built. */
const expected = (plan: InsightPlan, d: string) => { let v: Fitness | undefined; for (const p of plan.projection) if (p.date <= d && (!v || p.date > v.date)) v = p; return v; };
const cap = (v: Verdict, far: boolean): Verdict => (far && v.strength === 'clear' ? { ...v, strength: 'likely', why: 'this is a forecast, and a forecast is a range. The evidence so far agrees, but the day is still some way off.' } : v);

export function event(f: InsightFacts): Answer | undefined {
  const plan = f.plan;
  if (!plan || plan.goal.kind !== 'event') return undefined;
  const t = f.today, now = f.series[f.series.length - 1], left = daysApart(t, plan.goalDate);
  const name = plan.goal.name || 'your event';
  if (left < 0) return undefined;
  const exp = expected(plan, t), end = plan.projection[plan.projection.length - 1];
  if (!now || !exp || !end) return early('event', 'Antogo needs the fitness line your plan was built on. A plan made before plans kept that line has none until it is next rebuilt.', `${name} is ${left} days away.`, ['plan', 'fitter']);
  const move = fitnessMove(f.series, t), gap = now.ctl - exp.ctl, pieces: Piece[] = [];
  pieces.push({ id: 'online', points: gap >= -move ? 'yes' : 'no', support: daysApart(plan.start, t) >= 14 ? 'good' : 'thin', title: gap >= -move ? 'Your fitness is where the plan expected.' : 'Your fitness is behind the plan’s line.', text: `The plan expected ${r0(exp.ctl)} today; you are at ${r0(now.ctl)}. A gap smaller than your usual weekly movement (${move.toFixed(1)}) is not a gap.`, figure: { value: `${r0(now.ctl)}`, label: `plan expected ${r0(exp.ctl)}` }, see: { chart: 'fitness', label: 'fitness, fatigue and form' }, spark: 'fitness' });
  if (plan.requiredCtl > 0) {
    const forecast = end.ctl + gap;
    pieces.push({ id: 'needed', points: forecast >= plan.requiredCtl ? 'yes' : 'no', support: 'good', title: forecast >= plan.requiredCtl ? `The plan leads to the fitness ${name} needs.` : `The plan stops short of what ${name} needs.`, text: `${name} wants fitness of about ${plan.requiredCtl}, the level at which the day is hard but finished well. Carried forward from where you are, the plan reaches about ${r0(forecast)} by ${day(end.date)}.`, figure: { value: `${r0(forecast)}`, label: `needs ${plan.requiredCtl}` }, see: { chart: 'fitness', label: 'fitness, fatigue and form' } });
  }
  const need = (f.assessment.longestRide.value ?? 0);
  if (need > 0) pieces.push({ id: 'longest', points: 'level', support: 'thin', title: `Your longest ride in eight weeks is ${hm(need / 3600)}.`, text: 'The plan lengthens the long ride toward the event. This is where it stands.', figure: { value: hm(need / 3600), label: 'longest ride' }, see: { measure: 'longest', label: 'longest ride, each week' }, spark: 'longest' });
  const v = cap(judge(pieces), left > FORECAST_NEAR);
  const { supporting, contra } = split(pieces, v.lean === 'level' ? 'yes' : v.lean);
  return {
    id: 'event', ask: QUESTIONS.event, strength: v.strength, why: v.why, supporting: v.lean === 'level' ? pieces : [...supporting, ...pieces.filter((p) => p.points === 'level')], contra,
    answer: v.strength === 'mixed' ? 'Partly. On the plan’s line, but the line stops short.' : v.lean === 'no' ? 'Not as things stand.' : v.strength === 'clear' ? 'Yes. You are on course.' : 'Probably. You are on course so far.',
    card: { value: `${left}`, label: `days to ${name} · fitness ${r0(now.ctl)}${plan.requiredCtl ? `, needs ${plan.requiredCtl}` : ''}` }, spark: 'fitness',
    act: { title: v.lean === 'no' ? 'Check the plan.' : 'Protect the long ride each week.', text: v.lean === 'no' ? 'Check the plan rebuilds it from where you are today.' : 'It is the session an event depends on most.', href: '#/plan', label: 'Open Plan' },
    related: ['plan', 'fitter'],
  };
}

// ---------- Am I on course for my goal? ----------

export function goal(f: InsightFacts): Answer | NotShown | undefined {
  const plan = f.plan;
  if (!plan || plan.goal.kind === 'event') return undefined;
  const g = plan.goal, t = f.today, left = daysApart(t, plan.goalDate);
  if (g.kind === 'general') return { id: 'goal', ask: QUESTIONS.goal, reason: 'Your goal is general fitness, which has no finish line to be on course for. “Am I getting fitter?” answers it.' };
  if (left < 0) return undefined;
  const far = left > FORECAST_NEAR;
  if (g.kind === 'ftp') {
    if (!pos(f.ftp) || !(g.targetWatts > 0)) return early('goal', 'Antogo needs your FTP and a target to measure between. A fitness test sets the first.', 'Your goal is a higher FTP.', ['fitter', 'plan']);
    const r = ftpGoal(f.ftpHistory, t, f.ftp, g.targetWatts, plan.goalDate);
    if (!r.verdict) return early('goal', 'Antogo needs two FTP values on record in the last sixteen weeks to see your own rate of gain. A fitness test gives one.', `Your FTP is ${f.ftp} W and the target ${g.targetWatts} W: ${r.needed} W to find in ${left} days.`, ['fitter', 'plan'], { value: `${f.ftp} W`, label: `goal ${g.targetWatts} W` });
    const p: Piece = { id: 'rate', points: r.verdict === 'behind' ? 'no' : 'yes', support: 'good', title: r.needed === 0 ? 'You have reached your target.' : `You are ${r.verdict === 'on track' ? 'gaining at about the rate needed' : r.verdict === 'ahead' ? 'gaining faster than needed' : 'gaining more slowly than needed'}.`, text: r.needed === 0 ? `Your FTP is ${f.ftp} W against a target of ${g.targetWatts} W.` : `${r.needed} W still to find in ${left} days is ${r.neededPerWeek} W a week. Over the last twelve weeks your FTP has moved ${sgn(r.ownPerWeek ?? 0, 1)} W a week.`, figure: { value: `${f.ftp} W`, label: `goal ${g.targetWatts} W` }, see: { measure: 'ftp', label: 'FTP' }, spark: 'ftp' };
    const v = cap(judge([p]), far && r.needed > 0);
    return { id: 'goal', ask: QUESTIONS.goal, strength: r.needed === 0 ? 'clear' : v.strength, why: r.needed === 0 ? 'the target is met.' : `${v.why.replace(/\.$/, '')}. FTP moves in steps, when a test or a hard ride shows it.`, answer: r.needed === 0 ? 'Yes. You are there.' : p.points === 'yes' ? 'Probably. Your FTP is rising fast enough.' : 'Not at the present rate.', supporting: p.points === 'yes' ? [p] : [], contra: p.points === 'no' ? [p] : [], card: { value: `${f.ftp} W`, label: `goal ${g.targetWatts} W by ${day(plan.goalDate)}` }, spark: 'ftp', related: ['fitter', 'plan', 'profile'] };
  }
  if (g.kind === 'weight') {
    const k = f.pounds ? 2.20462 : 1, u = f.pounds ? 'lb' : 'kg';
    const ws = f.wellness.filter((w) => pos(w.weightKg)).sort((a, b) => a.date.localeCompare(b.date));
    const recent = ws.filter((w) => w.date > addDays(t, -28));
    if (recent.length < MIN_WEIGHINGS || !g.targetKg) return early('goal', g.targetKg ? `Antogo needs at least four weighings in the last four weeks to see a trend. You have ${recent.length}.` : 'Your weight goal has no target weight. Set one in Plan and Antogo can measure toward it.', ws.length ? `Your newest weighing is ${(ws[ws.length - 1].weightKg! * k).toFixed(1)} ${u}.` : 'No weighings are on record yet.', ['health', 'enough'], ws.length ? { value: `${(ws[ws.length - 1].weightKg! * k).toFixed(1)} ${u}`, label: g.targetKg ? `goal ${(g.targetKg * k).toFixed(1)} ${u}` : 'newest weighing' } : undefined);
    const avg = (from: string, to: string) => { const l = ws.filter((w) => w.date > from && w.date <= to).map((w) => w.weightKg!); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : undefined; };
    const nowKg = avg(addDays(t, -7), t) ?? ws[ws.length - 1].weightKg!;
    const before = ws.filter((w) => w.date > addDays(t, -56) && w.date <= addDays(t, -28)).map((w) => w.weightKg!);
    const c = compare(before, recent.map((w) => w.weightKg!));
    const down = g.targetKg < nowKg, pieces: Piece[] = [];
    if (c.enough) pieces.push({ id: 'trend', points: !c.moved ? 'level' : (c.diff < 0) === down ? 'yes' : 'no', support: 'good', title: !c.moved ? 'Your weight has not moved beyond its daily wander.' : `Your weight is ${c.diff < 0 ? 'down' : 'up'} ${(Math.abs(c.diff) * k).toFixed(1)} ${u} in four weeks.`, text: `It averaged ${(c.a * k).toFixed(1)} ${u} over the four weeks before, and ${(c.b * k).toFixed(1)} ${u} over the last four. Weight wanders from day to day, so only a move larger than that wander counts.`, figure: { value: `${(nowKg * k).toFixed(1)} ${u}`, label: `goal ${(g.targetKg * k).toFixed(1)} ${u}` }, see: { chart: 'weight', label: 'weight and power to weight' }, spark: 'weight7' });
    if (c.enough && c.moved && (c.diff < 0) === down && left > 0) {
      const perDay = c.diff / 28, days = (g.targetKg - nowKg) / perDay;
      pieces.push({ id: 'rate', points: days <= left ? 'yes' : 'no', support: 'thin', title: days <= left ? 'At this rate you reach it in time.' : 'At this rate you reach it late.', text: `At the last four weeks’ rate you reach ${(g.targetKg * k).toFixed(1)} ${u} around ${day(addDays(t, Math.round(days)))}; your date is ${day(plan.goalDate)}. A rate measured over four weeks is a rough guide.`, figure: { value: day(addDays(t, Math.round(days))), label: 'at the present rate' }, see: { chart: 'weight', label: 'weight and power to weight' } });
    }
    if (!pieces.length) return early('goal', 'Antogo needs weighings in each of the last two four-week stretches, seven or more in each, to tell a trend from the daily wander.', `You are at ${(nowKg * k).toFixed(1)} ${u}; your goal is ${(g.targetKg * k).toFixed(1)} ${u} by ${day(plan.goalDate)}.`, ['health', 'enough'], { value: `${(nowKg * k).toFixed(1)} ${u}`, label: `goal ${(g.targetKg * k).toFixed(1)} ${u}` });
    const v = cap(judge(pieces), far);
    const { supporting, contra } = split(pieces, v.lean);
    return { id: 'goal', ask: QUESTIONS.goal, strength: v.strength, why: v.why, supporting, contra, answer: v.strength === 'mixed' ? 'Partly. Moving the right way, but not fast enough.' : v.lean === 'yes' ? `Probably. ${(nowKg * k).toFixed(1)} ${u} today, heading for ${(g.targetKg * k).toFixed(1)}.` : v.lean === 'no' ? 'Not as things stand.' : 'Not yet. Your weight is holding level.', card: { value: `${(nowKg * k).toFixed(1)} ${u}`, label: `goal ${(g.targetKg * k).toFixed(1)} ${u} by ${day(plan.goalDate)}` }, spark: 'weight7', act: { title: 'Keep weighing in the mornings.', text: 'Regular weighings are what keep this honest.' }, related: ['health', 'enough'] };
  }
  if (g.kind === 'endurance') {
    const longest = f.assessment.longestRide.value / 3600, want = g.targetHours * 0.8;
    if (!(longest > 0)) return early('goal', 'Antogo needs a ride on record in the last eight weeks to measure your longest against the goal.', `Your goal is to ride ${hm(g.targetHours)} comfortably.`, ['enough', 'fitter']);
    const p: Piece = { id: 'longest', points: longest >= want ? 'yes' : 'level', support: f.assessment.longestRide.confidence === 'good' ? 'good' : 'thin', title: longest >= want ? 'Your long ride is already long enough.' : `Your longest ride is ${hm(longest)} so far.`, text: `The goal is ${hm(g.targetHours)}. The plan wants one ride of about ${hm(want)}, four-fifths of it, before the day. Your longest in eight weeks is ${hm(longest)}.`, figure: { value: hm(longest), label: `wants ${hm(want)}` }, see: { measure: 'longest', label: 'longest ride, each week' }, spark: 'longest' };
    const strength: Strength = longest >= want ? (p.support === 'good' ? 'likely' : 'likely') : 'likely';
    return { id: 'goal', ask: QUESTIONS.goal, strength, why: longest >= want ? 'it rests on one piece of evidence: the length of your longest ride.' : 'the long ride is still growing, and one measure is all there is to go on.', answer: longest >= want ? 'Probably. Your long ride is nearly there.' : `Not yet. ${hm(Math.max(0, want - longest))} to add to your long ride.`, supporting: [p], contra: [], card: { value: hm(longest), label: `longest ride · goal ${hm(g.targetHours)}` }, spark: 'longest', related: ['enough', 'plan'] };
  }
  // VO2max: the estimates from the rider's own Ramp Tests.
  const ts = f.tests.filter((x) => pos(x.vo2)).sort((a, b) => a.date.localeCompare(b.date));
  if (ts.length < 2) return early('goal', 'Antogo needs two Ramp Tests with a VO2max estimate to see which way it is moving.', ts.length ? `Your one estimate so far is ${ts[0].vo2} ml/kg/min, on ${day(ts[0].date)}.` : 'No Ramp Test with an estimate is on record yet.', ['fitter', 'profile'], ts.length ? { value: `${ts[0].vo2}`, label: 'VO2max estimate' } : undefined);
  const a = ts[ts.length - 2].vo2!, b = ts[ts.length - 1].vo2!, ch = (b - a) / a;
  const p: Piece = { id: 'vo2', points: Math.abs(ch) <= POWER_MOVED ? 'level' : ch > 0 ? 'yes' : 'no', support: 'good', title: Math.abs(ch) <= POWER_MOVED ? 'Your VO2max estimate is unchanged.' : `Your VO2max estimate is ${ch > 0 ? 'up' : 'down'}.`, text: `${a} ml/kg/min on ${day(ts[ts.length - 2].date)}, ${b} on ${day(ts[ts.length - 1].date)}. It is worked out from the power you reached in each Ramp Test, so a change of 2% or less is within what the meter can tell apart.`, figure: { value: `${b}`, label: `was ${a}` }, see: { measure: 'vo2test', label: 'VO2max, from your tests' }, spark: 'vo2test' };
  const v = judge([p]);
  return { id: 'goal', ask: QUESTIONS.goal, strength: v.strength, why: v.why, answer: p.points === 'yes' ? 'Probably. Your estimate is rising.' : p.points === 'no' ? 'Not at present. Your estimate has fallen.' : 'It is holding level.', supporting: p.points !== 'no' ? [p] : [], contra: p.points === 'no' ? [p] : [], card: { value: `${b}`, label: 'VO2max estimate, ml/kg/min' }, spark: 'vo2test', related: ['fitter', 'profile'] };
}

// ---------- Am I following my plan, and is it working? ----------

export function plan(f: InsightFacts): Answer | undefined {
  const pl = f.plan;
  if (!pl) return undefined;
  const t = f.today, now = f.series[f.series.length - 1];
  const due = f.planned.filter((p) => p.date >= pl.start && p.date < t && p.date > addDays(t, -SPAN));
  const done = due.filter((p) => p.status === 'completed').length;
  if (due.length < PLAN_MIN_SESSIONS || !now) return early('plan', `Antogo needs six planned sessions to have come due. ${count(due.length)} ${due.length === 1 ? 'has' : 'have'} so far.`, due.length ? `You have done ${done} of ${due.length}.` : 'The plan has only just begun.', ['fitter', 'enough'], due.length ? { value: `${done} of ${due.length}`, label: 'planned sessions done' } : undefined);
  const share = done / due.length, pieces: Piece[] = [];
  pieces.push({ id: 'done', points: share >= PLAN_DONE.yes ? 'yes' : share < PLAN_DONE.no ? 'no' : 'level', support: 'good', title: `You did ${done} of ${due.length} planned sessions.`, text: `That is ${r0(share * 100)}% over the last six weeks of the plan. Three in four or more counts as following it; under half does not.`, figure: { value: `${r0(share * 100)}%`, label: 'of planned sessions' }, see: { chart: 'zones', label: 'time in zones, against the plan' } });
  const exp = expected(pl, t), move = fitnessMove(f.series, t);
  if (exp) { const gap = now.ctl - exp.ctl; pieces.push({ id: 'line', points: gap >= -move ? 'yes' : 'no', support: daysApart(pl.start, t) >= 14 ? 'good' : 'thin', title: gap >= -move ? 'Your fitness is where the plan expected.' : 'Your fitness is behind the plan’s line.', text: `The plan expected ${r0(exp.ctl)} today; you are at ${r0(now.ctl)}. A gap smaller than your usual weekly movement (${move.toFixed(1)}) is not a gap.`, figure: { value: `${r0(now.ctl)}`, label: `plan expected ${r0(exp.ctl)}` }, see: { chart: 'fitness', label: 'fitness, fatigue and form' }, spark: 'fitness' }); }
  const start = fitnessOn(f, pl.start);
  if (start && daysApart(pl.start, t) >= 21) { const d = now.ctl - start.ctl; pieces.push({ id: 'since', points: Math.abs(d) <= move ? 'level' : d > 0 ? 'yes' : 'no', support: 'good', title: Math.abs(d) <= move ? 'Fitness is level since the plan began.' : `Fitness is ${d > 0 ? 'up' : 'down'} ${r0(Math.abs(d))} since the plan began.`, text: `${r0(start.ctl)} on ${day(pl.start)}, ${r0(now.ctl)} today.`, figure: { value: sgn(d), label: 'since the plan began' }, see: { chart: 'fitness', label: 'fitness, fatigue and form' }, spark: 'fitness' }); }
  const v = judge(pieces);
  const { supporting, contra } = split(pieces, v.lean);
  return {
    id: 'plan', ask: QUESTIONS.plan, strength: v.strength, why: v.why, supporting, contra,
    answer: v.strength === 'mixed' ? 'Partly. It points both ways.' : v.lean === 'yes' ? (v.strength === 'clear' ? 'Yes. You are following it, and it is working.' : 'Probably. So far, so good.') : v.lean === 'no' ? 'Not at present.' : 'You are following it in part.',
    card: { value: `${r0(share * 100)}%`, label: `of planned sessions done · ${done} of ${due.length}` },
    act: v.lean === 'no' || v.strength === 'mixed' ? { title: 'Check the plan.', text: 'Check the plan rebuilds the weeks ahead from where you are now.', href: '#/plan', label: 'Open Plan' } : undefined,
    related: [pl.goal.kind === 'event' ? 'event' : 'goal', 'fitter', 'profile'],
  };
}

// ---------- Am I doing the right mix of training? (no plan) ----------

export function mix(f: InsightFacts): Answer | undefined {
  if (f.plan) return undefined;
  const t = f.today, from = addDays(f.weekStartOf(t), -28);
  const weeks = weeklyZones(f.rides, from, t, f.weekStartOf);
  const rides = f.rides.filter((r) => r.sport === 'ride' && r.date >= from && (r.powerZoneSeconds?.length || r.hrZoneSeconds?.length)).length;
  const m = zoneMix(weeks);
  if (!m || rides < 6) return early('mix', `Antogo needs six rides with time in zones over the last five weeks. You have ${rides}.`, m ? `So far ${m.easy}% of your riding has been easy.` : 'No riding time in zones is on record yet.', ['enough', 'fitter'], m ? { value: `${m.easy}%`, label: 'easy so far' } : undefined);
  const pieces: Piece[] = [
    { id: 'easy', points: m.easy >= 75 ? 'yes' : 'no', support: 'good', title: m.easy >= 75 ? 'Most of your riding is easy.' : 'Less of your riding is easy than the usual advice.', text: `${m.easy}% of your riding time is in zones 1 and 2. The mix Antogo calls polarised has three-quarters or more there.`, figure: { value: `${m.easy}%`, label: 'easy' }, see: { chart: 'zones', label: 'time in zones' }, spark: 'easyShare' },
    { id: 'hard', points: m.hard >= 5 ? 'yes' : 'no', support: 'good', title: m.hard >= 5 ? 'You do some hard riding.' : 'You do almost no hard riding.', text: `${m.hard}% is at zone 4 and above. The same rule asks for at least 5%: without some hard riding, the top end is not trained.`, figure: { value: `${m.hard}%`, label: 'zone 4 and up' }, see: { chart: 'zones', label: 'time in zones' }, spark: 'zoneHard' },
    { id: 'mid', points: m.mid < m.hard ? 'yes' : 'no', support: 'good', title: m.mid < m.hard ? 'Little of it is in between.' : 'More is in the middle than at the top.', text: `${m.mid}% is in zone 3 against ${m.hard}% at zone 4 and above. The rule’s third part is less in the middle than at the top: zone 3 tires you without the gains of going harder.`, figure: { value: `${m.mid}%`, label: 'zone 3' }, see: { chart: 'zones', label: 'time in zones' }, spark: 'zoneMid' },
  ];
  const v = judge(pieces);
  const { supporting, contra } = split(pieces, v.lean);
  return {
    id: 'mix', ask: QUESTIONS.mix, strength: v.strength, supporting, contra,
    why: v.strength === 'clear' ? 'all three parts of the rule agree. It is one well-known pattern, not the only sound one.' : v.strength === 'mixed' ? 'your riding meets part of the rule and not the rest, so both are shown.' : v.why,
    answer: m.polarised ? 'Yes. Mostly easy, some hard, little in between.' : v.strength === 'mixed' ? `Partly. ${m.easy >= 75 ? 'Plenty of easy riding' : 'Not much easy riding'}, ${m.hard >= 5 ? 'and some hard' : 'but almost none hard'}.` : 'Not by the usual rule.',
    card: { value: `${m.easy}%`, label: `easy · ${m.mid}% zone 3 · ${m.hard}% zone 4 and up` }, spark: 'easyShare',
    act: m.polarised ? undefined : { title: 'A plan sets the mix for you.', text: 'Plan my training builds each week’s mix around your goal and your hours.', href: '#/plan', label: 'Open Plan' },
    related: ['fitter', 'enough', 'profile'],
  };
}

// ---------- Is my health improving? ----------

const HEALTH = 'Antogo is not a medical device, and this is not medical advice.';

export function health(f: InsightFacts): Answer | NotShown {
  const t = f.today, mid = addDays(t, -SPAN), far = addDays(t, -2 * SPAN);
  const any = f.wellness.some((w) => pos(w.restingHr) || pos(w.hrv) || pos(w.sleepSeconds) || pos(w.weightKg) || pos(w.vo2max));
  if (!any) return { id: 'health', ask: QUESTIONS.health, reason: 'It needs body readings: overnight heart rate and sleep from a watch or ring, or weighings.' };
  const two = (get: (w: Wellness) => number | undefined) => compare(wellIn(f, get, addDays(far, 1), mid), wellIn(f, get, addDays(mid, 1), t));
  const pieces: Piece[] = [];
  const rhr = two((w) => w.restingHr), hrv = two((w) => w.hrv), sleep = two((w) => (w.sleepSeconds ? w.sleepSeconds / 3600 : undefined)), vo = two((w) => w.vo2max);
  const enoughAny = [rhr, hrv, sleep].some((c) => c.enough);
  if (!enoughAny) return early('health', 'Antogo needs a week of overnight readings in each of two six-week stretches, to compare one with the other.', 'Your readings so far are on the Recovery chart in the Lab.', ['ready', 'enough']);
  if (rhr.enough) pieces.push({ id: 'rhr', points: !rhr.moved ? 'level' : rhr.diff < 0 ? 'yes' : 'no', support: 'good', title: !rhr.moved ? 'Your resting heart rate is unchanged.' : `Your resting heart rate is ${rhr.diff < 0 ? 'down' : 'up'} ${Math.abs(rhr.diff).toFixed(1)} beats.`, text: `It averaged ${rhr.a.toFixed(0)} in the six weeks to ${day(mid)} and ${rhr.b.toFixed(0)} since. ${rhr.moved ? 'That is more than your mornings vary by chance.' : 'The difference is inside what your mornings vary by.'} A slower resting heart is one of the plainest signs of a fitter one.`, figure: { value: `${rhr.b.toFixed(0)} bpm`, label: `was ${rhr.a.toFixed(0)}` }, see: { chart: 'recovery', label: 'recovery' }, spark: 'restingHr' });
  if (hrv.enough) pieces.push({ id: 'hrv', points: !hrv.moved ? 'level' : hrv.diff > 0 ? 'yes' : 'no', support: 'good', title: !hrv.moved ? 'Your heart-rate variability is unchanged.' : `Your heart-rate variability is ${hrv.diff > 0 ? 'up' : 'down'} ${Math.abs(hrv.diff).toFixed(0)} ms.`, text: `It averaged ${hrv.a.toFixed(0)} ms in the earlier six weeks and ${hrv.b.toFixed(0)} ms in the last six. Higher overnight variability usually goes with better recovery.`, figure: { value: `${hrv.b.toFixed(0)} ms`, label: `was ${hrv.a.toFixed(0)}` }, see: { chart: 'recovery', label: 'recovery' }, spark: 'hrv' });
  if (sleep.enough && sleep.moved) pieces.push({ id: 'sleep', points: sleep.diff > 0 ? 'yes' : 'no', support: 'good', title: `You are sleeping ${r0(Math.abs(sleep.diff) * 60)} minutes ${sleep.diff > 0 ? 'more' : 'less'} a night.`, text: `${hm(sleep.a)} a night in the earlier six weeks, ${hm(sleep.b)} in the last six.`, figure: { value: hm(sleep.b), label: `was ${hm(sleep.a)}` }, see: { chart: 'recovery', label: 'recovery' }, spark: 'sleep' });
  if (vo.enough && vo.moved) pieces.push({ id: 'vo2', points: vo.diff > 0 ? 'yes' : 'no', support: 'thin', indirect: true, title: `Your device’s VO2max estimate is ${vo.diff > 0 ? 'up' : 'down'}.`, text: `${vo.a.toFixed(1)} before, ${vo.b.toFixed(1)} now. This is your watch’s own estimate, shown as it sends it.`, figure: { value: vo.b.toFixed(1), label: `was ${vo.a.toFixed(1)}` }, see: { measure: 'vo2watch', label: 'VO2max, your device’s' }, spark: 'vo2watch' });
  const mins = f.rides.filter((r) => r.date > addDays(t, -28)).reduce((s, r) => s + r.seconds, 0) / 60 / 4;
  if (daysApart(firstDay(f), t) + 1 >= ENOUGH_DAYS && mins >= WHO_MINUTES) pieces.push({ id: 'who', points: 'yes', support: 'thin', indirect: true, title: 'You are more active than health guidelines ask.', text: `${hm(mins / 60)} a week over the last four weeks, against the World Health Organization’s 150 minutes. This says you are doing what protects health, not that a reading has changed.`, figure: { value: hm(mins / 60), label: 'a week' }, see: { measure: 'weekHours', label: 'hours trained, each week' }, spark: 'weekHours' });
  const v = judge(pieces);
  const { supporting, contra } = split(pieces, v.lean);
  const lead = (v.lean === 'level' ? pieces : supporting).find((p) => p.figure) ?? pieces[0];
  return {
    id: 'health', ask: QUESTIONS.health, strength: v.strength, why: v.why, supporting, contra, caution: HEALTH,
    answer: v.strength === 'mixed' ? 'Partly. Some readings are better and some worse.' : v.lean === 'yes' ? (v.strength === 'clear' ? 'Yes. Your readings have improved.' : 'Probably. The signs are good.') : v.lean === 'no' ? 'Not over the last six weeks.' : 'It is holding steady.',
    card: lead?.figure ? { value: lead.figure.value, label: `${lead.id === 'rhr' ? 'resting heart rate' : lead.id === 'hrv' ? 'heart-rate variability' : lead.id === 'sleep' ? 'sleep a night' : lead.id === 'who' ? 'active' : 'VO2max'} · ${lead.figure.label}` } : undefined, spark: lead?.spark,
    related: ['ready', 'fitter', 'enough'],
  };
}

// ---------- every question, for this rider, today ----------

export interface Insights { answers: Answer[]; notShown: NotShown[] }

/** Every question that applies to this rider, answered; the ones that cannot be are listed with the reason. */
export function insights(f: InsightFacts): Insights {
  const out: Array<Answer | NotShown | undefined> = [fitter(f), ready(f), profile(f), enough(f), event(f), goal(f), plan(f), mix(f), health(f)];
  const answers: Answer[] = [], notShown: NotShown[] = [];
  for (const a of out) { if (!a) continue; if ('reason' in a) notShown.push(a); else answers.push(a); }
  return { answers, notShown };
}
