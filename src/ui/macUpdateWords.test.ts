import { describe, expect, it } from 'vitest';
import { fraction, megabytes, updateWords } from './macUpdateWords';
// The downloader's own pure parts, shared with the Mac app's own side.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fileOf, baseName, freeName, why } = require('../../desktop/update.cjs') as { fileOf: (r: unknown) => { url: string; size: number; sha256?: string; number?: string } | null; baseName: (n?: string) => string; freeName: (b: string, e: (n: string) => boolean) => string; why: (e: unknown) => string };

describe("the Mac app's own download: what the banner says", () => {
  it('counts megabytes as the Finder does', () => { expect(megabytes(231_275_913)).toBe(231); });
  it('says how far it has got', () => {
    expect(updateWords({ state: 'downloading', received: 97_000_000, total: 231_275_913 }, 'Antogo')).toEqual({ head: 'Downloading the newer Antogo…', text: '97 of 231 MB' });
    expect(updateWords({ state: 'downloading', received: 5_000_000 }, 'Antogo').text).toBe('5 MB so far');
    expect(fraction({ state: 'downloading', received: 50, total: 200 })).toBe(0.25);
    expect(fraction({ state: 'downloading', received: 50 })).toBeUndefined();
  });
  it('names the file when it is downloaded, and says so when it already was', () => {
    expect(updateWords({ state: 'done', name: 'Antogo 316.dmg' }, 'Antogo').text).toContain('Antogo 316.dmg');
    expect(updateWords({ state: 'done', name: 'Antogo 316.dmg', already: true }, 'Antogo').head).toContain('already');
  });
  it('gives the reason a download did not finish', () => { expect(updateWords({ state: 'failed', why: 'it stopped before the end' }, 'Antogo').text).toBe('it stopped before the end.'); });
});

describe("the Mac app's own download: the file", () => {
  const release = { tag_name: 'mac-316', assets: [{ name: 'Antogo.dmg', size: 231275913, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://github.com/zooharris/ride/releases/download/mac-316/Antogo.dmg' }] };
  it('reads where the file is, its size, its fingerprint and the release number', () => {
    expect(fileOf(release)).toEqual({ url: release.assets[0].browser_download_url, size: 231275913, sha256: 'a'.repeat(64), number: '316' });
    expect(fileOf({ tag_name: 'mac-1', assets: [] })).toBeNull();
    expect(fileOf(null)).toBeNull();
  });
  it('is named after its release', () => { expect(baseName('316')).toBe('Antogo 316.dmg'); expect(baseName(undefined)).toBe('Antogo.dmg'); });
  it('never takes the name of a file that is already there', () => {
    const there = new Set(['Antogo.dmg', 'Antogo (2).dmg']);
    expect(freeName('Antogo.dmg', (n) => there.has(n))).toBe('Antogo (3).dmg');
    expect(freeName('Antogo 316.dmg', (n) => there.has(n))).toBe('Antogo 316.dmg');
  });
  it('says why in plain words', () => {
    expect(why(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('the internet could not be reached');
    expect(why(new Error('ENOSPC: no space left'))).toBe('there is not enough room on the disk');
  });
});
