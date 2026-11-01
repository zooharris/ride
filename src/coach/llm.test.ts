import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicBody, chooseModels, complete, googleBody, openaiBody, readAnthropic, readGoogle, readOpenai, testCoach } from './llm';

const schema = { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false };
const req = { system: 'You are the coach.', messages: [{ role: 'user' as const, content: 'Evidence…' }], schema, maxTokens: 1000, think: 'high' as const };

afterEach(() => vi.unstubAllGlobals());

describe('F: one interface, three providers', () => {
  it('Anthropic: system, messages, adaptive thinking at the effort asked, the JSON schema; short notes without thinking', () => {
    expect(anthropicBody('claude-x', req)).toEqual({ model: 'claude-x', max_tokens: 1000, system: 'You are the coach.', messages: req.messages, thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema } } });
    expect(anthropicBody('claude-x', { messages: req.messages, maxTokens: 1500 })).toEqual({ model: 'claude-x', max_tokens: 1500, messages: req.messages, thinking: { type: 'between_tools' } });
    expect(anthropicBody('claude-x', req, false)).toEqual({ model: 'claude-x', max_tokens: 1000, system: 'You are the coach.', messages: req.messages, output_config: { format: { type: 'json_schema', schema } } });
    expect(readAnthropic({ content: [{ type: 'thinking', text: 'x' }, { type: 'text', text: ' {"note":"a"} ' }], stop_reason: 'end_turn' })).toEqual({ content: [{ type: 'text', text: '{"note":"a"}' }], stop_reason: 'end_turn' });
  });
  it('OpenAI: the system message first, a strict JSON schema, the reasoning effort; a reply cut at the limit reads as cut', () => {
    expect(openaiBody('gpt-x', req)).toEqual({ model: 'gpt-x', messages: [{ role: 'system', content: 'You are the coach.' }, ...req.messages], max_completion_tokens: 1000, reasoning_effort: 'high', response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } } });
    expect(readOpenai({ choices: [{ message: { content: '{"note":"a"}' }, finish_reason: 'stop' }] })).toEqual({ content: [{ type: 'text', text: '{"note":"a"}' }], stop_reason: 'end_turn' });
    expect(readOpenai({ choices: [{ message: { content: '{"no' }, finish_reason: 'length' }] }).stop_reason).toBe('max_tokens');
  });
  it('Google: system instruction, model turns, the JSON schema (or its older form without extras); thoughts left out of the reply', () => {
    const b = googleBody({ ...req, messages: [...req.messages, { role: 'assistant', content: 'ok' }] }) as { contents: Array<{ role: string }>; generationConfig: Record<string, unknown>; systemInstruction: unknown };
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'You are the coach.' }] });
    expect(b.contents.map((c) => c.role)).toEqual(['user', 'model']);
    expect(b.generationConfig).toEqual({ maxOutputTokens: 1000, responseMimeType: 'application/json', responseJsonSchema: schema });
    expect((googleBody(req, false) as { generationConfig: { responseSchema: unknown } }).generationConfig.responseSchema).toEqual({ type: 'object', properties: { note: { type: 'string' } }, required: ['note'] });
    expect(readGoogle({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"note":"a"}' }] }, finishReason: 'STOP' }] }).content[0].text).toBe('{"note":"a"}');
    expect(readGoogle({ candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'MAX_TOKENS' }] }).stop_reason).toBe('max_tokens');
  });
});

describe('F: the model, chosen from the provider\'s own list', () => {
  it('Anthropic: the highest tier and newest version is most capable; the newest Sonnet is faster; dated snapshots are left out', () => {
    const c = chooseModels('anthropic', ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5-1', 'claude-fable-5-1', 'claude-sonnet-4-5-20250929']);
    expect(c.best).toBe('claude-fable-5-1');
    expect(c.faster).toBe('claude-sonnet-5-5');
    expect(c.all).not.toContain('claude-sonnet-4-5-20250929');
  });
  it('OpenAI: the newest plain gpt is most capable, its mini is faster; audio, images, dated and pro models are left out', () => {
    const c = chooseModels('openai', ['gpt-4.1', 'gpt-5', 'gpt-5-mini', 'gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-pro', 'gpt-4o-audio-preview', 'gpt-5-2025-08-07', 'gpt-image-1', 'text-embedding-3-large', 'gpt-5.5-nano']);
    expect(c.best).toBe('gpt-5.5');
    expect(c.faster).toBe('gpt-5.5-mini');
    expect(c.all).toEqual(['gpt-5.5', 'gpt-5.5-mini', 'gpt-5', 'gpt-5-mini', 'gpt-4.1']);
  });
  it('Google: the newest stable pro is most capable, the newest flash is faster; previews only when nothing stable', () => {
    const c = chooseModels('google', ['models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-3.0-pro-preview', 'models/gemini-2.5-flash-lite', 'models/text-embedding-004', 'models/gemini-2.5-flash-image']);
    expect(c.best).toBe('gemini-2.5-pro');
    expect(c.faster).toBe('gemini-2.5-flash');
    expect(chooseModels('google', ['gemini-3.0-pro-preview', 'gemini-3.0-flash-preview']).best).toBe('gemini-3.0-pro-preview');
  });
});

describe('F: calls, refusals and Test', () => {
  it('a model that refuses an optional setting (thinking) is asked again without it', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      if (body.thinking) return new Response(JSON.stringify({ error: { message: 'thinking.type: adaptive is not supported on this model' } }), { status: 400 });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"note":"ok"}' }], stop_reason: 'end_turn' }), { status: 200 });
    }));
    const r = await complete({ provider: 'anthropic', key: 'k', model: 'claude-x' }, req);
    expect(r.content[0].text).toBe('{"note":"ok"}');
    expect(calls).toHaveLength(2);
    expect(calls[1].thinking).toBeUndefined();
  });
  it('a provider that will not take a call from the browser says so in words; a bad key says to check it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await testCoach({ provider: 'openai', key: 'k', model: 'gpt-x' })).text).toMatch(/doesn't allow the app to call it from a browser/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect(await testCoach({ provider: 'google', key: 'k', model: 'gemini-x' })).toEqual({ ok: false, text: 'Google answered 401. Check the API key in Settings.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }] }), { status: 200 })));
    expect(await testCoach({ provider: 'openai', key: 'k', model: 'gpt-x' })).toEqual({ ok: true, text: 'Working: OpenAI (ChatGPT), gpt-x.' });
  });
});
