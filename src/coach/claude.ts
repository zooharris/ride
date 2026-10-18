/**
 * Optional narrative layer. With an API key in Settings the app asks Claude for a
 * short daily note; without one, nothing here runs. Calls go straight from the
 * browser to Anthropic with the user's own key.
 */
import type { Fitness, Profile, Ride, Workout } from '../engine/types';
import type { Readiness } from '../engine/readiness';
import { workoutStats } from '../engine/workout';

const MODEL = 'claude-sonnet-5-5';

export interface CoachContext {
  profile: Profile;
  date: string;
  fitness?: Fitness;
  readiness: Readiness;
  todayWorkout?: Workout;
  recentRides: Ride[];
  missedThisWeek: number;
}

export async function dailyNote(apiKey: string, ctx: CoachContext): Promise<string> {
  const w = ctx.todayWorkout ? workoutStats(ctx.todayWorkout.blocks) : undefined;
  const rides = ctx.recentRides.slice(0, 7).map((r) => `${r.date}: ${r.name}, ${Math.round(r.seconds / 60)} min, TSS ${r.tss ?? '?'}${r.normalizedPower ? `, NP ${r.normalizedPower}W` : ''}${r.averageHr ? `, avg HR ${r.averageHr}` : ''}`).join('\n');
  const prompt = `You are a cycling coach writing one short note for today to a masters road cyclist (over 50). Be specific, warm, and brief: 3 to 5 sentences, no headings, no bullet points, no exclamation marks. Never change the plan yourself; you may suggest easing or swapping and say why.

Athlete: FTP ${ctx.profile.ftp} W, LTHR ${ctx.profile.lthr} bpm, trains ${ctx.profile.hoursPerWeek} h/week, basis ${ctx.profile.basis}.
Today ${ctx.date}. Fitness ${ctx.fitness?.ctl ?? '?'}, fatigue ${ctx.fitness?.atl ?? '?'}, form ${ctx.fitness?.tsb ?? '?'}.
Readiness ${ctx.readiness.score}/100 (${ctx.readiness.band}); drivers: ${ctx.readiness.drivers.map((d) => `${d.name} ${d.value} (${d.effect})`).join('; ')}.
Planned today: ${ctx.todayWorkout ? `${ctx.todayWorkout.name}, ${Math.round((w?.seconds ?? 0) / 60)} min, TSS ${w?.tss}, ${ctx.todayWorkout.purpose}` : 'nothing planned'}.
Missed sessions this week: ${ctx.missedThisWeek}.
Last rides:\n${rides || 'none synced yet'}`;

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
