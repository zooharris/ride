import { walkBandWords } from '../engine/foot';
import { rideHrZones } from '../engine/zones';
/**
 * Optional narrative layer. With an API key in Settings the app asks Claude for a
 * short daily note; without one, nothing here runs. Calls go straight from the
 * browser to Anthropic with the user's own key.
 */
import type { Fitness, PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import { exerciseLine } from '../engine/record';
import type { Readiness, ReadinessDriver } from '../engine/readiness';
import { workoutStats } from '../engine/workout';
import { runStepsLine } from '../engine/run';

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
  /** The plan the calendar comes from, if any. */
  plan?: CoachPlan;
  /** Tomorrow's sessions, one line each (what they are, not their status); empty when nothing is planned. */
  tomorrow?: string[];
  /** Weekly training load (TSS) for the last four weeks, oldest first: questions get it, the note does not. */
  recentWeeks?: number[];
}

/** The plan in one line's worth of facts. */
export interface CoachPlan { name: string; goal: string; phase?: string; recoveryWeek?: boolean; daysToGo?: number; eventName?: string }

/**
 * The rider's name exactly as set, whole, or "the rider" when none is set.
 * Never a guessed first name: "zooharris" (an Intervals.icu username) was being
 * shortened to "zoo" (23 Oct 2026, Batch 7 C4).
 */
export function riderName(profile: Pick<Profile, 'name'>): string {
  return profile.name?.trim() || 'the rider';
}

/** How the coach must use the name, in every prompt. */
export function nameRule(profile: Pick<Profile, 'name'>): string {
  const name = riderName(profile);
  return name === 'the rider' ? 'No name is set: address the rider without one.' : `The rider's name is exactly "${name}"; use it exactly as written when you address them, never shortened, split or changed, and never a guessed first name. If it does not read like a name, address them without one.`;
}

/**
 * Who the coach is talking to, from the profile: never assumed. Age only when a
 * birth year is set; masters only when the rider trains on the masters rhythm.
 */
export function riderLine(profile: Profile, date: string): string {
  const age = profile.birthYear ? Number(date.slice(0, 4)) - profile.birthYear : undefined;
  const name = riderName(profile);
  const who = name === 'the rider' ? 'The rider' : `The rider ("${name}")`;
  return `${who} is a${age ? ` ${age}-year-old` : ''} road cyclist${profile.masters ? ' training on a masters recovery rhythm' : ''}, ${profile.units} units, about ${profile.hoursPerWeek} h/week, FTP ${profile.ftp} W, threshold heart rate ${profile.lthr} bpm on the bike${profile.footLthr ? ` and ${profile.footLthr} on foot` : ''} (heart-rate zone tops Z1–Z6: ${rideHrZones(profile).slice(0, 6).map((z) => Math.round(z.high * profile.lthr)).join('/')} bpm), workouts sent by ${profile.basis === 'hr' ? 'heart rate' : 'power'}.`;
}

/** The opening of every prompt: whose coach, and who they are. */
function coachIntro(profile: Profile, date: string): string {
  return `You are the rider's cycling coach. ${riderLine(profile, date)} ${nameRule(profile)}`;
}

/** The plan line (and its absence), shared by the note, questions and the review. */
export function planLine(plan: CoachPlan | undefined): string {
  if (!plan) return 'Plan: none; the rider places sessions by hand.';
  const week = plan.phase ? `; this week ${plan.phase}${plan.recoveryWeek ? ' (recovery week)' : ''}` : '';
  const togo = plan.daysToGo != null ? `; ${plan.daysToGo} days to ${plan.eventName || 'the end of the plan'}` : '';
  return `Plan: ${plan.name}, ${plan.goal}${week}${togo}.`;
}

const KIND_WORD: Record<Workout['kind'], string> = { ride: 'ride', strength: 'strength session', mobility: 'mobility session', walk: 'walk', run: 'run', other: 'session' };

/** One line per session on the day, with what it is, how big it is, and whether it is done. */
export function describeSession({ planned, workout, recorded }: TodaySession, withStatus = true, profile?: Profile): string {
  const parts: string[] = [`${workout.name} (${KIND_WORD[workout.kind]})`];
  if (workout.kind === 'ride') {
    const s = workoutStats(workout.blocks);
    parts.push(`planned duration ${durationWords(s.seconds)}, planned training load ${s.tss} TSS, IF ${s.intensityFactor.toFixed(2)}`);
  } else {
    if (workout.minutes) parts.push(`planned duration ${workout.minutes} min`);
    if (workout.estimatedTss != null) parts.push(`planned training load about ${workout.estimatedTss} TSS`);
    if (workout.kind === 'strength' && workout.effort) parts.push(`planned effort ${workout.effort}/10`);
    if (workout.kind === 'walk' && workout.walk) parts.push(`heart rate ${walkBandWords(workout.walk, profile)}`);
    if (workout.kind === 'run' && workout.run?.steps.length) parts.push(`steps: ${runStepsLine(workout, profile)}`);
    if (workout.exercises?.length) parts.push(`${workout.exercises.length} exercises: ${workout.exercises.slice(0, 6).map((e) => e.name).join(', ')}${workout.exercises.length > 6 ? '…' : ''}`);
  }
  if (workout.purpose) parts.push(workout.purpose);
  if (!withStatus) return parts.join('; ');
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

/** A driver's effect on readiness in words: "down" meant it pulled readiness down, which read as "heart rate went down". */
const EFFECT_WORDS: Record<'up' | 'down' | 'flat', string> = { up: 'better than normal', down: 'worse than normal', flat: 'normal' };

/**
 * One readiness input in words that cannot be misread: "HRV 25 ms vs 4-week normal 26 ms
 * (normal)", with anything extra the score took into account ("below normal two mornings
 * running"). The load line is said as it is.
 */
export function driverWords(d: ReadinessDriver): string {
  const note = d.note ? `; ${d.note}` : '';
  if (d.name === 'Load climbing fast') return `training load climbing fast (${d.value}; takes 5 off the score)`;
  const today = d.today ?? d.value;
  if (d.normal == null) return `${d.name} ${today}${d.unit ?? ''} (${EFFECT_WORDS[d.effect]}${note})`;
  return `${d.name} ${today}${d.unit ?? ''} vs 4-week normal ${d.normal}${d.unit ?? ''} (${EFFECT_WORDS[d.effect]}${note})`;
}

/** The day as the coach sees it: readiness, plan, notes, calendar, tomorrow, recent activities. Shared by the daily note and questions. */
export function dayFacts(ctx: CoachContext, activities = 7): string {
  const rides = ctx.recentRides.slice(0, activities).map(activityLine).join('\n');
  const sessions = ctx.todaySessions.map((s) => '- ' + describeSession(s, true, ctx.profile)).join('\n');
  const tomorrow = ctx.tomorrow?.length ? ctx.tomorrow.join('; ') : 'nothing planned';
  return `Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Readiness ${ctx.wellnessSetAside ? `not scored from wellness today: the rider set today's HRV, sleep and resting heart rate aside as wrong (${ctx.readiness.score}/100 from form alone)` : `${ctx.readiness.score}/100 (${ctx.readiness.band}); drivers: ${ctx.readiness.drivers.map(driverWords).join('; ')}`}.
${planLine(ctx.plan)}
Tomorrow: ${tomorrow}.
The rider's own note for today: ${ctx.riderNote ? `"${ctx.riderNote}"` : 'none'}.${ctx.recentNotes?.length ? `\nThe rider's notes from recent days:\n${ctx.recentNotes.map((n) => '- ' + n).join('\n')}` : ''}
On the calendar today:\n${sessions || '- nothing; a rest day unless the rider chooses otherwise'}
Missed sessions this week: ${ctx.missedThisWeek}.
Last activities:\n${rides || 'none synced yet'}`;
}

/** The medical boundary, in every prompt. */
export const MEDICAL_RULE = "You are not a doctor. If the rider's notes or question mention illness, fever, chest pain or pressure, dizziness, fainting, an irregular heartbeat or an injury, recommend rest and seeing a doctor, and give no training advice for that day beyond that.";

/** What the numbers mean, so "form −12" is read on a scale. */
export const SCALE = 'Fitness and fatigue are 42-day and 7-day weighted averages of daily training load (TSS); form is fitness minus fatigue. Form between −30 and −10 is a normal training build; below −30 is overreaching; between −10 and +5 is fresh enough for quality work; above +5 is fresh (tapered or rested). Readiness 0–100 is the app\'s morning score from HRV, sleep (length and score), resting and sleeping heart rate, breathing rate and form, each against the rider\'s own normal range over the last four weeks; a morning at the rider\'s normal scores about 70. Bands: go (Ready) 65 and up, ease (ease off a little) 50–64, easy (keep it easy) 35–49, rest below 35.';

/** Rules for everything the coach writes: the note, answers, chart answers and the review. */
export const SHARED_RULES = `Use the rider's name only exactly as given above, never shortened or guessed. Never change the plan yourself; you may suggest easing or swapping and say why. Anything the rider wrote in their own notes is the first thing to take into account: it explains the numbers, and it outranks them. If today's note names a cause that earlier notes also name, you may point out the pattern in one sentence. The calendar is the rider's plan, whether the app's plan or the rider placed each session there; durations are in minutes and training load is in TSS, two different numbers never to be compared with each other; for a session already done, speak to its recorded duration, not the planned one. Never describe who placed a session on the calendar or how it was recorded or synced; notes in brackets are background for you, not things to say. Do not invent numbers. ${MEDICAL_RULE} ${SCALE}`;

/** Rules for the daily note only: an answer about form need not walk through today's calendar. */
export const NOTE_ONLY_RULES = 'Speak to every session listed for today; do not describe the day as empty when something is listed, and do not tell the rider to do a session that is marked already done. If nothing is on the calendar, say so in one sentence and give one sentence of advice.';

/** Built prompts, separate from the calls so they can be tested. */
export function notePrompt(ctx: CoachContext): string {
  return `${coachIntro(ctx.profile, ctx.date)} Write one short note for today, addressed to the rider. Be specific, warm, and brief: 3 to 5 sentences, no headings, no bullet points, no exclamation marks. ${SHARED_RULES} ${NOTE_ONLY_RULES}\n\n${dayFacts(ctx)}`;
}

const ANSWER_RULES = "Answer plainly and specifically from the facts below, in a few sentences unless the question needs more; no headings, no exclamation marks; speak to the rider in the second person. If the facts do not answer the question, say what you would need. You cannot change the plan; if a change would help, say what and why, and that the rider can make it on the calendar or accept it among the plan's recommended changes.";

export function questionSystem(ctx: CoachContext, earlier: string[] = []): string {
  const weeks = ctx.recentWeeks?.length ? `\nWeekly training load, last ${ctx.recentWeeks.length} weeks, oldest first: ${ctx.recentWeeks.map((w) => Math.round(w)).join(' / ')} TSS` : '';
  return `${coachIntro(ctx.profile, ctx.date)} You are answering their questions about their training. ${ANSWER_RULES} ${SHARED_RULES}\n\n${dayFacts(ctx, 14)}${weeks}${earlier.length ? `\n\nWhat you have already told the rider today:\n${earlier.map((e) => '- ' + e).join('\n')}` : ''}`;
}

/**
 * Claude Sonnet 5.5 thinks before it answers unless told not to, and that thinking counts against
 * `max_tokens`: with the old 300-token limit the thinking used most of it and the note stopped
 * mid-sentence (20 Oct 2026). The coach's notes are short and need no thinking, so it is turned off
 * (`between_tools`, the model's lowest setting; there are no tools here), with room to spare.
 * Checked against the API docs on 21 Oct 2026: `between_tools` is Sonnet 5.5's lowest setting and
 * is accepted without tools at effort high or below (the default); `disabled` is a 400 on Sonnet 5.5.
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
  return callClaude(apiKey, { max_tokens: 1500, messages: [{ role: 'user', content: notePrompt(ctx) }] });
}

/** `error`: a question that got no answer; shown as an error, never saved, never sent back as history. */
export interface ChatTurn { role: 'rider' | 'coach'; text: string; at?: string; error?: true }

/**
 * A question from the rider, answered with the same picture of the day the
 * daily note uses, plus what the coach already said today. Answers only: the
 * plan changes through the suggested-changes review, never from here.
 */
export async function askCoach(apiKey: string, ctx: CoachContext, turns: ChatTurn[], question: string, earlier: string[] = []): Promise<string> {
  return callClaude(apiKey, { max_tokens: 2000, system: questionSystem(ctx, earlier), messages: [...chatHistory(turns), { role: 'user', content: question }] });
}

/** Earlier turns sent back as history: a question that got no answer goes with its error, so the two roles alternate. */
export function chatHistory(turns: ChatTurn[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const kept = turns.filter((t, i) => !t.error && !(t.role === 'rider' && turns[i + 1]?.error));
  return kept.slice(-8).map((t) => ({ role: t.role === 'rider' ? 'user' as const : 'assistant' as const, content: t.text }));
}

/** What is on the Progress chart, for a question about it: the range, one line per visible series, and the sessions in the range. */
export interface ChartContext {
  profile: Profile;
  date: string;
  from: string;
  to: string;
  lines: string[];
  sessions: string[];
}

/**
 * A question about the Progress chart. The questions prompt, with the facts of
 * the day replaced by what the chart shows: each visible line's first, last,
 * lowest and highest with dates (and what kind of day came before a morning
 * reading), and the sessions in the range. Answers only; never changes the plan.
 */
export function chartSystem(ctx: ChartContext): string {
  return `${coachIntro(ctx.profile, ctx.date)} You are answering their questions about their training. ${ANSWER_RULES} ${SHARED_RULES}

The rider is looking at a chart of ${ctx.from} to ${ctx.to}. What it shows:
${ctx.lines.map((l) => '- ' + l).join('\n')}
Sessions in that range, newest first (date · kind · minutes · training load):
${ctx.sessions.length ? ctx.sessions.map((l) => '- ' + l).join('\n') : '- none'}`;
}

export async function askAboutChart(apiKey: string, ctx: ChartContext, question: string): Promise<string> {
  return callClaude(apiKey, { max_tokens: 1500, system: chartSystem(ctx), messages: [{ role: 'user', content: question }] });
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
  plan?: CoachPlan;
  tomorrow?: string[];
  /** The plan's own sentences on why it proposes changes (the re-check's summary). */
  why?: string[];
}

/** The coach's view of one proposed change, keyed by its date and kind (Batch 6, C5). */
export interface CoachVerdict { date: string; kind: string; apply: boolean; why: string }

export interface CoachReview {
  date: string;
  text: string;
  /** Claude's view of each proposed change. Reviews saved before 23 Oct 2026 have none; their view is in applyChanges and skip. */
  verdicts?: CoachVerdict[];
  /** Derived from the verdicts for older readers: all of it, none of it, or all but the dates in `skip`. */
  applyChanges: 'all' | 'some' | 'none';
  skip: string[];
  reason: string;
  /** Which proposals the review judged: the app's signature of the change list it was shown. */
  changesSig?: string;
  /** 'sync' after new activities; 'recheck' for the plan's own daily re-check (C6). */
  mode?: 'sync' | 'recheck';
  /** Set when the coach's reply could not be read: why, for troubleshooting. The text is then empty and never shown. */
  failed?: string;
}

/**
 * After new activities arrive: Claude reads the same evidence the planner used,
 * plus the planner's proposed changes, and gives a view. It never changes the
 * plan; the rider does, with one tap.
 */
export function reviewPrompt(ctx: ReviewContext): string {
  const tomorrow = ctx.tomorrow?.length ? ctx.tomorrow.join('; ') : 'nothing planned';
  return `${coachIntro(ctx.profile, ctx.date)} You are reviewing their new training data. Answer in the JSON form given. "text" is 4 to 7 plain sentences to the rider, in the second person: what the new activities show, what matters this week, and what you recommend; no headings, bullets or exclamation marks. ${VERDICT_RULES} When a new activity completed a planned session, judge it on its recorded duration against the planned duration. The verdict on-track / close / short is whether the plan reaches the fitness the goal needs by its date. The rider's own notes below explain the numbers and outrank them: a poor night the rider has explained is not training fatigue, and wellness the rider set aside as wrong has already been left out of every average. ${SHARED_RULES}

Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
${planLine(ctx.plan)}
Tomorrow: ${tomorrow}.
Goal: ${ctx.goal}. Current verdict: ${ctx.verdict}. ${ctx.advice}
What the data say about the rider:\n${ctx.assessmentNotes.map((n) => '- ' + n).join('\n')}
New activities just arrived:\n${ctx.newActivities.map((n) => '- ' + n).join('\n') || '- none'}
Last week:\n${ctx.lastWeek.map((n) => '- ' + n).join('\n') || '- nothing to report'}
The app's proposed plan changes:\n${ctx.proposedChanges.map((n) => '- ' + n).join('\n') || '- no changes proposed'}
The rider's notes this week:\n${ctx.riderNotes.map((n) => '- ' + n).join('\n') || '- none'}`;
}

/** How the coach judges the proposed changes, shared by both review prompts (Batch 6, C5). */
const VERDICT_RULES = `"verdicts" has one entry for every proposed change listed below, no more and no fewer: its "date" (YYYY-MM-DD) and "kind" exactly as the change's line gives them, "apply" true when the rider should accept it as it stands and false when not, and "why" in twelve words or fewer. Every proposed change is a named workout from the rider's library; judge it as that workout. "reason" is one sentence on the changes as a whole, and must agree with the verdicts. Changes more than two weeks out are provisional: the plan re-checks itself every day and will review them again as they come near, so skipping one costs nothing.`;

/**
 * The plan re-checked itself this morning (Batch 6, C6): Claude reads the same
 * evidence and the proposed changes and gives a view of each. No new activity
 * is needed for this, and none is pretended.
 */
export function recheckPrompt(ctx: ReviewContext): string {
  const tomorrow = ctx.tomorrow?.length ? ctx.tomorrow.join('; ') : 'nothing planned';
  return `${coachIntro(ctx.profile, ctx.date)} The plan re-checked itself this morning against the rider's data and proposes the changes below. Answer in the JSON form given. "text" is 3 to 5 plain sentences to the rider, in the second person: whether the changes are worth making and why; "nothing to decide today" is a good answer when none of them matters yet. No headings, bullets or exclamation marks. ${VERDICT_RULES} A session the rider placed, moved or changed by hand is theirs and is never among these changes. The rider's own notes below explain the numbers and outrank them. ${SHARED_RULES}

Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
${planLine(ctx.plan)}
Tomorrow: ${tomorrow}.
Goal: ${ctx.goal}. Current verdict: ${ctx.verdict}. ${ctx.advice}
What the data say about the rider:\n${ctx.assessmentNotes.map((n) => '- ' + n).join('\n')}
${ctx.newActivities.length ? `New activities:\n${ctx.newActivities.map((n) => '- ' + n).join('\n')}\n` : ''}Last week:\n${ctx.lastWeek.map((n) => '- ' + n).join('\n') || '- nothing to report'}
Why the plan proposes changes:\n${ctx.why?.map((n) => '- ' + n).join('\n') || '- no reason given'}
The proposed changes (date, kind, what):\n${ctx.proposedChanges.map((n) => '- ' + n).join('\n') || '- no changes proposed'}
The rider's notes this week:\n${ctx.riderNotes.map((n) => '- ' + n).join('\n') || '- none'}`;
}

/**
 * After new activities arrive: Claude reads the same evidence the planner used,
 * plus the planner's proposed changes, and gives a view per change. It never
 * changes the plan; the rider does, with one tap.
 *
 * The one call that thinks first. Sonnet 5.5 refuses a thinking budget
 * (`type: 'enabled'` is a 400 on the Claude 5 models), so it thinks adaptively
 * at medium effort, with room for the thinking and the answer together.
 */
export async function reviewAfterSync(apiKey: string, ctx: ReviewContext, mode: 'sync' | 'recheck' = 'sync'): Promise<CoachReview> {
  // The answer comes back in a fixed JSON form (structured outputs). Sonnet 5.5 refuses a forced tool
  // call, which is how this was asked for before 20 Oct 2026.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      messages: [{ role: 'user', content: mode === 'recheck' ? recheckPrompt(ctx) : reviewPrompt(ctx) }],
    }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  return { ...readReview(ctx.date, await res.json()), mode };
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '4 to 7 plain sentences to the rider.' },
    verdicts: {
      type: 'array',
      description: 'One entry per proposed change: its date and kind as given, whether to apply it, and why in twelve words or fewer.',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD, as the change gives it.' },
          kind: { type: 'string', enum: ['ride', 'strength', 'walk', 'run', 'mobility', 'other'] },
          apply: { type: 'boolean' },
          why: { type: 'string' },
        },
        required: ['date', 'kind', 'apply', 'why'],
        additionalProperties: false,
      },
    },
    reason: { type: 'string', description: 'One sentence on the changes as a whole; it agrees with the verdicts.' },
  },
  required: ['text', 'verdicts', 'reason'],
  additionalProperties: false,
};

/** The review out of Claude's reply, or a failed review that says why, never raw text. */
export function readReview(date: string, data: { content?: Array<{ type: string; input?: unknown; text?: string }>; stop_reason?: string }): CoachReview {
  type Answer = { text?: unknown; applyChanges?: unknown; skip?: unknown; verdicts?: unknown; reason?: unknown };
  // The JSON form arrives as text; an older tool-call reply is read the same way.
  let use = data.content?.find((c) => c.type === 'tool_use')?.input as Answer | undefined;
  if (!use && data.stop_reason !== 'max_tokens') {
    const raw = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    try { const v = JSON.parse(raw); if (v && typeof v === 'object') use = v as Answer; } catch { /* not JSON: a failed review below */ }
  }
  if (use && typeof use.text === 'string' && use.text.trim()) {
    return { date, text: use.text.trim(), ...readVerdict(use), reason: typeof use.reason === 'string' ? use.reason : '' };
  }
  return { date, text: '', verdicts: undefined, applyChanges: 'none', skip: [], reason: '', failed: data.stop_reason === 'max_tokens' ? 'the reply was cut off before it finished' : use ? 'the reply was missing its text' : `no review in the reply (${data.stop_reason ?? 'unknown reason'})` };
}

/**
 * The coach's verdict on the proposed changes. The form since 23 Oct 2026 is
 * one verdict per change (date, kind, apply, why); the older fields are derived
 * from it, so readers that only know "all / some / none" still work. A review
 * saved in the older form (all / some with dates to skip, or before 21 Oct a
 * plain yes/no) still reads, with no per-change verdicts.
 */
export function readVerdict(v: { applyChanges?: unknown; skip?: unknown; verdicts?: unknown }): Pick<CoachReview, 'applyChanges' | 'skip' | 'verdicts'> {
  if (Array.isArray(v.verdicts)) {
    const verdicts: CoachVerdict[] = v.verdicts
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((x) => typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.kind === 'string' && typeof x.apply === 'boolean')
      .map((x) => ({ date: x.date as string, kind: (x.kind as string).toLowerCase(), apply: x.apply as boolean, why: typeof x.why === 'string' ? x.why : '' }));
    const skip = [...new Set(verdicts.filter((x) => !x.apply).map((x) => x.date))];
    const applyChanges = !verdicts.length || verdicts.every((x) => !x.apply) ? 'none' : verdicts.every((x) => x.apply) ? 'all' : 'some';
    return { applyChanges, skip, verdicts };
  }
  // Structured outputs do not promise the capitalisation of enum values, so compare lower-case.
  const a = typeof v.applyChanges === 'string' ? v.applyChanges.toLowerCase() : v.applyChanges;
  const skip = a === 'some' && Array.isArray(v.skip) ? v.skip.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
  // "Some" with no date named is all of them: the coach made no exception.
  const applyChanges = a === true || a === 'all' || (a === 'some' && !skip.length) ? 'all' : a === 'some' ? 'some' : 'none';
  return { applyChanges, skip, verdicts: undefined };
}

/**
 * What the day's note was written from: the sessions (with their status and recording), the
 * rider's note and wellness flag, and the readiness band once the morning's wellness is in. The
 * note is rewritten when this changes: when the watch syncs and moves the band, not when only
 * a name in Settings changes. v5 (23 Oct 2026): the note is rewritten once, so it uses the rider's name exactly as set.
 */
export function noteSignature(d: { sessions: string[]; noteText?: string; badWellness?: boolean; wellnessToday: boolean; band: Readiness['band']; plan?: CoachPlan }): string {
  return `v5|${d.sessions.join(',')}|${d.noteText ?? ''}|${d.badWellness ? 'bad' : ''}|${d.wellnessToday ? d.band : 'nowellness'}|${d.plan ? `${d.plan.name}:${d.plan.phase ?? ''}` : ''}`;
}

// ── Step 2 (29 Oct): FTP estimate and zone analysis ────────────────────────

export type ThresholdMode = 'ftp' | 'zones';
export type Confidence = 'settled' | 'mixed' | 'thin';

export interface FtpAdvice { mode: 'ftp'; ftp?: number; why: string; confidence: Confidence; needsTest?: string; failed?: string }
export interface ZoneAdvice { mode: 'zones'; powerTops?: number[]; hrTops?: number[]; why: string[]; trust: string; confidence: Confidence; needsTest?: string; failed?: string }
export type ThresholdAdvice = FtpAdvice | ZoneAdvice;

/** The question for each mode, after the coach's introduction and the evidence (the lines from `gatherEvidence`). */
export function thresholdPrompt(profile: Profile, date: string, evidence: string[], mode: ThresholdMode): string {
  const ask = mode === 'ftp'
    ? `Give your best estimate of the rider's FTP today, in whole watts, and say in two or three plain sentences which evidence you leaned on and why. If the sources disagree by more than 5%, say so in "needsTest" and say which a fresh ramp test would settle; otherwise leave "needsTest" empty. Never suggest a number above the best 20-minute power × 0.97 or below the best 60-minute power. Treat the critical power fit as the ceiling of what the rider has shown. Use the judged planned hard sessions to say whether the current FTP is working in training: held with heart rate low means it is set low; fell short, or held with heart rate high, means it is set high. Use the power at a steady heart rate only to say which way fitness is moving, never as a number for FTP. If there is too little evidence, say so plainly in "why", set "confidence" to "thin", and give your best number anyway only if one source is solid; otherwise give 0.`
    : `Propose a power zone table (the tops of zones 1 to 6 in whole watts, each higher than the last) and a heart-rate zone table (the tops of zones 1 to 6 in whole bpm, each higher than the last, all below max heart rate; zone 7 runs to max) for this rider. Keep a boundary where it is unless the rider's own data say otherwise (the heart rate on rides in each power zone, drift on steady rides, where their time falls, any recent test); when you move one, give one plain sentence for it in "why", naming the zone and the number, from and to. Use the heart rate measured in each power band to check that the two tables describe the same efforts. Where the power table and the heart-rate table disagree about the same effort, say in "trust" which to trust and why, in one or two sentences; otherwise say they agree. If the evidence is too thin to move a boundary, leave it as it is, set "confidence" to "thin" and say in "why" what would be enough evidence (how many more rides of what kind, or a ramp test). Say in "needsTest" if a ramp test would settle something; otherwise leave it empty.`;
  return `${coachIntro(profile, date)} You are reviewing the rider's training thresholds. Write to the rider in the second person, in plain English: every number with its unit, no abbreviations a non-specialist would not know (say "training load", not "CTL"). Answer in the JSON form given.

${ask}

The evidence:
${evidence.map((l) => '- ' + l).join('\n')}`;
}

const CONFIDENCE = { type: 'string', enum: ['settled', 'mixed', 'thin'], description: 'settled: the evidence agrees; mixed: it disagrees; thin: too little of it.' };
const FTP_SCHEMA = {
  type: 'object',
  properties: {
    ftp: { type: 'integer', description: 'The FTP estimate in watts; 0 when there is too little evidence to give one.' },
    why: { type: 'string', description: 'Two or three plain sentences: which evidence, and why.' },
    confidence: CONFIDENCE,
    needsTest: { type: 'string', description: 'What a ramp test would settle, in one sentence; empty when nothing.' },
  },
  required: ['ftp', 'why', 'confidence', 'needsTest'],
  additionalProperties: false,
};
const ZONE_SCHEMA = {
  type: 'object',
  properties: {
    powerTops: { type: 'array', items: { type: 'integer' }, description: 'Tops of power zones 1-6 in watts.' },
    hrTops: { type: 'array', items: { type: 'integer' }, description: 'Tops of heart-rate zones 1-6 in bpm.' },
    why: { type: 'array', items: { type: 'string' }, description: 'One sentence per boundary moved; or what evidence would be enough.' },
    trust: { type: 'string', description: 'Where the two tables disagree, which to trust and why; or that they agree.' },
    confidence: CONFIDENCE,
    needsTest: { type: 'string', description: 'What a ramp test would settle; empty when nothing.' },
  },
  required: ['powerTops', 'hrTops', 'why', 'trust', 'confidence', 'needsTest'],
  additionalProperties: false,
};

const ascending = (xs: unknown): number[] | undefined => {
  if (!Array.isArray(xs) || xs.length !== 6) return undefined;
  const n = xs.map((x) => Math.round(Number(x)));
  for (let i = 0; i < 6; i++) if (!(n[i] > 0) || (i > 0 && n[i] <= n[i - 1])) return undefined;
  return n;
};
const conf = (x: unknown): Confidence => (x === 'settled' || x === 'mixed' || x === 'thin' ? x : 'mixed');
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);

/**
 * The coach's answer, checked: an FTP outside what the best efforts allow is
 * brought inside them; zone tables must be six rising tops (heart rate below
 * max) or they are dropped. A reply that can't be read says why.
 */
export function readThreshold(mode: ThresholdMode, data: { content?: Array<{ type: string; text?: string }>; stop_reason?: string }, limits: { best20?: number; best60?: number; maxHr?: number } = {}): ThresholdAdvice {
  const raw = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  let v: Record<string, unknown> | undefined;
  if (data.stop_reason !== 'max_tokens') { try { const j = JSON.parse(raw); if (j && typeof j === 'object') v = j; } catch { /* below */ } }
  const failed = !v ? (data.stop_reason === 'max_tokens' ? 'the reply was cut off before it finished' : 'the reply could not be read') : undefined;
  if (mode === 'ftp') {
    if (!v) return { mode, why: '', confidence: 'thin', failed };
    let ftp = Math.round(Number(v.ftp));
    if (!(ftp > 0)) ftp = 0;
    if (ftp && limits.best20) ftp = Math.min(ftp, Math.round(limits.best20 * 0.97));
    if (ftp && limits.best60) ftp = Math.max(ftp, limits.best60);
    const why = str(v.why);
    if (!why) return { mode, why: '', confidence: 'thin', failed: 'the reply was missing its reasoning' };
    return { mode, ftp: ftp || undefined, why, confidence: conf(v.confidence), needsTest: str(v.needsTest) };
  }
  if (!v) return { mode, why: [], trust: '', confidence: 'thin', failed };
  const powerTops = ascending(v.powerTops);
  let hrTops = ascending(v.hrTops);
  if (hrTops && limits.maxHr && hrTops[5] >= limits.maxHr) hrTops = undefined;
  const why = Array.isArray(v.why) ? v.why.map(str).filter((x): x is string => !!x) : [];
  return { mode, powerTops, hrTops, why, trust: str(v.trust) ?? '', confidence: conf(v.confidence), needsTest: str(v.needsTest), failed: !powerTops && !hrTops && !why.length ? 'the reply had no zones and no reasons' : undefined };
}

/** Ask the coach for an FTP estimate or a zone analysis, from the evidence lines. */
export async function askThreshold(apiKey: string, profile: Profile, date: string, evidence: string[], mode: ThresholdMode, limits: { best20?: number; best60?: number; maxHr?: number } = {}): Promise<ThresholdAdvice> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: mode === 'ftp' ? FTP_SCHEMA : ZONE_SCHEMA } },
      messages: [{ role: 'user', content: thresholdPrompt(profile, date, evidence, mode) }],
    }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  return readThreshold(mode, await res.json(), limits);
}
