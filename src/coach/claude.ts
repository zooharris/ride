/**
 * Optional narrative layer. With an API key in Settings the app asks Claude for a
 * short daily note; without one, nothing here runs. Calls go straight from the
 * browser to Anthropic with the user's own key.
 */
import type { Fitness, PlannedWorkout, Profile, Ride, Workout } from '../engine/types';
import type { Readiness } from '../engine/readiness';
import { workoutStats } from '../engine/workout';

const MODEL = 'claude-sonnet-5-5';

/** One session on today's calendar, whoever put it there. */
export interface TodaySession {
  planned: PlannedWorkout;
  workout: Workout;
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
export function describeSession({ planned, workout }: TodaySession): string {
  const parts: string[] = [`${workout.name} (${KIND_WORD[workout.kind]})`];
  if (workout.kind === 'ride') {
    const s = workoutStats(workout.blocks);
    parts.push(`${Math.round(s.seconds / 60)} min, TSS ${s.tss}, IF ${s.intensityFactor.toFixed(2)}`);
  } else {
    if (workout.minutes) parts.push(`${workout.minutes} min`);
    if (workout.estimatedTss != null) parts.push(`about ${workout.estimatedTss} TSS`);
    if (workout.kind === 'strength' && workout.effort) parts.push(`planned effort ${workout.effort}/10`);
    if (workout.kind === 'walk' && workout.walk) parts.push(workout.walk.hrLow > 0 ? `heart rate ${Math.round(workout.walk.hrLow * 100)}–${Math.round(workout.walk.hrHigh * 100)}% of max` : `no minimum heart rate, up to ${Math.round(workout.walk.hrHigh * 100)}% of max`);
    if (workout.exercises?.length) parts.push(`${workout.exercises.length} exercises: ${workout.exercises.slice(0, 6).map((e) => e.name).join(', ')}${workout.exercises.length > 6 ? '…' : ''}`);
  }
  if (workout.purpose) parts.push(workout.purpose);
  const status = planned.status === 'completed' ? `ALREADY DONE today${planned.rpe ? `, felt ${planned.rpe}/10` : ''}${planned.loggedSeconds ? `, ${Math.round(planned.loggedSeconds / 60)} min logged` : ''}`
    : planned.status === 'sent' ? 'on the Garmin, not done yet'
    : planned.status === 'missed' ? 'marked missed'
    : 'not done yet';
  parts.push(status);
  if (!planned.planId) parts.push('added by the rider, not by the plan');
  return parts.join('; ');
}

export async function dailyNote(apiKey: string, ctx: CoachContext): Promise<string> {
  const rides = ctx.recentRides.slice(0, 7).map((r) => `${r.date}: ${r.name} (${r.sport}), ${Math.round(r.seconds / 60)} min, TSS ${r.tss ?? '?'}${r.normalizedPower ? `, NP ${r.normalizedPower}W` : ''}${r.averageHr ? `, avg HR ${r.averageHr}` : ''}`).join('\n');
  const sessions = ctx.todaySessions.map((s) => '- ' + describeSession(s)).join('\n');
  const prompt = `You are a cycling coach writing one short note for today to a masters road cyclist (over 50). Be specific, warm, and brief: 3 to 5 sentences, no headings, no bullet points, no exclamation marks. Never change the plan yourself; you may suggest easing or swapping and say why. Anything the rider wrote in their own notes is the first thing to take into account: it explains the numbers, and it outranks them. If today's note names a cause that earlier notes also name, you may point out the pattern in one sentence. The calendar below is the rider's plan for today, whether the app's plan or the rider placed each session there; speak to every session listed, do not describe the day as empty when something is listed, and do not tell the rider to do a session that is marked already done.

Athlete: FTP ${ctx.profile.ftp} W, LTHR ${ctx.profile.lthr} bpm, trains ${ctx.profile.hoursPerWeek} h/week, basis ${ctx.profile.basis}.
Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Readiness ${ctx.wellnessSetAside ? `not scored from wellness today: the rider set today's HRV, sleep and resting heart rate aside as wrong (${ctx.readiness.score}/100 from form alone)` : `${ctx.readiness.score}/100 (${ctx.readiness.band}); drivers: ${ctx.readiness.drivers.map((d) => `${d.name} ${d.value} (${d.effect})`).join('; ')}`}.
The rider's own note for today: ${ctx.riderNote ? `"${ctx.riderNote}"` : 'none'}.${ctx.recentNotes?.length ? `\nThe rider's notes from recent days:\n${ctx.recentNotes.map((n) => '- ' + n).join('\n')}` : ''}
On the calendar today:\n${sessions || '- nothing; a rest day unless the rider chooses otherwise'}
Missed sessions this week: ${ctx.missedThisWeek}.
Last activities:\n${rides || 'none synced yet'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude answered ${res.status}. Check the API key in Settings.`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
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
}

/**
 * After new activities arrive: Claude reads the same evidence the planner used,
 * plus the planner's proposed changes, and gives a view. It never changes the
 * plan; the rider does, with one tap.
 */
export async function reviewAfterSync(apiKey: string, ctx: ReviewContext): Promise<CoachReview> {
  const prompt = `You are a cycling coach reviewing a masters rider's new training data. Reply ONLY with JSON of the form {"text": string, "applyChanges": boolean, "reason": string}. "text" is 4 to 7 plain sentences to the rider: what the new activities show, what matters, and what you recommend; no headings, bullets or exclamation marks. "applyChanges" is whether the app's proposed plan changes below should be applied as they stand; "reason" is one sentence on why. Do not invent numbers. The rider's own notes below explain the numbers and outrank them: a poor night the rider has explained is not training fatigue, and wellness the rider set aside as wrong has already been left out of every average. If the same cause recurs across notes (wine, travel, poor sleep), say so, briefly.

Athlete: FTP ${ctx.profile.ftp} W, LTHR ${ctx.profile.lthr} bpm. Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Goal: ${ctx.goal}. Current verdict: ${ctx.verdict}. ${ctx.advice}
What the data say about the rider:\n${ctx.assessmentNotes.map((n) => '- ' + n).join('\n')}
New activities just arrived:\n${ctx.newActivities.map((n) => '- ' + n).join('\n') || '- none'}
Last week:\n${ctx.lastWeek.map((n) => '- ' + n).join('\n') || '- nothing to report'}
The app's proposed plan changes:\n${ctx.proposedChanges.map((n) => '- ' + n).join('\n') || '- no changes proposed'}
The rider's notes this week:\n${ctx.riderNotes.map((n) => '- ' + n).join('\n') || '- none'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Claude answered ${res.status}. Check the API key in Settings.`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  try {
    const parsed = JSON.parse(json) as { text: string; applyChanges: boolean; reason: string };
    return { date: ctx.date, text: parsed.text, applyChanges: !!parsed.applyChanges, reason: parsed.reason ?? '' };
  } catch {
    return { date: ctx.date, text: raw, applyChanges: false, reason: '' };
  }
}
