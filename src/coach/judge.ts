import { addDays } from '../engine/load';
import type { Change } from '../engine/adapt';
import type { Availability, AwayRange } from '../engine/planner';
import { mayOf } from '../engine/planner';
import type { SessionKind } from '../engine/types';

/**
 * The re-check thinks (1 Nov 2026), Part C: the coach judges what the rider
 * needs from the evidence packet and compares it with the calendar. One call
 * returns the day's note, an assessment, today's stance and any changes. The
 * app checks every change against the rider's fixed parameters before showing
 * it; the judgment itself is never fenced by the app's own algorithm.
 */
export type Stance = 'as planned' | 'lighter' | 'easy' | 'rest';
export type JudgeAction = 'replace' | 'remove' | 'add' | 'move';

export interface JudgedChange {
  date: string;
  action: JudgeAction;
  /** The calendar entry acted on (replace, remove, move), by its packet ref. */
  session?: string;
  /** The workout put in (replace, add), by its packet ref. */
  workout?: string;
  toDate?: string;
  why: string;
}

export interface Judgment {
  date: string;
  /** What the judgment was made from: when it changes, the coach is asked again. */
  sig: string;
  at: string;
  note: string;
  assessment: string;
  stance: Stance;
  /** Changes that passed the app's checks, resolved to calendar entries and workouts. */
  changes: ResolvedChange[];
  /** Set when the reply could not be used: why, for troubleshooting. Nothing else is shown then. */
  failed?: string;
}

export interface ResolvedChange {
  date: string;
  kind: SessionKind;
  action: JudgeAction;
  /** The calendar entry's id (replace, remove, move). */
  plannedId?: string;
  /** The workout's id (replace, add). */
  workoutId?: string;
  toDate?: string;
  before?: string;
  after?: string;
  why: string;
  /** The rider placed or changed the entry by hand: offered, never pre-selected. */
  handPlaced?: boolean;
}

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string', description: "3 to 5 sentences to the rider about today, in the second person. The rider reads this: plain words only, sessions named by day and name, never a C or W ref." },
    assessment: { type: 'string', description: '2 to 4 sentences on where the rider is: recovery, how they have been performing, how the week is going. The rider reads this: never a C or W ref.' },
    stance: { type: 'string', enum: ['as planned', 'lighter', 'easy', 'rest'], description: 'What today should be.' },
    changes: {
      type: 'array',
      description: 'Changes to the calendar; empty when nothing should change.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD: the day of the calendar entry acted on, or the day a workout is added.' },
          action: { type: 'string', enum: ['replace', 'remove', 'add', 'move'] },
          session: { type: 'string', description: 'The calendar ref (C…) for replace, remove and move; empty for add.' },
          workout: { type: 'string', description: 'The Library ref (W…) for replace and add; empty otherwise.' },
          toDate: { type: 'string', description: 'YYYY-MM-DD for move; empty otherwise.' },
          why: { type: 'string', description: 'One sentence naming the evidence, in plain words the rider reads: never a C or W ref.' },
        },
        required: ['date', 'action', 'session', 'workout', 'toDate', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['note', 'assessment', 'stance', 'changes'],
  additionalProperties: false,
} as const;

/** The judge's instructions. Short: the packet carries the facts. */
export function judgeSystem(intro: string, medical: string): string {
  return `${intro}

Judge from the evidence below what the rider needs today and over the next two weeks, and compare that with the calendar. Answer in the JSON form given.
- The calendar is a considered plan. Recommend a change only when the evidence calls for it, and say in each "why" which evidence. No changes is often the right answer.
- Weigh how the rider performed in recent activities (heart rate at a given power against their usual, drift, power held or fading, targets held during the steps ridden, breathing where it was sound), the rider's overnight numbers against their own normal, the load of recent days, and the rider's notes. The rider's own notes outrank the numbers.
- How long an activity lasted against its plan is never evidence of fitness or fatigue: a ride may be cut short by weather or an interruption. Judge what happened while riding.
- Prefer moving sessions within the week, so quality work is kept, over removing them. Replace with something lighter when today should be lighter; remove only when a session cannot be kept.
- The rider's parameters (section 8) are fixed: hours each day, kinds that may or may never be scheduled, days away, equipment.
- A workout you put in must be one of the Library refs in section 9, of a kind that day allows. The C and W refs belong only in the "session" and "workout" fields; the rider never sees them. In "note", "assessment" and every "why", call a session by its day and name ("Monday's Elden Street Spin"), never by ref.
- Read form and fatigue against this rider's own history in the packet, not against a fixed scale.
- "note" speaks to today's calendar and agrees with your stance and changes. "assessment" is your view of where the rider is.
- Do not invent numbers. Use the rider's name only exactly as given, or none.
${medical}`;
}

/** The judgment out of the reply, or a failure that says why. Only the shape is read here; checkChanges decides what may be shown. */
export function readJudge(data: { content?: Array<{ type: string; text?: string }>; stop_reason?: string }): { note: string; assessment: string; stance: Stance; changes: JudgedChange[] } | { failed: string } {
  if (data.stop_reason === 'max_tokens') return { failed: 'the reply was cut off before it finished' };
  const raw = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  let v: Record<string, unknown> | undefined;
  try { const x = JSON.parse(raw); if (x && typeof x === 'object') v = x as Record<string, unknown>; } catch { /* below */ }
  if (!v) return { failed: `no judgment in the reply (${data.stop_reason ?? 'unknown reason'})` };
  const note = typeof v.note === 'string' ? v.note.trim() : '';
  if (!note) return { failed: 'the reply was missing its note' };
  const stances: Stance[] = ['as planned', 'lighter', 'easy', 'rest'];
  const st = typeof v.stance === 'string' ? v.stance.toLowerCase() : '';
  const stance = (stances.find((s) => s === st) ?? 'as planned') as Stance;
  const changes: JudgedChange[] = Array.isArray(v.changes) ? v.changes.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').map((c) => ({
    date: String(c.date ?? ''), action: String(c.action ?? '').toLowerCase() as JudgeAction,
    ...(c.session ? { session: String(c.session).trim() } : {}), ...(c.workout ? { workout: String(c.workout).trim() } : {}),
    ...(c.toDate ? { toDate: String(c.toDate) } : {}), why: typeof c.why === 'string' ? c.why.trim() : '',
  })) : [];
  return { note, assessment: typeof v.assessment === 'string' ? v.assessment.trim() : '', stance, changes };
}

/**
 * No cryptic messages anywhere in the app: the C and W refs are handles for the
 * JSON fields, never words the rider reads. Should one still slip into the
 * note, assessment or a change's reason, a parenthetical of nothing but refs
 * ("(C2, C5)") is dropped, and a bare ref becomes the session's or workout's
 * own name. An unknown ref is left as it is (it may be an ordinary word).
 */
export function plainWords(text: string, names: Map<string, string>): string {
  return text
    .replace(/\s*\((?:[CW]\d+)(?:\s*,\s*[CW]\d+)*\)/g, '')
    .replace(/\b([CW]\d+)\b/g, (m) => names.get(m) ?? m)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---- holding the lines -------------------------------------------------------

export interface CheckSession { ref: string; id: string; date: string; kind: SessionKind; name: string; minutes: number; done: boolean; handPlaced: boolean; workoutKey: string }
export interface CheckWorkout { ref: string; id: string; kind: SessionKind; name: string; minutes: number; key: string }

export interface CheckContext {
  today: string;
  /** How far ahead changes may reach. */
  horizon: number;
  availability?: Availability;
  away?: AwayRange[];
  sessions: CheckSession[];
  workouts: CheckWorkout[];
  /** Without a plan: the longest session of each kind the coach may put in, from the rider's own history (D2). */
  ceilingMinutes?: Partial<Record<SessionKind, number>>;
}

const KINDS: SessionKind[] = ['ride', 'strength', 'mobility', 'walk', 'run', 'other'];
/**
 * D2 (1 Nov 2026): the rider's own ceiling for each kind, without a plan: a quarter more than the longest activity of
 * that kind in the last 8 weeks; a kind with none takes a quarter more than the longest of any kind; no activities at
 * all, no ceiling. Nothing fixed.
 */
export function ceilingsFrom(activities: Array<{ date: string; sport: SessionKind; seconds: number }>, today: string): Partial<Record<SessionKind, number>> | undefined {
  const from = addDays(today, -56);
  const recent = activities.filter((a) => a.date >= from && a.date <= today && a.seconds > 0);
  if (!recent.length) return undefined;
  const longest = (xs: typeof recent) => Math.max(...xs.map((a) => a.seconds)) / 60;
  const any = longest(recent);
  const out: Partial<Record<SessionKind, number>> = {};
  for (const k of KINDS) { const mine = recent.filter((a) => a.sport === k); out[k] = Math.round((mine.length ? longest(mine) : any) * 1.25); }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dowOf = (date: string) => new Date(date + 'T00:00:00').getDay();

/** Whether a kind may go on a date: not away, a kind the app may schedule, not "Never", the bike not out for a ride, and some hours that day. */
export function kindAllowed(kind: SessionKind, date: string, ctx: Pick<CheckContext, 'availability' | 'away'>): string | undefined {
  if (ctx.away?.some((r) => date >= r.from && date <= r.to)) return 'the rider is away that day';
  const av = ctx.availability;
  if (!av) return undefined;
  const d = dowOf(date);
  if (!(av.hours[d] > 0)) return 'no time that day';
  if (kind === 'ride' && av.noBike?.[d]) return 'no bike that day';
  const may = mayOf(av);
  if (kind !== 'ride' && kind !== 'other' && may[kind] === false) return `${kind} is switched off for the plan`;
  const pinned = av.pins?.some((p) => p.dow === d && p.kind === kind);
  if (!pinned && av.never?.some((n) => n.dow === d && n.kind === kind)) return `never ${kind} on that day`;
  return undefined;
}

/** Minutes already on a date (undone sessions), leaving out the given entries. */
function minutesOn(date: string, ctx: CheckContext, except: Set<string>): number {
  return ctx.sessions.filter((s) => s.date === date && !s.done && !except.has(s.id)).reduce((t, s) => t + s.minutes, 0);
}

/** Whether the day's hours hold this much more, with a little give. */
/**
 * Without a plan there are no hours set: a session the coach adds or puts in is kept within the rider's own
 * ceiling for that kind (D2: a quarter more than their longest of that kind in the last 8 weeks), and with no
 * history at all there is no ceiling, the coach's change being only a recommendation.
 */
function fits(date: string, minutes: number, ctx: CheckContext, except: Set<string>, kind?: SessionKind): boolean {
  const av = ctx.availability;
  if (!av) { const cap = kind ? ctx.ceilingMinutes?.[kind] : undefined; return cap == null || minutes <= cap; }
  const cap = av.hours[dowOf(date)] * 60;
  return minutesOn(date, ctx, except) + minutes <= cap * 1.1 + 5;
}

/**
 * Every change the coach returned, checked: dates in range and not away; the
 * entry exists, is on that date and not done; a named workout exists, is a kind
 * that day allows and fits the day's hours; an add does not duplicate what is on
 * the day; a move lands on a permitted day with room. A change that fails is
 * dropped with its reason (logged, never shown); the rest are resolved.
 */
export function checkChanges(changes: JudgedChange[], ctx: CheckContext): { ok: ResolvedChange[]; dropped: Array<{ change: JudgedChange; why: string }> } {
  const ok: ResolvedChange[] = [];
  const dropped: Array<{ change: JudgedChange; why: string }> = [];
  const last = addDays(ctx.today, ctx.horizon);
  const used = new Set<string>();   // a calendar entry acted on once only
  const inRange = (d?: string) => !!d && DATE.test(d) && d >= ctx.today && d <= last;
  const ref = (r?: string) => (r ?? '').toUpperCase();
  for (const c of changes) {
    const fail = (why: string) => { dropped.push({ change: c, why }); };
    if (!inRange(c.date)) { fail('date outside today to two weeks ahead'); continue; }
    const s = c.session ? ctx.sessions.find((x) => x.ref.toUpperCase() === ref(c.session)) : undefined;
    const w = c.workout ? ctx.workouts.find((x) => x.ref.toUpperCase() === ref(c.workout)) : undefined;
    if (c.action === 'replace' || c.action === 'remove' || c.action === 'move') {
      if (!s) { fail('no such calendar entry'); continue; }
      if (s.date !== c.date) { fail('the calendar entry is on another date'); continue; }
      if (s.done) { fail('the session is already done'); continue; }
      if (used.has(s.id)) { fail('the entry already has a change'); continue; }
    }
    if (c.action === 'replace' || c.action === 'add') {
      if (!w) { fail('no such Library workout'); continue; }
      const no = kindAllowed(w.kind, c.date, ctx);
      if (no) { fail(no); continue; }
      const except = new Set(s ? [s.id] : []);
      if (!fits(c.date, w.minutes, ctx, except, w.kind)) { fail('does not fit the hours that day'); continue; }
      if (ctx.sessions.some((x) => x.date === c.date && !except.has(x.id) && x.workoutKey === w.key)) { fail('already on that day'); continue; }
    }
    switch (c.action) {
      case 'replace':
        if (s!.workoutKey === w!.key) { fail('the same workout'); continue; }
        ok.push({ date: c.date, kind: w!.kind, action: 'replace', plannedId: s!.id, workoutId: w!.id, before: s!.name, after: w!.name, why: c.why, ...(s!.handPlaced ? { handPlaced: true } : {}) });
        used.add(s!.id);
        break;
      case 'remove':
        ok.push({ date: c.date, kind: s!.kind, action: 'remove', plannedId: s!.id, before: s!.name, why: c.why, ...(s!.handPlaced ? { handPlaced: true } : {}) });
        used.add(s!.id);
        break;
      case 'add':
        ok.push({ date: c.date, kind: w!.kind, action: 'add', workoutId: w!.id, after: w!.name, why: c.why });
        break;
      case 'move': {
        const to = c.toDate;
        if (!inRange(to) || to === c.date) { fail('move to a date outside today to two weeks ahead'); continue; }
        const no = kindAllowed(s!.kind, to!, ctx);
        if (no) { fail(no); continue; }
        if (!fits(to!, s!.minutes, ctx, new Set([s!.id]), s!.kind)) { fail('does not fit the hours on the new day'); continue; }
        if (ctx.sessions.some((x) => x.date === to && x.id !== s!.id && x.workoutKey === s!.workoutKey)) { fail('already on the new day'); continue; }
        ok.push({ date: c.date, kind: s!.kind, action: 'move', plannedId: s!.id, toDate: to, before: s!.name, after: s!.name, why: c.why, ...(s!.handPlaced ? { handPlaced: true } : {}) });
        used.add(s!.id);
        break;
      }
      default: fail('unknown action');
    }
  }
  return { ok, dropped };
}

/**
 * A resolved change as the plan's change rows show it. A move is shown on the
 * day it lands, "moves here from …", as the plan's own moves are.
 */
export function toChange(r: ResolvedChange): Change {
  const base = { kind: r.kind, ...(r.handPlaced ? { userEdited: true } : {}) };
  switch (r.action) {
    case 'replace': return { ...base, date: r.date, before: r.before, after: r.after, note: 'changed' };
    case 'remove': return { ...base, date: r.date, before: r.before, note: 'removed' };
    case 'add': return { ...base, date: r.date, after: r.after, note: 'added' };
    case 'move': return { ...base, date: r.toDate!, before: r.before, after: r.after, note: 'moved', movedFrom: r.date };
  }
}

/** The words under the readiness score when the coach has judged today. */
export const STANCE_TEXT: Record<Stance, string> = {
  'as planned': "The coach's view: today as planned",
  lighter: "The coach's view: a lighter day than planned",
  easy: "The coach's view: keep today easy",
  rest: "The coach's view: rest today",
};

/**
 * What a judgment is made from, as one string: the date, the latest morning's
 * numbers, the activities of the last 14 days, the calendar from today to 14 days
 * ahead, and the rider's notes. The coach is asked again only when it changes.
 */
export function judgeSig(parts: { date: string; wellnessDate?: string; activities: string[]; calendar: string[]; notes: string[] }): string {
  const s = [parts.date, parts.wellnessDate ?? '', [...parts.activities].sort().join(','), [...parts.calendar].sort().join(','), parts.notes.join('|')].join('#');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${parts.date}:${h.toString(36)}`;
}
