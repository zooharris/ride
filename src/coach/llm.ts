/**
 * The re-check thinks (1 Nov 2026), Part F: the coach on any of the three
 * providers a rider can get a key for: Anthropic (Claude), OpenAI and Google
 * (Gemini). One interface, one adapter each. Calls go straight from the browser
 * to the provider with the rider's own key; nothing passes through anyone else.
 *
 * Replies are returned in one shape (the text, and whether it was cut off), so
 * every reader of the coach's answers works whichever provider wrote them. The
 * model is chosen from the provider's own current list by rule (the most capable
 * general model, and one faster one), so the app keeps up as providers release
 * new models, and a rider who never touches the setting keeps getting the best.
 */
export type Provider = 'anthropic' | 'openai' | 'google';
export const PROVIDERS: Array<{ id: Provider; name: string; keyHint: string; where: string }> = [
  { id: 'anthropic', name: 'Anthropic (Claude)', keyHint: 'sk-ant-…', where: 'console.anthropic.com → API keys' },
  { id: 'openai', name: 'OpenAI (ChatGPT)', keyHint: 'sk-…', where: 'platform.openai.com → API keys' },
  { id: 'google', name: 'Google (Gemini)', keyHint: 'AIza…', where: 'aistudio.google.com → Get API key' },
];
export const providerName = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.name ?? p;

/** `model`: empty for the provider's most capable model (the default), 'faster' for its faster one, or a model's own name. */
export interface CoachConfig { provider: Provider; key: string; model?: string }

export type Think = 'none' | 'medium' | 'high';
export interface CompleteRequest {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** A JSON schema the reply must keep to; the reply's text is then that JSON. */
  schema?: Record<string, unknown>;
  maxTokens: number;
  think?: Think;
}
/** The reply in the shape every reader already takes. */
export interface CompleteReply { content: Array<{ type: 'text'; text: string }>; stop_reason: string }

/** Raised when the provider would not take a call from a web page at all (a browser refusal, not an error reply). */
export class BrowserRefused extends Error {}

const reply = (text: string, cut: boolean): CompleteReply => ({ content: [{ type: 'text', text }], stop_reason: cut ? 'max_tokens' : 'end_turn' });

async function post(url: string, headers: Record<string, string>, body: unknown, provider: Provider): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new BrowserRefused(`${providerName(provider)} could not be reached from the app: no connection, or it doesn't allow the app to call it from a browser.`);
  }
}

/** What went wrong, in words: a bad key says so; anything else says what the provider said. */
export async function errorText(res: Response, provider: Provider): Promise<string> {
  const who = providerName(provider).replace(/ \(.*\)$/, '');
  if (res.status === 401 || res.status === 403) return `${who} answered ${res.status}. Check the API key in Settings.`;
  let detail = '';
  try { const j = (await res.json()) as { error?: { message?: string } | string }; detail = typeof j.error === 'string' ? j.error : j.error?.message ?? ''; } catch { /* no body */ }
  return `${who} answered ${res.status}${detail ? `: ${detail}` : ''}.`;
}

/** A refusal of an optional setting (thinking, effort): asked again without it, so a model that lacks it still answers. */
const optionalRefused = (status: number, text: string, words: RegExp) => status === 400 && words.test(text);

// ---- the adapters ------------------------------------------------------------

export function anthropicBody(model: string, req: CompleteRequest, withOptions = true): Record<string, unknown> {
  const think = req.think ?? 'none';
  return {
    model, max_tokens: req.maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
    ...(withOptions ? (think === 'none' ? { thinking: { type: 'between_tools' } } : { thinking: { type: 'adaptive' } }) : {}),
    ...(req.schema || (withOptions && think !== 'none') ? { output_config: { ...(withOptions && think !== 'none' ? { effort: think } : {}), ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}) } } : {}),
  };
}

export function readAnthropic(data: { content?: Array<{ type: string; text?: string }>; stop_reason?: string }): CompleteReply {
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  return { content: [{ type: 'text', text }], stop_reason: data.stop_reason ?? 'end_turn' };
}

async function anthropic(cfg: CoachConfig, model: string, req: CompleteRequest): Promise<CompleteReply> {
  const headers = { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  let res = await post('https://api.anthropic.com/v1/messages', headers, anthropicBody(model, req), 'anthropic');
  if (!res.ok) {
    const text = await res.clone().text();
    if (optionalRefused(res.status, text, /thinking|effort|between_tools|adaptive/i)) res = await post('https://api.anthropic.com/v1/messages', headers, anthropicBody(model, req, false), 'anthropic');
  }
  if (!res.ok) throw new Error(await errorText(res, 'anthropic'));
  return readAnthropic(await res.json());
}

export function openaiBody(model: string, req: CompleteRequest, withOptions = true): Record<string, unknown> {
  const msgs = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages];
  return {
    model, messages: msgs, max_completion_tokens: req.maxTokens,
    ...(withOptions && req.think && req.think !== 'none' ? { reasoning_effort: req.think } : {}),
    ...(req.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: req.schema } } } : {}),
  };
}

export function readOpenai(data: { choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }> }): CompleteReply {
  const c = data.choices?.[0];
  return reply((c?.message?.content ?? '').trim(), c?.finish_reason === 'length');
}

async function openai(cfg: CoachConfig, model: string, req: CompleteRequest): Promise<CompleteReply> {
  const headers = { authorization: `Bearer ${cfg.key}` };
  let res = await post('https://api.openai.com/v1/chat/completions', headers, openaiBody(model, req), 'openai');
  if (!res.ok) {
    const text = await res.clone().text();
    if (optionalRefused(res.status, text, /reasoning_effort|reasoning/i)) res = await post('https://api.openai.com/v1/chat/completions', headers, openaiBody(model, req, false), 'openai');
  }
  if (!res.ok) throw new Error(await errorText(res, 'openai'));
  return readOpenai(await res.json());
}

/** Gemini's older schema form takes no additionalProperties; the newer one takes JSON schema as it is. */
function stripExtras(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripExtras);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'additionalProperties').map(([k, x]) => [k, stripExtras(x)]));
  return v;
}

export function googleBody(req: CompleteRequest, jsonSchemaField = true): Record<string, unknown> {
  return {
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: req.maxTokens,
      ...(req.schema ? { responseMimeType: 'application/json', ...(jsonSchemaField ? { responseJsonSchema: req.schema } : { responseSchema: stripExtras(req.schema) }) } : {}),
    },
  };
}

export function readGoogle(data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }> }): CompleteReply {
  const c = data.candidates?.[0];
  const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
  return reply(text, c?.finishReason === 'MAX_TOKENS');
}

async function google(cfg: CoachConfig, model: string, req: CompleteRequest): Promise<CompleteReply> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { 'x-goog-api-key': cfg.key };
  let res = await post(url, headers, googleBody(req), 'google');
  if (!res.ok && req.schema) {
    const text = await res.clone().text();
    if (optionalRefused(res.status, text, /responseJsonSchema|response_json_schema/i)) res = await post(url, headers, googleBody(req, false), 'google');
  }
  if (!res.ok) throw new Error(await errorText(res, 'google'));
  return readGoogle(await res.json());
}

// ---- models ------------------------------------------------------------------

export interface ModelChoice { best: string; faster: string; all: string[] }

/** Used when the provider's list can't be read (offline at the moment it is needed): names known to work. */
export const KNOWN: Record<Provider, { best: string; faster: string }> = {
  anthropic: { best: 'claude-sonnet-5-5', faster: 'claude-haiku-5-5' },
  openai: { best: 'gpt-5', faster: 'gpt-5-mini' },
  google: { best: 'gemini-2.5-pro', faster: 'gemini-2.5-flash' },
};

const versionOf = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number);
const newer = (a: string, b: string) => { const x = versionOf(a), y = versionOf(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };

/**
 * The curated rules: from a provider's list, its most capable general model and
 * a faster one. Anthropic: the highest tier (Fable, Opus, Sonnet, Haiku), newest
 * version; faster is the newest Sonnet (or Haiku). OpenAI: the newest "gpt-N"
 * with no variant; faster is its "-mini". Google: the newest "gemini-…-pro";
 * faster is the newest "-flash". Specialised models (audio, images, embeddings,
 * search, realtime, dated snapshots) are left out of "More".
 */
export function chooseModels(provider: Provider, ids: string[]): ModelChoice {
  const k = KNOWN[provider];
  const pickNewest = (xs: string[]) => [...xs].sort((a, b) => newer(b, a))[0];
  if (provider === 'anthropic') {
    const all = ids.filter((m) => /^claude-/.test(m) && !/-\d{8}$/.test(m));
    const tier = (m: string) => (/fable|mythos/.test(m) ? 4 : /opus/.test(m) ? 3 : /sonnet/.test(m) ? 2 : /haiku/.test(m) ? 1 : 0);
    const top = Math.max(0, ...all.map(tier));
    const best = pickNewest(all.filter((m) => tier(m) === top)) ?? k.best;
    const faster = pickNewest(all.filter((m) => tier(m) === 2 && m !== best)) ?? pickNewest(all.filter((m) => tier(m) === 1)) ?? k.faster;
    return { best, faster, all: all.sort((a, b) => tier(b) - tier(a) || newer(b, a)) };
  }
  if (provider === 'openai') {
    const skip = /audio|realtime|search|transcribe|tts|image|embedding|instruct|codex|nano|-\d{4}-\d{2}-\d{2}|chat-latest|-pro\b|oss|moderation/;
    const all = ids.filter((m) => /^(gpt-|o\d)/.test(m) && !skip.test(m));
    const plain = all.filter((m) => /^gpt-\d+(\.\d+)?$/.test(m));
    const best = pickNewest(plain) ?? k.best;
    const faster = all.includes(`${best}-mini`) ? `${best}-mini` : pickNewest(all.filter((m) => /^gpt-\d+(\.\d+)?-mini$/.test(m))) ?? k.faster;
    return { best, faster, all: all.sort((a, b) => newer(b, a)) };
  }
  const names = ids.map((m) => m.replace(/^models\//, ''));
  const all = names.filter((m) => /^gemini-/.test(m) && !/image|tts|embedding|live|audio|vision|aqa|lite|exp|thinking/.test(m));
  const stable = (xs: string[]) => { const s = xs.filter((m) => !/preview/.test(m)); return s.length ? s : xs; };
  const best = pickNewest(stable(all.filter((m) => /-pro\b/.test(m)))) ?? k.best;
  const faster = pickNewest(stable(all.filter((m) => /-flash\b/.test(m)))) ?? k.faster;
  return { best, faster, all: all.sort((a, b) => newer(b, a)) };
}

/** The provider's models, read from its own list. */
export async function listModels(cfg: Pick<CoachConfig, 'provider' | 'key'>): Promise<string[]> {
  let res: Response;
  try {
    res = cfg.provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
      : cfg.provider === 'openai'
        ? await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${cfg.key}` } })
        : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': cfg.key } });
  } catch { throw new BrowserRefused(`${providerName(cfg.provider)} could not be reached from the app: no connection, or it doesn't allow the app to call it from a browser.`); }
  if (!res.ok) throw new Error(await errorText(res, cfg.provider));
  const j = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
  if (j.models) return j.models.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  return (j.data ?? []).map((m) => m.id);
}

const chosen = new Map<string, ModelChoice>();
/** The models for this provider and key, read once per session (the known names when the list can't be read). */
export async function modelsFor(cfg: Pick<CoachConfig, 'provider' | 'key'>): Promise<ModelChoice> {
  const k = `${cfg.provider}|${cfg.key.slice(-6)}`;
  const have = chosen.get(k);
  if (have) return have;
  let ids: string[] = [];
  try { ids = await listModels(cfg); } catch { ids = []; }
  const c = ids.length ? chooseModels(cfg.provider, ids) : { ...KNOWN[cfg.provider], all: [] };
  if (ids.length) chosen.set(k, c);
  return c;
}

/** The model a configuration means: most capable (empty), faster, or a named one. */
export async function resolveModel(cfg: CoachConfig): Promise<string> {
  const m = (cfg.model ?? '').trim();
  if (m && m !== 'faster') return m;
  const c = await modelsFor(cfg);
  return m === 'faster' ? c.faster : c.best;
}

/** One request to the coach, whichever provider. */
export async function complete(cfg: CoachConfig, req: CompleteRequest): Promise<CompleteReply> {
  const model = await resolveModel(cfg);
  return cfg.provider === 'openai' ? openai(cfg, model, req) : cfg.provider === 'google' ? google(cfg, model, req) : anthropic(cfg, model, req);
}

/** Settings' Test: one tiny call. "Working" with the model's name, or the provider's error in words. */
export async function testCoach(cfg: CoachConfig): Promise<{ ok: boolean; text: string }> {
  try {
    const model = await resolveModel(cfg);
    const r = await complete({ ...cfg, model }, { messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 200 });
    const text = r.content[0]?.text ?? '';
    return text ? { ok: true, text: `Working: ${providerName(cfg.provider)}, ${model}.` } : { ok: false, text: `${providerName(cfg.provider)} answered with nothing (${r.stop_reason}).` };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}
