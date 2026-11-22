import { getSetting, setSetting } from '../data/db';
import { askActivityPart, type ActivityPartFacts } from '../coach/claude';
import type { CoachConfig } from '../coach/llm';

/**
 * The coach in an activity's chart opened large (22 Nov 2026, brief Part C6). Opening the chart only reads the last
 * answer kept with the activity; a request is sent only when the rider asks, one per question.
 */
export interface PartAnswer { q: string; a: string; at: string; part: string }

export const partCoachKey = (activityId: string) => `activityCoach:${activityId}`;

/** The last answer for this activity, shown when the large view is next opened on it. Sends nothing. */
export function lastPartAnswer(activityId: string): Promise<PartAnswer | null> {
  return getSetting<PartAnswer | null>(partCoachKey(activityId), null);
}

/** One question, one request; the answer is kept with the activity. */
export async function askPart(activityId: string, cfg: CoachConfig, facts: ActivityPartFacts, q: string, send: typeof askActivityPart = askActivityPart): Promise<PartAnswer> {
  const a = await send(cfg, facts, q);
  const answer: PartAnswer = { q, a, at: new Date().toISOString(), part: facts.part };
  await setSetting(partCoachKey(activityId), answer);
  return answer;
}
