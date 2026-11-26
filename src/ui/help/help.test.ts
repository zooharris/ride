import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, SHOT_VERSIONS } from './Shot';
import { ARTICLES, articleFor, OLD_NAMES, TOPICS } from './articles';
import { REFERENCE } from './reference';
import { textOf } from './search';
import { latestNews, unseen, WHATS_NEW } from './whatsNew';

/**
 * Help holds together (rebuilt as pages 26 Nov 2026): every picture it shows exists for every version; every "?" and
 * every link into Help leads to a page that is there; every page belongs to a topic and leads on only to pages that
 * exist; all of the long detail is reachable from some page; and the pages stay short.
 */
const ROOT = join(__dirname, '..', '..', '..');
const read = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? read(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []));
const sources = read(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8'));
const articles = readFileSync(join(ROOT, 'src/ui/help/articles.tsx'), 'utf8');

describe('Help', () => {
  it('has every picture it shows, for a computer, an iPhone and an iPad', () => {
    const missing = SHOTS.flatMap((n) => SHOT_VERSIONS.map((v) => `${n}-${v}.webp`)).filter((f) => !existsSync(join(ROOT, 'public', 'help', f)));
    expect(missing).toEqual([]);
  });
  it('shows only pictures that are on its list, and uses every picture on the list', () => {
    const used = new Set([...articles.matchAll(/(?:shot|name|thumb)[=:] ?["']([a-z-]+)["']/g)].map((m) => m[1]).filter((n) => (SHOTS as readonly string[]).includes(n) || /^[a-z]+(-[a-z]+)+$/.test(n)));
    const shown = [...articles.matchAll(/<Shot name="([a-z-]+)"/g), ...articles.matchAll(/shot="([a-z-]+)"/g), ...articles.matchAll(/thumb: '([a-z-]+)'/g)].map((m) => m[1]);
    expect(shown.filter((n) => !(SHOTS as readonly string[]).includes(n))).toEqual([]);
    expect(SHOTS.filter((n) => !shown.includes(n) && !used.has(n))).toEqual([]);
  });
  it('every "?" on a screen and every link into Help leads to a page that exists', () => {
    const asked = sources.flatMap((s) => [...s.matchAll(/help\?s=([a-z-]+)/g), ...s.matchAll(/\bhelp="([a-z-]+)"/g), ...s.matchAll(/help: '([a-z-]+)'/g), ...s.matchAll(/#\/help\/([a-z][a-z-]+)/g), ...s.matchAll(/<A to="([a-z-]+)"/g)].map((m) => m[1]));
    expect(asked.length).toBeGreaterThan(30);
    const topics = new Set(TOPICS.map((t) => `t-${t.id}`));
    // 'name' and 't-' are from the notes describing the addresses, not addresses themselves.
    expect([...new Set(asked.filter((a) => !articleFor(a) && !topics.has(a) && a !== 'name' && a !== 't-'))]).toEqual([]);
  });
  it('every screen with a title has a "?"', () => {
    const bare = sources.flatMap((s) => [...s.matchAll(/<PageHead(?![^>]*help=)[^>]*>/g)].map((m) => m[0])).filter((t) => !/title="Help"/.test(t));
    expect(bare).toEqual([]);
  });
  it('every page has its own name, a topic or a place on the home page, and leads on only to pages that exist', () => {
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLES.length);
    const topics = new Set([...TOPICS.map((t) => t.id), 'tools']);
    expect(ARTICLES.filter((a) => !topics.has(a.topic)).map((a) => a.id)).toEqual([]);
    expect(ARTICLES.flatMap((a) => (a.related ?? []).filter((r) => !articleFor(r)).map((r) => `${a.id} -> ${r}`))).toEqual([]);
    expect(TOPICS.filter((t) => !ARTICLES.some((a) => a.topic === t.id)).map((t) => t.id)).toEqual([]);
    expect(Object.values(OLD_NAMES).filter((id) => !ARTICLES.some((a) => a.id === id))).toEqual([]);
  });
  it('all of the long detail is behind some page, and each page names detail that exists', () => {
    const named = ARTICLES.map((a) => a.detail).filter((d): d is string => !!d);
    expect(named.filter((d) => !REFERENCE.some((r) => r.id === d))).toEqual([]);
    expect(REFERENCE.map((r) => r.id).filter((id) => !named.includes(id))).toEqual([]);
  });
  it('pages stay short: an article is read at a glance, with the rest folded away', () => {
    const words = ARTICLES.map((a) => ({ id: a.id, n: textOf(a.body()).split(/\s+/).filter(Boolean).length }));
    // What's new grows with each version, and is a list by nature.
    expect(words.filter((w) => w.n > 330 && w.id !== 'new')).toEqual([]);
  });
});

describe("What's new", () => {
  it('lists the newest first, each with its own id', () => {
    expect(new Set(WHATS_NEW.map((e) => e.id)).size).toBe(WHATS_NEW.length);
    expect([...WHATS_NEW].sort((a, b) => b.id.localeCompare(a.id))).toEqual(WHATS_NEW);
  });
  it('shows a rider what they have not seen: all since their last, or the newest when that is unknown', () => {
    expect(unseen(latestNews().id)).toEqual([]);
    expect(unseen(WHATS_NEW[1].id)).toEqual([WHATS_NEW[0]]);
    expect(unseen(null)).toEqual([WHATS_NEW[0]]);
    expect(unseen('a-version-long-gone')).toEqual([WHATS_NEW[0]]);
  });
});
