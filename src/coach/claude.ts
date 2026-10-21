/**
 * Optional narrative layer. With an API key in Settings the app asks Claude for a
 * short daily note; without one, nothing here runs. Calls go straight from the
 * browser to Anthropic with the user's own key.
 */
import type { Fitness, PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import { exerciseLine } from '../engine/record';
import type { Readiness } from '../engine/readiness';
import { workoutStats } from '../engine/workout';

const MODEL = 'claude-sonnet-5-5';

/** One session on today's calendar, whoever put it there. */
export interface TodaySession {
  planned: PlannedWorkout;
  workout: Workout;
  /** The recording paired with it, once done: its real duration and load are what the coach should speak to. */
  recorded?: Ride;
}

/** A duration in words ("30 min 39 s", "1 h 05 min"), so it cannot be mistaken for any other number. */
export function durationWords(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return sec ? `${m} min ${sec} s` : `${m} min`;
}

export interface CoachContext {
  profile: Profile;
  date: string;
  fitness?: Fitness;
  readiness: Readiness;
  /** Everything on the calendar for today: plan-made and hand-added alike. The calendar is the plan. */
  todaySessions: TodaySession[];
  recentRides: Ride[];
  missedThisWeek: number;
  /** What the rider wrote about today, and whether they set today's wellness numbers aside. */
  riderNote?: string;
  wellnessSetAside?: boolean;
  /** Notes from the last few days, newest first, as "date: text". */
  recentNotes?: string[];
}

const KIND_WORD: Record<Workout['kind'], string> = { ride: 'ride', strength: 'strength session', mobility: 'mobility session', walk: 'walk', other: 'session' };

/** One line per session on the day, with what it is, how big it is, and whether it is done. */
export function describeSession({ planned, workout, recorded }: TodaySession): string {
  const parts: string[] = [`${workout.name} (${KIND_WORD[workout.kind]})`];
  if (workout.kind === 'ride') {
    const s = workoutStats(workout.blocks);
    parts.push(`planned duration ${durationWords(s.seconds)}, planned training load ${s.tss} TSS, IF ${s.intensityFactor.toFixed(2)}`);
  } else {
    if (workout.minutes) parts.push(`planned duration ${workout.minutes} min`);
    if (workout.estimatedTss != null) parts.push(`planned training load about ${workout.estimatedTss} TSS`);
    if (workout.kind === 'strength' && workout.effort) parts.push(`planned effort ${workout.effort}/10`);
    if (workout.kind === 'walk' && workout.walk) parts.push(workout.walk.hrLow > 0 ? `heart rate ${Math.round(workout.walk.hrLow * 100)}–${Math.round(workout.walk.hrHigh * 100)}% of max` : `no minimum heart rate, up to ${Math.round(workout.walk.hrHigh * 100)}% of max`);
    if (workout.exercises?.length) parts.push(`${workout.exercises.length} exercises: ${workout.exercises.slice(0, 6).map((e) => e.name).join(', ')}${workout.exercises.length > 6 ? '…' : ''}`);
  }
  if (workout.purpose) parts.push(workout.purpose);
  const done = recorded
    ? `, recorded duration ${durationWords(recorded.seconds)}${recorded.tss != null ? `, recorded training load ${recorded.tss} TSS` : ''}${recorded.averageHr ? `, average heart rate ${Math.round(recorded.averageHr)} bpm` : ''}`
    : planned.loggedSeconds ? `, logged duration ${durationWords(planned.loggedSeconds)}` : '';
  const what = planned.status === 'completed' && planned.done?.exercises?.length
    ? `; what was actually done: ${planned.done.exercises.map((e) => exerciseLine(e)).join('; ')}`
    : planned.status === 'completed' && planned.done?.walk ? `; walked ${planned.done.walk.minutes} min${planned.done.walk.packKg ? ` with a ${Math.round(planned.done.walk.packKg * 2.2046)} lb pack` : ''}` : '';
  const status = planned.status === 'completed' ? `ALREADY DONE today${planned.rpe ? `, felt ${planned.rpe}/10` : ''}${done}${what}`
    : planned.status === 'sent' ? 'on the Garmin, not done yet'
    : planned.status === 'missed' ? 'marked missed'
    : 'not done yet';
  parts.push(status);
  if (!planned.planId) parts.push('(background only, never mention it: placed on the calendar by the rider)');
  return parts.join('; ');
}

/** One activity for the coach, every number named, so a duration cannot be read as a load or the other way round. */
export function activityLine(r: Ride): string {
  return `${r.date}: ${r.name} (${r.sport}), duration ${durationWords(r.seconds)}, training load ${r.tss ?? '?'} TSS${r.normalizedPower ? `, normalized power ${r.normalizedPower} W` : ''}${r.averageHr ? `, average heart rate ${Math.round(r.averageHr)} bpm` : ''}`;
}

/** The day as the coach sees it: athlete, readiness, notes, calendar, recent activities. Shared by the daily note and questions. */
export function dayFacts(ctx: CoachContext): string {
  const rides = ctx.recentRides.slice(0, 7).map(activityLine).join('\n');
  const sessions = ctx.todaySessions.map((s) => '- ' + describeSession(s)).join('\n');
  return `Athlete: FTP ${ctx.profile.ftp} W, LTHR ${ctx.profile.lthr} bpm, trains ${ctx.profile.hoursPerWeek} h/week, basis ${ctx.profile.basis}.
Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Readiness ${ctx.wellnessSetAside ? `not scored from wellness today: the rider set today's HRV, sleep and resting heart rate aside as wrong (${ctx.readiness.score}/100 from form alone)` : `${ctx.readiness.score}/100 (${ctx.readiness.band}); drivers: ${ctx.readiness.drivers.map((d) => `${d.name} ${d.value} (${d.effect})`).join('; ')}`}.
The rider's own note for today: ${ctx.riderNote ? `"${ctx.riderNote}"` : 'none'}.${ctx.recentNotes?.length ? `\nThe rider's notes from recent days:\n${ctx.recentNotes.map((n) => '- ' + n).join('\n')}` : ''}
On the calendar today:\n${sessions || '- nothing; a rest day unless the rider chooses otherwise'}
Missed sessions this week: ${ctx.missedThisWeek}.
Last activities:\n${rides || 'none synced yet'}`;
}

const NOTE_RULES = `Never change the plan yourself; you may suggest easing or swapping and say why. Anything the rider wrote in their own notes is the first thing to take into account: it explains the numbers, and it outranks them. If today's note names a cause that earlier notes also name, you may point out the pattern in one sentence. The calendar below is the rider's plan for today, whether the app's plan or the rider placed each session there; durations are in minutes and training load is in TSS, two different numbers never to be compared with each other; for a session already done, speak to its recorded duration, not the planned one; speak to every session listed, do not describe the day as empty when something is listed, and do not tell the rider to do a session that is marked already done. Never describe who placed a session on the calendar or how it was recorded or synced; notes in brackets are background for you, not things to say.`;

/**
 * Claude Sonnet 5.5 thinks before it answers unless told not to, and that thinking counts against
 * `max_tokens`: with the old 300-token limit the thinking used most of it and the note stopped
 * mid-sentence (20 Oct 2026). The coach's notes are short and need no thinking, so it is turned off
 * (`between_tools`, the model's lowest setting; there are no tools here), with room to spare.
 */
const NO_THINKING = { thinking: { type: 'between_tools' } };

async function callClaude(apiKey: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: MODEL, ...NO_THINKING, ...body }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }>; stop_reason?: string };
  return readText(data);
}

/** The reply's text, or an error, never half a sentence: a reply cut off at the limit is not shown. */
export function readText(data: { content?: Array<{ type: string; text?: string }>; stop_reason?: string }): string {
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  if (data.stop_reason === 'max_tokens') throw new Error('The coach\'s reply was cut off before it finished. Press Fresh note to try again.');
  if (!text) throw new Error(`The coach sent no reply (${data.stop_reason ?? 'unknown reason'}). Press Fresh note to try again.`);
  return text;
}

/** What went wrong, in words: a bad key is a 401, anything else says what the API said. */
async function apiError(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) return `Claude answered ${res.status}. Check the API key in Settings.`;
  let detail = '';
  try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* no body */ }
  return `Claude answered ${res.status}${detail ? `: ${detail}` : ''}.`;
}

export async function dailyNote(apiKey: string, ctx: CoachContext): Promise<string> {
  const prompt = `You are a cycling coach writing one short note for today to a masters road cyclist (over 50). Be specific, warm, and brief: 3 to 5 sentences, no headings, no bullet points, no exclamation marks. ${NOTE_RULES}\n\n${dayFacts(ctx)}`;
  return callClaude(apiKey, { max_tokens: 1500, messages: [{ role: 'user', content: prompt }] });
}

export interface ChatTurn { role: 'rider' | 'coach'; text: string; at?: string }

/**
 * A question from the rider, answered with the same picture of the day the
 * daily note uses, plus what the coach already said today. Answers only: the
 * plan changes through the suggested-changes review, never from here.
 */
export async function askCoach(apiKey: string, ctx: CoachContext, turns: ChatTurn[], question: string, earlier: string[] = []): Promise<string> {
  const system = `You are the rider's cycling coach, answering their questions about their training. The rider is a masters road cyclist (over 50). Answer plainly and specifically from the facts below, in a few sentences unless the question needs more; no headings, no exclamation marks. If the facts do not answer the question, say what you would need. You cannot change the plan; if a change would help, say what and why, and that the rider can make it on the calendar or accept it among the plan's suggested changes. ${NOTE_RULES}\n\n${dayFacts(ctx)}${earlier.length ? `\n\nWhat you have already told the rider today:\n${earlier.map((e) => '- ' + e).join('\n')}` : ''}`;
  const history = turns.slice(-8).map((t) => ({ role: t.role === 'rider' ? 'user' : 'assistant', content: t.text }));
  return callClaude(apiKey, { max_tokens: 2000, system, messages: [...history, { role: 'user', content: question }] });
}

export interface ReviewContext {
  profile: Profile;
  date: string;
  fitness?: Fitness;
  assessmentNotes: string[];
  goal: string;
  verdict: string;
  advice: string;
  lastWeek: string[];
  proposedChanges: string[];
  newActivities: string[];
  /** The rider's own notes from the last week, newest first, as "date: text"; days whose wellness was set aside say so. */
  riderNotes: string[];
}

export interface CoachReview {
  date: string;
  text: string;
  applyChanges: boolean;      // Claude's view on the planner's proposal
  reason: string;
  /** Set when the coach's reply could not be read: why, for troubleshooting. The text is then empty and never shown. */
  failed?: string;
}

/**
 * After new activities arrive: Claude reads the same evidence the planner used,
 * plus the planner's proposed changes, and gives a view. It never changes the
 * plan; the rider does, with one tap.
 */
export async function reviewAfterSync(apiKey: string, ctx: ReviewContext): Promise<CoachReview> {
  const prompt = `You are a cycling coach reviewing a masters rider's new training data. Answer in the JSON form given. "text" is 4 to 7 plain sentences to the rider: what the new activities show, what matters, and what you recommend; no headings, bullets or exclamation marks. "applyChanges" is whether the app's proposed plan changes below should be applied as they stand; "reason" is one sentence on why. Do not invent numbers. Never describe who placed a session on the calendar or how it was recorded or synced. Durations are in minutes and training load is in TSS: two different numbers, never compare one with the other; when a new activity completed a planned session, judge it on its recorded duration against the planned duration. The rider's own notes below explain the numbers and outrank them: a poor night the rider has explained is not training fatigue, and wellness the rider set aside as wrong has already been left out of every average. If the same cause recurs across notes (wine, travel, poor sleep), say so, briefly.

Athlete: FTP ${ctx.profile.ftp} W, LTHR ${ctx.profile.lthr} bpm. Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Goal: ${ctx.goal}. Current verdict: ${ctx.verdict}. ${ctx.advice}
What the data say about the rider:\n${ctx.assessmentNotes.map((n) => '- ' + n).join('\n')}
New activities just arrived:\n${ctx.newActivities.map((n) => '- ' + n).join('\n') || '- none'}
Last week:\n${ctx.lastWeek.map((n) => '- ' + n).join('\n') || '- nothing to report'}
The app's proposed plan changes:\n${ctx.proposedChanges.map((n) => '- ' + n).join('\n') || '- no changes proposed'}
The rider's notes this week:\n${ctx.riderNotes.map((n) => '- ' + n).join('\n') || '- none'}`;

  // The answer comes back in a fixed JSON form (structured outputs). Sonnet 5.5 refuses a forced tool
  // call, which is how this was asked for before 20 Oct 2026.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 3000, ...NO_THINKING,
      output_config: { format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  return readReview(ctx.date, await res.json());
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '4 to 7 plain sentences to the rider.' },
    applyChanges: { type: 'boolean', description: "Whether the app's proposed plan changes should be applied as they stand." },
    reason: { type: 'string', description: 'One sentence on why.' },
  },
  required: ['text', 'applyChanges', 'reason'],
  additionalProperties: false,
};

/** The review out of Claude's reply, or a failed review that says why, never raw text. */
export function readReview(date: string, data: { content?: Array<{ type: string; input?: unknown; text?: string }>; stop_reason?: string }): CoachReview {
  type Answer = { text?: unknown; applyChanges?: unknown; reason?: unknown };
  // The JSON form arrives as text; an older tool-call reply is read the same way.
  let use = data.content?.find((c) => c.type === 'tool_use')?.input as Answer | undefined;
  if (!use && data.stop_reason !== 'max_tokens') {
    const raw = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    try { const v = JSON.parse(raw); if (v && typeof v === 'object') use = v as Answer; } catch { /* not JSON: a failed review below */ }
  }
  if (use && typeof use.text === 'string' && use.text.trim()) {
    return { date, text: use.text.trim(), applyChanges: use.applyChanges === true, reason: typeof use.reason === 'string' ? use.reason : '' };
  }
  return { date, text: '', applyChanges: false, reason: '', failed: data.stop_reason === 'max_tokens' ? 'the reply was cut off before it finished' : use ? 'the reply was missing its text' : `no review in the reply (${data.stop_reason ?? 'unknown reason'})` };
}
