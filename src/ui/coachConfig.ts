import { db, getSetting, setSetting } from '../data/db';
import type { CoachConfig, Provider } from '../coach/llm';

/**
 * The coach's settings (Part F, 1 Nov 2026). The provider and the model choice
 * are shared by the rider's devices (in the sync note); the key is this device's
 * only and never leaves it. Before 1 Nov the key was `claudeKey` (Claude only);
 * it moves to `coachKey` once, with Anthropic as the provider.
 */
export const KEY_SETTING = 'coachKey';
export const PROVIDER_SETTING = 'coachProvider';
/** '' = the provider's most capable model (the default), 'faster', or a model's own name. */
export const MODEL_SETTING = 'coachModel';
/** How many judgments in a row the chosen model could not give in the right form (this device). */
export const FAILURES_SETTING = 'coachModelFailures';

export async function migrateCoachKey(): Promise<void> {
  const old = (await getSetting<string>('claudeKey', '')).trim();
  if (!old) return;
  if (!(await getSetting<string>(KEY_SETTING, '')).trim()) {
    await setSetting(KEY_SETTING, old);
    if (!(await db.settings.get(PROVIDER_SETTING))) await setSetting(PROVIDER_SETTING, 'anthropic');
  }
  await db.settings.delete('claudeKey');
}

export async function coachKey(): Promise<string> {
  await migrateCoachKey();
  return (await getSetting<string>(KEY_SETTING, '')).trim();
}

/** The coach's configuration on this device, or null without a key. */
export async function coachConfig(): Promise<CoachConfig | null> {
  const key = await coachKey();
  if (!key) return null;
  return { provider: await getSetting<Provider>(PROVIDER_SETTING, 'anthropic'), key, model: await getSetting<string>(MODEL_SETTING, '') };
}

/** A judgment the chosen model could not give in the right form, or one it did: after two in a row, Settings suggests "Most capable". */
export async function noteModelResult(ok: boolean): Promise<void> {
  const n = await getSetting<number>(FAILURES_SETTING, 0);
  const next = ok ? 0 : n + 1;
  if (next !== n) await setSetting(FAILURES_SETTING, next);
}
