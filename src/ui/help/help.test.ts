import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOTS, SHOT_VERSIONS } from './Shot';
import { latestNews, unseen, WHATS_NEW } from './whatsNew';

/**
 * Help holds together (25 Nov 2026): every picture it shows exists for every version, every "?" and every link
 * into Help leads to a section that is there, and What's new shows a rider what they have not yet seen.
 */
const ROOT = join(__dirname, '..', '..', '..');
const read = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? read(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []));
const sources = read(join(ROOT, 'src')).map((f) => readFileSync(f, 'utf8'));
const helpPage = readFileSync(join(ROOT, 'src/ui/screens/Help.tsx'), 'utf8') + readFileSync(join(ROOT, 'src/ui/help/guides.tsx'), 'utf8');
const ids = new Set([...helpPage.matchAll(/\bid: '([a-z-]+)', title:/g)].map((m) => m[1]));

describe('Help', () => {
  it('has every picture it shows, for a computer, an iPhone and an iPad', () => {
    const missing = SHOTS.flatMap((n) => SHOT_VERSIONS.map((v) => `${n}-${v}.webp`)).filter((f) => !existsSync(join(ROOT, 'public', 'help', f)));
    expect(missing).toEqual([]);
  });
  it('shows only pictures that are on its list', () => {
    const used = [...helpPage.matchAll(/<Shot name="([a-z-]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(8);
    expect(used.filter((n) => !(SHOTS as readonly string[]).includes(n))).toEqual([]);
  });
  it('every "?" on a screen and every link into Help leads to a section that exists', () => {
    expect(ids.size).toBeGreaterThan(25);
    const asked = sources.flatMap((s) => [...s.matchAll(/help\?s=([a-z-]+)/g), ...s.matchAll(/\bhelp="([a-z-]+)"/g), ...s.matchAll(/help: '([a-z-]+)'/g)].map((m) => m[1]));
    expect(asked.length).toBeGreaterThan(30);
    expect([...new Set(asked.filter((a) => !ids.has(a)))]).toEqual([]);
  });
  it('every screen with a title has a "?"', () => {
    const bare = sources.flatMap((s) => [...s.matchAll(/<PageHead(?![^>]*help=)[^>]*>/g)].map((m) => m[0])).filter((t) => !/title="Help"/.test(t));
    expect(bare).toEqual([]);
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
