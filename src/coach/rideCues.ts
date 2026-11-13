import type { Workout, WorkoutBlock, WorkoutStep } from '../engine/types';
import { complete, type CoachConfig } from './llm';
import { CUE_MAX } from '../library/cueKinds';

/**
 * Cues written by the rider's own AI (12 Nov 2026, brief B6). Only on trainer rides in the player, only with an AI
 * connected, and only before the ride starts: nothing in a ride depends on a connection. The AI is given the ride's
 * steps, its written cues and the rider's recent history, and may only reword a cue in the same spirit or make it
 * refer to the rider's own history. It returns cue text attached to the written cues' own moments; it can never
 * change a target, a duration, the order of steps or the ride. Anything else in its answer is ignored.
 */

export const AI_CUE_TIMEOUT_MS = 10_000;

/** A number with a unit of effort: a target, which only the ride itself may state. */
const TARGET = /\d[\d.,]*\s*(?:w\b|watts?\b|bpm\b|beats\b|%|per\s?cent\b|percent\b|rpm\b)/i;

/** Every written cue, with an id that names its moment: block, step in the block, and cue. */
export function cueMoments(w: Workout): Array<{ id: string; step: WorkoutStep; text: string; set?: string }> {
  const out: Array<{ id: string; step: WorkoutStep; text: string; set?: string }> = [];
  w.blocks.forEach((b, bi) => {
    const steps = b.kind === 'step' ? [b] : b.steps;
    steps.forEach((s, si) => (s.cues ?? []).forEach((c, ci) => out.push({ id: `${bi}.${b.kind === 'step' ? 0 : si}.${ci}`, step: s, text: c.text, set: b.kind === 'repeat' ? `${b.label ?? 'set'} × ${b.times}` : undefined })));
  });
  return out;
}

/** Whether a cue the AI wrote may be used: short enough to read in one glance, and stating no target. */
export function cueAllowed(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0 && text.trim().length <= CUE_MAX && !TARGET.test(text);
}

/** The ride with the AI's cues put in the written cues' places; any cue it did not write, or wrote badly, stays as written. */
export function applyCues(w: Workout, written: Record<string, unknown>): { workout: Workout; changed: number } {
  let changed = 0;
  const blocks = w.blocks.map((b, bi): WorkoutBlock => {
    const fix = (s: WorkoutStep, si: number): WorkoutStep => (s.cues?.length ? { ...s, cues: s.cues.map((c, ci) => {
      const t = written[`${bi}.${si}.${ci}`];
      if (!cueAllowed(t) || t.trim() === c.text) return c;
      changed++;
      return { ...c, text: t.trim() };
    }) } : s);
    return b.kind === 'step' ? fix(b, 0) : { ...b, steps: b.steps.map(fix) };
  });
  return { workout: { ...w, blocks }, changed };
}

const step = (s: WorkoutStep) => `${Math.round(s.seconds / 60 * 10) / 10} min${s.allOut ? ', all out' : `, ${Math.round(s.intensity * 100)}${s.intensityHigh ? `–${Math.round(s.intensityHigh * 100)}` : ''}% of FTP`}${s.cadence ? `, ${s.cadence} rpm` : ''}${s.label ? ` (${s.label})` : ''}`;

/** The request: the ride, its cues by id, and the rider's history. */
export function cuePrompt(w: Workout, history: string[]): { system: string; user: string } {
  const moments = cueMoments(w);
  const system = [
    'You rewrite the in-ride text cues of an indoor cycling workout for one rider, before the ride starts. The cues appear one at a time on a single line of the ride player, read while riding hard.',
    'Rules: keep each cue to the same moment and the same purpose (why this effort matters, what to focus on, a word at the hard point, what comes next, or a short lesson). You may reword a cue, or make it refer to the rider\'s own recent history (for example "Last Tuesday you held this for four efforts. Today is five."). Never state a target: no watts, heart rates, percentages or cadences. Never change the workout, its targets, durations or order. Never promise a result. Plain words, spoken to the rider, at most 110 characters each. Leave out any cue you would not improve.',
    'Answer only with JSON: {"cues": {"<id>": "<new text>", ...}}.',
  ].join('\n');
  const user = [
    `Workout: ${w.name}${w.subtitle ? ` (${w.subtitle})` : ''}.`,
    'Cues, by id, with the step each belongs to:',
    ...moments.map((m) => `${m.id}: [${step(m.step)}${m.set ? `, in ${m.set}` : ''}] ${m.text}`),
    history.length ? `The rider's recent riding:\n${history.map((h) => `- ${h}`).join('\n')}` : 'No recent riding is known.',
  ].join('\n');
  return { system, user };
}

/** Pulls the cues out of the AI's answer; anything that is not cues is ignored. */
export function readCues(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    const j = JSON.parse(m[0]) as { cues?: unknown };
    return j && typeof j.cues === 'object' && j.cues && !Array.isArray(j.cues) ? j.cues as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Asks the AI, and gives up after `timeoutMs` or on any error: the ride then starts with its written cues and the
 * rider sees no error. Resolves to the ride with the AI's cues and how many it changed, or undefined.
 */
export async function aiCues(cfg: CoachConfig, w: Workout, history: string[], timeoutMs = AI_CUE_TIMEOUT_MS,
  ask: (cfg: CoachConfig, system: string, user: string) => Promise<string> = defaultAsk): Promise<{ workout: Workout; changed: number } | undefined> {
  if (!cueMoments(w).length) return undefined;
  const { system, user } = cuePrompt(w, history);
  const late = new Promise<undefined>((r) => setTimeout(() => r(undefined), timeoutMs));
  try {
    const text = await Promise.race([ask(cfg, system, user), late]);
    if (typeof text !== 'string') return undefined;
    const r = applyCues(w, readCues(text));
    return r.changed ? r : undefined;
  } catch { return undefined; }
}

async function defaultAsk(cfg: CoachConfig, system: string, user: string): Promise<string> {
  const r = await complete(cfg, { system, messages: [{ role: 'user', content: user }], maxTokens: 3000 });
  return r.content.map((c) => c.text).join('');
}
