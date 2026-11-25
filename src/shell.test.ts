import { describe, expect, it, vi, afterEach } from 'vitest';
import { appKind, inApp, serviceFetch, garminFetch, appKey } from './shell';

/** The app's own side, as the pages see it (24 Nov 2026): absent in a browser, and one shape for the Mac and iOS. */
afterEach(() => { vi.unstubAllGlobals(); });

describe('the installed app, seen from the pages', () => {
  it('in a browser there is no app: the page’s own fetch is used, and no key store', async () => {
    const page = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', page);
    expect(inApp()).toBe(false);
    expect(appKind()).toBeNull();
    expect(await (await serviceFetch('https://intervals.icu/api/v1/x')).text()).toBe('ok');
    expect(page).toHaveBeenCalledOnce();
    expect(await appKey.can()).toBe(false);
    expect(await appKey.unreadable()).toBe(false);
    await expect(garminFetch('https://personal.connectapi.garmin.com/x')).rejects.toThrow();
  });

  it('on the Mac the services are asked by the page as before, and Garmin through the app', async () => {
    const page = vi.fn(async () => new Response('page'));
    const garmin = vi.fn(async (_url: string, _init?: { headers?: Record<string, string> }) => ({ status: 200, type: 'text/plain', body: new TextEncoder().encode('app') }));
    vi.stubGlobal('fetch', page);
    vi.stubGlobal('window', { antogoApp: { kind: 'mac', garminFetch: garmin, keyCan: async () => true, keyRead: async () => null, keyUnreadable: async () => true } });
    expect(appKind()).toBe('mac');
    expect(await (await serviceFetch('https://intervals.icu/api/v1/x')).text()).toBe('page');
    expect(await (await garminFetch('https://personal.connectapi.garmin.com/x', { headers: { Authorization: 'ApiKey k' } })).text()).toBe('app');
    expect(garmin.mock.calls[0][1]).toMatchObject({ headers: { authorization: 'ApiKey k' } });
    expect(await appKey.unreadable()).toBe(true);
  });

  it('where the app offers it (iPhone and iPad), the services go through the app, body and headers intact', async () => {
    const page = vi.fn(async () => new Response('page'));
    const asked: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } }> = [];
    const service = async (url: string, init: never) => { asked.push({ url, init }); return { status: 201, type: 'application/json', body: new TextEncoder().encode('{"id":"i1"}') }; };
    vi.stubGlobal('fetch', page);
    vi.stubGlobal('window', { antogoApp: { kind: 'ios', garminFetch: service, serviceFetch: service } });
    const res = await serviceFetch('https://intervals.icu/api/v1/athlete/1/events', { method: 'POST', headers: { Authorization: 'Basic abc', 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'i1' });
    expect(page).not.toHaveBeenCalled();
    expect(asked[0].init.method).toBe('POST');
    expect(asked[0].init.headers).toMatchObject({ authorization: 'Basic abc', 'content-type': 'application/json' });
    expect(new TextDecoder().decode(asked[0].init.body)).toBe('{"a":1}');
    // A file upload: the form's own content type, with its boundary, travels with the bytes.
    const form = new FormData(); form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'ride.fit');
    await serviceFetch('https://intervals.icu/api/v1/athlete/1/activities', { method: 'POST', body: form, headers: { Authorization: 'Basic abc' } });
    expect(asked[1].init.headers?.['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(asked[1].init.body!.byteLength).toBeGreaterThan(3);
    // An empty answer is an empty response, not an error.
    vi.stubGlobal('window', { antogoApp: { kind: 'ios', garminFetch: service, serviceFetch: async () => ({ status: 204, type: '', body: new Uint8Array() }) } });
    expect((await serviceFetch('https://intervals.icu/api/v1/x', { method: 'DELETE' })).status).toBe(204);
  });
});
